/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { COMMANDS, parsePrefix, parseSlash, slashCommands } from "../commands.mjs";
import { runDueJobs } from "../jobs.mjs";
import { botStore } from "../store.mjs";
import { recoveryEvent } from "../roleRecovery.mjs";
import { starboardEvent } from "../starboard.mjs";
import { ACTOR, BOT, BOTROLE, CHANNEL, fixture, GUILD, TARGET, USERROLE } from "./fixture.mjs";

test("Temporary roles and starboard have prefix and slash syntax within Discord's command limit", () => {
    const prefix = parsePrefix(`,temprole <@${TARGET}> <@&${USERROLE}> 7d event reward`, ",");
    const slash = parseSlash({ name: "role", options: [{ name: "temp", options: [{ name: "member", value: TARGET }, { name: "role", value: USERROLE }, { name: "duration", value: "7d" }, { name: "reason", value: "event reward" }] }] });
    assert.deepEqual(prefix, slash);
    assert.equal(parsePrefix(`,starboard setup <#${CHANNEL}> 5`, ",").sub, "starboard");
    assert.equal(parsePrefix(",starboard off", ",").sub, "starboardoff");
    assert.equal(parsePrefix(",starboard", ",").sub, "starboardview");
    assert.throws(() => parsePrefix(`,starboard setup ${CHANNEL} 0`, ","));
    assert.throws(() => parsePrefix(",starboard unknown", ","));
    assert.equal(COMMANDS.length, 103); assert.ok(slashCommands().length <= 100);
});

test("Temporary roles persist and expire with grant and automatic expiry cases", async t => {
    const f = fixture(t); f.members.get(TARGET).roles = [];
    const response = await f.execute(`,temprole ${TARGET} ${USERROLE} 1h event reward`);
    assert.match(response.embeds[0].description, /Expires/);
    assert(f.members.get(TARGET).roles.includes(USERROLE));
    assert.equal(f.store.case(GUILD, 1).duration, 3600_000);
    f.store.run("UPDATE jobs SET due=0");
    await runDueJobs(botStore(f.storage), f.api, BOT);
    assert(!f.members.get(TARGET).roles.includes(USERROLE));
    assert.equal(f.store.get("SELECT state FROM jobs").state, "completed");
    assert.equal(f.store.case(GUILD, 2).kind, "temporary role expired");
    assert.equal(f.store.case(GUILD, 2).actor, BOT);
    assert.match(f.store.case(GUILD, 1).reason, /event reward/);
});

test("Temporary renewal replaces its timer and permanent assignments cancel expiry", async t => {
    const f = fixture(t); f.members.get(TARGET).roles = [];
    await f.execute(`,temprole ${TARGET} ${USERROLE} 1h`);
    await f.execute(`,temprole ${TARGET} ${USERROLE} 2h`);
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM jobs WHERE state='pending'").n, 1);
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM jobs WHERE state='cancelled'").n, 1);
    await f.execute(`,role add ${TARGET} ${USERROLE}`);
    f.store.run("UPDATE jobs SET due=0"); await runDueJobs(f.store, f.api, BOT);
    assert(f.members.get(TARGET).roles.includes(USERROLE));
    await assert.rejects(f.execute(`,temprole ${TARGET} ${USERROLE} 1h`), /permanently/);
});

test("Temporary roles enforce permission and hierarchy and avoid timed role recovery", async t => {
    const f = fixture(t); f.members.get(TARGET).roles = [];
    await assert.rejects(f.execute(`,temprole ${TARGET} ${BOTROLE} 1h`), /highest role/);
    await f.execute(`,temprole ${TARGET} ${USERROLE} 1h`);
    f.store.saveSettings(GUILD, { ...f.store.settings(GUILD), roleRecovery: true });
    recoveryEvent("GUILD_MEMBER_UPDATE", { guild_id: GUILD, ...f.members.get(TARGET) }, f.store);
    recoveryEvent("GUILD_MEMBER_REMOVE", { guild_id: GUILD, user: { id: TARGET } }, f.store);
    assert.deepEqual(JSON.parse(f.store.get("SELECT roles FROM role_returns").roles), []);
    f.roles.find(role => role.id === USERROLE).position = 40;
    f.store.run("UPDATE jobs SET due=0"); await runDueJobs(f.store, f.api, BOT);
    assert.equal(f.store.get("SELECT state FROM jobs").state, "pending");
    assert.match(f.store.get("SELECT detail FROM jobs").detail, /above the temporary role/);
    assert(f.members.get(TARGET).roles.includes(USERROLE));
});

test("Absent members complete role expiry without granting or deleting member roles", async t => {
    const f = fixture(t); f.members.get(TARGET).roles = [];
    await f.execute(`,temprole ${TARGET} ${USERROLE} 1h`);
    f.members.delete(TARGET); f.store.run("UPDATE jobs SET due=0");
    await runDueJobs(f.store, f.api, BOT);
    assert.equal(f.store.get("SELECT state FROM jobs").state, "completed");
    assert.match(f.store.case(GUILD, 2).detail, /no longer/);
});

const BOARD = "999999999999999999", MESSAGE = "123456789123456789";
async function boardFixture(t) {
    const f = fixture(t);
    f.channels[0].name = "chat";
    f.channels.push({ id: BOARD, name: "highlights", type: 0, guild_id: GUILD, permission_overwrites: [] });
    await f.execute(`,starboard setup ${BOARD} 3`);
    const source = { id: MESSAGE, channel_id: CHANNEL, author: { id: TARGET, username: "Member", avatar: "abc" }, content: "A good message", timestamp: "2026-10-29T12:00:00.000Z", attachments: [{ url: "https://cdn.discordapp.com/attachments/123/456/image.png", content_type: "image/png" }], reactions: [{ emoji: { name: "⭐", id: null }, count: 3, count_details: { normal: 3, burst: 0 } }] };
    f.messages.push(source);
    const event = { guild_id: GUILD, channel_id: CHANNEL, message_id: MESSAGE, emoji: { name: "⭐", id: null } };
    return { ...f, source, event, react: type => starboardEvent(type ?? "MESSAGE_REACTION_ADD", event, f.store, f.api) };
}

test("Starboard creates one highlight, updates it, and removes it below threshold", async t => {
    const f = await boardFixture(t);
    await f.react();
    const post = f.postedMessages[0];
    assert.match(post.embeds[0].title, /⭐ 3/);
    assert.equal(post.embeds[0].author.name, "Member");
    assert.match(post.embeds[0].image.url, /image.png/);
    assert.match(post.components[0].components[0].url, new RegExp(MESSAGE));
    assert.deepEqual(post.allowed_mentions.parse, []);
    f.source.reactions[0].count_details.normal = 4; await f.react();
    assert.equal(f.postedMessages.length, 1); assert.match(post.embeds[0].title, /⭐ 4/);
    f.source.content = "Edited message"; await f.react("MESSAGE_UPDATE");
    assert.match(post.embeds[0].description, /Edited message/);
    f.source.reactions[0].count_details.normal = 2; await f.react("MESSAGE_REACTION_REMOVE");
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM starboard_posts").n, 0);
    assert(f.calls.some(call => call.method === "DELETE" && call.route.endsWith(post.id)));
});

test("Starboard ignores other emoji, bot messages, restricted sources and super reactions", async t => {
    const f = await boardFixture(t);
    await starboardEvent("MESSAGE_REACTION_ADD", { ...f.event, emoji: { name: "💜" } }, f.store, f.api);
    f.source.author.bot = true; await f.react(); f.source.author.bot = false;
    f.channels[0].nsfw = true; await f.react(); f.channels[0].nsfw = false;
    f.channels[0].permission_overwrites = [{ id: GUILD, type: 0, deny: "1024", allow: "0" }]; await f.react();
    f.channels[0].permission_overwrites = [];
    f.source.reactions[0].count_details = { normal: 1, burst: 10 }; await f.react();
    assert.equal(f.postedMessages.length, 0);
});

test("Starboard keeps its mapping after restart and cleans up deleted originals while paused", async t => {
    const f = await boardFixture(t); await f.react();
    await f.execute(",starboard off");
    const response = await f.execute(",starboard view"); assert.match(response.embeds[0].description, /Off/);
    await starboardEvent("MESSAGE_DELETE_BULK", { guild_id: GUILD, channel_id: CHANNEL, ids: [MESSAGE] }, botStore(f.storage), f.api);
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM starboard_posts").n, 0);
    assert(f.calls.some(call => call.method === "DELETE" && call.route.endsWith(f.postedMessages[0].id)));
});

test("Only server managers can configure starboard", async t => {
    const f = fixture(t); f.members.get(ACTOR).roles = [];
    await assert.rejects(f.execute(`,starboard setup ${CHANNEL} 5`), /permissions/);
    assert.equal(f.store.settings(GUILD).starboard, undefined);
});
