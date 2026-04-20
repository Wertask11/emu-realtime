const ALL_LAWS={home:[{id:'civil1',name:'民法 第1条（基本原則・信義誠実）',body:'第1条　私権は、公共の福祉に適合しなければならない。\n第2項　権利の行使及び義務の履行は、信義に従い誠実に行わなければならない。\n第3項　権利の濫用は、これを許さない。',src:'引用元：民法（明治29年法律第89号）| e-Gov法令検索'},{id:'kenpo13',name:'日本国憲法 第13条（個人の尊重）',body:'すべて国民は、個人として尊重される。生命、自由及び幸福追求に対する国民の権利については、公共の福祉に反しない限り、立法その他の国政の上で、最大の尊重を必要とする。',src:'引用元：日本国憲法 | 国立国会図書館'},{id:'jido12',name:'児童の権利に関する条約 第12条',body:'締約国は、自己の意見を形成する能力のある児童がその児童に影響を及ぼすすべての事項について自由に自己の意見を表明する権利を確保する。',src:'引用元：児童の権利に関する条約（1989年）| 外務省'},{id:'kenpo19',name:'日本国憲法 第19条（思想及び良心の自由）',body:'思想及び良心の自由は、これを侵してはならない。',src:'引用元：日本国憲法 | 国立国会図書館'}],school:[{id:'edu3',name:'教育基本法 第3条（教育の機会均等）',body:'すべて国民は、ひとしく、その能力に応じた教育を受ける機会を与えられなければならず、人種、信条、性別、社会的身分、経済的地位又は門地によって、教育上差別されない。',src:'引用元：教育基本法（昭和22年法律第25号）| e-Gov法令検索'},{id:'gakkou11',name:'学校教育法 第11条（懲戒・体罰禁止）',body:'校長及び教員は、教育上必要があると認めるときは、文部科学大臣の定めるところにより、児童、生徒及び学生に懲戒を加えることができる。ただし、体罰を加えることはできない。',src:'引用元：学校教育法（昭和22年法律第26号）| e-Gov法令検索'},{id:'ijime',name:'いじめ防止対策推進法 第3条（基本理念）',body:'いじめの防止等のための対策は、いじめが全ての児童等に関係する問題であることに鑑み、児童等が安心して学習その他の活動に取り組むことができるよう、いじめが行われなくなるようにすることを旨として行われなければならない。',src:'引用元：いじめ防止対策推進法（平成25年法律第71号）| e-Gov法令検索'}],park:[{id:'consumer4',name:'消費者契約法 第4条（不当勧誘の取消し）',body:'消費者は、事業者が消費者契約の締結について勧誘をするに際し、不実告知等の行為をしたことにより誤認した場合、これを取り消すことができる。',src:'引用元：消費者契約法（平成12年法律第61号）| e-Gov法令検索'},{id:'keifan1',name:'軽犯罪法 第1条（公共の場所での迷惑行為）',body:'公衆の前で著しく粗野又は乱暴な言動で迷惑をかけた者は、拘留又は科料に処する。',src:'引用元：軽犯罪法（昭和23年法律第39号）| e-Gov法令検索'},{id:'dorokou',name:'道路交通法 第76条（禁止行為）',body:'何人も、交通の妨害となるような方法で道路に物件を置いてはならず、また、道路において遊戯等の行為を行ってはならない。',src:'引用元：道路交通法（昭和35年法律第105号）| e-Gov法令検索'}],bath:[{id:'kenpo25',name:'日本国憲法 第25条（生存権）',body:'すべて国民は、健康で文化的な最低限度の生活を営む権利を有する。\n第2項　国は、すべての生活部面について、社会福祉、社会保障及び公衆衛生の向上及び増進に努めなければならない。',src:'引用元：日本国憲法 | 国立国会図書館'},{id:'rodo5',name:'労働基準法 第5条（強制労働の禁止）',body:'使用者は、暴行、脅迫、監禁その他精神又は身体の自由を不当に拘束する手段によって、労働者の意思に反して労働を強制してはならない。',src:'引用元：労働基準法（昭和22年法律第49号）| e-Gov法令検索'}],work:[{id:'rodo15',name:'労働基準法 第15条（労働条件の明示）',body:'使用者は、労働契約の締結に際し、労働者に対して賃金、労働時間その他の労働条件を明示しなければならない。',src:'引用元：労働基準法（昭和22年法律第49号）| e-Gov法令検索'},{id:'rodo36',name:'労働基準法 第36条（時間外・休日労働の上限）',body:'※2019年改正により時間外労働の上限規制（月45時間・年360時間）が法定化された。',src:'引用元：労働基準法（昭和22年法律第49号）| e-Gov法令検索'},{id:'pawahara',name:'労働施策総合推進法 第30条の2（パワーハラスメント防止）',body:'事業主は、職場において行われる優越的な関係を背景とした言動であって、業務上必要かつ相当な範囲を超えたものによりその雇用する労働者の就業環境が害されることのないよう、当該労働者からの相談に応じ、適切に対応するために必要な体制の整備その他の雇用管理上必要な措置を講じなければならない。',src:'引用元：労働施策総合推進法（昭和41年法律第132号）| e-Gov法令検索'},{id:'civil1w',name:'民法 第1条（権利濫用の禁止）',body:'権利の行使及び義務の履行は、信義に従い誠実に行わなければならない。\n権利の濫用は、これを許さない。',src:'引用元：民法（明治29年法律第89号）| e-Gov法令検索'},{id:'rodo19',name:'労働基準法 第19条（解雇制限）',body:'使用者は、労働者が業務上負傷し、又は疾病にかかり療養のために休業する期間及びその後30日間は、解雇してはならない。',src:'引用元：労働基準法（昭和22年法律第49号）| e-Gov法令検索'}]};

const WORK_DECKS={
boss:[
  {t:'データ',tc:'ct-p',n:'実績レポートを提示',d:'数字と成果で説得',p:3,s:'「このデータをご確認ください。目標対比125%達成です。」',fx:(G)=>{fw('実績レポートを提示した。上司が数字を確認し始めた。');}},
  {t:'データ',tc:'ct-p',n:'市場データを引用',d:'客観データで補強',p:2,s:'「業界平均と比較してもこの数字は優位です。」',fx:(G)=>{fw('市場データを提示した。');}},
  {t:'法律',tc:'ct-l',n:'労働基準法36条を引く',d:'時間外労働の上限を主張',p:3,s:'「労働基準法第36条、時間外労働には上限規制があります。」',fx:(G)=>{fw('法律を引用した！上司が一瞬止まった。');}},
  {t:'法律',tc:'ct-l',n:'パワハラ防止法を引く',d:'不当圧力に対抗',p:3,s:'「労働施策総合推進法第30条の2、パワーハラスメントの定義に該当します。」',fx:(G)=>{fw('法律を引用した！上司が顔色を変えた。');}},
  {t:'戦略',tc:'ct-s',n:'Win-Winの提案',d:'双方の利益を提示',p:3,s:'「この提案は部署の目標達成にも直結します。ご検討ください。」',fx:(G)=>{fw('Win-Win提案をした。');}},
  {t:'戦略',tc:'ct-s',n:'人事部への相談を示唆',d:'成功40%',p:0,s:'「人事部にもご相談するつもりですが、まずはご報告に参りました。」',fx:(G,cb)=>{if(Math.random()<0.4){fw('上司が「それは待て」と態度を変えた！');G.eHP=Math.max(0,G.eHP-2);uwB();if(G.eHP<=0)endGame(true,'上司を説得成功！');else if(cb)cb();}else{fw('上司が「好きにしろ」と開き直った…気力が1下がった。');G.pHP=Math.max(0,G.pHP-1);uwB();if(cb)cb();}}},
  {t:'感情',tc:'ct-e',n:'熱意を伝える',d:'真剣さが伝わる',p:2,s:'「この仕事に本気で取り組んでいます。だからこそお願いがあります。」',fx:(G)=>{fw('熱意を伝えた。');}},
  {t:'準備',tc:'ct-w',n:'事前資料を渡す',d:'バフ',p:1,s:'「事前にまとめた資料です。お目通しいただけますか。」',fx:(G)=>{fw('資料を渡した。バフ獲得。');G.buff+=1;}},
  {t:'戦略',tc:'ct-s',n:'段階的な提案',d:'小さな合意から積み上げる',p:2,s:'「まずはトライアルとして1ヶ月試していただけますか。」',fx:(G)=>{fw('段階的な提案をした。');}},
  {t:'強気',tc:'ct-sp',n:'辞表をちらつかせる',d:'成功20%・失敗で大ダメージ',p:0,s:'「このままでは継続が難しいと考えています。」',fx:(G,cb)=>{if(Math.random()<0.2){fw('上司が「それは困る」と一気に折れた！');G.eHP=Math.max(0,G.eHP-4);uwB();if(G.eHP<=0)endGame(true,'強気の一手が決まった！');else if(cb)cb();}else{fw('上司が「では受理する」と言った…気力が3下がった！');G.pHP=Math.max(0,G.pHP-3);uwB();if(G.pHP<=0)setTimeout(()=>endGame(false,'交渉が崩壊した。'),800);else if(cb)cb();}}},
  {t:'感情',tc:'ct-i',n:'素直に課題を認める',d:'信頼構築',p:1,s:'「自分の至らない点もあります。それでも改善したいと思っています。」',fx:(G)=>{fw('課題を認めた。');G.eHP=Math.max(0,G.eHP-1);uwB();}}
],
subordinate:[
  {t:'感情',tc:'ct-e',n:'部下の話を傾聴する',d:'信頼関係を構築・バフ',p:1,s:'「まず、あなたの話を聞かせてほしい。何が難しい？」',fx:(G)=>{fw('傾聴した。バフ獲得。');G.buff+=1;}},
  {t:'感情',tc:'ct-e',n:'成長を褒める',d:'モチベUP・気力-1',p:1,s:'「最近すごく成長してるね。だからこそ次のステップをお願いしたい。」',fx:(G)=>{fw('褒めた！');G.eHP=Math.max(0,G.eHP-1);uwB();}},
  {t:'説得',tc:'ct-p',n:'目標と成果を共有',d:'具体的なゴールを示す',p:2,s:'「この仕事を通じて、こういうスキルが身につく。一緒に目指そう。」',fx:(G)=>{fw('目標を共有した。');}},
  {t:'説得',tc:'ct-p',n:'業務の意義を説明',d:'Whyを伝える',p:2,s:'「この作業がなぜ重要か、全体像から説明させてほしい。」',fx:(G)=>{fw('意義を説明した。');}},
  {t:'戦略',tc:'ct-s',n:'段階的に権限を委譲',d:'自主性を引き出す',p:2,s:'「まずはこの部分だけ任せてみる。やってみてくれるか？」',fx:(G)=>{fw('権限を委譲した。');}},
  {t:'準備',tc:'ct-w',n:'マニュアルを渡す',d:'バフ',p:1,s:'「これ、参考にしてほしい。詳細な手順書を作った。」',fx:(G)=>{fw('マニュアルを渡した。バフ獲得。');G.buff+=1;}},
  {t:'感情',tc:'ct-i',n:'困っていることを聞く',d:'バフ',p:1,s:'「何か困っていることはない？正直に教えてほしい。」',fx:(G)=>{fw('困りごとを聞いた。バフ獲得。');G.buff+=1;}},
  {t:'戦略',tc:'ct-s',n:'一緒にやってみる',d:'実演で理解させる',p:3,s:'「最初は一緒にやろう。見ながら覚えてくれ。」',fx:(G)=>{fw('一緒に取り組んだ！');G.eHP=Math.max(0,G.eHP-2);uwB();}},
  {t:'強気',tc:'ct-sp',n:'業務命令として伝える',d:'成功35%・失敗でデバフ',p:0,s:'「業務命令として指示する。対応してほしい。」',fx:(G,cb)=>{if(Math.random()<0.35){fw('業務命令が効いた！');G.eHP=Math.max(0,G.eHP-2);uwB();if(G.eHP<=0)endGame(true,'部下を動かすことができた！');else if(cb)cb();}else{fw('「ハラスメントでは」と反発…次のカードが半減する。');G.debuff=true;if(cb)cb();}}},
  {t:'感情',tc:'ct-e',n:'素直に頼む',d:'気力-1',p:1,s:'「実は困っている。力を貸してくれないか？」',fx:(G)=>{fw('素直に頼んだ。');G.eHP=Math.max(0,G.eHP-1);uwB();}}
],
peer:[
  {t:'感情',tc:'ct-e',n:'同期の絆を訴える',d:'連帯感で動かす',p:3,s:'「同期だからこそ、正直に頼む。力を貸してくれ。」',fx:(G)=>{fw('同期の絆に訴えた。');}},
  {t:'感情',tc:'ct-e',n:'お互い様を主張',d:'互恵関係を確認',p:2,s:'「俺もあのとき助けてもらったから。今度は俺が頑張る番だろ。」',fx:(G)=>{fw('お互い様を主張した。');}},
  {t:'戦略',tc:'ct-s',n:'役割分担を提案',d:'効率化で両者が得をする',p:3,s:'「得意分野で分担すれば、どちらにとってもメリットがある。」',fx:(G)=>{fw('役割分担を提案した。');}},
  {t:'説得',tc:'ct-p',n:'プロジェクト全体を説明',d:'大局観で動かす',p:2,s:'「プロジェクト全体から見ると、ここが一番重要なんだ。」',fx:(G)=>{fw('全体像を説明した。');}},
  {t:'アイテム',tc:'ct-w',n:'飲みに誘う',d:'バフ',p:1,s:'「今夜、飲みに行かないか。仕事の話もしながら。」',fx:(G)=>{fw('飲みに誘った！バフ獲得。');G.buff+=1;}},
  {t:'アイテム',tc:'ct-w',n:'コーヒーをおごる',d:'バフ',p:1,s:'「コーヒー、おごるよ。少し話せるか？」',fx:(G)=>{fw('コーヒーをおごった。バフ獲得。');G.buff+=1;}},
  {t:'戦略',tc:'ct-s',n:'上司を巻き込む',d:'成功45%',p:0,s:'「この件、上司にも話を通しているんだ。一緒に進めよう。」',fx:(G,cb)=>{if(Math.random()<0.45){fw('同期が折れた！');G.eHP=Math.max(0,G.eHP-2);uwB();if(G.eHP<=0)endGame(true,'同期との連携成立！');else if(cb)cb();}else{fw('「上司に確認してみる」と言われた…');if(cb)cb();}}},
  {t:'感情',tc:'ct-i',n:'本音で話す',d:'気力-2',p:2,s:'「正直言う。今ちょっとしんどくてさ。助けてほしい。」',fx:(G)=>{fw('本音を話した！');G.eHP=Math.max(0,G.eHP-2);uwB();}},
  {t:'強気',tc:'ct-sp',n:'競争心を刺激する',d:'成功35%・失敗で関係悪化',p:0,s:'「お前には無理か？まあ、俺がやってもいいけど。」',fx:(G,cb)=>{if(Math.random()<0.35){fw('競争心に火がついた！');G.eHP=Math.max(0,G.eHP-3);uwB();if(G.eHP<=0)endGame(true,'ライバル心を利用した！');else if(cb)cb();}else{fw('「煽るのはやめろ」と怒らせた…気力が1下がった。');G.pHP=Math.max(0,G.pHP-1);uwB();if(cb)cb();}}},
  {t:'感情',tc:'ct-e',n:'謝ってから頼む',d:'気力-1',p:1,s:'「さっきの言い方が悪かった。ごめん。改めて頼む。」',fx:(G)=>{fw('謝った。');G.eHP=Math.max(0,G.eHP-1);uwB();}}
],
client:[
  {t:'データ',tc:'ct-p',n:'実績と事例を提示',d:'信頼性を数字で証明',p:3,s:'「他社様での導入実績です。ROIは平均180%を達成しています。」',fx:(G)=>{fw('実績を提示した。');}},
  {t:'データ',tc:'ct-p',n:'費用対効果を試算',d:'投資対効果を可視化',p:3,s:'「試算によると、年間○○万円のコスト削減が見込めます。」',fx:(G)=>{fw('費用対効果を提示した！');}},
  {t:'法律',tc:'ct-l',n:'契約条項を確認',d:'法的根拠で交渉を安定化',p:2,s:'「契約書第○条の規定に基づき、この点についてご確認いただきたい。」',fx:(G)=>{fw('契約条項を確認した。');}},
  {t:'法律',tc:'ct-l',n:'民法1条（権利濫用禁止）',d:'不当要求に対抗',p:3,s:'「民法第1条第3項、権利の濫用は許されないと定められています。」',fx:(G)=>{fw('法律を引用した！');}},
  {t:'戦略',tc:'ct-s',n:'Win-Win条件を提示',d:'双方の利益最大化',p:3,s:'「この条件であれば、御社にとっても我々にとっても最善です。」',fx:(G)=>{fw('Win-Win提案をした。');}},
  {t:'戦略',tc:'ct-s',n:'期間限定の特典を提示',d:'決断を促す',p:2,s:'「今月中にご契約いただければ、追加サポートを無償でご提供します。」',fx:(G)=>{fw('特典を提示した。');}},
  {t:'準備',tc:'ct-w',n:'提案書を渡す',d:'バフ',p:1,s:'「こちら、詳細な提案書です。ご確認ください。」',fx:(G)=>{fw('提案書を渡した。バフ獲得。');G.buff+=1;}},
  {t:'感情',tc:'ct-e',n:'御社の課題に共感する',d:'課題解決者として印象付ける',p:2,s:'「御社が抱えている課題、よく理解しています。だからこそこの提案です。」',fx:(G)=>{fw('共感を示した。');}},
  {t:'戦略',tc:'ct-s',n:'競合他社との比較を示す',d:'成功50%',p:0,s:'「他社様と比較していただいても、この点では優位性があります。」',fx:(G,cb)=>{if(Math.random()<0.5){fw('比較優位が伝わった！');G.eHP=Math.max(0,G.eHP-2);uwB();if(G.eHP<=0)endGame(true,'取引先を説得！契約成立！');else if(cb)cb();}else{fw('「他社も検討したい」と慎重になった…気力が1下がった。');G.pHP=Math.max(0,G.pHP-1);uwB();if(cb)cb();}}},
  {t:'強気',tc:'ct-sp',n:'最終条件として提示',d:'成功35%・失敗で交渉決裂リスク',p:0,s:'「これが弊社の最終条件です。この条件でご判断ください。」',fx:(G,cb)=>{if(Math.random()<0.35){fw('最終条件が通った！');setTimeout(()=>endGame(true,'最終条件が通った！契約成立！'),1200);}else{fw('取引先が「再考が必要です」と引いた…気力が2下がった。');G.pHP=Math.max(0,G.pHP-2);uwB();if(G.pHP<=0)setTimeout(()=>endGame(false,'交渉決裂。'),800);else if(cb)cb();}}},
  {t:'感情',tc:'ct-i',n:'長期的な関係を訴える',d:'気力-2',p:2,s:'「一時的な取引ではなく、長期的なパートナーとして考えています。」',fx:(G)=>{fw('長期関係を訴えた！');G.eHP=Math.max(0,G.eHP-2);uwB();}}
]};

const WORK_OPPS=[
  {id:'boss',name:'上司',abbr:'上',trait:'結果と権限を重視・高難度',demand:'残業して対応しろ',playerDemand:'労働条件の改善・昇給',context:'会議室にて。上司が腕を組み待っている。',openLine:'用件はなんだ。手短に頼む。結果で話せ。',elines:['「それで数字はどうなる？」','「言い訳は聞かない。結果を出せ。」','「感情論は結構。根拠を示せ。」']},
  {id:'subordinate',name:'部下',abbr:'部',trait:'モチベーションに敏感',demand:'仕事量を減らしてほしい',playerDemand:'部下にプロジェクトを任せたい',context:'オフィスの一角で。部下が少し険しい表情をしている。',openLine:'…あの、正直に言っていいですか。ちょっとしんどいんです。',elines:['「でも、自信がなくて…」','「もう少し時間をいただけますか。」','「…うまくできなかったらどうしよう。」']},
  {id:'peer',name:'同期',abbr:'同',trait:'仲間意識と競争心が混在',demand:'自分の仕事を代わってほしい',playerDemand:'プロジェクトで協力してほしい',context:'休憩スペースにて。同期が疲れた顔で座っている。',openLine:'え、また頼み事？お互い忙しいんだけどな。',elines:['「俺も余裕ないんだよ。」','「うーん、それはちょっとな。」','「まあ、考えてみるけどさ。」']},
  {id:'client',name:'取引先',abbr:'客',trait:'利益とリスクで判断・高難度',demand:'値引きしてほしい',playerDemand:'契約・受注を獲得したい',context:'商談室にて。取引先の担当者が資料を広げて待っている。',openLine:'御社の提案、拝見しました。率直に言うと、価格面で折り合いがつきません。',elines:['「価格がネックです。」','「他社様とも検討中でして。」','「この条件では難しいですね。」']}
];

const BATH_THEMES=[
  {id:'past',name:'過去の後悔',abbr:'後悔',trait:'過去の失敗・黒歴史',demand:'あの失敗を忘れるな',playerDemand:'過去を受け入れて前に進みたい',openLine:'…あの時のこと、覚えているか。あれはお前の失敗だ。',elines:['「もう一度思い出せ。あの恥ずかしい瞬間を。」','「過去は変えられない。お前はあの時から変わっていない。」'],cards:[{t:'内省',tc:'ct-i',n:'事実と感情を分ける',d:'客観的に過去を見る',p:2,s:'「あの出来事は事実だ。でも、それが私の全てではない。」',fx:(G)=>{fb('事実と感情を分けた。内なる声が少し静まった。');}},{t:'内省',tc:'ct-i',n:'失敗から学んだことを語る',d:'成長に変換する',p:3,s:'「あの経験があったから、今の自分がある。」',fx:(G)=>{fb('学びを見出した。');}},{t:'内省',tc:'ct-i',n:'自分を許す',d:'自己批判を手放す',p:3,s:'「もう十分責めた。今日から許してやる。」',fx:(G)=>{fb('自分を許した。');G.eHP=Math.max(0,G.eHP-1);ubB();}},{t:'呼吸',tc:'ct-sp',n:'深呼吸をする',d:'バフ',p:1,s:'「…すう…はあ…。落ち着け、自分。」',fx:(G)=>{fb('深呼吸をした。バフ獲得。');G.buff+=1;}},{t:'内省',tc:'ct-i',n:'当時の自分を抱きしめる',d:'幼い自分への共感',p:3,s:'「あの時の自分は、精一杯だったんだ。よく頑張ったな。」',fx:(G)=>{fb('当時の自分を労った。');G.eHP=Math.max(0,G.eHP-2);ubB();}},{t:'内省',tc:'ct-i',n:'「それでよかった」と言う',d:'肯定の言葉',p:2,s:'「あれはあれでよかった。だから今がある。」',fx:(G)=>{fb('肯定した。内なる声がぐらついた。');}}]},
  {id:'anxiety',name:'将来の不安',abbr:'不安',trait:'未来への漠然とした恐れ',demand:'失敗したらどうするんだ',playerDemand:'不安と折り合いをつけたい',openLine:'…もし失敗したら？もし誰にも認められなかったら？',elines:['「うまくいく保証なんてない。」','「周りはみんな先に進んでいる。」'],cards:[{t:'内省',tc:'ct-i',n:'不安を書き出す',d:'見える化して縮小',p:2,s:'「何が怖いのか、全部言葉にしてみよう。」',fx:(G)=>{fb('不安を書き出した。言葉にすると少し小さく見えてきた。');}},{t:'内省',tc:'ct-i',n:'最悪のケースを想定する',d:'受容で楽になる',p:2,s:'「最悪どうなる？…それでも生きていける。」',fx:(G)=>{fb('最悪を想定した。意外と大丈夫だと気づいた。');}},{t:'内省',tc:'ct-i',n:'今できることに集中',d:'コントロールできるものへ',p:3,s:'「変えられないことより、今できることをやろう。」',fx:(G)=>{fb('今に集中した。');}},{t:'呼吸',tc:'ct-sp',n:'深呼吸をする',d:'バフ',p:1,s:'「…すう…はあ…。今この瞬間だけ感じよう。」',fx:(G)=>{fb('深呼吸をした。バフ獲得。');G.buff+=1;}},{t:'内省',tc:'ct-i',n:'小さな一歩を決める',d:'行動で不安を消す',p:3,s:'「今日、一つだけやってみよう。それだけでいい。」',fx:(G)=>{fb('小さな一歩を決めた！');G.eHP=Math.max(0,G.eHP-2);ubB();}},{t:'内省',tc:'ct-i',n:'「どうにかなる」と信じる',d:'根拠のない自信',p:2,s:'「根拠はないけど、きっとどうにかなる。」',fx:(G)=>{fb('信じる力を発揮した。');}}]},
  {id:'stress',name:'日常のストレス',abbr:'疲れ',trait:'溜まった疲れ・義務感',demand:'もっと頑張れ',playerDemand:'もっと自分を労わりたい',openLine:'…まだやることがあるだろう？休んでいる場合じゃない。',elines:['「休んでいる間も、誰かが先に進んでいる。」','「まだ全然足りない。」'],cards:[{t:'内省',tc:'ct-i',n:'頑張った自分を認める',d:'自己肯定感を高める',p:3,s:'「今日もちゃんとやった。それだけで十分だ。」',fx:(G)=>{fb('自分を認めた。');G.eHP=Math.max(0,G.eHP-1);ubB();}},{t:'内省',tc:'ct-i',n:'休むことも仕事だと気づく',d:'休息の重要性を理解',p:2,s:'「休息は怠惰じゃない。次のための投資だ。」',fx:(G)=>{fb('休息の意味を理解した。');}},{t:'呼吸',tc:'ct-sp',n:'湯に浸かって温まる',d:'バフ＋気力-1',p:2,s:'「今日の疲れを全部、このお湯に溶かしてしまおう。」',fx:(G)=>{fb('疲れをお湯に溶かした。バフ獲得。');G.eHP=Math.max(0,G.eHP-1);ubB();G.buff+=1;}},{t:'内省',tc:'ct-i',n:'完璧じゃなくていいと知る',d:'完璧主義を手放す',p:3,s:'「70点でいい。100点じゃなくていい。」',fx:(G)=>{fb('完璧主義を手放した！');G.eHP=Math.max(0,G.eHP-2);ubB();}},{t:'呼吸',tc:'ct-sp',n:'深呼吸をする',d:'バフ',p:1,s:'「…すう…はあ…。今だけは、何も考えなくていい。」',fx:(G)=>{fb('深呼吸をした。バフ獲得。');G.buff+=1;}},{t:'内省',tc:'ct-i',n:'明日の自分に期待する',d:'休息のあとの可能性',p:2,s:'「休んだ明日の自分は、もっとうまくやれる。」',fx:(G)=>{fb('明日の自分を信じた。');}}]}
];

const ALL_OPPS={
home:[
  {id:'brother',name:'兄',abbr:'兄',trait:'競争意識が強い',demand:'漫画を貸して',playerDemand:'ゲーム機を貸してほしい',openLine:'ゲーム機？まず漫画をよこせ。',elines:['「漫画が先だ。」','「そんな言い方じゃ貸さないぞ。」','「頼み方ってもんがあるだろ。」']},
  {id:'father',name:'父',abbr:'父',trait:'威厳・保守的',demand:'静かにしろ',playerDemand:'もっと自由な時間がほしい',openLine:'何が言いたい。簡潔に言え。',elines:['「甘えるんじゃない。」','「理由になっていない。」','「まだ説得できていないぞ。」']},
  {id:'mother',name:'母',abbr:'母',trait:'情に厚い・心配性',demand:'部屋を片付けて',playerDemand:'門限を延ばしてほしい',openLine:'あなたのことが心配だからこそ言ってるのよ。',elines:['「お母さんは心配なの。」','「まだ納得できないわ。」','「ちゃんと安全は確認したの？」']},
  {id:'sister',name:'妹',abbr:'妹',trait:'感情的・甘えん坊',demand:'一緒に遊んで',playerDemand:'お気に入りのぬいぐるみを借りたい',openLine:'え〜！なんでそんなこと言うの〜！',elines:['「やだ！絶対やだ！」','「そんなこと言うならあたしも！」']}
],
school:[
  {id:'teacher',name:'先生',abbr:'師',trait:'論理と規則を重視',demand:'宿題を必ず出すこと',playerDemand:'テストの採点方法を見直してほしい',openLine:'話があるなら証拠と根拠を持ってきなさい。',elines:['「根拠になっていない。」','「規則は規則です。」','「感情的になっても無駄ですよ。」']},
  {id:'friend',name:'友達',abbr:'友',trait:'感情と空気を読む',demand:'ノートを見せて',playerDemand:'秘密を打ち明けてほしい',openLine:'えー、なんかあったの？ちゃんと話してよ。',elines:['「なんか信じらんない。」','「もうちょっとわかりやすく言ってよ。」','「うーん、まだ納得いかないな。」']},
  {id:'senior',name:'先輩',abbr:'先',trait:'経験と権威を主張',demand:'雑用を手伝え',playerDemand:'理不尽なルールを変えてほしい',openLine:'後輩が先輩に意見するのか。面白い、言ってみろ。',elines:['「経験の浅い奴に何がわかる。」','「先輩の言うことに逆らうな。」','「もっと実力をつけてから来い。」']},
  {id:'junior',name:'後輩',abbr:'後',trait:'従順だが頑固な一面も',demand:'仕事を代わってほしい',playerDemand:'後輩に積極的に動いてほしい',openLine:'えっと…先輩、でも私にはちょっと難しくて…',elines:['「でも、自信がないです…」','「もう少し時間をください…」','「先輩、それは私には…」']}
],
park:[
  {id:'friend',name:'友達',abbr:'友',trait:'感情と空気を読む',demand:'ゲームを貸して',playerDemand:'秘密基地の場所を教えてほしい',openLine:'え、いきなりそれ？もうちょっと話しかけ方ってもんがあるじゃん。',elines:['「なんでそんなこと言うの。」','「それだけじゃ納得できないな。」','「なんか違くない？」']},
  {id:'parent',name:'親',abbr:'親',trait:'心配性・過保護気味',demand:'もう帰りなさい',playerDemand:'もっと遊ばせてほしい',openLine:'もう遅いでしょ。早く帰りなさい。',elines:['「心配だから言ってるの。」','「危ないでしょ。」','「もっとちゃんと考えなさい。」']},
  {id:'clerk',name:'コンビニ店員',abbr:'店',trait:'マニュアル通りに動く',demand:'早く決めてください',playerDemand:'返品・交換をしてほしい',openLine:'申し訳ありませんが、規則上対応しかねます。',elines:['「規則ですので。」','「マニュアルにはそう書かれていません。」','「上の者に確認する必要があります。」']},
  {id:'stranger',name:'見知らぬおじさん',abbr:'謎',trait:'頑固・自分のペースで動く',demand:'静かにしろ',playerDemand:'占領されたベンチを使わせてほしい',openLine:'うるさい！ここは俺の場所だ。あっち行け！',elines:['「関係ないだろ！」','「うるさい、あっち行け！」','「なんだ、文句あるのか！」']}
]};

function oEm(id){const m={brother:'🧑',father:'👨',mother:'👩',sister:'👧',teacher:'📚',friend:'😄',senior:'🎓',junior:'🌱',parent:'👨‍👩‍👦',clerk:'🏪',stranger:'👴',past:'👻',anxiety:'🌀',stress:'😮‍💨',boss:'👔',subordinate:'💼',peer:'🤝',client:'🏛️'};return m[id]||'👤';}

let G={sit:null,opp:null,bathTheme:null,workOpp:null,pHP:5,eHP:5,deck:[],hand:[],turn:'player',xp:0,level:1,ended:false,buff:0,debuff:false,motherUsed:false,acquiredLaws:[]};

function go(id){document.querySelectorAll('.g').forEach(e=>e.classList.remove('on'));const el=document.getElementById(id);if(el)el.classList.add('on');}
function selSit(sit,el){if(el.classList.contains('locked'))return;G.sit=sit;document.querySelectorAll('.sit-c').forEach(c=>c.classList.remove('sel'));el.classList.add('sel');const b=document.getElementById('btn-sit-nxt');b.style.opacity='1';b.style.pointerEvents='auto';}

function goOpp(){
  if(!G.sit)return;
  G.opp=null;G.bathTheme=null;G.workOpp=null;
  const names={home:'家',school:'学校',park:'公園',bath:'風呂場',work:'職場'};
  const subs={home:'誰と交渉しますか？',school:'誰と交渉しますか？',park:'誰と交渉しますか？',bath:'何と向き合いますか？',work:'誰と交渉しますか？'};
  document.getElementById('opp-hd').textContent=(names[G.sit]||G.sit)+'での交渉相手';
  document.getElementById('opp-sub').textContent=subs[G.sit]||'誰と交渉しますか？';
  const grid=document.getElementById('opp-grid');grid.innerHTML='';
  const nb=document.getElementById('btn-opp-nxt');nb.style.opacity='0.4';nb.style.pointerEvents='none';
  const list=G.sit==='bath'?BATH_THEMES:G.sit==='work'?WORK_OPPS:(ALL_OPPS[G.sit]||[]);
  list.forEach(o=>{
    const el=document.createElement('div');el.className='opp-c';
    el.innerHTML=`<div class="opp-em">${oEm(o.id)}</div><div class="opp-nm">${o.name}</div><div class="opp-tr">${o.trait}</div>`;
    el.onclick=()=>{document.querySelectorAll('.opp-c').forEach(c=>c.classList.remove('sel'));el.classList.add('sel');if(G.sit==='bath'){G.bathTheme=o;G.opp=o;}else if(G.sit==='work'){G.workOpp=o;G.opp=o;}else G.opp=o;nb.style.opacity='1';nb.style.pointerEvents='auto';};
    grid.appendChild(el);
  });
  go('g-opp');
}

function shuffle(a){const r=[...a];for(let i=r.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[r[i],r[j]]=[r[j],r[i]];}return r;}

function startBattle(){
  if(!G.opp)return;
  G.pHP=5;G.eHP=5;G.turn='player';G.ended=false;G.buff=0;G.debuff=false;G.motherUsed=false;
  if(G.sit==='bath'){startBathB();return;}
  if(G.sit==='work'){startWorkB();return;}
  G.deck=shuffle([...getNormalDeck()]);G.hand=[];
  for(let i=0;i<4&&G.deck.length>0;i++)G.hand.push(G.deck.shift());
  document.getElementById('e-circle').textContent=G.opp.abbr;
  document.getElementById('e-name').textContent=G.opp.name;
  document.getElementById('e-demand').textContent=G.opp.demand;
  document.getElementById('p-demand').textContent=G.opp.playerDemand;
  document.getElementById('bal-e').textContent=G.opp.openLine;
  document.getElementById('bal-p').textContent='カードを選んで発言しよう';
  document.getElementById('bal-p').classList.add('ph');
  document.getElementById('hint-panel').classList.remove('open');
  document.getElementById('btn-hint').classList.remove('active');
  document.getElementById('flash-msg').classList.remove('on');
  renderHL('hint-law-list');setTL('player',false);upB(false);renderH(false);
  go('g-battle');
}

function startBathB(){
  const th=G.bathTheme;
  G.deck=shuffle([...th.cards]);G.hand=[];
  for(let i=0;i<4&&G.deck.length>0;i++)G.hand.push(G.deck.shift());
  document.getElementById('bath-e-circle').textContent=th.abbr;
  document.getElementById('bath-e-name').textContent=th.name;
  document.getElementById('bath-e-demand').textContent=th.demand;
  document.getElementById('bath-p-demand').textContent=th.playerDemand;
  document.getElementById('bath-bal-e').textContent=th.openLine;
  document.getElementById('bath-bal-p').textContent='カードを選んで自分と向き合おう';
  document.getElementById('bath-bal-p').classList.add('ph');
  document.getElementById('hint-panel-bath').classList.remove('open');
  document.getElementById('btn-hint-bath').classList.remove('active');
  document.getElementById('flash-bath').classList.remove('on');
  renderHL('hint-law-list-bath');setTL('inner',true);upB(true,'bath');renderH(true,'bath');
  go('g-battle-bath');
}

function startWorkB(){
  const wo=G.workOpp;
  G.deck=shuffle([...WORK_DECKS[wo.id]]);G.hand=[];
  for(let i=0;i<4&&G.deck.length>0;i++)G.hand.push(G.deck.shift());
  document.getElementById('work-e-circle').textContent=wo.abbr;
  document.getElementById('work-e-name').textContent=wo.name;
  document.getElementById('work-e-demand').textContent=wo.demand;
  document.getElementById('work-p-demand').textContent=wo.playerDemand;
  document.getElementById('work-context-text').textContent=wo.context||'会議室にて。';
  document.getElementById('work-bal-e').textContent=wo.openLine;
  document.getElementById('work-bal-p').textContent='カードを選んで発言しよう';
  document.getElementById('work-bal-p').classList.add('ph');
  document.getElementById('hint-panel-work').classList.remove('open');
  document.getElementById('btn-hint-work').classList.remove('active');
  document.getElementById('flash-work').classList.remove('on');
  renderHL('hint-law-list-work');setTL('player',false,'work');upB(false,'work');renderH(false,'work');
  go('g-battle-work');
}

function getNormalDeck(){
  const D={
    home:{
      brother:[
        {t:'漫画',tc:'ct-sp',n:'アクション漫画',d:'バフ',p:2,s:'「アクション系、面白いよ。」',fx:(G)=>{f1('バフ獲得！');G.buff=Math.max(G.buff,1);}},
        {t:'漫画',tc:'ct-sp',n:'推理漫画',d:'刺さる',p:3,s:'「推理漫画、ハマると思う。」',fx:(G)=>{f1('推理漫画！');}},
        {t:'切り札',tc:'ct-sp',n:'母に言う',d:'成功率50%',p:0,s:'「お母さん！」',fx:(G,cb)=>{const r=G.motherUsed?0.2:0.5;G.motherUsed=true;if(Math.random()<r){f1('お母さんが来た！');setTimeout(()=>endGame(true,'お母さんの一言で交渉成立！'),1200);}else{f1('来てくれなかった…気力-3');G.pHP=Math.max(0,G.pHP-3);upB(false);if(G.pHP<=0)setTimeout(()=>endGame(false,'気力が尽きた…'),800);else if(cb)cb();}}},
        {t:'アイテム',tc:'ct-e',n:'シュークリーム',d:'バフ',p:1,s:'「好きでしょ。」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}},
        {t:'説得',tc:'ct-p',n:'使用時間を伝える',d:'条件提示',p:2,s:'「1時間だけ。」',fx:(G)=>{f1('条件提示した。');}},
        {t:'内省',tc:'ct-i',n:'思い出を語る',d:'バフ',p:1,s:'「昔よく一緒にやったよね。」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}},
        {t:'感情',tc:'ct-e',n:'謝る',d:'気力-1',p:1,s:'「ごめん。」',fx:(G)=>{f1('謝った。');G.eHP=Math.max(0,G.eHP-1);upB(false);}}
      ],
      father:[
        {t:'説得',tc:'ct-p',n:'データで証明',d:'実績で説得',p:3,s:'「先月90点取りました。」',fx:(G)=>{f1('実績提示。');}},
        {t:'法律',tc:'ct-l',n:'憲法13条',d:'個人の尊重',p:3,s:'「個人として尊重される権利があります。」',fx:(G)=>{f1('法律引用！');}},
        {t:'アイテム',tc:'ct-e',n:'お茶を持つ',d:'バフ',p:1,s:'「お茶どうぞ。」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}},
        {t:'感情',tc:'ct-i',n:'素直に謝る',d:'気力-1',p:1,s:'「ごめんなさい。」',fx:(G)=>{f1('謝った。');G.eHP=Math.max(0,G.eHP-1);upB(false);}},
        {t:'説得',tc:'ct-p',n:'将来の計画を話す',d:'将来性で納得させる',p:2,s:'「将来こういう目標があります。」',fx:(G)=>{f1('将来の計画を話した。');}},
        {t:'感情',tc:'ct-e',n:'感謝を伝える',d:'バフ',p:1,s:'「いつも支えてくれてありがとう。」',fx:(G)=>{f1('感謝！バフ獲得。');G.buff+=1;}}
      ],
      mother:[
        {t:'感情',tc:'ct-e',n:'正直に伝える',d:'感情に訴える',p:3,s:'「本当にやりたいことなんだ。」',fx:(G)=>{f1('正直に伝えた。');}},
        {t:'感情',tc:'ct-e',n:'ハグをする',d:'気力-2',p:2,s:'「お母さん大好き。」',fx:(G)=>{f1('ハグ！');G.eHP=Math.max(0,G.eHP-2);upB(false);}},
        {t:'アイテム',tc:'ct-e',n:'手伝いをする',d:'バフ',p:1,s:'「お皿洗うよ。」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}},
        {t:'法律',tc:'ct-l',n:'権利条約12条',d:'権利主張',p:2,s:'「意見を表明する権利があります。」',fx:(G)=>{f1('法律引用！');}},
        {t:'説得',tc:'ct-p',n:'安全を約束する',d:'心配を解消',p:2,s:'「ちゃんと気をつける。何かあったらすぐ電話する。」',fx:(G)=>{f1('安全を約束した。');}},
        {t:'感情',tc:'ct-i',n:'感謝の気持ちを伝える',d:'バフ',p:1,s:'「心配してくれるからこそ、ちゃんと話したい。」',fx:(G)=>{f1('感謝を伝えた。バフ獲得。');G.buff+=1;}}
      ],
      sister:[
        {t:'感情',tc:'ct-e',n:'褒める',d:'気力-1',p:1,s:'「センスいいね。」',fx:(G)=>{f1('褒めた！');G.eHP=Math.max(0,G.eHP-1);upB(false);}},
        {t:'アイテム',tc:'ct-sp',n:'一緒にゲーム',d:'気力-3',p:3,s:'「一緒に遊ぼう！」',fx:(G)=>{f1('一緒に遊んだ！');}},
        {t:'感情',tc:'ct-i',n:'かわいいと言う',d:'気力-2',p:2,s:'「ほんとかわいいね〜。」',fx:(G)=>{f1('デレた！');G.eHP=Math.max(0,G.eHP-2);upB(false);}},
        {t:'アイテム',tc:'ct-e',n:'お菓子を渡す',d:'バフ',p:1,s:'「これあげる！」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}},
        {t:'説得',tc:'ct-p',n:'順番を決める',d:'公平な提案',p:2,s:'「じゃあ交代でやろう。最初はあなたから。」',fx:(G)=>{f1('公平な提案をした。');}}
      ]
    },
    school:{
      teacher:[
        {t:'説得',tc:'ct-p',n:'根拠を示す',d:'証拠で説得',p:3,s:'「この資料を見てください。」',fx:(G)=>{f1('根拠提示！');}},
        {t:'法律',tc:'ct-l',n:'教育基本法',d:'権利主張',p:3,s:'「教育の機会均等が保障されています。」',fx:(G)=>{f1('法律引用！');}},
        {t:'アイテム',tc:'ct-e',n:'メモを渡す',d:'バフ',p:1,s:'「まとめてきました。」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}},
        {t:'感情',tc:'ct-i',n:'反省を示す',d:'誠意を見せる',p:2,s:'「先生のおっしゃることはわかります。ただ…」',fx:(G)=>{f1('誠意を見せた。');}},
        {t:'法律',tc:'ct-l',n:'いじめ防止法',d:'環境の権利を訴える',p:2,s:'「安心して学べる環境は守られるべきです。」',fx:(G)=>{f1('法律引用！');}},
        {t:'感情',tc:'ct-e',n:'真剣さを伝える',d:'バフ',p:1,s:'「本当に真剣に考えています。」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}}
      ],
      friend:[
        {t:'感情',tc:'ct-e',n:'本音で話す',d:'友情に訴える',p:3,s:'「本当に助けてほしいんだ。」',fx:(G)=>{f1('本音！');}},
        {t:'アイテム',tc:'ct-e',n:'おごる',d:'気力-2',p:2,s:'「今日おごるよ。」',fx:(G)=>{f1('おごった！');G.eHP=Math.max(0,G.eHP-2);upB(false);}},
        {t:'感情',tc:'ct-i',n:'謝る',d:'気力-1',p:1,s:'「俺が悪かった。」',fx:(G)=>{f1('謝った。');G.eHP=Math.max(0,G.eHP-1);upB(false);}},
        {t:'説得',tc:'ct-p',n:'お互い様を話す',d:'互恵関係',p:2,s:'「前に助けてもらったから。今度は俺の番。」',fx:(G)=>{f1('お互い様を話した。');}},
        {t:'感情',tc:'ct-e',n:'秘密を打ち明ける',d:'気力-2',p:2,s:'「実は、お前だけに話す。」',fx:(G)=>{f1('秘密を打ち明けた！');G.eHP=Math.max(0,G.eHP-2);upB(false);}},
        {t:'アイテム',tc:'ct-sp',n:'プレゼントを渡す',d:'バフ',p:1,s:'「これ、好きだと思って。」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}}
      ],
      senior:[
        {t:'感情',tc:'ct-e',n:'尊敬を示す',d:'承認欲求を満たす',p:2,s:'「先輩を尊敬しています。」',fx:(G)=>{f1('尊敬示した。');}},
        {t:'法律',tc:'ct-l',n:'学校教育法11条',d:'体罰禁止を根拠に',p:3,s:'「体罰は学校教育法で禁止されています。」',fx:(G)=>{f1('法律引用！先輩が黙った。');}},
        {t:'アイテム',tc:'ct-e',n:'差し入れを渡す',d:'バフ',p:1,s:'「これ、皆にと思って。」',fx:(G)=>{f1('差し入れ！バフ獲得。');G.buff+=1;}},
        {t:'説得',tc:'ct-p',n:'実績で証明',d:'成果を見せる',p:2,s:'「このデータを見てください。」',fx:(G)=>{f1('実績を見せた。');}},
        {t:'感情',tc:'ct-i',n:'素直に謝る',d:'気力-1',p:1,s:'「先輩、すみませんでした。」',fx:(G)=>{f1('謝った。');G.eHP=Math.max(0,G.eHP-1);upB(false);}},
        {t:'感情',tc:'ct-e',n:'先輩の話を聞く',d:'バフ',p:1,s:'「先輩の経験から聞かせてください。」',fx:(G)=>{f1('傾聴した。バフ獲得。');G.buff+=1;}}
      ],
      junior:[
        {t:'感情',tc:'ct-e',n:'褒める',d:'モチベUP・気力-1',p:2,s:'「最近すごく成長してるね。」',fx:(G)=>{f1('褒めた！');G.eHP=Math.max(0,G.eHP-1);upB(false);}},
        {t:'説得',tc:'ct-p',n:'目標を一緒に考える',d:'自主性を引き出す',p:2,s:'「どんな目標にしたい？一緒に決めよう。」',fx:(G)=>{f1('目標を共有した。');}},
        {t:'アイテム',tc:'ct-e',n:'ジュースをおごる',d:'バフ',p:1,s:'「ちょっと話せる？飲み物でもどう？」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}},
        {t:'感情',tc:'ct-i',n:'悩みを聞く',d:'バフ',p:1,s:'「何か困ってる？正直に言っていいよ。」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}},
        {t:'説得',tc:'ct-p',n:'一緒にやってみる',d:'実演で安心させる',p:3,s:'「最初は一緒にやろう。やり方見せるね。」',fx:(G)=>{f1('一緒に取り組んだ！');}},
        {t:'感情',tc:'ct-e',n:'謝る',d:'気力-1',p:1,s:'「さっきの言い方が悪かった。ごめんね。」',fx:(G)=>{f1('謝った。');G.eHP=Math.max(0,G.eHP-1);upB(false);}}
      ]
    },
    park:{
      friend:[
        {t:'感情',tc:'ct-e',n:'本音で話す',d:'友情に訴える',p:3,s:'「本当のことを言うと…お前にしか頼めない。」',fx:(G)=>{f1('本音を話した！');}},
        {t:'アイテム',tc:'ct-e',n:'おやつをシェア',d:'気力-2',p:2,s:'「これ半分あげる。」',fx:(G)=>{f1('おやつをシェアした！');G.eHP=Math.max(0,G.eHP-2);upB(false);}},
        {t:'感情',tc:'ct-i',n:'謝る',d:'気力-1',p:1,s:'「ごめん、俺が悪かった。」',fx:(G)=>{f1('謝った。');G.eHP=Math.max(0,G.eHP-1);upB(false);}},
        {t:'説得',tc:'ct-p',n:'秘密を守ると約束',d:'信頼を示す',p:2,s:'「絶対誰にも言わないから。信じてくれ。」',fx:(G)=>{f1('約束した。');}},
        {t:'アイテム',tc:'ct-sp',n:'一緒にゲームをする',d:'気力-2',p:2,s:'「じゃあ一緒にやろうよ！」',fx:(G)=>{f1('一緒にゲーム！');}},
        {t:'感情',tc:'ct-e',n:'友情を思い出させる',d:'バフ',p:1,s:'「昔からの仲じゃん。なんでも言い合える仲だろ。」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}}
      ],
      parent:[
        {t:'説得',tc:'ct-p',n:'安全を伝える',d:'心配を解消',p:3,s:'「〇〇の家にいるから大丈夫。電話もできるよ。」',fx:(G)=>{f1('安全を伝えた。');}},
        {t:'感情',tc:'ct-e',n:'素直にお願い',d:'感情に訴える',p:2,s:'「もう少しだけ。楽しいんだ、お願い。」',fx:(G)=>{f1('素直にお願いした。');}},
        {t:'法律',tc:'ct-l',n:'権利条約12条',d:'意見表明権を主張',p:2,s:'「子どもにも意見を言う権利があります。」',fx:(G)=>{f1('法律引用！');}},
        {t:'アイテム',tc:'ct-e',n:'お手伝いを約束',d:'バフ',p:1,s:'「帰ったら絶対お皿洗う！約束する。」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}},
        {t:'感情',tc:'ct-i',n:'心配に感謝する',d:'気力-1',p:2,s:'「心配してくれてありがとう。でもちゃんとしてるよ。」',fx:(G)=>{f1('感謝を伝えた。');G.eHP=Math.max(0,G.eHP-1);upB(false);}},
        {t:'説得',tc:'ct-p',n:'帰宅時間を提案',d:'妥協案を出す',p:2,s:'「あと30分だけ。5時には帰る。どう？」',fx:(G)=>{f1('妥協案を提案した。');}}
      ],
      clerk:[
        {t:'説得',tc:'ct-p',n:'レシートを見せる',d:'証拠で正当性を示す',p:3,s:'「こちらがレシートです。購入から30分以内です。」',fx:(G)=>{f1('証拠を提示した！');}},
        {t:'法律',tc:'ct-l',n:'消費者契約法4条',d:'不当対応に対抗',p:3,s:'「消費者契約法第4条に基づき対応をお願いします。」',fx:(G)=>{f1('法律引用！店員が表情を変えた。');}},
        {t:'感情',tc:'ct-e',n:'丁寧にお願い',d:'穏やかに交渉',p:2,s:'「お手数ですが、一度確認していただけますか。」',fx:(G)=>{f1('丁寧にお願いした。');}},
        {t:'アイテム',tc:'ct-e',n:'証拠写真を見せる',d:'バフ',p:1,s:'「開封直後に撮った写真です。」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}},
        {t:'戦略',tc:'ct-s',n:'マネージャーを呼ぶ',d:'成功50%',p:0,s:'「マネージャーにご相談していただけますか。」',fx:(G,cb)=>{if(Math.random()<0.5){f1('マネージャーが来た！解決！');G.eHP=Math.max(0,G.eHP-3);upB(false);if(G.eHP<=0)endGame(true,'交渉成功！返品できた！');else if(cb)cb();}else{f1('マネージャーも同じ対応だった…気力-1');G.pHP=Math.max(0,G.pHP-1);upB(false);if(cb)cb();}}},
        {t:'感情',tc:'ct-i',n:'穏やかに粘る',d:'バフ',p:1,s:'「少し時間をいただいて、もう一度確認できますか。」',fx:(G)=>{f1('バフ獲得。');G.buff+=1;}}
      ],
      stranger:[
        {t:'感情',tc:'ct-e',n:'穏やかに話しかける',d:'刺激を避ける',p:2,s:'「すみません、少しよろしいですか。」',fx:(G)=>{f1('穏やかに話しかけた。');}},
        {t:'法律',tc:'ct-l',n:'道路交通法76条',d:'公共の場の利用を主張',p:3,s:'「公共の場所はみんなのものです。法律でも定められています。」',fx:(G)=>{f1('法律引用！おじさんがひるんだ。');}},
        {t:'感情',tc:'ct-i',n:'共感を示す',d:'相手の気持ちを理解',p:2,s:'「疲れているんですね。でも、私も少し座りたくて。」',fx:(G)=>{f1('共感を示した。');}},
        {t:'アイテム',tc:'ct-e',n:'別の場所を案内',d:'バフ',p:1,s:'「もっと日当たりのいい場所がありますよ。」',fx:(G)=>{f1('バフ獲得！');G.buff+=1;}},
        {t:'法律',tc:'ct-l',n:'軽犯罪法1条',d:'法的根拠を示す',p:3,s:'「軽犯罪法でも迷惑行為は禁止されています。」',fx:(G)=>{f1('法律引用！おじさんが黙った。');}},
        {t:'感情',tc:'ct-i',n:'諦めて別の場所へ',d:'スマートな撤退',p:0,s:'「…別の場所を探します。お気をつけて。」',fx:(G,cb)=>{f1('別の場所を探した。時に引くことも大切。');G.pHP=Math.min(5,G.pHP+1);upB(false);if(cb)cb();}}
      ]
    }
  };
  return (D[G.sit]||{})[G.opp&&G.opp.id]||[];
}

// ── ユーティリティ ──────────────────────────────

function f1(msg){const el=document.getElementById('flash-msg');if(!el)return;el.textContent=msg;el.classList.add('on');setTimeout(()=>el.classList.remove('on'),2200);}
function fw(msg){const el=document.getElementById('flash-work');if(!el)return;el.textContent=msg;el.classList.add('on');setTimeout(()=>el.classList.remove('on'),2200);}
function fb(msg){const el=document.getElementById('flash-bath');if(!el)return;el.textContent=msg;el.classList.add('on');setTimeout(()=>el.classList.remove('on'),2200);}

function upB(isBath,mode){
  if(mode==='work'){uwB();return;}
  if(isBath||mode==='bath'){ubB();return;}
  const pPct=G.pHP/5*100,ePct=G.eHP/5*100;
  document.getElementById('bar-p').style.width=pPct+'%';
  document.getElementById('bar-e').style.width=ePct+'%';
  document.getElementById('val-p').textContent=G.pHP;
  document.getElementById('val-e').textContent=G.eHP;
}
function uwB(){
  const pPct=G.pHP/5*100,ePct=G.eHP/5*100;
  document.getElementById('work-bar-p').style.width=pPct+'%';
  document.getElementById('work-bar-e').style.width=ePct+'%';
  document.getElementById('work-val-p').textContent=G.pHP;
  document.getElementById('work-val-e').textContent=G.eHP;
}
function ubB(){
  const pPct=G.pHP/5*100,ePct=G.eHP/5*100;
  document.getElementById('bath-bar-p').style.width=pPct+'%';
  document.getElementById('bath-bar-e').style.width=ePct+'%';
  document.getElementById('bath-val-p').textContent=G.pHP;
  document.getElementById('bath-val-e').textContent=G.eHP;
}

function setTL(turn,isBath,mode){
  if(mode==='work'){
    const el=document.getElementById('turn-lbl-work');
    el.textContent=turn==='player'?'あなたのターン':'相手のターン';
    el.className='turn-lbl '+(turn==='player'?'tl-work':'tl-e');
  }else if(isBath){
    const el=document.getElementById('turn-lbl-bath');
    el.textContent=turn==='player'?'あなたのターン':'内なる声のターン';
    el.className='turn-lbl tl-bath';
  }else{
    const el=document.getElementById('turn-lbl');
    el.textContent=turn==='player'?'あなたのターン':'相手のターン';
    el.className='turn-lbl '+(turn==='player'?'tl-p':'tl-e');
  }
}

function renderH(isBath,mode){
  mode=mode||'';
  const areaId=mode==='work'?'work-hand-area':isBath?'bath-hand-area':'hand-area';
  const deckId=mode==='work'?'work-deck-ct':isBath?'bath-deck-ct':'deck-ct';
  const area=document.getElementById(areaId);
  if(!area)return;
  area.innerHTML='';
  const deckEl=document.getElementById(deckId);
  if(deckEl)deckEl.textContent='山札 '+G.deck.length;
  G.hand.forEach((card,idx)=>{
    const el=document.createElement('div');
    const cls=mode==='work'?'work-card':isBath?'bath-card':'';
    el.className='card'+(cls?' '+cls:'');
    if(G.turn!=='player'||G.ended)el.style.pointerEvents='none';
    const pipCls=mode==='work'?'pp-work':isBath?'pp-bath':'pp';
    const pips=[0,1,2].map(i=>`<div class="${pipCls}${i>=card.p?' off':''}"></div>`).join('');
    el.innerHTML=`<div class="ct ${card.tc}">${card.t}</div><div class="cn">${card.n}</div><div class="pow-bar">${pips}</div><div class="cd">${card.d}</div>`;
    el.onclick=()=>{if(G.turn==='player'&&!G.ended)playCard(idx,isBath,mode);};
    area.appendChild(el);
  });
}

function renderHL(listId){
  const el=document.getElementById(listId);
  if(!el)return;
  if(!G.acquiredLaws||G.acquiredLaws.length===0){
    el.innerHTML='<div class="hint-empty">交渉成功で法律を獲得できます。</div>';return;
  }
  el.innerHTML='';
  G.acquiredLaws.forEach(law=>{
    const d=document.createElement('div');d.className='hint-law';
    d.innerHTML=`<div class="hint-law-name">${law.name}</div><div class="hint-law-body">${law.body}</div><div class="hint-law-src">${law.src}</div>`;
    el.appendChild(d);
  });
}

function toggleHint(panelId,btnId){
  const panel=document.getElementById(panelId);
  const btn=document.getElementById(btnId);
  if(!panel||!btn)return;
  if(panel.classList.contains('open')){panel.classList.remove('open');btn.classList.remove('active');}
  else{panel.classList.add('open');btn.classList.add('active');}
}

// ── カードプレイ ─────────────────────────────────

function playCard(idx,isBath,mode){
  if(G.turn!=='player'||G.ended)return;
  const card=G.hand[idx];
  if(!card)return;
  isBath=!!isBath;mode=mode||'';
  G.turn='enemy';
  G.hand.splice(idx,1);
  setTL('enemy',isBath,mode);

  const pBalId=mode==='work'?'work-bal-p':isBath?'bath-bal-p':'bal-p';
  const pBal=document.getElementById(pBalId);
  if(pBal){pBal.textContent=card.s;pBal.classList.remove('ph');}

  if(G.deck.length>0)G.hand.push(G.deck.shift());

  const savedBuff=G.buff;
  const savedDebuff=G.debuff;
  G.buff=0;G.debuff=false;

  const afterEff=()=>{
    if(G.ended)return;
    if(G.pHP<=0){endGame(false,'気力が尽きた…');return;}
    if(G.eHP<=0){endGame(true,'交渉成功！');return;}
    renderH(isBath,mode);
    setTimeout(()=>eAction(isBath,mode),1000);
  };

  if(card.p===0){
    card.fx(G,afterEff);
  }else{
    const eHpBefore=G.eHP;
    card.fx(G);
    if(G.eHP===eHpBefore){
      let dmg=card.p+savedBuff;
      if(savedDebuff)dmg=Math.max(1,Math.floor(dmg/2));
      G.eHP=Math.max(0,G.eHP-dmg);
      if(mode==='work')uwB();else if(isBath)ubB();else upB(false);
    }
    if(G.eHP<=0){renderH(isBath,mode);setTimeout(()=>endGame(true,'交渉成功！'),800);return;}
    if(G.pHP<=0){renderH(isBath,mode);setTimeout(()=>endGame(false,'気力が尽きた…'),800);return;}
    renderH(isBath,mode);
    setTimeout(()=>eAction(isBath,mode),1000);
  }
}

// ── 敵アクション ─────────────────────────────────

function eAction(isBath,mode){
  if(G.ended)return;
  mode=mode||'';
  const eBalId=mode==='work'?'work-bal-e':isBath?'bath-bal-e':'bal-e';
  const eBal=document.getElementById(eBalId);
  const lines=G.opp&&G.opp.elines?G.opp.elines:['「…」'];
  const line=lines[Math.floor(Math.random()*lines.length)];
  if(eBal)eBal.textContent=line;

  const hardIds=['teacher','father','senior','stranger','boss','client'];
  const isHard=G.opp&&hardIds.includes(G.opp.id);
  const dmg=(isHard&&Math.random()<0.5)?2:1;
  G.pHP=Math.max(0,G.pHP-dmg);

  if(mode==='work')uwB();else if(isBath)ubB();else upB(false);

  const flashId=mode==='work'?'flash-work':isBath?'flash-bath':'flash-msg';
  const flashEl=document.getElementById(flashId);
  if(flashEl){
    flashEl.textContent='相手の言葉が刺さった…気力 -'+dmg;
    flashEl.classList.add('on');
    setTimeout(()=>flashEl.classList.remove('on'),1500);
  }

  if(G.pHP<=0){setTimeout(()=>endGame(false,'気力が尽きた…'),800);return;}
  G.turn='player';
  setTL('player',isBath,mode);
  renderH(isBath,mode);
}

// ── 結果 ─────────────────────────────────────────

function endGame(won,msg){
  if(G.ended)return;
  G.ended=true;
  const sit=G.sit||'home';
  let newLaw=null;
  if(won){
    const laws=ALL_LAWS[sit]||[];
    const avail=laws.filter(l=>!G.acquiredLaws.some(a=>a.id===l.id));
    if(avail.length>0){newLaw=avail[Math.floor(Math.random()*avail.length)];G.acquiredLaws.push(newLaw);}
  }
  const xpGain=won?(G.sit==='work'?30:20):5;
  G.xp+=xpGain;
  const xpNeeded=G.level*100;
  let leveled=false;
  if(G.xp>=xpNeeded){G.xp-=xpNeeded;G.level++;leveled=true;}

  const icon=document.getElementById('r-icon');
  const ttl=document.getElementById('r-ttl');
  const rmsg=document.getElementById('r-msg');
  if(icon)icon.textContent=won?'🏆':'💔';
  if(ttl){ttl.textContent=won?'交渉成功！':'交渉失敗…';ttl.className='r-ttl '+(won?'r-win':'r-lose');}
  if(rmsg)rmsg.textContent=msg||(won?'見事な交渉力だ。':'また挑戦しよう。');

  const lawCard=document.getElementById('r-law');
  if(won&&newLaw&&lawCard){
    lawCard.style.display='block';
    const items=document.getElementById('r-law-items');
    if(items)items.innerHTML=`<div class="law-item"><div class="law-item-name">${newLaw.name}</div><div class="law-item-body">${newLaw.body}</div><div class="law-item-src">${newLaw.src}</div></div>`;
  }else if(lawCard){lawCard.style.display='none';}

  const LVNAMES=['交渉士見習い','交渉士','熟練交渉士','上級交渉士','エキスパート','マスター交渉士'];
  const lvName=LVNAMES[Math.min(G.level-1,LVNAMES.length-1)];
  const rlv=document.getElementById('r-lv');
  if(rlv)rlv.textContent='Lv.'+G.level+' '+lvName+(leveled?'　⬆ レベルアップ！':'');
  const xpPct=Math.min(100,G.xp/(G.level*100)*100);
  const rxpl=document.getElementById('r-xp-l');
  if(rxpl)rxpl.textContent='XP '+G.xp+' / '+(G.level*100);
  const rxp=document.getElementById('r-xp');
  if(rxp){rxp.style.width='0%';setTimeout(()=>{rxp.style.width=xpPct+'%';},100);}

  go('g-result');
}

function playAgain(){
  G.sit=null;G.opp=null;G.bathTheme=null;G.workOpp=null;
  G.pHP=5;G.eHP=5;G.deck=[];G.hand=[];
  G.turn='player';G.ended=false;G.buff=0;G.debuff=false;
  go('g-sit');
  document.querySelectorAll('.sit-c').forEach(c=>c.classList.remove('sel'));
  document.querySelectorAll('.opp-c').forEach(c=>c.classList.remove('sel'));
  const b=document.getElementById('btn-sit-nxt');
  if(b){b.style.opacity='0.4';b.style.pointerEvents='none';}
  const b2=document.getElementById('btn-opp-nxt');
  if(b2){b2.style.opacity='0.4';b2.style.pointerEvents='none';}
}
