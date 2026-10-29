/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parsePrefix, parseSlash } from "../commands.mjs";
import { musicCommand } from "../musicCommands.mjs";
import { MusicBridge } from "../musicBridge.mjs";
import { commandContext } from "../moderation.mjs";
import { ACTOR, BOT, GUILD, CHANNEL, TARGET, BOTROLE, fixture } from "./fixture.mjs";
import { PERMS } from "../discord.mjs";

const job = { id: "123456789012345678", guild: GUILD, channel: CHANNEL, actor: ACTOR, name: "play", options: { query: "test track" } };

test("Music options agree between prefixes and slash commands and reject invalid controls", () => {
    assert.deepEqual(parsePrefix(",p a test track", ",").options, parseSlash({ name: "play", options: [{ name: "query", value: "a test track" }] }).options);
    assert.throws(() => parsePrefix(",volume 101", ","), /valid percent/);
    assert.throws(() => parsePrefix(",loop forever", ","), /valid mode/);
    assert.throws(() => parsePrefix(",seek -1", ","), /valid seconds/);
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
