import { build } from 'esbuild';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const out = fileURLToPath(new URL('../../frontend/public/schoolpark/vendor/', import.meta.url));
await mkdir(out, { recursive:true });
await build({ entryPoints:[here + 'three-entry.mjs'], outfile:out + 'city-three.min.js',
  bundle:true, minify:true, format:'esm', target:'es2022', legalComments:'inline',
  banner:{js:'/* Three.js 0.186.1, MIT. Rebuild: npm ci && npm run build in tools/city-build. */'} });
await copyFile(here + 'node_modules/three/LICENSE', out + 'THREE-LICENSE.txt');
// The public walkthrough is deliberately read-only. It must never publish a
// live merchant destination or fabricate a Passport/payment state.
const require = createRequire(import.meta.url);
const { DEFAULT_CATALOG, publicCatalog } = require('../../backend/city-shops.js');
const demo = structuredClone(DEFAULT_CATALOG);
for(const shop of demo.shops){shop.status='demo';shop.merchant=null;shop.checkoutHosts=[];for(const p of shop.products)p.checkout=null;}
await writeFile(out + '../city-showroom-catalog.json', JSON.stringify(publicCatalog(demo),null,2)+'\n');
