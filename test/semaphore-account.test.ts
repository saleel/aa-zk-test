// import { expect } from "chai";
// import { ethers, run } from "hardhat";
// import { Identity } from "@semaphore-protocol/identity";
// import { Group } from "@semaphore-protocol/group";
// import {
//   SemaphoreAccount,
//   SemaphoreAccount__factory,
//   Semaphore,
//   SemaphoreAccountFactory__factory,
// } from "../types";
// import { defaultAbiCoder, parseEther } from "ethers/lib/utils";
// import { generateProof } from "@semaphore-protocol/proof";
// import { UserOperation, getUserOpHash } from "./helpers";
// import { Signer } from "ethers";

// describe("#validateSignature", () => {
//   let accounts: string[];
//   let account: SemaphoreAccount;
//   let userOpHash: string;
//   let semaphoreContract: Semaphore;
//   let ethersSigner: Signer;

//   // for testing directly validateUserOp, we initialize the account with EOA as entryPoint.
//   let entryPointEoa: string;

//   const wasmFilePath = `snark-artifacts/semaphore.wasm`;
//   const zkeyFilePath = `snark-artifacts/semaphore.zkey`;

//   before(async () => {
//     accounts = await ethers.provider.listAccounts();
//     ethersSigner = await ethers.getSigner(accounts[0]);

//     ({ semaphore: semaphoreContract } = (await run("deploy:semaphore")) as {
//       semaphore: Semaphore;
//     });

//     entryPointEoa = accounts[0]; // Use a normal account as entry point for testing
//     const epAsSigner = await ethers.getSigner(entryPointEoa);

//     const factoryContract = await new SemaphoreAccountFactory__factory(
//       ethersSigner
//     ).deploy(entryPointEoa, semaphoreContract.address);

//     const walletAddress = await factoryContract.getAddress(2023, 100);

//     await factoryContract.createAccount(2023, 100);

//     account = SemaphoreAccount__factory.connect(walletAddress, epAsSigner);
//   });

//   it("should verify signature for valid semaphore proof", async () => {
//     await ethersSigner.sendTransaction({
//       from: accounts[0],
//       to: account.address,
//       value: parseEther("0.2"),
//     });

//     const callGasLimit = 200000;
//     const verificationGasLimit = 100000;
//     const maxFeePerGas = 3e9;
//     const chainId = await ethers.provider
//       .getNetwork()
//       .then((net) => net.chainId);

//     const userOp = {
//       sender: account.address,
//       nonce: 1,
//       initCode: "0x",
//       callData: "0x",
//       callGasLimit,
//       verificationGasLimit,
//       maxFeePerGas,
//       preVerificationGas: 21000, // should also cover calldata cost.
//       maxPriorityFeePerGas: 1e9,
//       paymasterAndData: "0x",
//       signature: "0x",
//     };

//     userOpHash = await getUserOpHash(userOp, entryPointEoa, chainId);

//     // Generate new semaphore identity
//     const identity = new Identity();

//     // Create new semaphore on-chain group
//     const groupId = 2023;
//     await semaphoreContract["createGroup(uint256,uint256,address)"](
//       groupId,
//       20, // tree depth
//       accounts[0]
//     );

//     // Add member to semaphore group on-chain
//     await semaphoreContract.addMember(2023, identity.commitment);

//     // Construct a local copy of same group
//     const group = new Group(groupId, 20, [identity.commitment]);

//     // Generate proof of membership
//     const externalNullifier = 0; // Not needed
//     const signal = userOpHash; // Hash of UserOperation is the signal

//     const fullProof = await generateProof(
//       identity,
//       group,
//       externalNullifier,
//       signal,
//       {
//         wasmFilePath,
//         zkeyFilePath,
//       }
//     );

//     userOp.signature = defaultAbiCoder.encode(
//       ["uint256[8]", "uint256"],
//       [fullProof.proof, fullProof.nullifierHash]
//     );

//     const returnValue = await account.callStatic.validateUserOp(
//       userOp,
//       userOpHash.toString(),
//       0
//     );

//     expect(returnValue.toNumber()).to.eq(0);
//   });
// });
