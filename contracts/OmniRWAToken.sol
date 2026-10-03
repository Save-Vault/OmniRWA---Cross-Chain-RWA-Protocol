// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./Mocks.sol";

/**
 * @title OmniRWAToken
 * @dev ERC-20 token with compliance checks, cross-chain bridge capabilities,
 *      configurable transfer fees, and emergency pause.
 * Implements ERC-3643 / T-REX standard compliance routing.
 */
contract OmniRWAToken is ERC20, Ownable {
    IdentityRegistry public identityRegistry;
    ComplianceModule public complianceModule;
    address public bridgeRouter;

    // ── Transfer fee ───────────────────────────────────────────────────────────
    /// @dev Fee in basis points (e.g. 50 = 0.50 %)
    uint256 public feeBasisPoints;
    address public feeCollector;
    uint256 public totalFeesCollected;

    // Maximum fee: 5 % (500 bps) — protects users from misconfiguration
    uint256 public constant MAX_FEE_BPS = 500;

    // ── Emergency pause ────────────────────────────────────────────────────────
    bool public paused;

    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10**18; // 1 million tokens

    // ── Events ─────────────────────────────────────────────────────────────────
    event BridgeRouterUpdated(address indexed oldRouter, address indexed newRouter);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event ComplianceModuleUpdated(address indexed oldModule, address indexed newModule);
    event BridgeBurn(address indexed from, uint256 amount);
    event BridgeMint(address indexed to, uint256 amount);

    event FeeBasisPointsUpdated(uint256 oldFee, uint256 newFee);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event FeeCollected(address indexed from, uint256 feeAmount);

    event Paused(address indexed by);
    event Unpaused(address indexed by);

    // ── Constructor ────────────────────────────────────────────────────────────
    /**
     * @param name  Token name
     * @param symbol  Token symbol
     */
    constructor(string memory name, string memory symbol) ERC20(name, symbol) Ownable(msg.sender) {
        _mint(msg.sender, INITIAL_SUPPLY);
        feeCollector = msg.sender; // default fee collector is deployer
    }

    // ── Modifiers ──────────────────────────────────────────────────────────────
    modifier onlyBridgeRouter() {
        require(msg.sender == bridgeRouter, "Only bridge router can call this function");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Token transfers are paused");
        _;
    }

    // ── Admin setters ──────────────────────────────────────────────────────────
    function setBridgeRouter(address _bridgeRouter) external onlyOwner {
        address oldRouter = bridgeRouter;
        bridgeRouter = _bridgeRouter;
        emit BridgeRouterUpdated(oldRouter, _bridgeRouter);
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    function setComplianceModule(address _complianceModule) external onlyOwner {
        address oldModule = address(complianceModule);
        complianceModule = ComplianceModule(_complianceModule);
        emit ComplianceModuleUpdated(oldModule, _complianceModule);
    }

    // ── Fee management ─────────────────────────────────────────────────────────
    /**
     * @notice Set the bridge transfer fee in basis points.
     * @param _feeBasisPoints  New fee (0 – 500 bps)
     */
    function setFeeBasisPoints(uint256 _feeBasisPoints) external onlyOwner {
        require(_feeBasisPoints <= MAX_FEE_BPS, "Fee exceeds maximum allowed (5%)");
        uint256 old = feeBasisPoints;
        feeBasisPoints = _feeBasisPoints;
        emit FeeBasisPointsUpdated(old, _feeBasisPoints);
    }

    /**
     * @notice Update the address that receives collected fees.
     * @param _feeCollector  New fee collector (must be non-zero)
     */
    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "Fee collector cannot be zero address");
        address old = feeCollector;
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(old, _feeCollector);
    }

    /**
     * @notice Calculate the fee for a given amount.
     * @param amount  Gross transfer amount
     * @return fee    Amount to be deducted as fee
     */
    function calculateFee(uint256 amount) public view returns (uint256) {
        return (amount * feeBasisPoints) / 10_000;
    }

    // ── Emergency pause ────────────────────────────────────────────────────────
    /// @notice Halt all token transfers (emergency stop). Only owner.
    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Resume token transfers. Only owner.
    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ── ERC-20 overrides with compliance + pause ───────────────────────────────
    function transfer(address to, uint256 amount) public override whenNotPaused returns (bool) {
        _checkCompliance(msg.sender, to, amount);
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override whenNotPaused returns (bool) {
        _checkCompliance(from, to, amount);
        return super.transferFrom(from, to, amount);
    }

    /**
     * @dev Override approve — compliance is only enforced at actual transfer time.
     */
    function approve(address spender, uint256 amount) public override whenNotPaused returns (bool) {
        return super.approve(spender, amount);
    }

    // ── Bridge operations ──────────────────────────────────────────────────────
    /**
     * @notice Burn tokens for cross-chain bridge.
     *         If a fee is configured, deduct it before burning and send to feeCollector.
     * @param from    Address to burn from
     * @param amount  Gross amount (fee will be subtracted from this)
     */
    function bridgeBurn(address from, uint256 amount) external onlyBridgeRouter whenNotPaused {
        require(amount > 0, "Amount must be greater than 0");

        uint256 fee = calculateFee(amount);
        uint256 burnAmount = amount - fee;

        if (fee > 0 && feeCollector != address(0)) {
            // Transfer fee to collector (no compliance check for internal fee collection)
            super._transfer(from, feeCollector, fee);
            totalFeesCollected += fee;
            emit FeeCollected(from, fee);
        }

        _burn(from, burnAmount);
        emit BridgeBurn(from, burnAmount);
    }

    /**
     * @notice Mint tokens on the destination chain. No fee applied at mint.
     * @param to      Recipient address
     * @param amount  Net amount to mint (fee already deducted on source)
     */
    function bridgeMint(address to, uint256 amount) external onlyBridgeRouter {
        require(amount > 0, "Amount must be greater than 0");
        _mint(to, amount);
        emit BridgeMint(to, amount);
    }

    // ── Internal helpers ───────────────────────────────────────────────────────
    function _checkCompliance(address from, address to, uint256 amount) internal {
        if (address(complianceModule) == address(0)) {
            return;
        }
        require(
            complianceModule.isTransferCompliant(from, to, amount),
            "Transfer not compliant: KYC verification required or amount exceeds limit"
        );
    }
}
