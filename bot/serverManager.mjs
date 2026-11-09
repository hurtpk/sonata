/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Buffer } from "node:buffer";
import { canManage, channelPermissions, embed, fail, highestRole, isId, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { dashboardAccess } from "./dashboardAccess.mjs";
import { commandAccess, delegatedRole } from "./commandAccess.mjs";
import { checkOperations } from "./ownerConsole.mjs";
import { COMMANDS } from "./commands.mjs";

export const MANAGEMENT_PERMISSIONS = [
    ["Server", [[0, "Create invites"], [3, "Administrator"], [4, "Manage channels"], [5, "Manage server"], [7, "View audit log"], [10, "View channels"], [27, "Manage nicknames"], [28, "Manage roles"], [29, "Manage webhooks"], [30, "Manage expressions"], [33, "Manage events"], [43, "Create expressions"], [44, "Create events"]]],
    ["Members", [[1, "Kick members"], [2, "Ban members"], [26, "Change nickname"], [40, "Timeout members"]]],
    ["Messages", [[6, "Add reactions"], [11, "Send messages"], [12, "Send text-to-speech messages"], [13, "Manage messages"], [14, "Embed links"], [15, "Attach files"], [16, "Read message history"], [17, "Mention everyone and all roles"], [18, "Use external emojis"], [31, "Use application commands"], [34, "Manage threads"], [35, "Create public threads"], [36, "Create private threads"], [37, "Use external stickers"], [38, "Send messages in threads"], [46, "Send voice messages"], [49, "Send polls"], [50, "Use external apps"], [51, "Pin messages"]]],
    ["Voice", [[8, "Priority speaker"], [9, "Video"], [20, "Connect"], [21, "Speak"], [22, "Mute members"], [23, "Deafen members"], [24, "Move members"], [25, "Use voice activity"], [32, "Request to speak"], [39, "Use activities"], [41, "View creator monetization analytics"], [42, "Use soundboard"], [45, "Use external sounds"], [48, "Set voice channel status"]]]
].map(([group, values]) => ({ group, values: values.map(([bit, name]) => ({ bit: (1n << BigInt(bit)).toString(), name })) }));
export const CHANNEL_TYPES = [{ value: 0, label: "Text" }, { value: 2, label: "Voice" }, { value: 4, label: "Category" }, { value: 5, label: "Announcement" }, { value: 13, label: "Stage" }, { value: 15, label: "Forum" }, { value: 16, label: "Media" }];
const permissionBits = value => { if (typeof value !== "string" || !/^\d{1,20}$/.test(value) || BigInt(value) > (1n << 64n) - 1n) fail("Choose valid permission values."); return BigInt(value); };
const nameOf = value => { if (typeof value !== "string" || !value.trim() || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) fail("Enter a name between 1 and 100 characters."); return value.trim(); };
const above = (member, role, roles, guild) => { const top = highestRole(member, roles, guild.id); return top.position > role.position || (top.position === role.position && BigInt(top.id) < BigInt(role.id)); };
export const ROLE_BODY_LIMIT = 384 * 1024;
const holographic = [11127295, 16759788, 16761760];

function appearance(options, role, guild) {
    const body = {}, features = guild.features ?? [];
    if (options.colors !== undefined) {
        const colors = options.colors;
        if (!colors || typeof colors !== "object" || Array.isArray(colors) || Object.keys(colors).some(key => !["primary_color", "secondary_color", "tertiary_color"].includes(key))) fail("Choose valid role colors.");
        const values = [colors.primary_color, colors.secondary_color ?? null, colors.tertiary_color ?? null];
        if (!Number.isInteger(values[0]) || values.some(value => value !== null && (!Number.isInteger(value) || value < 0 || value > 0xffffff))) fail("Choose colors between #000000 and #ffffff.");
        if (values[2] !== null && !values.every((value, i) => value === holographic[i])) fail("Use Discord's fixed holographic color preset.");
        const old = [role?.colors?.primary_color ?? role?.color ?? 0, role?.colors?.secondary_color ?? null, role?.colors?.tertiary_color ?? null];
        if (!role || values.some((value, i) => value !== old[i])) {
            if (values[1] !== null && !features.includes("ENHANCED_ROLE_COLORS")) fail("This server needs Discord's Enhanced Role Styles perk to use gradient or holographic role colors.");
            body.colors = { primary_color: values[0], secondary_color: values[1], tertiary_color: values[2] };
        }
    } else {
        if (!/^#[0-9a-f]{6}$/i.test(options.color ?? "")) fail("Enter a six-digit hex color, such as #ffad91.");
        const color = parseInt(options.color.slice(1), 16);
        if (!role || color !== (role.colors?.primary_color ?? role.color ?? 0)) body.colors = { primary_color: color, secondary_color: null, tertiary_color: null };
    }
    if (Object.hasOwn(options, "icon")) {
        if (options.icon !== null) {
            if (!features.includes("ROLE_ICONS")) fail("Role icons are not unlocked for this server.");
            if (typeof options.icon !== "string" || options.icon.length > 350_000) fail("Choose a PNG, JPEG or WebP role icon up to 256 KiB.");
            const match = /^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/]+={0,2})$/.exec(options.icon);
            if (!match) fail("Upload a PNG, JPEG or WebP role icon.");
            const bytes = Buffer.from(match[2], "base64"), kind = match[1];
            if (bytes.length < 12 || bytes.length > 256 * 1024 || bytes.toString("base64") !== match[2]) fail("Choose a valid role icon up to 256 KiB.");
            const valid = kind === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : kind === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
            if (!valid) fail("The role icon does not match its image format.");
        }
        body.icon = options.icon; body.unicode_emoji = null;
    }
    return body;
}

export async function serverManager(request, input, actorId, bot, perform) {
    const { api, store } = bot;
    if (!isId(input.guild) || !store.get("SELECT id FROM bot_guilds WHERE id=? AND active=1", input.guild) || store.get("SELECT id FROM guild_blacklist WHERE id=?", input.guild)) fail("Choose an installed, allowed server.");
    const context = await dashboardAccess(api, input.guild, actorId, store), { guild, roles, actor } = context;
    const botMember = await api(`/guilds/${guild.id}/members/${bot.session.userId ?? bot.env.DISCORD_APPLICATION_ID}`);
    const channels = await api(`/guilds/${guild.id}/channels`);
    const actorBits = memberPermissions(actor, roles, guild), botBits = memberPermissions(botMember, roles, guild);
    const roleReason = role => {
        if (role.managed) return "Managed by Discord or another application.";
        if (role.id === store.settings(guild.id).jailRole) return "The jail role is managed by Sonata's jail settings.";
        if (!(actorBits & PERMS.ADMIN) && !(actorBits & PERMS.ROLES)) return "Manage Roles is required.";
        if (!(botBits & PERMS.ADMIN) && !(botBits & PERMS.ROLES)) return "Sonata needs Manage Roles.";
        if (role.id !== guild.id && actorId !== guild.owner_id && !above(actor, role, roles, guild)) return "This role is at or above your highest role.";
        if (role.id !== guild.id && !above(botMember, role, roles, guild)) return "This role is at or above Sonata's highest role.";
        return "";
    };
    const visible = channels.filter(channel => channelPermissions(actor, roles, guild, channel) & PERMS.VIEW);
    if (request.method === "GET") {
        if (input.query !== undefined) {
            if (typeof input.query !== "string" || input.query.length > 100) fail("Search using a name or Discord user ID.");
            const query = input.query.trim();
            if (!query) return { members: [] };
            const members = isId(query) ? [await api(`/guilds/${guild.id}/members/${query}`, { optional: true })].filter(Boolean) : await api(`/guilds/${guild.id}/members/search?query=${encodeURIComponent(query)}&limit=25`);
            return { members: members.map(member => ({ id: member.user.id, name: member.nick || member.user.global_name || member.user.username, username: member.user.username, avatar: member.user.avatar, roles: member.roles, editable: member.user.id !== guild.owner_id && member.user.id !== actorId && member.user.id !== botMember.user.id && (actorId === guild.owner_id || above(actor, highestRole(member, roles, guild.id), roles, guild)) && above(botMember, highestRole(member, roles, guild.id), roles, guild) })) };
        }
        return { guild: guild.id, permissions: MANAGEMENT_PERMISSIONS, channelTypes: CHANNEL_TYPES, roleAppearance: { icons: (guild.features ?? []).includes("ROLE_ICONS"), enhancedColors: (guild.features ?? []).includes("ENHANCED_ROLE_COLORS") },
            canCreateRoles: !!((actorBits & (PERMS.ADMIN | PERMS.ROLES)) && (botBits & (PERMS.ADMIN | PERMS.ROLES))),
            canCreateChannels: !!((actorBits & (PERMS.ADMIN | PERMS.CHANNELS)) && (botBits & (PERMS.ADMIN | PERMS.CHANNELS))),
            roles: roles.map(role => ({ ...role, editable: !roleReason(role), lockedReason: roleReason(role) })).sort((a, b) => b.position - a.position),
            channels: visible.map(channel => ({ ...channel, editable: ((channelPermissions(actor, roles, guild, channel) & PERMS.ADMIN) !== 0n || (channelPermissions(actor, roles, guild, channel) & PERMS.CHANNELS) !== 0n) && ((channelPermissions(botMember, roles, guild, channel) & (PERMS.ADMIN | PERMS.CHANNELS)) !== 0n), permissionsEditable: !!((channelPermissions(actor, roles, guild, channel) & (PERMS.ADMIN | PERMS.ROLES)) && (channelPermissions(botMember, roles, guild, channel) & (PERMS.ADMIN | PERMS.ROLES))) })) };
    }
    if (request.method !== "POST" || typeof input.action !== "string" || !input.options || typeof input.options !== "object" || Array.isArray(input.options)) fail("Choose an available server management action.");
    const o = input.options, roleAction = input.action.startsWith("role-"), name = roleAction ? "role" : "channel";
    if (!["role-create", "role-update", "role-delete", "role-assign", "role-remove", "channel-create", "channel-update", "channel-delete", "channel-permissions", "channel-inherit"].includes(input.action)) fail("Choose an available server management action.");
    const command = { id: `dashboard:${crypto.randomUUID()}`, guild: guild.id, actor: actorId, name, sub: input.action.slice(name.length + 1), options: {}, dashboard: true, definition: COMMANDS.find(command => command.name === name) };
    checkOperations(store, command);
    commandAccess(command, store.settings(guild.id), actor, roles, guild);
    requirePermission(actorBits, roleAction ? PERMS.ROLES : PERMS.CHANNELS);
    requirePermission(botBits, PERMS.ADMIN);
    const record = (kind, target, action) => perform({ ...context, api, bot: botMember, command }, store, kind, target, "Dashboard server management.", 0, action);
    if (roleAction) {
        const role = input.action === "role-create" ? null : roles.find(role => role.id === input.id);
        if (input.action !== "role-create" && (!role || roleReason(role))) fail(role ? roleReason(role) : "Choose a role in this server.", "denied");
        if (role && delegatedRole(store.settings(guild.id), role.id)) requirePermission(actorBits, PERMS.ADMIN);
        if (["role-assign", "role-remove"].includes(input.action)) {
            if (role.id === guild.id || !isId(o.member)) fail("Choose an ordinary role and a member in this server.");
            const target = await api(`/guilds/${guild.id}/members/${o.member}`);
            canManage(actor, target, botMember, roles, guild);
            if (store.restriction(guild.id, target.user.id, "jail")) fail("Release this member from jail before changing their roles.");
            if (input.action === "role-assign") { requirePermission(actorBits, BigInt(role.permissions)); requirePermission(botBits, BigInt(role.permissions)); }
            return { result: await record(input.action === "role-assign" ? "role add" : "role remove", target.user.id, async (_, audit) => { await api(`/guilds/${guild.id}/members/${o.member}/roles/${role.id}`, { method: input.action === "role-assign" ? "PUT" : "DELETE", reason: audit }); store.cancelJobs(guild.id, o.member, `temprole:${role.id}`); return `${input.action === "role-assign" ? "Added" : "Removed"} ${role.name} (${role.id}).`; }) };
        }
        if (input.action === "role-delete") {
            if (role.id === guild.id || o.confirm !== role.id) fail("Confirm the role you want to delete. The everyone role cannot be deleted.");
            return { result: await record("role deleted", role.id, async (_, audit) => { await api(`/guilds/${guild.id}/roles/${role.id}`, { method: "DELETE", reason: audit }); return `Deleted ${role.name}.`; }) };
        }
        const body = {};
        if (role?.id !== guild.id) {
            body.name = nameOf(o.name);
            Object.assign(body, appearance(o, role, guild));
            if (typeof o.hoist !== "boolean" || typeof o.mentionable !== "boolean") fail("Choose role display and mention settings.");
            body.hoist = o.hoist; body.mentionable = o.mentionable;
        }
        if (o.permissions !== undefined) {
            const permissions = permissionBits(o.permissions), added = permissions & ~BigInt(role?.permissions ?? "0");
            requirePermission(actorBits, added); requirePermission(botBits, added);
            body.permissions = permissions.toString();
        }
        return { result: await record(role ? "role updated" : "role created", role?.id ?? guild.id, async (_, audit) => { const saved = await api(`/guilds/${guild.id}/roles${role ? "/" + role.id : ""}`, { method: role ? "PATCH" : "POST", body, reason: audit }); return `${role ? "Updated" : "Created"} ${saved.name} (${saved.id}).`; }) };
    }
    const channel = input.action === "channel-create" ? null : visible.find(channel => channel.id === input.id);
    if (input.action !== "channel-create" && !channel) fail("Choose an accessible channel in this server.");
    if (channel) { requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW | PERMS.CHANNELS); requirePermission(channelPermissions(botMember, roles, guild, channel), PERMS.VIEW | PERMS.CHANNELS); }
    if (input.action === "channel-delete") {
        if (o.confirm !== channel.id) fail("Confirm the channel you want to delete.");
        return { result: await record("channel deleted", channel.id, async (_, audit) => { await api(`/channels/${channel.id}`, { method: "DELETE", reason: audit }); return `Deleted ${CHANNEL_TYPES.find(type => type.value === channel.type)?.label ?? "channel"} ${channel.name}.`; }) };
    }
    if (["channel-permissions", "channel-inherit"].includes(input.action)) {
        requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.ROLES); requirePermission(channelPermissions(botMember, roles, guild, channel), PERMS.ROLES);
        if (![0, 1].includes(o.type) || !isId(o.target)) fail("Choose a role or member permission overwrite.");
        if (o.type === 0 ? !roles.some(role => role.id === o.target) : !await api(`/guilds/${guild.id}/members/${o.target}`, { optional: true })) fail("Choose a role or member in this server.");
        const body = { type: o.type };
        if (input.action === "channel-permissions") {
            const allow = permissionBits(o.allow), deny = permissionBits(o.deny);
            if (allow & deny) fail("A permission cannot be both allowed and denied.");
            requirePermission(actorBits, allow | deny); requirePermission(botBits, allow | deny);
            body.allow = allow.toString(); body.deny = deny.toString();
        }
        return { result: await record("channel permissions", channel.id, async (_, audit) => { await api(`/channels/${channel.id}/permissions/${o.target}`, { method: input.action === "channel-inherit" ? "DELETE" : "PUT", ...(input.action === "channel-permissions" ? { body } : {}), reason: audit }); return `Updated permissions for ${o.target}.`; }) };
    }
    const type = channel?.type ?? o.type;
    if (!CHANNEL_TYPES.some(entry => entry.value === type)) fail("Choose a supported channel type.");
    const body = { name: nameOf(o.name), ...(!channel ? { type } : {}) };
    if (type !== 4) {
        if (o.parent !== null && !visible.some(parent => parent.id === o.parent && parent.type === 4)) fail("Choose a category in this server, or no category.");
        if (o.parent) { const parent = channels.find(parent => parent.id === o.parent); requirePermission(channelPermissions(actor, roles, guild, parent), PERMS.CHANNELS | PERMS.VIEW); requirePermission(channelPermissions(botMember, roles, guild, parent), PERMS.CHANNELS | PERMS.VIEW); }
        body.parent_id = o.parent;
        if ([0, 5, 15, 16].includes(type)) { if (typeof o.topic !== "string" || o.topic.length > ([15, 16].includes(type) ? 4096 : 1024) || typeof o.nsfw !== "boolean" || !Number.isInteger(o.slowmode) || o.slowmode < 0 || o.slowmode > 21600) fail("Choose valid topic, age restriction and slowmode settings (0 to 21,600 seconds)."); body.topic = o.topic; body.nsfw = o.nsfw; body.rate_limit_per_user = o.slowmode; }
        if ([2, 13].includes(type)) { if (!Number.isInteger(o.userLimit) || o.userLimit < 0 || o.userLimit > 99) fail("Voice user limits must be between 0 (unlimited) and 99."); body.user_limit = o.userLimit; }
        if (!channel && o.parent) body.permission_overwrites = channels.find(parent => parent.id === o.parent).permission_overwrites;
    }
    return { result: await record(channel ? "channel updated" : "channel created", channel?.id ?? guild.id, async (_, audit) => { const saved = await api(channel ? `/channels/${channel.id}` : `/guilds/${guild.id}/channels`, { method: channel ? "PATCH" : "POST", body, reason: audit }); return `${channel ? "Updated" : "Created"} ${CHANNEL_TYPES.find(entry => entry.value === type).label.toLowerCase()} ${saved.name} (${saved.id}).`; }) };
}
