/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { COMMANDS, parsePrefix, parseSlash, slashCommands } from "../commands.mjs";
import { PERMS } from "../discord.mjs";
import { executeCommand } from "../moderation.mjs";
import { ACTOR, BOT, BOTROLE, CHANNEL, fixture, GUILD, MODROLE, TARGET, USERROLE } from "./fixture.mjs";

const VOICE = "999999999999999991", DESTINATION = "999999999999999992", EXTRA = "999999999999999993";
const writes = f => f.calls.filter(call => call.method && call.method !== "GET");
const voice = f => {
    f.channels.push({ id: VOICE, guild_id: GUILD, type: 2, permission_overwrites: [] }, { id: DESTINATION, guild_id: GUILD, type: 2, permission_overwrites: [] });
    f.voiceStates.set(TARGET, { user_id: TARGET, channel_id: VOICE });
};

test("New subcommands parse consistently for prefixes and slash commands", () => {
    const prefix = parsePrefix(`,role add ${TARGET} ${USERROLE} reviewed`, ",");
    const slash = parseSlash({ name: "role", options: [{ name: "add", options: [{ name: "member", value: TARGET }, { name: "role", value: USERROLE }, { name: "reason", value: "reviewed" }] }] });
    assert.deepEqual(prefix.options, slash.options); assert.equal(prefix.sub, slash.sub);
    assert.equal(parsePrefix(",purge 10 bots", ",").options.filter, "bots");
    assert.equal(parsePrefix(",help role add", ",").options.command, "role add");
    assert.throws(() => parsePrefix(`,softban ${TARGET} 8`, ","));
    assert.throws(() => parsePrefix(`,nickname ${TARGET} ${"a".repeat(33)}`, ","));
    assert.equal(slashCommands().find(command => command.name === "userinfo").default_member_permissions, null);
    assert.equal(slashCommands().find(command => command.name === "pin").default_member_permissions, PERMS.PINS.toString());
});

test("Help pages cover every command and show full subcommand syntax", async t => {
    const f = fixture(t), text = [];
    for (let page = 1; page <= Math.ceil(COMMANDS.length / 10); page++) text.push((await f.execute(`,help ${page}`)).embeds[0].description);
    for (const definition of COMMANDS) assert(text.join("\n").includes(`**${definition.name}**`));
    assert.match((await f.execute(",help role add")).embeds[0].description, /role add <member> <role> \[reason\]/);
});

test("Softban clears recent messages and leaves the member unbanned", async t => {
    const f = fixture(t); await f.execute(`,softban ${TARGET} 2 repeated spam`);
    assert.equal(f.bans.has(TARGET), false);
    assert.equal(f.calls.find(call => call.method === "PUT" && call.route.includes("/bans/")).body.delete_message_seconds, 172800);
    assert.equal(f.store.case(GUILD, 1).kind, "softban");
});

test("A failed softban release is marked for review rather than reported as success", async t => {
    const f = fixture(t); f.failUnban(1);
    await f.execute(`,softban ${TARGET} 1 spam`);
    assert(f.bans.has(TARGET)); assert.equal(f.store.case(GUILD, 1).status, "needs_review");
});

test("Ban listing uses a bounded page and rejects an invalid cursor", async t => {
    const f = fixture(t); f.bans.set(TARGET, { user: { id: TARGET, username: "Target" }, reason: "Review" });
    assert.match((await f.execute(",banlist")).embeds[0].description, /Target/);
    await assert.rejects(f.execute(",banlist nope"), /cursor/);
    assert.equal(writes(f).length, 0);
});

test("Nickname changes and resets are audited and respect hierarchy", async t => {
    const f = fixture(t); await f.execute(`,nick ${TARGET} New name`); assert.equal(f.members.get(TARGET).nick, "New name");
    await f.execute(`,nickname ${TARGET}`); assert.equal(f.members.get(TARGET).nick, null);
    f.roles.find(role => role.id === USERROLE).position = 40;
    await assert.rejects(f.execute(`,nickname ${TARGET} blocked`), /highest role/);
    assert.equal(f.store.all("SELECT * FROM cases").length, 2);
});

test("Clearing warnings keeps their evidence and creates an audit case", async t => {
    const f = fixture(t); await f.execute(`,warn ${TARGET} first`); await f.execute(`,warn ${TARGET} second`);
    f.store.addNote(GUILD, 1, ACTOR, "evidence", "Retained evidence");
    await f.execute(",warnremove 1 appealed");
    assert.equal(f.store.case(GUILD, 1).status, "cleared"); assert.equal(f.store.case(GUILD, 2).status, "completed");
    await f.execute(`,warnclear ${TARGET} reviewed`);
    assert.equal(f.store.case(GUILD, 2).status, "cleared");
    assert(f.store.all("SELECT * FROM notes WHERE kind='evidence'").some(note => note.value === "Retained evidence"));
    assert.match((await f.execute(`,warnings ${TARGET}`)).embeds[0].description, /No cases found/);
    assert.match((await f.execute(",case list")).embeds[0].description, /warnings cleared/);
});

test("Role creation and appearance changes never add permissions", async t => {
    const f = fixture(t); await f.execute(",role create Test role");
    const role = f.roles.at(-1); assert.equal(role.permissions, "0");
    await f.execute(`,role rename ${role.id} Renamed role`); assert.equal(role.name, "Renamed role");
    await f.execute(`,role color ${role.id} #a78bfa`); assert.equal(role.colors.primary_color, 0xa78bfa);
    await f.execute(`,role hoist ${role.id} on`); assert.equal(role.hoist, true);
    await f.execute(`,role mentionable ${role.id} off`); assert.equal(role.mentionable, false);
    await assert.rejects(f.execute(`,role color ${role.id} invalid`), /six-digit/);
    assert.equal(role.permissions, "0");
});

test("Role assignment adds and removes only the selected role", async t => {
    const f = fixture(t); f.roles.push({ id: EXTRA, name: "Extra", position: 2, permissions: "0" });
    await f.execute(`,role add ${TARGET} ${EXTRA}`); assert.deepEqual(f.members.get(TARGET).roles, [USERROLE, EXTRA]);
    await f.execute(`,role remove ${TARGET} ${EXTRA}`); assert.deepEqual(f.members.get(TARGET).roles, [USERROLE]);
});

test("Role changes reject managed roles, hierarchy bypasses and privilege escalation", async t => {
    const f = fixture(t), role = { id: EXTRA, name: "Extra", position: 2, permissions: PERMS.ADMIN.toString() }; f.roles.push(role);
    await assert.rejects(f.execute(`,role add ${TARGET} ${EXTRA}`), /permissions/);
    role.permissions = "0"; role.managed = true;
    await assert.rejects(f.execute(`,role rename ${EXTRA} blocked`), /ordinary role/);
    role.managed = false; role.position = 25;
    await assert.rejects(f.execute(`,role rename ${EXTRA} blocked`), /Your highest role/);
    role.position = 35; f.members.get(ACTOR).roles.push(BOTROLE);
    await assert.rejects(f.execute(`,role rename ${EXTRA} blocked`), /highest role/);
    assert.equal(writes(f).length, 0);
});

test("Jailed members cannot regain access through role assignment", async t => {
    const f = fixture(t); await f.execute(",jailsetup"); await f.execute(`,jail ${TARGET} spam`);
    await assert.rejects(f.execute(`,role add ${TARGET} ${USERROLE}`), /Release this member from jail/);
});

test("All voice actions use the intended member fields and create cases", async t => {
    const f = fixture(t); voice(f);
    await f.execute(`,voice move ${TARGET} ${DESTINATION}`); assert.equal(f.members.get(TARGET).channel_id, DESTINATION);
    await f.execute(`,voice mute ${TARGET}`); assert.equal(f.members.get(TARGET).mute, true);
    await f.execute(`,voice unmute ${TARGET}`); assert.equal(f.members.get(TARGET).mute, false);
    await f.execute(`,voice deafen ${TARGET}`); assert.equal(f.members.get(TARGET).deaf, true);
    await f.execute(`,voice undeafen ${TARGET}`); assert.equal(f.members.get(TARGET).deaf, false);
    await f.execute(`,voice disconnect ${TARGET}`); assert.equal(f.members.get(TARGET).channel_id, null);
    assert.equal(f.store.all("SELECT * FROM cases").length, 6);
});

test("Voice commands reject missing permissions and inaccessible destinations", async t => {
    const f = fixture(t); voice(f);
    f.roles.find(role => role.id === MODROLE).permissions = PERMS.VIEW.toString();
    await assert.rejects(f.execute(`,voice mute ${TARGET}`), /permissions/);
    f.roles.find(role => role.id === MODROLE).permissions = (PERMS.VIEW | PERMS.CONNECT | PERMS.MOVE).toString();
    f.channels.at(-1).permission_overwrites = [{ id: ACTOR, type: 1, allow: "0", deny: PERMS.VIEW.toString() }];
    await assert.rejects(f.execute(`,voice move ${TARGET} ${DESTINATION}`), /permissions/);
    assert.equal(writes(f).length, 0);
});

test("Channel updates change only the selected setting", async t => {
    const f = fixture(t); voice(f);
    await f.execute(",channel name renamed"); assert.equal(f.channels[0].name, "renamed");
    await f.execute(",channel topic A new topic"); assert.equal(f.channels[0].topic, "A new topic");
    await f.execute(",channel topic"); assert.equal(f.channels[0].topic, "");
    await f.execute(",channel nsfw on"); assert.equal(f.channels[0].nsfw, true);
    await f.execute(`,channel userlimit ${VOICE} 12`); assert.equal(f.channels[1].user_limit, 12);
});

test("Pin and unpin use the current API and reject another channel's link", async t => {
    const f = fixture(t); f.messages.push({ id: EXTRA, author: { id: TARGET }, pinned: false });
    await f.execute(`,pin https://discord.com/channels/${GUILD}/${CHANNEL}/${EXTRA}`); assert.equal(f.messages[0].pinned, true);
    assert.match((await f.execute(",pins")).embeds[0].description, new RegExp(EXTRA));
    await f.execute(`,unpin ${EXTRA}`); assert.equal(f.messages[0].pinned, false);
    await assert.rejects(f.execute(`,pin https://discord.com/channels/${GUILD}/${VOICE}/${EXTRA}`), /from this channel/);
    assert(f.calls.some(call => call.method === "PUT" && call.route.includes("/messages/pins/")));
});

test("Filtered cleanup keeps pinned messages unless explicitly selected", async t => {
    const f = fixture(t), id = age => String(BigInt(Date.now() - age - 1420070400000) << 22n);
    f.messages.push({ id: id(1000), author: { id: BOT, bot: true }, pinned: true }, { id: id(2000), author: { id: BOT, bot: true } }, { id: id(3000), author: { id: TARGET }, content: "https://example.com" });
    await f.execute(",purge 10 bots");
    assert.match(f.store.case(GUILD, 1).detail, /Deleted 1/);
    assert(f.calls.some(call => call.method === "DELETE" && call.route.endsWith(f.messages[1].id)));
    await f.execute(",purge 10 pinned"); assert.match(f.store.case(GUILD, 2).detail, /Deleted 1/);
});

test("Information commands use current server data and keep hidden channel details private", async t => {
    const f = fixture(t);
    assert.match((await f.execute(`,userinfo ${TARGET}`)).embeds[0].description, new RegExp(TARGET));
    assert.match((await f.execute(",membercount")).embeds[0].description, /123/);
    assert.match((await f.execute(",serverinfo")).embeds[0].description, /Test server|Owner/);
    assert.match((await f.execute(`,roleinfo ${USERROLE}`)).embeds[0].description, /Full permission value/);
    assert.match((await f.execute(",roles")).embeds[0].description, new RegExp(USERROLE));
    assert.match((await f.execute(`,avatar ${TARGET}`)).embeds[0].image.url, /^https:\/\/cdn\.discordapp\.com\//);
    assert.equal((await f.execute(`,banner ${TARGET}`)).embeds[0].title, "No banner");
    f.channels.push({ id: EXTRA, name: "Private", guild_id: GUILD, type: 0, permission_overwrites: [{ id: ACTOR, type: 1, allow: "0", deny: PERMS.VIEW.toString() }] });
    await assert.rejects(f.execute(`,channelinfo ${EXTRA}`), /permissions/);
    assert.equal(writes(f).length, 0);
});
