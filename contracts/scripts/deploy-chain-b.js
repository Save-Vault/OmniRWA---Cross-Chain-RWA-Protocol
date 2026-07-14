const hre = require("hardhat");

async function main() {
  console.log("Deploying OmniRWA Protocol to Chain B (Avalanche simulation)...");

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
  const maxTransferAmount = hre.ethers.utils.parseEther("10000"); // 10,000 tokens max
  const ComplianceModule = await hre.ethers.getContractFactory("ComplianceModule");
  const complianceModule = await ComplianceModule.deploy(maxTransferAmount);
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
  const chainId = 43114; // Chain B (Avalanche)
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

  // Deployment summary
  console.log("\n=== Chain B Deployment Summary ===");
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", chainId);
  console.log("IdentityRegistry:", identityRegistry.address);
  console.log("ComplianceModule:", complianceModule.address);
  console.log("OmniRWAToken:", token.address);
  console.log("OmniRWARouter:", router.address);
  console.log("Deployer:", deployer.address);

  // Save deployment addresses to file
  const deploymentInfo = {
    network: "chainB",
    chainId: chainId,
    identityRegistry: identityRegistry.address,
    complianceModule: complianceModule.address,
    token: token.address,
    router: router.address,
    deployer: deployer.address,
    deploymentTime: new Date().toISOString()
  };

  const fs = require("fs");
  fs.writeFileSync(
    "deployment-chain-b.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("\nDeployment info saved to deployment-chain-b.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
