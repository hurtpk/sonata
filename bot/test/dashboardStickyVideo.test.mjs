/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { dashboardRequest, guildEvent } from "../dashboard.mjs";
import { parsePrefix, parseSlash, slashCommands } from "../commands.mjs";
import { stickyEvent } from "../sticky.mjs";
import { videoCommand, videoSource } from "../videoEmbeds.mjs";
import { commandContext, executeCommand } from "../moderation.mjs";
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
    await assert.rejects(videoCommand(context,{online:()=>false}),/video service is offline/);
    await assert.rejects(videoCommand(context,{online:()=>true,submit:async()=>({description:"TikTok is unavailable."})}),/TikTok is unavailable/);
    const execute=async()=>({stdout:JSON.stringify({url:"https://video.twimg.com/test.mp4",ext:"mp4",duration:10,title:"Test"})});
    await assert.rejects(downloadVideo("https://x.com/name/status/123",async()=>new Response(null,{status:302,headers:{location:"https://127.0.0.1/file"}}),execute),/supported video stream/);
    await assert.rejects(downloadVideo("https://x.com/name/status/123",async()=>new Response("x",{headers:{"content-length":"9000000"}}),execute),/download limit/);
});

test("TikTok metadata resolves to an actual bounded MP4 attachment with caption and sender credit",async t=>{
    const source="https://www.tiktok.com/@cantbreakmeoff/video/7689630196105874718",offload="https://offload.tnktok.com/generate/video/7689630196105874718.mp4",cdn="https://v16m-default.tiktokcdn-us.com/test.mp4",bytes=Buffer.from("0000ftyp0000test");
    const html=`<meta property="og:video" content="${offload}"><meta content="K &amp; friends" property="og:title"><meta property="og:description" content="#mood">`;
    const calls=[],transport=async url=>{calls.push(url);if(url.includes("www.tnktok.com"))return new Response(html);if(url.includes("/api/v1/statuses/"))return Response.json({id:"7689630196105874718",content:"<b>❤️ 17.8K 💬 159 🔁 3K</b>",created_at:"2026-09-26T00:12:46.000Z"});if(url===offload)return new Response(null,{status:302,headers:{location:cdn}});assert.equal(url,cdn);return new Response(bytes);};
    const execute=async(program,args)=>{assert.equal(program,"ffprobe");assert(args.includes("-show_entries"));return{stdout:JSON.stringify({format:{duration:"10.007"},streams:[{codec_type:"video",codec_name:"h264"},{codec_type:"audio",codec_name:"aac"}]})};};
    const result=await downloadVideo(source,transport,execute);assert.deepEqual(Buffer.from(result.video,"base64"),bytes);assert.equal(result.title,"K & friends");assert.equal(result.description,"#mood");assert.equal(calls.length,4);assert.deepEqual(result.stats,{likes:"17.8K",comments:"159",shares:"3K"});
    const f=fixture(t),context=await commandContext(f.command(`,sonata ${source}`),BOT,f.api),reply=await videoCommand(context,{online:()=>true,submit:async()=>result});assert.deepEqual(reply.files[0].bytes,bytes);assert.match(reply.embeds[0].description,/#mood/);assert.match(reply.embeds[0].footer.text,/TikTok • ❤️ 17.8K • 💬 159 • 🔁 3K • Sent by/);assert.equal(reply.embeds[0].timestamp,"2026-09-26T00:12:46.000Z");assert.equal(reply.embeds[0].footer.icon_url,"https://www.tiktok.com/favicon.ico");assert.equal(reply.content,undefined);
    await assert.rejects(downloadVideo(source,async()=>new Response(html.replace(offload,"https://127.0.0.1/a.mp4")),execute),/downloadable video/);
    await assert.rejects(downloadVideo(source,async url=>url.includes("www.tnktok.com")?new Response(html):new Response(null,{status:302,headers:{location:"https://127.0.0.1/a.mp4"}}),execute),/supported video stream/);
    await assert.rejects(downloadVideo(source,async url=>url.includes("www.tnktok.com")?new Response(html):new Response("not a video"),execute),/playable MP4/);
    await assert.rejects(downloadVideo(source,transport,async()=>({stdout:JSON.stringify({format:{duration:"181"},streams:[{codec_type:"video",codec_name:"h264"}]})})),/three minutes/);
});

test("Video typing renews only while retrieval is running and stops after success or failure",async t=>{
    const f=fixture(t),context=await commandContext(f.command(",sonata https://youtu.be/sMK6XgyLJGg"),BOT,f.api);t.mock.timers.enable({apis:["setInterval"]});
    let resolve;const pending=videoCommand(context,{online:()=>true,submit:()=>new Promise(done=>{resolve=done;})});
    const typing=()=>f.calls.filter(call=>call.route===`/channels/${CHANNEL}/typing`&&call.method==="POST").length;
    assert.equal(typing(),1);t.mock.timers.tick(8000);assert.equal(typing(),2);resolve({video:Buffer.from("testvideo").toString("base64")});await pending;t.mock.timers.tick(80000);assert.equal(typing(),2);
    await assert.rejects(videoCommand(context,{online:()=>true,submit:async()=>{throw Error("Download failed");}}),/Download failed/);const count=typing();t.mock.timers.tick(80000);assert.equal(typing(),count);
});

test("Automatic videos support multiple channels, all future channels, exclusions and replacing dashboard selections",async t=>{
    const f=fixture(t),second="888888888888888889"; f.channels.push({id:second,guild_id:GUILD,name:"clips",type:0,permission_overwrites:[]});
    await f.execute(`,settings videoembeds true <#${CHANNEL}> <#${second}>`); assert.deepEqual(f.store.settings(GUILD).videoEmbeds,{[CHANNEL]:true,[second]:true});
    await f.execute(",settings videoembeds true all"); assert.equal(f.store.settings(GUILD).videoEmbedsAll,true); assert.deepEqual(f.store.settings(GUILD).videoEmbeds,{});
    await f.execute(`,settings videoembeds false ${second}`); assert.equal(f.store.settings(GUILD).videoEmbedsAll,true); assert.equal(f.store.settings(GUILD).videoEmbeds[second],false);
    const before=f.store.settings(GUILD);await assert.rejects(f.execute(",settings videoembeds true 123456789012345678"),/text channels/);assert.deepEqual(f.store.settings(GUILD),before);
    const parsed=parseSlash({name:"settings",options:[{name:"videoembeds",options:[{name:"enabled",value:true},{name:"all",value:false},{name:"channels",value:second}]}]});
    await executeCommand({...f.command(",settings videoembeds true all"),...parsed},f.store,f.api,BOT);assert.equal(f.store.settings(GUILD).videoEmbedsAll,false);assert.deepEqual(f.store.settings(GUILD).videoEmbeds,{[second]:true});
    await f.execute(",settings videoembeds false all");assert.equal(f.store.settings(GUILD).videoEmbedsAll,false);assert.deepEqual(f.store.settings(GUILD).videoEmbeds,{});
    await assert.rejects(executeCommand({...f.command(",settings videoembeds true all"),actor:TARGET},f.store,f.api,BOT),/permissions/);
});
