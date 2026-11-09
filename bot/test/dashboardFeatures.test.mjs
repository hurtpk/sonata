/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { COMMANDS, expandAlias, parsePrefix } from "../commands.mjs";
import { dashboardRequest, enforceGuildBlock, guildEvent } from "../dashboard.mjs";
import { PERMS } from "../discord.mjs";
import { featureAction, featureForm } from "../featureInteractions.mjs";
import { levelFor, memberActivity } from "../levels.mjs";
import { moderationStats } from "../memberTools.mjs";
import { executeCommand, perform } from "../moderation.mjs";
import { ticketDetails, ticketTimers } from "../ticketExtras.mjs";
import { ACTOR, BOT, BOTROLE, CHANNEL, GUILD, MODROLE, OWNER, TARGET, USERROLE, fixture } from "./fixture.mjs";

const CATEGORY = "888888888888888889", ALT = "888888888888888890";
let serial = 650000000000000000n;
const run = (f, content, actor = ACTOR, channel = CHANNEL, api = f.api) => executeCommand({ ...f.command(content, actor), channel }, f.store, api, BOT);
const message = (content, author = TARGET, mentions = []) => ({ id: String(++serial), guild_id: GUILD, channel_id: CHANNEL, author: { id: author }, content, mentions });

test("Ticket Master creates categories and private text channels with Discord permissions enforced", async t => {
    const f = fixture(t), bot = { store: f.store, api: f.api, session: { userId: BOT }, env: {} };
    guildEvent("GUILD_CREATE", f.guild, f.store);
    const create = (actor, sub, options) => dashboardRequest(new Request("https://bot.example/dashboard/action", {
        method: "POST", headers: { "X-Sonata-User": actor },
        body: JSON.stringify({ guild: GUILD, name: "ticket-space", sub, options }),
    }), bot);
    const limitedRole = f.roles.find(role => role.id === USERROLE);
    limitedRole.permissions = PERMS.GUILD.toString();
    await assert.rejects(create(TARGET, "category", { name: "Support" }), /permissions required/);
    limitedRole.permissions = (PERMS.GUILD | PERMS.CHANNELS).toString();
    const { channel: category } = await create(TARGET, "category", { name: "Support" });
    assert.equal(category.type, 4);
    const options = { name: "transcripts", parent: category.id, visibility: "staff", role: MODROLE };
    await assert.rejects(create(TARGET, "text", options), /permissions required/);
    await assert.rejects(create(OWNER, "text", { ...options, role: GUILD }), /Choose a staff role/);
    await assert.rejects(create(OWNER, "text", { ...options, parent: CHANNEL }), /Choose a category/);
    const { channel } = await create(OWNER, "text", options);
    const created = f.channels.find(entry => entry.id === channel.id);
    assert.equal(created.parent_id, category.id);
    assert.deepEqual(created.permission_overwrites, [
        { id: GUILD, type: 0, allow: "0", deny: PERMS.VIEW.toString() },
        { id: MODROLE, type: 0, allow: (PERMS.VIEW | PERMS.HISTORY).toString(), deny: "0" },
    ]);
    assert.equal(f.store.settings(GUILD).tickets, undefined);
});

test("Ticket manager lists and updates saved panels, removes only its own panels, and protects live tickets", async t => {
    const f = fixture(t), bot = { store: f.store, api: f.api, session: { userId: BOT }, env: {} };
    guildEvent("GUILD_CREATE", f.guild, f.store);
    f.channels.push({ id: CATEGORY, guild_id: GUILD, type: 4, name: "Support", permission_overwrites: [] });
    await run(f, `,ticket setup ${CATEGORY} ${MODROLE} ${CHANNEL}`);
    await run(f, `,ticket panel ${CHANNEL}`);
    const first = f.store.settings(GUILD).tickets.panel;
    await run(f, `,ticket panel ${CHANNEL}`);
    assert.equal(f.store.settings(GUILD).tickets.panels.length, 2);
    await run(f, ",ticket intake commission");
    const manage = (sub, message = first.message, actor = ACTOR) => dashboardRequest(new Request("https://bot.example/dashboard/action", {
        method: "POST", headers: { "X-Sonata-User": actor },
        body: JSON.stringify({ guild: GUILD, name: "ticket-manage", sub, options: { message } }),
    }), bot);
    await assert.rejects(manage("panel-update", first.message, TARGET));
    await assert.rejects(manage("panel-delete", "123456789012345678"), /saved ticket panel/);
    await manage("panel-update");
    assert.equal(f.postedMessages.find(row => row.id === first.message).embeds[0].title, "Commission inquiries");
    await assert.rejects(manage("reset"), /Remove the saved ticket panels/);
    await manage("panel-delete");
    assert.equal(f.store.settings(GUILD).tickets.panels.length, 1);
    await manage("panel-delete", f.store.settings(GUILD).tickets.panel.message);
    const channelCount = f.channels.length;
    f.store.run("INSERT INTO tickets (id,guild,owner,channel,state,at) VALUES (?,?,?,?,?,?)", "active-test", GUILD, TARGET, CHANNEL, "open", Date.now());
    await assert.rejects(manage("reset"), /Archive existing/);
    f.store.run("UPDATE tickets SET state='archived' WHERE id='active-test'");
    await manage("reset");
    assert.equal(f.store.settings(GUILD).tickets, undefined);
    assert.equal(f.channels.length, channelCount);
    assert.equal(f.store.get("SELECT id FROM tickets WHERE id='active-test'").id, "active-test");
});

test("Only the server owner can preview and apply presets, and a stale preview never overwrites settings", async t => {
    const f = fixture(t), bot = { store: f.store, api: f.api, session: { userId: BOT }, env: {} };
    guildEvent("GUILD_CREATE", f.guild, f.store);
    f.members.get(ACTOR).roles = [BOTROLE];
    const input = { guild: GUILD, channel: CHANNEL, preset: "strict", profile: "music" };
    const request = (actor, body) => dashboardRequest(new Request("https://bot.example/dashboard/setup-presets", { method: "POST", headers: { "X-Sonata-User": actor }, body: JSON.stringify(body) }), bot);
    await assert.rejects(request(ACTOR, input), { status: 403 });
    const preview = await request(OWNER, input);
    assert.equal(preview.applied, false);
    assert.equal(f.store.settings(GUILD).antiraid, undefined);
    f.store.saveSettings(GUILD, { ...f.store.settings(GUILD), antiraid: { enabled: false }, prefix: "!" });
    await assert.rejects(request(OWNER, { ...input, review: preview.review }), { status: 409 });
    const review = await request(OWNER, input);
    const applied = await request(OWNER, { ...input, review: review.review });
    assert.equal(applied.applied, true);
    const settings = f.store.settings(GUILD);
    assert.equal(settings.prefix, "!");
    assert.equal(settings.logChannel, CHANNEL);
    assert.equal(settings.antiraid.age, 72);
    assert.deepEqual(settings.escalation[3], { action: "timeout", duration: 1_800_000 });
    assert.deepEqual(settings.music, { mode: "dj", threshold: 75 });
    assert.equal(f.postedMessages.length, 0);
});

test("Command conflict checks explain shadows, disabled targets and impossible channel rules", async t => {
    const f = fixture(t), bot = { store: f.store, api: f.api, env: {} };
    guildEvent("GUILD_CREATE", f.guild, f.store);
    f.store.saveSettings(GUILD, {
        ...f.store.settings(GUILD), aliases: { ping: "ban", example: "ban" }, disabledCommands: ["ban"],
        commandRules: [
            { command: "settings", kind: "channel", target: CHANNEL, mode: "allow" },
            { command: "settings dm", kind: "channel", target: ALT, mode: "allow" },
            { command: "settings dm", kind: "channel", target: CHANNEL, mode: "deny" },
        ],
    });
    const result = await dashboardRequest(new Request("https://bot.example/dashboard/command-conflicts?guild=" + GUILD, { headers: { "X-Sonata-User": ACTOR } }), bot);
    assert(result.issues.some(issue => issue.subject === "ping" && issue.kind === "Shortcut shadows a command"));
    assert(result.issues.some(issue => issue.subject === "example" && issue.kind === "Shortcut points to a disabled command"));
    assert(result.issues.some(issue => issue.subject === "settings dm" && issue.kind === "No channel can satisfy these rules"));
    assert(result.issues.some(issue => issue.subject === "settings dm" && issue.kind === "Allow and deny overlap"));
});
const click = (card, custom_id, actor = TARGET, values) => ({ id: String(++serial), type: 3, guild_id: GUILD, channel_id: card.channel_id, member: { user: { id: actor } }, message: card, data: { custom_id, component_type: values ? 3 : 2, ...(values ? { values } : {}) } });

test("Verification grants only the configured basic role after live age, screening and jail checks", async t => {
    const f = fixture(t); f.members.get(TARGET).roles = [];
    await run(f, `,verification setup ${USERROLE} 0`); await run(f, `,verification panel ${CHANNEL}`);
    const card = f.postedMessages.at(-1), control = card.components[0].components[0].custom_id;
    await featureAction(click(card, control), f.store, f.api, BOT); assert(f.members.get(TARGET).roles.includes(USERROLE));
    f.members.get(TARGET).roles = []; f.members.get(TARGET).pending = true;
    await assert.rejects(featureAction(click(card, control), f.store, f.api, BOT), /screening/);
    f.members.get(TARGET).pending = false; f.store.saveRestriction(GUILD, TARGET, "jail", {});
    await assert.rejects(featureAction(click(card, control), f.store, f.api, BOT), /jailed/);
});

test("Verification refuses a role that gained moderation permissions after configuration", async t => {
    const f = fixture(t); f.members.get(TARGET).roles = [];
    await run(f, `,verification setup ${USERROLE} 0`); await run(f, `,verification panel ${CHANNEL}`);
    f.roles.find(role => role.id === USERROLE).permissions = PERMS.BAN.toString();
    const card = f.postedMessages.at(-1);
    await assert.rejects(featureAction(click(card, card.components[0].components[0].custom_id), f.store, f.api, BOT), /ordinary, unmanaged/);
    assert.deepEqual(f.members.get(TARGET).roles, []);
});

test("XP persists its cooldown, ignores commands, and awards cumulative safe roles without saving messages", async t => {
    const f = fixture(t), cooldowns = new Map(); f.members.get(TARGET).roles = [];
    assert.equal(levelFor(99), 0); assert.equal(levelFor(100), 1); assert.equal(levelFor(300), 2);
    await run(f, ",levels enable"); await run(f, `,levels reward 1 ${USERROLE}`);
    f.store.run("INSERT INTO xp VALUES (?,?,?,?)", GUILD, TARGET, 95, 0);
    await memberActivity(message("A normal message"), f.store, f.api, BOT, cooldowns);
    const xp = f.store.get("SELECT * FROM xp WHERE guild=? AND user=?", GUILD, TARGET); assert(xp.xp >= 110 && xp.xp <= 120); assert(f.members.get(TARGET).roles.includes(USERROLE));
    await memberActivity(message("Second message"), f.store, f.api, BOT, new Map()); assert.equal(f.store.get("SELECT xp FROM xp WHERE user=?", TARGET).xp, xp.xp);
    f.store.run("UPDATE xp SET last=0"); await memberActivity(message(",ping"), f.store, f.api, BOT, cooldowns); assert.equal(f.store.get("SELECT xp FROM xp WHERE user=?", TARGET).xp, xp.xp);
    assert(!Object.hasOwn(xp, "content")); assert.match((await run(f, `,levels rank ${TARGET}`)).embeds[0].description, /Level 1/);
});

test("Level rewards skip roles that became privileged while XP remains saved", async t => {
    const f = fixture(t); f.members.get(TARGET).roles = [];
    await run(f, ",levels enable"); await run(f, `,levels reward 1 ${USERROLE}`);
    f.roles.find(role => role.id === USERROLE).permissions = PERMS.ROLES.toString(); f.store.run("INSERT INTO xp VALUES (?,?,95,0)", GUILD, TARGET);
    await memberActivity(message("Hello community"), f.store, f.api, BOT, new Map());
    assert.deepEqual(f.members.get(TARGET).roles, []); assert(f.store.get("SELECT xp FROM xp WHERE user=?", TARGET).xp > 95); assert(f.store.settings(GUILD).levelsError);
});

test("AFK messages notify mentions with a cooldown and clear only the returning author's status", async t => {
    const f = fixture(t), cooldowns = new Map();
    await run(f, ",afk at lunch", TARGET); assert.equal(f.store.get("SELECT message FROM afk WHERE user=?", TARGET).message, "at lunch");
    await memberActivity(message(",afk set at lunch"), f.store, f.api, BOT, cooldowns); assert(f.store.get("SELECT user FROM afk WHERE user=?", TARGET));
    await memberActivity(message("Are you there?", ACTOR, [{ id: TARGET }]), f.store, f.api, BOT, cooldowns); assert.match(f.postedMessages.at(-1).embeds[0].description, /at lunch/);
    const count = f.postedMessages.length; await memberActivity(message("Again?", ACTOR, [{ id: TARGET }]), f.store, f.api, BOT, cooldowns); assert.equal(f.postedMessages.length, count);
    await memberActivity(message("I am back"), f.store, f.api, BOT, cooldowns); assert.equal(f.store.get("SELECT user FROM afk WHERE user=?", TARGET), undefined);
});

test("Custom aliases preserve original command permissions and cannot shadow native commands or recurse", async t => {
    const f = fixture(t); await run(f, ",alias set silence timeout");
    const content = expandAlias(`,silence ${ACTOR} 1h`, ",", f.store.settings(GUILD).aliases), parsed = parsePrefix(content, ","); assert.equal(parsed.name, "timeout");
    await assert.rejects(executeCommand({ ...parsed, id: String(++serial), guild: GUILD, channel: CHANNEL, actor: TARGET }, f.store, f.api, BOT), /permissions/);
    await assert.rejects(run(f, ",alias set ping timeout"), /existing command/);
    await assert.rejects(run(f, ",alias set nested silence"), /existing command/);
    await run(f, ",tag create rules Be kind"); await run(f, ",alias set rules tag show rules");
    assert.equal(parsePrefix(expandAlias(",rules", ",", f.store.settings(GUILD).aliases), ",").options.name, "rules");
});

test("Moderation statistics use recorded cases, respect the period and stay scoped to one server", async t => {
    const f = fixture(t); await run(f, `,warn ${TARGET} first`); await run(f, `,warn ${TARGET} second`);
    const data = moderationStats(f.store, GUILD, 30); assert.equal(data.total, 2); assert.equal(data.actions.warn, 2); assert.equal(data.staff[ACTOR], 2); assert.equal(data.totalUses, 2);
    assert.equal(moderationStats(f.store, ALT, 30).total, 0);
    f.store.run("UPDATE cases SET at=0 WHERE n=1"); assert.equal(moderationStats(f.store, GUILD, 7).total, 1);
});

test("Regex previews remain bounded, native filters preserve unrelated settings, and profiles use interaction blocking", async t => {
    const f = fixture(t);
    const body = await run(f, `,automod preview "(a+)+$" ${"a".repeat(999)}!`); assert.match(body.embeds[0].description, /No match/); assert.equal(f.rules.length, 0);
    await run(f, ',automod regexadd "(?i)spam"'); const rule = f.rules[0]; rule.exempt_roles = [USERROLE]; rule.trigger_metadata.keyword_filter = ["other"];
    await run(f, ',automod regexadd "scam"'); assert.deepEqual(rule.exempt_roles, [USERROLE]); assert.deepEqual(rule.trigger_metadata.keyword_filter, ["other"]);
    await run(f, ",automod profileadd scammer"); const profile = f.rules.find(value => value.trigger_type === 6); assert.equal(profile.event_type, 2); assert.equal(profile.actions[0].type, 4);
    await run(f, ',automod regexremove "scam"'); assert.deepEqual(rule.trigger_metadata.regex_patterns, ["(?i)spam"]);
});

test("Lockdown restores only its unchanged permission bits and keeps unrelated manual edits", async t => {
    const f = fixture(t); await run(f, ",lockdown start all incident");
    const everyone = f.channels[0].permission_overwrites.find(value => value.id === GUILD); assert(BigInt(everyone.deny) & PERMS.SEND);
    everyone.deny = (BigInt(everyone.deny) | PERMS.ATTACH).toString();
    await run(f, ",lockdown restore"); assert.equal(BigInt(everyone.deny) & PERMS.SEND, 0n); assert.equal(BigInt(everyone.deny) & PERMS.ATTACH, PERMS.ATTACH); assert.equal(f.store.restriction(GUILD, GUILD, "lockdown"), null);
    await run(f, ",lockdown start all incident"); everyone.allow = PERMS.SEND.toString(); everyone.deny = (BigInt(everyone.deny) & ~PERMS.SEND).toString();
    await run(f, ",lockdown restore"); assert.equal(BigInt(everyone.allow) & PERMS.SEND, PERMS.SEND);
});

test("Interrupted lockdowns retain permission snapshots for a safe recovery", async t => {
    const f = fixture(t), failing = (route, options) => { if (route.endsWith(`/permissions/${GUILD}`)) throw new Error("Discord unavailable"); return f.api(route, options); };
    const result = await run(f, ",lockdown start all incident", ACTOR, CHANNEL, failing); assert.match(result.content, /^Error code: S\d+$/); assert.match(f.store.get("SELECT detail FROM command_failures ORDER BY id DESC LIMIT 1").detail, /needs review/); assert(f.store.restriction(GUILD, GUILD, "lockdown"));
    await run(f, ",lockdown restore"); assert.equal(f.store.restriction(GUILD, GUILD, "lockdown"), null);
});

test("Ticket types route to their support role, priorities and assignments persist, and idle reminders do not close tickets", async t => {
    const f = fixture(t); f.channels.push({ id: CATEGORY, guild_id: GUILD, type: 4, permission_overwrites: [] }, { id: ALT, guild_id: GUILD, type: 4, permission_overwrites: [] });
    await run(f, `,ticket setup ${CATEGORY} ${MODROLE} ${CHANNEL}`); await run(f, `,ticket categoryadd reports ${ALT} ${MODROLE}`); await run(f, `,ticket panel ${CHANNEL}`);
    const card = f.postedMessages.at(-1), source = click(card, card.components[1].components[0].custom_id, TARGET, ["reports"]), form = featureForm(source, f.store);
    await featureAction({ ...source, type: 5, id: String(++serial), data: { custom_id: form.data.custom_id, components: [{ type: 18, component: { custom_id: "value", value: "A report" } }] } }, f.store, f.api, BOT);
    const row = f.store.get("SELECT * FROM tickets"); assert.equal(f.channels.find(value => value.id === row.channel).parent_id, ALT);
    await run(f, ",ticket priority urgent", ACTOR, row.channel); await run(f, `,ticket assign ${ACTOR}`, ACTOR, row.channel); assert.equal(ticketDetails(f.store, row).priority, "urgent");
    await run(f, `,ticket idle 1 ${CHANNEL}`); const details = ticketDetails(f.store, row); details.last = 0; f.store.run("UPDATE ticket_details SET data=? WHERE id=?", JSON.stringify(details), row.id);
    await ticketTimers(f.store, f.api); const count = f.postedMessages.length; await ticketTimers(f.store, f.api); assert.equal(f.postedMessages.length, count); assert.equal(f.store.get("SELECT state FROM tickets").state, "open");
});

test("Bot registry stores only selected metadata and distinguishes unavailable servers from departures", t => {
    const f = fixture(t); guildEvent("READY", { guilds: [{ id: GUILD }] }, f.store); guildEvent("GUILD_CREATE", { ...f.guild, member_count: 20, members: [{ user: { id: TARGET } }], channels: [{ id: CHANNEL }] }, f.store);
    let row = f.store.get("SELECT * FROM bot_guilds"); assert.equal(row.active, 1); assert.equal(JSON.parse(row.data).members, undefined); assert.equal(JSON.parse(row.data).channels, undefined);
    guildEvent("GUILD_DELETE", { id: GUILD, unavailable: true }, f.store); assert.equal(f.store.get("SELECT active FROM bot_guilds").active, 1);
    guildEvent("GUILD_DELETE", { id: GUILD }, f.store); assert.equal(f.store.get("SELECT active FROM bot_guilds").active, 0);
});

test("Dashboard access is checked against live server permissions and cannot be forged in an action body", async t => {
    const f = fixture(t); guildEvent("GUILD_CREATE", f.guild, f.store);
    const bot = { store: f.store, api: f.api, env: { DASHBOARD_OWNER_IDS: OWNER }, session: { userId: BOT }, status: () => ({ connected: true }) }, execute = command => executeCommand(command, f.store, f.api, BOT);
    const request = (path, actor = ACTOR, body) => new Request(`https://bot.example/dashboard/${path}`, { method: body ? "POST" : "GET", headers: { "X-Sonata-User": actor }, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await dashboardRequest(request("servers"), bot, execute)).servers.length, 1);
    assert.equal((await dashboardRequest(request("servers", TARGET), bot, execute)).servers.length, 0);
    await assert.rejects(dashboardRequest(request(`server?guild=${GUILD}`, TARGET), bot, execute), /Manage Server/);
    await assert.rejects(dashboardRequest(request("owner", ACTOR), bot, execute), /bot owner/);
    await assert.rejects(dashboardRequest(request("action", TARGET, { guild: GUILD, channel: CHANNEL, actor: OWNER, name: "settings", sub: "prefix", options: { prefix: "!" } }), bot, execute), /Manage Server/);
    f.calls.length = 0;
    const action = { guild: GUILD, channel: CHANNEL, name: "settings", sub: "prefix", options: { prefix: "!" } };
    const saved = await dashboardRequest(request("action", ACTOR, action), bot, execute);
    assert.equal(saved.settings.prefix, "!");
    assert.equal(f.store.settings(GUILD).prefix, "!");
    for (const route of [`/guilds/${GUILD}/roles`, `/guilds/${GUILD}/members/${ACTOR}`]) {
        assert.equal(f.calls.filter(call => call.route === route).length, 1);
    }
    f.members.get(ACTOR).roles = [];
    await assert.rejects(dashboardRequest(request("action", ACTOR, { ...action, options: { prefix: "?" } }), bot, execute), /Manage Server/);
    assert.equal(f.store.settings(GUILD).prefix, "!");
    f.members.delete(ACTOR);
    f.calls.length = 0;
    assert.deepEqual((await dashboardRequest(request("servers"), bot, execute)).servers, []);
    assert.deepEqual(f.calls.map(call => call.route), [`/guilds/${GUILD}/members/${ACTOR}`]);
    await assert.rejects(dashboardRequest(request("action", ACTOR, { guild: GUILD, channel: CHANNEL, name: "ban", sub: "", options: { member: TARGET } }), bot, execute), /available dashboard action/);
});

test("The bot owner's server overview does not grant configuration access in another owner's server", async t => {
    const f = fixture(t); guildEvent("GUILD_CREATE", f.guild, f.store);
    const bot = { store: f.store, api: f.api, env: { DASHBOARD_OWNER_IDS: TARGET }, session: { userId: BOT }, status: () => ({ connected: true }) };
    const result = await dashboardRequest(new Request(`https://bot.example/dashboard/owner/server?guild=${GUILD}`, { headers: { "X-Sonata-User": TARGET } }), bot, () => assert.fail());
    assert.equal(result.manageable, false); assert.equal(result.settings, undefined); assert.equal(result.cases, undefined); assert.equal(result.guild.id, GUILD);
});


test("Only the bot owner can blacklist or remove servers, and leaving keeps case history", async t => {
    const f = fixture(t); guildEvent("GUILD_CREATE", f.guild, f.store);
    const bot = { store: f.store, api: f.api, env: { DASHBOARD_OWNER_IDS: OWNER }, session: { userId: BOT }, status: () => ({ connected: true }) };
    const request = (action, actor = OWNER, guild = GUILD) => new Request("https://bot.example/dashboard/owner/action", { method: "POST", headers: { "X-Sonata-User": actor }, body: JSON.stringify({ guild, action, actor: OWNER, reason: "Owner test" }) });
    await assert.rejects(dashboardRequest(request("blacklist", ACTOR), bot), /bot owner/);
    assert.equal(f.store.all("SELECT * FROM guild_blacklist").length, 0);
    await assert.rejects(dashboardRequest(request("blacklist", OWNER, "invalid"), bot), /Choose a server ID/);
    const n = f.store.begin(f.command(",warn " + TARGET + " Keep this history"), "warn", TARGET, "Keep this history");
    f.store.schedule(GUILD, n, TARGET, "tempban", Date.now() + 60000);
    assert.equal((await dashboardRequest(request("leave"), bot)).ok, true);
    assert(f.calls.some(value => value.route === "/users/@me/guilds/" + GUILD && value.method === "DELETE"));
    assert.equal(f.store.get("SELECT active FROM bot_guilds WHERE id=?", GUILD).active, 0);
    assert(f.store.case(GUILD, n)); assert.equal(f.store.get("SELECT state FROM jobs").state, "cancelled");
    assert.equal(f.store.all("SELECT * FROM guild_blacklist").length, 0);
    guildEvent("GUILD_CREATE", f.guild, f.store);
    await dashboardRequest(request("blacklist"), bot);
    assert.equal(f.store.get("SELECT actor FROM guild_blacklist WHERE id=?", GUILD).actor, OWNER);
    await assert.rejects(executeCommand(f.command(",help"), f.store, f.api, BOT), /blacklisted/);
    guildEvent("GUILD_CREATE", f.guild, f.store);
    assert.equal(await enforceGuildBlock(bot, GUILD), true);
    assert.equal(f.store.get("SELECT active FROM bot_guilds WHERE id=?", GUILD).active, 0);
    await dashboardRequest(request("unblacklist"), bot);
    assert.equal(await enforceGuildBlock(bot, GUILD), false);
    assert.equal(f.store.get("SELECT active FROM bot_guilds WHERE id=?", GUILD).active, 0);
});

test("Preemptive server blocks persist and failed departures can retry without lifting the block", async t => {
    const f = fixture(t); let failure = true;
    const bot = { store: f.store, api: async () => { if (failure) throw new Error("Discord is unavailable"); }, env: { DASHBOARD_OWNER_IDS: OWNER }, session: { userId: BOT }, status: () => ({ connected: true }) };
    const request = new Request("https://bot.example/dashboard/owner/action", { method: "POST", headers: { "X-Sonata-User": OWNER }, body: JSON.stringify({ guild: GUILD, action: "blacklist" }) });
    await dashboardRequest(request, bot);
    guildEvent("GUILD_CREATE", f.guild, f.store);
    assert.equal(await enforceGuildBlock(bot, GUILD), true);
    assert.match(f.store.get("SELECT last_error FROM guild_blacklist WHERE id=?", GUILD).last_error, /unavailable/);
    assert.equal(f.store.get("SELECT active FROM bot_guilds WHERE id=?", GUILD).active, 1);
    failure = false; await enforceGuildBlock(bot, GUILD);
    assert.equal(f.store.get("SELECT active FROM bot_guilds WHERE id=?", GUILD).active, 0);
    const owner = await dashboardRequest(new Request("https://bot.example/dashboard/owner", { headers: { "X-Sonata-User": OWNER } }), bot);
    assert.equal(owner.blacklist[0].id, GUILD); assert.equal(owner.blacklist[0].last_error, "");
});


test("Avatar lookup is owner only and returns bounded public profile fields", async t => {
    const f = fixture(t), user = f.members.get(TARGET).user;
    user.avatar = "0123456789abcdef0123456789abcdef"; user.discriminator = "0"; user.email = "not-returned@example.test";
    const bot = { store: f.store, api: f.api, env: { DASHBOARD_OWNER_IDS: OWNER } };
    const request = (actor, ids = TARGET) => new Request("https://bot.example/dashboard/owner/users?ids=" + ids, { headers: { "X-Sonata-User": actor } });
    await assert.rejects(dashboardRequest(request(ACTOR), bot), /bot owner/); assert.equal(f.calls.length, 0);
    await assert.rejects(dashboardRequest(request(OWNER, "invalid"), bot), /valid Discord user IDs/);
    await assert.rejects(dashboardRequest(request(OWNER, Array.from({ length: 21 }, (_, i) => String(100000000000000000n + BigInt(i))).join(",")), bot), /up to 20/);
    const result = await dashboardRequest(request(OWNER), bot);
    assert.deepEqual(result, { users: [{ id: TARGET, avatar: user.avatar, discriminator: "0" }] });
    user.global_name = "Test moderator";
    const profile = await dashboardRequest(request(OWNER, TARGET + "&profile=1"), bot);
    assert.deepEqual(profile.users[0], { ...result.users[0], username: user.username, name: "Test moderator" });
});
