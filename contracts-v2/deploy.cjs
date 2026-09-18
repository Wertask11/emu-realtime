#!/usr/bin/env node
'use strict';
// Optional local deployment path. Never paste a private key into chat or source control.
const fs=require('node:fs'),path=require('node:path');const {ethers}=require('ethers');
const EXPECTED_CHAIN_ID=137n,EXPECTED_TREASURY='0x1C156b6a8CaA6772430edA2cBB0d20CF41B9CFE4',ADMIN_DELAY=86400;
(async()=>{
 const rpc=process.env.POLYGON_RPC_URL,privateKey=process.env.EMUER_V2_DEPLOYER_PRIVATE_KEY;
 if(!rpc||!privateKey)throw new Error('POLYGON_RPC_URL and EMUER_V2_DEPLOYER_PRIVATE_KEY are required');
 const provider=new ethers.JsonRpcProvider(rpc);if((await provider.getNetwork()).chainId!==EXPECTED_CHAIN_ID)throw new Error('Refusing deployment outside Polygon mainnet chain 137');
 const wallet=new ethers.Wallet(privateKey,provider);if(wallet.address.toLowerCase()!==EXPECTED_TREASURY.toLowerCase())throw new Error('Deployer must be the approved admin/treasury wallet');
 const a=JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts/EMUERv2.json'),'utf8'));
 const contract=await new ethers.ContractFactory(a.abi,a.evm.bytecode.object,wallet).deploy(EXPECTED_TREASURY,ADMIN_DELAY);
 console.log('submitted',contract.deploymentTransaction().hash);await contract.waitForDeployment();
 const address=await contract.getAddress();
 if(await contract.treasury()!==ethers.getAddress(EXPECTED_TREASURY)||await contract.totalSupply()!==ethers.parseEther('10000000'))throw new Error('Post-deployment invariant failed');
 console.log(JSON.stringify({chainId:'137',address,treasury:await contract.treasury(),totalSupply:(await contract.totalSupply()).toString(),txHash:contract.deploymentTransaction().hash},null,2));
})().catch(e=>{console.error(e.message||e);process.exit(1)});
