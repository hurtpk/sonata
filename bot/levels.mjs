/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomInt } from "node:crypto";
import { expandAlias, parsePrefix } from "./commands.mjs";
import { messageChannel } from "./community.mjs";
import { embed, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { basicRole } from "./memberTools.mjs";
import { ticketActivity } from "./ticketExtras.mjs";

export const levelFor = xp => Math.floor((Math.sqrt(1 + 0.08 * xp) - 1) / 2);
const threshold = level => 50 * level * (level + 1);

export async function levelsCommand(context, store) {
    const { guild, command, api } = context, settings = store.settings(guild.id), config = settings.levels ?? { enabled: false, rewards: {} }, o = command.options;
    if (command.sub === "rank") {
        const id = o.member ?? context.actor.user.id, member = await api(`/guilds/${guild.id}/members/${id}`), xp = store.get("SELECT xp FROM xp WHERE guild=? AND user=?", guild.id, id)?.xp ?? 0, level = levelFor(xp), current = xp - threshold(level), needed = threshold(level + 1) - threshold(level), progress = Math.min(10, Math.floor(10 * current / needed));
        const body = embed(`${member.user.global_name || member.user.username || "Member"} · rank`, `**Level ${level}** · Rank #${store.get("SELECT COUNT(*) AS n FROM xp WHERE guild=? AND xp>?", guild.id, xp).n + 1}\n${"▰".repeat(progress)}${"▱".repeat(10 - progress)}\n${current} / ${needed} XP to the next level\nTotal XP: ${xp}${config.enabled ? "" : "\nXP gains are paused."}`);
        if (/^(?:a_)?[a-f0-9]+$/.test(member.user.avatar ?? "")) body.embeds[0].thumbnail = { url: `https://cdn.discordapp.com/avatars/${id}/${member.user.avatar}.webp?size=128` };
        return body;
    }
    if (command.sub === "leaderboard") return embed("Server XP leaderboard", store.all("SELECT user,xp FROM xp WHERE guild=? ORDER BY xp DESC,user LIMIT 10 OFFSET ?", guild.id, ((o.page ?? 1) - 1) * 10).map((row, i) => `${((o.page ?? 1) - 1) * 10 + i + 1}. <@${row.user}> · Level ${levelFor(row.xp)} · ${row.xp} XP`).join("\n") || "No ranks on this page.");
    if (command.sub === "view") return embed("Levels and rewards", `XP gains: ${config.enabled ? "Enabled" : "Paused"}\nAnnouncement channel: ${config.channel ? `<#${config.channel}>` : "None"}\nCooldown: one XP award per member per minute\n\n${Object.entries(config.rewards ?? {}).map(([level, role]) => `Level ${level}: <@&${role}>`).join("\n") || "No role rewards."}`);
    requirePermission(memberPermissions(context.actor, context.roles, guild), PERMS.GUILD);
    if (command.sub === "enable") { config.enabled = true; if (o.channel) { await messageChannel(context, o.channel); config.channel = o.channel; } }
    if (command.sub === "disable") config.enabled = false;
    if (command.sub === "reward") { requirePermission(memberPermissions(context.actor, context.roles, guild), PERMS.ROLES); context.botPermission(PERMS.ROLES); basicRole({ ...context, settings }, o.role); config.rewards ??= {}; config.rewards[o.level] = o.role; if (Object.keys(config.rewards).length > 10) throw new Error("Use at most ten level rewards."); }
    if (command.sub === "unreward") delete config.rewards?.[o.level];
    if (command.sub === "reset") store.run("DELETE FROM xp WHERE guild=? AND user=?", guild.id, o.member);
    settings.levels = config; store.saveSettings(guild.id, settings);
    return embed("Levels saved", "XP is awarded only while enabled, without storing messages. Rewards are cumulative. Resetting XP keeps already granted roles.");
}

export async function memberActivity(data, store, api, botId, cooldowns) {
    if (data.author.bot || data.webhook_id) return;
    ticketActivity(data, store);
    const settings = store.settings(data.guild_id), personal = store.get("SELECT prefix FROM user_prefixes WHERE user=?", data.author.id)?.prefix, prefix = [personal, settings.prefix].filter(Boolean).sort((a, b) => b.length - a.length).find(value => (data.content ?? "").startsWith(value));
    let parsed;
    try { if (prefix) parsed = parsePrefix(expandAlias(data.content, prefix, settings.aliases), prefix, data.attachments); } catch { parsed = null; }
    const notices = [];
    if (parsed?.name !== "afk" && store.get("SELECT user FROM afk WHERE guild=? AND user=?", data.guild_id, data.author.id)) { store.run("DELETE FROM afk WHERE guild=? AND user=?", data.guild_id, data.author.id); notices.push(`<@${data.author.id}>, your away status was cleared.`); }
    for (const user of (data.mentions ?? []).slice(0, 3)) { const found = store.get("SELECT * FROM afk WHERE guild=? AND user=?", data.guild_id, user.id); if (found) notices.push(`<@${found.user}> is away: ${found.message}`); }
    const key = `afk-notice:${data.guild_id}:${data.channel_id}:${data.author.id}`;
    if (notices.length && (cooldowns.get(key)?.until ?? 0) < Date.now()) { cooldowns.set(key, { until: Date.now() + 30_000, n: 1 }); try { await api(`/channels/${data.channel_id}/messages`, { method: "POST", body: embed("Away status", notices.join("\n")) }); } catch { cooldowns.set(key, { until: Date.now() + 300_000, n: 1 }); } }
    if (!settings.levels?.enabled || prefix || settings.honeypots?.[data.channel_id] || !data.content?.trim() || data.content.trim().length < 3 || store.restriction(data.guild_id, data.author.id, "jail")) return;
    const previous = store.get("SELECT * FROM xp WHERE guild=? AND user=?", data.guild_id, data.author.id), now = Date.now();
    if (previous && now - previous.last < 60_000) return;
    const xp = (previous?.xp ?? 0) + randomInt(15, 26), level = levelFor(xp);
    store.run("INSERT INTO xp VALUES (?,?,?,?) ON CONFLICT(guild,user) DO UPDATE SET xp=excluded.xp,last=excluded.last", data.guild_id, data.author.id, xp, now);
    if (level <= levelFor(previous?.xp ?? 0)) return;
    if (settings.levels.channel) try { await api(`/channels/${settings.levels.channel}/messages`, { method: "POST", body: embed("Level up", `<@${data.author.id}> reached level ${level}.`) }); } catch { const current = store.settings(data.guild_id); current.levelsError = "A level announcement could not be sent. Review the announcement channel permissions."; store.saveSettings(data.guild_id, current); }
    const rewards = Object.entries(settings.levels.rewards ?? {}).filter(([n]) => Number(n) <= level);
    if (!rewards.length) return;
    const [guild, roles, bot, actor] = await Promise.all([api(`/guilds/${data.guild_id}`), api(`/guilds/${data.guild_id}/roles`), api(`/guilds/${data.guild_id}/members/${botId}`), api(`/guilds/${data.guild_id}/members/${data.author.id}`)]);
    if (actor.pending || actor.user.id === guild.owner_id) return;
    const context = { guild, roles, bot, actor, settings };
    for (const [, id] of rewards) try { const role = basicRole(context, id, false); if (!actor.roles.includes(role.id)) await api(`/guilds/${guild.id}/members/${actor.user.id}/roles/${role.id}`, { method: "PUT", reason: "Sonata level reward" }); }
    catch { const current = store.settings(guild.id); current.levelsError = "A level reward could not be granted. Review its role permissions and position."; store.saveSettings(guild.id, current); }
}
