"""営業キット（あいさつ回り用）の印刷物を HTML で作る。PDF 化は render.cjs。"""
import io, os, html, urllib.parse
import qrcode, qrcode.image.svg

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

APP = "https://schoolpark-emu.vercel.app/"
HP = "https://school-park-homepage.vercel.app/"
CAM = "https://camellia-beta.vercel.app/"
CAMPAIGN = "aisatsu_2026q4"

INK, SP, CREAM = "#141310", "#0F5C3F", "#F4F1EA"
EMU, EMU_T = "#F08300", "#9A5200"
CAM_C, CAM_BG = "#A34B55", "#FFF6F2"

LINKS = {}


def utm(base, source, content):
    q = urllib.parse.urlencode({"utm_source": source, "utm_medium": "offline",
                                "utm_campaign": CAMPAIGN, "utm_content": content})
    url = base + ("&" if "?" in base else "?") + q
    LINKS[f"{source}/{content}"] = url
    return url


def qr(data):
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=0, box_size=10)
    q.add_data(data)
    q.make(fit=True)
    buf = io.BytesIO()
    q.make_image(image_factory=qrcode.image.svg.SvgPathImage).save(buf)
    svg = buf.getvalue().decode()
    svg = svg[svg.index("<svg"):]
    return svg.replace("<svg ", '<svg preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block" ', 1)


def qrbox(url, size_mm, label, color=INK):
    return (f'<div class="qr" style="width:{size_mm}mm">'
            f'<div class="qr-code" style="width:{size_mm}mm;height:{size_mm}mm">{qr(url)}</div>'
            f'<div class="qr-label" style="color:{color}">{label}</div></div>')


def e(s):
    return html.escape(s)


BASE_CSS = f"""
@page {{ size: A4; margin: 0 }}
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{background:#fff;color:{INK};font-family:'Zen Kaku Gothic New',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.page{{width:210mm;height:297mm;padding:13mm 14mm;overflow:hidden;position:relative;page-break-after:always;display:flex;flex-direction:column;gap:4.5mm}}
.page:last-child{{page-break-after:auto}}
h1{{font-weight:900;line-height:1.3}}
h2{{font-weight:900;font-size:12.5pt;border-left:1.6mm solid currentColor;padding-left:2.5mm;line-height:1.35}}
p,li,td,th{{font-size:9.6pt;line-height:1.7;font-weight:500}}
ul{{padding-left:4.5mm}}
.small{{font-size:8pt;line-height:1.6}}
.muted{{color:#5f5a4e}}
.top{{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:.5mm solid currentColor;padding-bottom:2mm;font-size:8.5pt;font-weight:700}}
.top b{{font-weight:900;font-size:10.5pt;letter-spacing:.04em}}
.grid2{{display:grid;grid-template-columns:1fr 1fr;gap:3.5mm}}
.grid3{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3mm}}
.box{{border:.35mm solid rgba(20,19,16,.25);border-radius:2.5mm;padding:3mm 3.5mm}}
.box b{{font-weight:900;font-size:10.5pt;display:block;margin-bottom:1mm}}
.qr{{display:flex;flex-direction:column;align-items:center;gap:1.2mm}}
.qr-label{{font-weight:900;font-size:8.5pt;text-align:center;line-height:1.35}}
.steps{{display:grid;gap:2mm}}
.step{{display:flex;gap:2.5mm;align-items:flex-start}}
.step i{{font-style:normal;font-weight:900;font-size:10pt;min-width:6mm;height:6mm;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff}}
.foot{{margin-top:auto;border-top:.35mm solid rgba(20,19,16,.3);padding-top:2.5mm;display:flex;justify-content:space-between;align-items:flex-end;gap:4mm}}
.ph{{background:#FFF3B0;padding:0 1mm;border-radius:.8mm}}
table{{border-collapse:collapse;width:100%}}
td,th{{border:.3mm solid rgba(20,19,16,.35);padding:1.6mm 2mm;vertical-align:top;text-align:left}}
th{{background:#EFEBE1;font-weight:900}}
.write{{border:.35mm solid rgba(20,19,16,.4);border-radius:1.5mm;flex:1;padding:2mm 2.5mm}}
.write b{{font-weight:900;font-size:10pt}}
.write span{{font-size:8.3pt;color:#5f5a4e;display:block;line-height:1.5}}
"""


def doc(title, body, extra_css=""):
    return f"""<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>{e(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>{BASE_CSS}{extra_css}</style></head><body>{body}</body></html>"""


def write(name, content):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(content)


CONTACT = '<span class="ph">【お名前】</span>　<span class="ph">【電話】</span>　<span class="ph">【メール】</span>'
ORG = "合同会社型DAO SchoolPark（福岡）"

# ───────── 1. 名刺サイズの QR カード（A4 に10枚 × 3種） ─────────
CARD_CSS = """
.sheet{width:210mm;height:297mm;padding:11mm 14mm;display:grid;grid-template-columns:91mm 91mm;grid-auto-rows:55mm;column-gap:0;row-gap:0;justify-content:center;page-break-after:always}
.sheet:last-child{page-break-after:auto}
.card{width:91mm;height:55mm;padding:4.5mm 4.5mm 4mm 5mm;display:flex;gap:3.5mm;outline:.15mm dashed rgba(0,0,0,.25);outline-offset:-.075mm}
.card .t{flex:1;display:flex;flex-direction:column;gap:1.3mm;min-width:0}
.card .name{font-weight:900;font-size:15pt;line-height:1.05;letter-spacing:.01em}
.card .copy{font-weight:900;font-size:9pt;line-height:1.4}
.card .body{font-size:7.2pt;line-height:1.55;font-weight:500}
.card .org{margin-top:auto;font-size:6.3pt;font-weight:700;opacity:.8}
.card .qr-code{width:25mm;height:25mm}
.card .qrcol{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.2mm}
.card .qrcol span{font-size:6.5pt;font-weight:900;text-align:center;line-height:1.3}
"""
cards = [
    dict(key="schoolpark", name="SchoolPark", color=SP, bg=CREAM,
         copy="学んで、試して、残る。",
         body="LINE・Google・メールで1分。その場で Passport（あなたのID）が発行されます。挑戦した記録が、学歴とは別の実績として残ります。無料ではじめられます。",
         url=utm(APP, "meishi", "schoolpark"), qrlabel="ここから<br>はじめる"),
    dict(key="emu", name="Emu", color=EMU_T, bg="#FFF8EE",
         copy="誰かの経験が、あなたの次の一歩になる。",
         body="やってみた人の経験・失敗・工夫を読める場所。読むのは0円。自分の経験を書いて、誰かの役に立てることもできます。",
         url=utm(HP + "Emu.html", "meishi", "emu"), qrlabel="Emuを<br>のぞく"),
    dict(key="camellia", name="Camellia", color=CAM_C, bg=CAM_BG,
         copy="今日の自分に合う一歩を選ぶ。",
         body="登録なしで1分。今日の気分を1つ選ぶと、今日の過ごし方を一緒に考えます。やるかどうかは、あなたが決める。医療の代わりではありません。",
         url=utm(CAM, "meishi", "camellia"), qrlabel="今日の<br>Checkへ"),
]
sheets = ""
for c in cards:
    one = (f'<div class="card" style="background:{c["bg"]};color:{INK}">'
           f'<div class="t"><div class="name" style="color:{c["color"]}">{c["name"]}</div>'
           f'<div class="copy">{c["copy"]}</div><div class="body">{c["body"]}</div>'
           f'<div class="org">{ORG}</div></div>'
           f'<div class="qrcol"><div class="qr-code">{qr(c["url"])}</div><span style="color:{c["color"]}">{c["qrlabel"]}</span></div></div>')
    sheets += '<div class="sheet">' + one * 10 + "</div>"
write("01_qr_cards.html", doc("QRカード（名刺サイズ）", sheets, CARD_CSS))

# ───────── 2. 一枚資料：個人向け（SchoolPark × Emu） ─────────
def step(n, color, title, text):
    return f'<div class="step"><i style="background:{color}">{n}</i><p><b style="font-weight:900">{title}</b>　{text}</p></div>'

kojin = f"""<div class="page" style="color:{INK}">
<div class="top" style="color:{SP}"><b>SchoolPark × Emu</b><span>{ORG}</span></div>
<div>
  <h1 style="font-size:24pt;color:{SP}">学んで、試して、残る。</h1>
  <p style="font-size:11pt;margin-top:1.5mm">Emu で人の「やってみた経験」を読み、Guild で仲間と決めて、Quest で実際に挑戦する。<br>やったことは、あなたの Passport と星空に、学歴とは別の実績として残ります。</p>
</div>
<div class="grid2">
  <div class="box"><b>こんな人へ</b><ul>
    <li>本や動画で学んでも、やらないまま忘れてしまう</li>
    <li>自分の経験を、必要な人に届けたい</li>
    <li>学歴以外の「やった証拠」を残したい</li>
    <li>地域や社会の「おかしい」に関わりたい</li></ul></div>
  <div class="box"><b>答えではなく「経緯」が読める</b>
    <p>正しいとされる答えや平均的なおすすめではなく、<br>実際にやってみてどうだったか・うまくいかなかったこと・次に何を変えたかが読めます。</p></div>
</div>
<h2 style="color:{SP}">できること</h2>
<div class="grid3">
  <div class="box"><b style="color:{EMU_T}">Emu で学ぶ</b><p>経験から生まれた知識を読む・探す。困りごとに知識を募集する。体験を持ち寄って議論する。</p></div>
  <div class="box"><b style="color:{SP}">Guild で決める</b><p>LEARN・WORK・PLAY・CONNECT・WEB3 の5つ。議題を出し、締切まで投票。1 Passport 1票。</p></div>
  <div class="box"><b style="color:{SP}">Quest で挑戦</b><p>決まったことが番号つきの Quest に。報告を3回出し、運営が確かめて完走。Passport・星空・譲渡できない証明書NFTに残ります。</p></div>
</div>
<h2 style="color:{SP}">はじめ方（1分）</h2>
<div class="grid2" style="align-items:center">
  <div class="steps">
    {step(1, SP, "ログイン", "LINE・Google・メール・ウォレットから選ぶ")}
    {step(2, SP, "Passport 発行", "初回ログインで自動。手続きはいりません")}
    {step(3, SP, "読む・参加する", "Emu で知識を読み、気になる Guild へ")}
    {step(4, SP, "Quest に挑戦", "報告を出して、運営の確認で完走")}
  </div>
  <div style="display:flex;justify-content:center;gap:8mm">
    {qrbox(utm(APP, "ichimai_kojin", "schoolpark"), 30, "SchoolPark を<br>はじめる", SP)}
    {qrbox(utm(HP + "Emu.html", "ichimai_kojin", "emu"), 30, "Emu を<br>のぞく", EMU_T)}
  </div>
</div>
<div class="grid2">
  <div class="box"><b>料金</b><p>読む・見るは <b style="display:inline;font-size:9.6pt">0円</b>。Emu で書く・募集する・議論するには月額プラン（light 500円／plus 3,000円／pro 10,000円）。SchoolPark 公式パスの持ち主は plus 相当です。</p></div>
  <div class="box"><b>安心して使うために</b><ul>
    <li>秘密鍵やパスワードを求めません</li>
    <li>ウォレットがなくても使えます</li>
    <li>EMUER（活動に応じて付くトークン）は換金を目的としません（利用規約 第5条）</li></ul></div>
</div>
<div class="foot"><p class="small">お問い合わせ：{CONTACT}<br>運営者・利用規約・プライバシーポリシーは {HP} に公開しています。</p></div>
</div>"""
write("02_ichimai_kojin.html", doc("一枚資料（個人向け）", kojin))

# ───────── 3. 一枚資料：地域・学校・お店向け ─────────
chiiki = f"""<div class="page">
<div class="top" style="color:{SP}"><b>企業・お店・地域・学校の方へ</b><span>{ORG}</span></div>
<div>
  <h1 style="font-size:19pt;color:{SP}">その「困りごと」を、誰かの学びと挑戦につなげる。</h1>
  <p style="font-size:10.5pt;margin-top:1.5mm">お店や地域の困りごとを SchoolPark の Quest（挑戦の課題）として公開し、参加者と一緒に試してみる。<br>そんな取り組みを、<b style="font-weight:900">最初に一緒に始めてくださる方</b>を探しています。</p>
</div>
<p style="background:#F7F4EC;border-radius:2.5mm;padding:2mm 3.5mm"><b style="font-weight:900">こんなお悩みに：</b>新しいお客さまに知ってもらいたい／お客さまの本音を聞きたい／新しい企画のアイデアがほしい／教育や地域貢献に取り組みたい／若い世代とつながりたい</p>
<h2 style="color:{SP}">ご相談いただける3つのこと</h2>
<div class="grid3">
  <div class="box"><b>A　お店との提携</b><p>お店を、学びや挑戦の場として開く方法を一緒に考えます。まずは Quest やイベントを通じた形から。</p></div>
  <div class="box"><b>B　リアルイベント</b><p>ワークショップ・勉強会・地域の催しを一緒に企画。参加を Quest として記録し、参加者の Passport に残せます。</p></div>
  <div class="box"><b>C　Quest で共同実証</b><p>課題を Quest として公開し、参加者のアイデアや行動を集めます。何をもって成果とするかを先に決め、終わったら一緒に振り返ります。</p></div>
</div>
<h2 style="color:{SP}">課題が Quest になるまで</h2>
<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:2mm">
  <div class="box" style="padding:2mm 2.5mm"><b style="font-size:9.5pt">1 ご相談</b><p class="small">困っていること、試したいことを聞きます</p></div>
  <div class="box" style="padding:2mm 2.5mm"><b style="font-size:9.5pt">2 課題を整理</b><p class="small">参加者へのお願いを一緒に言葉に</p></div>
  <div class="box" style="padding:2mm 2.5mm"><b style="font-size:9.5pt">3 Quest で公開</b><p class="small">投票で決める形と、直接 Quest にする形</p></div>
  <div class="box" style="padding:2mm 2.5mm"><b style="font-size:9.5pt">4 参加者が挑戦</b><p class="small">活動を記録し、運営が完了を確かめる</p></div>
  <div class="box" style="padding:2mm 2.5mm"><b style="font-size:9.5pt">5 振り返る</b><p class="small">集まった声と行動から、次の一手を</p></div>
</div>
<div class="grid2">
  <div class="box"><b>たとえば（想定例です。実施した実績ではありません）</b><ul>
    <li>飲食店：新メニューを試食して感想を書く Quest</li>
    <li>書店：「知らない分野の本を1冊読む」Quest と読書会</li>
    <li>地域：困りごとを Guild の議題にし、選ばれた案を Quest で実行</li>
    <li>学習塾：探究学習の体験会（15分〜）</li></ul></div>
  <div class="box"><b>いまできること／準備中のこと</b><ul>
    <li>できる：Quest の公開・参加・完了の確認、Guild の議題と投票、Emu での感想の共有、リアルイベントの共同企画</li>
    <li>準備中：SchoolPark City へのお店の掲載・チェックイン、決済・予約、企業向けの正式なプランと料金</li></ul></div>
</div>
<div class="box"><b>費用・個人情報など</b><p>決まった料金表はまだありません。内容と規模をうかがって個別にご相談します。小さなお店・個人の方も歓迎です。事業者の方と共有する情報の範囲は実施前に取り決めます。Web3 の知識は必要ありません（参加者は LINE・Google・メールでログインできます）。</p></div>
<div class="foot"><p class="small">ご連絡先：{CONTACT}<br>詳しくは企業・店舗向けページへ（右の QR）。</p>
  {qrbox(utm(HP + "business.html", "ichimai_chiiki", "business"), 22, "企業・店舗向け<br>ページ", SP)}</div>
</div>"""
write("03_ichimai_chiiki.html", doc("一枚資料（地域・学校・お店向け）", chiiki))

# ───────── 4. 一枚資料：女性向け（Camellia） ─────────
camellia = f"""<div class="page" style="background:{CAM_BG}">
<div class="top" style="color:{CAM_C}"><b>Camellia</b><span>Wellness &amp; Wellbeing ・ {ORG}</span></div>
<div>
  <h1 style="font-size:24pt;color:{CAM_C}">今日の自分を知って、<br>今日の自分に合う一歩を選ぶ。</h1>
  <p style="font-size:11pt;margin-top:2mm">Camellia は、1分くらいの「今日のCheck」から、今日の自分に合う過ごし方を一緒に考えるウェルビーイングアプリです。<b style="font-weight:900">登録しなくても試せます。</b></p>
</div>
<h2 style="color:{CAM_C}">Camellia の、1日の流れ</h2>
<div class="steps">
  {step(1, CAM_C, "今日のCheck", "今の気分をひとつ選ぶ。睡眠・身体・ストレスなどは、添えたいものだけで大丈夫")}
  {step(2, CAM_C, "今日のあなた", "Check とこれまでの記録から、最近のあなたをお伝えします。決めつけはしません")}
  {step(3, CAM_C, "今日の過ごし方", "Check を手がかりに、過ごし方をひとつ提案します。選ばなくても大丈夫")}
  {step(4, CAM_C, "今日の一枚", "今日を別の角度から見るための一枚。未来や健康状態を断定するものではありません")}
  {step(5, CAM_C, "今日どうする？", "「これにする」「あとで」「今日はやめる」から、自分で選びます")}
</div>
<div class="grid2">
  <div class="box" style="background:#fff"><b style="color:{CAM_C}">続けると、見えてくるもの</b><ul>
    <li><b style="display:inline;font-size:9.6pt">My Tree</b>：大切な人との関係や思い出を、自分のために残す場所。相手に通知されることはありません</li>
    <li><b style="display:inline;font-size:9.6pt">My Camellia</b>：これまでの記録からの気づき、やってみていることを振り返れます</li></ul></div>
  <div class="box" style="background:#fff"><b style="color:{CAM_C}">安心して使っていただくために</b><ul>
    <li>医療の代わりではありません。診断や治療は行いません。体調に不安があるときは医療機関にご相談ください</li>
    <li>お伝えする内容は、年齢ではなく、あなた自身の記録に合わせて変わります</li></ul></div>
</div>
<div style="display:flex;justify-content:center;align-items:center;gap:10mm;margin-top:2mm">
  {qrbox(utm(CAM, "ichimai_camellia", "camellia"), 40, "今日のCheckをはじめる<br>（登録なしで1分）", CAM_C)}
  <p style="font-size:10pt;max-width:80mm">スマホのカメラで読み取ると、すぐにはじまります。続けて記録を残したいときは、LINE・Google でログインできます。<br><span class="small muted">準備中：Circle（つながり）・Place（場所）・SchoolPark との連携</span></p>
</div>
<div class="foot"><p class="small">記録の扱いはプライバシーポリシー（{CAM}privacy.html）に記載しています。<br>お問い合わせ：{CONTACT}</p></div>
</div>"""
write("04_ichimai_camellia.html", doc("一枚資料（女性向け Camellia）", camellia))

# ───────── 5. 学習塾向け：探究体験会の提案＋保護者同意書＋ワークシート ─────────
juku_p1 = f"""<div class="page">
<div class="top" style="color:{SP}"><b>学習塾の先生へ　ご提案</b><span>{ORG}</span></div>
<div>
  <h1 style="font-size:21pt;color:{SP}">生徒さん向けの「探究学習」体験会を、<br>無料で1回、開かせてください。</h1>
  <p style="font-size:10.5pt;margin-top:1.5mm">高校では「総合的な探究の時間」が始まり、自分で問いを立てて調べ、考えをまとめる力が求められています。<br>身近な「おかしいな」を1つ選んで、<b style="font-weight:900">誰が得をして、誰が損をしているか</b>を解剖する体験会です。</p>
</div>
<h2 style="color:{SP}">体験会の内容（短い版 15分〜／じっくり版 45分）</h2>
<div class="grid2">
  <div class="box"><b>4つの段</b><ol style="padding-left:4.5mm">
    <li><p><b style="display:inline;font-size:9.6pt">問いを立てる</b>：身近なルールやサービスの「おかしいな」を1つ選び、「誰が得をして、誰が損をしているか」に言い換える</p></li>
    <li><p><b style="display:inline;font-size:9.6pt">調べる</b>：お金の流れ、時間や考えを奪う仕組みを調べる</p></li>
    <li><p><b style="display:inline;font-size:9.6pt">解剖する</b>：関わる人の損得を書き出し、見落とされている点（バグ）を見つける</p></li>
    <li><p><b style="display:inline;font-size:9.6pt">提案する</b>：新しいルールを1文で提案する</p></li></ol></div>
  <div class="box"><b>2つのきまり</b><ul>
    <li>自分の足で取った事実を1つ入れる（人に聞いた・自分で試した・現場で見た）。検索で出てきたものは数えません</li>
    <li>AI などの道具を使ったら、どこで使ったかを書く</li></ul>
    <p class="small muted" style="margin-top:1.5mm">SchoolPark の特殊クエスト #001「構造解剖・探究ワークシート」の短い版です。考え方の下敷き：デューイ、コルブ、文部科学省の探究の4ステップ（課題の設定→情報の収集→整理・分析→まとめ・表現）。</p></div>
</div>
<table>
<tr><th style="width:28%">対象・人数</th><td>中学生・高校生（目安 3〜20人）</td></tr>
<tr><th>時間・場所</th><td>塾の空いている時間・教室で（15〜45分）</td></tr>
<tr><th>費用</th><td><b style="font-weight:900">無料</b>（ワークシートと筆記具はこちらで用意します）</td></tr>
<tr><th>生徒さんが持ち帰るもの</th><td>書き込んだワークシート（探究レポートのたたき台に使えます）</td></tr>
<tr><th>塾にお願いしたいこと</th><td>場所と時間をお借りすること、生徒さんへのご案内</td></tr>
<tr><th>アプリについて</th><td>体験会は<b style="font-weight:900">紙だけで完結</b>します。SchoolPark のアカウント（Passport）を作るのは希望者だけで、<b style="font-weight:900">保護者の同意書をいただいた生徒さんに限ります</b>。アプリの AI 機能は、18歳未満の生徒さんには案内しません。体験会の場で有料プランの案内はしません。</td></tr>
</table>
<div class="foot"><p class="small">ご連絡先：{CONTACT}<br>運営者情報・利用規約・プライバシーポリシー：{HP}</p>
  {qrbox(utm(HP + "schoolpark.html", "juku", "teian"), 20, "SchoolPark<br>について", SP)}</div>
</div>"""

juku_p2 = f"""<div class="page">
<div class="top" style="color:{SP}"><b>保護者の方へ　SchoolPark 利用の同意書</b><span>{ORG}</span></div>
<p style="font-size:10.5pt">お子さまが SchoolPark のアカウント（Passport）を作るには、保護者の方の同意が必要です（利用規約：18歳未満の方は法定代理人の同意が必要）。体験会への参加だけなら、アカウントは作りません。</p>
<div class="box"><b>SchoolPark について</b><ul>
  <li>学びと挑戦の記録を残すサービスです。運営は {ORG}。</li>
  <li>ログインは LINE・Google・メールのいずれか。初回ログインで、ひとり1つの SchoolPark ID（Passport）が自動で作られます。</li>
  <li>投稿や報告は、ほかの利用者に公開されることがあります。氏名・住所・学校名などは書かないようお伝えください。</li>
  <li>活動に応じて EMUER（アプリ内のトークン）が付くことがありますが、換金を目的としたものではありません（利用規約 第5条）。</li>
  <li>有料プランへの申し込みには、保護者の方の同意が別に必要です。体験会で有料プランの案内はしません。</li>
  <li>アプリ内の AI 機能は、18歳未満のお子さまには案内しません。</li>
  <li>記録の扱いはプライバシーポリシー（{APP}privacy.html）、利用条件は利用規約（{APP}terms.html）に記載しています。退会・記録の削除のご相談は下の連絡先へ。</li></ul></div>
<table>
<tr><th style="width:30%">同意する内容（✓を入れてください）</th><td>
  <p>□　体験会（紙のワークシート）に参加すること</p>
  <p>□　SchoolPark のアカウント（Passport）を作り、利用すること（任意）</p>
  <p>□　体験会の様子を、お子さまが特定できない形で SNS 等で紹介すること（任意）</p></td></tr>
<tr><th>お子さまのお名前</th><td style="height:12mm"></td></tr>
<tr><th>保護者のお名前・続柄</th><td style="height:12mm"></td></tr>
<tr><th>連絡先（電話またはメール）</th><td style="height:12mm"></td></tr>
<tr><th>日付</th><td style="height:10mm">　　　　年　　　月　　　日</td></tr>
<tr><th>保護者の署名</th><td style="height:14mm"></td></tr>
</table>
<p class="small muted">この同意書は、体験会を開く塾と運営の双方で控えを保管します。同意はいつでも取り消せます。取り消しのご連絡：{CONTACT}<br>※ この書式は案です。使う前に、運営（法務）で文面を確認してください。</p>
</div>"""

def wbox(title, sub, h):
    return f'<div class="write" style="min-height:{h}mm"><b>{title}</b><span>{sub}</span></div>'

juku_p3 = f"""<div class="page">
<div class="top" style="color:{SP}"><b>構造解剖・探究ワークシート（短い版）</b><span>SchoolPark 特殊クエスト #001</span></div>
<div style="display:flex;gap:4mm"><div class="write" style="flex:2"><b>名前</b></div><div class="write"><b>日付</b></div></div>
{wbox("1　問いを立てる", "身近なルール・サービスの「おかしいな」を1つ。それを「誰が得をして、誰が損をしているか？」の形に書き直す", 40)}
{wbox("2　調べる", "お金はどこからどこへ流れている？　誰の時間や考えが使われている？　自分の足で取った事実を1つ（どこで・誰に・何を）", 52)}
{wbox("3　解剖する", "関わる人を書き出し、それぞれの得と損を書く。見落とされている点（バグ）はどこ？", 52)}
{wbox("4　提案する", "新しいルールやしくみを、1文で", 26)}
<div style="display:flex;gap:4mm">{wbox("AI などの道具を使ったところ", "使っていなければ「なし」", 16)}{wbox("やってみて気づいたこと", "", 16)}</div>
<p class="small muted">答えを出す会ではありません。問いを立てて、自分で1つ事実を取ってくる会です。</p>
</div>"""
write("05_juku_tankyu.html", doc("学習塾向け 探究体験会", juku_p1 + juku_p2 + juku_p3))

# ───────── 6. 解剖フェス 企画書（会場・地域向け） ─────────
kaibou = f"""<div class="page">
<div class="top" style="color:{SP}"><b>企画書　地域の催し「解剖フェス」</b><span>{ORG}</span></div>
<div>
  <h1 style="font-size:22pt;color:{SP}">解剖フェス：世の中のバグ大集合</h1>
  <p style="font-size:10.5pt;margin-top:1.5mm">学校・塾・家庭・SNS・社会。「これ、おかしくない？」を付箋に書いて、壁いっぱいに貼ります。<br>来て、貼って、話して、持ち帰る。半日の会です。</p>
</div>
<table>
<tr><th style="width:24%">日時</th><td><span class="ph">【　月　日（　）　：　〜　：　】</span>（半日。準備・片付けを含めて <span class="ph">【　】</span> 時間）</td></tr>
<tr><th>会場</th><td><span class="ph">【会場名・部屋】</span>（会議室・多目的室 1室）</td></tr>
<tr><th>対象・人数</th><td>どなたでも（中学生以下は保護者と一緒に）。<span class="ph">【定員　人】</span>。来場5人以上で開催成功とします</td></tr>
<tr><th>参加費</th><td><span class="ph">【無料（予定）】</span></td></tr>
<tr><th>主催</th><td>{ORG}　担当：{CONTACT}</td></tr>
<tr><th>費用</th><td>主催者が負担（1万円以内：会場費・付箋・ペン・模造紙）</td></tr>
</table>
<h2 style="color:{SP}">内容（3つのブース）</h2>
<div class="grid3">
  <div class="box"><b>① 壁一面のバグ掲示板</b><p>身近な理不尽を付箋に書いて貼る。名前は書かなくて構いません。</p></div>
  <div class="box"><b>② バグ解剖ワーク</b><p>壁のバグから1つ選び、10〜15分で「誰が得をして、誰が損をしているか」を解剖し、提案まで書く（希望者のみ）。</p></div>
  <div class="box"><b>③ 記録の案内</b><p>希望者に、学びの記録を残す無料のアカウント（Passport）の作り方を案内します。</p></div>
</div>
<h2 style="color:{SP}">会場へのお願い・配慮</h2>
<div class="grid2">
  <div class="box"><b>お借りしたいもの</b><ul>
    <li>机・いす（<span class="ph">【　】</span>人分）</li>
    <li>壁またはホワイトボード（模造紙を貼れる場所。貼り方はご指示に従います）</li>
    <li>館内掲示・チラシ設置の可否</li></ul></div>
  <div class="box"><b>配慮すること</b><ul>
    <li>物品の販売や、有料サービスの勧誘はしません</li>
    <li>付箋に個人名・学校名など、特定の人を傷つける内容が書かれた場合は外します</li>
    <li>写真は顔が写らない形で、同意のある方だけ</li>
    <li>会場の利用規則に従います</li></ul></div>
</div>
<div class="foot"><p class="small">SchoolPark は、学んで挑戦した記録が残る場所を福岡からつくっている合同会社型DAOです。<br>運営者情報：{HP}</p>
  {qrbox(utm(HP + "schoolpark.html", "kikakusho", "kaibou"), 20, "SchoolPark<br>について", SP)}</div>
</div>"""
write("06_kaibou_kikakusho.html", doc("解剖フェス 企画書", kaibou))

# ───────── 7. 訪問記録シート ─────────
rows = "".join('<tr>' + '<td style="height:21mm"></td>' * 8 + '</tr>' for _ in range(9))
kiroku = f"""<div class="page" style="padding:11mm 10mm">
<div class="top" style="color:{SP}"><b>訪問記録シート</b><span>あいさつ回り・対面営業　{ORG}</span></div>
<p class="small">会った日にその場で書く。「次の約束」は日付で書く。Passport は、その場で発行できた数。</p>
<table style="table-layout:fixed">
<tr><th style="width:9%">日付</th><th style="width:15%">行き先・相手（役職）</th><th style="width:16%">困りごと（聞いたこと）</th><th style="width:12%">見せたもの</th><th style="width:14%">お願いしたこと</th><th style="width:12%">返事</th><th style="width:12%">次の約束（日付）</th><th style="width:10%">Passport・体験</th></tr>
{rows}
</table>
</div>"""
write("07_houmon_kiroku.html", doc("訪問記録シート", kiroku))

with open(os.path.join(OUT, "links.txt"), "w", encoding="utf-8") as f:
    for k, v in LINKS.items():
        f.write(f"{k}\t{v}\n")
print("ok", len(LINKS), "links")
