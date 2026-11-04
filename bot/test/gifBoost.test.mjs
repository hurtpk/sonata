/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { videoLimit } from "../music/videoSource.mjs";
import { downloadVideo } from "../music/video.mjs";
import { MusicBridge } from "../musicBridge.mjs";
import { videoCommand, videoModeReply, videoReply } from "../videoEmbeds.mjs";
import { commandContext } from "../moderation.mjs";
import { discordApi, replyPayload } from "../discord.mjs";
import { fixture, ACTOR, BOT, GUILD, CHANNEL, TARGET } from "./fixture.mjs";

const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'),mp4=Buffer.from('0000ftyp0000video'),source='https://x.com/creator/status/123';

test("Upload limits follow the server boost tier and travel with each video job",async t=>{
    assert.deepEqual([undefined,0,1,2,3].map(tier=>videoLimit({premium_tier:tier})/1048576),[20,20,20,50,100]);
    const f=fixture(t);for(const tier of [0,1,2,3]){f.guild.premium_tier=tier;const context=await commandContext(f.command(',sonata '+source),BOT,f.api);let job;
        await videoCommand(context,{online:()=>true,submit:async value=>{job=value;return{video:mp4,title:'Caption'}}});assert.equal(job.limit,videoLimit(f.guild));assert.equal(job.mode,'gif');}
});

test("GIF extraction creates a looping GIF while video mode keeps the original MP4",async()=>{
    const transport=async url=>url.includes('api.fxtwitter.com')?Response.json({tweet:{id:'123',text:'Caption',media:{videos:[{type:'gif',duration:0,url:'https://video.twimg.com/tweet_video/test.mp4'}]}}}):new Response(mp4);
    let conversions=0;const execute=async(program,args)=>{if(program==='ffprobe')return{stdout:JSON.stringify({format:{duration:'3'},streams:[{codec_type:'video',codec_name:'h264'}]})};assert.equal(program,'ffmpeg');assert(args.includes('-protocol_whitelist'));conversions++;if(args.at(-1).endsWith('.gif')){assert(args.includes('-loop'));await writeFile(args.at(-1),gif);}return{stdout:''}};
    const result=await downloadVideo(source,transport,execute);assert.equal(result.format,'gif');assert.equal(result.isGif,true);assert.deepEqual(result.video,gif);assert.equal(conversions,2);
    const video=await downloadVideo(source,transport,execute,videoLimit(),'video');assert.deepEqual(video.video,mp4);assert.equal(video.format,'mp4');assert.equal(video.isGif,true);assert.equal(conversions,2);
});

test("GIF bridge validates real GIF bytes and enforces each request's individual size limit",async()=>{
    const bridge=new MusicBridge();bridge.poll(BOT,true);const job={id:'123456789012345678',kind:'video',guild:GUILD,channel:CHANNEL,source},pending=bridge.submit(job);
    assert.throws(()=>bridge.complete({id:job.id,title:'Clip',description:'Caption',format:'gif'},mp4),/Invalid video/);
    assert.throws(()=>bridge.complete({id:job.id,title:'Clip',description:'Caption'},Buffer.alloc(21*1048576)),/Invalid video/);
    bridge.complete({id:job.id,title:'Clip',description:'Caption',format:'gif'},gif);const result=await pending;assert.equal(result.isGif,true);assert.equal(result.format,'gif');
});

test("GIF and Video controls replace the original attachment, preserve attribution and reject other viewers",async t=>{
    const f=fixture(t),actor=f.members.get(ACTOR),reply=videoReply({video:gif,format:'gif',isGif:true,title:'Caption'},source,actor);
    assert.equal(reply.files[0].type,'image/gif');assert.equal(reply.embeds[0].image.url,'attachment://sonata-animation.gif');assert.equal(reply.components[0].components[0].label,'Video');
    const data={id:'123456789012345678',type:3,guild_id:GUILD,channel_id:CHANNEL,member:{user:{id:ACTOR}},message:{id:'123456789012345679',author:{id:BOT},...reply},data:{custom_id:reply.components[0].components[0].custom_id}};
    let job;const bridge={online:()=>true,submit:async value=>{job=value;return{video:mp4,format:'mp4',isGif:true,title:'Caption'}}};
    const next=await videoModeReply(data,f.api,bridge,BOT);assert.equal(job.mode,'video');assert.equal(next.files[0].type,'video/mp4');assert.equal(next.embeds[0].image,undefined);assert.equal(next.components[0].components[0].label,'GIF');assert.match(next.embeds[0].footer.text,new RegExp(actor.user.username));
    await assert.rejects(videoModeReply({...data,member:{user:{id:TARGET}}},f.api,bridge,BOT),/Only the original sender/);
    await assert.rejects(videoModeReply({...data,message:{...data.message,author:{id:TARGET}}},f.api,bridge,BOT),/Only the original sender/);
    const dm={...data,guild_id:undefined,member:undefined,user:{id:ACTOR}};
    const dmApi=async route=>route===`/channels/${CHANNEL}`?{id:CHANNEL,type:1,recipients:[actor.user]}:f.api(route);
    assert.equal((await videoModeReply(dm,dmApi,bridge,BOT)).files[0].type,'video/mp4');assert.equal(job.limit,20*1048576);
    await assert.rejects(videoModeReply(dm,async()=>({type:1,recipients:[{id:TARGET}]}),bridge,BOT),/original direct message/);
});

test("Large uploads stream bounded chunks without creating another full-sized Blob",async()=>{
    const bytes=Buffer.alloc(21*1048576,42),payload=replyPayload({content:'Large clip',files:[{name:'sonata-video.mp4',type:'video/mp4',bytes}]});assert(payload.stream);assert.equal(payload.form,undefined);
    let size=0;for await(const chunk of payload.stream){assert(chunk.length<=65536);size+=chunk.length;}assert.equal(size,payload.length);assert(size>bytes.length);
    const encoded=replyPayload({content:'Large clip',files:[{name:'sonata-video.mp4',type:'video/mp4',bytes}]});
    const form=await new Response(encoded.stream,{headers:{'Content-Type':encoded.contentType}}).formData();assert.equal(JSON.parse(form.get('payload_json')).content,'Large clip');assert.equal(form.get('files[0]').size,bytes.length);assert.equal(form.get('files[0]').type,'video/mp4');
    let attempts=0;const api=discordApi('fake-token',async(url,options)=>{attempts++;assert.equal(options.duplex,'half');let size=0;for await(const chunk of options.body)size+=chunk.length;assert.equal(size,Number(options.headers['Content-Length']));return Response.json({retry_after:1},{status:429})});
    await assert.rejects(api(`/channels/${CHANNEL}/messages`,{method:'POST',...replyPayload({files:[{name:'sonata-video.mp4',type:'video/mp4',bytes}]})}),/rate limiting/);assert.equal(attempts,1);
});
