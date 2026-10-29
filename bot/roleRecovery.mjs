/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { embed, fail, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { basicRole } from "./memberTools.mjs";

export function recoveryEvent(type, data, store) {
    const guild = type === "GUILD_CREATE" ? data.id : data.guild_id;
    if (type === "GUILD_DELETE") { if (!data.unavailable) for (const table of ["recovery_members", "role_returns"]) store.run(`DELETE FROM ${table} WHERE guild=?`, data.id); return; }
    if (!store.settings(guild).roleRecovery) return;
    if (type === "GUILD_MEMBER_REMOVE") {
        store.run("DELETE FROM role_returns WHERE guild=? AND user=? AND expires<=?", guild, data.user.id, Date.now());
        const found = store.get("SELECT roles FROM recovery_members WHERE guild=? AND user=?", guild, data.user.id);
        if (found) store.run("INSERT INTO role_returns VALUES (?,?,?,?) ON CONFLICT(guild,user) DO NOTHING", guild, data.user.id, found.roles, Date.now() + 3 * 3600_000);
        store.run("DELETE FROM recovery_members WHERE guild=? AND user=?", guild, data.user.id); return;
    }
    const members = ["GUILD_CREATE", "GUILD_MEMBERS_CHUNK"].includes(type) ? data.members ?? [] : [data];
    for (const member of members) if (member.user && !member.user.bot && Array.isArray(member.roles)) store.run("INSERT INTO recovery_members VALUES (?,?,?) ON CONFLICT(guild,user) DO UPDATE SET roles=excluded.roles", guild, member.user.id, JSON.stringify(member.roles));
}

export async function roleRecovery(context, store, perform) {
    const { guild, command, actor, roles, api } = context, settings = store.settings(guild.id);
    if (command.sub === "recovery") {
        requirePermission(memberPermissions(actor, roles, guild), PERMS.GUILD);
        settings.roleRecovery = command.options.enabled; store.saveSettings(guild.id, settings);
        if (!settings.roleRecovery) for (const table of ["recovery_members", "role_returns"]) store.run(`DELETE FROM ${table} WHERE guild=?`, guild.id);
        return embed("Role recovery saved", settings.roleRecovery ? "Sonata will remember role IDs for future departures. Staff can use role restore within three hours of departure. Basic roles only; no roles are granted automatically." : "Role recovery is off and saved recovery data was cleared.");
    }
    if (!settings.roleRecovery) fail("Enable role recovery first with role recovery on. Earlier departures cannot be recovered.");
    const saved = store.get("SELECT * FROM role_returns WHERE guild=? AND user=?", guild.id, command.options.member);
    if (!saved || saved.expires <= Date.now()) { if (saved) store.run("DELETE FROM role_returns WHERE guild=? AND user=?", guild.id, command.options.member); fail("No saved roles remain within the three-hour departure window."); }
    const target = await context.target(command.options.member);
    if (target.user.bot || target.pending || store.restriction(guild.id, target.user.id, "jail")) fail("Finish screening and release this member from restrictions before restoring roles.");
    context.botPermission(PERMS.ROLES);
    const eligible = [], skipped = [];
    for (const id of JSON.parse(saved.roles)) {
        if (target.roles.includes(id)) continue;
        try { eligible.push(basicRole({ ...context, settings }, id)); } catch { skipped.push(id); }
    }
    return perform(context, store, "roles restored", target.user.id, "Restored basic roles within three hours of departure.", 0, async (_, audit) => {
        for (const role of eligible) { if (Date.now() >= saved.expires) fail("The three-hour recovery window expired during restoration. Review the roles already restored."); await api(`/guilds/${guild.id}/members/${target.user.id}/roles/${role.id}`, { method: "PUT", reason: audit }); }
        if (skipped.length) store.run("UPDATE role_returns SET roles=? WHERE guild=? AND user=?", JSON.stringify(skipped), guild.id, target.user.id);
        else store.run("DELETE FROM role_returns WHERE guild=? AND user=?", guild.id, target.user.id);
        return `Restored ${eligible.length} roles. Skipped ${skipped.length} deleted, managed, privileged or inaccessible roles. Remaining roles keep their original three-hour deadline.`;
    });
}
