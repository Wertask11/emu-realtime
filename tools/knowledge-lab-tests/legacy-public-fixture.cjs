"use strict";
const { createFixture } = require("./fixture.cjs");
const { utils } = require("../../backend/node_modules/ethers");
createFixture({ port: 4203, reset: false })
  .then(async (f) => {
    await f.db
      .collection("posts")
      .doc("000-legacy-public-ui")
      .set({
        title: "LOCAL：旧Emuの公開投稿",
        body: "実Auth・Firestoreエミュレーターだけの検証記録です。元の投稿を複製せずに編集します。",
        address: utils.getAddress(
          f.users.bob.account.walletAddress.toLowerCase(),
        ),
        createdAt: new Date(),
      });
    const result = await f.call("POST", "/admin/index", "owner", {});
    if (result.status !== 200) throw Error("LOCAL_INDEX_START_FAILED");
    await f.api.service.waitForRebuild();
    console.log(
      "LOCAL legacy public-post UI at 127.0.0.1:4203; no Gemini or Production calls",
    );
  })
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
