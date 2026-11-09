/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { dashboardRequest, guildEvent } from "../dashboard.mjs";
import { PERMS } from "../discord.mjs";
import { ACTOR, BOT, CHANNEL, GUILD, MODROLE, TARGET, USERROLE, fixture } from "./fixture.mjs";

function setup(t, transport) {
    const f = fixture(t); guildEvent("GUILD_CREATE", f.guild, f.store);
    const bot = { store: f.store, api: transport ? (...args) => transport(f, ...args) : f.api, session: { userId: BOT }, env: {} };
    const run = (options, actor = ACTOR) => dashboardRequest(new Request("https://bot.example/dashboard/action", { method: "POST", headers: { "X-Sonata-User": actor }, body: JSON.stringify({ guild: GUILD, name: "logging-setup", options }) }), bot);
    return { ...f, run };
}

test("Logging setup creates private categories and channels, shares destinations and preserves other settings", async t => {
    const f = setup(t); f.store.saveSettings(GUILD, { ...f.store.settings(GUILD), prefix: "!", eventlogs: { bans: CHANNEL }, joinlogs: CHANNEL });
    const result = await f.run({ name: "Staff Logs", role: MODROLE, routes: [{ type: "messages", name: "message-logs" }, { type: "voice", name: "voice-logs" }, { type: "users", name: "user-logs" }, { type: "roles", name: "user-logs" }, { type: "moderation", channel: CHANNEL }] });
    assert.equal(result.created.length, 4);
    const category = result.created.find(channel => channel.type === 4), saved = f.store.settings(GUILD);
    assert.equal(saved.prefix, "!"); assert.equal(saved.eventlogs.bans, CHANNEL); assert.equal(saved.logChannel, CHANNEL);
    assert.equal(saved.eventlogs.members, saved.eventlogs.joins); assert.equal(saved.eventlogs.roles, saved.eventlogs.members); assert.equal(saved.joinlogs, "");
    for (const created of f.channels.filter(channel => result.created.some(value => value.id === channel.id))) {
        assert.equal(created.permission_overwrites.find(value => value.id === GUILD).deny, PERMS.VIEW.toString());
        assert.ok(created.permission_overwrites.some(value => value.id === MODROLE));
        if (created.type === 0) assert.equal(created.parent_id, category.id);
    }
});

test("Logging setup validates destinations and native permissions before creating resources", async t => {
    const f = setup(t), valid = { routes: [{ type: "messages", name: "message-logs" }] };
    f.roles.find(role => role.id === USERROLE).permissions = PERMS.GUILD.toString();
    await assert.rejects(f.run(valid, TARGET), /permissions required/);
    await assert.rejects(f.run({ routes: [{ type: "messages", channel: "123456789012345678" }] }), /this server/);
    await assert.rejects(f.run({ routes: [{ type: "messages", name: "bad/name" }] }), /channel names/);
    await assert.rejects(f.run({ routes: [{ type: "unknown", name: "logs" }] }), /logging types/);
    assert.equal(f.channels.length, 1);
    f.store.saveSettings(GUILD, { ...f.store.settings(GUILD), disabledCommands: ["eventlog"] });
    await assert.rejects(f.run(valid), /command is disabled/);
    assert.equal(f.channels.length, 1);
});

test("A failed logging setup removes only resources it created and leaves routing unchanged", async t => {
    let creates = 0;
    const f = setup(t, (f, route, options) => {
        if (options?.method === "POST" && route.endsWith("/channels") && ++creates === 3) throw new Error("Simulated Discord failure");
        return f.api(route, options);
    });
    f.store.saveSettings(GUILD, { ...f.store.settings(GUILD), eventlogs: { voice: CHANNEL } });
    await assert.rejects(f.run({ routes: [{ type: "messages", name: "message-logs" }, { type: "voice", name: "voice-logs" }] }), /Simulated Discord failure/);
    assert.equal(f.channels.length, 1); assert.equal(f.channels[0].id, CHANNEL);
    assert.deepEqual(f.store.settings(GUILD).eventlogs, { voice: CHANNEL });
});

test("Existing log channels can be assigned without creating channels or changing their permissions", async t => {
    const f = setup(t), before = structuredClone(f.channels);
    const result = await f.run({ routes: [{ type: "messages", channel: CHANNEL }, { type: "voice", channel: CHANNEL }] });
    assert.equal(result.created.length, 0); assert.deepEqual(f.channels, before);
    assert.equal(f.store.settings(GUILD).eventlogs.messages, CHANNEL);
    assert.equal(f.store.settings(GUILD).eventlogs.voice, CHANNEL);
});
