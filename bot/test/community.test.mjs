/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { COMMANDS, parsePrefix, parseSlash } from "../commands.mjs";
import { communityEvent } from "../communityEvents.mjs";
import { PERMS } from "../discord.mjs";
import { executeCommand } from "../moderation.mjs";
import { ACTOR, BOT, CHANNEL, fixture, GUILD, MODROLE, TARGET, USERROLE } from "./fixture.mjs";

const posts = f => f.calls.filter(call => call.method === "POST" && call.route.endsWith("/messages"));
const joined = f => ({ guild_id: GUILD, user: { ...f.members.get(TARGET).user, username: "New member" } });

test("The catalogue contains 282 runnable forms and new prefix/slash options agree", () => {
    assert.equal(COMMANDS.reduce((n, command) => n + (command.options[0]?.type === 1 ? command.options.length : 1), 0), 282);
    const prefix = parsePrefix(',welcome add <#888888888888888888> Welcome {username}', ",");
    const slash = parseSlash({ name: "welcome", options: [{ name: "add", options: [{ name: "channel", value: CHANNEL }, { name: "message", value: "Welcome {username}" }] }] });
    assert.deepEqual(prefix.options, slash.options);
});

test("Ping reports measured API and Gateway timings and never invents missing measurements", async t => {
    const f = fixture(t), command = f.command(",ping"); command.latency = { api: 44, gateway: 21 };
    const result = await executeCommand(command, f.store, f.api, BOT);
    assert.match(result.embeds[0].description, /44 ms/); assert.match(result.embeds[0].description, /21 ms/);
    assert.match((await f.execute(",ping")).embeds[0].description, /Not measured yet/);
});

test("Tags have create, edit, info, list, show and delete operations scoped to a server", async t => {
    const f = fixture(t); await f.execute(",tag create rules Be kind");
    assert.match((await f.execute(",tag show rules")).embeds[0].description, /Be kind/);
    await f.execute(",tag edit rules No spam");
    assert.match((await f.execute(",tag info rules")).embeds[0].description, new RegExp(ACTOR));
    assert.match((await f.execute(",tag list")).embeds[0].description, /rules/);
    assert.equal(f.store.settings("999999999999999999").tags, undefined);
    await f.execute(",tag delete rules"); await assert.rejects(f.execute(",tag show rules"), /does not exist/);
    await assert.rejects(f.execute(",tag create __proto__ blocked"), /tag name/);
});

test("Ordinary members can read tags but cannot change tags or automation settings", async t => {
    const f = fixture(t); await f.execute(",tag create rules Be kind");
    f.roles.find(role => role.id === MODROLE).permissions = PERMS.VIEW.toString();
    assert.match((await f.execute(",tag show rules")).embeds[0].description, /Be kind/);
    await assert.rejects(f.execute(",tag edit rules blocked"), /permissions/);
    await assert.rejects(f.execute(",welcome list"), /permissions/);
});

test("Automatic replies match exact human text, deduplicate events and apply a guild cooldown", async t => {
    const f = fixture(t), cooldowns = new Map(); await f.execute(',autoresponder add "hello there" Hello {username}');
    const message = { guild_id: GUILD, channel_id: CHANNEL, author: { ...f.members.get(TARGET).user, username: "Target" }, content: "Hello There" };
    await communityEvent("MESSAGE_CREATE", { ...message, content: "not hello there" }, f.store, f.api, BOT, cooldowns, "event1"); assert.equal(posts(f).length, 0);
    await communityEvent("MESSAGE_CREATE", message, f.store, f.api, BOT, cooldowns, "event2"); assert.equal(posts(f).length, 1);
    assert.match(posts(f)[0].body.embeds[0].description, /Hello Target/); assert.deepEqual(posts(f)[0].body.allowed_mentions.parse, []);
    await communityEvent("MESSAGE_CREATE", message, f.store, f.api, BOT, cooldowns, "event3"); assert.equal(posts(f).length, 1);
    cooldowns.clear(); await communityEvent("MESSAGE_CREATE", message, f.store, f.api, BOT, cooldowns, "event2"); assert.equal(posts(f).length, 1);
    cooldowns.clear(); await communityEvent("MESSAGE_CREATE", { ...message, author: { id: BOT, bot: true } }, f.store, f.api, BOT, cooldowns, "event4"); assert.equal(posts(f).length, 1);
    await f.execute(',autoresponder update "hello there" Changed');
    assert.match((await f.execute(',autoresponder view "hello there"')).embeds[0].description, /Changed/);
    await f.execute(',autoresponder remove "hello there"'); assert.match((await f.execute(",autoresponder list")).embeds[0].description, /No replies/);
});

test("Welcome, goodbye and member logs post configured messages without notifications", async t => {
    const f = fixture(t); await f.execute(`,welcome add ${CHANNEL} Welcome {username} to {server}`); await f.execute(`,goodbye add ${CHANNEL} Bye {id}`); await f.execute(`,joinlogs set ${CHANNEL}`);
    await communityEvent("GUILD_MEMBER_ADD", joined(f), f.store, f.api, BOT, new Map(), "joined1");
    assert.equal(posts(f).length, 2); assert.match(posts(f)[0].body.embeds[0].description, /Welcome New member to Test server/);
    await communityEvent("GUILD_MEMBER_REMOVE", joined(f), f.store, f.api, BOT, new Map(), "left1"); assert.equal(posts(f).length, 4);
    assert(posts(f).every(post => post.body.allowed_mentions.parse.length === 0));
    await f.execute(`,welcome test ${CHANNEL}`); assert.equal(posts(f).length, 5);
    await f.execute(`,welcome remove ${CHANNEL}`); await f.execute(",joinlogs off");
    assert.match((await f.execute(",welcome list")).embeds[0].description, /No messages/);
});

test("Autoroles and nicknames apply only while enabled and skip privileged or jailed roles", async t => {
    const f = fixture(t); await f.execute(`,autorole add ${USERROLE} humans`); await f.execute(",autonick set Guest-{username}");
    f.members.get(TARGET).roles = [];
    await communityEvent("GUILD_MEMBER_ADD", joined(f), f.store, f.api, BOT, new Map(), "join1");
    assert(f.members.get(TARGET).roles.includes(USERROLE)); assert.equal(f.members.get(TARGET).nick, "Guest-New member");
    await f.execute(",autorole disable"); f.members.get(TARGET).roles = [];
    await communityEvent("GUILD_MEMBER_ADD", joined(f), f.store, f.api, BOT, new Map(), "join2"); assert.equal(f.members.get(TARGET).roles.length, 0);
    await f.execute(",autorole enable"); f.roles.find(role => role.id === USERROLE).permissions = PERMS.ADMIN.toString();
    await communityEvent("GUILD_MEMBER_ADD", joined(f), f.store, f.api, BOT, new Map(), "join3"); assert.equal(f.members.get(TARGET).roles.length, 0);
    f.roles.find(role => role.id === USERROLE).permissions = "0"; f.store.saveRestriction(GUILD, TARGET, "jail", { roles: [], overwrites: [] });
    await communityEvent("GUILD_MEMBER_ADD", joined(f), f.store, f.api, BOT, new Map(), "join4"); assert.equal(f.members.get(TARGET).roles.length, 0);
});

test("Autorole setup rejects moderation permissions and channel configuration rejects foreign channels", async t => {
    const f = fixture(t); f.roles.find(role => role.id === USERROLE).permissions = PERMS.BAN.toString();
    await assert.rejects(f.execute(`,autorole add ${USERROLE} all`), /without moderation/);
    f.channels[0].guild_id = "999999999999999999";
    await assert.rejects(f.execute(`,welcome add ${CHANNEL} blocked`), /channel in this server|Use a channel in this server/);
});

test("Autoroles wait for membership screening and do not reapply after an unrelated update", async t => {
    const f = fixture(t); await f.execute(`,autorole add ${USERROLE} humans`);
    f.members.get(TARGET).roles = []; f.members.get(TARGET).pending = true;
    await communityEvent("GUILD_MEMBER_ADD", joined(f), f.store, f.api, BOT, new Map(), "pending1");
    assert.equal(f.members.get(TARGET).roles.length, 0); assert(f.store.get("SELECT * FROM onboarding WHERE target=?", TARGET));
    f.members.get(TARGET).pending = false;
    await communityEvent("GUILD_MEMBER_UPDATE", { ...joined(f), pending: false }, f.store, f.api, BOT, new Map(), "screened1");
    assert(f.members.get(TARGET).roles.includes(USERROLE)); assert.equal(f.store.get("SELECT * FROM onboarding WHERE target=?", TARGET), undefined);
    assert.equal(posts(f).length, 0);
});

test("Native polls create a bounded poll and display results without fabricating unavailable counts", async t => {
    const f = fixture(t); await f.execute(',poll create "Pick a colour" Red|Blue');
    const poll = posts(f)[0].body.poll; assert.equal(poll.answers.length, 2); assert.equal(poll.duration, 24);
    f.messages.push({ id: TARGET, poll: { question: { text: "Pick" }, answers: [{ answer_id: 1, poll_media: { text: "Red" } }] } });
    assert.match((await f.execute(`,poll results ${TARGET}`)).embeds[0].description, /not provided/);
    f.messages[0].poll.results = { is_finalized: false, answer_counts: [{ id: 1, count: 3 }] };
    assert.match((await f.execute(`,poll results ${TARGET}`)).embeds[0].description, /Red: 3/);
    await assert.rejects(f.execute(',poll create Question OnlyOne'), /two to ten/);
});

test("Utility commands validate bounds and return meaningful values", async t => {
    const f = fixture(t);
    assert(["Red", "Blue"].includes((await f.execute(",choose Red|Blue")).embeds[0].description));
    assert.match((await f.execute(",roll 2d6")).embeds[0].description, /= \*\*\d+/);
    await assert.rejects(f.execute(",roll 99d9999"), /one to twenty/);
    assert(["Heads", "Tails"].includes((await f.execute(",coinflip")).embeds[0].description));
    assert((await f.execute(",8ball Will it work")).embeds[0].description);
    assert.match((await f.execute(",timestamp 1700000000")).embeds[0].description, /<t:1700000000:F>/);
    assert.match((await f.execute(`,snowflake ${TARGET}`)).embeds[0].description, /Created/);
    assert.equal((await f.execute(",servericon")).embeds[0].title, "No image");
    assert.equal((await f.execute(",serverbanner")).embeds[0].title, "No image");
    assert.match((await f.execute(",boosts")).embeds[0].description, /Level: 0/);
    f.messages.push({ id: TARGET }); assert.match((await f.execute(",firstmessage")).embeds[0].description, new RegExp(TARGET));
});

test("AutoMod exceptions preserve words, allowed words and unrelated rule settings", async t => {
    const f = fixture(t); await f.execute(",automod wordsadd bad"); await f.execute(",automod allowadd good");
    await f.execute(",automod wordsadd worse"); assert.deepEqual(f.rules[0].trigger_metadata.allow_list, ["good"]);
    await f.execute(`,automod exemptrole words ${USERROLE} on`); await f.execute(`,automod exemptchannel words ${CHANNEL} on`);
    assert.deepEqual(f.rules[0].exempt_roles, [USERROLE]); assert.deepEqual(f.rules[0].exempt_channels, [CHANNEL]);
    assert.match((await f.execute(",automod words")).embeds[0].description, /good/);
    assert.match((await f.execute(",automod config")).embeds[0].description, /Exempt roles: 1/);
    await f.execute(",automod allowremove good"); assert.deepEqual(f.rules[0].trigger_metadata.allow_list, []);
});
