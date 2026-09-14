// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
/// @notice Owner-scoped consent. No admin may modify another owner's grants.
contract MemoryPermissionRegistry {
    struct Grant { uint8 permissions; uint64 expiresAt; bool revoked; }
    mapping(address => mapping(bytes32 => mapping(bytes32 => Grant))) public grants;
    mapping(address => mapping(bytes32 => bytes32)) public roots;
    event AccessGranted(address indexed owner, bytes32 indexed agentId, bytes32 indexed scopeHash, uint8 permissions, uint64 expiresAt);
    event AccessRevoked(address indexed owner, bytes32 indexed agentId, bytes32 indexed scopeHash);
    event MemoryRootAnchored(address indexed owner, bytes32 indexed batchId, bytes32 merkleRoot);
    error InvalidGrant(); error InvalidAnchor();
    function grantAccess(bytes32 agentId, bytes32 scopeHash, uint8 permissions, uint64 expiresAt) external {
        if (agentId == bytes32(0) || scopeHash == bytes32(0) || permissions == 0 || permissions > 3 || (expiresAt != 0 && expiresAt <= block.timestamp)) revert InvalidGrant();
        grants[msg.sender][agentId][scopeHash] = Grant(permissions, expiresAt, false);
        emit AccessGranted(msg.sender, agentId, scopeHash, permissions, expiresAt);
    }
    function revokeAccess(bytes32 agentId, bytes32 scopeHash) external {
        grants[msg.sender][agentId][scopeHash].revoked = true;
        grants[msg.sender][agentId][scopeHash].permissions = 0;
        emit AccessRevoked(msg.sender, agentId, scopeHash);
    }
    function hasAccess(address owner, bytes32 agentId, bytes32 scopeHash, uint8 required) external view returns (bool) {
        if (required == 0 || required > 3) return false;
        Grant memory g = grants[owner][agentId][scopeHash];
        return !g.revoked && (g.expiresAt == 0 || block.timestamp < g.expiresAt) && (g.permissions & required) == required;
    }
    function anchorMemoryRoot(bytes32 batchId, bytes32 merkleRoot) external {
        if (batchId == bytes32(0) || merkleRoot == bytes32(0) || roots[msg.sender][batchId] != bytes32(0)) revert InvalidAnchor();
        roots[msg.sender][batchId] = merkleRoot;
        emit MemoryRootAnchored(msg.sender, batchId, merkleRoot);
    }
}
