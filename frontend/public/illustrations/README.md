# 挿絵（知識を探す・知識を試す）

11/19 から、オーナーのご両親の絵本『とびらのむこう』の絵柄にそろえた絵（Claude Design 作、冷蔵庫くんが登場）。文字なし。
ギルドホール（`/schoolpark/guild-hall/`）も同じ絵柄。

- `card-{guild,quest,lab,text}.webp`（各 480×200）・`onepoint-try.webp`（64×64）… `<img>` で出す
- `band-{search,practice}-{morning,day,night}.webp`（各 1200×200）… `<img>` で出し、時間帯で src を替える
- `sp-illustrations.css` … 前の SVG 用の時間帯の色の変数（WebP には効かない。ほかで使っていれば残す）
- `sp-illustrations-page.css` … 置き場所と大きさ
- `sp-illustrations.js` … 画面が見えたときに差し込む・時間帯（朝 5–10／昼 10–17／夜 17–5）を付ける

前の絵（11/10 の SVG、平らなイラスト）は 11/19 に外した。
