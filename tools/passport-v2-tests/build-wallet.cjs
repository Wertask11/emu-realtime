const esbuild = require("../../backend/node_modules/esbuild");
esbuild.buildSync({
  entryPoints: [require("path").join(__dirname, "wallet-entry.mjs")],
  bundle: true,
  external: ["./zkp-wallet.js"],
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

const experimentalDir = process.env.PASSPORT_ZKP_BUILD_DIR;
if (
  experimentalDir &&
  !require("path").resolve(experimentalDir).startsWith("/tmp/")
)
  throw Error("EXPERIMENTAL_BUILD_REQUIRES_TMP_DIRECTORY");
if (experimentalDir)
  esbuild.buildSync({
    entryPoints: [require("path").join(__dirname, "zkp-wallet-entry.mjs")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    minify: true,
    inject: [require("path").join(__dirname, "browser-shim.mjs")],
    legalComments: "linked",
    outfile: require("path").join(experimentalDir, "zkp-wallet.js"),
  });
