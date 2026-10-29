/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { COMMANDS, parseSlash, slashCommands } from "../commands.mjs";
import { commandInsights } from "../commandInsights.mjs";
import { dashboardRequest, guildEvent } from "../dashboard.mjs";
import { PERMS } from "../discord.mjs";
import { basicRole } from "../memberTools.mjs";
import { executeCommand, perform } from "../moderation.mjs";
import { nicknameEvent, nicknameIssue } from "../nicknamePolicy.mjs";
import { ACTOR, BOT, CHANNEL, GUILD, MODROLE, OWNER, TARGET, USERROLE, fixture } from "./fixture.mjs";

const run = (f, content, actor = ACTOR, api = f.api) => executeCommand(f.command(content, actor), f.store, api, BOT);
const grant = (f, permission, role = MODROLE) => run(f, `,fakepermissions grant ${role} ${permission}`, OWNER);

test("Fake permissions grant only Sonata actions, support prefix and slash, and revoke immediately", async t => {
    const f = fixture(t);
    await grant(f, "ban");
    f.roles.find(role => role.id === MODROLE).permissions = "0";
    await run(f, `,ban ${TARGET} test`); assert(f.bans.has(TARGET));
    const command = { ...parseSlash({ name: "unban", options: [{ name: "user", value: TARGET }] }), id: "slash-unban", actor: ACTOR, guild: GUILD, channel: CHANNEL };
    await executeCommand(command, f.store, f.api, BOT); assert(!f.bans.has(TARGET));
    await assert.rejects(run(f, `,kick ${TARGET}`), /permissions/);
    await run(f, `,fakepermissions revoke ${MODROLE} ban`, OWNER);
    await assert.rejects(run(f, `,ban ${TARGET}`), /permissions/);
    assert.equal(f.roles.find(role => role.id === MODROLE).permissions, "0");
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM cases WHERE kind LIKE 'bot permission %'").n, 2);
    assert.equal(slashCommands().find(command => command.name === "ban").default_member_permissions, null);
    assert.equal(slashCommands().find(command => command.name === "fakepermissions").default_member_permissions, PERMS.ADMIN.toString());
});

test("Only native administrators grant access and cannot grant everyone, managed, automated or higher roles", async t => {
    const f = fixture(t);
    await assert.rejects(run(f, `,fakepermissions grant ${MODROLE} ban`), /permissions/);
    await assert.rejects(grant(f, "ban", GUILD), /ordinary staff role/);
    f.roles.find(role => role.id === USERROLE).managed = true;
    await assert.rejects(grant(f, "ban", USERROLE), /ordinary staff role/);
    f.roles.find(role => role.id === USERROLE).managed = false;
    const settings = f.store.settings(GUILD); settings.verification = { role: USERROLE, enabled: true }; f.store.saveSettings(GUILD, settings);
    await assert.rejects(grant(f, "ban", USERROLE), /verification/);
    f.roles.find(role => role.id === MODROLE).permissions = PERMS.ADMIN.toString();
    await assert.rejects(run(f, `,fakepermissions grant ${MODROLE} ban`), /below your own/);
});

test("Management commands stop when the bot loses Administrator even if the individual action permission remains", async t => {
    const f = fixture(t);
    f.roles.find(role => role.id === "666666666666666666").permissions = PERMS.KICK.toString();
    await assert.rejects(run(f, `,kick ${TARGET}`), /Administrator/);
    assert(f.members.has(TARGET)); assert.equal(f.store.get("SELECT COUNT(*) AS n FROM cases").n, 0);
});

test("Fake grants still enforce live roles, channel visibility, both hierarchies and the bot's native permissions", async t => {
    const f = fixture(t); await grant(f, "kick");
    f.roles.find(role => role.id === MODROLE).permissions = "0";
    f.roles.find(role => role.id === USERROLE).position = 25;
    await assert.rejects(run(f, `,kick ${TARGET}`), /Your highest role/);
    f.roles.find(role => role.id === USERROLE).position = 10;
    f.roles.find(role => role.id === MODROLE).position = 40;
    f.roles.find(role => role.id === USERROLE).position = 35;
    await assert.rejects(run(f, `,kick ${TARGET}`), /Bot's role/);
    f.roles.find(role => role.id === MODROLE).position = 20; f.roles.find(role => role.id === USERROLE).position = 10;
    f.roles.find(role => role.id === "666666666666666666").permissions = "0";
    await assert.rejects(run(f, `,kick ${TARGET}`), /permissions/);
    f.channels[0].permission_overwrites = [{ id: ACTOR, type: 1, allow: "0", deny: PERMS.VIEW.toString() }];
    await assert.rejects(run(f, `,kick ${TARGET}`), /permissions/);
    f.channels[0].permission_overwrites = []; f.members.get(ACTOR).roles = [];
    await assert.rejects(run(f, `,kick ${TARGET}`), /permissions/);
});

test("Fake-permission roles cannot be acquired through role commands, verification, rewards or recovery", async t => {
    const f = fixture(t); await grant(f, "kick", USERROLE);
    await assert.rejects(run(f, `,role add ${TARGET} ${USERROLE}`), /permissions/);
    await assert.rejects(run(f, `,autorole add ${USERROLE} humans`), /ordinary role/);
    await assert.rejects(run(f, `,verification setup ${USERROLE} 0`), /ordinary, unmanaged/);
    await assert.rejects(run(f, `,levels reward 1 ${USERROLE}`), /ordinary, unmanaged/);
    assert.throws(() => basicRole({ roles: f.roles, guild: f.guild, actor: f.members.get(ACTOR), bot: f.members.get(BOT), settings: f.store.settings(GUILD) }, USERROLE), /ordinary, unmanaged/);
});

test("Disabled commands cover aliases, slash and dashboard actions, while recovery controls stay available", async t => {
    const f = fixture(t); await grant(f, "ban");
    await run(f, ",commandsettings disable b");
    await assert.rejects(run(f, `,b ${TARGET}`), /disabled/);
    await assert.rejects(executeCommand({ ...f.command(`,ban ${TARGET}`), prefix: false }, f.store, f.api, BOT), /disabled/);
    await run(f, ",commandsettings enable ban");
    await run(f, ",commandsettings disable settings prefix");
    guildEvent("GUILD_CREATE", f.guild, f.store);
    const bot = { store: f.store, api: f.api, session: { userId: BOT }, env: {}, status: () => ({ connected: true }) };
    const request = new Request("https://bot.example/dashboard/action", { method: "POST", headers: { "X-Sonata-User": ACTOR }, body: JSON.stringify({ guild: GUILD, channel: CHANNEL, name: "settings", sub: "prefix", options: { prefix: "!" } }) });
    await assert.rejects(dashboardRequest(request, bot, command => executeCommand(command, f.store, f.api, BOT)), /disabled/);
    assert.equal(f.store.settings(GUILD).prefix, ",");
    for (const name of ["help", "dashboard", "fakepermissions", "commandsettings"]) await assert.rejects(run(f, `,commandsettings disable ${name}`), /stay available/);
});

test("Nickname policies normalize phrases, limit symbols, validate replacements and preserve exemptions", async t => {
    const f = fixture(t);
    await run(f, ",nicknamepolicy setup 2 Member"); await run(f, ",nicknamepolicy block admin");
    const config = f.store.settings(GUILD).nicknamePolicy;
    assert(nicknameIssue("ＡＤＭＩＮ", config)); assert(nicknameIssue("a\u200bdmin", config));
    assert(nicknameIssue("User!!!!", config)); assert.equal(nicknameIssue("Zoë 東京", config), "");
    await assert.rejects(run(f, ",nicknamepolicy block member"), /replacement nickname/);
    assert(!f.store.settings(GUILD).nicknamePolicy.words.includes("member"));
    await run(f, `,nicknamepolicy exempt ${USERROLE} on`); assert(f.store.settings(GUILD).nicknamePolicy.exempt.includes(USERROLE));
    await run(f, ",nicknamepolicy unblock admin"); assert(!f.store.settings(GUILD).nicknamePolicy.words.length);
});

test("Nickname events enforce fresh profiles once, record cases, and skip exemptions, screening and disabled policies", async t => {
    const f = fixture(t); await run(f, ",nicknamepolicy setup 2 Member"); await run(f, ",nicknamepolicy block admin");
    f.members.get(TARGET).nick = "Admin Support";
    const data = { guild_id: GUILD, user: { id: TARGET }, nick: "cached harmless name" };
    await nicknameEvent(data, f.store, f.api, BOT, "nickname:first", perform);
    assert.equal(f.members.get(TARGET).nick, "Member");
    assert.equal(f.store.get("SELECT kind FROM cases").kind, "nickname policy");
    await nicknameEvent(data, f.store, f.api, BOT, "nickname:echo", perform);
    assert.equal(f.calls.filter(call => call.method === "PATCH").length, 1);
    f.members.get(TARGET).nick = "Admin"; f.members.get(TARGET).pending = true;
    await nicknameEvent(data, f.store, f.api, BOT, "nickname:screening", perform); assert.equal(f.members.get(TARGET).nick, "Admin");
    f.members.get(TARGET).pending = false; await run(f, `,nicknamepolicy exempt ${USERROLE} on`);
    await nicknameEvent(data, f.store, f.api, BOT, "nickname:exempt", perform); assert.equal(f.members.get(TARGET).nick, "Admin");
    await run(f, `,nicknamepolicy exempt ${USERROLE} off`); await run(f, ",nicknamepolicy off");
    await nicknameEvent(data, f.store, f.api, BOT, "nickname:off", perform); assert.equal(f.members.get(TARGET).nick, "Admin");
});

test("Nickname enforcement respects bot hierarchy, reports permission issues and check only previews", async t => {
    const f = fixture(t); await run(f, ",nicknamepolicy setup 0 Member"); f.members.get(TARGET).nick = "Name!!!";
    const result = await run(f, `,nicknamepolicy check ${TARGET}`); assert.match(result.embeds[0].description, /more than 0/); assert.equal(f.members.get(TARGET).nick, "Name!!!");
    f.roles.find(role => role.id === USERROLE).position = 40;
    await nicknameEvent({ guild_id: GUILD, user: { id: TARGET } }, f.store, f.api, BOT, "nickname:high", perform);
    assert.equal(f.members.get(TARGET).nick, "Name!!!"); assert(f.store.settings(GUILD).nicknamePolicyError);
});

test("Command insights aggregate execution outcomes, do not double count replays, and isolate servers and time windows", async t => {
    const f = fixture(t), command = f.command(",ping");
    await executeCommand(command, f.store, f.api, BOT); await executeCommand(command, f.store, f.api, BOT);
    f.roles.find(role => role.id === MODROLE).permissions = "0";
    await assert.rejects(run(f, `,kick ${TARGET}`), /permissions/);
    f.store.outcome("999999999999999999", "private-command", "success");
    f.store.run("INSERT INTO command_results VALUES (?,?,?,?,?)", GUILD, "expired", "2020-01-01", "success", 100);
    const stats = commandInsights(f.store, GUILD, 30); assert.equal(stats.total, 2); assert.equal(stats.outcomes.success, 1); assert.equal(stats.outcomes.denied, 1); assert.equal(stats.failures[0].name, "kick");
    assert(!JSON.stringify(stats).includes(TARGET)); assert(!JSON.stringify(stats).includes("private-command"));
    f.store.cleanup(); assert.equal(f.store.get("SELECT n FROM command_results WHERE name='expired'"), undefined);
});

test("Command insights separate invalid input, service failures and moderation actions needing review", async t => {
    const f = fixture(t);
    await assert.rejects(run(f, ",commandsettings disable nonexistent"), /existing command/);
    await assert.rejects(run(f, ",serverinfo", ACTOR, async () => { throw new Error("Unavailable"); }), /Unavailable/);
    await run(f, `,kick ${TARGET}`, ACTOR, (route, options) => options?.method === "DELETE" ? Promise.reject(new Error("Discord unavailable")) : f.api(route, options));
    const stats = commandInsights(f.store, GUILD); assert.equal(stats.outcomes.invalid, 1); assert.equal(stats.outcomes.failed, 1); assert.equal(stats.outcomes.needs_review, 1);
    assert.match((await run(f, ",commandstats failures")).embeds[0].description, /kick/);
});

test("Dashboard exposes nickname, permission, command controls and aggregate insights with live administrator checks", async t => {
    const f = fixture(t); guildEvent("GUILD_CREATE", f.guild, f.store);
    const bot = { store: f.store, api: f.api, env: {}, session: { userId: BOT }, status: () => ({ connected: true }) };
    const request = (path, actor, input) => new Request(`https://bot.example/dashboard/${path}`, { method: input ? "POST" : "GET", headers: { "X-Sonata-User": actor }, body: input ? JSON.stringify(input) : undefined });
    const data = await dashboardRequest(request(`server?guild=${GUILD}`, ACTOR), bot, () => assert.fail());
    assert.equal(data.administrator, false); assert(data.commandNames.includes("nicknamepolicy setup")); assert.equal(data.insights.total, 0);
    const action = { guild: GUILD, channel: CHANNEL, name: "fakepermissions", sub: "grant", options: { role: USERROLE, permission: "kick" }, actor: OWNER };
    await assert.rejects(dashboardRequest(request("action", ACTOR, action), bot, command => executeCommand(command, f.store, f.api, BOT)), /permissions/);
    await dashboardRequest(request("action", OWNER, action), bot, command => executeCommand(command, f.store, f.api, BOT));
    assert.deepEqual(f.store.settings(GUILD).fakePermissions[USERROLE], ["kick"]);
    assert.equal(COMMANDS.length, 100); assert(COMMANDS.length <= 100);
});
