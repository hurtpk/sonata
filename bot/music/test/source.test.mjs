/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { musicSource } from "../source.mjs";
import { VoiceMusic } from "../player.mjs";
import { createAudioPlayer } from "@discordjs/voice";

test("Music lookups normalize allowed providers and cannot select filesystem or arbitrary network extractors", () => {
    const canonical = "https://www.youtube.com/watch?v=sMK6XgyLJGg";
    assert.equal(musicSource("https://youtu.be/sMK6XgyLJGg?t=2"), canonical);
    assert.equal(musicSource(canonical + "&list=ignore"), canonical);
    assert.equal(musicSource("a song name"), "scsearch1:a song name");
    assert.equal(musicSource("https://soundcloud.com/kenndog/beethoven?utm_source=test"), "https://soundcloud.com/kenndog/beethoven");
    for (const value of ["file:///etc/passwd", "http://127.0.0.1/x", "https://youtube.com.evil.test/watch?v=sMK6XgyLJGg", "https://user:pass@youtube.com/watch?v=sMK6XgyLJGg", "https://youtube.com/playlist?list=x", "ytsearch1000:test", "../file", "https://youtube.com:8443/watch?v=sMK6XgyLJGg"]) assert.throws(() => musicSource(value), value);
});

test("Queue controls affect only the caller's server and stop closes its connection", async () => {
    const music = new VoiceMusic(async () => {}, 1), player = createAudioPlayer();
    let destroyed = 0;
    const track = name => ({ title: name, url: "https://www.youtube.com/watch?v=sMK6XgyLJGg", duration: 100 });
    const room = { guild: "guild", channel: "voice", current: track("Current"), queue: [track("First"), track("Second")], volume: 70, loop: "off", offset: 2, player, connection: { destroy() { destroyed++; } } };
    music.rooms.set("guild", room);
    const job = (name, options = {}) => ({ guild: "guild", channel: "voice", name, options });
    assert.match((await music.command(job("queue"))).description, /1\. \[First\]/);
    await music.command(job("remove", { position: 1 })); assert.equal(room.queue[0].title, "Second");
    await assert.rejects(music.command(job("remove", { position: 2 })), /valid upcoming/);
    await music.command(job("loop", { mode: "queue" })); assert.equal(room.loop, "queue");
    await assert.rejects(music.command({ ...job("stop"), channel: "other" }), /current voice channel/);
    await music.command(job("stop")); assert.equal(destroyed, 1); assert.equal(music.rooms.size, 0);
    await assert.rejects(music.command(job("pause")), /No music/);
});


test("SoundCloud HLS starts without zero-time input seeking; segmented seeks decode after input", async () => {
    const { mediaInput } = await import("../attachments.mjs");
    const url = "https://playback.media-streaming.soundcloud.cloud/test.m3u8";
    assert.equal(mediaInput(url, 0, true).includes("-ss"), false);
    const hls = mediaInput(url, 12, true), direct = mediaInput(url, 12, false);
    assert(hls.indexOf("-ss") > hls.indexOf("-i")); assert(direct.indexOf("-ss") < direct.indexOf("-i"));
});

test("Music uploads allow only the five requested extensions, bounded Discord attachments and no arbitrary URLs", async () => {
    const { musicAttachment, MUSIC_FILE_LIMIT } = await import("../attachments.mjs");
    const file = { filename: "audio.mp3", size: 1000, url: "https://cdn.discordapp.com/attachments/111111111111111111/222222222222222222/audio.mp3?ex=1&hm=test" };
    for (const ext of ["mp3", "wav", "mov", "mp4", "ogg"]) assert.equal(musicAttachment({ ...file, filename: "audio." + ext }).size, 1000);
    for (const change of [{filename:"audio.flac"},{filename:"audio.m4a"},{filename:"audio.exe"},{size:MUSIC_FILE_LIMIT+1},{size:0},{url:"http://127.0.0.1/a.mp3"},{url:"https://cdn.discordapp.com.evil.test/attachments/111111111111111111/222222222222222222/a.mp3"},{url:"https://cdn.discordapp.com/avatars/111111111111111111/a.mp3"}]) assert.throws(()=>musicAttachment({...file,...change}));
});
