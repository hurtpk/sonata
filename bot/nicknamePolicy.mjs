/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { canManage, embed, fail, memberPermissions, PERMS, requirePermission } from "./discord.mjs";

const normalized = name => name.normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase();
export function nicknameIssue(name, config) {
    const value = normalized(name);
    if (config.words.some(word => value.includes(word))) return "Contains a blocked phrase.";
    if ([...value.replace(/[\p{L}\p{N}\p{M}\s]/gu, "")].length > config.symbols) return `Contains more than ${config.symbols} symbols.`;
    return "";
}
const exempt = (target, guild, roles, config) => target.user.bot || target.user.id === guild.owner_id || !!(memberPermissions(target, roles, guild) & PERMS.ADMIN) || target.roles.some(id => config.exempt.includes(id));

export async function nicknamePolicy(context, store) {
    const { command, guild, roles, api } = context, settings = store.settings(guild.id), o = command.options;
    const config = settings.nicknamePolicy ?? { enabled: false, symbols: 8, fallback: "Member", words: [], exempt: [] };
    if (command.sub === "view") return embed("Nickname policy", `Enabled: ${config.enabled ? "Yes" : "No"}\nMaximum symbols: ${config.symbols}\nReplacement nickname: ${config.fallback}\nBlocked phrases: ${config.words.join(", ") || "None"}\nExempt roles: ${config.exempt.map(id => `<@&${id}>`).join(" ") || "None"}\n\nChecked when members join or change their server profile. Bots, the owner and administrators are exempt. Existing members are checked on their next update.${settings.nicknamePolicyError ? `\n\nLast enforcement issue: ${settings.nicknamePolicyError.message}` : ""}`);
    if (command.sub === "check") {
        const target = await api(`/guilds/${guild.id}/members/${o.member}`), name = target.nick || target.user.global_name || target.user.username;
        return embed("Nickname policy preview", `<@${target.user.id}>: ${exempt(target, guild, roles, config) ? "Exempt." : nicknameIssue(name, config) || "Passes the policy."}\n${config.enabled ? "Policy is enabled." : "Policy is off."} This preview does not change their nickname.`);
    }
    if (command.sub === "setup") { context.botPermission(PERMS.NICKNAMES); config.enabled = true; config.symbols = o.symbols ?? config.symbols; config.fallback = o.fallback?.trim() || config.fallback; }
    if (command.sub === "off") config.enabled = false;
    if (["block", "unblock"].includes(command.sub)) {
        const word = normalized(o.phrase).trim();
        if (!word || word.length > 40) fail("Use a blocked phrase between one and forty characters.");
        config.words = command.sub === "block" ? [...new Set([...config.words, word])] : config.words.filter(value => value !== word);
        if (config.words.length > 30) fail("Use at most thirty blocked nickname phrases.");
    }
    if (command.sub === "exempt") {
        if (!roles.some(role => role.id === o.role && role.id !== guild.id)) fail("Choose a role in this server other than everyone.");
        config.exempt = o.enabled ? [...new Set([...config.exempt, o.role])] : config.exempt.filter(id => id !== o.role);
        if (config.exempt.length > 20) fail("Use at most twenty exempt roles.");
    }
    if (nicknameIssue(config.fallback, config)) fail("The replacement nickname must pass the policy. Choose another replacement or adjust the blocked phrases and symbol limit.");
    settings.nicknamePolicy = config; store.saveSettings(guild.id, settings);
    return embed("Nickname policy saved", `Policy is ${config.enabled ? "enabled" : "off"}. Matching names are replaced with **${config.fallback}** in this server only. The account's username is unchanged. Corrections appear in case history and the configured moderation log.`);
}

export async function nicknameEvent(data, store, api, botId, requestId, perform) {
    const settings = store.settings(data.guild_id), config = settings.nicknamePolicy;
    if (!config?.enabled || !data.user || data.user.bot) return;
    const [guild, roles, bot, target] = await Promise.all([api(`/guilds/${data.guild_id}`), api(`/guilds/${data.guild_id}/roles`), api(`/guilds/${data.guild_id}/members/${botId}`), api(`/guilds/${data.guild_id}/members/${data.user.id}`, { optional: true })]);
    if (!target || target.pending || exempt(target, guild, roles, config) || store.restriction(guild.id, target.user.id, "jail")) return;
    const issue = nicknameIssue(target.nick || target.user.global_name || target.user.username, config);
    if (!issue || !store.claim(requestId)) return;
    try {
        requirePermission(memberPermissions(bot, roles, guild), PERMS.NICKNAMES);
        canManage({ user: { id: guild.owner_id }, roles: [] }, target, bot, roles, guild);
        await perform({ command: { id: requestId, guild: guild.id, actor: botId }, guild, api }, store, "nickname policy", target.user.id, issue, 0, async (_, audit) => {
            await api(`/guilds/${guild.id}/members/${target.user.id}`, { method: "PATCH", body: { nick: config.fallback }, reason: audit });
            return "Applied the configured replacement nickname.";
        });
    } catch (error) {
        const current = store.settings(guild.id); current.nicknamePolicyError = { at: Date.now(), message: error.message }; store.saveSettings(guild.id, current);
    }
}
