/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { dashboardRequest, guildEvent } from "../dashboard.mjs";
import { PERMS } from "../discord.mjs";
import { ACTOR, BOT, BOTROLE, CHANNEL, fixture, GUILD, MODROLE, OWNER, TARGET, USERROLE } from "./fixture.mjs";
import { attributeMessage, withModerator } from "../actionAttribution.mjs";

function setup(t) {
    const f = fixture(t); guildEvent("GUILD_CREATE", f.guild, f.store);
    f.members.get(OWNER).nick = "Server Owner";
    const api = async (route, options = {}) => {
        if (route.includes("/members/search?")) return [f.members.get(TARGET)];
        if (options.method === "DELETE" && route === `/guilds/${GUILD}/roles/${USERROLE}`) { f.roles.splice(f.roles.findIndex(r => r.id === USERROLE), 1); return null; }
        if (route === `/channels/${CHANNEL}` && options.method === "DELETE") { f.channels.splice(0, 1); return null; }
        return f.api(route, options);
    };
    const bot = { api, store: f.store, session: { userId: BOT }, env: {} };
    const request = (input, actor = OWNER, query = "") => dashboardRequest(new Request(`https://bot/dashboard/server-manager?guild=${GUILD}${query}`, { method: input ? "POST" : "GET", headers: { "X-Sonata-User": actor }, body: input ? JSON.stringify({ guild: GUILD, ...input }) : undefined }), bot);
    return { ...f, request };
}

test("Server role edits, assignment and confirmed deletion enforce hierarchy and record their moderator", async t => {
    const f = setup(t), options = { name: "Helpers", color: "#ffad91", hoist: true, mentionable: false, permissions: "0" };
    const list = await f.request(); assert.equal(list.canCreateRoles, true); assert.equal(list.roles.find(r => r.id === BOTROLE).editable, false);
    const result = await f.request({ action: "role-update", id: USERROLE, options });
    assert.equal(f.roles.find(r => r.id === USERROLE).name, "Helpers"); assert.match(result.result.embeds[0].footer.text, new RegExp(`Server Owner \\| ${OWNER}`));
    assert.match(f.calls.find(c => c.method === "PATCH").reason, new RegExp(`Moderator: Server Owner \\| ${OWNER}`));
    assert.equal(f.store.all("SELECT * FROM cases")[0].actor, OWNER);
    await f.request({ action: "role-assign", id: USERROLE, options: { member: TARGET } });
    await f.request({ action: "role-remove", id: USERROLE, options: { member: TARGET } }); assert(!f.members.get(TARGET).roles.includes(USERROLE));
    assert.equal((await f.request(undefined, OWNER, "&query=helper")).members[0].id, TARGET);
    await assert.rejects(f.request({ action: "role-update", id: BOTROLE, options }), /highest role/);
    await assert.rejects(f.request({ action: "role-delete", id: USERROLE, options: {} }), /Confirm/);
    await f.request({ action: "role-delete", id: USERROLE, options: { confirm: USERROLE } }); assert(!f.roles.some(r => r.id === USERROLE));
});

test("Role creation rejects native permission escalation, managed roles, jailed members and disabled command groups", async t => {
    const f = setup(t), options = { name: "Helpers", color: "#ffad91", hoist: false, mentionable: false, permissions: "0" };
    await f.request({ action: "role-create", options }); assert(f.roles.some(r => r.name === "Helpers"));
    f.roles.find(r => r.id === USERROLE).managed = true;
    await assert.rejects(f.request({ action: "role-delete", id: USERROLE, options: { confirm: USERROLE } }), /Managed/);
    await assert.rejects(f.request({ action: "role-create", options: { ...options, permissions: PERMS.ADMIN.toString() } }, ACTOR), /permissions/);
    f.roles.find(r => r.id === MODROLE).permissions = PERMS.GUILD.toString();
    await assert.rejects(f.request({ action: "role-create", options }, ACTOR), /permissions/);
    const settings = f.store.settings(GUILD); settings.disabledCommands = ["role"]; f.store.saveSettings(GUILD, settings);
    await assert.rejects(f.request({ action: "role-create", options }), /disabled/);
});

test("Channel and category editors preserve guild scope, require native permissions and confirm deletion", async t => {
    const f = setup(t), options = { name: "logs", type: 4, parent: null, topic: "", nsfw: false, slowmode: 0, userLimit: 0 };
    await f.request({ action: "channel-create", options }); const category = f.channels.find(c => c.name === "logs"); assert.equal(category.type, 4);
    await f.request({ action: "channel-create", options: { ...options, type: 0, name: "message-logs", parent: category.id } }); assert.equal(f.channels.find(c => c.name === "message-logs").parent_id, category.id);
    await f.request({ action: "channel-update", id: CHANNEL, options: { ...options, name: "renamed", type: 0, parent: category.id, slowmode: 15 } }); assert.equal(f.channels[0].rate_limit_per_user, 15);
    await f.request({ action: "channel-permissions", id: CHANNEL, options: { type: 0, target: USERROLE, allow: PERMS.VIEW.toString(), deny: "0" } });
    await assert.rejects(f.request({ action: "channel-create", options: { ...options, type: 0, parent: TARGET } }), /category/);
    await assert.rejects(f.request({ action: "channel-permissions", id: CHANNEL, options: { type: 0, target: USERROLE, allow: "1", deny: "1" } }), /both allowed and denied/);
    await assert.rejects(f.request({ action: "channel-delete", id: CHANNEL, options: {} }), /Confirm/);
    await f.request({ action: "channel-delete", id: CHANNEL, options: { confirm: CHANNEL } }); assert(!f.channels.some(c => c.id === CHANNEL));
});

test("Attribution is isolated across concurrent actions and appends once without pinging", async () => {
    const [a, b] = await Promise.all([withModerator(ACTOR, "Alice", async () => { await new Promise(resolve => setTimeout(resolve, 5)); return attributeMessage({ embeds: [{ footer: { text: "Existing footer" } }], allowed_mentions: { parse: [] } }); }), withModerator(TARGET, "Bob", async () => attributeMessage({ content: "Saved.", allowed_mentions: { parse: [] } }))]);
    assert.match(a.embeds[0].footer.text, /Alice/); assert(!a.embeds[0].footer.text.includes("Bob")); assert.match(b.content, /Bob/); assert.deepEqual(b.allowed_mentions, { parse: [] });
    assert.equal(withModerator(TARGET, "Bob", () => attributeMessage(b)).content, b.content);
});

test("Role appearance follows live entitlements and sends valid gradients, the fixed holographic preset and solid resets", async t => {
    const f = setup(t), options = { name: "Color test", color: "#ffad91", hoist: false, mentionable: false, permissions: "0", colors: { primary_color: 0xffad91, secondary_color: 0x5865f2, tertiary_color: null } };
    assert.deepEqual((await f.request()).roleAppearance, { icons: false, enhancedColors: false });
    await assert.rejects(f.request({ action: "role-update", id: USERROLE, options }), /Enhanced Role Styles/);
    f.guild.features = ["ENHANCED_ROLE_COLORS", "ROLE_ICONS"];
    assert.deepEqual((await f.request()).roleAppearance, { icons: true, enhancedColors: true });
    await f.request({ action: "role-update", id: USERROLE, options });
    assert.deepEqual(f.roles.find(r => r.id === USERROLE).colors, options.colors);
    const holo = { primary_color: 11127295, secondary_color: 16759788, tertiary_color: 16761760 };
    await f.request({ action: "role-update", id: USERROLE, options: { ...options, colors: holo } });
    assert.deepEqual(f.roles.find(r => r.id === USERROLE).colors, holo);
    await assert.rejects(f.request({ action: "role-update", id: USERROLE, options: { ...options, colors: { ...holo, primary_color: 123 } } }), /fixed holographic/);
    f.guild.features = [];
    await f.request({ action: "role-update", id: USERROLE, options: { ...options, name: "Rename only", colors: holo } });
    assert.deepEqual(f.roles.find(r => r.id === USERROLE).colors, holo);
    const solid = { primary_color: 0x112233, secondary_color: null, tertiary_color: null };
    await f.request({ action: "role-update", id: USERROLE, options: { ...options, colors: solid } });
    assert.deepEqual(f.roles.find(r => r.id === USERROLE).colors, solid);
    for (const primary_color of [-1, 0x1000000, "#123456", 2.5, null]) await assert.rejects(f.request({ action: "role-update", id: USERROLE, options: { ...options, colors: { ...solid, primary_color } } }), /colors between/);
});

test("Role icons validate size and content, require the live feature and preserve icons during unrelated edits", async t => {
    const f = setup(t), options = { name: "Icon test", color: "#ffad91", hoist: false, mentionable: false, permissions: "0" }, png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=";
    await assert.rejects(f.request({ action: "role-update", id: USERROLE, options: { ...options, icon: png } }), /not unlocked/);
    f.guild.features = ["ROLE_ICONS"];
    await f.request({ action: "role-update", id: USERROLE, options: { ...options, icon: png } });
    const patch = f.calls.findLast(c => c.method === "PATCH"); assert.equal(patch.body.icon, png); assert.equal(patch.body.unicode_emoji, null);
    await f.request({ action: "role-update", id: USERROLE, options });
    assert(!Object.hasOwn(f.calls.findLast(c => c.method === "PATCH").body, "icon"));
    for (const icon of ["https://example.com/icon.png", "data:image/svg+xml;base64,AAAA", "data:image/png;base64," + Buffer.from("wrong image contents").toString("base64"), "data:image/png;base64," + Buffer.alloc(262145).toString("base64")]) await assert.rejects(f.request({ action: "role-update", id: USERROLE, options: { ...options, icon } }), /icon|format/);
    f.guild.features = [];
    await f.request({ action: "role-update", id: USERROLE, options: { ...options, icon: null } });
    assert.equal(f.calls.findLast(c => c.method === "PATCH").body.icon, null);
});
