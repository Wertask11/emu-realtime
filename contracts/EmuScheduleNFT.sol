// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
//  Emu 機能解放NFT 第２弾 — 予約投稿解放NFT
//  EmuScheduleNFT (EMUSCHED)
//
//  Remix デプロイ手順:
//  1. Remixで このファイルを開く
//  2. Compiler: 0.8.20, Enable optimization
//  3. Deploy & Run → Environment: Injected Provider (MetaMask Polygon)
//  4. Constructor引数: initialOwner = 運営ウォレットアドレス
//  5. Deploy → コントラクトアドレスをメモ
//  6. フロントエンド index.html の SCHEDULE_NFT_ADDRESS に設定
//  7. バックエンド環境変数 SCHEDULE_NFT_ADDRESS に設定
// ============================================================

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EmuScheduleNFT is ERC721URIStorage, Ownable {

    // ── 状態変数 ──────────────────────────────────────────────
    uint256 private _nextTokenId;

    // 取引所（EMUERコントラクト）のアドレス — buyNFT経由で転送を許可
    address public exchangeContract;

    // ── イベント ──────────────────────────────────────────────
    event ScheduleNFTMinted(address indexed to, uint256 indexed tokenId);
    event ExchangeContractUpdated(address indexed newExchange);

    // ── コンストラクタ ────────────────────────────────────────
    constructor(address initialOwner)
        ERC721("Emu Schedule NFT", "EMUSCHED")
        Ownable(initialOwner)
    {}

    // ── 管理者：単体ミント ────────────────────────────────────
    // 取引所に在庫として積む、または直接配布する
    function mint(address to, string memory tokenURI_) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI_);
        emit ScheduleNFTMinted(to, tokenId);
        return tokenId;
    }

    // ── 管理者：一括ミント ────────────────────────────────────
    // 複数アドレスに一括配布（取引所用在庫など）
    function mintBatch(
        address[] calldata recipients,
        string memory tokenURI_
    ) external onlyOwner {
        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 tokenId = _nextTokenId;
            _nextTokenId++;
            _safeMint(recipients[i], tokenId);
            _setTokenURI(tokenId, tokenURI_);
            emit ScheduleNFTMinted(recipients[i], tokenId);
        }
    }

    // ── 管理者：取引所コントラクトアドレスを設定 ─────────────
    function setExchangeContract(address _exchange) external onlyOwner {
        exchangeContract = _exchange;
        emit ExchangeContractUpdated(_exchange);
    }

    // ── 管理者：メタデータURIを更新 ──────────────────────────
    function updateTokenURI(uint256 tokenId, string memory newURI) external onlyOwner {
        _setTokenURI(tokenId, newURI);
    }

    // ── 次のTokenIdを確認 ────────────────────────────────────
    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    // ── 所有チェック用ヘルパー ───────────────────────────────
    // フロントエンドの checkScheduleNFT() から balanceOf で呼ばれる
    // balanceOf(address) は ERC721 基底クラスが提供
}
