/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openModlogs } from "./modlogs.mjs";
import { COMMANDS } from "./commands.mjs";
import { messageChannel, safeAutorole } from "./community.mjs";
import { embed, fail, highestRole, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { button, rows } from "./interactionUI.mjs";
import { delegatedRole } from "./commandAccess.mjs";

export function basicRole(context, id, configuring = true) {
    const role = context.roles.find(role => role.id === id);
    if (!role || role.id === context.guild.id || !safeAutorole(role) || delegatedRole(context.settings ?? {}, id) || role.id === context.settings?.jailRole || role.position >= highestRole(context.bot, context.roles, context.guild.id).position) fail("Choose an ordinary, unmanaged role below Sonata, without moderation permissions.");
    if (configuring && context.actor.user.id !== context.guild.owner_id && role.position >= highestRole(context.actor, context.roles, context.guild.id).position) fail("Choose a role below your own highest role.");
    return role;
}

export async function verificationCommand(context, store, verify = false) {
    const { command, guild, actor, bot, roles, api } = context, settings = store.settings(guild.id), config = settings.verification;
    if (verify || command.sub === "approve") {
        if (!config?.enabled) fail("Verification is disabled.");
        const target = verify ? actor : await context.target(command.options.member);
        if (!verify) requirePermission(memberPermissions(actor, roles, guild), PERMS.GUILD | PERMS.ROLES);
        if (target.user.bot || target.pending || store.restriction(guild.id, target.user.id, "jail")) fail("Finish Discord membership screening first. Bots and jailed accounts cannot use verification.");
        if (verify && Date.now() - Number((BigInt(target.user.id) >> 22n) + 1420070400000n) < config.age * 3600_000) fail(`Your account must be at least ${config.age} hours old. Server staff can review an override.`);
        const role = basicRole({ ...context, settings }, config.role, false);
        requirePermission(memberPermissions(bot, roles, guild), PERMS.ROLES);
        if (target.roles.includes(role.id)) return embed("Already verified", "You already have the configured member role.");
        await api(`/guilds/${guild.id}/members/${target.user.id}/roles/${role.id}`, { method: "PUT", reason: verify ? "Sonata member verification" : `Sonata verification override by ${actor.user.id}` });
        return embed("Member verified", `<@${target.user.id}> received <@&${role.id}>.`);
    }
    if (command.sub === "view") return embed("Verification", config ? `Enabled: ${config.enabled ? "Yes" : "No"}\nMember role: <@&${config.role}>\nMinimum account age: ${config.age} hours` : "Not configured.");
    requirePermission(memberPermissions(actor, roles, guild), PERMS.GUILD | PERMS.ROLES);
    context.botPermission(PERMS.ROLES);
    if (command.sub === "setup") { basicRole({ ...context, settings }, command.options.role); settings.verification = { enabled: true, role: command.options.role, age: command.options.age }; }
    if (command.sub === "off" && config) config.enabled = false;
    if (command.sub === "panel") {
        if (!config?.enabled) fail("Set up verification first.");
        await messageChannel(context, command.options.channel);
        const posted = await api(`/channels/${command.options.channel}/messages`, { method: "POST", body: { ...embed("Join the community", `Complete the server's rules screening, then verify to receive <@&${config.role}>. Minimum account age: ${config.age} hours.`), components: rows([button(`snverify:${guild.id}`, "Verify", 3)]) } });
        config.panel = { message: posted.id, channel: command.options.channel };
    }
    store.saveSettings(guild.id, settings);
    return embed("Verification saved", "Only the approved basic role can be granted. Age checks do not replace a human verification challenge.");
}

export function aliasCommand(context, store) {
    const settings = store.settings(context.guild.id), o = context.command.options, aliases = settings.aliases ?? {};
    if (context.command.sub === "list") return embed("Server aliases", Object.entries(aliases).map(([name, target]) => `**${name}** → ${target}`).join("\n") || "No custom aliases.");
    const name = o.name.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name) || ["constructor", "prototype", "__proto__"].includes(name) || COMMANDS.some(command => command.name === name || command.aliases.includes(name))) fail("Choose a new shortcut name without replacing an existing command or built-in alias.");
    if (context.command.sub === "remove") delete aliases[name];
    else {
        const target = o.target.trim(), [root, sub] = target.split(/\s+/), definition = COMMANDS.find(command => command.name === root || command.aliases.includes(root));
        if (!definition || definition.name === "alias" || target.length > 200 || (definition.options[0]?.type === 1 && !definition.options.some(value => value.name === sub))) fail("Use an existing command, including its subcommand when needed. Aliases cannot target other custom aliases.");
        if (!Object.hasOwn(aliases, name) && Object.keys(aliases).length >= 50) fail("Use at most fifty custom aliases.");
        aliases[name] = definition.name + target.slice(root.length);
    }
    settings.aliases = aliases; store.saveSettings(context.guild.id, settings);
    return embed("Alias saved", "Shortcuts use the original command's validation and permissions.");
}

export function afkCommand(context, store) {
    const { command, guild, actor } = context;
    if (command.sub === "view") { const found = store.get("SELECT * FROM afk WHERE guild=? AND user=?", guild.id, command.options.member); return embed("Away status", found ? `<@${found.user}> · ${found.message}\nAway since <t:${Math.floor(found.at / 1000)}:R>.` : "This member has no away status."); }
    if (command.sub === "clear") { store.run("DELETE FROM afk WHERE guild=? AND user=?", guild.id, actor.user.id); return embed("Welcome back", "Your away status was cleared."); }
    store.run("INSERT INTO afk VALUES (?,?,?,?) ON CONFLICT(guild,user) DO UPDATE SET message=excluded.message,at=excluded.at", guild.id, actor.user.id, command.options.message || "Away for now.", Date.now());
    return embed("Away status set", "People who mention you can see your away message. Your next message outside the afk command clears it.");
}

export function moderationStats(store, guild, days = 30, actor) {
    const since = Date.now() - days * 86400_000, where = actor ? "guild=? AND actor=? AND at>=?" : "guild=? AND at>=?", params = actor ? [guild, actor, since] : [guild, since], day = new Date(since).toISOString().slice(0, 10);
    const counts = store.get(`SELECT COUNT(*) AS total,SUM(CASE WHEN status IN ('completed','cleared','expired') THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN status='needs_review' THEN 1 ELSE 0 END) AS needsReview FROM cases WHERE ${where}`, ...params);
    return { days, total: counts.total, completed: counts.completed || 0, needsReview: counts.needsReview || 0, actions: Object.fromEntries(store.all(`SELECT kind,COUNT(*) AS n FROM cases WHERE ${where} GROUP BY kind`, ...params).map(row => [row.kind, row.n])), staff: Object.fromEntries(store.all(`SELECT actor,COUNT(*) AS n FROM cases WHERE ${where} GROUP BY actor ORDER BY n DESC LIMIT 10`, ...params).map(row => [row.actor, row.n])), appeals: store.all("SELECT status,COUNT(*) AS n FROM appeals WHERE guild=? AND at>=? GROUP BY status", guild, since), usage: store.all("SELECT name,SUM(uses) AS n FROM command_usage WHERE guild=? AND day>=? GROUP BY name ORDER BY n DESC LIMIT 10", guild, day), totalUses: store.get("SELECT COALESCE(SUM(uses),0) AS n FROM command_usage WHERE guild=? AND day>=?", guild, day).n };
}
export function statsCommand(context, store) {
    if(context.command.sub === "staff") return openModlogs(context,store,true);
    const stats = moderationStats(store, context.guild.id, context.command.options.days ?? 30, context.command.sub === "staff" ? context.command.options.member : undefined);
    return embed(`Moderation · past ${stats.days} days`, context.command.sub === "appeals" ? stats.appeals.map(row => `${row.status}: ${row.n}`).join("\n") || "No appeals in this period." : context.command.sub === "actions" ? Object.entries(stats.actions).map(([kind, n]) => `${kind}: ${n}`).join("\n") || "No cases in this period." : `Cases: ${stats.total}\nCompleted: ${stats.completed}\nNeeds review: ${stats.needsReview}\n\n` + Object.entries(stats.staff).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => `<@${id}>: ${n} cases`).join("\n"));
}
