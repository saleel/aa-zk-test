import { expect } from "chai";
import hre from "hardhat";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import {
  SemaphoreAccount__factory,
  Semaphore,
  SemaphoreAccountFactory__factory,
  SemaphoreAccountFactory,
} from "../types";
import {
  defaultAbiCoder,
  formatEther,
  hexConcat,
  parseEther,
} from "ethers/lib/utils";
import { generateProof } from "@semaphore-protocol/proof";
import { UserOperation, getUserOpHash } from "./helpers";
import { BigNumber, Signer } from "ethers";
import { Provider } from "@ethersproject/abstract-provider";
import { EntryPoint__factory } from "@account-abstraction/contracts";
import fetch from "node-fetch";

// Based on https://github.com/eth-infinitism/bundler#running-local-node
const BUNDLER_URL = "http://localhost:3000/rpc";
const ENTRYPOINT_ADDRESS = "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789";

const wasmFilePath = `snark-artifacts/semaphore.wasm`;
const zkeyFilePath = `snark-artifacts/semaphore.zkey`;

const { ethers } = hre;

describe("#e2e", () => {
  let ethersProvider: Provider;
  let ethersSigner: Signer;
  let accounts: string[];

  let semaphoreContract: Semaphore;
  let factoryContract: SemaphoreAccountFactory;
  let identity: Identity;
  let group: Group;

  before(async () => {
    ethersProvider = ethers.provider;
    accounts = (await ethers.getSigners()).map((s) => s.address);
    ethersSigner = await ethers.getSigner(accounts[0]);

    // Deploy semaphore contract to local network
    ({ semaphore: semaphoreContract } = (await hre.run("deploy:semaphore")) as {
      semaphore: Semaphore;
    });

    // Create new semaphore on-chain group
    const groupId = 2023;
    await semaphoreContract["createGroup(uint256,uint256,address)"](
      groupId,
      20, // tree depth
      accounts[0] // admin of the group
    );

    // Generate new semaphore identity and add to group
    identity = new Identity();
    await semaphoreContract.addMember(2023, identity.commitment);

    // Construct a local copy of same group
    group = new Group(groupId, 20, [identity.commitment]);

    // Deploy account factory
    factoryContract = await new SemaphoreAccountFactory__factory(
      ethersSigner
    ).deploy(ENTRYPOINT_ADDRESS, semaphoreContract.address);

    console.log("Factory address: ", factoryContract.address);
  });

  it("should send UserOp to the bundler to have the wallet created and transfer some eth", async () => {
    const salt = Math.round(Math.random() * 100000);
    const walletAddress = await factoryContract.getAddress(2023, salt);

    console.log("Counterfactual Wallet address: ", walletAddress);

    // Transfer 1ETH to the future account
    await ethersSigner.sendTransaction({
      from: accounts[0],
      to: walletAddress,
      value: parseEther("1"),
    });
    const initialBalance = await ethersProvider.getBalance(walletAddress);

    const entrypointContract = EntryPoint__factory.connect(
      ENTRYPOINT_ADDRESS,
      ethersSigner
    );

    // Add some deposit in entry point contract for the wallet
    // This is optional - if there is no deposit, then wallet need to pay the fee from the wallet balance
    // If deposit is positive, entry point deduct from that
    await entrypointContract.depositTo(walletAddress, {
      value: parseEther("1"),
    });

    // Our wallet access external contract storage slots (Semaphore data)
    // Factory contract creating such wallets needs to add a stake to prevent abuse
    await factoryContract.addStake(24 * 60 * 60, { value: parseEther("2") });

    // Create a random wallet and use our contract wallet to send money to that
    const randomWallet = ethers.Wallet.createRandom();
    const transferAmount = parseEther("0.2");
    const transferEthCallData =
      SemaphoreAccount__factory.createInterface().encodeFunctionData(
        "execute",
        [
          randomWallet.address, // recipient
          transferAmount, // amount
          "0x", // no need of data
        ]
      );

    // Create UserOp
    const userOp = {
      sender: walletAddress,
      nonce: BigNumber.from(2).shl(64).toHexString(),
      initCode: hexConcat([
        factoryContract.address,
        factoryContract.interface.encodeFunctionData("createAccount", [
          group.id,
          salt,
        ]),
      ]),
      callData: transferEthCallData,
      callGasLimit: BigNumber.from(2000000).toHexString(),
      verificationGasLimit: BigNumber.from(1000000).toHexString(),
      maxFeePerGas: BigNumber.from(3e9).toHexString(),
      preVerificationGas: BigNumber.from(50000).toHexString(),
      maxPriorityFeePerGas: BigNumber.from(1e9).toHexString(),
      paymasterAndData: "0x",
      signature: "0x", // This will be changed later
    };

    const chainId = await ethers.provider
      .getNetwork()
      .then((net) => net.chainId);
    const userOpHash = await getUserOpHash(userOp, ENTRYPOINT_ADDRESS, chainId);

    // Generate proof of membership
    const externalNullifier = 0; // Not needed - 0 used in the contract
    const signal = userOpHash; // Hash of UserOperation is the signal
    const fullProof = await generateProof(
      identity,
      group,
      externalNullifier,
      signal,
      {
        wasmFilePath,
        zkeyFilePath,
      }
    );

    // Encode proof and inputs as signature
    userOp.signature = defaultAbiCoder.encode(
      ["uint256[8]", "uint256", "uint256", "uint256"],
      [
        fullProof.proof,
        fullProof.merkleTreeRoot,
        group.depth,
        fullProof.nullifierHash,
      ]
    );

    // Send UserOp to the bundler
    const responseRaw = await fetch(BUNDLER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method: "eth_sendUserOperation",
        params: [userOp, ENTRYPOINT_ADDRESS],
      }),
    });

    const response = await responseRaw.json();
    console.log("Bundler response", response);

    expect(response.result).to.be.equal(userOpHash);

    // Sleep for 5 seconds - for the Bundler to send UserOp to the network
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Wallet contract should have been created
    expect(await ethersProvider.getCode(walletAddress)).to.not.be.equal("0x");

    const currentWalletBalance = formatEther(
      await ethersProvider.getBalance(walletAddress)
    );
    const randomWalletBalance = formatEther(
      await ethersProvider.getBalance(randomWallet.address)
    );

    // Balance of wallet should be 0.8 ETH (1 - 0.2)
    expect(currentWalletBalance).to.be.equal(
      formatEther(initialBalance.sub(transferAmount))
    );

    // Balance of random wallet should be 0.2 ETH
    expect(randomWalletBalance).to.be.equal(formatEther(transferAmount));
  });
});
