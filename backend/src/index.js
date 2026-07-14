require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Configuration
const CHAIN_A_RPC = process.env.CHAIN_A_RPC || "http://127.0.0.1:8545";
const CHAIN_B_RPC = process.env.CHAIN_B_RPC || "http://127.0.0.1:8545";
const BRIDGE_DELAY = process.env.BRIDGE_DELAY || 5000; // 5 seconds

// Contract addresses (will be loaded from deployment files)
let chainAContracts = {
  identityRegistry: null,
  complianceModule: null,
  token: null,
  router: null
};

let chainBContracts = {
  identityRegistry: null,
  complianceModule: null,
  token: null,
  router: null
};

// Providers
let chainAProvider;
let chainBProvider;
let chainASigner;
let chainBSigner;

// ABI definitions (simplified for the events we need)
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
  "function balanceOf(address account) external view returns (uint256)"
];

// Load deployment files
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

// Initialize providers and signers
function initializeProviders() {
  try {
    // Chain A provider
    chainAProvider = new ethers.JsonRpcProvider(CHAIN_A_RPC);
    chainASigner = new ethers.Wallet(process.env.PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", chainAProvider); // Default Hardhat account #0
    
    // Chain B provider (using same RPC for simulation)
    chainBProvider = new ethers.JsonRpcProvider(CHAIN_B_RPC);
    chainBSigner = new ethers.Wallet(process.env.PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", chainBProvider);
    
    console.log("Providers initialized successfully");
  } catch (error) {
    console.error("Error initializing providers:", error);
  }
}

// Setup relayer authorization
async function setupRelayer() {
  try {
    if (!chainAContracts.router || !chainBContracts.router) {
      console.log("Contract addresses not available, skipping relayer setup");
      return;
    }

    const chainARouter = new ethers.Contract(chainAContracts.router, ROUTER_ABI, chainASigner);
    const chainBRouter = new ethers.Contract(chainBContracts.router, ROUTER_ABI, chainBSigner);

    // Authorize relayer on both chains
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

// Start event listener
function startEventListener() {
  if (!chainAContracts.router) {
    console.log("Chain A router not available, skipping event listener");
    return;
  }

  const chainARouter = new ethers.Contract(chainAContracts.router, ROUTER_ABI, chainAProvider);
  
  console.log("Starting event listener on Chain A...");
  
  // Listen for RWARouteInitiated events
  chainARouter.on("RWARouteInitiated", async (destChainId, sender, receiver, amount, nonce, event) => {
    console.log("\n=== Cross-Chain Transfer Initiated ===");
    console.log("Destination Chain ID:", destChainId.toString());
    console.log("Sender:", sender);
    console.log("Receiver:", receiver);
    console.log("Amount:", ethers.formatEther(amount));
    console.log("Nonce:", nonce.toString());
    console.log("=====================================\n");
    
    // Simulate bridge delay
    console.log("Simulating cross-chain bridge delay...");
    await new Promise(resolve => setTimeout(resolve, BRIDGE_DELAY));
    
    // Handle incoming route on destination chain
    await handleIncomingRoute(destChainId, sender, receiver, amount, nonce);
  });
  
  console.log("Event listener started successfully");
}

// Handle incoming route on destination chain
async function handleIncomingRoute(destChainId, sender, receiver, amount, nonce) {
  try {
    if (!chainBContracts.router) {
      console.log("Chain B router not available, cannot handle incoming route");
      return;
    }

    const chainBRouter = new ethers.Contract(chainBContracts.router, ROUTER_ABI, chainBSigner);
    
    console.log("Handling incoming route on Chain B...");
    console.log("Source Chain ID: 1 (Chain A)");
    console.log("Sender:", sender);
    console.log("Receiver:", receiver);
    console.log("Amount:", ethers.formatEther(amount));
    
    // Call handleIncomingRoute on destination chain
    const tx = await chainBRouter.handleIncomingRoute(
      1, // srcChainId (Chain A)
      sender,
      receiver,
      amount,
      nonce
    );
    
    console.log("Transaction submitted:", tx.hash);
    await tx.wait();
    console.log("Transaction confirmed!");
    console.log("Cross-chain transfer completed successfully\n");
  } catch (error) {
    console.error("Error handling incoming route:", error);
  }
}

// API Routes

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "OmniRWA Backend is running" });
});

// KYC Registration
app.post("/api/kyc/register", async (req, res) => {
  try {
    const { walletAddress, chain } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ error: "Wallet address is required" });
    }
    
    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    
    // Determine which chain to register on
    const contracts = chain === "chainB" ? chainBContracts : chainAContracts;
    const signer = chain === "chainB" ? chainBSigner : chainASigner;
    
    if (!contracts.identityRegistry) {
      return res.status(500).json({ error: "Identity registry not available" });
    }
    
    const identityRegistry = new ethers.Contract(
      contracts.identityRegistry,
      IDENTITY_REGISTRY_ABI,
      signer
    );
    
    console.log(`Registering user ${walletAddress} on ${chain || "Chain A"}...`);
    
    const tx = await identityRegistry.registerUser(walletAddress, true);
    await tx.wait();
    
    console.log(`User ${walletAddress} registered successfully`);
    
    res.json({
      success: true,
      message: "KYC registration successful",
      walletAddress,
      chain: chain || "chainA",
      transactionHash: tx.hash
    });
  } catch (error) {
    console.error("Error registering KYC:", error);
    res.status(500).json({ error: "Failed to register KYC", details: error.message });
  }
});

// Check KYC status
app.get("/api/kyc/status", async (req, res) => {
  try {
    const { walletAddress, chain } = req.query;
    
    if (!walletAddress) {
      return res.status(400).json({ error: "Wallet address is required" });
    }
    
    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    
    const contracts = chain === "chainB" ? chainBContracts : chainAContracts;
    const provider = chain === "chainB" ? chainBProvider : chainAProvider;
    
    if (!contracts.identityRegistry) {
      return res.status(500).json({ error: "Identity registry not available" });
    }
    
    const identityRegistry = new ethers.Contract(
      contracts.identityRegistry,
      IDENTITY_REGISTRY_ABI,
      provider
    );
    
    const isVerified = await identityRegistry.isVerified(walletAddress);
    
    res.json({
      walletAddress,
      chain: chain || "chainA",
      isVerified
    });
  } catch (error) {
    console.error("Error checking KYC status:", error);
    res.status(500).json({ error: "Failed to check KYC status", details: error.message });
  }
});

// Get asset status across chains
app.get("/api/assets/status", async (req, res) => {
  try {
    const { walletAddress } = req.query;
    
    if (!walletAddress) {
      return res.status(400).json({ error: "Wallet address is required" });
    }
    
    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    
    let chainABalance = "0";
    let chainBBalance = "0";
    
    // Get Chain A balance
    if (chainAContracts.token) {
      const chainAToken = new ethers.Contract(chainAContracts.token, TOKEN_ABI, chainAProvider);
      chainABalance = await chainAToken.balanceOf(walletAddress);
      chainABalance = ethers.formatEther(chainABalance);
    }
    
    // Get Chain B balance
    if (chainBContracts.token) {
      const chainBToken = new ethers.Contract(chainBContracts.token, TOKEN_ABI, chainBProvider);
      chainBBalance = await chainBToken.balanceOf(walletAddress);
      chainBBalance = ethers.formatEther(chainBBalance);
    }
    
    res.json({
      walletAddress,
      chainA: {
        balance: chainABalance,
        tokenSymbol: "ORWA"
      },
      chainB: {
        balance: chainBBalance,
        tokenSymbol: "ORWA"
      },
      totalBalance: (parseFloat(chainABalance) + parseFloat(chainBBalance)).toString()
    });
  } catch (error) {
    console.error("Error getting asset status:", error);
    res.status(500).json({ error: "Failed to get asset status", details: error.message });
  }
});

// Get contract addresses
app.get("/api/contracts", (req, res) => {
  res.json({
    chainA: chainAContracts,
    chainB: chainBContracts
  });
});

// Start server
async function startServer() {
  loadDeploymentFiles();
  initializeProviders();
  
  // Wait a bit for contracts to be deployed
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await setupRelayer();
  startEventListener();
  
  app.listen(PORT, () => {
    console.log(`\n=== OmniRWA Backend Server ===`);
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Chain A RPC: ${CHAIN_A_RPC}`);
    console.log(`Chain B RPC: ${CHAIN_B_RPC}`);
    console.log(`Bridge Delay: ${BRIDGE_DELAY}ms`);
    console.log(`===============================\n`);
  });
}

startServer().catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

module.exports = app;
