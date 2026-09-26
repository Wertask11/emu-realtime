const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');
const {ethers} = require('ethers');
const ganache = require('ganache');

const source = fs.readFileSync(path.join(__dirname, '../src/SchoolParkQuestStar.sol'), 'utf8');
const input = {language:'Solidity', sources:{'SchoolParkQuestStar.sol':{content:source}},
  settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',
    outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
const compiled = JSON.parse(solc.compile(JSON.stringify(input), {import:p => {
  try { return {contents:fs.readFileSync(require.resolve(p), 'utf8')}; }
  catch (e) { return {error:e.message}; }
}}));
assert.deepEqual((compiled.errors || []).filter(e => e.severity === 'error'), []);
const artifact = compiled.contracts['SchoolParkQuestStar.sol'].SchoolParkQuestStar;

(async () => {
  const node = ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'}});
  const provider = new ethers.BrowserProvider(node);
  const admin = await provider.getSigner(0), owner = await provider.getSigner(1), other = await provider.getSigner(2);
  const nft = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, admin).deploy(await admin.getAddress());
  await nft.waitForDeployment();
  const key = ethers.id('schoolpark:general-001:passport-a');
  const uri = 'https://example.org/certificates/' + key;
  await (await nft.mint(await owner.getAddress(), key, uri)).wait();
  const id = await nft.tokenForCompletion(key);
  assert.equal(id, 1n);
  assert.equal(await nft.ownerOf(id), await owner.getAddress());
  assert.equal(await nft.tokenURI(id), uri);
  await assert.rejects(nft.mint(await other.getAddress(), key, uri));
  await assert.rejects(nft.connect(owner).transferFrom(await owner.getAddress(), await other.getAddress(), id));
  await assert.rejects(nft.connect(owner).approve(await other.getAddress(), id));
  await assert.rejects(nft.connect(other).mint(await other.getAddress(), ethers.id('another'), uri));
  console.log('PASS unique, minter-only, nontransferable quest star');
  await node.disconnect();
})().catch(e => { console.error(e); process.exitCode = 1; });
