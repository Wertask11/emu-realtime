const esbuild = require("../../backend/node_modules/esbuild");
esbuild.buildSync({
  entryPoints: [require("path").join(__dirname, "wallet-entry.mjs")],
  bundle: true,
  alias: {
    "base64url-universal": require("path").join(
      __dirname,
      "../../backend/node_modules/base64url-universal/lib/browser.js",
    ),
  },
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  minify: true,
  legalComments: "linked",
  outfile: require("path").join(
    __dirname,
    "../../frontend/public/passport-v2/wallet.js",
  ),
});
