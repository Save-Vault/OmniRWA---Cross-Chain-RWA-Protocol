// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./OmniRWAToken.sol";
import "./Mocks.sol";

/**
 * @title OmniRWAFutures
 * @dev Fixed-term forward contracts on ORWA tokens.
 *
 * Flow:
 *  1. Creator calls `createOrder(strikePrice, amount, expiry, side)`, locking ORWA
 *     (for SELL orders) or receiving a locked slot (for BUY orders with ETH margin).
 *  2. A counterparty calls `fillOrder(orderId)`, locking the opposing asset.
 *  3. After expiry any party (or the protocol) calls `settle(orderId)`.
 *     - If market price >= strikePrice and order side is LONG:  long wins.
 *     - If market price <  strikePrice and order side is SHORT: short wins.
 *     - Unsettled expired orders can be cancelled to release collateral.
 *
 * For simplicity the "market price" is supplied by the contract owner (oracle role).
 * In production this would be a Chainlink price feed.
 *
 * Collateral model (no ETH, purely ORWA):
 *  - Both sides lock `amount` ORWA as collateral.
 *  - Winner receives 2 × amount (both deposits); protocol takes a small fee.
 *  - KYC compliance is enforced via IdentityRegistry.
 */
contract OmniRWAFutures is Ownable {
    // ─── Types ────────────────────────────────────────────────────────────────
    enum Side   { LONG, SHORT }  // LONG = bet price goes up, SHORT = bet price goes down
    enum Status { OPEN, FILLED, SETTLED, CANCELLED }

    struct Order {
        uint256 id;
        address creator;
        address counterparty;   // zero until filled
        Side    side;           // creator's side
        uint256 strikePrice;    // price in 1e18 (e.g. 1 ORWA = X USD scaled to 18 dp)
        uint256 amount;         // ORWA tokens locked by each party
        uint256 expiry;         // unix timestamp
        Status  status;
        uint256 createdAt;
        uint256 filledAt;
        uint256 settledAt;
        address winner;         // populated after settlement
    }

    // ─── State ────────────────────────────────────────────────────────────────
    OmniRWAToken     public token;
    IdentityRegistry public identityRegistry;

    uint256 public nextOrderId;
    mapping(uint256 => Order) public orders;
    uint256[] public orderIds; // for enumeration

    /// @notice Protocol fee in basis points (e.g. 100 = 1 %)
    uint256 public feeBasisPoints;
    uint256 public constant MAX_FEE_BPS = 500; // 5 % cap
    address public feeCollector;
    uint256 public totalFeesCollected;

    /// @notice Oracle price — owner updates this (simulates Chainlink)
    uint256 public oraclePrice;

    // ─── Events ───────────────────────────────────────────────────────────────
    event OrderCreated(
        uint256 indexed orderId,
        address indexed creator,
        Side    side,
        uint256 strikePrice,
        uint256 amount,
        uint256 expiry
    );
    event OrderFilled(
        uint256 indexed orderId,
        address indexed counterparty
    );
    event OrderSettled(
        uint256 indexed orderId,
        address indexed winner,
        uint256 payout,
        uint256 fee
    );
    event OrderCancelled(uint256 indexed orderId, address indexed by);
    event OraclePriceUpdated(uint256 oldPrice, uint256 newPrice);
    event FeeBasisPointsUpdated(uint256 oldFee, uint256 newFee);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);

    // ─── Constructor ──────────────────────────────────────────────────────────
    /**
     * @param _token            OmniRWA token used as collateral
     * @param _identityRegistry KYC registry
     * @param _feeBasisPoints   Initial protocol fee (0–500 bps)
     * @param _initialPrice     Initial oracle price (18-decimal USD)
     */
    constructor(
        address _token,
        address _identityRegistry,
        uint256 _feeBasisPoints,
        uint256 _initialPrice
    ) Ownable(msg.sender) {
        require(_token != address(0), "Token address required");
        require(_feeBasisPoints <= MAX_FEE_BPS, "Fee exceeds maximum");

        token            = OmniRWAToken(_token);
        identityRegistry = IdentityRegistry(_identityRegistry);
        feeBasisPoints   = _feeBasisPoints;
        feeCollector     = msg.sender;
        oraclePrice      = _initialPrice;
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyKYC(address user) {
        if (address(identityRegistry) != address(0)) {
            require(identityRegistry.isVerified(user), "User not KYC verified");
        }
        _;
    }

    modifier orderExists(uint256 orderId) {
        require(orderId < nextOrderId, "Order does not exist");
        _;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────
    /// @notice Update oracle price. In production replace with Chainlink pull.
    function setOraclePrice(uint256 _price) external onlyOwner {
        emit OraclePriceUpdated(oraclePrice, _price);
        oraclePrice = _price;
    }

    function setFeeBasisPoints(uint256 _bps) external onlyOwner {
        require(_bps <= MAX_FEE_BPS, "Fee exceeds maximum");
        emit FeeBasisPointsUpdated(feeBasisPoints, _bps);
        feeBasisPoints = _bps;
    }

    function setFeeCollector(address _collector) external onlyOwner {
        require(_collector != address(0), "Zero address");
        emit FeeCollectorUpdated(feeCollector, _collector);
        feeCollector = _collector;
    }

    function setIdentityRegistry(address _registry) external onlyOwner {
        identityRegistry = IdentityRegistry(_registry);
    }

    // ─── Core: Create Order ───────────────────────────────────────────────────
    /**
     * @notice Open a new futures order.
     *         Caller must have approved `amount` ORWA to this contract.
     *
     * @param strikePrice  Target price (18 decimals) the creator expects
     * @param amount       ORWA collateral to lock (must be > 0)
     * @param expiry       Unix timestamp when the contract expires (must be future)
     * @param side         LONG (price goes up) or SHORT (price goes down)
     * @return orderId     ID of the newly created order
     */
    function createOrder(
        uint256 strikePrice,
        uint256 amount,
        uint256 expiry,
        Side    side
    ) external onlyKYC(msg.sender) returns (uint256 orderId) {
        require(amount > 0,              "Amount must be > 0");
        require(strikePrice > 0,         "Strike price must be > 0");
        require(expiry > block.timestamp, "Expiry must be in the future");

        // Lock collateral
        require(
            token.transferFrom(msg.sender, address(this), amount),
            "Collateral transfer failed"
        );

        orderId = nextOrderId++;
        orders[orderId] = Order({
            id:           orderId,
            creator:      msg.sender,
            counterparty: address(0),
            side:         side,
            strikePrice:  strikePrice,
            amount:       amount,
            expiry:       expiry,
            status:       Status.OPEN,
            createdAt:    block.timestamp,
            filledAt:     0,
            settledAt:    0,
            winner:       address(0)
        });
        orderIds.push(orderId);

        emit OrderCreated(orderId, msg.sender, side, strikePrice, amount, expiry);
    }

    // ─── Core: Fill Order ─────────────────────────────────────────────────────
    /**
     * @notice Take the opposing side of an open order.
     *         Caller must have approved `order.amount` ORWA to this contract.
     *
     * @param orderId  The order to fill
     */
    function fillOrder(uint256 orderId)
        external
        onlyKYC(msg.sender)
        orderExists(orderId)
    {
        Order storage o = orders[orderId];

        require(o.status == Status.OPEN,       "Order is not open");
        require(block.timestamp < o.expiry,    "Order has expired");
        require(msg.sender != o.creator,       "Cannot fill your own order");

        // Lock counterparty collateral
        require(
            token.transferFrom(msg.sender, address(this), o.amount),
            "Collateral transfer failed"
        );

        o.counterparty = msg.sender;
        o.status       = Status.FILLED;
        o.filledAt     = block.timestamp;

        emit OrderFilled(orderId, msg.sender);
    }

    // ─── Core: Settle Order ───────────────────────────────────────────────────
    /**
     * @notice Settle a filled, expired order using the current oracle price.
     *         Can be called by either party or the owner after expiry.
     *
     *  Win condition:
     *    LONG  wins if oraclePrice >= strikePrice
     *    SHORT wins if oraclePrice <  strikePrice
     *
     * @param orderId  The order to settle
     */
    function settle(uint256 orderId)
        external
        orderExists(orderId)
    {
        Order storage o = orders[orderId];

        require(o.status == Status.FILLED, "Order must be filled to settle");
        require(block.timestamp >= o.expiry, "Order has not expired yet");

        // Determine winner
        bool longWins = oraclePrice >= o.strikePrice;
        address winner = longWins
            ? (o.side == Side.LONG  ? o.creator : o.counterparty)
            : (o.side == Side.SHORT ? o.creator : o.counterparty);

        uint256 gross = o.amount * 2;
        uint256 fee   = (gross * feeBasisPoints) / 10_000;
        uint256 payout = gross - fee;

        o.winner    = winner;
        o.status    = Status.SETTLED;
        o.settledAt = block.timestamp;

        // Pay fee
        if (fee > 0 && feeCollector != address(0)) {
            require(token.transfer(feeCollector, fee), "Fee transfer failed");
            totalFeesCollected += fee;
        }

        // Pay winner
        require(token.transfer(winner, payout), "Payout transfer failed");

        emit OrderSettled(orderId, winner, payout, fee);
    }

    // ─── Core: Cancel Order ───────────────────────────────────────────────────
    /**
     * @notice Cancel an order and refund collateral.
     *
     *  - OPEN orders: only creator can cancel, anytime.
     *  - FILLED + expired orders with no settlement: either party can cancel
     *    to split collateral evenly (draw — no fee).
     *  - Owner can cancel any OPEN or stuck order (admin safety valve).
     */
    function cancelOrder(uint256 orderId)
        external
        orderExists(orderId)
    {
        Order storage o = orders[orderId];

        bool isCreator      = msg.sender == o.creator;
        bool isCounterparty = msg.sender == o.counterparty;
        bool isAdmin        = msg.sender == owner();

        require(
            o.status == Status.OPEN || o.status == Status.FILLED,
            "Order already settled or cancelled"
        );

        if (o.status == Status.OPEN) {
            require(isCreator || isAdmin, "Only creator or admin can cancel open order");
            // Refund creator collateral
            o.status = Status.CANCELLED;
            require(token.transfer(o.creator, o.amount), "Refund failed");

        } else {
            // FILLED — only allowed after expiry
            require(block.timestamp >= o.expiry, "Order not yet expired");
            require(isCreator || isCounterparty || isAdmin, "Not a party to this order");

            o.status = Status.CANCELLED;
            // Return collateral to each party (draw — no winner, no fee)
            require(token.transfer(o.creator,      o.amount), "Creator refund failed");
            require(token.transfer(o.counterparty, o.amount), "Counterparty refund failed");
        }

        emit OrderCancelled(orderId, msg.sender);
    }

    // ─── Views ────────────────────────────────────────────────────────────────
    /// @notice Total number of orders ever created.
    function totalOrders() external view returns (uint256) {
        return nextOrderId;
    }

    /// @notice Get paginated order IDs (newest first).
    function getOrderIds(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids)
    {
        uint256 total = orderIds.length;
        if (offset >= total) return new uint256[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;

        ids = new uint256[](count);
        // Return newest first (reverse)
        for (uint256 i = 0; i < count; i++) {
            ids[i] = orderIds[total - 1 - offset - i];
        }
    }

    /// @notice Get full order detail by ID.
    function getOrder(uint256 orderId)
        external
        view
        orderExists(orderId)
        returns (Order memory)
    {
        return orders[orderId];
    }

    /// @notice Convenience: calculate fee on a gross amount.
    function calculateFee(uint256 gross) external view returns (uint256) {
        return (gross * feeBasisPoints) / 10_000;
    }
}
