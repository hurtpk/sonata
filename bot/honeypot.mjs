/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { canManage, channelPermissions, embed, fail, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { messageChannel } from "./community.mjs";

export async function honeypotCommand(context, store) {
    const { command, guild, roles } = context, o = command.options, settings = store.settings(guild.id), pots = settings.honeypots ?? {};
    if (command.sub === "list") return embed("Honeypot channels", Object.entries(pots).map(([id, action]) => `<#${id}> · ${action}${action === "timeout" ? " for 15 minutes" : ""}`).join("\n") || "No honeypots configured.");
    if (command.sub === "exemptions") return embed("Honeypot exemptions", "The server owner, bots, Sonata and members with moderation permissions are always exempt.\n\n" + (settings.honeypotExemptions ?? []).map(id => `<@&${id}>`).join("\n"));
    if (command.sub === "exempt") {
        if (!roles.some(role => role.id === o.role) || o.role === guild.id) fail("Choose a role in this server other than everyone.");
        const values = settings.honeypotExemptions ?? [];
        settings.honeypotExemptions = o.enabled ? [...new Set([...values, o.role])] : values.filter(id => id !== o.role);
        if (settings.honeypotExemptions.length > 20) fail("Use at most twenty exempt roles.");
    } else {
        await messageChannel(context, o.channel);
        if (command.sub === "add") {
            context.botPermission({ timeout: PERMS.TIMEOUT, kick: PERMS.KICK, ban: PERMS.BAN }[o.action]);
            if (!pots[o.channel] && Object.keys(pots).length >= 5) fail("Use at most five honeypot channels.");
            pots[o.channel] = o.action;
        } else delete pots[o.channel];
        settings.honeypots = pots;
    }
    store.saveSettings(guild.id, settings);
    return embed("Honeypot configuration saved", "Non-exempt members who post in a configured channel receive its chosen action. Staff and bots are exempt. Timeout actions last fifteen minutes. Actions are recorded in Sonata's case history.");
}

export async function honeypotEvent(data, store, api, botId, perform) {
    if (data.author.bot || data.webhook_id) return;
    const settings = store.settings(data.guild_id), action = settings.honeypots?.[data.channel_id];
    if (!action || !["timeout", "kick", "ban"].includes(action)) return;
    const [guild, roles, target, bot, channel] = await Promise.all([api(`/guilds/${data.guild_id}`), api(`/guilds/${data.guild_id}/roles`), api(`/guilds/${data.guild_id}/members/${data.author.id}`, { optional: true }), api(`/guilds/${data.guild_id}/members/${botId}`), api(`/channels/${data.channel_id}`)]);
    if (!target || target.user.bot || target.user.id === guild.owner_id || target.user.id === botId || target.roles.some(id => settings.honeypotExemptions?.includes(id))) return;
    const staff = PERMS.ADMIN | PERMS.GUILD | PERMS.BAN | PERMS.KICK | PERMS.MESSAGES | PERMS.TIMEOUT | PERMS.ROLES;
    if (memberPermissions(target, roles, guild) & staff) return;
    if (channel.guild_id !== guild.id) return;
    requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW);
    requirePermission(memberPermissions(bot, roles, guild), { timeout: PERMS.TIMEOUT, kick: PERMS.KICK, ban: PERMS.BAN }[action]);
    canManage({ user: { id: guild.owner_id }, roles: [] }, target, bot, roles, guild);
    const id = `honeypot:${data.id}`;
    if (!store.claim(id)) return;
    const command = { id, actor: botId, guild: guild.id, channel: channel.id };
    const duration = action === "timeout" ? 900_000 : 0;
    await perform({ command, guild, api }, store, `honeypot ${action}`, target.user.id, "Posted in a configured honeypot channel.", duration, async (_, audit) => {
        if (action === "timeout") await api(`/guilds/${guild.id}/members/${target.user.id}`, { method: "PATCH", body: { communication_disabled_until: new Date(Date.now() + duration).toISOString() }, reason: audit });
        if (action === "kick") await api(`/guilds/${guild.id}/members/${target.user.id}`, { method: "DELETE", reason: audit });
        if (action === "ban") { await api(`/guilds/${guild.id}/bans/${target.user.id}`, { method: "PUT", body: { delete_message_seconds: 0 }, reason: audit }); store.cancelJobs(guild.id, target.user.id, "tempban"); }
    });
}
