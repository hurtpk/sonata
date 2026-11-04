/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import assert from "node:assert/strict";
import test from "node:test";
import { dashboardRequest, dashboardForms, DASHBOARD_ACTIONS, guildEvent } from "../dashboard.mjs";
import { checkOperations } from "../ownerConsole.mjs";
import { COMMANDS } from "../commands.mjs";
import { executeCommand } from "../moderation.mjs";
import { ACTOR, BOT, CHANNEL, fixture, GUILD, OWNER, TARGET } from "./fixture.mjs";

function setup(t) {
    const f = fixture(t); guildEvent("GUILD_CREATE", f.guild, f.store);
    const bot = { store: f.store, api: f.api, session: { userId: BOT }, env: { DASHBOARD_OWNER_IDS: OWNER }, status: () => ({ connected: true }) };
    const request = (path, input, actor = OWNER, grants = "") => dashboardRequest(new Request("https://bot.internal/dashboard/" + path, { method: input ? "POST" : "GET", headers: { "X-Sonata-User": actor, "X-Sonata-Permissions": grants }, body: input ? JSON.stringify(input) : undefined }), bot, command => executeCommand(command, f.store, f.api, BOT));
    return { ...f, bot, request };
}

test("Owner tools deny delegated Sonata administrators, not just ordinary members", async t => {
    const f = setup(t);
    for (const path of ["owner/operations", "owner/resources", "owner/lookup?id=" + TARGET, "owner/history?guild=" + GUILD, "owner/check?guild=" + GUILD, "owner/notes?guild=" + GUILD]) await assert.rejects(f.request(path, null, ACTOR, "users,servers,serverAccess,health"), /Only the Sonata owner/);
});

test("Maintenance and rollout guards apply to aliases after parsing but keep recovery commands available", async t => {
    const f = setup(t);
    await f.request("owner/operations", { maintenance: [{ target: "moderation", message: "Reviewing a moderation issue." }], rollouts: [{ target: "media", guilds: [GUILD] }] });
    await assert.rejects(f.execute(`,warn ${TARGET} test`), /Reviewing a moderation issue/);
    assert.doesNotThrow(() => checkOperations(f.store, { name: "unban", guild: GUILD }));
    assert.doesNotThrow(() => checkOperations(f.store, { name: "sonata", guild: GUILD }));
    assert.throws(() => checkOperations(f.store, { name: "sonata", guild: "999999999999999999" }), /selected servers/);
    await assert.rejects(f.request("owner/operations", { maintenance: [], rollouts: [{ target: "media", guilds: [] }] }), /test server IDs/);
    await f.request("owner/operations", { maintenance: [], rollouts: [] });
    await f.execute(`,warn ${TARGET} test`);
});

test("History identifies actor and safely restores a matching supported setting without losing newer edits", async t => {
    const f = setup(t);
    await f.execute(",settings dm on");
    let { entries } = await f.request("owner/history?guild=" + GUILD);
    const revision = entries.find(entry => entry.changes.some(change => change.key === "dm"));
    assert.equal(revision.actor, ACTOR); assert.ok(revision.source.includes("settings dm"));
    f.store.saveSettings(GUILD, { ...f.store.settings(GUILD), unrelated: "keep" });
    await f.request("owner/history", { guild: GUILD, id: revision.id, keys: ["dm"] });
    assert.equal(f.store.settings(GUILD).dm, false); assert.equal(f.store.settings(GUILD).unrelated, "keep");
    await assert.rejects(f.request("owner/history", { guild: GUILD, id: revision.id, keys: ["dm"] }), /changed again/);
    await assert.rejects(f.request("owner/history", { guild: GUILD, id: revision.id, keys: ["automod"] }), /restorable/);
});

test("Notes are bounded, private and survive other settings edits; health is read only", async t => {
    const f = setup(t);
    await f.request("owner/notes", { guild: GUILD, note: "Needs support", labels: ["testing", "testing"] });
    const note = await f.request("owner/notes?guild=" + GUILD); assert.deepEqual(note.labels, ["testing"]); assert.equal(note.actor, OWNER);
    const before = f.store.settings(GUILD), checks = await f.request("owner/check?guild=" + GUILD);
    assert.ok(checks.checks.some(check => check.name === "Administrator" && check.ok)); assert.deepEqual(f.store.settings(GUILD), before);
    await assert.rejects(f.request("owner/notes", { guild: GUILD, note: "a".repeat(4001), labels: [] }), /4,000/);
});

test("Every website action matches the parser schema and includes argument behavior", () => {
    for (const form of dashboardForms()) {
        const command = COMMANDS.find(command => command.name === form.name);
        assert.ok(form.options.length, form.name);
        for (const sub of DASHBOARD_ACTIONS[form.name]) assert.ok(sub === "run" && command.options[0]?.type !== 1 || command.options.some(option => option.type === 1 && option.name === sub), `${form.name} ${sub}`);
        for (const action of form.options) for (const option of action.options) assert.ok(action.documentation.parameters.find(parameter => parameter.name === option.name)?.description.length > 30, `${form.name} ${action.name}.${option.name}`);
    }
});

test("Website can configure a real alias and perform a moderation action with the logged-in actor", async t => {
    const f = setup(t);
    await f.request("action", { guild: GUILD, channel: CHANNEL, name: "alias", sub: "set", options: { name: "shutup", target: "timeout" }, actor: TARGET });
    assert.equal(f.store.settings(GUILD).aliases.shutup, "timeout");
    await f.request("action", { guild: GUILD, channel: CHANNEL, name: "warn", sub: "run", options: { member: TARGET, reason: "Dashboard test" } });
    const row = f.store.get("SELECT * FROM cases WHERE kind='warn'"); assert.equal(row.actor, OWNER); assert.equal(row.reason, "Dashboard test");
});

test("Resource thresholds flag measured counters without changing command limits", async t => {
    const f = setup(t);
    await f.execute(",ping");
    await f.request("owner/resources", { budgets: { dailyCommands: 1, dailyVideoMiB: 0, storageMiB: 0, averageMs: 0 } });
    const resources = await f.request("owner/resources"); assert.ok(resources.alerts.some(alert => alert.key === "dailyCommands"));
    await f.execute(",ping");
    assert.equal(f.store.get("SELECT SUM(commands) AS n FROM resource_usage").n, 2);
    await assert.rejects(f.request("owner/resources", { budgets: { dailyCommands: -1, dailyVideoMiB: 0, storageMiB: 0, averageMs: 0 } }), /nonnegative/);
});


test("Bot user blacklist denies commands, feature controls and dashboard changes until unblocked", async t => {
    const f = setup(t);
    const { botStore } = await import("../store.mjs"), { featureForm, featureAction } = await import("../featureInteractions.mjs");
    await assert.rejects(f.request("owner/userblocks", { id: TARGET, blocked: true, reason: "test" }, ACTOR, "users,servers,serverAccess,health"), /Only the Sonata owner/);
    await assert.rejects(f.request("owner/userblocks", { id: OWNER, blocked: true, reason: "test" }), /owner cannot be blocked/);
    await f.request("owner/userblocks", { id: ACTOR, blocked: true, reason: "Private test note" });
    assert.equal(botStore(f.storage).get("SELECT actor FROM user_blacklist WHERE id=?", ACTOR).actor, OWNER);
    const before = f.calls.length;
    await assert.rejects(f.execute(",ping"), /blocked from Sonata Bot/);
    await assert.rejects(f.request("action", { guild: GUILD, channel: CHANNEL, name: "warn", sub: "run", options: { member: TARGET, reason: "Denied" } }, ACTOR), /blocked from Sonata Bot/);
    const interaction = { member: { user: { id: ACTOR } }, data: { custom_id: "unknown" } };
    assert.throws(() => featureForm(interaction, f.store), /blocked from Sonata Bot/);
    await assert.rejects(featureAction(interaction, f.store, f.api, BOT), /blocked from Sonata Bot/);
    assert.equal(f.calls.length, before);
    await f.request("owner/userblocks", { id: ACTOR, blocked: false, reason: "" });
    assert.deepEqual((await f.request("owner/userblocks")).users, []);
    await f.execute(",ping");
});

test("Message sender validates owner, server, channel and content, then records a non-pinging bot post", async t => {
    const f = setup(t);
    for (const actor of [ACTOR, TARGET]) await assert.rejects(f.request("owner/messages?guild=" + GUILD, null, actor, "users,servers,serverAccess,health"), /Only the Sonata owner/);
    assert.equal((await f.request("owner/messages?guild=" + GUILD)).channels[0].id, CHANNEL);
    for (const input of [{ guild: TARGET, channel: CHANNEL, content: "Wrong server" }, { guild: GUILD, channel: TARGET, content: "Wrong channel" }, { guild: GUILD, channel: CHANNEL, content: " " }, { guild: GUILD, channel: CHANNEL, content: "x".repeat(2001) }]) await assert.rejects(f.request("owner/messages", input));
    assert.equal(f.postedMessages.length, 0);
    const result = await f.request("owner/messages", { guild: GUILD, channel: CHANNEL, content: "Hello @everyone" });
    assert.deepEqual(f.postedMessages[0].allowed_mentions, { parse: [] });
    assert.equal(f.postedMessages[0].content, "Hello @everyone");
    assert.ok(result.url.endsWith("/" + result.id));
    const row = (await f.request("owner/messages?guild=" + GUILD)).recent[0];
    assert.equal(row.actor, OWNER); assert.equal(row.content, undefined);
    await f.request("owner/action", { guild: GUILD, action: "blacklist" });
    await assert.rejects(f.request("owner/messages", { guild: GUILD, channel: CHANNEL, content: "Denied" }), /allowed server/);
});
