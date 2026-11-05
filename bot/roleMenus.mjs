/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { channel, command, option, role, sub } from "./commandOptions.mjs";
import { channelPermissions, embed, fail, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { messageChannel, safeAutorole } from "./community.mjs";
import { basicRole } from "./memberTools.mjs";
import { button, rows } from "./interactionUI.mjs";

const menuId = () => option("id", 3, "Role menu ID from rolemenu list", true, { max_length: 8 });
export const ROLEMENU_COMMAND = command("rolemenu", "Create self-service role menus", PERMS.GUILD | PERMS.ROLES, [
    sub("create", "Create a draft role menu", [option("name", 3, "Menu title", true, { max_length: 80 }), option("limit", 4, "Maximum roles per member, one makes choices exclusive", true, { min_value: 1, max_value: 25 })]),
    sub("add", "Add a safe role option to a menu", [menuId(), role(), option("label", 3, "Display label, defaults to the role name", false, { max_length: 80 })]),
    sub("remove", "Remove a role option from a menu", [menuId(), role()]),
    sub("post", "Publish a role menu in a text channel", [menuId(), channel([0, 5])]),
    sub("list", "List draft and published role menus"),
    sub("delete", "Disable and delete a role menu", [menuId()]),
], []);

function panel(data, id) {
    return {
        ...embed(data.name, data.roles.length ? "Choose the roles you want from this menu. A new selection replaces your previous choices from this menu." : "This menu has no roles configured."),
        components: data.roles.length ? [
            { type: 1, components: [{ type: 3, custom_id: `snroles:${id}:pick`, placeholder: "Choose roles", min_values: 0, max_values: Math.min(data.limit, data.roles.length), options: data.roles.map(role => ({ label: role.label, value: role.id })) }] },
            ...rows([button(`snroles:${id}:clear`, "Clear my selections")]),
        ] : [],
    };
}

async function eligible(context, ids, configuring) {
    const roles = ids.map(id => basicRole(context, id, configuring)), channels = await context.api(`/guilds/${context.guild.id}/channels`);
    if (channels.some(channel => (channel.permission_overwrites ?? []).some(overwrite => overwrite.type === 0 && ids.includes(overwrite.id) && !safeAutorole({ permissions: overwrite.allow })))) fail("A role in this menu grants moderation or management permissions in a channel.");
    return roles;
}

export async function roleMenuCommand(context, store) {
    const { command, guild, roles, api } = context, o = command.options;
    if (command.sub === "list") {
        const entries = store.all("SELECT * FROM role_menus WHERE guild=? ORDER BY id", guild.id);
        return embed("Role menus", entries.map(row => {
            const data = JSON.parse(row.data); return `\`${row.id}\` · ${data.name} · ${data.roles.length} roles · ${row.channel ? "<#" + row.channel + ">" : "Draft"}`;
        }).join("\n") || "No role menus configured.");
    }
    if (command.sub === "create") {
        if (!o.name.trim()) fail("Give the role menu a title.");
        if (store.get("SELECT COUNT(*) AS n FROM role_menus WHERE guild=?", guild.id).n >= 12) fail("Remove a role menu before creating more than 12.");
        const id = crypto.randomUUID().slice(0, 8);
        store.run("INSERT INTO role_menus VALUES (?,?,?,?,?)", guild.id, id, "", "", JSON.stringify({ name: o.name.trim(), limit: o.limit, roles: [] }));
        return embed("Role menu created", `Draft \`${id}\` · ${o.name}. Add roles, then post the menu in a channel.`);
    }
    const row = store.get("SELECT * FROM role_menus WHERE guild=? AND id=?", guild.id, o.id);
    if (!row) fail("Choose a role menu ID from rolemenu list.");
    const data = JSON.parse(row.data);
    if (command.sub === "delete") {
        store.run("DELETE FROM role_menus WHERE guild=? AND id=?", guild.id, row.id);
        if (row.message) await api(`/channels/${row.channel}/messages/${row.message}`, { method: "PATCH", body: { ...embed(data.name, "This role menu has been disabled."), components: [] }, optional: true }).catch(() => null);
        return embed("Role menu removed", "Existing member roles were kept.");
    }
    if (command.sub === "add") {
        const [selected] = await eligible(context, [o.role], true);
        if (store.get("SELECT role_menus.id FROM role_menus,json_each(role_menus.data,'$.roles') WHERE guild=? AND role_menus.id<>? AND json_extract(value,'$.id')=?", guild.id, row.id, selected.id)) fail("A role can belong to only one menu.");
        if (!data.roles.some(value => value.id === selected.id) && data.roles.length >= 25) fail("A menu can contain at most 25 roles.");
        data.roles = [...data.roles.filter(value => value.id !== selected.id), { id: selected.id, label: (o.label || selected.name).slice(0, 80) }];
    }
    if (command.sub === "remove") {
        if (!data.roles.some(value => value.id === o.role)) fail("That role is not in this menu.");
        data.roles = data.roles.filter(value => value.id !== o.role);
    }
    if (command.sub === "post") {
        if (!data.roles.length) fail("Add at least one role before posting the menu.");
        await eligible(context, data.roles.map(value => value.id), true);
        const destination = await messageChannel(context, o.channel);
        requirePermission(channelPermissions(context.actor, roles, guild, destination), PERMS.VIEW | PERMS.SEND);
        const saved = await api(`/channels/${destination.id}/messages`, { method: "POST", body: panel(data, row.id) });
        store.run("UPDATE role_menus SET channel=?,message=? WHERE guild=? AND id=?", destination.id, saved.id, guild.id, row.id);
        if (row.message) await api(`/channels/${row.channel}/messages/${row.message}`, { method: "PATCH", body: { ...embed(data.name, "This menu was replaced."), components: [] }, optional: true }).catch(() => null);
        return embed("Role menu posted", `[Open menu](https://discord.com/channels/${guild.id}/${destination.id}/${saved.id})`);
    }
    if (row.message) await api(`/channels/${row.channel}/messages/${row.message}`, { method: "PATCH", body: panel(data, row.id), optional: true });
    store.run("UPDATE role_menus SET data=? WHERE guild=? AND id=?", JSON.stringify(data), guild.id, row.id);
    return embed("Role menu updated", `Menu \`${row.id}\` has ${data.roles.length} role options. Existing member roles were kept.`);
}

export async function roleMenuSelection(context, store, id, message, values) {
    const { command, guild, actor, api } = context;
    const row = store.get("SELECT * FROM role_menus WHERE guild=? AND id=? AND channel=? AND message=?", guild.id, id, command.channel, message);
    if (!row) fail("This role menu is no longer active.");
    const data = JSON.parse(row.data), ids = data.roles.map(role => role.id);
    if (!Array.isArray(values) || values.length > data.limit || new Set(values).size !== values.length || values.some(value => !ids.includes(value))) fail("Choose valid options from this menu.");
    if (context.settings.jailRole && actor.roles.includes(context.settings.jailRole)) fail("This menu is unavailable while you are jailed.", "denied");
    await eligible(context, ids, false);
    for (const role of ids) if (actor.roles.includes(role) && !values.includes(role)) await api(`/guilds/${guild.id}/members/${actor.user.id}/roles/${role}`, { method: "DELETE", reason: "Sonata role menu selection" });
    for (const role of values) if (!actor.roles.includes(role)) await api(`/guilds/${guild.id}/members/${actor.user.id}/roles/${role}`, { method: "PUT", reason: "Sonata role menu selection" });
    return embed("Roles updated", values.length ? `Selected: ${values.map(role => "<@&" + role + ">").join(", ")}` : "Your selections from this menu were cleared.");
}
