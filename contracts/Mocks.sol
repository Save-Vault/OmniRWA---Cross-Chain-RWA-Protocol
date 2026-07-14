// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IdentityRegistry
 * @dev Mock identity registry for KYC verification (simulating ERC-3643 / T-REX standard)
 */
contract IdentityRegistry {
    mapping(address => bool) public verifiedUsers;
    address public admin;

    event UserRegistered(address indexed user, bool status);
    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);

    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this function");
        _;
    }

    /**
     * @dev Register or update a user's verification status
     * @param user The wallet address to register
     * @param status The verification status (true = verified, false = unverified)
     */
    function registerUser(address user, bool status) external onlyAdmin {
        verifiedUsers[user] = status;
        emit UserRegistered(user, status);
    }

    /**
     * @dev Check if a user is verified
     * @param user The wallet address to check
     * @return bool True if the user is verified
     */
    function isVerified(address user) external view returns (bool) {
        return verifiedUsers[user];
    }

    /**
     * @dev Update the admin address
     * @param newAdmin The new admin address
     */
    function setAdmin(address newAdmin) external onlyAdmin {
        address oldAdmin = admin;
        admin = newAdmin;
        emit AdminUpdated(oldAdmin, newAdmin);
    }
}

/**
 * @title ComplianceModule
 * @dev Mock compliance module for transfer restrictions (simulating ERC-3643 / T-REX standard)
 */
contract ComplianceModule {
    uint256 public maxTransferAmount;
    IdentityRegistry public identityRegistry;

    event MaxTransferAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    constructor(uint256 _maxTransferAmount) {
        maxTransferAmount = _maxTransferAmount;
    }

    /**
     * @dev Set the identity registry contract
     * @param _identityRegistry The address of the identity registry
     */
    function setIdentityRegistry(address _identityRegistry) external {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    /**
     * @dev Update the maximum transfer amount per transaction
     * @param _maxTransferAmount The new maximum transfer amount
     */
    function setMaxTransferAmount(uint256 _maxTransferAmount) external {
        uint256 oldAmount = maxTransferAmount;
        maxTransferAmount = _maxTransferAmount;
        emit MaxTransferAmountUpdated(oldAmount, _maxTransferAmount);
    }

    /**
     * @dev Check if a transfer is compliant
     * @param from The sender address
     * @param to The recipient address
     * @param amount The transfer amount
     * @return bool True if the transfer is compliant
     */
    function isTransferCompliant(
        address from,
        address to,
        uint256 amount
    ) external view returns (bool) {
        // Check if sender is verified
        if (!identityRegistry.isVerified(from)) {
            return false;
        }

        // Check if recipient is verified
        if (!identityRegistry.isVerified(to)) {
            return false;
        }

        // Check if amount exceeds maximum transfer limit
        if (amount > maxTransferAmount) {
            return false;
        }

        return true;
    }
}
