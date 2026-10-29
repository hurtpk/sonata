/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { dashboardRequest, guildEvent } from "../dashboard.mjs";
import { parsePrefix, slashCommands } from "../commands.mjs";
import { stickyEvent } from "../sticky.mjs";
import { videoCommand, videoSource } from "../videoEmbeds.mjs";
import { commandContext } from "../moderation.mjs";
import { PERMS } from "../discord.mjs";
import { videoCdn, downloadVideo } from "../music/video.mjs";
import { ACTOR, BOT, CHANNEL, GUILD, OWNER, TARGET, MODROLE, fixture } from "./fixture.mjs";

function dashboard(f) { guildEvent("GUILD_CREATE",f.guild,f.store); return (path,actor=OWNER,input,headers={})=>dashboardRequest(new Request(`https://bot.internal/dashboard/${path}`,{method:input?"POST":"GET",headers:{"X-Sonata-User":actor,...headers},body:input?JSON.stringify(input):undefined}),{store:f.store,api:f.api,env:{DASHBOARD_OWNER_IDS:OWNER},session:{userId:BOT},status:()=>({connected:true})},()=>{throw Error("Not expected");}); }
test("Only server owners manage the dashboard whitelist; disabled administrator access is enforced on every route",async t=>{
    const f=fixture(t),request=dashboard(f);f.roles.find(r=>r.id===MODROLE).permissions=PERMS.ADMIN.toString();
    await request(`server?guild=${GUILD}`,ACTOR);
    await assert.rejects(request("access",ACTOR,{guild:GUILD,administrators:false,users:[ACTOR]}),/Only the Discord server owner/);
    await request("access",OWNER,{guild:GUILD,administrators:false,users:[TARGET]});
    await assert.rejects(request(`server?guild=${GUILD}`,ACTOR),/server owner/);
    assert.equal((await request(`server?guild=${GUILD}`,TARGET)).manageable,true);
    assert.equal((await request(`server?guild=${GUILD}`,OWNER)).serverOwner,true);
    f.members.delete(TARGET);await assert.rejects(request(`server?guild=${GUILD}`,TARGET),/server owner/);
});
test("Message designer previews without posting, saves automatic messages and uses genuine panel controls",async t=>{
    const f=fixture(t),request=dashboard(f),input={guild:GUILD,kind:"welcome",title:"Hi",text:"Welcome {user} to {server}",color:"#bd898e",channel:CHANNEL};
    const before=f.postedMessages.length,preview=await request("designer",OWNER,{...input,preview:true});assert.match(preview.message.embeds[0].description,new RegExp(OWNER));assert.equal(f.postedMessages.length,before);
    await request("designer",OWNER,{...input,save:true});assert.equal(f.store.settings(GUILD).designedMessages.welcome[CHANNEL].title,"Hi");
    const panel=await request("designer",OWNER,{...input,kind:"verification",preview:true});assert.equal(panel.message.components[0].components[0].custom_id,`snverify:${GUILD}`);
    await assert.rejects(request("designer",OWNER,{...input,kind:"ticket"}),/Set up tickets/);
    await assert.rejects(request("designer",OWNER,{...input,color:"javascript:bad"}),/Choose a message/);
});
test("Delegated Sonata administrators are restricted to signed service scopes",async t=>{
    const f=fixture(t),request=dashboard(f),headers={"X-Sonata-Permissions":"health"};
    assert.equal((await request("owner/health",ACTOR,undefined,headers)).status.connected,true);
    await assert.rejects(request("owner",ACTOR,undefined,headers),/Only the bot owner/);
    await assert.rejects(request("owner/action",ACTOR,{guild:GUILD,action:"leave"},headers),/Only the bot owner/);
});
test("Sticky aliases repost below messages without loops, survive storage and stop by link",async t=>{
    const f=fixture(t);assert.equal(parsePrefix(",unstickmessage",",").sub,"remove");assert(slashCommands().length<=100);
    await f.execute(",stickmessage Keep the rules in mind.");let row=f.store.get("SELECT * FROM sticky_messages WHERE channel=?",CHANNEL);const original=row.message;
    await stickyEvent({id:"990000000000000000",guild_id:GUILD,channel_id:CHANNEL,author:{id:TARGET},content:"hello"},f.store,f.api);
    row=f.store.get("SELECT * FROM sticky_messages WHERE channel=?",CHANNEL);assert.notEqual(row.message,original);assert(f.calls.some(c=>c.method==="DELETE"&&c.route.endsWith(original)));
    const count=f.postedMessages.length;await stickyEvent({id:"990000000000000001",guild_id:GUILD,channel_id:CHANNEL,author:{id:BOT,bot:true}},f.store,f.api);assert.equal(f.postedMessages.length,count);
    await assert.rejects(f.execute(",unstick https://discord.com/channels/111111111111111111/888888888888888888/123456789012345678"),/current sticky/);
    await f.execute(`,unstick https://discord.com/channels/${GUILD}/${CHANNEL}/${row.message}`);assert.equal(f.store.get("SELECT * FROM sticky_messages WHERE channel=?",CHANNEL),undefined);
});
test("Sticky commands require moderation permission and never copy from another channel",async t=>{
    const f=fixture(t);await assert.rejects(import("../moderation.mjs").then(m=>m.executeCommand(f.command(",stick text",TARGET),f.store,f.api,BOT)),/permissions/);
    await assert.rejects(f.execute(`,stick https://discord.com/channels/${GUILD}/123456789012345678/123456789012345679`),/this channel/);
});
test("Video URLs and CDN redirects are bounded and video replies credit the sender without pinging",async t=>{
    const f=fixture(t);assert.equal(videoSource("https://www.tiktok.com/@hello/video/123456789?track=x"),"https://www.tiktok.com/@hello/video/123456789");
    for(const url of ["http://x.com/a/status/123","https://youtube.com.evil.test/watch?v=sMK6XgyLJGg","https://127.0.0.1/test","https://www.youtube.com/playlist?list=1"])assert.throws(()=>videoSource(url));
    assert.throws(()=>videoCdn("https://video.twimg.com.evil.test/a.mp4"));assert.throws(()=>videoCdn("http://video.twimg.com/a.mp4"));
    const context=await commandContext(f.command(",sonata https://youtu.be/sMK6XgyLJGg"),BOT,f.api);
    const result=await videoCommand(context,{online:()=>true,submit:async()=>({title:"Clip",video:Buffer.from("testvideo").toString("base64")})});assert.match(result.embeds[0].footer.text,/Sent by/);assert.deepEqual(result.allowed_mentions.parse,[]);assert.equal(result.files[0].type,"video/mp4");
    const fallback=await videoCommand({...context,command:{...context.command,options:{url:"https://x.com/name/status/123"}}},{online:()=>false});assert.equal(fallback.content,"https://fxtwitter.com/name/status/123");assert.match(fallback.embeds[0].footer.text,/Sent by/);
    const execute=async()=>({stdout:JSON.stringify({url:"https://video.twimg.com/test.mp4",ext:"mp4",duration:10,title:"Test"})});
    await assert.rejects(downloadVideo("https://x.com/name/status/123",async()=>new Response(null,{status:302,headers:{location:"https://127.0.0.1/file"}}),execute),/supported video stream/);
    await assert.rejects(downloadVideo("https://x.com/name/status/123",async()=>new Response("x",{headers:{"content-length":"9000000"}}),execute),/8 MB/);
});
