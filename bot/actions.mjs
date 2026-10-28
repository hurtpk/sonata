/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { channelPermissions, embed, fail, highestRole, isId, memberPermissions, PERMS, requirePermission } from "./discord.mjs";

export const EXTRA_COMMANDS = ["softban", "banlist", "nickname", "warnremove", "warnclear", "role", "voice", "channel", "pin", "unpin", "pins"];

export async function extraCommand(context, store, perform) {
    const { command, api, guild, roles, actor, bot } = context, options = command.options, reason = options.reason ?? "No reason supplied.";
    const record = (kind, target, action) => perform(context, store, kind, target, reason, 0, action);
    if (command.name === "banlist") {
        context.botPermission(PERMS.BAN);
        if (options.after && !isId(options.after)) fail("Use a user ID for the ban list cursor.");
        const bans = await api(`/guilds/${guild.id}/bans?limit=8${options.after ? `&after=${options.after}` : ""}`);
        return embed("Server bans", bans.length ? bans.map(ban => `**${ban.user.username || ban.user.id}** · ${ban.user.id}\n${String(ban.reason || "No reason supplied.").slice(0, 90)}`).join("\n\n") + (bans.length === 8 ? `\n\nFor more, use banlist ${bans.at(-1).user.id}.` : "") : "No bans found on this page.");
    }
    if (["warnremove", "warnclear"].includes(command.name)) {
        const row = command.name === "warnremove" ? store.case(guild.id, options.case) : null;
        if (command.name === "warnremove" && (!row || row.kind !== "warn" || row.status !== "completed")) fail("Choose an active warning case in this server.");
        const target = row?.target ?? options.member;
        await context.target(target, true);
        const warnings = row ? [row] : store.all("SELECT * FROM cases WHERE guild=? AND target=? AND kind='warn' AND status='completed'", guild.id, target);
        if (!warnings.length) fail("That member has no active warnings.");
        return record(command.name === "warnremove" ? "warning removed" : "warnings cleared", target, () => {
            for (const warning of warnings) { store.addNote(guild.id, warning.n, command.actor, "warning cleared", reason); store.status(guild.id, warning.n, "cleared", warning.detail); }
            return `${warnings.length} warning${warnings.length === 1 ? "" : "s"} cleared. Original cases, notes and evidence are kept.`;
        });
    }
    if (command.name === "softban") {
        const target = await context.target(options.member); context.botPermission(PERMS.BAN);
        if (await api(`/guilds/${guild.id}/bans/${target.user.id}`, { optional: true })) fail("That user is already banned. Use unban after reviewing the existing ban.");
        return record("softban", target.user.id, async (_, audit) => {
            await api(`/guilds/${guild.id}/bans/${target.user.id}`, { method: "PUT", body: { delete_message_seconds: options.days * 86400 }, reason: audit });
            store.cancelJobs(guild.id, target.user.id, "tempban");
            await api(`/guilds/${guild.id}/bans/${target.user.id}`, { method: "DELETE", reason: audit });
            return `Removed the member and up to ${options.days} days of messages. They may rejoin with an invite.`;
        });
    }
    if (command.name === "nickname") {
        const target = await context.target(options.member); context.botPermission(PERMS.NICKNAMES);
        const nick = options.name?.trim() || null;
        return record("nickname", target.user.id, async (_, audit) => { await api(`/guilds/${guild.id}/members/${target.user.id}`, { method: "PATCH", body: { nick }, reason: audit }); return nick ? `Nickname changed to ${nick}.` : "Nickname reset."; });
    }
    if (command.name === "role") {
        context.botPermission(PERMS.ROLES);
        if (command.sub === "create") {
            const name = options.name.trim(); if (!name) fail("Choose a role name with visible characters.");
            return record("role created", guild.id, async (_, audit) => { const role = await api(`/guilds/${guild.id}/roles`, { method: "POST", body: { name, permissions: "0", mentionable: false }, reason: audit }); return `Created <@&${role.id}> without extra permissions.`; });
        }
        const role = roles.find(value => value.id === options.role);
        if (!role || role.id === guild.id || role.managed || role.id === store.settings(guild.id).jailRole) fail("Choose an ordinary role in this server, other than the jail role.");
        const above = member => { const top = highestRole(member, roles, guild.id); return top.position > role.position || (top.position === role.position && BigInt(top.id) < BigInt(role.id)); };
        if (actor.user.id !== guild.owner_id && !above(actor)) fail("Your highest role must be above the role you manage.");
        if (!above(bot)) fail("Sonata Bot's highest role must be above the role it manages.");
        if (["add", "remove"].includes(command.sub)) {
            const target = await context.target(options.member);
            if (store.restriction(guild.id, target.user.id, "jail")) fail("Release this member from jail before changing their roles.");
            if (command.sub === "add") {
                requirePermission(memberPermissions(actor, roles, guild), BigInt(role.permissions));
                requirePermission(memberPermissions(bot, roles, guild), BigInt(role.permissions));
            }
            return record(`role ${command.sub}`, target.user.id, async (_, audit) => { await api(`/guilds/${guild.id}/members/${target.user.id}/roles/${role.id}`, { method: command.sub === "add" ? "PUT" : "DELETE", reason: audit }); return `${command.sub === "add" ? "Added" : "Removed"} <@&${role.id}>.`; });
        }
        let body;
        if (command.sub === "rename") { const name = options.name.trim(); if (!name) fail("Choose a role name with visible characters."); body = { name }; }
        if (command.sub === "color") {
            if (!/^(?:#?[a-f0-9]{6}|default)$/i.test(options.color)) fail("Use a six-digit hex colour, such as #a78bfa, or default.");
            body = { colors: { primary_color: options.color.toLowerCase() === "default" ? 0 : parseInt(options.color.replace(/^#/, ""), 16) } };
        }
        if (["hoist", "mentionable"].includes(command.sub)) body = { [command.sub]: options.enabled };
        return record(`role ${command.sub}`, role.id, async (_, audit) => { await api(`/guilds/${guild.id}/roles/${role.id}`, { method: "PATCH", body, reason: audit }); return `Updated <@&${role.id}>.`; });
    }
    if (command.name === "voice") {
        const permission = ["move", "disconnect"].includes(command.sub) ? PERMS.MOVE : ["mute", "unmute"].includes(command.sub) ? PERMS.VOICE_MUTE : PERMS.VOICE_DEAFEN;
        const target = await context.target(options.member), state = await api(`/guilds/${guild.id}/voice-states/${target.user.id}`, { optional: true });
        if (!state?.channel_id) fail("That member is not connected to voice.");
        const current = await api(`/channels/${state.channel_id}`);
        if (current.guild_id !== guild.id) fail("Choose a voice channel in this server.");
        requirePermission(channelPermissions(actor, roles, guild, current), permission | PERMS.VIEW);
        requirePermission(channelPermissions(bot, roles, guild, current), permission | PERMS.VIEW | PERMS.CONNECT);
        let body;
        if (command.sub === "move") {
            if (store.restriction(guild.id, target.user.id, "jail")) fail("Release this member from jail before moving them to another channel.");
            const destination = await api(`/channels/${options.channel}`);
            if (destination.guild_id !== guild.id || destination.type !== 2) fail("Choose a regular voice channel in this server.");
            requirePermission(channelPermissions(actor, roles, guild, destination), PERMS.VIEW | PERMS.CONNECT | PERMS.MOVE);
            requirePermission(channelPermissions(bot, roles, guild, destination), PERMS.VIEW | PERMS.CONNECT | PERMS.MOVE);
            body = { channel_id: destination.id };
        }
        if (command.sub === "disconnect") body = { channel_id: null };
        if (["mute", "unmute"].includes(command.sub)) body = { mute: command.sub === "mute" };
        if (["deafen", "undeafen"].includes(command.sub)) body = { deaf: command.sub === "deafen" };
        return record(`voice ${command.sub}`, target.user.id, async (_, audit) => { await api(`/guilds/${guild.id}/members/${target.user.id}`, { method: "PATCH", body, reason: audit }); return "The member's server voice state was updated."; });
    }
    if (command.name === "channel") {
        const channel = command.sub === "userlimit" ? await api(`/channels/${options.channel}`) : context.channel;
        if (channel.guild_id !== guild.id) fail("Choose a channel in this server.");
        requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW | PERMS.CHANNELS);
        requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.CHANNELS);
        let body;
        if (command.sub === "userlimit") { if (channel.type !== 2) fail("Choose a regular voice channel."); body = { user_limit: options.limit }; }
        else {
            if (![0, 5, 15, 16].includes(channel.type)) fail("Use this command in a text, announcement, forum or media channel.");
            if (command.sub === "name") { const name = options.name.trim(); if (!name) fail("Choose a channel name with visible characters."); body = { name }; }
            if (command.sub === "topic") body = { topic: options.topic ?? "" };
            if (command.sub === "nsfw") body = { nsfw: options.enabled };
        }
        return record(`channel ${command.sub}`, channel.id, async (_, audit) => { await api(`/channels/${channel.id}`, { method: "PATCH", body, reason: audit }); return "Channel settings updated."; });
    }
    if (![0, 5].includes(context.channel.type)) fail("Use this command in a server text or announcement channel.");
    requirePermission(channelPermissions(actor, roles, guild, context.channel), PERMS.VIEW | PERMS.HISTORY | (command.name === "pins" ? 0n : PERMS.PINS));
    context.botPermission(PERMS.VIEW | PERMS.HISTORY | (command.name === "pins" ? 0n : PERMS.PINS), true);
    if (command.name === "pins") {
        if (options.before && (!/^\d{4}-\d{2}-\d{2}T/.test(options.before) || !Number.isFinite(Date.parse(options.before)))) fail("Use the ISO timestamp shown on the previous pin page.");
        const page = await api(`/channels/${context.channel.id}/messages/pins?limit=8${options.before ? `&before=${encodeURIComponent(new Date(options.before).toISOString())}` : ""}`);
        return embed("Pinned messages", page.items.length ? page.items.map(item => `[Open message](https://discord.com/channels/${guild.id}/${context.channel.id}/${item.message.id}) · <@${item.message.author.id}>`).join("\n") + (page.has_more ? `\n\nFor older pins: pins ${page.items.at(-1).pinned_at}` : "") : "No pinned messages found on this page.");
    }
    const match = /^(?:https:\/\/(?:discord\.com|discordapp\.com)\/channels\/(\d{17,20})\/(\d{17,20})\/)?(\d{17,20})$/.exec(options.message);
    if (!match || (match[1] && (match[1] !== guild.id || match[2] !== context.channel.id))) fail("Use a message ID or link from this channel.");
    await api(`/channels/${context.channel.id}/messages/${match[3]}`);
    return record(command.name, context.channel.id, async (_, audit) => { await api(`/channels/${context.channel.id}/messages/pins/${match[3]}`, { method: command.name === "pin" ? "PUT" : "DELETE", reason: audit }); return command.name === "pin" ? "Message pinned." : "Message unpinned."; });
}
