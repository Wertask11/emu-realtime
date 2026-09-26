// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice A nontransferable certificate for a SchoolPark quest star.
/// @dev The completion key contains no passport or wallet data in plaintext.
contract SchoolParkQuestStar is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    mapping(bytes32 => uint256) public tokenForCompletion;
    mapping(uint256 => string) private _uris;
    uint256 private _nextId = 1;

    error NonTransferable();
    error AlreadyIssued();
    error InvalidCompletion();

    constructor(address admin) ERC721("SchoolPark Quest Star", "SPSTAR") {
        if (admin == address(0)) revert InvalidCompletion();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    function mint(address to, bytes32 completionKey, string calldata uri)
        external onlyRole(MINTER_ROLE) returns (uint256 id)
    {
        if (to == address(0) || completionKey == bytes32(0)) revert InvalidCompletion();
        if (tokenForCompletion[completionKey] != 0) revert AlreadyIssued();
        id = _nextId++;
        tokenForCompletion[completionKey] = id;
        _uris[id] = uri;
        _safeMint(to, id);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return _uris[id];
    }

    function approve(address, uint256) public pure override {
        revert NonTransferable();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert NonTransferable();
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 id, address auth)
        internal override returns (address from)
    {
        from = _ownerOf(id);
        if (from != address(0) || to == address(0)) revert NonTransferable();
        return super._update(to, id, auth);
    }
}
