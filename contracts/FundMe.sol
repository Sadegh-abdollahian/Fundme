// SPDX-License-Identifier: MIT
// 1. Pragma
pragma solidity ^0.8.7;
// 2. Imports
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {PriceConverter} from "./PriceConverter.sol";

// 3. Interfaces, Libraries, Contracts
error FundMe__NotOwner();

/**@title A sample Funding Contract
 * @author Patrick Collins
 * @notice This contract is for creating a sample funding contract
 * @dev This implements price feeds as our library
 */
contract FundMe is Context {
    // Type Declarations
    using PriceConverter for uint256;

    // State variables
    uint256 public constant MINIMUM_USD = 50 * 10 ** 18;
    uint256 public fundingGoal = 5000 * 10 ** 18;
    address private i_owner;
    address[] private s_funders;
    bool private goalReached;
    mapping(address => uint256) private s_addressToAmountFunded;
    mapping(address => bool) private s_refunded;
    AggregatorV3Interface private s_priceFeed;

    // Events
    event RefundAll(address owner, uint256 amount);
    event Withdraw(address owner, uint256 amount);
    event Refund(address funder, uint256 amount);
    event OwnerChanged(address from, address to);
    event Fund(address funder, uint amount);
    event GoalReached(uint256 amount);

    // Modifiers
    modifier onlyOwner() {
        // require(msg.sender == i_owner);
        if (_msgSender() != i_owner) revert FundMe__NotOwner();
        _;
    }

    /**
     * @dev this modifier is for "refund" and "customRefund" functions
     */
    modifier refundRequires() {
        require(!goalReached, "Refunds are not available");
        require(!s_refunded[_msgSender()], "Refund already processed");
        require(
            s_addressToAmountFunded[_msgSender()] > 0,
            "No funds to refund"
        );
        _;
    }

    // Functions Order:
    //// constructor
    //// receive
    //// fallback
    //// external
    //// public
    //// internal
    //// private
    //// view / pure

    constructor(address priceFeed) {
        s_priceFeed = AggregatorV3Interface(priceFeed);
        i_owner = _msgSender();
    }

    /// @notice Funds of our contract based on the ETH/USD price
    function fund() public payable {
        require(
            msg.value.getConversionRate(s_priceFeed) >= MINIMUM_USD,
            "You need to spend more ETH!"
        );
        // require(PriceConverter.getConversionRate(msg.value) >= MINIMUM_USD, "You need to spend more ETH!");
        s_refunded[_msgSender()] = false;
        s_addressToAmountFunded[_msgSender()] += msg.value;
        s_funders.push(_msgSender());
        emit Fund(_msgSender(), msg.value);

        checkGoalReached();
    }

    /**
        @notice change the ownership
    *   @param newOwner address
    */
    function changeOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "change owner to zero address");

        i_owner = newOwner;

        emit OwnerChanged(_msgSender(), newOwner);
    }

    /**
        @dev chack that goal does not reached and the msg.sender did not refund befor then refund
    */
    function refund() public refundRequires {
        uint256 refundAmount = s_addressToAmountFunded[_msgSender()];
        s_addressToAmountFunded[_msgSender()] = 0;
        s_refunded[_msgSender()] = true;

        (bool success, ) = _msgSender().call{value: refundAmount}("");
        require(success, "Transfer failed");

        emit Refund(_msgSender(), refundAmount);
    }

    /**
        @notice refund with custom amount of fund
    */
    function customRefund(uint256 amount) public payable refundRequires {
        require(
            amount.getConversionRate(s_priceFeed) >= 10 * 10 ** 18,
            "you need to choose more fund"
        );
        require(
            amount == s_addressToAmountFunded[_msgSender()],
            "please call refund function"
        );
        s_addressToAmountFunded[_msgSender()] =
            s_addressToAmountFunded[_msgSender()] -
            amount;
        (bool success, ) = _msgSender().call{value: amount}("");
        require(success, "Transfer failed");

        emit Refund(_msgSender(), amount);
    }

    /**
        @notice refund all of funds in a loop
     */
    function refundAll() public onlyOwner {
        // for gas optimization
        address[] memory funders = s_funders;
        // get all of the accounts and refund them
        uint256 refundAmount;
        for (uint256 i = 0; i < funders.length; i++) {
            address funder = funders[i];
            if (!s_refunded[funder]) {
                uint256 amount = s_addressToAmountFunded[funder];
                s_addressToAmountFunded[funder] = 0;
                s_refunded[funder] = true;
                payable(funder).transfer(amount);

                refundAmount += amount;
            }
        }

        emit RefundAll(i_owner, refundAmount);
    }

    function withdraw() public onlyOwner {
        resetFunders();
        uint256 contractBalance = address(this).balance;
        // Transfer vs call vs Send
        // payable(msg.sender).transfer(contractBalance);
        (bool success, ) = i_owner.call{value: contractBalance}("");
        require(success, "Transfer failed");
        emit Withdraw(i_owner, contractBalance);
    }

    function cheaperWithdraw() public onlyOwner {
        address[] memory funders = s_funders;
        // mappings can't be in memory, sorry!
        for (
            uint256 funderIndex = 0;
            funderIndex < funders.length;
            funderIndex++
        ) {
            address funder = funders[funderIndex];
            s_addressToAmountFunded[funder] = 0;
        }
        s_funders = new address[](0);
        // payable(msg.sender).transfer(address(this).balance);
        (bool success, ) = i_owner.call{value: address(this).balance}("");
        require(success, "Transfer failed");
    }

    /**
        @dev the owner can update the goal whatever he/she want
     */
    function updateGoal(uint256 newGoalAsUsd) public onlyOwner {
        if (newGoalAsUsd > fundingGoal / 10 ** 18) {
            goalReached = false;
        }
        fundingGoal = newGoalAsUsd * 10 ** 18;
    }

    /**
        @notice a function for fund() that check if the goal was reached, withdraw the funds
     */
    function checkGoalReached() public onlyOwner {
        if (
            !goalReached &&
            address(this).balance.getConversionRate(s_priceFeed) >= fundingGoal
        ) {
            goalReached = true;
            withdraw();

            emit GoalReached(
                address(this).balance.getConversionRate(s_priceFeed)
            );
        }
    }

    /**
        @notice this is a part of the withdraw function
     */
    function resetFunders() private {
        for (
            uint256 funderIndex = 0;
            funderIndex < s_funders.length;
            funderIndex++
        ) {
            address funder = s_funders[funderIndex];
            s_addressToAmountFunded[funder] = 0;
        }
        s_funders = new address[](0);
    }

    /** @notice Gets the amount that an address has funded
     *  @param fundingAddress the address of the funder
     *  @return the amount funded
     */
    function getAddressToAmountFunded(
        address fundingAddress
    ) public view returns (uint256) {
        return s_addressToAmountFunded[fundingAddress];
    }

    function getVersion() public view returns (uint256) {
        return s_priceFeed.version();
    }

    function getFunder(uint256 index) public view returns (address) {
        return s_funders[index];
    }

    function getOwner() public view returns (address) {
        return i_owner;
    }

    function getPriceFeed() public view returns (AggregatorV3Interface) {
        return s_priceFeed;
    }

    function getFundingGoal() public view returns (uint256) {
        return fundingGoal;
    }

    function getGoalReached() public view returns (bool) {
        return goalReached;
    }

    function getReFund() public view returns (bool) {
        return s_refunded[_msgSender()];
    }
}
