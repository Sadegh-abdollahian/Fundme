const { assert, expect } = require("chai")
const { network, deployments, ethers } = require("hardhat")
const { developmentChains } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("FundMe", () => {
          let fundMe
          let mockV3Aggregator
          let deployer
          const sendValue = ethers.utils.parseEther("1")
          // these two are for customRefund function
          const fewDollars = ethers.utils.parseEther("0.000001")
          const moreDollars = ethers.utils.parseEther("0.05")
          // zero address for changeOwenership function
          const zeroAddress = "0x0000000000000000000000000000000000000000"
          beforeEach(async () => {
              // const accounts = await ethers.getSigners()
              // deployer = accounts[0]
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              fundMe = await ethers.getContract("FundMe", deployer)
              mockV3Aggregator = await ethers.getContract(
                  "MockV3Aggregator",
                  deployer,
              )
              const fundFunction = async () => {
                  await fundMe.fund({ value: sendValue })
              }
          })

          describe("constructor", () => {
              it("sets the aggregator addresses correctly", async () => {
                  const response = await fundMe.getPriceFeed()
                  assert.equal(response, mockV3Aggregator.address)
              })
          })

          describe("fund", () => {
              // https://ethereum-waffle.readthedocs.io/en/latest/matchers.html
              // could also do assert.fail
              it("Fails if you don't send enough ETH", async () => {
                  await expect(fundMe.fund()).to.be.revertedWith(
                      "You need to spend more ETH!",
                  )
              })
              it("s_refunded of msg.sender sould be false", async () => {
                  await fundMe.fund({ value: sendValue })
                  const response = await fundMe.getReFund()
                  assert.equal(false, response)
              })
              // we could be even more precise here by making sure exactly $50 works
              // but this is good enough for now
              it("Updates the amount funded data structure", async () => {
                  await fundMe.fund({ value: sendValue })
                  const response =
                      await fundMe.getAddressToAmountFunded(deployer)
                  assert.equal(response.toString(), sendValue.toString())
              })
              it("Adds funder to array of funders", async () => {
                  await fundMe.fund({ value: sendValue })
                  const response = await fundMe.getFunder(0)
                  assert.equal(response, deployer)
              })
              it("should emit Fund", async () => {
                  await expect(fundMe.fund({ value: sendValue }))
                      .to.emit(fundMe, "Fund")
                      .withArgs(deployer, sendValue)
              })
          })
          describe("changeOwnership", () => {
              it("Fails if new-owner was a zero (contract) address", async () => {
                  await expect(
                      fundMe.changeOwnership(zeroAddress),
                  ).to.be.revertedWith("change owner to zero address")
              })
              it("owner should be changed", async () => {
                  const oldOwner = await fundMe.getOwner()
                  await fundMe.changeOwnership(
                      "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199",
                  )
                  assert.notEqual(oldOwner, await fundMe.getOwner())
              })
              it("should emit OwnerChanged", async () => {
                  const newOwnerAccount =
                      "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199"
                  await expect(fundMe.changeOwnership(newOwnerAccount))
                      .to.emit(fundMe, "OwnerChanged")
                      .withArgs(deployer, newOwnerAccount)
              })
          })
          describe("refund", () => {
              beforeEach(async () => {
                  await fundMe.fund({ value: sendValue })
              })
              it("Fails if the goal was reached", async () => {
                  await fundMe.updateGoal(60)
                  await fundMe.checkGoalReached()
                  await expect(fundMe.refund()).to.be.revertedWith(
                      "Refunds are not available",
                  )
              })
              it("Fails if there is no fund in the contract", async () => {
                  // withdraw to reset the funds
                  await fundMe.withdraw()
                  await expect(fundMe.refund()).to.be.revertedWith(
                      "No funds to refund",
                  )
              })
              it("Fails if the funder already refunded", async () => {
                  await fundMe.refund()
                  await expect(fundMe.refund()).to.be.revertedWith(
                      "Refund already processed",
                  )
              })
              it("funded amount of msg.sender should be zero", async () => {
                  await fundMe.refund()
                  const response =
                      await fundMe.getAddressToAmountFunded(deployer)
                  assert.equal(0, response)
              })
              it("refund of msg.sender should be true", async () => {
                  await fundMe.refund()
                  const response = await fundMe.getReFund()
                  assert.equal(true, response)
              })
              it("should emit Refund", async () => {
                  const refundAmount =
                      await fundMe.getAddressToAmountFunded(deployer)
                  await expect(fundMe.refund())
                      .to.emit(fundMe, "Refund")
                      .withArgs(deployer, refundAmount)
              })
          })
          describe("customRefund", () => {
              it("Fails if the goal was reached", async () => {
                  await fundMe.updateGoal(60)
                  await fundMe.fund({ value: sendValue })
                  await fundMe.checkGoalReached()
                  await expect(
                      fundMe.customRefund(fewDollars),
                  ).to.be.revertedWith("Refunds are not available")
              })
              it("Fails if there is now fund in the contract", async () => {
                  await expect(
                      fundMe.customRefund(fewDollars),
                  ).to.be.revertedWith("No funds to refund")
              })
              it("Fails if the funder already refunded", async () => {
                  await fundMe.fund({ value: sendValue })
                  await fundMe.refund()
                  await expect(
                      fundMe.customRefund(fewDollars),
                  ).to.be.revertedWith("Refund already processed")
              })
              it("Fails if the funder choose lower fund than 10 usd", async () => {
                  await fundMe.fund({ value: sendValue })
                  await expect(
                      fundMe.customRefund(fewDollars),
                  ).to.be.revertedWith("you need to choose more fund")
              })
              it("Fails if the msg.value was equal to amount of refund", async () => {
                  await fundMe.fund({ value: sendValue })
                  await expect(
                      fundMe.customRefund(moreDollars),
                  ).to.be.revertedWith("please call refund function")
              })
          })
          describe("refundAll", () => {
              beforeEach(async () => {
                  await fundMe.fund({ value: sendValue })
              })
              it("funded amount of msg.sender should be zero", async () => {
                  await fundMe.refundAll()
                  const response =
                      await fundMe.getAddressToAmountFunded(deployer)
                  assert.equal(0, response)
              })
              it("refund of msg.sender should be true", async () => {
                  await fundMe.refundAll()
                  const response = await fundMe.getReFund()
                  assert.equal(true, response)
              })
              it("should emit RefundAll", async () => {
                  // There may be differences in testing time depending
                  // on the power of the device
                  const refundAmount =
                      await fundMe.getAddressToAmountFunded(deployer)
                  await expect(fundMe.refundAll())
                      .to.emit(fundMe, "RefundAll")
                      .withArgs(deployer, refundAmount)
              })
          })
          describe("checkGoalReached", () => {
              it("goalReached should be false", async () => {
                  const response = await fundMe.getGoalReached()
                  assert.equal(false, response)
              })
              it("goalReached should be true after fund", async () => {
                  await fundMe.updateGoal(60)
                  await fundMe.fund({ value: sendValue })
                  await fundMe.checkGoalReached()
                  const response = await fundMe.getGoalReached()
                  assert.equal(true, response)
              })
          })
          describe("updateGoal", () => {
              beforeEach(async () => {
                  await fundMe.updateGoal(6000)
              })
              it("goalReached should be false", async () => {
                  const isGoalReached = await fundMe.getGoalReached()
                  assert.equal(false, isGoalReached)
              })
              it("should be equal to new goal", async () => {
                  const newFundingGoal =
                      (await fundMe.getFundingGoal()) / 10 ** 18
                  assert.equal(6000, newFundingGoal)
              })
          })
          describe("withdraw", () => {
              beforeEach(async () => {
                  await fundMe.fund({ value: sendValue })
              })
              it("withdraws ETH from a single funder", async () => {
                  // Arrange
                  const startingFundMeBalance =
                      await fundMe.provider.getBalance(fundMe.address)
                  const startingDeployerBalance =
                      await fundMe.provider.getBalance(deployer)

                  // Act
                  const transactionResponse = await fundMe.withdraw()
                  const transactionReceipt = await transactionResponse.wait()
                  const { gasUsed, effectiveGasPrice } = transactionReceipt
                  const gasCost = gasUsed.mul(effectiveGasPrice)

                  const endingFundMeBalance = await fundMe.provider.getBalance(
                      fundMe.address,
                  )
                  const endingDeployerBalance =
                      await fundMe.provider.getBalance(deployer)

                  // Assert
                  // Maybe clean up to understand the testing
                  assert.equal(endingFundMeBalance, 0)
                  assert.equal(
                      startingFundMeBalance
                          .add(startingDeployerBalance)
                          .toString(),
                      endingDeployerBalance.add(gasCost).toString(),
                  )
              })
              it("Only allows the owner to withdraw", async function () {
                  const accounts = await ethers.getSigners()
                  const nonOwner = accounts[1]
                  const nonOwnerFundMe = fundMe.connect(nonOwner)
                  await expect(nonOwnerFundMe.withdraw()).to.be.revertedWith(
                      "FundMe__NotOwner",
                  )
              })
          })
      })
