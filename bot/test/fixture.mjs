/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { parsePrefix } from "../commands.mjs";
import { PERMS } from "../discord.mjs";
import { executeCommand } from "../moderation.mjs";
import { botStore } from "../store.mjs";

export const GUILD = "111111111111111111", OWNER = "111111111111111112", ACTOR = "222222222222222222", TARGET = "333333333333333333", BOT = "444444444444444444", MODROLE = "555555555555555555", BOTROLE = "666666666666666666", USERROLE = "777777777777777777", CHANNEL = "888888888888888888";
export const full = Object.values(PERMS).reduce((a, b) => a | b, 0n) & ~PERMS.ADMIN;

export function fixture(t) {
    const db = new DatabaseSync(":memory:");
    const storage = {
        sql: { exec(sql, ...params) {
            if (!params.length && sql.split(";").filter(value => value.trim()).length > 1) { db.exec(sql); return { toArray: () => [] }; }
            const statement = db.prepare(sql);
            const rows = statement.columns().length ? statement.all(...params) : (statement.run(...params), []);
            return { toArray: () => rows };
        } },
        transactionSync(fn) { db.exec("BEGIN"); try { const value = fn(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } },
    };
    t.after(() => db.close());
    const store = botStore(storage), calls = [], bans = new Map(), messages = [], rules = [], voiceStates = new Map();
    const guild = { id: GUILD, owner_id: OWNER, name: "Test server" };
    const roles = [{ id: GUILD, position: 0, permissions: (PERMS.VIEW | PERMS.SEND | PERMS.HISTORY).toString() }, { id: MODROLE, position: 20, permissions: full.toString() }, { id: BOTROLE, position: 30, permissions: full.toString() }, { id: USERROLE, position: 10, permissions: "0" }];
    const members = new Map([[ACTOR, { user: { id: ACTOR }, roles: [MODROLE] }], [BOT, { user: { id: BOT, bot: true }, roles: [BOTROLE] }], [TARGET, { user: { id: TARGET }, roles: [USERROLE] }], [OWNER, { user: { id: OWNER }, roles: [] }]]);
    for (const role of roles) role.name = `Role ${role.id}`;
    for (const member of members.values()) member.user.username = `User ${member.user.id}`;
    const channels = [{ id: CHANNEL, type: 0, guild_id: GUILD, permission_overwrites: [] }];
    let serial = 900000000000000000n, request = 100000000000000000n, unbanFailures = 0;
    const clone = value => structuredClone(value);
    const api = async (route, options = {}) => {
        calls.push({ route, ...options }); const method = options.method ?? "GET";
        if (route === `/guilds/${GUILD}?with_counts=true`) return { ...clone(guild), approximate_member_count: 123, approximate_presence_count: 45 };
        if (route.startsWith("/users/")) return clone([...members.values()].find(member => member.user.id === route.split("/")[2])?.user);
        if (route === `/guilds/${GUILD}`) return clone(guild);
        if (route === `/guilds/${GUILD}/roles`) {
            if (method === "POST") { const role = { id: String(++serial), position: 1, permissions: options.body.permissions, name: options.body.name }; roles.push(role); return clone(role); }
            return clone(roles);
        }
        if (route.startsWith(`/guilds/${GUILD}/roles/`)) {
            const role = roles.find(role => role.id === route.split("/")[4]); assert(role, route);
            if (method === "PATCH") Object.assign(role, options.body);
            return clone(role);
        }
        if (route.startsWith(`/guilds/${GUILD}/voice-states/`)) return clone(voiceStates.get(route.split("/")[4]) ?? null);
        if (route.startsWith(`/guilds/${GUILD}/bans?`)) {
            const query = new URL(`https://discord.com${route}`).searchParams;
            return [...bans.values()].filter(ban => !query.get("after") || BigInt(ban.user.id) > BigInt(query.get("after"))).sort((a, b) => BigInt(a.user.id) < BigInt(b.user.id) ? -1 : 1).slice(0, Number(query.get("limit"))).map(clone);
        }
        if (route === `/guilds/${GUILD}/channels`) {
            if (method === "POST") { const channel = { ...options.body, id: String(++serial), guild_id: GUILD }; channels.push(channel); return clone(channel); }
            return clone(channels);
        }
        if (route.startsWith(`/guilds/${GUILD}/auto-moderation/rules`)) {
            const id = route.split("/")[5];
            if (method === "GET") return clone(rules);
            if (method === "POST") { const rule = { ...options.body, id: String(++serial), creator_id: BOT }; rules.push(rule); return clone(rule); }
            const rule = rules.find(rule => rule.id === id); assert(rule, route);
            if (method === "PATCH") { Object.assign(rule, options.body); return clone(rule); }
            if (method === "DELETE") { rules.splice(rules.indexOf(rule), 1); return null; }
        }
        if (route.startsWith(`/guilds/${GUILD}/members/`)) {
            const id = route.split("/")[4], member = members.get(id);
            if (!member && options.optional) return null;
            assert(member, route);
            if (route.includes("/roles/")) {
                const role = route.split("/")[6];
                member.roles = method === "PUT" ? [...new Set([...member.roles, role])] : member.roles.filter(value => value !== role);
                return null;
            }
            if (method === "PATCH") { Object.assign(member, options.body); return clone(member); }
            if (method === "DELETE") { members.delete(id); return null; }
            return clone(member);
        }
        if (route.startsWith(`/guilds/${GUILD}/bans/`)) {
            const id = route.split("/")[4];
            if (method === "PUT") { bans.set(id, { reason: options.reason, user: { id } }); return null; }
            if (method === "DELETE") { if (unbanFailures-- > 0) throw Object.assign(new Error("Temporary Discord error"), { status: 503 }); bans.delete(id); return null; }
            return clone(bans.get(id) ?? null);
        }
        if (route.startsWith("/channels/")) {
            const id = route.split("/")[2], channel = channels.find(channel => channel.id === id);
            if (!channel && options.optional) return null;
            assert(channel, route);
            if (route.includes("/permissions/")) { const target = route.split("/")[4], existing = channel.permission_overwrites.find(value => value.id === target); if (existing) Object.assign(existing, options.body); else channel.permission_overwrites.push(options.body); return null; }
            if (route.includes("/messages/pins?")) return { items: messages.filter(message => message.pinned).map(message => ({ message: clone(message), pinned_at: "2026-10-28T00:00:00.000Z" })), has_more: false };
            if (route.includes("/messages/pins/")) { const message = messages.find(message => message.id === route.split("/")[5]); assert(message, route); message.pinned = method === "PUT"; return null; }
            if (route.includes("messages?")) return clone(messages);
            if (/\/messages\/\d+$/.test(route) && method === "GET") { const message = messages.find(message => message.id === route.split("/")[4]); assert(message, route); return clone(message); }
            if (route.includes("/messages")) return { id: String(++serial) };
            if (method === "PATCH") Object.assign(channel, options.body);
            if (method === "DELETE") channels.splice(channels.indexOf(channel), 1);
            return clone(channel);
        }
        throw new Error(`Unexpected fake API route: ${route}`);
    };
    const command = (content, actor = ACTOR) => ({ ...parsePrefix(content, ","), id: String(++request), actor, guild: GUILD, channel: CHANNEL });
    const execute = content => executeCommand(command(content), store, api, BOT);
    return { store, db, api, calls, bans, guild, roles, members, channels, messages, rules, voiceStates, command, execute, failUnban: count => { unbanFailures = count; } };
}
