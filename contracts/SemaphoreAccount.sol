// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@account-abstraction/contracts/core/BaseAccount.sol";
import "./semaphore/Semaphore.sol";
import "./semaphore/interfaces/ISemaphoreVerifier.sol";

contract SemaphoreAccount is BaseAccount, UUPSUpgradeable, Initializable {
    Semaphore public semaphore;
    uint256 public groupId;
    IEntryPoint private immutable _entryPoint;
    ISemaphoreVerifier verifier;
    uint256 _currentMerkleRoot;

    event SemaphoreAccountInitialized(
        IEntryPoint indexed entryPoint,
        uint256 indexed groupId
    );

    modifier verifyGroup() {
        uint256 latestMerkleRoot = semaphore.getMerkleTreeRoot(groupId);
        if (_currentMerkleRoot != latestMerkleRoot) {
            _currentMerkleRoot = latestMerkleRoot;
            revert("SemaphoreAccount: invalid merkle root used in proof");
        }
        _;
    }

    constructor(IEntryPoint anEntryPoint) {
        _entryPoint = anEntryPoint;
        // _disableInitializers();
    }

    function initialize(
        address _semaphoreAddress,
        address _verifierAdress,
        uint256 _groupId
    ) public virtual initializer {
        groupId = _groupId;
        semaphore = Semaphore(_semaphoreAddress);
        verifier = ISemaphoreVerifier(_verifierAdress);

        emit SemaphoreAccountInitialized(_entryPoint, _groupId);
    }

    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    receive() external payable {}

    function execute(
        address dest,
        uint256 value,
        bytes calldata func
    ) external verifyGroup {
        _requireFromEntryPoint();
        _call(dest, value, func);
    }

    function executeBatch(
        address[] calldata dest,
        bytes[] calldata func
    ) external {
        _requireFromEntryPoint();
        require(dest.length == func.length, "wrong array lengths");
        for (uint256 i = 0; i < dest.length; i++) {
            _call(dest[i], 0, func[i]);
        }
    }

    // Validate signature for the UserOperation
    // ZK Proof of membership and some inputs are encoded in `signature`
    function _validateSignature(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) internal virtual override returns (uint256 validationData) {
        // Decode proof + inputs from signature
        (
            uint256[8] memory proof,
            uint256 merkleTreeRoot,
            uint256 merkleTreeDepth,
            uint256 nullifierHash
        ) = abi.decode(
                userOp.signature,
                (uint256[8], uint256, uint256, uint256)
            );
        uint256 signal = uint256(userOpHash);

        try
            verifier.verifyProof(
                merkleTreeRoot,
                nullifierHash,
                signal, // Signal
                0, // External nullifier
                proof,
                merkleTreeDepth
            )
        {
            // Set merkle root used for verification in storage
            // This will be validated during execution
            _currentMerkleRoot = merkleTreeRoot;

            return 0; // 0 returned means signature valid as per 4337
        } catch (bytes memory reason) {
            return 1;
        }
    }

    function _call(address target, uint256 value, bytes memory data) internal {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    // /**
    //  * check current account deposit in the entryPoint
    //  */
    // function getDeposit() public view returns (uint256) {
    //     return entryPoint().balanceOf(address(this));
    // }

    // /**
    //  * deposit more funds for this account in the entryPoint
    //  */
    // function addDeposit() public payable {
    //     entryPoint().depositTo{value: msg.value}(address(this));
    // }

    // /**
    //  * withdraw value from the account's deposit
    //  */
    // function withdrawDepositTo(
    //     address payable withdrawAddress,
    //     uint256 amount
    // ) public onlyOwner {
    //     entryPoint().withdrawTo(withdrawAddress, amount);
    // }

    function _authorizeUpgrade(
        address newImplementation
    ) internal view override {
        (newImplementation);
        // _onlyOwner();
    }
}
