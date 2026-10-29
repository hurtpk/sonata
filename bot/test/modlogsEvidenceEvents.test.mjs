/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parsePrefix, parseSlash } from "../commands.mjs";
import { executeCommand } from "../moderation.mjs";
import { modlogInteraction } from "../modlogs.mjs";
import { eventLog, rememberLogEvent } from "../eventLogs.mjs";
import { PERMS } from "../discord.mjs";
import { ACTOR, BOT, CHANNEL, GUILD, MODROLE, OWNER, TARGET, fixture } from "./fixture.mjs";

const PNG=new Uint8Array([137,80,78,71,13,10,26,10,0]);
const video=new Uint8Array([0,0,0,24,102,116,121,112,109,112,52,50]);
const file={id:"999999999999999991",url:`https://cdn.discordapp.com/attachments/${CHANNEL}/999999999999999991/evidence.png`,filename:"evidence.png",size:PNG.length,content_type:"image/png"};
function seed(f,number=12){for(let i=0;i<number;i++){const command={id:`case-${i}`,guild:GUILD,actor:i%2?ACTOR:OWNER},n=f.store.begin(command,i%3?"warn":"kick",TARGET,`Reason ${i}`);f.store.status(GUILD,n,i===0?"needs_review":"completed");}}
function click(response,custom_id,values,actor=ACTOR){return {id:"888888888888888887",guild_id:GUILD,channel_id:CHANNEL,member:{user:{id:actor}},message:{...response,author:{id:BOT}},data:{custom_id,component_type:values?3:2,...(values?{values}:{})}};}
test("Modlogs requires exactly a victim ID; case and modstats shorthands preserve multiword reasons and evidence",()=>{
    assert.throws(()=>parsePrefix(",modlogs",","),/victim/);assert.throws(()=>parsePrefix(`,modlogs ${TARGET} extra`,","),/victim/);
    assert.equal(parsePrefix(`,modlogs ${TARGET}`,",").options.member,TARGET);assert.equal(parsePrefix(",case 12",",").options.case,12);assert.equal(parsePrefix(`,modstats ${ACTOR}`,",").sub,"staff");
    const command=parsePrefix(`,ban ${TARGET} Repeated abuse in chat`,",",[file]);assert.equal(command.options.reason,"Repeated abuse in chat");assert.equal(command.options.file.url,file.url);
    assert.equal(parseSlash({name:"warn",options:[{name:"member",value:TARGET},{name:"file",type:11,value:file.id}]},{[file.id]:file}).options.file.filename,"evidence.png");
});
test("Modlogs pages are owner-bound, retain the victim, filter actions and recheck current permissions",async t=>{
    const f=fixture(t);seed(f);let response=await f.execute(`,modlogs ${TARGET}`);assert.equal(response.embeds[0].fields.length,5);assert.match(response.embeds[0].description,new RegExp(TARGET));assert.match(response.embeds[0].footer.text,/Page 1 of 3/);
    const next=response.components[2].components[2].custom_id;response=await modlogInteraction(click(response,next),f.store,f.api,BOT);assert.match(response.embeds[0].footer.text,/Page 2 of 3/);
    const action=response.components[0].components[0].custom_id;response=await modlogInteraction(click(response,action,["kick"]),f.store,f.api,BOT);assert.equal(response.embeds[0].fields.length,4);assert(response.embeds[0].fields.every(field=>field.name.includes("Kick")));
    await assert.rejects(modlogInteraction(click(response,response.components[2].components[1].custom_id,undefined,OWNER),f.store,f.api,BOT),/belongs to someone else/);
    const grant=f.roles.find(role=>role.id===MODROLE);grant.permissions="0";await assert.rejects(modlogInteraction(click(response,response.components[2].components[1].custom_id),f.store,f.api,BOT),/permissions/);
});
test("Staff statistics count only completed Sonata actions and include paged case numbers and action types",async t=>{
    const f=fixture(t);seed(f);f.store.status(GUILD,2,"cleared");f.store.status(GUILD,4,"expired");const response=await f.execute(`,modstats ${ACTOR}`);assert.match(response.embeds[0].description,/6 completed actions/);assert.match(response.embeds[0].fields[0].name,/#12 · Warn/);assert(response.embeds[0].fields.every(field=>field.value.includes(ACTOR)));
    f.store.run("INSERT INTO security_events VALUES (?,?,?,?,?)","external-event",GUILD,ACTOR,"ban",Date.now());const again=await f.execute(`,modstats ${ACTOR}`);assert.match(again.embeds[0].description,/6 completed actions/);
});
test("Warn, kick and ban archive attachments and case views refresh and include image/video bytes and reasons",async t=>{
    const f=fixture(t);f.store.saveSettings(GUILD,{...f.store.settings(GUILD),logChannel:CHANNEL});
    t.mock.method(globalThis,"fetch",async raw=>new Response(String(raw).endsWith(".mp4")?video:PNG));
    const saved=new Map(),api=async(route,options={})=>{if(saved.has(route)&&!options.method)return saved.get(route);const value=await f.api(route,options);if(options.form){const payload=JSON.parse(options.form.get("payload_json")),item=options.form.get("files[0]"),attachment={...file,id:value.id,url:`https://cdn.discordapp.com/attachments/${CHANNEL}/${value.id}/${item.name}`,filename:item.name,size:item.size,content_type:item.type};saved.set(`/channels/${CHANNEL}/messages/${value.id}`,{...value,attachments:[attachment]});assert(payload.embeds[0].description.includes(ACTOR));}return value;};
    for(const name of ["warn","kick","ban"]){const media=name==="kick"?{...file,filename:"evidence.mp4",url:file.url.replace(".png",".mp4"),content_type:"video/mp4",size:video.length}:file;
        const command={...f.command(`,${name} ${TARGET} Repeated harassment`),evidence:[media]};const result=await executeCommand(command,f.store,api,BOT);assert.match(result.embeds[0].description,/Repeated harassment/);
        const row=f.store.get("SELECT * FROM cases WHERE request=?",command.id);assert.equal(f.store.get("SELECT COUNT(*) AS n FROM case_files WHERE n=?",row.n).n,1);
        const detail=await executeCommand(f.command(`,case ${row.n}`),f.store,api,BOT);assert.match(detail.embeds[0].description,/Repeated harassment/);assert.match(detail.embeds[0].description,new RegExp(ACTOR));assert.equal(detail.files.length,1);assert.equal(detail.files[0].type,media.content_type);
    }
});
test("Evidence validation fails before moderation and evidence channel permissions are rechecked on case view",async t=>{
    const f=fixture(t);await assert.rejects(executeCommand({...f.command(`,ban ${TARGET} reason`),evidence:[file]},f.store,f.api,BOT),/log channel/);assert.equal(f.bans.size,0);
    f.store.saveSettings(GUILD,{...f.store.settings(GUILD),logChannel:CHANNEL});await assert.rejects(executeCommand({...f.command(`,ban ${TARGET} reason`),evidence:[{...file,url:"https://example.com/file.png"}]},f.store,f.api,BOT),/uploaded to Discord/);assert.equal(f.bans.size,0);
});
test("Event logging is opt-in, bounds cached content and distinguishes authors from unconfirmed deletion actors",async t=>{
    const f=fixture(t),cache={messages:new Map(),channels:new Map()},data={id:"999999999999999990",guild_id:GUILD,channel_id:CHANNEL,author:{id:TARGET},content:"Deleted text"};rememberLogEvent("MESSAGE_CREATE",data,{},cache);assert.equal(cache.messages.size,0);
    const destination="888888888888888889",settings={...f.store.settings(GUILD),eventlogs:{messages:destination,channels:destination,joins:destination}};f.store.saveSettings(GUILD,settings);
    const calls=[],api=async(route,options)=>{calls.push({route,...options});return {id:TARGET};};rememberLogEvent("MESSAGE_CREATE",data,settings,cache);await eventLog("MESSAGE_DELETE",{id:data.id,guild_id:GUILD,channel_id:CHANNEL},f.store,api,cache);
    assert.match(calls[0].body.embeds[0].description,/Deleted text/);assert.match(calls[0].body.embeds[0].description,/does not identify the actor/);assert.equal(cache.messages.size,0);assert.deepEqual(calls[0].body.allowed_mentions.parse,[]);
    const audit=String((BigInt(Date.now()-1420070400000)<<22n)+1n);rememberLogEvent("CHANNEL_DELETE",{id:CHANNEL,guild_id:GUILD,name:"staff-chat",type:2},settings,cache);
    await eventLog("GUILD_AUDIT_LOG_ENTRY_CREATE",{id:audit,guild_id:GUILD,action_type:12,target_id:CHANNEL,user_id:ACTOR},f.store,api,cache);assert.match(calls.at(-1).body.embeds[0].description,/staff-chat/);assert.match(calls.at(-1).body.embeds[0].description,/Voice/);assert.match(calls.at(-1).body.embeds[0].description,new RegExp(ACTOR));
    await eventLog("GUILD_MEMBER_REMOVE",{guild_id:GUILD,user:{id:TARGET,username:"Member"},eventId:"leave-1"},f.store,api,cache);assert.match(calls.at(-1).body.embeds[0].description,/voluntary leave, kick or ban/);
});


test("Deletion caching is capped, expires in memory and excludes bot content", () => {
    const cache={messages:new Map(),channels:new Map()},settings={eventlogs:{messages:"888888888888888889"}},now=Date.now();
    for(let i=0;i<1005;i++)rememberLogEvent("MESSAGE_CREATE",{id:String(900000000000000000n+BigInt(i)),guild_id:GUILD,channel_id:CHANNEL,author:{id:TARGET},content:"x".repeat(2000)},settings,cache,now);
    assert.equal(cache.messages.size,1000);assert.equal([...cache.messages.values()][0].content.length,1400);
    rememberLogEvent("MESSAGE_CREATE",{id:ACTOR,guild_id:GUILD,channel_id:CHANNEL,author:{id:BOT,bot:true},content:"Bot secret"},settings,cache,now);assert.equal(cache.messages.get(ACTOR).content,"");
    rememberLogEvent("MESSAGE_UPDATE",{id:ACTOR,content:"Edited bot secret"},settings,cache,now);assert.equal(cache.messages.get(ACTOR).content,"");
    rememberLogEvent("MESSAGE_UPDATE",{id:TARGET,content:"irrelevant"},settings,cache,now+1800_001);assert.equal(cache.messages.size,0);
});
