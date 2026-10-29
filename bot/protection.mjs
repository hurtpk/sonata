/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { messageChannel } from "./community.mjs";
import { canManage, embed, fail, highestRole, isId, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { jailAction } from "./restrictions.mjs";

const dangerous = PERMS.ADMIN | PERMS.KICK | PERMS.BAN | PERMS.GUILD | PERMS.CHANNELS | PERMS.ROLES | PERMS.TIMEOUT | 536870912n;
const auditKinds = { 10: "channels", 11: "channels", 12: "channels", 13: "channels", 14: "channels", 15: "channels", 20: "bans", 22: "bans", 23: "bans", 24: "members", 25: "members", 30: "roles", 31: "roles", 32: "roles" };
const labels = { 10: "Channel created", 11: "Channel changed", 12: "Channel deleted", 13: "Channel access added", 14: "Channel access changed", 15: "Channel access removed", 20: "Member kicked", 22: "Member banned", 23: "Member unbanned", 24: "Member changed", 25: "Member roles changed", 30: "Role created", 31: "Role changed", 32: "Role deleted" };
const stamp = id => Number((BigInt(id) >> 22n) + 1420070400000n);

export async function protectionCommand(context, store) {
    const { command, guild, api, roles, actor, bot } = context, o = command.options, settings = store.settings(guild.id), key = command.name;
    if (key === "antinuke" && actor.user.id !== guild.owner_id) fail("Only the server owner can configure anti-nuke protection or restore its saved roles.");
    if (key === "eventlog") {
        settings.eventlogs ??= {};
        if (command.sub === "view") return embed("Server event logs", (Object.entries(settings.eventlogs).map(([kind, id]) => `${kind}: <#${id}>`).join("\n") || "No event logs configured.") + (settings.securityError ? `\n\nLast issue: ${settings.securityError}` : ""));
        if (command.sub === "set") { await messageChannel(context, o.channel); if (o.type !== "voice") context.botPermission(PERMS.AUDIT); settings.eventlogs[o.type] = o.channel; }
        else { delete settings.eventlogs[o.type]; if (o.type === "voice") store.run("DELETE FROM voice_activity WHERE guild=?", guild.id); }
    } else if (command.sub === "view") {
        const config = settings[key];
        return embed(key === "antiraid" ? "Join protection" : "Anti-nuke protection", !config ? "Not configured." : `Enabled: ${config.enabled ? "Yes" : "No"}\nAlerts: ${config.channel ? `<#${config.channel}>` : "Not configured"}\nResponse: ${config.action || "Not configured"}\n` + (key === "antiraid" ? `Join threshold: ${config.joins} in ${config.seconds} seconds\nMinimum account age: ${config.age} hours\nRaid window: ${(store.restriction(guild.id, guild.id, "raid")?.until ?? 0) > Date.now() ? "Active" : "Inactive"}` : `Action threshold: ${config.limit} in ${config.seconds} seconds\nTrusted accounts: ${(config.trusted ?? []).map(id => `<@${id}>`).join(", ") || "None"}`) + (settings.securityError ? `\n\nLast issue: ${settings.securityError}` : ""));
    }
    else if (command.sub === "off") { if (settings[key]) settings[key].enabled = false; }
    else if (command.sub === "clear") store.clearRestriction(guild.id, guild.id, "raid");
    else if (command.sub === "trust") {
        settings.antinuke ??= { enabled: false, trusted: [] };
        const ids = settings.antinuke.trusted ?? [];
        settings.antinuke.trusted = o.enabled ? [...new Set([...ids, o.member])] : ids.filter(id => id !== o.member);
        if (settings.antinuke.trusted.length > 20) fail("Trust at most twenty accounts.");
    } else if (command.sub === "restore") {
        context.botPermission(PERMS.ROLES);
        const saved = store.restriction(guild.id, o.member, "antinuke");
        if (!saved) fail("No saved anti-nuke roles exist for that member.");
        const target = await api(`/guilds/${guild.id}/members/${o.member}`);
        canManage(actor, target, bot, roles, guild);
        for (const old of saved.roles) {
            const role = roles.find(role => role.id === old.id);
            if (!role || role.managed || role.permissions !== old.permissions || role.position >= highestRole(bot, roles, guild.id).position) fail("A saved role was deleted, changed or moved above Sonata. Review the roles manually.");
        }
        await api(`/guilds/${guild.id}/members/${target.user.id}`, { method: "PATCH", body: { roles: [...new Set([...target.roles, ...saved.roles.map(role => role.id)])] }, reason: `Anti-nuke roles restored by server owner ${actor.user.id}` });
        store.clearRestriction(guild.id, target.user.id, "antinuke");
        return embed("Roles restored", "The unchanged saved roles were restored by the server owner.");
    } else {
        await messageChannel(context, o.channel);
        if (key === "antiraid") {
            if (o.action === "quarantine") {
                context.botPermission(PERMS.ROLES | PERMS.CHANNELS);
                if (!settings.jailRole || !settings.jailChannel) fail("Run jailsetup before enabling quarantine so Sonata has a restricted role and channel.");
            }
            settings.antiraid = { enabled: true, channel: o.channel, joins: o.joins, seconds: o.seconds, age: o.age, action: o.action };
        } else {
            context.botPermission(PERMS.AUDIT | (o.action === "strip" ? PERMS.ROLES : 0n));
            settings.antinuke = { enabled: true, channel: o.channel, limit: o.limit, seconds: o.seconds, action: o.action, trusted: settings.antinuke?.trusted ?? [] };
        }
    }
    store.saveSettings(guild.id, settings);
    return embed(key === "eventlog" ? "Event logs saved" : key === "antiraid" ? "Join protection saved" : "Anti-nuke saved", key === "eventlog" ? "Only the configured event categories are logged. Ordinary message contents are not archived by event logs." : key === "antiraid" ? "Configured join protection was updated. Quarantine uses the existing jail for fifteen minutes and applies to flagged new arrivals." : "Protection watches confirmed bans, channel deletions and role deletions. It cannot undo deleted content or manage members above Sonata.");
}

async function notify(store, api, guild, channel, title, description) {
    try { await api(`/channels/${channel}/messages`, { method: "POST", body: embed(title, description) }); }
    catch { const settings = store.settings(guild); settings.securityError = "A server protection or event log message could not be delivered."; store.saveSettings(guild, settings); }
}

export async function protectionEvent(event, data, store, api, botId, perform) {
    const guildId = event === "GUILD_CREATE" ? data.id : data.guild_id;
    const settings = store.settings(guildId), now = Date.now();
    if (event === "GUILD_CREATE") {
        if (settings.eventlogs?.voice && Array.isArray(data.voice_states)) {
            store.run("DELETE FROM voice_activity WHERE guild=?", guildId);
            for (const state of data.voice_states) if (state.channel_id) store.run("INSERT OR REPLACE INTO voice_activity VALUES (?,?,?)", guildId, state.user_id, state.channel_id);
        }
        return;
    }
    if (event === "VOICE_STATE_UPDATE") {
        if (!settings.eventlogs?.voice) return;
        const previous = store.get("SELECT channel FROM voice_activity WHERE guild=? AND user=?", guildId, data.user_id)?.channel ?? null;
        if (previous === data.channel_id) return;
        if (data.channel_id) store.run("INSERT OR REPLACE INTO voice_activity VALUES (?,?,?)", guildId, data.user_id, data.channel_id);
        else store.run("DELETE FROM voice_activity WHERE guild=? AND user=?", guildId, data.user_id);
        await notify(store, api, guildId, settings.eventlogs.voice, "Voice activity", `<@${data.user_id}> (${data.user_id})\n${previous ? `From <#${previous}>` : "Joined voice"}${data.channel_id ? ` → <#${data.channel_id}>` : " → Left voice"}`);
        return;
    }
    if (event === "GUILD_MEMBER_ADD") {
        const config = settings.antiraid;
        if (!config?.enabled || data.user.bot || !isId(data.user.id)) return;
        const id = `join:${guildId}:${data.user.id}:${data.joined_at}`;
        if (!store.claim(id)) return;
        store.run("INSERT INTO security_events VALUES (?,?,?,?,?)", id, guildId, data.user.id, "join", now);
        const count = store.get("SELECT COUNT(*) AS n FROM security_events WHERE guild=? AND kind='join' AND at>?", guildId, now - config.seconds * 1000).n;
        if (count >= config.joins) store.saveRestriction(guildId, guildId, "raid", { until: now + 600_000 });
        const raid = (store.restriction(guildId, guildId, "raid")?.until ?? 0) > now, young = config.age > 0 && now - stamp(data.user.id) < config.age * 3600_000;
        if (!raid && !young) return;
        const cooldown = store.restriction(guildId, guildId, "raidAlert");
        if (!cooldown || cooldown.until < now) { store.saveRestriction(guildId, guildId, "raidAlert", { until: now + 15_000 }); await notify(store, api, guildId, config.channel, "Join protection triggered", `${count} joins in ${config.seconds} seconds.\nArrival: <@${data.user.id}> (${data.user.id})\n${young ? "Account is younger than the configured age." : "Raid protection is active for new arrivals."}\nConfigured action: ${config.action}.`); }
        if (config.action !== "quarantine" || store.restriction(guildId, data.user.id, "jail")) return;
        const [guild, roles, bot, target] = await Promise.all([api(`/guilds/${guildId}`), api(`/guilds/${guildId}/roles`), api(`/guilds/${guildId}/members/${botId}`), api(`/guilds/${guildId}/members/${data.user.id}`, { optional: true })]);
        if (!target || target.user.id === guild.owner_id || memberPermissions(target, roles, guild) & dangerous) return;
        const owner = { user: { id: guild.owner_id }, roles: [] };
        const context = { guild, roles, bot, actor: owner, api, command: { id: `raid:${id}`, guild: guildId, actor: botId }, botPermission: permission => requirePermission(memberPermissions(bot, roles, guild), permission) };
        await perform(context, store, "raid quarantine", target.user.id, "Flagged by configured join protection.", 900_000, async (n, audit) => { requirePermission(memberPermissions(bot, roles, guild), PERMS.ROLES | PERMS.CHANNELS); canManage(owner, target, bot, roles, guild); await jailAction(context, store, target, audit); store.schedule(guildId, n, target.user.id, "jail", now + 900_000); });
        return;
    }
    if (event !== "GUILD_AUDIT_LOG_ENTRY_CREATE" || !isId(data.id) || now - stamp(data.id) > 300_000 || !store.claim(`audit:${data.id}`)) return;
    const category = auditKinds[data.action_type], destination = settings.eventlogs?.[category];
    if (destination) {
        const changes = (data.changes ?? []).slice(0, 6).map(value => `${value.key}: ${JSON.stringify(value.old_value ?? "None").slice(0, 100)} → ${JSON.stringify(value.new_value ?? "None").slice(0, 100)}`).join("\n");
        await notify(store, api, guildId, destination, labels[data.action_type], `Actor: ${data.user_id ? `<@${data.user_id}> (${data.user_id})` : "Unavailable"}\nTarget: ${data.target_id || "Unavailable"}\n${changes}${data.reason ? `\nReason: ${data.reason.slice(0, 300)}` : ""}`);
    }
    const config = settings.antinuke;
    if (!config?.enabled || ![12, 22, 32].includes(data.action_type) || !isId(data.user_id) || data.user_id === botId || config.trusted.includes(data.user_id)) return;
    const guild = await api(`/guilds/${guildId}`);
    if (data.user_id === guild.owner_id) return;
    store.run("INSERT INTO security_events VALUES (?,?,?,?,?)", `nuke:${data.id}`, guildId, data.user_id, "destructive", now);
    const count = store.get("SELECT COUNT(*) AS n FROM security_events WHERE guild=? AND actor=? AND kind='destructive' AND at>?", guildId, data.user_id, now - config.seconds * 1000).n;
    if (count < config.limit || (store.restriction(guildId, data.user_id, "nukeAlert")?.until ?? 0) > now) return;
    store.saveRestriction(guildId, data.user_id, "nukeAlert", { until: now + 60_000 });
    await notify(store, api, guildId, config.channel, "Destructive actions detected", `<@${data.user_id}> performed ${count} watched actions in ${config.seconds} seconds. Configured response: ${config.action}.`);
    if (config.action !== "strip") return;
    const [roles, bot, target] = await Promise.all([api(`/guilds/${guildId}/roles`), api(`/guilds/${guildId}/members/${botId}`), api(`/guilds/${guildId}/members/${data.user_id}`, { optional: true })]);
    if (!target) return;
    const context = { guild, api, command: { id: `nuke-action:${data.id}`, guild: guildId, actor: botId } };
    await perform(context, store, "anti-nuke role removal", target.user.id, "Configured destructive action threshold reached.", 0, async (_, audit) => {
        requirePermission(memberPermissions(bot, roles, guild), PERMS.ROLES);
        canManage({ user: { id: guild.owner_id }, roles: [] }, target, bot, roles, guild);
        const removed = roles.filter(role => target.roles.includes(role.id) && !role.managed && (BigInt(role.permissions) & dangerous));
        if (!removed.length) fail("No removable dangerous roles were found. Review the member manually.");
        if (!store.restriction(guildId, target.user.id, "antinuke")) store.saveRestriction(guildId, target.user.id, "antinuke", { roles: removed.map(role => ({ id: role.id, permissions: role.permissions })) });
        await api(`/guilds/${guildId}/members/${target.user.id}`, { method: "PATCH", body: { roles: target.roles.filter(id => !removed.some(role => role.id === id)) }, reason: audit });
        return `Removed ${removed.length} dangerous roles. Managed roles and unrelated roles were kept. Only the server owner can restore the saved roles.`;
    });
}
