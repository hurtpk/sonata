/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { COMMANDS, parseDuration, parsePrefix, parseSlash, slashCommands } from "../commands.mjs";
import { channelPermissions, PERMS } from "../discord.mjs";
import { runDueJobs } from "../jobs.mjs";
import { executeCommand } from "../moderation.mjs";
import { maintainJail } from "../restrictions.mjs";
import { ACTOR, BOT, CHANNEL, fixture, full, GUILD, MODROLE, OWNER, TARGET, USERROLE } from "./fixture.mjs";

test("Prefix and slash commands share validated names, options and aliases", () => {
    const prefix = parsePrefix(`,tban <@${TARGET}> 2h spam links`, ",");
    const slash = parseSlash({ name: "tempban", options: [{ name: "member", value: TARGET }, { name: "duration", value: "2h" }, { name: "reason", value: "spam links" }] });
    assert.equal(prefix.name, slash.name); assert.deepEqual(prefix.options, slash.options);
    assert.equal(parsePrefix(",settings prefix !", ",").sub, "prefix");
    assert.equal(parsePrefix(",case note 12 repeated warnings", ",").options.note, "repeated warnings");
    assert.equal(parsePrefix(`,jail ${TARGET} repeated spam`, ",").options.reason, "repeated spam");
    assert.equal(parsePrefix(`,jail ${TARGET} 2h repeated spam`, ",").options.duration, "2h");
    assert.equal(parsePrefix("hello", ","), null);
    assert.throws(() => parsePrefix(",purge 101", ","));
    assert.throws(() => parsePrefix(",ban nope", ","));
    assert.equal(slashCommands().length, COMMANDS.length);
    assert.equal(new Set(slashCommands().map(command => command.name)).size, COMMANDS.length);
});

test("Durations reject invalid, overflowing and excessive values", () => {
    assert.equal(parseDuration("1h30m"), 5400000);
    for (const value of ["0s", "-1h", "infinity", "1y", "99999999999999999w"]) assert.throws(() => parseDuration(value));
    assert.throws(() => parseDuration("29d", 28 * 86400_000));
});

test("Moderation requires the actor's permissions and both role hierarchies", async t => {
    const f = fixture(t);
    f.roles.find(role => role.id === MODROLE).permissions = PERMS.TIMEOUT.toString();
    await assert.rejects(f.execute(`,ban ${TARGET} reason`), /permissions/);
    f.roles.find(role => role.id === MODROLE).permissions = full.toString();
    f.roles.find(role => role.id === USERROLE).position = 40;
    await assert.rejects(f.execute(`,ban ${TARGET} reason`), /Your highest role/);
    await assert.rejects(executeCommand(f.command(`,ban ${TARGET} reason`, OWNER), f.store, f.api, BOT), /Bot's role/);
    assert.equal(f.bans.size, 0); assert.equal(f.store.all("SELECT * FROM cases").length, 0);
});

test("A ban creates a case and a replay cannot repeat the action", async t => {
    const f = fixture(t), command = f.command(`,ban ${TARGET} repeated spam`);
    await executeCommand(command, f.store, f.api, BOT); await executeCommand(command, f.store, f.api, BOT);
    assert(f.bans.has(TARGET)); assert.equal(f.store.case(GUILD, 1).status, "completed");
    assert.equal(f.calls.filter(call => call.method === "PUT" && call.route.includes("/bans/")).length, 1);
    assert.match(f.bans.get(TARGET).reason, /Sonata case/);
});

test("Member case lookups and notes are scoped to the current guild", async t => {
    const f = fixture(t);
    f.store.begin({ id: "other-case", guild: "999999999999999999", actor: ACTOR }, "warn", TARGET, "Private other-server note");
    await assert.rejects(f.execute(",case view 1"), /does not exist in this server/);
    await f.execute(`,warn ${TARGET} first warning`);
    await f.execute(",case note 1 Staff follow-up");
    await f.execute(",case reason 1 Corrected reason");
    assert.equal(f.store.case(GUILD, 1).reason, "Corrected reason");
    assert.equal(f.store.all("SELECT * FROM notes WHERE guild=?", GUILD).length, 2);
});

test("Timed bans release only the bot's matching ban, including after a retry", async t => {
    const f = fixture(t);
    await f.execute(`,tempban ${TARGET} 1h temporary`);
    f.store.run("UPDATE jobs SET due=0"); f.failUnban(1);
    await runDueJobs(f.store, f.api, BOT); assert(f.bans.has(TARGET));
    f.store.run("UPDATE jobs SET due=0");
    await runDueJobs(f.store, f.api, BOT);
    assert(!f.bans.has(TARGET)); assert.equal(f.store.case(GUILD, 2).kind, "automatic unban");
    assert.equal(f.store.get("SELECT state FROM jobs").state, "completed");
});

test("A later manual ban is kept when an older temporary ban expires", async t => {
    const f = fixture(t);
    await f.execute(`,tempban ${TARGET} 1h original`);
    f.bans.get(TARGET).reason = "A later ban by another moderator";
    f.store.run("UPDATE jobs SET due=0"); await runDueJobs(f.store, f.api, BOT);
    assert(f.bans.has(TARGET)); assert.equal(f.store.get("SELECT state FROM jobs").state, "cancelled");
});

test("Channel unlock restores only Sonata's permission bits", async t => {
    const f = fixture(t);
    f.channels[0].permission_overwrites.push({ id: GUILD, type: 0, allow: PERMS.SEND.toString(), deny: "0" });
    await f.execute(",lock raid");
    const overwrite = f.channels[0].permission_overwrites.find(value => value.id === GUILD);
    assert(BigInt(overwrite.deny) & PERMS.SEND);
    assert(channelPermissions(f.members.get(BOT), f.roles, f.guild, f.channels[0]) & PERMS.SEND);
    overwrite.deny = (BigInt(overwrite.deny) | PERMS.HISTORY).toString();
    await f.execute(",unlock clear");
    assert(BigInt(overwrite.allow) & PERMS.SEND); assert(BigInt(overwrite.deny) & PERMS.HISTORY);
    assert.equal(BigInt(overwrite.deny) & PERMS.SEND, 0n);
});

test("Purge keeps old messages and records the completed count", async t => {
    const f = fixture(t), snowflake = age => String((BigInt(Date.now() - age - 1420070400000) << 22n));
    f.messages.push({ id: snowflake(1000), author: { id: TARGET } }, { id: snowflake(2000), author: { id: TARGET } }, { id: snowflake(20 * 86400_000), author: { id: TARGET } });
    await f.execute(",purge 3");
    assert.equal(f.calls.find(call => call.route.endsWith("bulk-delete")).body.messages.length, 2);
    assert.match(f.store.case(GUILD, 1).detail, /Deleted 2/);
});

test("Jail saves roles, blocks channel access, and restores the roles on release", async t => {
    const f = fixture(t);
    await f.execute(",jailsetup");
    await f.execute(`,jail ${TARGET} spam`);
    const target = f.members.get(TARGET), settings = f.store.settings(GUILD);
    assert(target.roles.includes(settings.jailRole)); assert(!target.roles.includes(USERROLE));
    assert.equal(channelPermissions(target, f.roles, f.guild, f.channels[0]) & PERMS.VIEW, 0n);
    await f.execute(`,unjail ${TARGET} reviewed`);
    assert(target.roles.includes(USERROLE)); assert(!target.roles.includes(settings.jailRole));
    assert.equal(f.store.restriction(GUILD, TARGET, "jail"), null);
});

test("Prefix purge excludes its invoking command from the requested cleanup count", async t => {
    const f = fixture(t), snowflake = age => String((BigInt(Date.now() - age - 1420070400000) << 22n));
    const command = f.command(",purge 1"); command.id = snowflake(1000);
    const message = snowflake(2000);
    f.messages.push({ id: command.id, author: { id: ACTOR } }, { id: message, author: { id: TARGET } });
    await executeCommand(command, f.store, f.api, BOT);
    const deletions = f.calls.filter(call => call.method === "DELETE");
    assert.equal(deletions.length, 1); assert.equal(deletions[0].route, `/channels/${CHANNEL}/messages/${message}`);
});

test("A moderator cannot restore saved jail roles above their own position", async t => {
    const f = fixture(t); await f.execute(",jailsetup"); await f.execute(`,jail ${TARGET} spam`);
    f.roles.find(role => role.id === USERROLE).position = 25;
    const response = await f.execute(`,unjail ${TARGET} reviewed`);
    assert.match(response.embeds[0].description, /Your highest role/);
    assert(f.store.restriction(GUILD, TARGET, "jail"));
});

test("AutoMod only creates and edits rules owned by Sonata", async t => {
    const f = fixture(t);
    f.rules.push({ id: "999999999999999998", creator_id: TARGET, name: "Other bot", enabled: true, trigger_metadata: { keyword_filter: ["existing"] } });
    await f.execute(",automod wordsadd *blocked*");
    const ours = f.rules.find(rule => rule.creator_id === BOT);
    assert.deepEqual(ours.trigger_metadata.keyword_filter, ["*blocked*"]);
    await f.execute(",automod wordsremove *blocked*");
    assert.equal(f.rules.length, 1); assert.equal(f.rules[0].name, "Other bot");
});

test("Jail follows new channels with explicit member allows and restores them on release", async t => {
    const f = fixture(t); await f.execute(",jailsetup"); await f.execute(`,jail ${TARGET} spam`);
    const channel = { id: "999999999999999999", guild_id: GUILD, type: 0, permission_overwrites: [{ id: TARGET, type: 1, allow: PERMS.VIEW.toString(), deny: "0" }] };
    f.channels.push(channel);
    await maintainJail("CHANNEL_CREATE", structuredClone(channel), f.store, f.api, BOT);
    assert.equal(channelPermissions(f.members.get(TARGET), f.roles, f.guild, channel) & PERMS.VIEW, 0n);
    await f.execute(`,unjail ${TARGET} reviewed`);
    assert(channelPermissions(f.members.get(TARGET), f.roles, f.guild, channel) & PERMS.VIEW);
});

test("A non-administrator cannot restore a saved role that later gained administrator", async t => {
    const f = fixture(t); await f.execute(",jailsetup"); await f.execute(`,jail ${TARGET} spam`);
    f.roles.find(role => role.id === USERROLE).permissions = PERMS.ADMIN.toString();
    const response = await f.execute(`,unjail ${TARGET} reviewed`);
    assert.match(response.embeds[0].description, /administrator must restore/);
    assert(f.store.restriction(GUILD, TARGET, "jail"));
});
