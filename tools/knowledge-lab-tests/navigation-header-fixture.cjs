"use strict";
// Actual local application + Firebase emulators, no AI calls/payment credentials.
// Preserve existing local records, genuine-call receipts and quota counters.
require("./native-fixture.cjs")
  .main({ port: 4206, reset: false, platformRegression: true })
  .then(() =>
    console.log("LOCAL navigation/header fixture ready; no Production data"),
  )
  .catch((e) => {
    console.error(e.code || e.message);
    process.exitCode = 1;
  });
