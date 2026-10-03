const hre = require("hardhat");

async function main() {
  console.log("Deploying OmniRWA Protocol to local network...");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deploy IdentityRegistry
  console.log("\n1. Deploying IdentityRegistry...");
  const IdentityRegistry = await hre.ethers.getContractFactory("IdentityRegistry");
  const identityRegistry = await IdentityRegistry.deploy();
  await identityRegistry.deployed();
  console.log("IdentityRegistry deployed to:", identityRegistry.address);

  // Deploy ComplianceModule
  console.log("\n2. Deploying ComplianceModule...");
  const maxTransferAmount  = hre.ethers.utils.parseEther("10000"); // 10,000 tokens max per tx
  const dailyTransferLimit = hre.ethers.utils.parseEther("50000"); // 50,000 tokens max per day
  const ComplianceModule = await hre.ethers.getContractFactory("ComplianceModule");
  const complianceModule = await ComplianceModule.deploy(maxTransferAmount, dailyTransferLimit);
  await complianceModule.deployed();
  console.log("ComplianceModule deployed to:", complianceModule.address);

  // Set identity registry in compliance module
  console.log("\n3. Setting IdentityRegistry in ComplianceModule...");
  await complianceModule.setIdentityRegistry(identityRegistry.address);
  console.log("IdentityRegistry set in ComplianceModule");

  // Deploy OmniRWAToken
  console.log("\n4. Deploying OmniRWAToken...");
  const OmniRWAToken = await hre.ethers.getContractFactory("OmniRWAToken");
  const token = await OmniRWAToken.deploy("OmniRWA Token", "ORWA");
  await token.deployed();
  console.log("OmniRWAToken deployed to:", token.address);

  // Set up token contracts
  console.log("\n5. Setting up token contracts...");
  await token.setIdentityRegistry(identityRegistry.address);
  await token.setComplianceModule(complianceModule.address);
  console.log("Token contracts configured");

  // Deploy OmniRWARouter
  console.log("\n6. Deploying OmniRWARouter...");
  const chainId = 1; // Chain A
  const OmniRWARouter = await hre.ethers.getContractFactory("OmniRWARouter");
  const router = await OmniRWARouter.deploy(chainId, token.address);
  await router.deployed();
  console.log("OmniRWARouter deployed to:", router.address);

  // Set up router contracts
  console.log("\n7. Setting up router contracts...");
  await router.setIdentityRegistry(identityRegistry.address);
  await token.setBridgeRouter(router.address);
  console.log("Router contracts configured");

  // Register deployer as verified user
  console.log("\n8. Registering deployer as verified user...");
  await identityRegistry.registerUser(deployer.address, true);
  console.log("Deployer registered as verified user");

  // Deploy OmniRWAFutures
  console.log("\n9. Deploying OmniRWAFutures...");
  const futuresFeeBps    = 100;                              // 1 % fee
  const initialOraclePrice = hre.ethers.utils.parseEther("1"); // 1 USD per ORWA (18 dp)
  const OmniRWAFutures = await hre.ethers.getContractFactory("OmniRWAFutures");
  const futures = await OmniRWAFutures.deploy(
    token.address,
    identityRegistry.address,
    futuresFeeBps,
    initialOraclePrice
  );
  await futures.deployed();
  console.log("OmniRWAFutures deployed to:", futures.address);

  // Allow the futures contract to receive ORWA (token approvals are per-user,
  // but we need the contract to hold collateral via transferFrom, which works
  // as long as users approve the contract).  No extra token setup needed.
  console.log("OmniRWAFutures setup complete");

  // Deployment summary
  console.log("\n=== Deployment Summary ===");
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", chainId);
  console.log("IdentityRegistry:", identityRegistry.address);
  console.log("ComplianceModule:", complianceModule.address);
  console.log("OmniRWAToken:", token.address);
  console.log("OmniRWARouter:", router.address);
  console.log("OmniRWAFutures:", futures.address);
  console.log("Deployer:", deployer.address);

  // Save deployment addresses to file
  const deploymentInfo = {
    network: hre.network.name,
    chainId: chainId,
    identityRegistry: identityRegistry.address,
    complianceModule: complianceModule.address,
    token: token.address,
    router: router.address,
    futures: futures.address,
    deployer: deployer.address,
    deploymentTime: new Date().toISOString()
  };

  const fs = require("fs");
  fs.writeFileSync(
    `deployment-${hre.network.name}.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log(`\nDeployment info saved to deployment-${hre.network.name}.json`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
