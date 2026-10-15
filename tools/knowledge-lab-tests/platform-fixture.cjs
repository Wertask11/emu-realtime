"use strict";
// Local-only labelled regression records. The shared fixture enforces demo project/loopback endpoints.
require("./native-fixture.cjs").main({ platformRegression: true }).then(async (f) => {
  const owner=f.users.owner.account.walletAddress.toLowerCase();
  await f.db.collection("sp_quests").doc("local-regression-quest").set({
    title:"LOCAL 回帰検証用クエスト", intro:"エミュレーターだけの検証データです。",
    series:"general",questNumber:91,branch:0,stage:"入門",owner,status:"OPEN",
    guildId:"learn",createdAt:Date.now(),closesAt:Date.now()+7*86400000,
  });
  for(const [theme,subTheme] of [["money","増やし方"],["net","AIとの付き合い方"],["life","家事"],["blue","リーダーシップ"]]){
    await f.db.collection("room1_contents").doc("local-"+theme).set({
      theme,subTheme,...(theme==="blue"?{subSubTheme:"理念"}:{}),
      title:"LOCAL Room1 "+theme,body:"これはエミュレーター内の既存リテラシー表示確認用です。",
      createdAt:new Date().toISOString(),
    });
  }
  console.log("Platform regression fixture ready; local emulator only");
}).catch(e=>{console.error(e.code||e.message);process.exitCode=1});
