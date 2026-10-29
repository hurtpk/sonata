/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parsePrefix, parseSlash } from "../commands.mjs";
import { channelPermissions, PERMS } from "../discord.mjs";
import { featureAction, featureForm } from "../featureInteractions.mjs";
import { genuineControl, consumeForm } from "../interactionUI.mjs";
import { executeCommand } from "../moderation.mjs";
import { protectionEvent } from "../protection.mjs";
import { perform, commandContext } from "../moderation.mjs";
import { expireWarnings } from "../escalation.mjs";
import { giveawayTimers } from "../giveaways.mjs";
import { runDueJobs } from "../jobs.mjs";
import { ACTOR, BOT, BOTROLE, CHANNEL, GUILD, MODROLE, OWNER, TARGET, USERROLE, fixture } from "./fixture.mjs";

const CATEGORY = "888888888888888889";
const run = (f, text, actor = ACTOR, channel = CHANNEL, api = f.api) => executeCommand({ ...f.command(text, actor), channel }, f.store, api, BOT);
const auditId = index => String((BigInt(Date.now() - 1420070400000) << 22n) + BigInt(index));
let interaction = 700000000000000000n;
const click = (message, id, actor = ACTOR, guild = GUILD) => ({ id: String(++interaction), type: 3, guild_id: guild, channel_id: message.channel_id ?? CHANNEL, member: guild ? { user: { id: actor } } : undefined, user: guild ? undefined : { id: actor }, message, data: { custom_id: id, component_type: 2 } });
const submit = (source, form, value) => ({ ...source, id: String(++interaction), type: 5, data: { custom_id: form.data.custom_id, components: [{ type: 18, component: { type: 4, custom_id: "value", value } }] } });

test("New server command syntax is shared by prefix and slash commands", () => {
    assert.deepEqual(parsePrefix(`,antiraid setup ${CHANNEL} 5 30 24 alert`, ",").options, parseSlash({ name: "antiraid", options: [{ name: "setup", options: [{ name: "channel", value: CHANNEL }, { name: "joins", value: 5 }, { name: "seconds", value: 30 }, { name: "age", value: 24 }, { name: "action", value: "alert" }] }] }).options);
    assert.throws(() => parsePrefix(`,antiraid setup ${CHANNEL} 1 30 24 alert`, ","), /valid joins/);
    assert.throws(() => parsePrefix(",giveaway start 1h 99 prize", ","), /valid winners/);
});

test("Join alerts are off by default, count distinct arrivals, and deduplicate replayed events", async t => {
    const f = fixture(t), arrival = { guild_id: GUILD, user: { id: TARGET }, joined_at: new Date().toISOString() };
    await protectionEvent("GUILD_MEMBER_ADD", arrival, f.store, f.api, BOT, perform);
    assert.equal(f.postedMessages.length, 0);
    await assert.rejects(run(f, `,antiraid setup ${CHANNEL} 3 30 0 alert`, ACTOR), /permissions/);
    await run(f, `,antiraid setup ${CHANNEL} 3 30 0 alert`, OWNER);
    for (let i = 0; i < 3; i++) await protectionEvent("GUILD_MEMBER_ADD", { ...arrival, user: { id: String(BigInt(TARGET) + BigInt(i)) } }, f.store, f.api, BOT, perform);
    assert.equal(f.postedMessages.length, 1); assert.match(f.postedMessages[0].embeds[0].description, /3 joins/);
    await protectionEvent("GUILD_MEMBER_ADD", arrival, f.store, f.api, BOT, perform);
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM security_events").n, 3);
    await run(f, ",antiraid clear", OWNER); assert.equal(f.store.restriction(GUILD, GUILD, "raid"), null);
});

test("Raid quarantine uses the existing jail and schedules its release without changing earlier arrivals", async t => {
    const f = fixture(t);
    await assert.rejects(run(f, `,antiraid setup ${CHANNEL} 3 30 0 quarantine`, OWNER), /jailsetup/);
    await run(f, ",jailsetup"); await run(f, `,antiraid setup ${CHANNEL} 3 30 0 quarantine`, OWNER);
    for (let i = 1; i <= 3; i++) await protectionEvent("GUILD_MEMBER_ADD", { guild_id: GUILD, user: { id: i === 3 ? TARGET : String(BigInt(TARGET) + BigInt(i)) }, joined_at: new Date().toISOString() }, f.store, f.api, BOT, perform);
    assert(f.store.restriction(GUILD, TARGET, "jail"));
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM cases WHERE kind='raid quarantine'").n, 1);
    const job = f.store.get("SELECT * FROM jobs WHERE target=?", TARGET); assert.equal(job.kind, "jail");
    f.store.run("UPDATE jobs SET due=0 WHERE id=?", job.id); await runDueJobs(f.store, f.api, BOT);
    assert.equal(f.store.restriction(GUILD, TARGET, "jail"), null);
});

test("Anti-nuke configuration is owner-only and confirmed audit thresholds remove only dangerous roles", async t => {
    const f = fixture(t);
    await assert.rejects(run(f, `,antinuke setup ${CHANNEL} 2 30 strip`), /server owner/);
    await run(f, `,antinuke setup ${CHANNEL} 2 30 strip`, OWNER);
    const event = { guild_id: GUILD, user_id: ACTOR, target_id: TARGET, action_type: 22 };
    await protectionEvent("GUILD_AUDIT_LOG_ENTRY_CREATE", { ...event, id: auditId(1) }, f.store, f.api, BOT, perform);
    assert(f.members.get(ACTOR).roles.includes(MODROLE));
    const second = { ...event, id: auditId(2) };
    await protectionEvent("GUILD_AUDIT_LOG_ENTRY_CREATE", second, f.store, f.api, BOT, perform);
    assert.deepEqual(f.members.get(ACTOR).roles, []);
    assert.equal(f.store.get("SELECT status FROM cases").status, "completed");
    await protectionEvent("GUILD_AUDIT_LOG_ENTRY_CREATE", second, f.store, f.api, BOT, perform);
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM cases").n, 1);
    await run(f, `,antinuke restore ${ACTOR}`, OWNER); assert(f.members.get(ACTOR).roles.includes(MODROLE));
});

test("Anti-nuke preserves owners, trusted accounts, higher roles and changed role snapshots", async t => {
    const f = fixture(t); await run(f, `,antinuke setup ${CHANNEL} 2 30 strip`, OWNER);
    await run(f, `,antinuke trust ${ACTOR} on`, OWNER);
    for (let i = 0; i < 3; i++) await protectionEvent("GUILD_AUDIT_LOG_ENTRY_CREATE", { id: auditId(i), guild_id: GUILD, user_id: ACTOR, action_type: 12 }, f.store, f.api, BOT, perform);
    assert(f.members.get(ACTOR).roles.includes(MODROLE));
    f.store.saveRestriction(GUILD, ACTOR, "antinuke", { roles: [{ id: MODROLE, permissions: "0" }] });
    await assert.rejects(run(f, `,antinuke restore ${ACTOR}`, OWNER), /deleted, changed/);
    await run(f, `,antinuke trust ${ACTOR} off`, OWNER);
    f.roles.find(role => role.id === MODROLE).position = 40;
    for (let i = 4; i < 6; i++) await protectionEvent("GUILD_AUDIT_LOG_ENTRY_CREATE", { id: auditId(i), guild_id: GUILD, user_id: ACTOR, action_type: 32 }, f.store, f.api, BOT, perform);
    assert(f.members.get(ACTOR).roles.includes(MODROLE)); assert.equal(f.store.get("SELECT status FROM cases").status, "needs_review");
});

test("Event logs use audit changes and voice channel changes without recording ordinary messages", async t => {
    const f = fixture(t); await run(f, `,eventlog set roles ${CHANNEL}`); await run(f, `,eventlog set voice ${CHANNEL}`);
    await protectionEvent("GUILD_AUDIT_LOG_ENTRY_CREATE", { id: auditId(9), guild_id: GUILD, user_id: ACTOR, target_id: USERROLE, action_type: 31, changes: [{ key: "name", old_value: "Old role", new_value: "New role" }] }, f.store, f.api, BOT, perform);
    assert.match(f.postedMessages[0].embeds[0].description, /Old role.*New role/);
    await protectionEvent("GUILD_CREATE", { id: GUILD, voice_states: [{ user_id: TARGET, channel_id: CATEGORY }] }, f.store, f.api, BOT, perform);
    await protectionEvent("VOICE_STATE_UPDATE", { guild_id: GUILD, user_id: TARGET, channel_id: CATEGORY, self_mute: true }, f.store, f.api, BOT, perform);
    assert.equal(f.postedMessages.length, 1);
    await protectionEvent("VOICE_STATE_UPDATE", { guild_id: GUILD, user_id: TARGET, channel_id: CHANNEL }, f.store, f.api, BOT, perform);
    assert.equal(f.postedMessages.length, 2);
    await run(f, ",eventlog off voice"); assert.equal(f.store.get("SELECT COUNT(*) AS n FROM voice_activity").n, 0);
});

test("Warning rules trigger only at a configured active count and preserve expiry history", async t => {
    const f = fixture(t); await run(f, ",escalation set 3 timeout 1h", OWNER);
    for (let i = 0; i < 3; i++) await run(f, `,warn ${TARGET} warning ${i}`);
    assert(Date.parse(f.members.get(TARGET).communication_disabled_until) > Date.now());
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM cases WHERE kind='warning escalation timeout'").n, 1);
    await run(f, `,warn ${TARGET} fourth warning`);
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM cases WHERE kind='warning escalation timeout'").n, 1);
    await run(f, ",escalation expiry 1", OWNER);
    f.store.run("UPDATE cases SET at=0 WHERE kind='warn'"); expireWarnings(f.store, GUILD, TARGET);
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM cases WHERE kind='warn' AND status='expired'").n, 4);
    assert(f.store.all("SELECT * FROM notes").some(row => row.kind === "warning escalation"));
});

test("Warning exemptions prevent configured automatic bans", async t => {
    const f = fixture(t); await run(f, ",escalation set 1 ban", OWNER); await run(f, `,escalation exempt ${USERROLE} on`, OWNER);
    await run(f, `,warn ${TARGET} test`); assert.equal(f.bans.size, 0);
    await run(f, ",escalation remove 1", OWNER); assert.match((await run(f, ",escalation view", OWNER)).embeds[0].description, /No automatic actions/);
});

test("Ban appeals open from a pre-ban DM, bind forms to the banned user, and let staff approve a matching ban", async t => {
    const f = fixture(t); await run(f, `,appeals setup ${CHANNEL}`); await run(f, `,ban ${TARGET} original evidence`);
    const dm = f.postedMessages.find(message => message.embeds?.[0].title === "Sonata ban notice"); assert(dm);
    const dmIndex = f.calls.findIndex(call => call.route.endsWith("/messages") && call.body?.embeds?.[0].title === "Ban requested"), banIndex = f.calls.findIndex(call => call.method === "PUT" && call.route.includes("/bans/")); assert(dmIndex < banIndex);
    const source = click(dm, dm.components[0].components[0].custom_id, TARGET, undefined); delete source.guild_id; source.user = { id: TARGET }; source.member = undefined;
    assert(genuineControl(source, BOT)); const form = featureForm(source, f.store);
    const wrong = submit({ ...source, user: { id: ACTOR } }, form, "Forged"); assert.throws(() => consumeForm(wrong, f.store), /expired/);
    await featureAction(submit(source, form, "Please review my evidence."), f.store, f.api, BOT);
    assert.equal(f.store.get("SELECT status FROM appeals").status, "pending");
    await assert.rejects(featureAction(submit(source, form, "Replay"), f.store, f.api, BOT), /expired/);
    const review = f.postedMessages.find(message => message.embeds?.[0].title === "Ban appeal · case #1"), approve = review.components[0].components[0].custom_id;
    await assert.rejects(featureAction(click(review, approve, TARGET), f.store, f.api, BOT), /permissions/);
    await featureAction(click(review, approve), f.store, f.api, BOT);
    assert.equal(f.bans.has(TARGET), false); assert.equal(f.store.get("SELECT status FROM appeals").status, "approved");
});

test("Appeal approval keeps a newer ban and records the failed review", async t => {
    const f = fixture(t); await run(f, `,appeals setup ${CHANNEL}`); await run(f, `,ban ${TARGET} original`);
    const dm = f.postedMessages.find(message => message.embeds?.[0].title === "Sonata ban notice"), source = click(dm, dm.components[0].components[0].custom_id, TARGET); delete source.guild_id; source.member = undefined; source.user = { id: TARGET };
    await featureAction(submit(source, featureForm(source, f.store), "Please review"), f.store, f.api, BOT);
    f.bans.get(TARGET).reason = "A newer manual ban";
    const review = f.postedMessages.find(message => message.embeds?.[0].title === "Ban appeal · case #1");
    await assert.rejects(featureAction(click(review, review.components[0].components[0].custom_id), f.store, f.api, BOT), /different ban/);
    assert.equal(f.bans.get(TARGET).reason, "A newer manual ban"); assert.equal(f.store.get("SELECT status FROM appeals").status, "needs_review");
});

test("Tickets are private, enforce staff controls, and save actual transcript files before closing", async t => {
    const f = fixture(t); f.channels.push({ id: CATEGORY, guild_id: GUILD, type: 4, permission_overwrites: [] });
    await run(f, `,ticket setup ${CATEGORY} ${MODROLE} ${CHANNEL}`); await run(f, ",ticket open need help", TARGET);
    const row = f.store.get("SELECT * FROM tickets"), channel = f.channels.find(channel => channel.id === row.channel);
    assert.equal(BigInt(channel.permission_overwrites.find(value => value.id === GUILD).deny) & PERMS.VIEW, PERMS.VIEW);
    await assert.rejects(run(f, ",ticket open second", TARGET), /already have/);
    await assert.rejects(run(f, ",ticket claim", TARGET, row.channel), /support staff/);
    await run(f, ",ticket claim", ACTOR, row.channel); assert.equal(f.store.get("SELECT claimed FROM tickets").claimed, ACTOR);
    f.messages.push({ id: "123456789012345678", author: { id: TARGET, username: "Member" }, content: "My evidence", attachments: [{ filename: "evidence.png", url: "https://cdn.discordapp.com/attachments/test" }] });
    await run(f, ",ticket close", TARGET, row.channel);
    assert.equal(f.store.get("SELECT state FROM tickets").state, "closed");
    const upload = f.calls.find(call => call.form && call.route === `/channels/${CHANNEL}/messages`); assert(upload);
    const transcript = JSON.parse(await upload.form.get("files[0]").text()); assert.equal(transcript.messages[0].content, "My evidence"); assert.equal(transcript.messages[0].attachments[0].name, "evidence.png");
    assert.equal(channelPermissions(f.members.get(TARGET), f.roles, f.guild, channel) & PERMS.SEND, 0n);
    await run(f, ",ticket reopen", ACTOR, row.channel); assert.equal(f.store.get("SELECT state FROM tickets").state, "open");
});

test("Failed ticket transcript delivery keeps the ticket open and unchanged", async t => {
    const f = fixture(t); f.channels.push({ id: CATEGORY, guild_id: GUILD, type: 4, permission_overwrites: [] });
    await run(f, `,ticket setup ${CATEGORY} ${MODROLE} ${CHANNEL}`); await run(f, ",ticket open help", TARGET);
    const row = f.store.get("SELECT * FROM tickets"), failing = (route, options = {}) => { if (options.form) throw new Error("Upload unavailable"); return f.api(route, options); };
    await assert.rejects(run(f, ",ticket close", TARGET, row.channel, failing), /Upload unavailable/);
    assert.equal(f.store.get("SELECT state FROM tickets").state, "open");
});

test("Ticket panel modals create a ticket once and expire when replayed", async t => {
    const f = fixture(t); f.channels.push({ id: CATEGORY, guild_id: GUILD, type: 4, permission_overwrites: [] });
    await run(f, `,ticket setup ${CATEGORY} ${MODROLE} ${CHANNEL}`); await run(f, `,ticket panel ${CHANNEL}`);
    const panel = f.postedMessages.at(-1), source = click(panel, panel.components[0].components[0].custom_id, TARGET), form = featureForm(source, f.store), submission = submit(source, form, "Support question");
    await featureAction(submission, f.store, f.api, BOT); assert.equal(f.store.get("SELECT COUNT(*) AS n FROM tickets").n, 1);
    await assert.rejects(featureAction(submission, f.store, f.api, BOT), /expired/);
});

test("Giveaway buttons enforce entry eligibility and persist a draw before retrying a failed announcement", async t => {
    const f = fixture(t); await run(f, ',giveaway start 1h 1 "Example prize"');
    const row = f.store.get("SELECT * FROM giveaways"), card = f.postedMessages.find(message => message.id === row.message), entryId = card.components[0].components[0].custom_id;
    await featureAction(click(card, entryId, TARGET), f.store, f.api, BOT);
    await featureAction(click(card, entryId, TARGET), f.store, f.api, BOT);
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM giveaway_entries").n, 1);
    f.store.run("UPDATE giveaways SET due=0 WHERE id=?", row.id);
    const failing = (route, options = {}) => { if (options.method === "PATCH" && route.includes("/messages/")) throw new Error("Message unavailable"); return f.api(route, options); };
    await giveawayTimers(f.store, failing);
    const ended = f.store.get("SELECT * FROM giveaways"); assert.equal(ended.state, "ended"); assert.deepEqual(JSON.parse(ended.data).winners, [TARGET]); assert.equal(ended.dirty, 1);
    await giveawayTimers(f.store, f.api); assert.equal(f.store.get("SELECT dirty FROM giveaways").dirty, 0);
    assert.deepEqual(JSON.parse(f.store.get("SELECT data FROM giveaways").data).history, [TARGET]);
    await assert.rejects(featureAction(click(card, entryId, TARGET), f.store, f.api, BOT), /ended/);
});

test("Giveaway role checks are repeated at drawing, leavers can withdraw and rerolls exclude prior winners", async t => {
    const f = fixture(t); await run(f, `,giveaway start 1h 1 Prize ${USERROLE} 0`);
    let row = f.store.get("SELECT * FROM giveaways"), card = f.postedMessages.find(message => message.id === row.message);
    await assert.rejects(featureAction(click(card, card.components[0].components[0].custom_id, ACTOR), f.store, f.api, BOT), /requirements/);
    await featureAction(click(card, card.components[0].components[0].custom_id, TARGET), f.store, f.api, BOT);
    await featureAction(click(card, card.components[0].components[1].custom_id, TARGET), f.store, f.api, BOT); assert.equal(f.store.get("SELECT COUNT(*) AS n FROM giveaway_entries").n, 0);
    await featureAction(click(card, card.components[0].components[0].custom_id, TARGET), f.store, f.api, BOT);
    f.members.get(TARGET).roles = [];
    await run(f, `,giveaway end ${row.message}`); assert.deepEqual(JSON.parse(f.store.get("SELECT data FROM giveaways").data).winners, []);
    f.members.get(TARGET).roles = [USERROLE]; await run(f, `,giveaway reroll ${row.message}`); assert.deepEqual(JSON.parse(f.store.get("SELECT data FROM giveaways").data).winners, [TARGET]);
    await run(f, `,giveaway reroll ${row.message}`); assert.deepEqual(JSON.parse(f.store.get("SELECT data FROM giveaways").data).winners, []);
});

test("Voice panel forms recheck room membership and ownership at submission", async t => {
    const f = fixture(t); f.roles.find(role => role.id === USERROLE).permissions = PERMS.CONNECT.toString();
    f.channels.push({ id: CATEGORY, guild_id: GUILD, type: 2, name: "Room", permission_overwrites: [] }); f.voiceStates.set(TARGET, { channel_id: CATEGORY });
    f.store.run("INSERT INTO voice_rooms VALUES (?,?,?,?)", GUILD, CATEGORY, TARGET, JSON.stringify({ members: [TARGET] }));
    const response = await run(f, ",voicemaster room", TARGET), message = { id: "123456789012345679", author: { id: BOT }, channel_id: CHANNEL, ...response };
    const rename = message.components.flatMap(row => row.components).find(value => value.custom_id.endsWith(":name"));
    const source = click(message, rename.custom_id, TARGET), form = featureForm(source, f.store);
    f.store.run("UPDATE voice_rooms SET owner=? WHERE channel=?", OWNER, CATEGORY);
    await assert.rejects(featureAction(submit(source, form, "Stolen room"), f.store, f.api, BOT), /owner or server management/);
    assert.equal(f.channels.find(channel => channel.id === CATEGORY).name, "Room");
    assert.equal(genuineControl({ ...source, message: { ...message, author: { id: TARGET } } }, BOT), false);
});
