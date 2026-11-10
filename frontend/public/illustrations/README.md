# 挿絵（知識を探す・知識を試す）

デザインのハンドオフ（SchoolPark_illustration_handoff, 11/10）の絵。文字なし・実在の人物なし。

- `card-*.svg`（4枚）・`onepoint-try.svg` … 画面に SVG のまま埋め込む（CSS 変数で時間帯の色が替わる）
- `band-{search,practice}-{morning,day,night}.svg` … `<img>` で出し、時間帯で src を替える
- `sp-illustrations.css` … ハンドオフそのまま（色の変数・時間帯の小物・動き）
- `sp-illustrations-page.css` … 置き場所と大きさ（ハンドオフの表のとおり）
- `sp-illustrations.js` … 画面が見えたときに差し込む・時間帯（朝 5–10／昼 10–17／夜 17–5）を付ける

取り込むときに、各 SVG の来歴情報（C2PA の `<metadata>`、約7.7KB）を外した。絵の中身は変えていない。
