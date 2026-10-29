/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { parseDuration } from "./commands.mjs";
import { canManage, embed, fail, memberPermissions, PERMS, requirePermission } from "./discord.mjs";

export function expireWarnings(store, guild, target) {
    const days = store.settings(guild).warningExpiry;
    if (!days) return;
    const rows = target ? store.all("SELECT * FROM cases WHERE guild=? AND target=? AND kind='warn' AND status='completed' AND at<? LIMIT 100", guild, target, Date.now() - days * 86400_000) : store.all("SELECT * FROM cases WHERE guild=? AND kind='warn' AND status='completed' AND at<? LIMIT 100", guild, Date.now() - days * 86400_000);
    for (const row of rows) store.status(guild, row.n, "expired", row.detail);
}
export function escalationCommand(context, store) {
    const { command, guild, roles } = context, o = command.options, settings = store.settings(guild.id);
    settings.escalation ??= {}; settings.warningExemptions ??= [];
    if (command.sub === "view") return embed("Warning rules", `Warning expiry: ${settings.warningExpiry ? `${settings.warningExpiry} days` : "Never"}\nExempt roles: ${settings.warningExemptions.map(id => `<@&${id}>`).join(", ") || "None"}\n\n` + (Object.entries(settings.escalation).map(([n, rule]) => `${n} active warnings: ${rule.action}${rule.duration ? ` for ${rule.duration / 60_000} minutes` : ""}`).join("\n") || "No automatic actions configured."));
    if (command.sub === "set") {
        context.botPermission({ timeout: PERMS.TIMEOUT, kick: PERMS.KICK, ban: PERMS.BAN }[o.action]);
        settings.escalation[o.warnings] = { action: o.action, duration: o.action === "timeout" ? parseDuration(o.duration || "1h", 28 * 86400_000) : 0 };
    }
    if (command.sub === "remove") delete settings.escalation[o.warnings];
    if (command.sub === "expiry") settings.warningExpiry = o.days;
    if (command.sub === "exempt") {
        if (o.role === guild.id || !roles.some(role => role.id === o.role)) fail("Choose a server role other than everyone.");
        settings.warningExemptions = o.enabled ? [...new Set([...settings.warningExemptions, o.role])] : settings.warningExemptions.filter(id => id !== o.role);
        if (settings.warningExemptions.length > 20) fail("Use at most twenty exempt roles.");
    }
    store.saveSettings(guild.id, settings);
    return embed("Warning rules saved", "Rules apply to future warnings when the active warning count reaches a configured threshold. Expired and cleared warnings keep their cases and evidence.");
}

export async function warningEscalation(context, store, n, targetId, perform) {
    expireWarnings(store, context.guild.id, targetId);
    const settings = store.settings(context.guild.id), count = store.get("SELECT COUNT(*) AS n FROM cases WHERE guild=? AND target=? AND kind='warn' AND status='completed'", context.guild.id, targetId).n, rule = settings.escalation?.[count];
    if (!rule) return;
    const { guild, roles, bot, api } = context, target = await api(`/guilds/${guild.id}/members/${targetId}`, { optional: true });
    if (!target || target.user.bot || target.user.id === guild.owner_id || target.roles.some(id => settings.warningExemptions?.includes(id)) || memberPermissions(target, roles, guild) & PERMS.ADMIN) return;
    const automatic = { ...context, command: { id: `escalation:${guild.id}:${n}`, guild: guild.id, actor: bot.user.id } };
    if (!store.claim(automatic.command.id)) return;
    const response = await perform(automatic, store, `warning escalation ${rule.action}`, targetId, `Reached ${count} active warnings after case #${n}.`, rule.duration, async (_, audit) => {
        canManage({ user: { id: guild.owner_id }, roles: [] }, target, bot, roles, guild);
        requirePermission(memberPermissions(bot, roles, guild), { timeout: PERMS.TIMEOUT, kick: PERMS.KICK, ban: PERMS.BAN }[rule.action]);
        if (rule.action === "timeout") await api(`/guilds/${guild.id}/members/${targetId}`, { method: "PATCH", body: { communication_disabled_until: new Date(Date.now() + rule.duration).toISOString() }, reason: audit });
        if (rule.action === "kick") await api(`/guilds/${guild.id}/members/${targetId}`, { method: "DELETE", reason: audit });
        if (rule.action === "ban") { await api(`/guilds/${guild.id}/bans/${targetId}`, { method: "PUT", body: { delete_message_seconds: 0 }, reason: audit }); store.cancelJobs(guild.id, targetId, "tempban"); }
    });
    store.addNote(guild.id, n, bot.user.id, "warning escalation", response.embeds[0].title);
    return response.embeds[0].title;
}
