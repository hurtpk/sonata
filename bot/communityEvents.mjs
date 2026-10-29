/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expandMessage, safeAutorole } from "./community.mjs";
import { canManage, channelPermissions, embed, highestRole, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { delegatedRole } from "./commandAccess.mjs";

export async function communityEvent(event, data, store, api, botId, cooldowns, requestId) {
    const guildId = data.guild_id, settings = store.settings(guildId), user = event === "MESSAGE_CREATE" ? data.author : data.user;
    if (!user || (event === "MESSAGE_CREATE" && (user.bot || data.webhook_id))) return;
    let reply;
    if (event === "MESSAGE_CREATE") {
        if (!data.content || data.content.length > 100 || data.content.startsWith(settings.prefix)) return;
        const trigger = data.content.trim().toLowerCase();
        if (!settings.replies || !Object.hasOwn(settings.replies, trigger)) return;
        reply = settings.replies[trigger];
        const now = Date.now(), key = `reply:${guildId}`;
        if ((cooldowns.get(key)?.until ?? 0) > now) return;
        cooldowns.set(key, { until: now + 10_000, n: 1 });
        for (const [id, value] of cooldowns) if (value.until < now) cooldowns.delete(id);
    } else if (!settings.welcome && !settings.goodbye && !settings.autoroles && !settings.joinlogs && !settings.autonick) return;
    if (!store.claim(requestId)) return;
    const [guild, roles, bot] = await Promise.all([api(`/guilds/${guildId}`), api(`/guilds/${guildId}/roles`), api(`/guilds/${guildId}/members/${botId}`)]);
    const send = async (channelId, title, description) => {
        const channel = await api(`/channels/${channelId}`, { optional: true });
        if (!channel || channel.guild_id !== guildId || ![0, 5].includes(channel.type)) return;
        requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.SEND | PERMS.EMBEDS);
        await api(`/channels/${channelId}/messages`, { method: "POST", body: embed(title, description) });
    };
    if (reply) {
        const member = await api(`/guilds/${guildId}/members/${user.id}`, { optional: true });
        if (!member) return;
        const channel = await api(`/channels/${data.channel_id}`);
        if (channel.guild_id !== guildId) return;
        requirePermission(channelPermissions(member, roles, guild, channel), PERMS.VIEW | PERMS.SEND);
        await send(data.channel_id, "Sonata", expandMessage(reply, user, guild)); return;
    }
    const errors = [];
    const attempt = async task => { try { await task(); } catch { errors.push("A member automation could not complete. Check the configured channel, role and bot permissions."); } };
    if (["GUILD_MEMBER_ADD", "GUILD_MEMBER_UPDATE"].includes(event) && !store.restriction(guildId, user.id, "jail")) {
        const target = await api(`/guilds/${guildId}/members/${user.id}`, { optional: true });
        if (target?.pending && (settings.autoroles?.enabled || settings.autonick)) store.run("INSERT INTO onboarding VALUES (?,?,?) ON CONFLICT(guild,target) DO UPDATE SET at=excluded.at", guildId, user.id, Date.now());
        if (target && !target.pending) {
            store.run("DELETE FROM onboarding WHERE guild=? AND target=?", guildId, user.id);
            if (settings.autoroles?.enabled) for (const [id, audience] of Object.entries(settings.autoroles.roles)) {
                if ((audience === "humans" && user.bot) || (audience === "bots" && !user.bot)) continue;
                const role = roles.find(role => role.id === id), top = highestRole(bot, roles, guildId);
                if (!role || role.id === guildId || role.id === settings.jailRole || !safeAutorole(role) || delegatedRole(settings, id) || !(top.position > role.position || (top.position === role.position && BigInt(top.id) < BigInt(role.id)))) continue;
                await attempt(async () => { requirePermission(memberPermissions(bot, roles, guild), PERMS.ROLES); await api(`/guilds/${guildId}/members/${user.id}/roles/${id}`, { method: "PUT", reason: "Configured Sonata autorole" }); });
            }
            if (settings.autonick && !user.bot) await attempt(async () => {
                requirePermission(memberPermissions(bot, roles, guild), PERMS.NICKNAMES);
                canManage({ user: { id: guild.owner_id }, roles: [] }, target, bot, roles, guild);
                const nick = expandMessage(settings.autonick, user, guild).trim().slice(0, 32);
                if (nick) await api(`/guilds/${guildId}/members/${user.id}`, { method: "PATCH", body: { nick }, reason: "Configured Sonata automatic nickname" });
            });
        }
    }
    if (event === "GUILD_MEMBER_UPDATE") return;
    if (event === "GUILD_MEMBER_REMOVE") store.run("DELETE FROM onboarding WHERE guild=? AND target=?", guildId, user.id);
    const kind = event === "GUILD_MEMBER_ADD" ? "welcome" : "goodbye";
    for (const [channelId, text] of Object.entries(settings[kind] ?? {})) await attempt(async () => { const design = settings.designedMessages?.[kind]?.[channelId]; if (!design) return send(channelId, kind === "welcome" ? "Welcome" : "Goodbye", expandMessage(text, user, guild)); const message = embed(design.title || (kind === "welcome" ? "Welcome" : "Goodbye"), expandMessage(text, user, guild)); message.embeds[0].color = parseInt(design.color.slice(1),16); const destination = await api(`/channels/${channelId}`); if (destination.guild_id !== guildId || ![0,5].includes(destination.type)) return; requirePermission(channelPermissions(bot, roles, guild, destination), PERMS.VIEW | PERMS.SEND | PERMS.EMBEDS); await api(`/channels/${channelId}/messages`, {method:"POST",body:message}); });
    if (settings.joinlogs) await attempt(() => send(settings.joinlogs, event === "GUILD_MEMBER_ADD" ? "Member joined" : "Member left", `<@${user.id}> · ${user.id}\nUsername: ${user.username || "Unknown"}\nAccount created: <t:${Math.floor(Number((BigInt(user.id) >> 22n) + 1420070400000n) / 1000)}:F>`));
    if (errors.length) { settings.automationError = { at: Date.now(), message: errors[0] }; store.saveSettings(guildId, settings); }
}
