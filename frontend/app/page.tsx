"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Wallet, Shield, ArrowRightLeft, Activity, CheckCircle,
  XCircle, Send, Loader2, ArrowUpDown, History, BarChart3,
  TrendingUp, Layers, Coins, RefreshCw, TrendingDown, Clock,
  Zap, Trophy, AlertTriangle,
} from "lucide-react";
import { ethers } from "ethers";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ContractAddresses {
  identityRegistry: string;
  complianceModule: string;
  token: string;
  router: string;
}

interface ContractsResponse {
  chainA: ContractAddresses;
  chainB: ContractAddresses;
}

interface AssetStatus {
  walletAddress: string;
  chainA: { balance: string; tokenSymbol: string };
  chainB: { balance: string; tokenSymbol: string };
  totalBalance: string;
}

interface BridgeActivity {
  id: number;
  step: string;
  status: "pending" | "success" | "error";
  timestamp: Date;
}

interface Transfer {
  id: string;
  txHash: string;
  sender: string;
  receiver: string;
  amount: string;
  fee: string;
  sourceChain: string;
  destChain: string;
  status: "pending" | "completed" | "failed";
  initiatedAt: number;
  completedAt: number | null;
}

interface ProtocolStats {
  tvl: string;
  tvlChainA: string;
  tvlChainB: string;
  totalTransfers: number;
  totalFeesCollected: string;
  feeBasisPoints: string;
  pendingTransfers: number;
  completedTransfers: number;
  failedTransfers: number;
}

// ── Futures types ─────────────────────────────────────────────────────────────
interface FuturesOrder {
  id: number;
  creator: string;
  counterparty: string;
  side: "LONG" | "SHORT";
  strikePrice: string;
  amount: string;
  expiry: number;          // unix ms
  status: "OPEN" | "FILLED" | "SETTLED" | "CANCELLED";
  createdAt: number;
  filledAt: number;
  settledAt: number;
  winner: string;
}

interface FuturesStats {
  chain: string;
  totalOrders: number;
  oraclePrice: string;
  feeBps: number;
  totalFeesCollected: string;
  openOrders: number;
  filledOrders: number;
  settledOrders: number;
  cancelledOrders: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const shortAddr = (addr: string) =>
  addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";

const chainLabel = (key: string) =>
  key === "chainA" ? "Chain A (Ethereum)" : "Chain B (Avalanche)";

const statusColor: Record<string, string> = {
  completed: "text-emerald-400",
  pending:   "text-yellow-400",
  failed:    "text-red-400",
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function Home() {
  const [walletAddress, setWalletAddress]   = useState<string>("");
  const [isConnected, setIsConnected]       = useState<boolean>(false);
  const [kycStatusChainA, setKycStatusChainA] = useState<boolean>(false);
  const [kycStatusChainB, setKycStatusChainB] = useState<boolean>(false);
  const [assetStatus, setAssetStatus]       = useState<AssetStatus | null>(null);
  const [contracts, setContracts]           = useState<ContractsResponse | null>(null);
  const [bridgeAmount, setBridgeAmount]     = useState<string>("");
  const [bridgeRecipient, setBridgeRecipient] = useState<string>("");
  const [sourceChain, setSourceChain]       = useState<string>("chainA");
  const [destinationChain, setDestinationChain] = useState<string>("chainB");
  const [activities, setActivities]         = useState<BridgeActivity[]>([]);
  const [isLoading, setIsLoading]           = useState<boolean>(false);

  // ── New state ──────────────────────────────────────────────────────────────
  const [transferHistory, setTransferHistory] = useState<Transfer[]>([]);
  const [historyLoading, setHistoryLoading]   = useState<boolean>(false);
  const [stats, setStats]                     = useState<ProtocolStats | null>(null);
  const [statsLoading, setStatsLoading]       = useState<boolean>(false);
  const [showHistory, setShowHistory]         = useState<boolean>(false);

  // ── Futures state ──────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]             = useState<"bridge" | "futures">("bridge");
  const [futuresOrders, setFuturesOrders]     = useState<FuturesOrder[]>([]);
  const [futuresStats, setFuturesStats]       = useState<FuturesStats | null>(null);
  const [futuresLoading, setFuturesLoading]   = useState<boolean>(false);
  const [futuresChain, setFuturesChain]       = useState<string>("chainA");

  // Create order form
  const [fSide, setFSide]           = useState<"LONG" | "SHORT">("LONG");
  const [fAmount, setFAmount]       = useState<string>("");
  const [fStrike, setFStrike]       = useState<string>("");
  const [fExpiry, setFExpiry]       = useState<string>(""); // datetime-local string
  const [fCreating, setFCreating]   = useState<boolean>(false);
  const [fTxStatus, setFTxStatus]   = useState<string>("");

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

  // ── Wallet ─────────────────────────────────────────────────────────────────
  const connectWallet = async () => {
    try {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        setWalletAddress(accounts[0]);
        setIsConnected(true);
        await Promise.all([
          fetchKYCStatus(accounts[0]),
          fetchAssetStatus(accounts[0]),
          fetchTransferHistory(accounts[0]),
        ]);
      } else {
        alert("Please install MetaMask to use this application");
      }
    } catch (error) {
      console.error("Error connecting wallet:", error);
      alert("Failed to connect wallet");
    }
  };

  const disconnectWallet = () => {
    setWalletAddress("");
    setIsConnected(false);
    setKycStatusChainA(false);
    setKycStatusChainB(false);
    setAssetStatus(null);
    setActivities([]);
    setTransferHistory([]);
  };

  // ── KYC ───────────────────────────────────────────────────────────────────
  const fetchKYCStatus = async (address: string) => {
    try {
      const [resA, resB] = await Promise.all([
        fetch(`${API_URL}/api/kyc/status?walletAddress=${address}&chain=chainA`),
        fetch(`${API_URL}/api/kyc/status?walletAddress=${address}&chain=chainB`),
      ]);
      const dataA = await resA.json();
      const dataB = await resB.json();
      setKycStatusChainA(dataA.isVerified);
      setKycStatusChainB(dataB.isVerified);
    } catch (error) {
      console.error("Error fetching KYC status:", error);
    }
  };

  const submitKYC = async (chain: string) => {
    if (!walletAddress) return;
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/kyc/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, chain }),
      });
      const data = await response.json();
      if (data.success) {
        await fetchKYCStatus(walletAddress);
        alert(`KYC registration successful on ${chain === "chainA" ? "Chain A" : "Chain B"}!`);
      } else {
        alert("Failed to register KYC");
      }
    } catch (error) {
      console.error("Error submitting KYC:", error);
      alert("Failed to submit KYC");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Assets ────────────────────────────────────────────────────────────────
  const fetchAssetStatus = async (address: string) => {
    try {
      const response = await fetch(`${API_URL}/api/assets/status?walletAddress=${address}`);
      const data = await response.json();
      setAssetStatus(data);
    } catch (error) {
      console.error("Error fetching asset status:", error);
    }
  };

  // ── Max Amount button ─────────────────────────────────────────────────────
  const fillMaxAmount = () => {
    if (!assetStatus) return;
    const balance =
      sourceChain === "chainA"
        ? assetStatus.chainA.balance
        : assetStatus.chainB.balance;
    setBridgeAmount(parseFloat(balance).toString());
  };

  // ── Chain swap button ─────────────────────────────────────────────────────
  const swapChains = () => {
    setSourceChain(destinationChain);
    setDestinationChain(sourceChain);
  };

  // ── Transfer History ──────────────────────────────────────────────────────
  const fetchTransferHistory = useCallback(async (address?: string) => {
    setHistoryLoading(true);
    try {
      const addr = address || walletAddress;
      const url = addr
        ? `${API_URL}/api/transfer/history?walletAddress=${addr}&limit=20`
        : `${API_URL}/api/transfer/history?limit=20`;
      const res = await fetch(url);
      const data = await res.json();
      setTransferHistory(data.transfers || []);
    } catch (error) {
      console.error("Error fetching transfer history:", error);
    } finally {
      setHistoryLoading(false);
    }
  }, [API_URL, walletAddress]);

  // ── Protocol Stats ────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/stats`);
      const data = await res.json();
      setStats(data);
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setStatsLoading(false);
    }
  }, [API_URL]);

  // ── Futures: fetch order list ─────────────────────────────────────────────
  const fetchFutures = useCallback(async (chain?: string) => {
    setFuturesLoading(true);
    try {
      const c = chain || futuresChain;
      const res = await fetch(`${API_URL}/api/futures?chain=${c}&limit=50`);
      const data = await res.json();
      setFuturesOrders(data.orders || []);
    } catch (err) {
      console.error("Error fetching futures:", err);
    } finally {
      setFuturesLoading(false);
    }
  }, [API_URL, futuresChain]);

  // ── Futures: fetch stats ──────────────────────────────────────────────────
  const fetchFuturesStats = useCallback(async (chain?: string) => {
    try {
      const c = chain || futuresChain;
      const res = await fetch(`${API_URL}/api/futures/stats?chain=${c}`);
      const data = await res.json();
      setFuturesStats(data);
    } catch (err) {
      console.error("Error fetching futures stats:", err);
    }
  }, [API_URL, futuresChain]);

  // ── Futures: create order ─────────────────────────────────────────────────
  const createFuturesOrder = async () => {
    if (!walletAddress) { alert("Connect your wallet first"); return; }
    if (!fAmount || !fStrike || !fExpiry) { alert("Fill in all futures fields"); return; }

    const amount    = parseFloat(fAmount);
    const strike    = parseFloat(fStrike);
    const expiryTs  = Math.floor(new Date(fExpiry).getTime() / 1000);
    const now       = Math.floor(Date.now() / 1000);

    if (isNaN(amount) || amount <= 0)   { alert("Enter a valid amount"); return; }
    if (isNaN(strike) || strike <= 0)   { alert("Enter a valid strike price"); return; }
    if (expiryTs <= now)                 { alert("Expiry must be in the future"); return; }

    setFCreating(true);
    setFTxStatus("Approving ORWA collateral…");
    try {
      const contractsRes = await fetch(`${API_URL}/api/contracts`);
      const contractsData = await contractsRes.json();
      const chain = futuresChain === "chainA" ? contractsData.chainA : contractsData.chainB;

      if (!chain.futures) throw new Error("Futures contract not deployed — deploy first");
      if (!chain.token)   throw new Error("Token contract not available");

      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer   = await provider.getSigner();

      // 1. Approve the futures contract to spend ORWA
      const tokenABI   = ["function approve(address spender, uint256 amount) external returns (bool)"];
      const tokenC     = new ethers.Contract(chain.token, tokenABI, signer);
      const amountWei  = ethers.parseEther(fAmount);
      const approveTx  = await tokenC.approve(chain.futures, amountWei);
      await approveTx.wait();

      setFTxStatus("Creating futures order…");

      // 2. Create the order
      const futuresABI = [
        "function createOrder(uint256 strikePrice, uint256 amount, uint256 expiry, uint8 side) external returns (uint256)"
      ];
      const futuresC   = new ethers.Contract(chain.futures, futuresABI, signer);
      const strikeWei  = ethers.parseEther(fStrike);
      const sideUint   = fSide === "LONG" ? 0 : 1;
      const tx         = await futuresC.createOrder(strikeWei, amountWei, expiryTs, sideUint);
      await tx.wait();

      setFTxStatus("✅ Order created!");
      setFAmount("");
      setFStrike("");
      setFExpiry("");
      await Promise.all([fetchFutures(), fetchFuturesStats()]);
    } catch (err: any) {
      console.error("Error creating futures order:", err);
      setFTxStatus(`❌ ${err.message || "Transaction failed"}`);
    } finally {
      setFCreating(false);
      setTimeout(() => setFTxStatus(""), 6000);
    }
  };

  // ── Futures: fill order ───────────────────────────────────────────────────
  const fillFuturesOrder = async (orderId: number, amount: string) => {
    if (!walletAddress) { alert("Connect your wallet first"); return; }
    try {
      const contractsRes  = await fetch(`${API_URL}/api/contracts`);
      const contractsData = await contractsRes.json();
      const chain         = futuresChain === "chainA" ? contractsData.chainA : contractsData.chainB;
      if (!chain.futures) throw new Error("Futures contract not deployed");

      const provider  = new ethers.BrowserProvider((window as any).ethereum);
      const signer    = await provider.getSigner();
      const amountWei = ethers.parseEther(amount);

      // Approve collateral
      const tokenABI  = ["function approve(address spender, uint256 amount) external returns (bool)"];
      const tokenC    = new ethers.Contract(chain.token, tokenABI, signer);
      await (await tokenC.approve(chain.futures, amountWei)).wait();

      // Fill order
      const futuresABI = ["function fillOrder(uint256 orderId) external"];
      const futuresC   = new ethers.Contract(chain.futures, futuresABI, signer);
      await (await futuresC.fillOrder(orderId)).wait();

      alert(`Order #${orderId} filled!`);
      await Promise.all([fetchFutures(), fetchFuturesStats()]);
    } catch (err: any) {
      console.error("Error filling order:", err);
      alert(err.message || "Failed to fill order");
    }
  };

  // ── Futures: settle order ─────────────────────────────────────────────────
  const settleFuturesOrder = async (orderId: number) => {
    if (!walletAddress) { alert("Connect your wallet first"); return; }
    try {
      const contractsRes  = await fetch(`${API_URL}/api/contracts`);
      const contractsData = await contractsRes.json();
      const chain         = futuresChain === "chainA" ? contractsData.chainA : contractsData.chainB;
      if (!chain.futures) throw new Error("Futures contract not deployed");

      const provider  = new ethers.BrowserProvider((window as any).ethereum);
      const signer    = await provider.getSigner();
      const futuresABI = ["function settle(uint256 orderId) external"];
      const futuresC   = new ethers.Contract(chain.futures, futuresABI, signer);
      await (await futuresC.settle(orderId)).wait();

      alert(`Order #${orderId} settled!`);
      await Promise.all([fetchFutures(), fetchFuturesStats()]);
    } catch (err: any) {
      console.error("Error settling order:", err);
      alert(err.message || "Failed to settle order");
    }
  };

  // ── Futures: cancel order ─────────────────────────────────────────────────
  const cancelFuturesOrder = async (orderId: number) => {
    if (!walletAddress) { alert("Connect your wallet first"); return; }
    try {
      const contractsRes  = await fetch(`${API_URL}/api/contracts`);
      const contractsData = await contractsRes.json();
      const chain         = futuresChain === "chainA" ? contractsData.chainA : contractsData.chainB;
      if (!chain.futures) throw new Error("Futures contract not deployed");

      const provider  = new ethers.BrowserProvider((window as any).ethereum);
      const signer    = await provider.getSigner();
      const futuresABI = ["function cancelOrder(uint256 orderId) external"];
      const futuresC   = new ethers.Contract(chain.futures, futuresABI, signer);
      await (await futuresC.cancelOrder(orderId)).wait();

      alert(`Order #${orderId} cancelled.`);
      await Promise.all([fetchFutures(), fetchFuturesStats()]);
    } catch (err: any) {
      console.error("Error cancelling order:", err);
      alert(err.message || "Failed to cancel order");
    }
  };

  // ── Bridge ────────────────────────────────────────────────────────────────
  const initiateBridge = async () => {
    if (!walletAddress || !bridgeAmount || !bridgeRecipient) {
      alert("Please fill in all fields");
      return;
    }
    const amount = parseFloat(bridgeAmount);
    if (isNaN(amount) || amount <= 0) { alert("Please enter a valid amount"); return; }
    if (!ethers.isAddress(bridgeRecipient)) { alert("Please enter a valid recipient address"); return; }

    const destChainKYC = destinationChain === "chainA" ? kycStatusChainA : kycStatusChainB;
    if (!destChainKYC) {
      alert(`Recipient must be KYC verified on ${destinationChain === "chainA" ? "Chain A" : "Chain B"}`);
      return;
    }

    setIsLoading(true);
    const activityId = Date.now();
    setActivities(prev => [...prev, { id: activityId, step: "Initiating Local Burn...", status: "pending", timestamp: new Date() }]);

    try {
      const contractsResponse = await fetch(`${API_URL}/api/contracts`);
      const contractsData = await contractsResponse.json();
      const sourceContracts = sourceChain === "chainA" ? contractsData.chainA : contractsData.chainB;
      const routerAddress = sourceContracts.router;
      if (!routerAddress) throw new Error("Router contract not available");

      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const routerABI = ["function initiateCrossChainTransfer(uint32 destChainId, address receiver, uint256 amount) external"];
      const router = new ethers.Contract(routerAddress, routerABI, signer);
      const destChainId = destinationChain === "chainA" ? 1 : 43114;
      const amountWei = ethers.parseEther(bridgeAmount);

      setActivities(prev => prev.map(a =>
        a.id === activityId ? { ...a, status: "success" } : a
      ));
      setActivities(prev => [...prev, { id: activityId + 1, step: "Securing Cross-Chain Compliance Check...", status: "pending", timestamp: new Date() }]);

      const tx = await router.initiateCrossChainTransfer(destChainId, bridgeRecipient, amountWei);
      await tx.wait();

      setActivities(prev => prev.map(a =>
        a.id === activityId + 1 ? { ...a, status: "success" } : a
      ));
      setActivities(prev => [...prev, { id: activityId + 2, step: "Successful Destination Mint!", status: "pending", timestamp: new Date() }]);

      await new Promise(resolve => setTimeout(resolve, 6000));

      setActivities(prev => prev.map(a =>
        a.id === activityId + 2 ? { ...a, status: "success" } : a
      ));

      await Promise.all([
        fetchAssetStatus(walletAddress),
        fetchTransferHistory(walletAddress),
        fetchStats(),
      ]);
      setBridgeAmount("");
      setBridgeRecipient("");
      alert("Bridge transfer completed successfully!");
    } catch (error) {
      console.error("Error initiating bridge:", error);
      setActivities(prev => prev.map(a =>
        a.status === "pending" ? { ...a, status: "error" } : a
      ));
      alert("Failed to initiate bridge transfer");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch(`${API_URL}/api/contracts`);
        setContracts(await res.json());
      } catch {}
      fetchStats();
      fetchFutures();
      fetchFuturesStats();
    };
    init();
  }, []);

  // Auto-refresh stats every 30 s
  useEffect(() => {
    const id = setInterval(() => { fetchStats(); fetchFutures(); fetchFuturesStats(); }, 30_000);
    return () => clearInterval(id);
  }, [fetchStats, fetchFutures, fetchFuturesStats]);

  // Reload futures when chain changes
  useEffect(() => {
    fetchFutures(futuresChain);
    fetchFuturesStats(futuresChain);
  }, [futuresChain]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                OmniRWA
              </h1>
              <p className="text-gray-400 mt-1">Cross-Chain RWA Protocol</p>
            </div>
            <button
              onClick={isConnected ? disconnectWallet : connectWallet}
              className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover rounded-lg font-semibold transition-all pulse-glow"
            >
              <Wallet className="w-5 h-5" />
              {isConnected ? shortAddr(walletAddress) : "Connect Wallet"}
            </button>
          </div>
        </header>

        {/* ── Protocol Stats Bar ──────────────────────────────────────────── */}
        <section className="glass rounded-xl p-5 fade-in">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-accent" />
              Protocol Stats
            </h2>
            <button
              onClick={fetchStats}
              disabled={statsLoading}
              className="p-1.5 rounded-lg hover:bg-secondary transition-all"
              title="Refresh stats"
            >
              <RefreshCw className={`w-4 h-4 text-gray-400 ${statsLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          {stats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <StatCard icon={<Layers className="w-4 h-4 text-blue-400" />}  label="TVL" value={`${parseFloat(stats.tvl).toLocaleString()} ORWA`} />
              <StatCard icon={<Layers className="w-4 h-4 text-indigo-400" />} label="TVL Chain A" value={`${parseFloat(stats.tvlChainA).toLocaleString()} ORWA`} />
              <StatCard icon={<Layers className="w-4 h-4 text-purple-400" />} label="TVL Chain B" value={`${parseFloat(stats.tvlChainB).toLocaleString()} ORWA`} />
              <StatCard icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} label="Total Transfers" value={stats.totalTransfers.toString()} />
              <StatCard icon={<Coins className="w-4 h-4 text-yellow-400" />} label="Fees Collected" value={`${parseFloat(stats.totalFeesCollected).toFixed(4)} ORWA`} />
              <StatCard icon={<Activity className="w-4 h-4 text-orange-400" />} label="Pending" value={stats.pendingTransfers.toString()} />
              <StatCard icon={<CheckCircle className="w-4 h-4 text-emerald-400" />} label="Completed" value={stats.completedTransfers.toString()} />
            </div>
          ) : (
            <p className="text-gray-400 text-sm">Loading stats…</p>
          )}
        </section>

        {isConnected ? (
          <div className="space-y-6 fade-in">

            {/* ── Tab switcher ───────────────────────────────────────── */}
            <div className="flex gap-2 border-b border-gray-700 pb-1">
              <button
                onClick={() => setActiveTab("bridge")}
                className={`px-5 py-2 rounded-t-lg font-semibold text-sm transition-all ${
                  activeTab === "bridge"
                    ? "bg-primary text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                <ArrowRightLeft className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Bridge
              </button>
              <button
                onClick={() => setActiveTab("futures")}
                className={`px-5 py-2 rounded-t-lg font-semibold text-sm transition-all ${
                  activeTab === "futures"
                    ? "bg-accent text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                <Zap className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Futures
              </button>
            </div>
            {/* ── KYC Cards ─────────────────────────────────────────────── */}
            {activeTab === "bridge" && (<>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">              {(["chainA", "chainB"] as const).map((chain) => {
                const verified = chain === "chainA" ? kycStatusChainA : kycStatusChainB;
                return (
                  <div key={chain} className="glass rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-semibold flex items-center gap-2">
                        <Shield className={`w-5 h-5 ${chain === "chainA" ? "text-primary" : "text-accent"}`} />
                        {chainLabel(chain)}
                      </h2>
                      {verified
                        ? <CheckCircle className="w-6 h-6 text-success" />
                        : <XCircle    className="w-6 h-6 text-danger" />}
                    </div>
                    <p className="text-gray-400 mb-4">
                      Status: {verified ? "Verified" : "Not Verified"}
                    </p>
                    {!verified && (
                      <button
                        onClick={() => submitKYC(chain)}
                        disabled={isLoading}
                        className={`w-full px-4 py-2 ${chain === "chainA" ? "bg-primary hover:bg-primary-hover" : "bg-accent hover:bg-purple-600"} rounded-lg font-semibold transition-all disabled:opacity-50`}
                      >
                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Submit KYC"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Asset Overview ────────────────────────────────────────── */}
            <div className="glass rounded-xl p-6">
              <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Multi-Chain Asset Overview
              </h2>
              {assetStatus ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-secondary rounded-lg p-4">
                    <p className="text-gray-400 text-sm mb-2">Chain A Balance</p>
                    <p className="text-2xl font-bold">{parseFloat(assetStatus.chainA.balance).toFixed(2)} ORWA</p>
                  </div>
                  <div className="bg-secondary rounded-lg p-4">
                    <p className="text-gray-400 text-sm mb-2">Chain B Balance</p>
                    <p className="text-2xl font-bold">{parseFloat(assetStatus.chainB.balance).toFixed(2)} ORWA</p>
                  </div>
                  <div className="bg-gradient-to-r from-primary to-accent rounded-lg p-4">
                    <p className="text-white/80 text-sm mb-2">Total Balance</p>
                    <p className="text-2xl font-bold text-white">{parseFloat(assetStatus.totalBalance).toFixed(2)} ORWA</p>
                  </div>
                </div>
              ) : (
                <p className="text-gray-400">Loading asset status…</p>
              )}
            </div>

            {/* ── Bridge Portal ─────────────────────────────────────────── */}
            <div className="glass rounded-xl p-6">
              <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-accent" />
                Bridge Portal
              </h2>

              {/* Chain selectors + swap button */}
              <div className="flex flex-col md:flex-row items-stretch md:items-end gap-3 mb-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-2">Source Chain</label>
                  <select
                    value={sourceChain}
                    onChange={(e) => setSourceChain(e.target.value)}
                    className="w-full px-4 py-3 bg-secondary rounded-lg border border-gray-700 focus:border-primary focus:outline-none"
                  >
                    <option value="chainA">Chain A (Ethereum)</option>
                    <option value="chainB">Chain B (Avalanche)</option>
                  </select>
                </div>

                {/* ── Chain swap button ────────────────────────────────── */}
                <button
                  onClick={swapChains}
                  title="Swap source and destination"
                  className="flex items-center justify-center w-12 h-12 self-end bg-secondary hover:bg-primary rounded-lg border border-gray-700 transition-all group"
                >
                  <ArrowUpDown className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors" />
                </button>

                <div className="flex-1">
                  <label className="block text-sm font-medium mb-2">Destination Chain</label>
                  <select
                    value={destinationChain}
                    onChange={(e) => setDestinationChain(e.target.value)}
                    className="w-full px-4 py-3 bg-secondary rounded-lg border border-gray-700 focus:border-primary focus:outline-none"
                  >
                    <option value="chainA">Chain A (Ethereum)</option>
                    <option value="chainB">Chain B (Avalanche)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Amount + Max button */}
                <div>
                  <label className="block text-sm font-medium mb-2">Amount (ORWA)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={bridgeAmount}
                      onChange={(e) => setBridgeAmount(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 px-4 py-3 bg-secondary rounded-lg border border-gray-700 focus:border-primary focus:outline-none"
                    />
                    {/* ── Max Amount button ─────────────────────────────── */}
                    <button
                      onClick={fillMaxAmount}
                      disabled={!assetStatus}
                      title={`Fill max balance from ${chainLabel(sourceChain)}`}
                      className="px-4 py-3 bg-secondary hover:bg-primary rounded-lg border border-gray-700 text-sm font-semibold text-gray-300 hover:text-white transition-all disabled:opacity-40"
                    >
                      MAX
                    </button>
                  </div>
                  {assetStatus && (
                    <p className="text-xs text-gray-500 mt-1">
                      Available: {parseFloat(sourceChain === "chainA" ? assetStatus.chainA.balance : assetStatus.chainB.balance).toFixed(4)} ORWA
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Recipient Address</label>
                  <input
                    type="text"
                    value={bridgeRecipient}
                    onChange={(e) => setBridgeRecipient(e.target.value)}
                    placeholder="0x…"
                    className="w-full px-4 py-3 bg-secondary rounded-lg border border-gray-700 focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              <button
                onClick={initiateBridge}
                disabled={isLoading}
                className="mt-6 w-full px-6 py-3 bg-gradient-to-r from-primary to-accent hover:from-primary-hover hover:to-purple-600 rounded-lg font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading
                  ? <Loader2 className="w-5 h-5 animate-spin" />
                  : <><Send className="w-5 h-5" /> Initiate Cross-Chain Compliance Transfer</>}
              </button>
            </div>

            {/* ── Activity Feed ─────────────────────────────────────────── */}
            {activities.length > 0 && (
              <div className="glass rounded-xl p-6">
                <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-primary" />
                  Activity Feed
                </h2>
                <div className="space-y-3">
                  {activities.map((activity) => (
                    <div
                      key={activity.id}
                      className={`flex items-center gap-4 p-4 rounded-lg ${
                        activity.status === "success" ? "bg-success/10 border border-success/20"
                        : activity.status === "error"  ? "bg-danger/10 border border-danger/20"
                        : "bg-secondary"
                      }`}
                    >
                      {activity.status === "pending" && <Loader2 className="w-5 h-5 text-primary animate-spin" />}
                      {activity.status === "success" && <CheckCircle className="w-5 h-5 text-success" />}
                      {activity.status === "error"   && <XCircle    className="w-5 h-5 text-danger" />}
                      <div className="flex-1">
                        <p className="font-medium">{activity.step}</p>
                        <p className="text-sm text-gray-400">{activity.timestamp.toLocaleTimeString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Transaction History Panel ─────────────────────────────── */}
            <div className="glass rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <History className="w-5 h-5 text-primary" />
                  Transaction History
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchTransferHistory(walletAddress)}
                    disabled={historyLoading}
                    className="p-1.5 rounded-lg hover:bg-secondary transition-all"
                    title="Refresh"
                  >
                    <RefreshCw className={`w-4 h-4 text-gray-400 ${historyLoading ? "animate-spin" : ""}`} />
                  </button>
                  <button
                    onClick={() => setShowHistory(v => !v)}
                    className="text-sm text-gray-400 hover:text-white transition-colors px-2 py-1 rounded"
                  >
                    {showHistory ? "Collapse ▲" : "Expand ▼"}
                  </button>
                </div>
              </div>

              {showHistory && (
                historyLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : transferHistory.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-8">No bridge transfers found for your wallet yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-700">
                          <th className="text-left py-2 pr-4">Time</th>
                          <th className="text-left py-2 pr-4">From</th>
                          <th className="text-left py-2 pr-4">To</th>
                          <th className="text-left py-2 pr-4">Amount</th>
                          <th className="text-left py-2 pr-4">Route</th>
                          <th className="text-left py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transferHistory.map((tx) => (
                          <tr key={tx.id} className="border-b border-gray-800 hover:bg-secondary/40 transition-colors">
                            <td className="py-3 pr-4 text-gray-400">
                              {new Date(tx.initiatedAt).toLocaleString()}
                            </td>
                            <td className="py-3 pr-4 font-mono">{shortAddr(tx.sender)}</td>
                            <td className="py-3 pr-4 font-mono">{shortAddr(tx.receiver)}</td>
                            <td className="py-3 pr-4 font-semibold">
                              {parseFloat(tx.amount).toFixed(4)} ORWA
                            </td>
                            <td className="py-3 pr-4 text-gray-400">
                              {tx.sourceChain === "chainA" ? "A" : "B"} → {tx.destChain === "chainA" ? "A" : "B"}
                            </td>
                            <td className={`py-3 font-semibold capitalize ${statusColor[tx.status] || "text-gray-400"}`}>
                              {tx.status}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {/* Summary row even when collapsed */}
              {!showHistory && (
                <p className="text-sm text-gray-400">
                  {transferHistory.length} transfers recorded.{" "}
                  <button onClick={() => setShowHistory(true)} className="text-primary hover:underline">Show all</button>
                </p>
              )}
            </div>
            {/* ── End bridge tab ─────────────────────────────────────────── */}
            </>)}

            {/* ══════════════════════════════════════════════════════════════
                FUTURES TAB
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === "futures" && (
              <div className="space-y-6">

                {/* ── Futures Stats bar ─────────────────────────────────── */}
                {futuresStats && (
                  <div className="glass rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-accent" /> Futures Protocol Stats
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                      <StatCard icon={<Zap      className="w-4 h-4 text-yellow-400" />} label="Oracle Price" value={`$${parseFloat(futuresStats.oraclePrice).toFixed(4)}`} />
                      <StatCard icon={<Layers   className="w-4 h-4 text-blue-400"  />} label="Total Orders"  value={futuresStats.totalOrders.toString()} />
                      <StatCard icon={<Clock    className="w-4 h-4 text-green-400" />} label="Open"          value={futuresStats.openOrders.toString()} />
                      <StatCard icon={<Activity className="w-4 h-4 text-orange-400"/>} label="Filled"        value={futuresStats.filledOrders.toString()} />
                      <StatCard icon={<Trophy   className="w-4 h-4 text-emerald-400"/>} label="Settled"      value={futuresStats.settledOrders.toString()} />
                      <StatCard icon={<XCircle  className="w-4 h-4 text-red-400"   />} label="Cancelled"     value={futuresStats.cancelledOrders.toString()} />
                      <StatCard icon={<Coins    className="w-4 h-4 text-yellow-500"/>} label="Fees Collected" value={`${parseFloat(futuresStats.totalFeesCollected).toFixed(4)} ORWA`} />
                      <StatCard icon={<TrendingUp className="w-4 h-4 text-purple-400"/>} label="Fee Rate"    value={`${futuresStats.feeBps / 100}%`} />
                    </div>
                  </div>
                )}

                {/* ── Create Order Form ─────────────────────────────────── */}
                <div className="glass rounded-xl p-6">
                  <h2 className="text-xl font-semibold mb-5 flex items-center gap-2">
                    <Zap className="w-5 h-5 text-accent" />
                    Open Futures Position
                  </h2>

                  {/* Chain selector */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium mb-2">Chain</label>
                    <select
                      value={futuresChain}
                      onChange={(e) => setFuturesChain(e.target.value)}
                      className="w-full md:w-64 px-4 py-2.5 bg-secondary rounded-lg border border-gray-700 focus:border-accent focus:outline-none"
                    >
                      <option value="chainA">Chain A (Ethereum)</option>
                      <option value="chainB">Chain B (Avalanche)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

                    {/* Side */}
                    <div>
                      <label className="block text-sm font-medium mb-2">Position</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setFSide("LONG")}
                          className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all border ${
                            fSide === "LONG"
                              ? "bg-emerald-600 border-emerald-500 text-white"
                              : "bg-secondary border-gray-700 text-gray-400 hover:border-emerald-500"
                          }`}
                        >
                          <TrendingUp className="w-4 h-4 inline mr-1" />
                          LONG
                        </button>
                        <button
                          onClick={() => setFSide("SHORT")}
                          className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all border ${
                            fSide === "SHORT"
                              ? "bg-red-600 border-red-500 text-white"
                              : "bg-secondary border-gray-700 text-gray-400 hover:border-red-500"
                          }`}
                        >
                          <TrendingDown className="w-4 h-4 inline mr-1" />
                          SHORT
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {fSide === "LONG"
                          ? "Win if price ≥ strike at expiry"
                          : "Win if price < strike at expiry"}
                      </p>
                    </div>

                    {/* Collateral Amount */}
                    <div>
                      <label className="block text-sm font-medium mb-2">Collateral (ORWA)</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={fAmount}
                        onChange={(e) => setFAmount(e.target.value)}
                        placeholder="e.g. 100"
                        className="w-full px-4 py-2.5 bg-secondary rounded-lg border border-gray-700 focus:border-accent focus:outline-none"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Both parties lock this amount
                      </p>
                    </div>

                    {/* Strike Price */}
                    <div>
                      <label className="block text-sm font-medium mb-2">Strike Price (USD)</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={fStrike}
                        onChange={(e) => setFStrike(e.target.value)}
                        placeholder={futuresStats ? `Oracle: $${parseFloat(futuresStats.oraclePrice).toFixed(4)}` : "e.g. 1.25"}
                        className="w-full px-4 py-2.5 bg-secondary rounded-lg border border-gray-700 focus:border-accent focus:outline-none"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Price target in 18-decimal USD
                      </p>
                    </div>

                    {/* Expiry */}
                    <div>
                      <label className="block text-sm font-medium mb-2">Expiry Date &amp; Time</label>
                      <input
                        type="datetime-local"
                        value={fExpiry}
                        onChange={(e) => setFExpiry(e.target.value)}
                        min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                        className="w-full px-4 py-2.5 bg-secondary rounded-lg border border-gray-700 focus:border-accent focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Status / error line */}
                  {fTxStatus && (
                    <p className={`mt-3 text-sm font-medium ${fTxStatus.startsWith("✅") ? "text-emerald-400" : fTxStatus.startsWith("❌") ? "text-red-400" : "text-yellow-400"}`}>
                      {fTxStatus}
                    </p>
                  )}

                  <button
                    onClick={createFuturesOrder}
                    disabled={fCreating}
                    className="mt-5 px-8 py-3 bg-gradient-to-r from-accent to-purple-600 hover:from-purple-600 hover:to-accent rounded-lg font-semibold transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {fCreating
                      ? <><Loader2 className="w-5 h-5 animate-spin" /> Processing…</>
                      : <><Zap className="w-5 h-5" /> Open Position</>}
                  </button>
                </div>

                {/* ── Order Book ────────────────────────────────────────── */}
                <div className="glass rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                      <History className="w-5 h-5 text-accent" />
                      Futures Order Book
                    </h2>
                    <button
                      onClick={() => fetchFutures()}
                      disabled={futuresLoading}
                      className="p-1.5 rounded-lg hover:bg-secondary transition-all"
                      title="Refresh"
                    >
                      <RefreshCw className={`w-4 h-4 text-gray-400 ${futuresLoading ? "animate-spin" : ""}`} />
                    </button>
                  </div>

                  {futuresLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-accent" />
                    </div>
                  ) : futuresOrders.length === 0 ? (
                    <div className="text-center py-12">
                      <Zap className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                      <p className="text-gray-400">No futures orders yet.</p>
                      <p className="text-gray-500 text-sm mt-1">Be the first to open a position!</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-700">
                            <th className="text-left py-2 pr-3">#</th>
                            <th className="text-left py-2 pr-3">Creator</th>
                            <th className="text-left py-2 pr-3">Side</th>
                            <th className="text-left py-2 pr-3">Strike</th>
                            <th className="text-left py-2 pr-3">Collateral</th>
                            <th className="text-left py-2 pr-3">Expiry</th>
                            <th className="text-left py-2 pr-3">Status</th>
                            <th className="text-left py-2">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {futuresOrders.map((order) => {
                            const expired = Date.now() >= order.expiry;
                            const isCreator      = walletAddress.toLowerCase() === order.creator.toLowerCase();
                            const isCounterparty = walletAddress.toLowerCase() === order.counterparty.toLowerCase();
                            const canFill    = order.status === "OPEN" && !isCreator && !expired;
                            const canSettle  = order.status === "FILLED" && expired;
                            const canCancel  = (order.status === "OPEN" && isCreator) ||
                                               (order.status === "FILLED" && expired && (isCreator || isCounterparty));
                            return (
                              <tr key={order.id} className="border-b border-gray-800 hover:bg-secondary/40 transition-colors">
                                <td className="py-3 pr-3 font-mono text-gray-400">#{order.id}</td>
                                <td className="py-3 pr-3 font-mono">{shortAddr(order.creator)}</td>
                                <td className="py-3 pr-3">
                                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                    order.side === "LONG"
                                      ? "bg-emerald-900/60 text-emerald-400"
                                      : "bg-red-900/60 text-red-400"
                                  }`}>
                                    {order.side === "LONG"
                                      ? <><TrendingUp className="w-3 h-3 inline mr-0.5" />LONG</>
                                      : <><TrendingDown className="w-3 h-3 inline mr-0.5" />SHORT</>}
                                  </span>
                                </td>
                                <td className="py-3 pr-3 font-semibold">
                                  ${parseFloat(order.strikePrice).toFixed(4)}
                                </td>
                                <td className="py-3 pr-3">
                                  {parseFloat(order.amount).toFixed(2)} ORWA
                                </td>
                                <td className="py-3 pr-3 text-xs text-gray-400">
                                  {new Date(order.expiry).toLocaleString()}
                                  {expired && order.status !== "SETTLED" && order.status !== "CANCELLED" && (
                                    <span className="ml-1 text-orange-400">(expired)</span>
                                  )}
                                </td>
                                <td className="py-3 pr-3">
                                  <FuturesStatusBadge status={order.status} />
                                </td>
                                <td className="py-3">
                                  <div className="flex gap-1.5 flex-wrap">
                                    {canFill && (
                                      <button
                                        onClick={() => fillFuturesOrder(order.id, order.amount)}
                                        className="px-3 py-1 bg-accent hover:bg-purple-600 rounded text-xs font-semibold transition-all"
                                      >
                                        Fill
                                      </button>
                                    )}
                                    {canSettle && (
                                      <button
                                        onClick={() => settleFuturesOrder(order.id)}
                                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 rounded text-xs font-semibold transition-all"
                                      >
                                        Settle
                                      </button>
                                    )}
                                    {canCancel && (
                                      <button
                                        onClick={() => cancelFuturesOrder(order.id)}
                                        className="px-3 py-1 bg-red-700 hover:bg-red-800 rounded text-xs font-semibold transition-all"
                                      >
                                        Cancel
                                      </button>
                                    )}
                                    {order.status === "SETTLED" && order.winner && (
                                      <span className="text-xs text-emerald-400 flex items-center gap-1">
                                        <Trophy className="w-3 h-3" />
                                        {shortAddr(order.winner)}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ── Futures Guide ─────────────────────────────────────── */}
                <div className="glass rounded-xl p-5 border border-gray-700">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5 shrink-0" />
                    <div className="text-sm text-gray-400 space-y-1">
                      <p className="font-semibold text-gray-200">How RWA Futures work</p>
                      <p>1. <span className="text-white">Open a position</span> — lock ORWA as collateral and choose LONG (price goes up) or SHORT (price goes down) against a strike price and expiry date.</p>
                      <p>2. <span className="text-white">Counterparty fills</span> — another KYC-verified user locks the same ORWA amount to take the opposing side.</p>
                      <p>3. <span className="text-white">Settle after expiry</span> — either party calls Settle. The oracle price at settlement determines the winner, who receives <em>2× collateral minus the 1% protocol fee</em>.</p>
                      <p>4. <span className="text-white">Cancel</span> — open orders can be cancelled by the creator. Expired-but-unsettled filled orders can be cancelled by either party for a 1:1 collateral refund (draw).</p>
                    </div>
                  </div>
                </div>

              </div>
            )}

          </div>
        ) : (
          /* ── Not connected landing ─────────────────────────────────────── */
          <div className="glass rounded-xl p-12 text-center fade-in">
            <Wallet className="w-16 h-16 mx-auto mb-4 text-primary" />
            <h2 className="text-2xl font-semibold mb-2">Connect Your Wallet</h2>
            <p className="text-gray-400 mb-6">
              Connect your wallet to access the OmniRWA protocol and manage your cross-chain RWA assets
            </p>
            <button
              onClick={connectWallet}
              className="px-8 py-3 bg-primary hover:bg-primary-hover rounded-lg font-semibold transition-all pulse-glow"
            >
              Connect Wallet
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

// ── Tiny reusable stat card ────────────────────────────────────────────────────
function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-secondary rounded-lg p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        {icon}
        <span>{label}</span>
      </div>
      <p className="font-semibold text-sm truncate">{value}</p>
    </div>
  );
}

// ── Futures order status badge ─────────────────────────────────────────────────
function FuturesStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string; bg: string }> = {
    OPEN:      { color: "text-blue-400",    bg: "bg-blue-900/50" },
    FILLED:    { color: "text-yellow-400",  bg: "bg-yellow-900/50" },
    SETTLED:   { color: "text-emerald-400", bg: "bg-emerald-900/50" },
    CANCELLED: { color: "text-gray-400",    bg: "bg-gray-800" },
  };
  const c = cfg[status] || { color: "text-gray-400", bg: "bg-gray-800" };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${c.bg} ${c.color}`}>
      {status}
    </span>
  );
}
