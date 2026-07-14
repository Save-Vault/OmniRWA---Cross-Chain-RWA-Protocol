// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./Mocks.sol";

/**
 * @title OmniRWAToken
 * @dev ERC-20 token with compliance checks and cross-chain bridge capabilities
 * Implements ERC-3643 / T-REX standard compliance routing
 */
contract OmniRWAToken is ERC20, Ownable {
    IdentityRegistry public identityRegistry;
    ComplianceModule public complianceModule;
    address public bridgeRouter;
    
    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10**18; // 1 million tokens

    event BridgeRouterUpdated(address indexed oldRouter, address indexed newRouter);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event ComplianceModuleUpdated(address indexed oldModule, address indexed newModule);
    event BridgeBurn(address indexed from, uint256 amount);
    event BridgeMint(address indexed to, uint256 amount);

    /**
     * @dev Constructor to initialize the token
     * @param name The token name
     * @param symbol The token symbol
     */
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /**
     * @dev Modifier to restrict access to authorized bridge router
     */
    modifier onlyBridgeRouter() {
        require(msg.sender == bridgeRouter, "Only bridge router can call this function");
        _;
    }

    /**
     * @dev Set the bridge router address
     * @param _bridgeRouter The address of the bridge router
     */
    function setBridgeRouter(address _bridgeRouter) external onlyOwner {
        address oldRouter = bridgeRouter;
        bridgeRouter = _bridgeRouter;
        emit BridgeRouterUpdated(oldRouter, _bridgeRouter);
    }

    /**
     * @dev Set the identity registry contract
     * @param _identityRegistry The address of the identity registry
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    /**
     * @dev Set the compliance module contract
     * @param _complianceModule The address of the compliance module
     */
    function setComplianceModule(address _complianceModule) external onlyOwner {
        address oldModule = address(complianceModule);
        complianceModule = ComplianceModule(_complianceModule);
        emit ComplianceModuleUpdated(oldModule, _complianceModule);
    }

    /**
     * @dev Override transfer to include compliance checks
     * @param to The recipient address
     * @param amount The transfer amount
     * @return bool True if transfer successful
     */
    function transfer(address to, uint256 amount) public override returns (bool) {
        _checkCompliance(msg.sender, to, amount);
        return super.transfer(to, amount);
    }

    /**
     * @dev Override transferFrom to include compliance checks
     * @param from The sender address
     * @param to The recipient address
     * @param amount The transfer amount
     * @return bool True if transfer successful
     */
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _checkCompliance(from, to, amount);
        return super.transferFrom(from, to, amount);
    }

    /**
     * @dev Override approve to include compliance checks
     * @param spender The spender address
     * @param amount The approval amount
     * @return bool True if approval successful
     */
    function approve(address spender, uint256 amount) public override returns (bool) {
        _checkCompliance(msg.sender, spender, amount);
        return super.approve(spender, amount);
    }

    /**
     * @dev Internal function to check compliance before transfer
     * @param from The sender address
     * @param to The recipient address
     * @param amount The transfer amount
     */
    function _checkCompliance(address from, address to, uint256 amount) internal view {
        // Skip compliance check if compliance module is not set
        if (address(complianceModule) == address(0)) {
            return;
        }
        
        require(
            complianceModule.isTransferCompliant(from, to, amount),
            "Transfer not compliant: KYC verification required or amount exceeds limit"
        );
    }

    /**
     * @dev Burn tokens for cross-chain bridge (only callable by bridge router)
     * @param from The address to burn tokens from
     * @param amount The amount to burn
     */
    function bridgeBurn(address from, uint256 amount) external onlyBridgeRouter {
        _burn(from, amount);
        emit BridgeBurn(from, amount);
    }

    /**
     * @dev Mint tokens for cross-chain bridge (only callable by bridge router)
     * @param to The address to mint tokens to
     * @param amount The amount to mint
     */
    function bridgeMint(address to, uint256 amount) external onlyBridgeRouter {
        _mint(to, amount);
        emit BridgeMint(to, amount);
    }
}
