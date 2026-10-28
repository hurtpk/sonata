/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { COMMANDS } from "./commands.mjs";
import { channelPermissions, embed, fail, PERMS, requirePermission } from "./discord.mjs";

const usage = (name, options) => `${name} ${options.map(option => option.required ? `<${option.name}>` : `[${option.name}]`).join(" ")}`.trim();
const created = id => `<t:${Math.floor(Number((BigInt(id) >> 22n) + 1420070400000n) / 1000)}:F>`;
const timestamp = value => value && Number.isFinite(Date.parse(value)) ? `<t:${Math.floor(Date.parse(value) / 1000)}:F>` : "Unknown";

export function help(command) {
    const query = command.options.command?.trim().toLowerCase();
    if (query && !/^\d+$/.test(query)) {
        const [name, sub] = query.replace(/^[,/]/, "").split(/\s+/), definition = COMMANDS.find(value => value.name === name || value.aliases.includes(name));
        if (!definition) fail("That command does not exist. Use help to browse the available commands.");
        const entries = definition.options[0]?.type === 1 ? definition.options.filter(value => !sub || value.name === sub) : [definition];
        if (!entries.length) fail("That subcommand does not exist.");
        return embed(`Help · ${definition.name}`, `${definition.description}\n\n` + entries.map(value => `\`${usage(value === definition ? definition.name : `${definition.name} ${value.name}`, value.options)}\`\n${value.description}`).join("\n\n") + (definition.aliases.length ? `\n\nPrefix aliases: ${definition.aliases.join(", ")}.` : "") + "\n\nUse slash commands or your server's prefix. <Required> · [Optional]");
    }
    const pages = Math.ceil(COMMANDS.length / 10), page = query ? Number(query) : 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > pages) fail(`Choose a help page from 1 to ${pages}.`);
    return embed(`Sonata Bot commands · ${page}/${pages}`, COMMANDS.slice((page - 1) * 10, page * 10).map(value => `**${value.name}** · ${value.description}`).join("\n\n") + `\n\nUse help <command> for its syntax and subcommands.${page < pages ? ` Next page: help ${page + 1}.` : ""}\nSlash commands and your server's prefix both work.`);
}

export async function information(context) {
    const { command, api, guild, roles, actor, bot } = context, options = command.options;
    if (["userinfo", "avatar", "banner"].includes(command.name)) {
        const member = await api(`/guilds/${guild.id}/members/${options.member ?? command.actor}`), user = command.name === "banner" ? await api(`/users/${member.user.id}`) : member.user;
        if (command.name === "userinfo") return embed(user.global_name || user.username || user.id, `User: <@${user.id}>\nID: ${user.id}\nUsername: ${user.username ?? "Unknown"}\nNickname: ${member.nick || "None"}\nBot: ${user.bot ? "Yes" : "No"}\nAccount created: ${created(user.id)}\nJoined: ${timestamp(member.joined_at)}\nTimeout ends: ${timestamp(member.communication_disabled_until)}\nRoles: ${member.roles.slice(0, 15).map(id => `<@&${id}>`).join(" ") || "None"}${member.roles.length > 15 ? ` and ${member.roles.length - 15} more` : ""}`);
        const hash = command.name === "banner" ? user.banner : user.avatar;
        if (command.name === "banner" && !hash) return embed("No banner", "That member has no public profile banner.");
        if (hash && !/^(?:a_)?[a-f0-9]{32}$/i.test(hash)) fail("Discord returned an unsupported profile image.");
        const index = user.discriminator && user.discriminator !== "0" ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n);
        const url = hash ? `https://cdn.discordapp.com/${command.name === "banner" ? "banners" : "avatars"}/${user.id}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=1024` : `https://cdn.discordapp.com/embed/avatars/${index}.png`;
        const response = embed(`${user.username || user.id} · ${command.name}`, `[Open image](${url})`);
        response.embeds[0].image = { url }; return response;
    }
    if (["serverinfo", "membercount"].includes(command.name)) {
        const server = await api(`/guilds/${guild.id}?with_counts=true`);
        const counts = `Members (approximate): ${server.approximate_member_count ?? "Unavailable"}\nOnline (approximate): ${server.approximate_presence_count ?? "Unavailable"}`;
        if (command.name === "membercount") return embed("Member count", counts);
        return embed(server.name, `ID: ${server.id}\nOwner: <@${server.owner_id}>\nCreated: ${created(server.id)}\n${counts}\nRoles: ${roles.length}\nBoosts: ${server.premium_subscription_count ?? 0}\nBoost level: ${server.premium_tier ?? 0}\nVerification level: ${server.verification_level ?? 0}\nDescription: ${server.description || "None"}`);
    }
    if (command.name === "roleinfo") {
        const role = roles.find(value => value.id === options.role); if (!role) fail("Choose a role in this server.");
        return embed(role.name, `ID: ${role.id}\nCreated: ${created(role.id)}\nPosition: ${role.position}\nColour: #${(role.colors?.primary_color ?? role.color ?? 0).toString(16).padStart(6, "0")}\nManaged by an integration: ${role.managed ? "Yes" : "No"}\nShown separately: ${role.hoist ? "Yes" : "No"}\nMentionable: ${role.mentionable ? "Yes" : "No"}\nPermissions: ${Object.entries(PERMS).filter(([, bits]) => BigInt(role.permissions) & bits).map(([name]) => name).join(", ") || "None of Sonata's listed permissions"}\nFull permission value: ${role.permissions}`);
    }
    if (command.name === "roles") {
        const sorted = [...roles].sort((a, b) => b.position - a.position), pages = Math.max(1, Math.ceil(sorted.length / 15)), page = options.page ?? 1;
        if (page > pages) fail(`Choose a role page from 1 to ${pages}.`);
        return embed(`Server roles · ${page}/${pages}`, sorted.slice((page - 1) * 15, page * 15).map(role => `<@&${role.id}> · ${role.id}${role.managed ? " · integration" : ""}`).join("\n"));
    }
    const channel = options.channel ? await api(`/channels/${options.channel}`) : context.channel;
    if (channel.guild_id !== guild.id || [10, 11, 12].includes(channel.type)) fail("Choose a regular channel in this server.");
    requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW);
    requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW);
    return embed(channel.name || "Channel information", `ID: ${channel.id}\nCreated: ${created(channel.id)}\nType: ${channel.type}\nCategory: ${channel.parent_id ? `<#${channel.parent_id}>` : "None"}\nAge restricted: ${channel.nsfw ? "Yes" : "No"}\nSlowmode: ${channel.rate_limit_per_user ?? 0} seconds\nTopic: ${channel.topic || "None"}${channel.type === 2 ? `\nVoice user limit: ${channel.user_limit || "Unlimited"}` : ""}`);
}
