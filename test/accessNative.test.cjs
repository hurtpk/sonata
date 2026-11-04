/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const compiled = ts.transpileModule(readFileSync(path.join(__dirname,"../sonata/access/native.ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const USER="222222222222222222",OTHER="333333333333333333",token="a".repeat(64),profile={username:"member",name:"Member",avatar:""};
function fixture(origin="https://sonata.example"){
    const files=new Map(),calls=[],opened=[];let response={status:"allowed",userId:USER,token,admin:false},network=false;
    const imports={electron:{app:{getPath:()=>"/sonata-test"},safeStorage:{isEncryptionAvailable:()=>true,encryptString:Buffer.from,decryptString:buffer=>buffer.toString()},shell:{openExternal:async url=>opened.push(url)}},fs:{existsSync:file=>files.has(file),readFileSync:file=>files.get(file),writeFileSync:(file,bytes)=>files.set(file,bytes),renameSync:(from,to)=>{files.set(to,files.get(from));files.delete(from)}},path,"./config":{ACCESS_ENABLED:true,ACCESS_SERVICE_URL:origin}};
    const module={exports:{}};vm.runInNewContext(compiled,{exports:module.exports,require:name=>{assert(name in imports,name);return imports[name]},process:{platform:"win32"},Buffer,AbortSignal,TextDecoder,Date,URL,fetch:async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});if(network)throw Error("Offline");return Response.json(response)}});
    return{native:module.exports,calls,opened,files,setResponse:value=>{response=value},offline:()=>{network=true}};
}

test("Activate stays in the plugin, binds the current account and saves an encrypted credential",async()=>{
    const f=fixture(),result=await f.native.accessBegin({},USER,"2026.10.29b",profile);assert.equal(result.status,"allowed");assert.equal(result.admin,false);assert.equal(f.opened.length,0);assert.equal(f.calls[0].url,"https://sonata.example/api/activation/direct");assert.equal(f.calls[0].body.userId,USER);assert(f.files.has(path.join("/sonata-test","sonata-access.enc")));
    const checked=await f.native.accessCheck({},USER,"2026.10.29b");assert.equal(checked.status,"allowed");assert.equal(f.calls[1].options.headers.Authorization,`Bearer ${token}`);
    assert.equal((await f.native.accessCheck({},OTHER,"2026.10.29b")).status,"activation");
});

test("In-app activation rejects malformed profiles, mismatched identities and blocked accounts",async()=>{
    const f=fixture();assert.equal((await f.native.accessBegin({},USER,"2026.10.29b",{...profile,avatar:"https://example.org/avatar"})).status,"activation");assert.equal(f.calls.length,0);
    f.setResponse({status:"allowed",userId:OTHER,token});assert.equal((await f.native.accessBegin({},USER,"2026.10.29b",profile)).status,"unavailable");assert.equal(f.files.size,0);
    f.setResponse({status:"blocked",userId:USER});assert.equal((await f.native.accessBegin({},USER,"2026.10.29b",profile)).status,"blocked");assert.equal(f.opened.length,0);
});

test("Blocked grants cannot use the outage grace period and disconnect clears the device",async()=>{
    const f=fixture();await f.native.accessBegin({},USER,"2026.10.29b",profile);f.setResponse({status:"blocked",userId:USER});assert.equal((await f.native.accessCheck({},USER,"2026.10.29b")).status,"blocked");f.offline();assert.equal((await f.native.accessCheck({},USER,"2026.10.29b")).status,"blocked");assert.equal((await f.native.accessDisconnect({},USER)).status,"activation");assert.equal((await f.native.accessCheck({},USER,"2026.10.29b")).status,"activation");
});


test("The custom domain reuses the encrypted credential from the previous Sonata service", async () => {
    const f=fixture("https://sonatabot.info");
    f.files.set(path.join("/sonata-test","sonata-access.enc"),Buffer.from(JSON.stringify({["https://sonata.hurts.workers.dev:"+USER]:{userId:USER,token,until:Date.now()+60000,admin:false,blocked:false}})));
    assert.equal((await f.native.accessCheck({},USER,"2026.10.29b")).status,"allowed");
    assert.equal(f.calls[0].url,"https://sonatabot.info/api/check-in");
    assert.equal(f.calls[0].options.headers.Authorization,"Bearer "+token);
    assert.equal((await f.native.accessCheck({},OTHER,"2026.10.29b")).status,"activation");
});
