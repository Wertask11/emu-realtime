"use strict";
const { test }=require("node:test"),assert=require("node:assert/strict");
const {configuration,accept}=require("./live-acceptance");
const testARN="arn:aws:kms:ap-northeast-1:123456789012:key/11111111-1111-1111-1111-111111111111";
const env={POLYGON_KMS_TEST_APPROVAL_REF:"isolated-fixture",POLYGON_KMS_ISOLATED_TEST_KEY:"true",POLYGON_KMS_TEST_KEY_ARN:testARN,POLYGON_KMS_KEY_ARN:testARN.replace(/11111111/g,"22222222"),POLYGON_KMS_TEST_ADDRESS:"0x"+"1".repeat(40)};
test("live acceptance refuses absent approval or production key before contacting KMS",async()=>{
 let calls=0;const client={send:async()=>{calls++;throw Error("must not call");}};
 await assert.rejects(accept({env:{},client}),/APPROVED_ISOLATED_TEST_KEY_REQUIRED/);
 await assert.rejects(accept({env:{...env,POLYGON_KMS_KEY_ARN:testARN},client}),/APPROVED_ISOLATED_TEST_KEY_REQUIRED/);
 await assert.rejects(accept({env,client,approveSign:true}),/TEST_SIGNATURE_APPROVAL_REQUIRED/);
 assert.equal(calls,0);
});
test("live test identity must differ from operator and signing needs separate approval",()=>{
 assert.throws(()=>configuration({...env,ECONOMY_POLYGON_OPERATOR_ADDRESS:env.POLYGON_KMS_TEST_ADDRESS},false),/APPROVED_ISOLATED/);
 assert.equal(configuration(env,false).keyId,testARN);
 assert.equal(configuration({...env,POLYGON_KMS_TEST_SIGN_APPROVED:"true"},true).address,env.POLYGON_KMS_TEST_ADDRESS);
});
