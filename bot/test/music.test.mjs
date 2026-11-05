/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parsePrefix, parseSlash, slashCommands, slashName } from "../commands.mjs";
import { musicCommand } from "../musicCommands.mjs";
import { MusicBridge } from "../musicBridge.mjs";
import { commandContext } from "../moderation.mjs";
import { ACTOR, BOT, GUILD, CHANNEL, TARGET, BOTROLE, fixture } from "./fixture.mjs";
import { PERMS } from "../discord.mjs";
import { VIDEO_MAX_BYTES } from "../music/videoSource.mjs";

const job = { id: "123456789012345678", guild: GUILD, channel: CHANNEL, actor: ACTOR, name: "play", options: { query: "test track" } };

test("Long polling wakes immediately for work and resets, and expires idle waits",async t=>{
    t.mock.timers.enable({apis:["setTimeout"]});const bridge=new MusicBridge(),state=()=>[BOT,true];
    bridge.poll(BOT,true);const poll=bridge.waitPoll(state),result=bridge.submit(job);assert.equal((await poll).jobs[0].id,job.id);assert.equal(bridge.poll(BOT,true).jobs.length,0);
    bridge.complete({id:job.id,title:"Done",description:"Confirmed"});await result;
    const idle=bridge.waitPoll(state);t.mock.timers.tick(10000);assert.deepEqual((await idle).jobs,[]);
    const waiting=bridge.waitPoll(state),generation=bridge.generation;bridge.reset();assert.notEqual((await waiting).generation,generation);assert.equal(bridge.waiter,null);
});

test("Binary videos accept the full 100 MiB boosted cap without base64 overhead and reject larger files",async()=>{
    const bridge=new MusicBridge();bridge.poll(BOT,true);const result=bridge.submit({...job,kind:"video",limit:VIDEO_MAX_BYTES}),bytes=Buffer.alloc(VIDEO_MAX_BYTES);bytes.write("ftyp",4);
    assert.throws(()=>bridge.complete({id:job.id,title:"Clip",description:"Caption"},Buffer.alloc(VIDEO_MAX_BYTES+1)),/Invalid video/);
    assert.throws(()=>bridge.complete({id:job.id,title:"Clip",description:"Caption"},Buffer.from("not an mp4 video")),/Invalid video/);
    bridge.complete({id:job.id,title:"Clip",description:"Caption"},bytes);assert.equal((await result).video,bytes);
});

test("Music options agree between prefixes and slash commands and reject invalid controls", () => {
    assert.deepEqual(parsePrefix(",p a test track", ",").options, parseSlash({ name: "play", options: [{ name: "query", value: "a test track" }] }).options);
    assert.throws(() => parsePrefix(",volume 101", ","), /valid percent/);
    assert.throws(() => parsePrefix(",loop forever", ","), /valid mode/);
    assert.throws(() => parsePrefix(",seek -1", ","), /valid seconds/);
    const registered = slashCommands();
    const group = registered.find(command => command.name === "music");
    assert.deepEqual(group.options.map(action => action.name), ["pause", "resume", "seek", "volume", "shuffle"]);
    for (const [action, option, amount] of [["pause"], ["resume"], ["seek", "seconds", 90], ["volume", "percent", 40], ["shuffle"]]) {
        assert.ok(!registered.some(command => command.name === action));
        assert.equal(slashName(action), `music ${action}`);
        const values = option ? [{ name: option, type: 4, value: amount }] : [];
        const nested = parseSlash({ name: "music", options: [{ name: action, type: 1, options: values }] });
        assert.deepEqual(nested, parsePrefix(`,${action}${option ? ` ${amount}` : ""}`, ","));
        assert.deepEqual(nested, parseSlash({ name: action, options: values }));
    }
    for (const name of ["play", "skip", "stop"]) assert.ok(registered.some(command => command.name === name));
    assert.throws(() => parseSlash({ name: "music", options: [{ name: "stop", type: 1 }] }), /Choose music/);
    assert.throws(() => parseSlash({ name: "music", options: [{ name: "volume", options: [{ name: "percent", value: 101 }] }] }), /valid percent/);
});

test("Music bridge permits only its leased channel and opcode, drains once, and completes confirmed requests", async () => {
    const bridge = new MusicBridge();
    assert.throws(() => bridge.submit(job), /offline/);
    bridge.poll(BOT, true);
    const result = bridge.submit(job), batch = bridge.poll(BOT, true);
    assert.equal(batch.jobs.length, 1); assert.equal(batch.jobs[0].id, job.id); assert(batch.jobs[0].expires > Date.now()); assert.equal(bridge.poll(BOT, true).jobs.length, 0);
    const send = [], packet = { op: 4, d: { guild_id: GUILD, channel_id: CHANNEL, self_mute: false, self_deaf: true } };
    bridge.voice(packet, value => send.push(value)); assert.equal(send.length, 1);
    assert.throws(() => bridge.voice({ ...packet, op: 2 }, () => assert.fail()), /Invalid/);
    assert.throws(() => bridge.voice({ ...packet, d: { ...packet.d, channel_id: TARGET } }, () => assert.fail()), /Invalid/);
    bridge.event("VOICE_STATE_UPDATE", { guild_id: GUILD, user_id: TARGET, channel_id: CHANNEL }, BOT);
    assert.equal(bridge.poll(BOT, true).events.length, 0);
    bridge.event("VOICE_SERVER_UPDATE", { guild_id: GUILD, token: "fake-voice-token", endpoint: "fake.discord.media" }, BOT);
    assert.equal(bridge.poll(BOT, true).events.length, 1);
    assert.equal(bridge.poll(BOT, true).events.length, 0);
    bridge.complete({ id: job.id, title: "Now playing", description: "A confirmed track", disconnected: true });
    assert.equal((await result).title, "Now playing"); assert.equal(bridge.channels.size, 0);
});

test("Resetting the bridge resolves pending commands and invalidates voice leases", async () => {
    const bridge = new MusicBridge(); bridge.poll(BOT, true);
    const generation = bridge.generation, pending = bridge.submit(job);
    bridge.reset(); assert.notEqual(bridge.generation, generation); assert.equal(bridge.jobs.size, 0);
    assert.equal((await pending).title, "Music disconnected"); assert.equal(bridge.channels.size, 0);
});

test("Video metadata crosses the bridge with bounded counts and a valid publication date",async()=>{
    const bridge=new MusicBridge();bridge.poll(BOT,true);const result=bridge.submit({...job,kind:"video"});
    bridge.complete({id:job.id,title:"Clip",description:"Caption",video:Buffer.from("0000ftyp0000test").toString("base64"),stats:{views:85355,likes:"13.3K",comments:"<@123>",shares:-1,arbitrary:500},author:{name:"Creator",url:"https://www.instagram.com/creator/",avatar:"https://oginstagram.com/offload/example/avatar?v=2"},published:"2026-09-26T00:12:46.000Z"});
    const value=await result;assert.deepEqual(value.stats,{views:85355,likes:"13.3K"});assert.equal(value.author.name,"Creator");assert.match(value.author.avatar,/oginstagram/);assert.equal(value.published,"2026-09-26T00:12:46.000Z");
});

test("Music commands require the caller's current voice channel and the bot's actual permissions", async t => {
    const f = fixture(t), bridge = { online: () => true, async submit(value) { assert.equal(value.channel, CHANNEL); return { title: "Now playing", description: "Confirmed" }; } };
    f.channels[0].type = 2;
    const parsed = parsePrefix(",play test track", ","), command = { ...parsed, id: job.id, guild: GUILD, channel: CHANNEL, actor: ACTOR };
    let context = await commandContext(command, BOT, f.api);
    await assert.rejects(musicCommand(context, bridge), /Join a voice/);
    f.voiceStates.set(ACTOR, { channel_id: CHANNEL });
    context = await commandContext(command, BOT, f.api);
    assert.equal((await musicCommand(context, bridge)).embeds[0].title, "Now playing");
    f.roles.find(role => role.id === BOTROLE).permissions = (PERMS.VIEW | PERMS.CONNECT).toString();
    await assert.rejects(commandContext(command, BOT, f.api), /Administrator/);
    await assert.rejects(musicCommand(context, { online: () => false }), /offline/);
});


test("Play accepts one uploaded file in prefix and slash commands and rejects mixed or unsupported input before dispatch", async t => {
    const file = { id: "999999999999999999", filename: "audio.mp3", size: 1000, url: "https://cdn.discordapp.com/attachments/111111111111111111/222222222222222222/audio.mp3" };
    const prefix = parsePrefix(",play", ",", [file]), slash = parseSlash({ name: "play", options: [{ name: "file", type: 11, value: file.id }] }, { [file.id]: file });
    assert.deepEqual(prefix.options, slash.options);assert.equal(prefix.options.file, file);
    assert.throws(()=>parsePrefix(",play", ",", [file, file]), /one MP3/);
    const f = fixture(t); f.channels[0].type = 2; f.voiceStates.set(ACTOR, { channel_id: CHANNEL });
    const context = await commandContext({...prefix,id:job.id,guild:GUILD,channel:CHANNEL,actor:ACTOR},BOT,f.api);let dispatched=0;
    const bridge = {online:()=>true,async submit(value){dispatched++;assert.equal(value.options.file.url,file.url);return{title:"Now playing",description:"Uploaded audio"}}};
    await musicCommand(context,bridge,f.store);assert.equal(dispatched,1);
    context.command.options.query="song";await assert.rejects(musicCommand(context,bridge,f.store),/song name or link/);
    context.command.options={file:{...file,filename:"audio.flac"}};await assert.rejects(musicCommand(context,bridge,f.store),/one MP3/);assert.equal(dispatched,1);
});
