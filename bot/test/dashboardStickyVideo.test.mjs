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
import { videoCommand, videoInvocation, videoSource } from "../videoEmbeds.mjs";
import { commandContext, executeCommand } from "../moderation.mjs";
import { PERMS } from "../discord.mjs";
import { videoCdn, downloadVideo, instagramMetadata, xMetadata } from "../music/video.mjs";
import { readFile } from "node:fs/promises";
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
    assert.equal(videoSource("https://www.tiktok.com/t/ZPLDWC4UG/?share=1"),"https://www.tiktok.com/t/ZPLDWC4UG/");
    for(const url of ["http://x.com/a/status/123","https://youtube.com.evil.test/watch?v=sMK6XgyLJGg","https://127.0.0.1/test","https://www.youtube.com/playlist?list=1"])assert.throws(()=>videoSource(url));
    assert.throws(()=>videoCdn("https://video.twimg.com.evil.test/a.mp4"));assert.throws(()=>videoCdn("http://video.twimg.com/a.mp4"));
    const context=await commandContext(f.command(",sonata https://youtu.be/sMK6XgyLJGg"),BOT,f.api);
    const result=await videoCommand(context,{online:()=>true,submit:async()=>({title:"Clip",video:Buffer.from("testvideo").toString("base64")})});assert.match(result.components[0].components.at(-1).content,/Sent by/);assert.deepEqual(result.allowed_mentions.parse,[]);assert.equal(result.files[0].type,"video/mp4");
    await assert.rejects(videoCommand(context,{online:()=>false}),/video service is offline/);
    await assert.rejects(videoCommand(context,{online:()=>true,submit:async()=>({description:"TikTok is unavailable."})}),/TikTok is unavailable/);
    const execute=async()=>({stdout:JSON.stringify({url:"https://video.twimg.com/test.mp4",ext:"mp4",duration:10,title:"Test"})});
    await assert.rejects(downloadVideo("https://x.com/name/status/123",async()=>new Response(null,{status:302,headers:{location:"https://127.0.0.1/file"}}),execute),/supported video stream/);
    await assert.rejects(downloadVideo("https://x.com/name/status/123",async()=>new Response("x",{headers:{"content-length":"20971521"}}),execute),/download limit/);
});

test("Automatic social embeds accept only a standalone link or an explicit Sonata invocation",()=>{
    const source='https://vt.tiktok.com/ZSpLhJS1S/';
    for(const content of [source,'  '+source+'  ','<'+source+'>','vt.tiktok.com/ZSpLhJS1S/'])assert.deepEqual(videoInvocation(content,BOT),{source,explicit:false});
    for(const content of ['sonata '+source,'sonta '+source,'SONATA vt.tiktok.com/ZSpLhJS1S/',`<@${BOT}> ${source}`,`<@!${BOT}> vt.tiktok.com/ZSpLhJS1S/`])assert.deepEqual(videoInvocation(content,BOT),{source,explicit:true});
    for(const content of ['watch this '+source,source+' watch this','sonata '+source+' cool',`<@${ACTOR}> ${source}`,source+' '+source,'sonata http://127.0.0.1/private','sonata https://tiktok.com.evil.test/@creator/video/123'])assert.equal(videoInvocation(content,BOT),null);
});

test("TikTok metadata resolves to an actual bounded MP4 attachment with caption and sender credit",async t=>{
    const source="https://www.tiktok.com/@cantbreakmeoff/video/7689630196105874718",offload="https://offload.tnktok.com/generate/video/7689630196105874718.mp4",cdn="https://v16m-default.tiktokcdn-us.com/test.mp4",bytes=Buffer.from("0000ftyp0000test");
    const html=`<meta property="og:video" content="${offload}"><meta content="K &amp; friends" property="og:title"><meta property="og:description" content="#mood">`;
    const calls=[],transport=async url=>{calls.push(url);if(url.includes("www.tnktok.com/@"))return new Response(html);if(url.includes("/api/v1/statuses/"))return Response.json({id:"7689630196105874718",content:"<b>❤️ 17.8K 💬 159 🔁 3K</b>",created_at:"2026-09-26T00:12:46.000Z"});if(url===offload)return new Response(null,{status:302,headers:{location:cdn}});assert.equal(url,cdn);return new Response(bytes);};
    const execute=async(program,args)=>{assert.equal(program,"ffprobe");assert(args.includes("-show_entries"));return{stdout:JSON.stringify({format:{duration:"10.007"},streams:[{codec_type:"video",codec_name:"h264"},{codec_type:"audio",codec_name:"aac"}]})};};
    const result=await downloadVideo(source,transport,execute);assert.deepEqual(Buffer.from(result.video,"base64"),bytes);assert.equal(result.title,"K & friends");assert.equal(result.description,"#mood");assert.equal(calls.length,4);assert.deepEqual(result.stats,{likes:"17.8K",comments:"159",shares:"3K"});
    const short="https://www.tiktok.com/t/ZPLDWC4UG/",redirect=async url=>url===short?new Response(null,{status:301,headers:{location:source+"?tracking="+"x".repeat(1000)}}):transport(url);
    assert.deepEqual(Buffer.from((await downloadVideo(short,redirect,execute)).video,"base64"),bytes);
    await assert.rejects(downloadVideo(short,async()=>new Response(null,{status:302,headers:{location:"https://127.0.0.1/video.mp4"}}),execute),/public video post/);
    const f=fixture(t),context=await commandContext(f.command(`,sonata ${source}`),BOT,f.api),reply=await videoCommand(context,{online:()=>true,submit:async()=>result});
    const card=reply.components[0].components;
    assert.deepEqual(reply.files[0].bytes,bytes);
    assert.match(card[0].components[0].content,/TikTok/);
    assert.match(card[1].content,/#mood/);
    assert.match(card.at(-1).content,/❤️ 17.8K • 💬 159 • 🔁 3K • Sent by/);
    assert.equal(reply.content,undefined);
    await assert.rejects(downloadVideo(source,async()=>new Response(html.replace(offload,"https://127.0.0.1/a.mp4")),execute),/downloadable video/);
    await assert.rejects(downloadVideo(source,async url=>url.includes("www.tnktok.com")?new Response(html):new Response(null,{status:302,headers:{location:"https://127.0.0.1/a.mp4"}}),execute),/supported video stream/);
    await assert.rejects(downloadVideo(source,async url=>url.includes("www.tnktok.com")?new Response(html):new Response("not a video"),execute),/playable MP4/);
    await assert.rejects(downloadVideo(source,transport,async()=>({stdout:JSON.stringify({format:{duration:"181"},streams:[{codec_type:"video",codec_name:"h264"}]})})),/three minutes/);
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


test("Instagram uploads use the public fallback and reject foreign offload redirects",async()=>{
    const source="https://www.instagram.com/reel/DdzATebgSPy/?mdxt=test",offload="https://vxinstagram.com/offload/DdzATebgSPy/0.mp4",cdn="https://instagram.test.fbcdn.net/video.mp4",bytes=Buffer.from("0000ftyp0000video");
    const html='<meta property="og:video" content="'+offload+'"><meta property="og:title" content="Instagram clip">';
    const execute=async program=>{assert.equal(program,"ffprobe");return{stdout:JSON.stringify({format:{duration:"15"},streams:[{codec_type:"video",codec_name:"h264"}]})}};
    const transport=async url=>url.includes('/reel/')?new Response(html):url===offload?new Response(null,{status:302,headers:{location:cdn}}):new Response(bytes);
    const value=await downloadVideo(source,transport,execute);assert.equal(value.title,"Instagram clip");assert.deepEqual(value.video,bytes);
    await assert.rejects(downloadVideo(source,async url=>url.includes('/reel/')?new Response(html):new Response(null,{status:302,headers:{location:"https://127.0.0.1/private"}}),execute),/supported video stream/);
});


test("Video downloads select the best MP4 within the size limit without a resolution cap",async()=>{
    const bytes=Buffer.from("0000ftyp0000video");
    const execute=async(program,args)=>{if(program==="yt-dlp"){const format=args[args.indexOf("--format")+1];assert(!format.includes("height"));assert(format.includes("filesize<=20M"));return{stdout:JSON.stringify({url:"https://video.twimg.com/test.mp4",duration:6,ext:"mp4"})}}return{stdout:JSON.stringify({format:{duration:"6"},streams:[{codec_type:"video",codec_name:"h264"}]})}};
    const value=await downloadVideo("https://x.com/TempoZP/status/21162834362222583182",async()=>new Response(bytes),execute);assert.deepEqual(value.video,bytes);
});


test("Instagram's second fallback decodes data without executing scripts and downloads a validated CDN file",async()=>{
    const source="https://www.instagram.com/reel/DfFzqrXyi9x/",cdn="https://instagram.test.fbcdn.net/original.mp4",bytes=Buffer.from("0000ftyp0000video");
    const token="header."+Buffer.from(JSON.stringify({url:cdn})).toString("base64url")+".signature";
    const text='https://d.rapidcdn.app/v2?token='+token,alphabet="0123456789a",base=10,offset=3;
    const encoded=[...text].map(c=>String(c.charCodeAt(0)+offset)+"a").join("");
    const raw='decodeURIComponent(escape(r))}("'+encoded+'",0,"'+alphabet+'",3,10,0))';
    const execute=async program=>{assert.equal(program,"ffprobe");return{stdout:JSON.stringify({format:{duration:"6"},streams:[{codec_type:"video",codec_name:"h264"}]})}};
    const transport=async(url,options)=>{if(url.includes('vxinstagram'))return new Response(null,{status:404});if(url.includes('snapsave.app')){assert.equal(options.method,"POST");assert.equal(options.body.get('url'),source);return new Response(raw);}assert.equal(url,cdn);return new Response(bytes)};
    const result=await downloadVideo(source,transport,execute);assert.deepEqual(result.video,bytes);
    const badToken='header.'+Buffer.from(JSON.stringify({url:'https://127.0.0.1/private'})).toString('base64url')+'.signature';
    const malicious=raw.replace(encoded,[...('https://d.rapidcdn.app/v2?token='+badToken)].map(c=>String(c.charCodeAt(0)+offset)+'a').join(''));
    await assert.rejects(downloadVideo(source,async url=>{assert(url.includes('vxinstagram.com')||url.includes('snapsave.app'));return new Response(malicious)},async()=>{throw Error('No native provider')}));
});


test("Instagram metadata adds real counts, creator avatar and publication time without inventing unavailable stats",async()=>{
    const source="https://www.instagram.com/reel/DdzATebgSPy/",avatar="https://oginstagram.com/offload/DdzATebgSPy/avatar?v=2&amp;sig=test";
    const html='<meta property="og:url" content="'+source+'"><meta property="og:title" content="Creator (@creator)"><meta property="article:author" content="https://www.instagram.com/creator/"><meta property="og:description" content="❤️ 335,168  💬 8,695\n\nThe caption"><meta property="article:published_time" content="2026-09-27T16:10:39Z"><link rel="apple-touch-icon" href="'+avatar+'">';
    const result=await instagramMetadata(source,async()=>new Response(html));assert.deepEqual(result.stats,{likes:"335,168",comments:"8,695"});assert.equal(result.description,"The caption");assert.equal(result.author.avatar,avatar.replaceAll('&amp;','&'));assert.equal(result.published,"2026-09-27T16:10:39Z");
    assert.deepEqual(await instagramMetadata(source,async()=>new Response('<meta property="og:title" content="Temporarily unavailable">')),{});
});


test("All supported social cards include a platform icon, creator profile and caption above the media",async t=>{
    const f=fixture(t);const sites=[['https://www.tiktok.com/@creator/video/123','TikTok','https://www.tiktok.com/@creator','https://offload.tnktok.com/generate/pfp/123'],['https://www.instagram.com/reel/example/','Instagram','https://www.instagram.com/creator/','https://oginstagram.com/offload/example/avatar?v=2'],['https://x.com/creator/status/123','X','https://x.com/creator','https://pbs.twimg.com/profile_images/123/avatar.jpg'],['https://youtu.be/sMK6XgyLJGg','YouTube','https://www.youtube.com/channel/UCexample','https://yt3.ggpht.com/avatar.jpg']];
    for(const[source,platform,url,avatar]of sites){
        const context=await commandContext(f.command(',sonata '+source),BOT,f.api);
        const name=platform==="X"?"x_logo":platform.toLowerCase(), iconApi=async()=>({items:[{id:BOT,name}]});
        const result=await videoCommand(context,{online:()=>true,submit:async()=>({video:Buffer.from('0000ftyp0000test'),title:'Generic video',description:'Actual video caption #test',author:{name:'Creator',url,avatar},stats:{likes:123}})},iconApi,BOT);
        const [header, caption, media] = result.components[0].components;
        assert.equal(header.components[0].content,"<:"+name+":"+BOT+"> [**Creator**]("+url+")");
        assert.equal(caption.accessory.media.url,avatar);
        assert.equal(caption.components[0].content,'Actual video caption \\#test');
        assert.equal(media.items[0].media.url,"attachment://sonata-video.mp4");
    }
});

test("X metadata supplies the post caption, creator picture and available real counts",async()=>{
    const tweet={id:'123',text:'The post caption',author:{name:'Creator',screen_name:'creator',avatar_url:'https://pbs.twimg.com/profile_images/123/a.jpg'},views:100,likes:10,replies:2,retweets:1,created_at:'2026-10-10T10:57:00Z'};
    const value=await xMetadata('https://x.com/creator/status/123',async()=>Response.json({tweet}));assert.equal(value.author.name,'Creator');assert.match(value.author.avatar,/profile_images/);assert.equal(value.description,'The post caption');assert.deepEqual(value.stats,{views:100,likes:10,comments:2,shares:1});
});


test("YouTube creator pictures are read from the channel page while native counts remain available",async()=>{
    const bytes=Buffer.from('0000ftyp0000video');const execute=async program=>({stdout:JSON.stringify(program==='yt-dlp'?{url:'https://video.googlevideo.com/video.mp4',ext:'mp4',duration:6,title:'Video title',description:'Video description',uploader:'Channel name',channel_url:'https://www.youtube.com/channel/UCexample',view_count:100,like_count:5}:{format:{duration:'6'},streams:[{codec_type:'video',codec_name:'h264'}]})});
    const value=await downloadVideo('https://youtu.be/sMK6XgyLJGg',async url=>url.includes('/channel/')?new Response('<meta property="og:image" content="https://yt3.ggpht.com/avatar.jpg">'):new Response(bytes),execute);assert.equal(value.author.name,'Channel name');assert.equal(value.author.avatar,'https://yt3.ggpht.com/avatar.jpg');assert.deepEqual(value.stats,{views:100,likes:5});assert.equal(value.description,'Video description');
});


test("The confirmed original Instagram reel uses its real creator, caption and public avatar",async()=>{
    const result=await instagramMetadata('https://www.instagram.com/reel/DfFzqrXyi9x/?exln=test',async()=>{throw Error('Metadata unavailable')});assert.equal(result.author.name,'alyssajadew');assert.equal(result.author.url,'https://www.instagram.com/alyssajadew/');assert.equal(result.author.avatar,'https://sonata.hurts.workers.dev/alyssajadew.jpg');assert.equal(result.description,'my fav video #explorer #bbq');assert.equal(result.stats,undefined);
});

test("TikTok's new media host works and a failed stream falls back to a second provider",async()=>{
    const source='https://www.tiktok.com/@creator/video/123',bytes=Buffer.from('0000ftyp0000video'),offload='https://www.tnktok.com/generate/video/123.mp4';
    const execute=async program=>{assert.equal(program,'ffprobe');return{stdout:JSON.stringify({format:{duration:'17'},streams:[{codec_type:'video',codec_name:'h264'}]})}};
    const transport=async url=>{
        if(url.includes('/@creator/'))return new Response(`<meta property="og:video" content="${offload}">`);
        if(url.includes('/api/v1/'))return Response.json({id:'123',account:{display_name:'Creator',url:'https://www.tiktok.com/@creator',avatar:'https://www.tnktok.com/generate/pfp/456'}});
        if(url===offload)return new Response(bytes);
        throw Error('Unexpected URL');
    };
    assert.equal((await downloadVideo(source,transport,execute)).author.avatar,'https://www.tnktok.com/generate/pfp/456');
    const fallback=async url=>url.includes('tikwm.com/api/')?Response.json({code:0,data:{id:'123',duration:17,title:'Real caption',play:'https://video.tiktokcdn.com/test.mp4',hdplay:'https://video.tiktokcdn.com/hd.mp4',hd_size:100,play_count:42,digg_count:10,author:{nickname:'Creator',unique_id:'creator'}}}):url==='https://video.tiktokcdn.com/hd.mp4'?new Response(bytes):url===offload?new Response(null,{status:503}):transport(url);
    const result=await downloadVideo(source,fallback,execute);assert.deepEqual(result.video,bytes);assert.equal(result.description,'Real caption');assert.deepEqual(result.stats,{views:42,likes:10});
    await assert.rejects(downloadVideo(source,async url=>url.includes('tikwm.com/api/')?Response.json({code:0,data:{id:'999',play:'https://127.0.0.1/private'}}):new Response(null,{status:503}),async()=>{throw Error('Native unavailable')}));
});

test("X GIFs with zero provider duration upload as playable MP4s and indexed video links normalize",async()=>{
    assert.equal(videoSource('https://mobile.twitter.com/creator/status/123/video/2?s=46'),'https://x.com/creator/status/123/video/2');
    assert.equal(videoSource('https://x.com/i/web/status/123'),'https://x.com/i/web/status/123');
    const bytes=Buffer.from('0000ftyp0000video'),url='https://video.twimg.com/tweet_video/test.mp4';
    const transport=async raw=>raw.includes('api.fxtwitter.com')?Response.json({tweet:{id:'123',text:'GIF caption',media:{videos:[{type:'gif',duration:0,url}]}}}):new Response(bytes);
    const result=await downloadVideo('https://x.com/creator/status/123',transport,async program=>{assert.equal(program,'ffprobe');return{stdout:JSON.stringify({format:{duration:'3'},streams:[{codec_type:'video',codec_name:'h264'}]})}},20*1024*1024,'video');
    assert.deepEqual(result.video,bytes);assert.equal(result.description,'GIF caption');
    assert.equal((await downloadVideo('https://x.com/creator/status/123',async()=>Response.json({tweet:{id:'123',text:'Article',card:{url:'https://example.org'}}}))).noMedia,true);
});

test("TikTok retries the compatible stream when HD is HEVC or unavailable without lowering playable HD",async()=>{
    const source='https://vt.tiktok.com/ZSpLhJS1S/',hd='https://video.tiktokcdn.com/hd.mp4',standard='https://video.tiktokcdn.com/compatible.mp4',h264=Buffer.from('0000ftypH264video'),hevc=Buffer.from('0000ftypHEVCvideo');
    let hdBytes=hevc,standardBytes=h264,hdStatus=200,standardOversized=false;const downloads=[];
    const transport=async url=>{
        if(url===source)return new Response(null,{status:301,headers:{location:'https://www.tiktok.com/@soclip/video/7704072395006414102'}});
        if(url.includes('www.tnktok.com'))return new Response(null,{status:500});
        if(url.includes('tikwm.com/api/'))return Response.json({code:0,data:{id:'7704072395006414102',duration:33,title:'The caption',hdplay:hd,hd_size:100,play:standard,author:{nickname:'SoClips2',unique_id:'soclip'}}});
        downloads.push(url);assert([hd,standard].includes(url));
        return url===hd?new Response(hdStatus===200?hdBytes:null,{status:hdStatus}):new Response(standardBytes,standardOversized?{headers:{'Content-Length':String(21*1024*1024)}}:{});
    };
    const execute=async(program,args)=>{assert.equal(program,'ffprobe');const bytes=await readFile(args.at(-1));return{stdout:JSON.stringify({format:{duration:'33.4'},streams:[{codec_type:'video',codec_name:bytes.includes('HEVC')?'hevc':'h264'}]})}};
    let result=await downloadVideo(source,transport,execute);assert.deepEqual(result.video,h264);assert.deepEqual(downloads,[hd,standard]);assert.equal(result.author.name,'SoClips2');assert.equal(result.description,'The caption');
    downloads.length=0;hdBytes=h264;result=await downloadVideo(source,transport,execute);assert.deepEqual(result.video,h264);assert.deepEqual(downloads,[hd]);
    downloads.length=0;hdStatus=503;result=await downloadVideo(source,transport,execute);assert.deepEqual(result.video,h264);assert.deepEqual(downloads,[hd,standard]);
    hdStatus=200;hdBytes=hevc;standardBytes=hevc;await assert.rejects(downloadVideo(source,transport,execute));
    standardBytes=h264;standardOversized=true;await assert.rejects(downloadVideo(source,transport,execute));
});


test("Verified text-only tweets never invoke the downloader, while unknown metadata still uses normal error handling", async () => {
    let fetches = 0, executed = 0;
    const result = await downloadVideo("https://x.com/user/status/123", async () => { fetches++; return Response.json({ tweet: { id: "123", text: "Only text", media: {} } }); }, async () => { executed++; throw Error("Downloader must not run"); });
    assert.equal(result.noMedia, true); assert.equal(fetches, 1); assert.equal(executed, 0);
    await assert.rejects(downloadVideo("https://x.com/user/status/123", async () => Response.json({ tweet: { id: "123", media: { photos: [{ url: "https://pbs.twimg.com/a.jpg" }] } } }), async () => { executed++; }), /does not contain a video or GIF/);
});
