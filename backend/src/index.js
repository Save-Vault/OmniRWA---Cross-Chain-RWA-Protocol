require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());

// ── Rate Limiting ─────────────────────────────────────────────────────────────
/**
 * Simple in-memory rate limiter.
 * windowMs  : sliding window size in ms
 * maxRequests: max allowed requests per IP in that window
 */
function createRateLimiter({ windowMs = 60_000, maxRequests = 10, message = "Too many requests, please try again later." } = {}) {
  const hits = new Map(); // ip -> [timestamps]

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();

    const timestamps = (hits.get(ip) || []).filter(t => now - t < windowMs);
    timestamps.push(now);
    hits.set(ip, timestamps);

    if (timestamps.length > maxRequests) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// KYC endpoints: 5 requests / 60 s per IP
const kycLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5, message: "Too many KYC requests. Please wait a minute and try again." });

// Bridge/transfer endpoints: 10 requests / 60 s per IP
const bridgeLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10, message: "Too many bridge requests. Please wait a minute and try again." });

// ── Configuration ─────────────────────────────────────────────────────────────
const CHAIN_A_RPC = process.env.CHAIN_A_RPC || "http://127.0.0.1:8545";
const CHAIN_B_RPC = process.env.CHAIN_B_RPC || "http://127.0.0.1:8545";
const BRIDGE_DELAY = parseInt(process.env.BRIDGE_DELAY || "5000", 10);

// ── Contract addresses ────────────────────────────────────────────────────────
let chainAContracts = { identityRegistry: null, complianceModule: null, token: null, router: null, futures: null };
let chainBContracts = { identityRegistry: null, complianceModule: null, token: null, router: null, futures: null };

// ── Providers / signers ───────────────────────────────────────────────────────
let chainAProvider;
let chainBProvider;
let chainASigner;
let chainBSigner;

// ── In-memory transfer history ────────────────────────────────────────────────
/**
 * Each entry shape:
 * {
 *   id:          string  (txHash-nonce)
 *   txHash:      string
 *   sender:      string
 *   receiver:    string
 *   amount:      string  (ether units)
 *   fee:         string  (ether units, "0" if none)
 *   sourceChain: string  ("chainA" | "chainB")
 *   destChain:   string  ("chainA" | "chainB")
 *   status:      string  ("pending" | "completed" | "failed")
 *   initiatedAt: number  (unix ms)
 *   completedAt: number | null
 * }
 */
const transferHistory = [];
let totalTransfers = 0;
let totalFeesCollected = 0n; // BigInt, in wei

// ── ABIs ──────────────────────────────────────────────────────────────────────
const ROUTER_ABI = [
  "event RWARouteInitiated(uint32 indexed destChainId, address indexed sender, address indexed receiver, uint256 amount, uint256 nonce)",
  "function handleIncomingRoute(uint32 srcChainId, address sender, address receiver, uint256 amount, uint256 nonce) external",
  "function setRelayer(address relayer, bool status) external"
];

const IDENTITY_REGISTRY_ABI = [
  "function registerUser(address user, bool status) external",
  "function isVerified(address user) external view returns (bool)"
];

const TOKEN_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function totalFeesCollected() external view returns (uint256)",
  "function feeBasisPoints() external view returns (uint256)"
];

// ── Futures ABI ───────────────────────────────────────────────────────────────
const FUTURES_ABI = [
  // State reads
  "function nextOrderId() external view returns (uint256)",
  "function oraclePrice() external view returns (uint256)",
  "function feeBasisPoints() external view returns (uint256)",
  "function totalFeesCollected() external view returns (uint256)",
  "function totalOrders() external view returns (uint256)",
  "function getOrderIds(uint256 offset, uint256 limit) external view returns (uint256[] memory)",
  "function getOrder(uint256 orderId) external view returns (tuple(uint256 id, address creator, address counterparty, uint8 side, uint256 strikePrice, uint256 amount, uint256 expiry, uint8 status, uint256 createdAt, uint256 filledAt, uint256 settledAt, address winner))",
  "function calculateFee(uint256 gross) external view returns (uint256)",
  // Write (called by user via MetaMask, not the backend signer — documented only)
  // Admin
  "function setOraclePrice(uint256 _price) external",
  // Events
  "event OrderCreated(uint256 indexed orderId, address indexed creator, uint8 side, uint256 strikePrice, uint256 amount, uint256 expiry)",
  "event OrderFilled(uint256 indexed orderId, address indexed counterparty)",
  "event OrderSettled(uint256 indexed orderId, address indexed winner, uint256 payout, uint256 fee)",
  "event OrderCancelled(uint256 indexed orderId, address indexed by)"
];

// ── Deployment file loader ────────────────────────────────────────────────────
function loadDeploymentFiles() {
  const fs = require("fs");
  try {
    if (fs.existsSync("../contracts/deployment-chain-a.json")) {
      chainAContracts = JSON.parse(fs.readFileSync("../contracts/deployment-chain-a.json", "utf8"));
      console.log("Loaded Chain A deployment:", chainAContracts);
    }
    if (fs.existsSync("../contracts/deployment-chain-b.json")) {
      chainBContracts = JSON.parse(fs.readFileSync("../contracts/deployment-chain-b.json", "utf8"));
      console.log("Loaded Chain B deployment:", chainBContracts);
    }
  } catch (error) {
    console.error("Error loading deployment files:", error);
  }
}

// ── Providers ─────────────────────────────────────────────────────────────────
function initializeProviders() {
  try {
    const privateKey = process.env.PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    chainAProvider = new ethers.JsonRpcProvider(CHAIN_A_RPC);
    chainASigner   = new ethers.Wallet(privateKey, chainAProvider);
    chainBProvider = new ethers.JsonRpcProvider(CHAIN_B_RPC);
    chainBSigner   = new ethers.Wallet(privateKey, chainBProvider);
    console.log("Providers initialized successfully");
  } catch (error) {
    console.error("Error initializing providers:", error);
  }
}

// ── Relayer setup ─────────────────────────────────────────────────────────────
async function setupRelayer() {
  try {
    if (!chainAContracts.router || !chainBContracts.router) {
      console.log("Contract addresses not available, skipping relayer setup");
      return;
    }
    const chainARouter = new ethers.Contract(chainAContracts.router, ROUTER_ABI, chainASigner);
    const chainBRouter = new ethers.Contract(chainBContracts.router, ROUTER_ABI, chainBSigner);
    const relayerAddress = chainASigner.address;

    console.log("Setting up relayer on Chain A...");
    await chainARouter.setRelayer(relayerAddress, true);
    console.log("Relayer authorized on Chain A");

    console.log("Setting up relayer on Chain B...");
    await chainBRouter.setRelayer(relayerAddress, true);
    console.log("Relayer authorized on Chain B");
  } catch (error) {
    console.error("Error setting up relayer:", error);
  }
}

// ── Event listener ────────────────────────────────────────────────────────────
function startEventListener() {
  if (!chainAContracts.router) {
    console.log("Chain A router not available, skipping event listener");
    return;
  }

  const chainARouter = new ethers.Contract(chainAContracts.router, ROUTER_ABI, chainAProvider);
  console.log("Starting event listener on Chain A...");

  chainARouter.on("RWARouteInitiated", async (destChainId, sender, receiver, amount, nonce, event) => {
    console.log("\n=== Cross-Chain Transfer Initiated ===");
    console.log("Destination Chain ID:", destChainId.toString());
    console.log("Sender:", sender);
    console.log("Receiver:", receiver);
    console.log("Amount:", ethers.formatEther(amount));
    console.log("Nonce:", nonce.toString());
    console.log("=====================================\n");

    const txHash = event?.log?.transactionHash || event?.transactionHash || "unknown";
    const historyId = `${txHash}-${nonce.toString()}`;

    // Record transfer as pending
    const entry = {
      id: historyId,
      txHash,
      sender,
      receiver,
      amount: ethers.formatEther(amount),
      fee: "0", // fee was deducted on-chain during bridgeBurn
      sourceChain: "chainA",
      destChain: destChainId.toString() === "1" ? "chainA" : "chainB",
      status: "pending",
      initiatedAt: Date.now(),
      completedAt: null,
    };
    transferHistory.unshift(entry); // newest first
    totalTransfers++;

    console.log("Simulating cross-chain bridge delay...");
    await new Promise(resolve => setTimeout(resolve, BRIDGE_DELAY));

    const success = await handleIncomingRoute(destChainId, sender, receiver, amount, nonce);

    // Update history entry
    const idx = transferHistory.findIndex(t => t.id === historyId);
    if (idx !== -1) {
      transferHistory[idx].status = success ? "completed" : "failed";
      transferHistory[idx].completedAt = Date.now();
    }
  });

  console.log("Event listener started successfully");
}

// ── Incoming route handler ────────────────────────────────────────────────────
async function handleIncomingRoute(destChainId, sender, receiver, amount, nonce) {
  try {
    if (!chainBContracts.router) {
      console.log("Chain B router not available, cannot handle incoming route");
      return false;
    }
    const chainBRouter = new ethers.Contract(chainBContracts.router, ROUTER_ABI, chainBSigner);

    console.log("Handling incoming route on Chain B...");
    const tx = await chainBRouter.handleIncomingRoute(1, sender, receiver, amount, nonce);
    console.log("Transaction submitted:", tx.hash);
    await tx.wait();
    console.log("Transaction confirmed! Cross-chain transfer completed\n");
    return true;
  } catch (error) {
    console.error("Error handling incoming route:", error);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// API Routes
// ═══════════════════════════════════════════════════════════════════════════════

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "OmniRWA Backend is running" });
});

// ── KYC Registration ──────────────────────────────────────────────────────────
app.post("/api/kyc/register", kycLimiter, async (req, res) => {
  try {
    const { walletAddress, chain } = req.body;

    if (!walletAddress)                    return res.status(400).json({ error: "Wallet address is required" });
    if (!ethers.isAddress(walletAddress))  return res.status(400).json({ error: "Invalid wallet address" });

    const contracts = chain === "chainB" ? chainBContracts : chainAContracts;
    const signer    = chain === "chainB" ? chainBSigner   : chainASigner;

    if (!contracts.identityRegistry)
      return res.status(500).json({ error: "Identity registry not available" });

    const identityRegistry = new ethers.Contract(contracts.identityRegistry, IDENTITY_REGISTRY_ABI, signer);

    console.log(`Registering user ${walletAddress} on ${chain || "Chain A"}...`);
    const tx = await identityRegistry.registerUser(walletAddress, true);
    await tx.wait();
    console.log(`User ${walletAddress} registered successfully`);

    res.json({ success: true, message: "KYC registration successful", walletAddress, chain: chain || "chainA", transactionHash: tx.hash });
  } catch (error) {
    console.error("Error registering KYC:", error);
    res.status(500).json({ error: "Failed to register KYC", details: error.message });
  }
});

// ── KYC Status ────────────────────────────────────────────────────────────────
app.get("/api/kyc/status", kycLimiter, async (req, res) => {
  try {
    const { walletAddress, chain } = req.query;

    if (!walletAddress)                    return res.status(400).json({ error: "Wallet address is required" });
    if (!ethers.isAddress(walletAddress))  return res.status(400).json({ error: "Invalid wallet address" });

    const contracts = chain === "chainB" ? chainBContracts : chainAContracts;
    const provider  = chain === "chainB" ? chainBProvider  : chainAProvider;

    if (!contracts.identityRegistry)
      return res.status(500).json({ error: "Identity registry not available" });

    const identityRegistry = new ethers.Contract(contracts.identityRegistry, IDENTITY_REGISTRY_ABI, provider);
    const isVerified = await identityRegistry.isVerified(walletAddress);

    res.json({ walletAddress, chain: chain || "chainA", isVerified });
  } catch (error) {
    console.error("Error checking KYC status:", error);
    res.status(500).json({ error: "Failed to check KYC status", details: error.message });
  }
});

// ── Asset Status ──────────────────────────────────────────────────────────────
app.get("/api/assets/status", async (req, res) => {
  try {
    const { walletAddress } = req.query;

    if (!walletAddress)                    return res.status(400).json({ error: "Wallet address is required" });
    if (!ethers.isAddress(walletAddress))  return res.status(400).json({ error: "Invalid wallet address" });

    let chainABalance = "0";
    let chainBBalance = "0";

    if (chainAContracts.token) {
      const t = new ethers.Contract(chainAContracts.token, TOKEN_ABI, chainAProvider);
      chainABalance = ethers.formatEther(await t.balanceOf(walletAddress));
    }
    if (chainBContracts.token) {
      const t = new ethers.Contract(chainBContracts.token, TOKEN_ABI, chainBProvider);
      chainBBalance = ethers.formatEther(await t.balanceOf(walletAddress));
    }

    res.json({
      walletAddress,
      chainA: { balance: chainABalance, tokenSymbol: "ORWA" },
      chainB: { balance: chainBBalance, tokenSymbol: "ORWA" },
      totalBalance: (parseFloat(chainABalance) + parseFloat(chainBBalance)).toString()
    });
  } catch (error) {
    console.error("Error getting asset status:", error);
    res.status(500).json({ error: "Failed to get asset status", details: error.message });
  }
});

// ── Contract Addresses ────────────────────────────────────────────────────────
app.get("/api/contracts", (req, res) => {
  res.json({ chainA: chainAContracts, chainB: chainBContracts });
});

// ── Transfer History ──────────────────────────────────────────────────────────
/**
 * GET /api/transfer/history
 * Query params:
 *   walletAddress  (optional) – filter by sender or receiver
 *   limit          (optional, default 50) – max records to return
 *   offset         (optional, default 0)  – pagination
 *   status         (optional) – "pending" | "completed" | "failed"
 */
app.get("/api/transfer/history", bridgeLimiter, (req, res) => {
  try {
    const { walletAddress, limit = 50, offset = 0, status } = req.query;

    let results = [...transferHistory];

    // Filter by address if provided
    if (walletAddress) {
      if (!ethers.isAddress(walletAddress))
        return res.status(400).json({ error: "Invalid wallet address" });

      const addr = walletAddress.toLowerCase();
      results = results.filter(
        t => t.sender.toLowerCase() === addr || t.receiver.toLowerCase() === addr
      );
    }

    // Filter by status
    if (status) {
      results = results.filter(t => t.status === status);
    }

    const total = results.length;
    const page  = results.slice(Number(offset), Number(offset) + Number(limit));

    res.json({
      total,
      offset: Number(offset),
      limit:  Number(limit),
      transfers: page
    });
  } catch (error) {
    console.error("Error fetching transfer history:", error);
    res.status(500).json({ error: "Failed to fetch transfer history", details: error.message });
  }
});

// ── Protocol Stats ────────────────────────────────────────────────────────────
/**
 * GET /api/stats
 * Returns:
 *   tvl               – combined token supply across both chains (ether units)
 *   totalTransfers    – number of bridge transfers initiated since server start
 *   totalFeesCollected– sum of fees from on-chain token contracts (ether units)
 *   pendingTransfers  – count of in-flight transfers
 *   completedTransfers– count of completed transfers
 *   failedTransfers   – count of failed transfers
 *   feeBasisPoints    – current fee rate from Chain A token
 */
app.get("/api/stats", async (req, res) => {
  try {
    let tvlA = 0n;
    let tvlB = 0n;
    let feesA = 0n;
    let feesB = 0n;
    let feeBps = 0n;

    if (chainAContracts.token) {
      const t = new ethers.Contract(chainAContracts.token, TOKEN_ABI, chainAProvider);
      try { tvlA  = await t.totalSupply(); }          catch (_) {}
      try { feesA = await t.totalFeesCollected(); }   catch (_) {}
      try { feeBps = await t.feeBasisPoints(); }      catch (_) {}
    }
    if (chainBContracts.token) {
      const t = new ethers.Contract(chainBContracts.token, TOKEN_ABI, chainBProvider);
      try { tvlB  = await t.totalSupply(); }          catch (_) {}
      try { feesB = await t.totalFeesCollected(); }   catch (_) {}
    }

    const pending   = transferHistory.filter(t => t.status === "pending").length;
    const completed = transferHistory.filter(t => t.status === "completed").length;
    const failed    = transferHistory.filter(t => t.status === "failed").length;

    res.json({
      tvl:                 ethers.formatEther(tvlA + tvlB),
      tvlChainA:           ethers.formatEther(tvlA),
      tvlChainB:           ethers.formatEther(tvlB),
      totalTransfers,
      totalFeesCollected:  ethers.formatEther(feesA + feesB),
      feeBasisPoints:      feeBps.toString(),
      pendingTransfers:    pending,
      completedTransfers:  completed,
      failedTransfers:     failed
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch stats", details: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Futures Routes
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Helper to pick the right chain contracts + provider.
 */
function futuresContractFor(chain) {
  const contracts = chain === "chainB" ? chainBContracts : chainAContracts;
  const provider  = chain === "chainB" ? chainBProvider  : chainAProvider;
  const signer    = chain === "chainB" ? chainBSigner    : chainASigner;
  return { contracts, provider, signer };
}

/**
 * Normalise an on-chain Order tuple into a plain JS object.
 */
function formatOrder(o) {
  const SIDE   = ["LONG", "SHORT"];
  const STATUS = ["OPEN", "FILLED", "SETTLED", "CANCELLED"];
  return {
    id:           Number(o.id),
    creator:      o.creator,
    counterparty: o.counterparty,
    side:         SIDE[Number(o.side)]   || "UNKNOWN",
    strikePrice:  ethers.formatEther(o.strikePrice),
    amount:       ethers.formatEther(o.amount),
    expiry:       Number(o.expiry) * 1000,          // ms
    status:       STATUS[Number(o.status)] || "UNKNOWN",
    createdAt:    Number(o.createdAt) * 1000,       // ms
    filledAt:     Number(o.filledAt) * 1000,
    settledAt:    Number(o.settledAt) * 1000,
    winner:       o.winner,
  };
}

// ── GET /api/futures ──────────────────────────────────────────────────────────
/**
 * List futures orders.
 * Query params:
 *   chain   (optional, default "chainA")
 *   limit   (optional, default 20)
 *   offset  (optional, default 0)
 *   status  (optional) – "OPEN"|"FILLED"|"SETTLED"|"CANCELLED"
 *   wallet  (optional) – filter by creator or counterparty
 */
app.get("/api/futures", async (req, res) => {
  try {
    const chain  = req.query.chain  || "chainA";
    const limit  = Math.min(Number(req.query.limit  || 20), 100);
    const offset = Number(req.query.offset || 0);
    const status = req.query.status || null;
    const wallet = req.query.wallet || null;

    const { contracts, provider } = futuresContractFor(chain);
    if (!contracts.futures)
      return res.status(503).json({ error: "Futures contract not available on this chain" });

    const futures  = new ethers.Contract(contracts.futures, FUTURES_ABI, provider);
    const total    = Number(await futures.totalOrders());
    const oPrice   = ethers.formatEther(await futures.oraclePrice());
    const feeBps   = Number(await futures.feeBasisPoints());

    // Fetch a broad window then filter/page in JS (simple approach for small data)
    const fetchLimit = Math.min(total, 200);
    const ids = fetchLimit === 0 ? [] : await futures.getOrderIds(0, fetchLimit);

    const orderPromises = ids.map(id => futures.getOrder(id).then(formatOrder).catch(() => null));
    let orders = (await Promise.all(orderPromises)).filter(Boolean);

    if (status) orders = orders.filter(o => o.status === status);
    if (wallet) {
      const addr = wallet.toLowerCase();
      orders = orders.filter(o =>
        o.creator.toLowerCase() === addr || o.counterparty.toLowerCase() === addr
      );
    }

    const pageOrders = orders.slice(offset, offset + limit);

    res.json({
      total:       orders.length,
      offset,
      limit,
      oraclePrice: oPrice,
      feeBps,
      orders:      pageOrders,
    });
  } catch (error) {
    console.error("Error fetching futures:", error);
    res.status(500).json({ error: "Failed to fetch futures orders", details: error.message });
  }
});

// ── GET /api/futures/:orderId ─────────────────────────────────────────────────
app.get("/api/futures/:orderId", async (req, res) => {
  try {
    const chain   = req.query.chain || "chainA";
    const orderId = Number(req.params.orderId);
    if (isNaN(orderId) || orderId < 0)
      return res.status(400).json({ error: "Invalid orderId" });

    const { contracts, provider } = futuresContractFor(chain);
    if (!contracts.futures)
      return res.status(503).json({ error: "Futures contract not available" });

    const futures = new ethers.Contract(contracts.futures, FUTURES_ABI, provider);
    const order   = await futures.getOrder(orderId);
    res.json(formatOrder(order));
  } catch (error) {
    console.error("Error fetching futures order:", error);
    res.status(500).json({ error: "Failed to fetch order", details: error.message });
  }
});

// ── GET /api/futures/oracle ───────────────────────────────────────────────────
app.get("/api/futures/oracle", async (req, res) => {
  try {
    const chain = req.query.chain || "chainA";
    const { contracts, provider } = futuresContractFor(chain);
    if (!contracts.futures)
      return res.status(503).json({ error: "Futures contract not available" });

    const futures = new ethers.Contract(contracts.futures, FUTURES_ABI, provider);
    const price   = await futures.oraclePrice();
    res.json({ chain, oraclePrice: ethers.formatEther(price) });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch oracle price", details: error.message });
  }
});

// ── POST /api/futures/oracle ──────────────────────────────────────────────────
/**
 * Update the oracle price (admin/relayer calls this in dev).
 * Body: { chain, price }  — price as a decimal string (e.g. "1.25")
 */
app.post("/api/futures/oracle", async (req, res) => {
  try {
    const { chain = "chainA", price } = req.body;
    if (!price || isNaN(Number(price)) || Number(price) <= 0)
      return res.status(400).json({ error: "Invalid price" });

    const { contracts, signer } = futuresContractFor(chain);
    if (!contracts.futures)
      return res.status(503).json({ error: "Futures contract not available" });

    const futures   = new ethers.Contract(contracts.futures, FUTURES_ABI, signer);
    const priceWei  = ethers.parseEther(price.toString());
    const tx        = await futures.setOraclePrice(priceWei);
    await tx.wait();

    console.log(`Oracle price updated on ${chain}: ${price}`);
    res.json({ success: true, chain, oraclePrice: price, txHash: tx.hash });
  } catch (error) {
    console.error("Error updating oracle price:", error);
    res.status(500).json({ error: "Failed to update oracle price", details: error.message });
  }
});

// ── GET /api/futures/stats ────────────────────────────────────────────────────
/**
 * Futures protocol stats for dashboard display.
 * Query: chain (default "chainA")
 */
app.get("/api/futures/stats", async (req, res) => {
  try {
    const chain = req.query.chain || "chainA";
    const { contracts, provider } = futuresContractFor(chain);
    if (!contracts.futures)
      return res.status(503).json({ error: "Futures contract not available" });

    const futures = new ethers.Contract(contracts.futures, FUTURES_ABI, provider);

    const [total, oPrice, feeBps, feesCollected] = await Promise.all([
      futures.totalOrders(),
      futures.oraclePrice(),
      futures.feeBasisPoints(),
      futures.totalFeesCollected(),
    ]);

    // Fetch recent orders for status breakdown
    const fetchCount = Math.min(Number(total), 200);
    let openCount = 0, filledCount = 0, settledCount = 0, cancelledCount = 0;

    if (fetchCount > 0) {
      const ids    = await futures.getOrderIds(0, fetchCount);
      const tuples = await Promise.all(ids.map(id => futures.getOrder(id).catch(() => null)));
      const STATUS = ["OPEN", "FILLED", "SETTLED", "CANCELLED"];
      for (const o of tuples) {
        if (!o) continue;
        const s = STATUS[Number(o.status)];
        if (s === "OPEN")      openCount++;
        if (s === "FILLED")    filledCount++;
        if (s === "SETTLED")   settledCount++;
        if (s === "CANCELLED") cancelledCount++;
      }
    }

    res.json({
      chain,
      totalOrders:       Number(total),
      oraclePrice:       ethers.formatEther(oPrice),
      feeBps:            Number(feeBps),
      totalFeesCollected:ethers.formatEther(feesCollected),
      openOrders:        openCount,
      filledOrders:      filledCount,
      settledOrders:     settledCount,
      cancelledOrders:   cancelledCount,
    });
  } catch (error) {
    console.error("Error fetching futures stats:", error);
    res.status(500).json({ error: "Failed to fetch futures stats", details: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Start server
// ═══════════════════════════════════════════════════════════════════════════════
async function startServer() {
  loadDeploymentFiles();
  initializeProviders();

  await new Promise(resolve => setTimeout(resolve, 2000));
  await setupRelayer();
  startEventListener();

  app.listen(PORT, () => {
    console.log(`\n=== OmniRWA Backend Server ===`);
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Chain A RPC: ${CHAIN_A_RPC}`);
    console.log(`Chain B RPC: ${CHAIN_B_RPC}`);
    console.log(`Bridge Delay: ${BRIDGE_DELAY}ms`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /health`);
    console.log(`  POST /api/kyc/register      [rate-limited]`);
    console.log(`  GET  /api/kyc/status        [rate-limited]`);
    console.log(`  GET  /api/assets/status`);
    console.log(`  GET  /api/contracts`);
    console.log(`  GET  /api/transfer/history  [rate-limited]`);
    console.log(`  GET  /api/stats`);
    console.log(`  GET  /api/futures            list orders`);
    console.log(`  GET  /api/futures/:orderId   order detail`);
    console.log(`  GET  /api/futures/stats      futures stats`);
    console.log(`  GET  /api/futures/oracle     current oracle price`);
    console.log(`  POST /api/futures/oracle     update oracle price (admin)`);
    console.log(`===============================\n`);
  });
}

startServer().catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

module.exports = app;
