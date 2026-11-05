/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { VoiceMusic } from "../player.mjs";

const track = { title: "Track", url: "https://soundcloud.com/test/track", duration: 100, resolved: Date.now() };
const job = { guild: "guild", channel: "voice", actor: "listener", name: "play", options: { query: "track" }, expires: Date.now() + 60_000 };
const deferred = () => Promise.withResolvers();
function setup() {
    const loading = deferred(), joining = deferred();
    let lookupStarted = false, joinStarted = false, streamed = false, destroyed = 0;
    const music = new VoiceMusic(async () => {}, 1, () => { lookupStarted = true; return loading.promise; });
    const room = { guild: job.guild, channel: job.channel, queue: [], current: null, player: { stop() {} }, connection: { destroy() { destroyed++; } } };
    music.open = async () => { joinStarted = true; music.rooms.set(job.guild, room); await joining.promise; return room; };
    music.stream = async (ready, resolved) => { assert.equal(ready, room); assert.equal(resolved.title, track.title); streamed = true; ready.current = resolved; };
    return { music, room, loading, joining, status: () => ({ lookupStarted, joinStarted, streamed, destroyed }) };
}

test("Voice joining and lookup start together, and playback waits for both in either completion order", async () => {
    for (const first of ["loading", "joining"]) {
        const f = setup(), pending = f.music.command(job);
        assert.equal(f.status().joinStarted, true); assert.equal(f.status().lookupStarted, true);
        f[first].resolve(track); await Promise.resolve(); await Promise.resolve();
        assert.equal(f.status().streamed, false);
        f[first === "loading" ? "joining" : "loading"].resolve(track);
        assert.equal((await pending).title, "Now playing"); assert.equal(f.status().streamed, true);
    }
});

test("A failed lookup disconnects a newly joining room without waiting for the handshake", async () => {
    const f = setup(), pending = f.music.command(job), failed = assert.rejects(pending, /Unavailable track/);
    f.loading.reject(new Error("Unavailable track")); await failed;
    assert.equal(f.music.rooms.size, 0); assert.equal(f.status().destroyed, 1); assert.equal(f.status().streamed, false);
    f.joining.reject(new Error("Connection closed")); await Promise.resolve();
});

test("A failed voice connection cleans up while the lookup can still finish safely", async () => {
    const f = setup(), pending = f.music.command(job), failed = assert.rejects(pending, /Cannot join/);
    f.joining.reject(new Error("Cannot join")); await failed;
    assert.equal(f.music.rooms.size, 0); assert.equal(f.status().destroyed, 1);
    f.loading.resolve(track); await Promise.resolve(); assert.equal(f.status().streamed, false);
});

test("Lookup failures preserve an existing server's playback and queue", async () => {
    const f = setup(); f.room.current = track; f.room.queue.push(track); f.music.rooms.set(job.guild, f.room);
    const pending = f.music.command(job), failed = assert.rejects(pending, /Unavailable track/);
    assert.equal(f.status().joinStarted, false); f.loading.reject(new Error("Unavailable track")); await failed;
    assert.equal(f.music.rooms.get(job.guild), f.room); assert.equal(f.room.current, track); assert.deepEqual(f.room.queue, [track]); assert.equal(f.status().destroyed, 0);
});

test("Expired and reset startup jobs cannot play or disconnect a replacement room", async () => {
    const expired = setup(), expiredJob = expired.music.command({ ...job, expires: Date.now() - 1 });
    expired.joining.resolve(); expired.loading.resolve(track); await assert.rejects(expiredJob, /expired/);
    assert.equal(expired.music.rooms.size, 0); assert.equal(expired.status().streamed, false);
    const f = setup(), pending = f.music.command(job); f.music.closeAll();
    const replacement = { guild: job.guild }; f.music.rooms.set(job.guild, replacement);
    f.joining.resolve(); f.loading.resolve(track); await assert.rejects(pending, /restarted/);
    assert.equal(f.music.rooms.get(job.guild), replacement); assert.equal(f.status().destroyed, 1); assert.equal(f.status().streamed, false);
});
