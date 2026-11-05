/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { option, sub } from "./commandOptions.mjs";
import { channelPermissions, embed, memberPermissions, PERMS, requirePermission } from "./discord.mjs";

export const PERMISSION_AUDIT_OPTIONS = [
    sub("audit", "Review risky roles, public channel exposure and permission changes", [option("scope", 3, "Show all findings, roles, channels or changes", false, { choices: ["all", "roles", "channels", "changes"].map(value => ({ name: value, value })) }), option("page", 4, "Audit results page", false, { min_value: 1, max_value: 100 })]),
    sub("auditbaseline", "Save current role and channel permissions for comparison"),
];
const risks = [
    [PERMS.ADMIN, "Administrator"], [PERMS.GUILD, "Manage Server"], [PERMS.ROLES, "Manage Roles"],
    [PERMS.CHANNELS, "Manage Channels"], [PERMS.BAN, "Ban Members"], [PERMS.KICK, "Kick Members"],
    [PERMS.TIMEOUT, "Timeout Members"], [PERMS.MESSAGES, "Manage Messages"], [536870912n, "Manage Webhooks"],
];
const names = bits => risks.filter(([bit]) => (bits & bit) !== 0n).map(([, name]) => name).join(", ");

export async function permissionAudit(context, store) {
    const { command, api, guild, roles, actor } = context, o = command.options;
    requirePermission(memberPermissions(actor, roles, guild), PERMS.ADMIN);
    const channels = await api("/guilds/" + guild.id + "/channels"), guest = { user: { id: "0" }, roles: [] }, guestRoles = roles.filter(role => role.id === guild.id);
    const publicChannel = channel => !!(channelPermissions(guest, guestRoles, guild, channel) & PERMS.VIEW);
    const byId = new Map(channels.map(channel => [channel.id, channel])), encoder = new TextEncoder();
    const snapshot = {
        roles: Object.fromEntries(roles.map(role => [role.id, role.permissions])),
        channels: Object.fromEntries(await Promise.all(channels.map(async channel => {
            const permissions = (channel.permission_overwrites ?? []).map(row => [row.type, row.id, row.allow, row.deny].join(":")).sort().join("|");
            const digest = await crypto.subtle.digest("SHA-256", encoder.encode(permissions));
            return [channel.id, { public: publicChannel(channel), hash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") }];
        }))),
    };
    if (command.sub === "auditbaseline") {
        store.run("INSERT INTO permission_audits VALUES (?,?,?,?) ON CONFLICT(guild) DO UPDATE SET data=excluded.data,actor=excluded.actor,at=excluded.at", guild.id, JSON.stringify(snapshot), command.actor, Date.now());
        return embed("Permission baseline saved", roles.length + " roles and " + channels.length + " channels recorded. Use role audit changes to compare against this snapshot.");
    }
    const saved = store.get("SELECT * FROM permission_audits WHERE guild=?", guild.id), old = saved ? JSON.parse(saved.data) : null, findings = [];
    const report = (scope, text) => { if (!o.scope || o.scope === "all" || o.scope === scope) findings.push(text); };
    for (const role of roles) {
        const high = names(BigInt(role.permissions));
        if (high) report("roles", (role.id === guild.id ? "**Everyone**" : "<@&" + role.id + ">") + " · " + high + (role.managed ? " (managed role)" : ""));
    }
    for (const channel of channels) {
        const parent = byId.get(channel.parent_id), bits = channelPermissions(guest, guestRoles, guild, channel);
        if (!(bits & PERMS.VIEW)) continue;
        if (parent && !snapshot.channels[parent.id].public) report("channels", "<#" + channel.id + "> is public under private category <#" + parent.id + ">.");
        const high = names(bits);
        if (high) report("channels", "Everyone can view <#" + channel.id + "> with " + high + ".");
    }
    if (old) {
        for (const role of roles) {
            const before = old.roles[role.id], after = role.permissions;
            if (before === after) continue;
            const gained = names(BigInt(after) & ~BigInt(before ?? "0"));
            report("changes", (role.id === guild.id ? "**Everyone**" : "<@&" + role.id + ">") + (before === undefined ? " · New role" : " · Permissions changed") + (gained ? " · Gained " + gained : ""));
        }
        for (const channel of channels) {
            const before = old.channels[channel.id], after = snapshot.channels[channel.id];
            if (before && before.hash === after.hash && before.public === after.public) continue;
            report("changes", "<#" + channel.id + "> · " + (!before ? after.public ? "New public channel" : "New private channel" : before.public !== after.public ? after.public ? "Became visible to everyone" : "Became private" : "Access overrides changed"));
        }
        for (const id of Object.keys(old.roles)) if (!Object.hasOwn(snapshot.roles, id)) report("changes", "Role " + id + " removed.");
        for (const id of Object.keys(old.channels)) if (!Object.hasOwn(snapshot.channels, id)) report("changes", "Channel " + id + " removed.");
    }
    const pages = Math.max(1, Math.ceil(findings.length / 7)), page = Math.min(o.page ?? 1, pages);
    return embed("Server permission audit", (findings.slice((page - 1) * 7, page * 7).join("\n\n") || "No findings in this view.") + "\n\nPage " + page + "/" + pages + " · " + findings.length + " findings." + (saved ? "\nBaseline saved <t:" + Math.floor(saved.at / 1000) + ":R>." : "\nUse role auditbaseline to track later changes."));
}
