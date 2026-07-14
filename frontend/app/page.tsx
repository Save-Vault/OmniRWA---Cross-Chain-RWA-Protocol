"use client";

import { useState, useEffect } from "react";
import { Wallet, Shield, ArrowRightLeft, Activity, CheckCircle, XCircle, Send, Loader2 } from "lucide-react";
import { ethers } from "ethers";

// Types
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

export default function Home() {
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [kycStatusChainA, setKycStatusChainA] = useState<boolean>(false);
  const [kycStatusChainB, setKycStatusChainB] = useState<boolean>(false);
  const [assetStatus, setAssetStatus] = useState<AssetStatus | null>(null);
  const [contracts, setContracts] = useState<ContractsResponse | null>(null);
  const [bridgeAmount, setBridgeAmount] = useState<string>("");
  const [bridgeRecipient, setBridgeRecipient] = useState<string>("");
  const [sourceChain, setSourceChain] = useState<string>("chainA");
  const [destinationChain, setDestinationChain] = useState<string>("chainB");
  const [activities, setActivities] = useState<BridgeActivity[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

  // Connect wallet
  const connectWallet = async () => {
    try {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        setWalletAddress(accounts[0]);
        setIsConnected(true);
        
        // Fetch data after connection
        await fetchKYCStatus(accounts[0]);
        await fetchAssetStatus(accounts[0]);
      } else {
        alert("Please install MetaMask to use this application");
      }
    } catch (error) {
      console.error("Error connecting wallet:", error);
      alert("Failed to connect wallet");
    }
  };

  // Disconnect wallet
  const disconnectWallet = () => {
    setWalletAddress("");
    setIsConnected(false);
    setKycStatusChainA(false);
    setKycStatusChainB(false);
    setAssetStatus(null);
    setActivities([]);
  };

  // Fetch KYC status
  const fetchKYCStatus = async (address: string) => {
    try {
      const [responseA, responseB] = await Promise.all([
        fetch(`${API_URL}/api/kyc/status?walletAddress=${address}&chain=chainA`),
        fetch(`${API_URL}/api/kyc/status?walletAddress=${address}&chain=chainB`)
      ]);

      const dataA = await responseA.json();
      const dataB = await responseB.json();

      setKycStatusChainA(dataA.isVerified);
      setKycStatusChainB(dataB.isVerified);
    } catch (error) {
      console.error("Error fetching KYC status:", error);
    }
  };

  // Fetch asset status
  const fetchAssetStatus = async (address: string) => {
    try {
      const response = await fetch(`${API_URL}/api/assets/status?walletAddress=${address}`);
      const data = await response.json();
      setAssetStatus(data);
    } catch (error) {
      console.error("Error fetching asset status:", error);
    }
  };

  // Submit KYC
  const submitKYC = async (chain: string) => {
    if (!walletAddress) return;
    
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/kyc/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, chain })
      });

      const data = await response.json();
      
      if (data.success) {
        // Refresh KYC status
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

  // Initiate bridge transfer
  const initiateBridge = async () => {
    if (!walletAddress || !bridgeAmount || !bridgeRecipient) {
      alert("Please fill in all fields");
      return;
    }

    const amount = parseFloat(bridgeAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    // Check if recipient is a valid address
    if (!ethers.isAddress(bridgeRecipient)) {
      alert("Please enter a valid recipient address");
      return;
    }

    // Check KYC status on destination chain
    const destChainKYC = destinationChain === "chainA" ? kycStatusChainA : kycStatusChainB;
    if (!destChainKYC) {
      alert(`Recipient must be KYC verified on ${destinationChain === "chainA" ? "Chain A" : "Chain B"}`);
      return;
    }

    setIsLoading(true);
    
    // Add initial activity
    const activityId = Date.now();
    setActivities(prev => [...prev, {
      id: activityId,
      step: "Initiating Local Burn...",
      status: "pending",
      timestamp: new Date()
    }]);

    try {
      // Get contract addresses
      const contractsResponse = await fetch(`${API_URL}/api/contracts`);
      const contractsData = await contractsResponse.json();
      
      const sourceContracts = sourceChain === "chainA" ? contractsData.chainA : contractsData.chainB;
      const routerAddress = sourceContracts.router;

      if (!routerAddress) {
        throw new Error("Router contract not available");
      }

      // Connect to wallet and initiate transfer
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      
      const routerABI = [
        "function initiateCrossChainTransfer(uint32 destChainId, address receiver, uint256 amount) external"
      ];
      
      const router = new ethers.Contract(routerAddress, routerABI, signer);
      
      const destChainId = destinationChain === "chainA" ? 1 : 43114;
      const amountWei = ethers.parseEther(bridgeAmount);
      
      // Update activity
      setActivities(prev => prev.map(a => 
        a.id === activityId ? { ...a, step: "Initiating Local Burn...", status: "success" } : a
      ));
      
      // Add second activity
      setActivities(prev => [...prev, {
        id: activityId + 1,
        step: "Securing Cross-Chain Compliance Check...",
        status: "pending",
        timestamp: new Date()
      }]);

      const tx = await router.initiateCrossChainTransfer(destChainId, bridgeRecipient, amountWei);
      await tx.wait();

      // Update activities
      setActivities(prev => prev.map(a => 
        a.id === activityId + 1 ? { ...a, step: "Securing Cross-Chain Compliance Check...", status: "success" } : a
      ));

      // Add third activity
      setActivities(prev => [...prev, {
        id: activityId + 2,
        step: "Successful Destination Mint!",
        status: "pending",
        timestamp: new Date()
      }]);

      // Wait for bridge to complete (simulated delay)
      await new Promise(resolve => setTimeout(resolve, 6000));

      // Update final activity
      setActivities(prev => prev.map(a => 
        a.id === activityId + 2 ? { ...a, step: "Successful Destination Mint!", status: "success" } : a
      ));

      // Refresh asset status
      await fetchAssetStatus(walletAddress);
      
      // Reset form
      setBridgeAmount("");
      setBridgeRecipient("");
      
      alert("Bridge transfer completed successfully!");
    } catch (error) {
      console.error("Error initiating bridge:", error);
      
      // Update activities to error state
      setActivities(prev => prev.map(a => 
        a.status === "pending" ? { ...a, status: "error" } : a
      ));
      
      alert("Failed to initiate bridge transfer");
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch contracts on mount
  useEffect(() => {
    const fetchContracts = async () => {
      try {
        const response = await fetch(`${API_URL}/api/contracts`);
        const data = await response.json();
        setContracts(data);
      } catch (error) {
        console.error("Error fetching contracts:", error);
      }
    };

    fetchContracts();
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8 fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                OmniRWA
              </h1>
              <p className="text-gray-400 mt-2">
                Cross-Chain RWA Protocol
              </p>
            </div>
            <button
              onClick={isConnected ? disconnectWallet : connectWallet}
              className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover rounded-lg font-semibold transition-all pulse-glow"
            >
              <Wallet className="w-5 h-5" />
              {isConnected ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "Connect Wallet"}
            </button>
          </div>
        </header>

        {isConnected && (
          <div className="space-y-6 fade-in">
            {/* KYC Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="glass rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Shield className="w-5 h-5 text-primary" />
                    Chain A (Ethereum)
                  </h2>
                  {kycStatusChainA ? (
                    <CheckCircle className="w-6 h-6 text-success" />
                  ) : (
                    <XCircle className="w-6 h-6 text-danger" />
                  )}
                </div>
                <p className="text-gray-400 mb-4">
                  Status: {kycStatusChainA ? "Verified" : "Not Verified"}
                </p>
                {!kycStatusChainA && (
                  <button
                    onClick={() => submitKYC("chainA")}
                    disabled={isLoading}
                    className="w-full px-4 py-2 bg-primary hover:bg-primary-hover rounded-lg font-semibold transition-all disabled:opacity-50"
                  >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Submit KYC"}
                  </button>
                )}
              </div>

              <div className="glass rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Shield className="w-5 h-5 text-accent" />
                    Chain B (Avalanche)
                  </h2>
                  {kycStatusChainB ? (
                    <CheckCircle className="w-6 h-6 text-success" />
                  ) : (
                    <XCircle className="w-6 h-6 text-danger" />
                  )}
                </div>
                <p className="text-gray-400 mb-4">
                  Status: {kycStatusChainB ? "Verified" : "Not Verified"}
                </p>
                {!kycStatusChainB && (
                  <button
                    onClick={() => submitKYC("chainB")}
                    disabled={isLoading}
                    className="w-full px-4 py-2 bg-accent hover:bg-purple-600 rounded-lg font-semibold transition-all disabled:opacity-50"
                  >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Submit KYC"}
                  </button>
                )}
              </div>
            </div>

            {/* Asset Overview */}
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
                <p className="text-gray-400">Loading asset status...</p>
              )}
            </div>

            {/* Bridge Portal */}
            <div className="glass rounded-xl p-6">
              <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-accent" />
                Bridge Portal
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
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
                <div>
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
                <div>
                  <label className="block text-sm font-medium mb-2">Amount (ORWA)</label>
                  <input
                    type="number"
                    value={bridgeAmount}
                    onChange={(e) => setBridgeAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 bg-secondary rounded-lg border border-gray-700 focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Recipient Address</label>
                  <input
                    type="text"
                    value={bridgeRecipient}
                    onChange={(e) => setBridgeRecipient(e.target.value)}
                    placeholder="0x..."
                    className="w-full px-4 py-3 bg-secondary rounded-lg border border-gray-700 focus:border-primary focus:outline-none"
                  />
                </div>
              </div>
              <button
                onClick={initiateBridge}
                disabled={isLoading}
                className="mt-6 w-full px-6 py-3 bg-gradient-to-r from-primary to-accent hover:from-primary-hover hover:to-purple-600 rounded-lg font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Initiate Cross-Chain Compliance Transfer
                  </>
                )}
              </button>
            </div>

            {/* Activity Feed */}
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
                        activity.status === "success"
                          ? "bg-success/10 border border-success/20"
                          : activity.status === "error"
                          ? "bg-danger/10 border border-danger/20"
                          : "bg-secondary"
                      }`}
                    >
                      {activity.status === "pending" && (
                        <Loader2 className="w-5 h-5 text-primary animate-spin" />
                      )}
                      {activity.status === "success" && (
                        <CheckCircle className="w-5 h-5 text-success" />
                      )}
                      {activity.status === "error" && (
                        <XCircle className="w-5 h-5 text-danger" />
                      )}
                      <div className="flex-1">
                        <p className="font-medium">{activity.step}</p>
                        <p className="text-sm text-gray-400">
                          {activity.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!isConnected && (
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
