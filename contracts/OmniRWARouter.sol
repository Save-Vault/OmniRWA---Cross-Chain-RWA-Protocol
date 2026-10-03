// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./OmniRWAToken.sol";
import "./Mocks.sol";

/**
 * @title OmniRWARouter
 * @dev Router for cross-chain message dispatching and handling
 * Simulates cross-chain messaging (like Chainlink CCIP or LayerZero)
 */
contract OmniRWARouter is Ownable {
    OmniRWAToken public token;
    IdentityRegistry public identityRegistry;
    
    // Mapping to track processed messages to prevent replay attacks
    mapping(bytes32 => bool) public processedMessages;
    
    // Chain ID for this network
    uint32 public chainId;
    
    // Mapping of trusted relayers
    mapping(address => bool) public trustedRelayers;

    event RWARouteInitiated(
        uint32 indexed destChainId,
        address indexed sender,
        address indexed receiver,
        uint256 amount,
        uint256 nonce
    );
    
    event RWARouteReceived(
        uint32 indexed srcChainId,
        address indexed receiver,
        uint256 amount,
        bytes32 messageId
    );
    
    event RelayerUpdated(address indexed relayer, bool status);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    /**
     * @dev Constructor to initialize the router
     * @param _chainId The chain ID for this network
     * @param _token The address of the OmniRWA token
     */
    constructor(uint32 _chainId, address _token) Ownable(msg.sender) {
        chainId = _chainId;
        token = OmniRWAToken(_token);
    }

    /**
     * @dev Modifier to restrict access to trusted relayers
     */
    modifier onlyTrustedRelayer() {
        require(trustedRelayers[msg.sender], "Only trusted relayer can call this function");
        _;
    }

    /**
     * @dev Set the identity registry contract
     * @param _identityRegistry The address of the identity registry
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    /**
     * @dev Update the trusted status of a relayer
     * @param relayer The relayer address
     * @param status The trusted status
     */
    function setRelayer(address relayer, bool status) external onlyOwner {
        trustedRelayers[relayer] = status;
        emit RelayerUpdated(relayer, status);
    }

    /**
     * @dev Initiate a cross-chain transfer
     * @param destChainId The destination chain ID
     * @param receiver The recipient address on the destination chain
     * @param amount The amount to transfer
     */
    function initiateCrossChainTransfer(
        uint32 destChainId,
        address receiver,
        uint256 amount
    ) external {
        require(receiver != address(0), "Invalid receiver address");
        require(amount > 0, "Amount must be greater than 0");
        require(destChainId != chainId, "Cannot transfer to same chain");
        
        // Burn tokens locally
        token.bridgeBurn(msg.sender, amount);
        
        // Generate nonce for this transfer
        uint256 nonce = block.timestamp;
        
        // Emit event for relayer to pick up
        emit RWARouteInitiated(destChainId, msg.sender, receiver, amount, nonce);
    }

    /**
     * @dev Handle incoming cross-chain route (called by trusted relayer)
     * @param srcChainId The source chain ID
     * @param sender The sender address on the source chain
     * @param receiver The recipient address on this chain
     * @param amount The amount to mint
     * @param nonce The nonce from the source chain
     */
    function handleIncomingRoute(
        uint32 srcChainId,
        address sender,
        address receiver,
        uint256 amount,
        uint256 nonce
    ) external onlyTrustedRelayer {
        require(receiver != address(0), "Invalid receiver address");
        require(amount > 0, "Amount must be greater than 0");
        require(srcChainId != chainId, "Cannot receive from same chain");
        
        // Generate message ID to prevent replay attacks
        bytes32 messageId = keccak256(abi.encodePacked(srcChainId, sender, receiver, amount, nonce));
        require(!processedMessages[messageId], "Message already processed");
        
        // Mark message as processed
        processedMessages[messageId] = true;
        
        // Check if receiver is verified on this chain
        if (address(identityRegistry) != address(0)) {
            require(
                identityRegistry.isVerified(receiver),
                "Receiver not verified on destination chain"
            );
        }
        
        // Mint tokens to receiver
        token.bridgeMint(receiver, amount);
        
        // Emit event
        emit RWARouteReceived(srcChainId, receiver, amount, messageId);
    }

    /**
     * @dev Check if a message has been processed
     * @param messageId The message ID to check
     * @return bool True if the message has been processed
     */
    function isMessageProcessed(bytes32 messageId) external view returns (bool) {
        return processedMessages[messageId];
    }
}
