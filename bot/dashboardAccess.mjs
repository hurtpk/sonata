/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { channelPermissions, fail, isId, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { expandMessage } from "./community.mjs";

export async function dashboardAccess(api, guild, actor, store) {
    const [info, roles, member] = await Promise.all([api(`/guilds/${guild}?with_counts=true`), api(`/guilds/${guild}/roles`), api(`/guilds/${guild}/members/${actor}`, { optional: true })]);
    const policy = store.settings(guild).dashboardAccess ?? { administrators: true, users: [] };
    if (!member || (actor !== info.owner_id && !policy.users.includes(actor) && !(policy.administrators && memberPermissions(member, roles, info) & (PERMS.ADMIN | PERMS.GUILD)))) throw Object.assign(new Error("The server owner must allow your account or enable Administrator / Manage Server access to this dashboard."), { status: 403 });
    return { guild: info, roles, actor: member, policy };
}

export async function dashboardExtra(path, request, input, context, bot) {
    const { guild, actor, roles, policy } = context, store = bot.store;
    if (path === "access") {
        if (actor.user.id !== guild.owner_id) throw Object.assign(new Error("Only the Discord server owner can change dashboard access."), { status: 403 });
        if (request.method === "GET") return policy;
        if (typeof input.administrators !== "boolean" || !Array.isArray(input.users) || input.users.length > 50 || !input.users.every(isId)) fail("Choose administrator access and up to fifty Discord user IDs.");
        const settings = store.settings(guild.id); settings.dashboardAccess = { administrators: input.administrators, users: [...new Set(input.users)] }; store.saveSettings(guild.id, settings);
        return { ok: true };
    }
    const o = input;
    if (!["welcome", "goodbye", "ticket", "verification", "custom"].includes(o.kind) || typeof o.title !== "string" || o.title.length > 250 || typeof o.text !== "string" || !o.text.trim() || o.text.length > 1800 || (o.color && !/^#[a-f0-9]{6}$/i.test(o.color))) fail("Choose a message type, a title and up to 1,800 characters of text.");
    const message = { embeds: [{ title: o.title || "Sonata", description: expandMessage(o.text, actor.user, guild), color: parseInt((o.color || "#bd898e").slice(1), 16) }], allowed_mentions: { parse: [] } };
    if (o.kind === "verification") message.components = [{ type: 1, components: [{ type: 2, style: 1, label: "Verify", custom_id: `snverify:${guild.id}` }] }];
    if (o.kind === "ticket") message.components = [{ type: 1, components: [{ type: 2, style: 1, label: "Open ticket", custom_id: `snticket:open:${guild.id}` }] }];
    if (o.preview) return { message };
    requirePermission(memberPermissions(actor, roles, guild), PERMS.GUILD);
    const channel = await bot.api(`/channels/${o.channel}`);
    if (channel.guild_id !== guild.id || ![0, 5].includes(channel.type)) fail("Choose a text channel in this server.");
    requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW | PERMS.SEND);
    if (o.save) {
        if (!["welcome", "goodbye"].includes(o.kind)) fail("Only welcome and goodbye messages can be saved as automatic messages.");
        const settings = store.settings(guild.id); settings.designedMessages ??= {}; settings.designedMessages[o.kind] ??= {}; settings.designedMessages[o.kind][channel.id] = { title: o.title, text: o.text, color: o.color || "#bd898e" }; settings[o.kind] ??= {}; settings[o.kind][channel.id] = o.text; store.saveSettings(guild.id, settings);
        return { ok: true };
    }
    if (o.kind === "ticket" && !store.settings(guild.id).tickets?.enabled) fail("Set up tickets before posting a ticket panel.");
    if (o.kind === "verification" && !store.settings(guild.id).verification?.enabled) fail("Set up verification before posting a verification panel.");
    const posted = await bot.api(`/channels/${channel.id}/messages`, { method: "POST", body: message });
    return { ok: true, messageId: posted.id };
}
