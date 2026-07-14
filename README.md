# OmniRWA - Cross-Chain RWA Protocol

A decentralized, state-synchronized cross-chain protocol for compliant Real-World Asset collateralization. This project implements a complete Web3 stack with smart contracts, a backend relayer service, and a modern frontend dashboard.

## Architecture Overview

OmniRWA consists of three main layers:

1. **Smart Contracts (Solidity)** - ERC-20 token with compliance checks and cross-chain bridge routing
2. **Backend API (Node.js/Express)** - Event relayer and KYC registration service
3. **Frontend Dashboard (Next.js)** - Multi-chain asset management interface

## Tech Stack

### Smart Contracts
- **Hardhat** - Development environment and deployment framework
- **OpenZeppelin** - Secure ERC-20 implementation
- **Solidity 0.8.19** - Smart contract language

### Backend
- **Node.js** - Runtime environment
- **Express** - Web framework
- **Ethers.js v6** - Ethereum library
- **TypeScript** - Type safety

### Frontend
- **Next.js 14** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Lucide React** - Icons
- **Ethers.js v6** - Wallet integration

## Project Structure

```
omni-rwa/
├── contracts/              # Smart contracts
│   ├── OmniRWAToken.sol   # ERC-20 token with compliance
│   ├── OmniRWARouter.sol  # Cross-chain router
│   ├── Mocks.sol          # Identity registry & compliance mocks
│   ├── hardhat.config.js  # Hardhat configuration
│   ├── scripts/
│   │   ├── deploy.js              # Single chain deployment
│   │   ├── deploy-chain-a.js      # Chain A deployment
│   │   └── deploy-chain-b.js      # Chain B deployment
│   └── package.json
├── backend/               # Backend API
│   ├── src/
│   │   └── index.js      # Main server file
│   ├── .env.example      # Environment variables template
│   └── package.json
├── frontend/              # Frontend dashboard
│   ├── app/
│   │   ├── layout.tsx    # Root layout
│   │   ├── page.tsx      # Main dashboard page
│   │   └── globals.css   # Global styles
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── .env.local.example
│   └── package.json
└── README.md
```

## Prerequisites

- **Node.js** (v18 or higher)
- **npm** or **yarn**
- **Git**

## Installation & Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd omni-rwa
```

### 2. Install Dependencies

Install dependencies for all three layers:

```bash
# Install contract dependencies
cd contracts
npm install

# Install backend dependencies
cd ../backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 3. Environment Configuration

#### Backend Environment Variables

Copy the example environment file and configure:

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your configuration:

```env
PORT=3001
CHAIN_A_RPC=http://127.0.0.1:8545
CHAIN_B_RPC=http://127.0.0.1:8545
BRIDGE_DELAY=5000
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

#### Frontend Environment Variables

Copy the example environment file:

```bash
cd frontend
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Running the Application

### Step 1: Start Local Blockchain Network

Open a terminal and start the Hardhat local network:

```bash
cd contracts
npx hardhat node
```

This will start a local Ethereum network at `http://127.0.0.1:8545`.

**Keep this terminal running!**

### Step 2: Deploy Smart Contracts

In a new terminal, deploy the contracts:

```bash
cd contracts
npm run deploy
```

This will deploy:
- IdentityRegistry
- ComplianceModule
- OmniRWAToken
- OmniRWARouter

The deployment will create `deployment-localhost.json` with contract addresses.

### Step 3: Start Backend Server

In a new terminal, start the backend API:

```bash
cd backend
npm run dev
```

The backend will:
- Start the Express server on `http://localhost:3001`
- Load deployment files
- Set up relayer authorization
- Start listening for cross-chain events

**Keep this terminal running!**

### Step 4: Start Frontend Dashboard

In a new terminal, start the frontend development server:

```bash
cd frontend
npm run dev
```

The dashboard will be available at `http://localhost:3000`.

## Usage Guide

### 1. Connect Wallet

- Click the "Connect Wallet" button in the top-right corner
- Approve the MetaMask connection request
- Your wallet address will be displayed

### 2. Complete KYC Verification

- The dashboard shows your KYC status for both Chain A and Chain B
- Click "Submit KYC" on any chain where you're not verified
- The backend will register your address on-chain

### 3. View Asset Balances

- The "Multi-Chain Asset Overview" shows your ORWA token balance on both chains
- Total balance is calculated across both chains

### 4. Initiate Cross-Chain Transfer

1. Select **Source Chain** (where your tokens are)
2. Select **Destination Chain** (where you want to send tokens)
3. Enter the **Amount** to transfer
4. Enter the **Recipient Address**
5. Click "Initiate Cross-Chain Compliance Transfer"

The process will:
1. Burn tokens on the source chain
2. Emit a cross-chain event
3. Backend relayer picks up the event
4. After a 5-second delay, mint tokens on the destination chain
5. Update your balances

### 5. Monitor Activity

- The "Activity Feed" shows real-time progress of your bridge transfers
- Each step is tracked with status indicators

## Smart Contract Details

### OmniRWAToken

An ERC-20 token with compliance features:

- **Compliance Checks**: Transfers require KYC verification
- **Transfer Limits**: Maximum 10,000 tokens per transaction
- **Bridge Operations**: `bridgeBurn` and `bridgeMint` for cross-chain transfers
- **Admin Controls**: Owner can update contracts and settings

### OmniRWARouter

Cross-chain message router:

- **Initiate Transfer**: Burns tokens and emits cross-chain event
- **Handle Incoming Route**: Mints tokens after compliance verification
- **Relayer Authorization**: Only trusted relayers can handle incoming routes
- **Replay Protection**: Message IDs prevent duplicate processing

### Mocks

Simplified implementations for testing:

- **IdentityRegistry**: Manages KYC verification status
- **ComplianceModule**: Enforces transfer restrictions

## API Endpoints

### Backend API (http://localhost:3001)

#### Health Check
```
GET /health
```

#### KYC Registration
```
POST /api/kyc/register
Content-Type: application/json

{
  "walletAddress": "0x...",
  "chain": "chainA" | "chainB"
}
```

#### KYC Status Check
```
GET /api/kyc/status?walletAddress=0x...&chain=chainA
```

#### Asset Status
```
GET /api/assets/status?walletAddress=0x...
```

#### Contract Addresses
```
GET /api/contracts
```

## Testing

### Test Smart Contracts

```bash
cd contracts
npx hardhat test
```

### Manual Testing Flow

1. **Deploy contracts** to local network
2. **Start backend** server
3. **Start frontend** dashboard
4. **Connect wallet** (use MetaMask with local network)
5. **Submit KYC** for both chains
6. **Transfer tokens** between chains
7. **Verify balances** update correctly

## Development Notes

### Hardhat Network Accounts

The local Hardhat network provides 20 test accounts with 10,000 ETH each:

```
Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000 ETH)
Account #1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (10000 ETH)
...
```

The default private key in `.env` corresponds to Account #0.

### Customization

- **Transfer Limits**: Modify `maxTransferAmount` in deployment scripts
- **Bridge Delay**: Adjust `BRIDGE_DELAY` in backend `.env`
- **Chain IDs**: Update chain IDs in deployment scripts and router

## Troubleshooting

### Port Already in Use

If ports are already in use:

```bash
# Kill process on port 8545 (Hardhat)
npx kill-port 8545

# Kill process on port 3001 (Backend)
npx kill-port 3001

# Kill process on port 3000 (Frontend)
npx kill-port 3000
```

### MetaMask Connection Issues

1. Ensure MetaMask is connected to `localhost:8545`
2. Add the local network to MetaMask:
   - Network Name: Hardhat Local
   - RPC URL: http://127.0.0.1:8545
   - Chain ID: 31337
   - Currency Symbol: ETH

### Contract Deployment Failures

- Ensure Hardhat node is running
- Check that the network is not congested
- Verify you have sufficient gas (test accounts have plenty)

### Backend Event Listener Not Working

- Verify deployment files exist in `contracts/` directory
- Check that contract addresses are correct
- Ensure the backend has the correct private key

## Security Considerations

⚠️ **This is a development prototype for testing purposes only.**

- **Not production-ready**: This code is for development and testing
- **Mock implementations**: Identity registry and compliance are simplified
- **Local network only**: Designed for local Hardhat network
- **No real cross-chain**: Simulates cross-chain messaging on a single network
- **Private keys**: Never commit private keys to version control

For production deployment, you would need:

- Real identity verification integration
- Actual cross-chain messaging (Chainlink CCIP, LayerZero, etc.)
- Proper security audits
- Production-grade infrastructure
- Multi-signature controls

## License

MIT License - See LICENSE file for details

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions:
- Open an issue on GitHub
- Check existing documentation
- Review the code comments

---

**Built with ❤️ for the Web3 community**
