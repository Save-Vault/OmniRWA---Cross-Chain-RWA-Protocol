// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
     * @notice Register or update a user's KYC verification status.
     * @param user    Wallet address
     * @param status  true = verified, false = revoked
     */
    function registerUser(address user, bool status) external onlyAdmin {
        verifiedUsers[user] = status;
        emit UserRegistered(user, status);
    }

    /**
     * @notice Check if a user holds valid KYC.
     */
    function isVerified(address user) external view returns (bool) {
        return verifiedUsers[user];
    }

    /**
     * @notice Transfer admin role.
     */
    function setAdmin(address newAdmin) external onlyAdmin {
        address oldAdmin = admin;
        admin = newAdmin;
        emit AdminUpdated(oldAdmin, newAdmin);
    }
}

/**
 * @title ComplianceModule
 * @dev Mock compliance module for transfer restrictions (simulating ERC-3643 / T-REX standard).
 *      Checks:
 *        1. KYC verification for sender and receiver
 *        2. Per-transaction maximum amount
 *        3. Daily rolling transfer limit per wallet (24-hour window)
 */
contract ComplianceModule {
    IdentityRegistry public identityRegistry;

    /// @notice Maximum amount per single transaction (token units with 18 decimals)
    uint256 public maxTransferAmount;

    /// @notice Maximum total amount a wallet may transfer within a 24-hour window
    uint256 public dailyTransferLimit;

    // ── Daily transfer tracking ────────────────────────────────────────────────
    struct DailyUsage {
        uint256 windowStart; // unix timestamp of the start of the current day window
        uint256 transferred;  // total transferred in the current window
    }

    mapping(address => DailyUsage) private _dailyUsage;

    uint256 private constant ONE_DAY = 24 * 60 * 60; // 86400 seconds

    // ── Events ─────────────────────────────────────────────────────────────────
    event MaxTransferAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event DailyTransferLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    /**
     * @param _maxTransferAmount  Per-transaction cap (e.g. 10_000 * 10**18)
     * @param _dailyTransferLimit Daily rolling cap (e.g. 50_000 * 10**18). 0 = disabled.
     */
    constructor(uint256 _maxTransferAmount, uint256 _dailyTransferLimit) {
        maxTransferAmount = _maxTransferAmount;
        dailyTransferLimit = _dailyTransferLimit;
    }

    // ── Admin setters ──────────────────────────────────────────────────────────
    function setIdentityRegistry(address _identityRegistry) external {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    function setMaxTransferAmount(uint256 _maxTransferAmount) external {
        uint256 oldAmount = maxTransferAmount;
        maxTransferAmount = _maxTransferAmount;
        emit MaxTransferAmountUpdated(oldAmount, _maxTransferAmount);
    }

    function setDailyTransferLimit(uint256 _dailyTransferLimit) external {
        uint256 oldLimit = dailyTransferLimit;
        dailyTransferLimit = _dailyTransferLimit;
        emit DailyTransferLimitUpdated(oldLimit, _dailyTransferLimit);
    }

    // ── Public view helpers ────────────────────────────────────────────────────
    /**
     * @notice How much a wallet has transferred in the current 24-hour window.
     */
    function getDailyTransferred(address wallet) external view returns (uint256) {
        DailyUsage storage usage = _dailyUsage[wallet];
        if (block.timestamp >= usage.windowStart + ONE_DAY) {
            return 0; // window has expired
        }
        return usage.transferred;
    }

    /**
     * @notice Remaining allowance for a wallet in the current 24-hour window.
     *         Returns type(uint256).max when daily limit is disabled (0).
     */
    function getDailyRemaining(address wallet) external view returns (uint256) {
        if (dailyTransferLimit == 0) {
            return type(uint256).max;
        }
        DailyUsage storage usage = _dailyUsage[wallet];
        uint256 used = 0;
        if (block.timestamp < usage.windowStart + ONE_DAY) {
            used = usage.transferred;
        }
        if (used >= dailyTransferLimit) return 0;
        return dailyTransferLimit - used;
    }

    // ── Compliance check (called by OmniRWAToken) ──────────────────────────────
    /**
     * @notice Check whether a transfer passes all compliance rules.
     *         NOTE: This function has side-effects — it updates the daily usage
     *         counter for `from`. It must only be called when a real transfer
     *         is being executed (i.e. inside _checkCompliance).
     */
    function isTransferCompliant(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        // 1. KYC checks
        if (address(identityRegistry) != address(0)) {
            if (!identityRegistry.isVerified(from)) return false;
            if (!identityRegistry.isVerified(to))   return false;
        }

        // 2. Per-transaction cap
        if (maxTransferAmount > 0 && amount > maxTransferAmount) return false;

        // 3. Daily rolling limit
        if (dailyTransferLimit > 0) {
            DailyUsage storage usage = _dailyUsage[from];

            // Reset window if expired
            if (block.timestamp >= usage.windowStart + ONE_DAY) {
                usage.windowStart = block.timestamp;
                usage.transferred = 0;
            }

            if (usage.transferred + amount > dailyTransferLimit) return false;

            // Record the transfer
            usage.transferred += amount;
        }

        return true;
    }
}
