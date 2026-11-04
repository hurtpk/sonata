/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import assert from "node:assert/strict";
import test from "node:test";
import { dashboardRequest, guildEvent } from "../dashboard.mjs";
import { FEATURE_GROUPS } from "../featureGroups.mjs";
import { PERMS } from "../discord.mjs";
import { MusicBridge } from "../musicBridge.mjs";
import { honeypotEvent } from "../honeypot.mjs";
import { communityEvent } from "../communityEvents.mjs";
import { caseLog } from "../moderation.mjs";
import { runDueJobs } from "../jobs.mjs";
import { giveawayTimers } from "../giveaways.mjs";
import { ACTOR, BOT, CHANNEL, fixture, GUILD, MODROLE, OWNER, TARGET, USERROLE } from "./fixture.mjs";

function setup(t) {
    const f = fixture(t); guildEvent("GUILD_CREATE", f.guild, f.store);
    const bot = { store: f.store, api: f.api, music: new MusicBridge(), session: { userId: BOT }, env: {}, status: () => ({ connected: true }) };
    const request = (actor, input) => dashboardRequest(new Request("https://bot.internal/dashboard/features" + (input ? "" : `?guild=${GUILD}`), { method: input ? "POST" : "GET", headers: { "X-Sonata-User": actor }, body: input ? JSON.stringify({ guild: GUILD, ...input }) : undefined }), bot);
    return { f, bot, request };
}

test("Feature groups default on and only owner/current administrators can change them", async t => {
    const { f, request } = setup(t);
    const manager = await request(ACTOR); assert.equal(manager.groups.length, FEATURE_GROUPS.length); assert.ok(manager.groups.every(group => group.enabled)); assert.equal(manager.canManage, false);
    await assert.rejects(request(ACTOR, { group: "media", enabled: false }), /permitted administrators/);
    f.roles.find(role => role.id === MODROLE).permissions = PERMS.ADMIN.toString();
    await request(ACTOR, { group: "media", enabled: false }); assert.ok(f.store.settings(GUILD).disabledFeatures.includes("media"));
    f.roles.find(role => role.id === MODROLE).permissions = PERMS.GUILD.toString();
    await assert.rejects(request(ACTOR, { group: "media", enabled: true }), /permitted administrators/);
    await request(OWNER, { group: "media", enabled: true }); assert.deepEqual(f.store.settings(GUILD).disabledFeatures, []);
});

test("Owner can revoke administrator feature access even for whitelisted admins; admins cannot restore it", async t => {
    const { f, request } = setup(t); f.roles.find(role => role.id === MODROLE).permissions = PERMS.ADMIN.toString();
    f.store.saveSettings(GUILD, { ...f.store.settings(GUILD), dashboardAccess: { administrators: false, users: [ACTOR, TARGET] } });
    await request(OWNER, { administrators: false });
    assert.equal((await request(ACTOR)).canManage, false);
    await assert.rejects(request(ACTOR, { group: "community", enabled: false }), /permitted administrators/);
    await assert.rejects(request(ACTOR, { administrators: true }), /Only the server owner/);
    await assert.rejects(request(TARGET, { group: "community", enabled: false }), /permitted administrators/);
    await request(OWNER, { administrators: true }); assert.equal((await request(ACTOR)).canManage, true);
    f.members.delete(ACTOR); await assert.rejects(request(ACTOR, { group: "community", enabled: false }), /server owner/);
});

test("Feature updates validate IDs/booleans and preserve saved tools and dashboard policy", async t => {
    const { f, request } = setup(t); const settings = f.store.settings(GUILD); settings.levels = { enabled: true, rewards: { 1: USERROLE } }; settings.dashboardAccess = { administrators: true, users: [TARGET] }; f.store.saveSettings(GUILD, settings);
    for (const input of [{ group: "__proto__", enabled: false }, { group: "media", enabled: "false" }, { administrators: "false" }, { administrators: true, group: "media" }]) await assert.rejects(request(OWNER, input), /Choose/);
    await request(OWNER, { group: "community", enabled: false });
    assert.deepEqual(f.store.settings(GUILD).levels, settings.levels); assert.deepEqual(f.store.settings(GUILD).dashboardAccess, settings.dashboardAccess);
    await assert.rejects(f.execute(",levels rank"), /Community & support is disabled/);
    await request(OWNER, { group: "community", enabled: true }); await f.execute(",levels rank");
});

test("Native AutoMod pauses only Sonata-owned enabled filters and resumes unchanged saved filters", async t => {
    const { f, request } = setup(t); await f.execute(",automod wordsadd spam");
    const owned = f.rules[0]; f.rules.push({ ...owned, id: "999999999999999999", creator_id: TARGET });
    await request(OWNER, { group: "security", enabled: false });
    assert.equal(f.rules[0].enabled, false); assert.equal(f.rules[1].enabled, true);
    await request(OWNER, { group: "security", enabled: true }); assert.equal(f.rules[0].enabled, true);
    await request(OWNER, { group: "security", enabled: false }); f.rules[0].trigger_metadata.keyword_filter.push("manually-edited");
    await request(OWNER, { group: "security", enabled: true }); assert.equal(f.rules[0].enabled, false);
});

test("Music off disconnects current playback and cancels pending music without cancelling video uploads", async t => {
    const { f, bot, request } = setup(t); f.voiceStates.set(BOT, { channel_id: CHANNEL }); bot.music.channels.set(GUILD, CHANNEL);
    let cancelled = false; bot.music.jobs.set("music", { job: { guild: GUILD, kind: "music" }, timer: setTimeout(() => assert.fail("Uncleared music timer"), 2000), resolve: () => { cancelled = true; } });
    bot.music.jobs.set("video", { job: { guild: GUILD, kind: "video" } });
    await request(OWNER, { group: "music", enabled: false });
    assert.equal(cancelled, true); assert.ok(bot.music.jobs.has("video")); assert.ok(!bot.music.jobs.has("music"));
    assert.ok(f.calls.some(call => call.method === "PATCH" && call.route === `/guilds/${GUILD}/members/${BOT}` && call.body.channel_id === null));
    await assert.rejects(f.execute(",play piano"), /Music & Last.fm is disabled/);
});

test("Incomplete native filter changes roll back without recording a disabled group", async t => {
    const { f, bot, request } = setup(t); await f.execute(",automod wordsadd spam"); await f.execute(",automod mentions 5");
    const original = bot.api; let writes = 0;
    bot.api = (route, options = {}) => { if (route.includes("auto-moderation/rules/") && options.method === "PATCH" && ++writes === 2) throw Error("Simulated provider failure"); return original(route, options); };
    await assert.rejects(request(OWNER, { group: "security", enabled: false }), /completed changes were restored/);
    assert.ok(f.rules.every(rule => rule.enabled)); assert.equal(f.store.settings(GUILD).disabledFeatures, undefined);
});

test("Disabled security/community automations and logging do not emit new actions or messages", async t => {
    const { f, request } = setup(t); let settings = f.store.settings(GUILD); settings.honeypots = { [CHANNEL]: "ban" }; settings.welcome = { [CHANNEL]: "Hi" }; settings.logChannel = CHANNEL; f.store.saveSettings(GUILD, settings);
    for (const group of ["security", "community", "logging"]) await request(OWNER, { group, enabled: false });
    const before = f.calls.length;
    await honeypotEvent({ guild_id: GUILD }, f.store, f.api, BOT, () => assert.fail("Disabled trap ran"));
    await communityEvent("MESSAGE_CREATE", { guild_id: GUILD, author: { id: TARGET }, content: "hello" }, f.store, f.api, BOT, new Map(), "off");
    const n = f.store.begin({ id: "case", guild: GUILD, actor: ACTOR }, "warn", TARGET, "test"); await caseLog(f.store, f.api, GUILD, n);
    assert.equal(f.calls.length, before);
});

test("Disabling manual moderation preserves scheduled release of an existing temporary ban", async t => {
    const { f, request } = setup(t); await f.execute(`,tempban ${TARGET} 1s test`);
    await request(OWNER, { group: "moderation", enabled: false });
    await assert.rejects(f.execute(`,warn ${TARGET} no`), /Moderation is disabled/);
    f.store.run("UPDATE jobs SET due=0 WHERE state='pending'"); await runDueJobs(f.store, f.api, BOT);
    assert.equal(f.bans.has(TARGET), false);
});

test("Paused giveaways do not delay automatic draws in other servers", async t => {
    const { f } = setup(t), paused = "222222222222222222";
    f.store.saveSettings(paused, { disabledFeatures: ["community"] });
    for (let i = 0; i < 3; i++) f.store.run("INSERT INTO giveaways (id,guild,channel,message,due,state,data) VALUES (?,?,?,?,0,'active',?)", String(i), i < 2 ? paused : GUILD, CHANNEL, "", JSON.stringify({ prize: "Test", count: 1, age: 0 }));
    await giveawayTimers(f.store, f.api);
    assert.equal(f.store.get("SELECT state FROM giveaways WHERE id='0'").state, "active");
    assert.equal(f.store.get("SELECT state FROM giveaways WHERE id='1'").state, "active");
    assert.equal(f.store.get("SELECT state FROM giveaways WHERE id='2'").state, "ended");
});
