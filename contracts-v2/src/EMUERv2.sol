// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Fixed-supply EMUER for SchoolPark, deployed on Polygon PoS.
/// @dev Free transfers and allowances are disabled. Opaque IDs must not contain personal data.
contract EMUERv2 is ERC20, AccessControlDefaultAdminRules, Pausable, EIP712 {
    using ECDSA for bytes32;

    uint256 public constant INITIAL_SUPPLY = 10_000_000 ether;
    uint256 public constant MONTHLY_REWARD_CAP = 416_000 ether;
    uint256 public constant START_TIMESTAMP = 1_790_780_400; // 2026-10-01 00:00 JST
    uint256 private constant JST_OFFSET = 9 hours;

    bytes32 public constant AUTHORIZER_ROLE = keccak256("AUTHORIZER_ROLE");
    bytes32 public constant REFUND_ROLE = keccak256("REFUND_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant REWARD_TYPEHASH = keccak256(
        "Reward(bytes32 claimId,address recipient,uint256 totalAmount,uint256 deadline)"
    );
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(bytes32 orderId,bytes32 productId,address buyer,uint256 price,uint256 deadline)"
    );

    address public immutable treasury;
    mapping(bytes32 => uint256) public claimPaid;
    mapping(bytes32 => address) public claimRecipient;
    mapping(bytes32 => uint256) public claimAuthorizedTotal;
    mapping(bytes32 => bool) public claimRevoked;
    mapping(uint256 => uint256) public rewardsPaidByMonth;
    uint256 public reservedForRefunds;

    struct OrderRecord {
        address buyer;
        bytes32 productId;
        uint256 paid;
        bool fulfilled;
        bool refunded;
    }
    mapping(bytes32 => OrderRecord) public orders;

    error FreeTransferDisabled();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidId();
    error AuthorizationExpired();
    error InvalidAuthorization();
    error ClaimUnavailable();
    error MonthlyCapReached();
    error OrderUnavailable();
    error AlreadyRefunded();
    error NotStarted();

    event RewardClaimed(
        bytes32 indexed claimId, address indexed recipient, uint256 paidNow,
        uint256 paidTotal, uint256 authorizedTotal, uint256 monthId
    );
    event ClaimRevoked(bytes32 indexed claimId);
    event Exchanged(
        bytes32 indexed orderId, bytes32 indexed productId, address indexed buyer, uint256 price
    );
    event ExchangeFulfilled(bytes32 indexed orderId);
    event ExchangeRefunded(bytes32 indexed orderId, address indexed buyer, uint256 amount);

    constructor(address adminAndTreasury, uint48 adminTransferDelay)
        ERC20("Emuer", "EMUER")
        AccessControlDefaultAdminRules(adminTransferDelay, adminAndTreasury)
        EIP712("Emuer", "2")
    {
        if (adminAndTreasury == address(0)) revert InvalidAddress();
        treasury = adminAndTreasury;
        _grantRole(AUTHORIZER_ROLE, adminAndTreasury);
        _grantRole(REFUND_ROLE, adminAndTreasury);
        _grantRole(PAUSER_ROLE, adminAndTreasury);
        _mint(adminAndTreasury, INITIAL_SUPPLY);
    }

    function transfer(address, uint256) public pure override returns (bool) {
        revert FreeTransferDisabled();
    }
    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert FreeTransferDisabled();
    }
    function approve(address, uint256) public pure override returns (bool) {
        revert FreeTransferDisabled();
    }
    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) revert FreeTransferDisabled();
        super._update(from, to, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    /// @notice Recipient pays gas. A claim can be paid across months with the same authorization.
    function claimReward(
        bytes32 claimId, uint256 totalAmount, uint256 deadline, bytes calldata authorization
    ) external whenNotPaused returns (uint256 paidNow) {
        if (block.timestamp < START_TIMESTAMP) revert NotStarted();
        if (claimId == bytes32(0)) revert InvalidId();
        if (totalAmount == 0) revert InvalidAmount();
        if (block.timestamp > deadline) revert AuthorizationExpired();
        if (claimRevoked[claimId]) revert ClaimUnavailable();
        _verifyRewardAuthorization(claimId, msg.sender, totalAmount, deadline, authorization);

        uint256 already = claimPaid[claimId];
        address boundRecipient = claimRecipient[claimId];
        if (boundRecipient == address(0)) {
            claimRecipient[claimId] = msg.sender;
            claimAuthorizedTotal[claimId] = totalAmount;
        } else if (boundRecipient != msg.sender || claimAuthorizedTotal[claimId] != totalAmount) {
            revert ClaimUnavailable();
        }
        if (already >= totalAmount) revert ClaimUnavailable();
        uint256 month = currentJstMonthId();
        uint256 monthRemaining = MONTHLY_REWARD_CAP - rewardsPaidByMonth[month];
        if (monthRemaining == 0) revert MonthlyCapReached();
        uint256 remaining = totalAmount - already;
        uint256 treasuryBalance = balanceOf(treasury) - reservedForRefunds;
        paidNow = _min(_min(remaining, monthRemaining), treasuryBalance);
        if (paidNow == 0) revert ClaimUnavailable();

        claimPaid[claimId] = already + paidNow;
        rewardsPaidByMonth[month] += paidNow;
        _restrictedMove(treasury, msg.sender, paidNow);
        emit RewardClaimed(claimId, msg.sender, paidNow, already + paidNow, totalAmount, month);
    }

    /// @notice Revokes only an unpaid remainder; it never recovers a user's balance.
    function _verifyRewardAuthorization(
        bytes32 claimId, address recipient, uint256 totalAmount, uint256 deadline,
        bytes calldata authorization
    ) private view {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            REWARD_TYPEHASH, claimId, recipient, totalAmount, deadline
        )));
        if (!hasRole(AUTHORIZER_ROLE, digest.recover(authorization))) revert InvalidAuthorization();
    }

    function revokeClaim(bytes32 claimId) external onlyRole(AUTHORIZER_ROLE) {
        if (claimId == bytes32(0)) revert InvalidId();
        claimRevoked[claimId] = true;
        emit ClaimRevoked(claimId);
    }

    /// @notice Buyer pays gas. The signed order proves plan eligibility and an exact quote.
    function exchange(
        bytes32 orderId, bytes32 productId, uint256 price, uint256 deadline,
        bytes calldata authorization
    ) external whenNotPaused {
        if (block.timestamp < START_TIMESTAMP) revert NotStarted();
        if (orderId == bytes32(0) || productId == bytes32(0)) revert InvalidId();
        if (price == 0) revert InvalidAmount();
        if (block.timestamp > deadline) revert AuthorizationExpired();
        if (orders[orderId].buyer != address(0)) revert OrderUnavailable();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            ORDER_TYPEHASH, orderId, productId, msg.sender, price, deadline
        )));
        address signer = digest.recover(authorization);
        if (!hasRole(AUTHORIZER_ROLE, signer)) revert InvalidAuthorization();

        orders[orderId] = OrderRecord(msg.sender, productId, price, false, false);
        reservedForRefunds += price;
        _restrictedMove(msg.sender, treasury, price);
        emit Exchanged(orderId, productId, msg.sender, price);
    }

    /// @notice Releases refund reserves only after the promised item/service was provided.
    function markExchangeFulfilled(bytes32 orderId) external onlyRole(REFUND_ROLE) {
        OrderRecord storage order = orders[orderId];
        if (order.buyer == address(0) || order.fulfilled || order.refunded) revert OrderUnavailable();
        order.fulfilled = true;
        reservedForRefunds -= order.paid;
        emit ExchangeFulfilled(orderId);
    }

    /// @notice Full operator-side refund to the original buyer. It does not change reward cap use.
    function refundExchange(bytes32 orderId) external onlyRole(REFUND_ROLE) {
        OrderRecord storage order = orders[orderId];
        if (order.buyer == address(0)) revert OrderUnavailable();
        if (order.fulfilled) revert OrderUnavailable();
        if (order.refunded) revert AlreadyRefunded();
        order.refunded = true;
        reservedForRefunds -= order.paid;
        _restrictedMove(treasury, order.buyer, order.paid);
        emit ExchangeRefunded(orderId, order.buyer, order.paid);
    }

    function currentJstMonthId() public view returns (uint256) {
        return _monthId(block.timestamp);
    }

    /// @dev Gregorian year*12 + zero-based month, after applying JST (+09:00).
    function _monthId(uint256 timestamp) internal pure returns (uint256) {
        (uint256 year, uint256 month,) = _daysToDate((timestamp + JST_OFFSET) / 1 days);
        return year * 12 + month - 1;
    }

    // Adapted from the public-domain BokkyPooBah DateTime Library algorithm.
    function _daysToDate(uint256 _days) internal pure returns (uint256 year, uint256 month, uint256 day) {
        int256 __days = int256(_days);
        int256 L = __days + 68569 + 2440588;
        int256 N = 4 * L / 146097;
        L = L - (146097 * N + 3) / 4;
        int256 _year = 4000 * (L + 1) / 1461001;
        L = L - 1461 * _year / 4 + 31;
        int256 _month = 80 * L / 2447;
        int256 _day = L - 2447 * _month / 80;
        L = _month / 11;
        _month = _month + 2 - 12 * L;
        _year = 100 * (N - 49) + _year + L;
        return (uint256(_year), uint256(_month), uint256(_day));
    }

    function _restrictedMove(address from, address to, uint256 amount) private {
        super._update(from, to, amount);
    }
    function _min(uint256 a, uint256 b) private pure returns (uint256) { return a < b ? a : b; }
}
