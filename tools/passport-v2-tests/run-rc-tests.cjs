const fs=require("node:fs"),path=require("node:path"),{spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,"../../backend"),profile=require("../../docs/passport-v2/rc-profile.json");
const files=[];
function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==="node_modules"||e.name===".git")continue;const p=path.join(dir,e.name);if(e.isDirectory())visit(p);else if(/\.test\.(js|mjs|cjs)$/.test(e.name))files.push(p);}}
visit(root);
const all=process.argv.includes("--all");
const selected=files.filter(p=>all||!profile.excludedExperimentalTestFiles.includes(path.relative(root,p).replaceAll(path.sep,"/")));
console.log(all?"Full backend including experimental ZKP: inspect TODO count.":"RC account-proof profile only. ZKP is excluded as a whole feature; run --all separately to preserve its known failure report.");
const result=spawnSync(process.execPath,["--test",...selected.sort()],{cwd:root,stdio:"inherit"});process.exitCode=result.status??1;
