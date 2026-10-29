/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { messageChannel } from "./community.mjs";
import { embed, fail, memberPermissions, PERMS, requirePermission } from "./discord.mjs";

export const ticketDetails = (store, row) => { const found = store.get("SELECT data FROM ticket_details WHERE id=?", row.id); return { category: "general", priority: "normal", last: row.at, ...(found ? JSON.parse(found.data) : {}) }; };
export const saveTicketDetails = (store, id, details) => store.run("INSERT INTO ticket_details VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", id, JSON.stringify(details));

export async function ticketExtras(context, store) {
    const { guild, command, api, roles } = context, o = command.options, settings = store.settings(guild.id), config = settings.tickets;
    if (!config) fail("Set up tickets first.");
    if (["categoryadd", "categoryremove", "idle"].includes(command.sub)) {
        requirePermission(memberPermissions(context.actor, roles, guild), PERMS.GUILD | PERMS.CHANNELS);
        if (command.sub === "idle") { if (o.channel) await messageChannel(context, o.channel); config.idle = { hours: o.hours, channel: o.channel || config.log }; }
        else {
            const name = o.name.trim().toLowerCase();
            if (!/^[a-z][a-z0-9-]{0,23}$/.test(name) || ["general", "constructor", "prototype", "__proto__"].includes(name)) fail("Choose a category name of one to twenty-four letters, numbers or hyphens, other than general.");
            config.categories ??= {};
            if (command.sub === "categoryremove") delete config.categories[name];
            else {
                const category = await api(`/channels/${o.category}`);
                if (category.guild_id !== guild.id || category.type !== 4 || o.role === guild.id || !roles.some(role => role.id === o.role)) fail("Choose a server category and a support role other than everyone.");
                config.categories[name] = { category: category.id, role: o.role };
                if (Object.keys(config.categories).length > 5) fail("Use at most five additional ticket categories.");
            }
        }
        store.saveSettings(guild.id, settings);
        return embed("Ticket routing saved", "Post a new ticket panel to update its category choices. Inactivity reminders never automatically close a ticket.");
    }
    const row = store.get("SELECT * FROM tickets WHERE guild=? AND channel=?", guild.id, command.channel);
    if (!row) fail("Use this command inside its ticket channel.");
    const details = ticketDetails(store, row), staff = context.actor.roles.includes(details.staffRole || config.role) || (memberPermissions(context.actor, roles, guild) & (PERMS.ADMIN | PERMS.CHANNELS));
    if (!staff) fail("Only ticket staff can assign a ticket or change its priority.");
    if (command.sub === "priority") { details.priority = o.priority; saveTicketDetails(store, row.id, details); }
    if (command.sub === "assign") {
        const target = await api(`/guilds/${guild.id}/members/${o.member}`);
        if (target.user.bot || (!target.roles.includes(details.staffRole || config.role) && !(memberPermissions(target, roles, guild) & (PERMS.ADMIN | PERMS.CHANNELS)))) fail("Assign this ticket to a human support staff member.");
        store.run("UPDATE tickets SET claimed=? WHERE id=?", target.user.id, row.id);
    }
    return embed("Ticket updated", `Category: ${details.category}\nPriority: ${details.priority}${command.sub === "assign" ? `\nAssigned to <@${o.member}>` : ""}`);
}

export function ticketActivity(data, store) {
    const row = store.get("SELECT * FROM tickets WHERE guild=? AND channel=? AND state='open'", data.guild_id, data.channel_id);
    if (!row) return;
    const details = ticketDetails(store, row);
    if (Date.now() - details.last < 30_000 && !details.reminded) return;
    details.last = Date.now(); details.reminded = false; saveTicketDetails(store, row.id, details);
}
export async function ticketTimers(store, api) {
    for (const row of store.all("SELECT * FROM tickets WHERE state='open' ORDER BY at LIMIT 100")) {
        const config = store.settings(row.guild).tickets, details = ticketDetails(store, row);
        if (!config?.idle?.hours || details.reminded || Date.now() - details.last < config.idle.hours * 3600_000) continue;
        try { await api(`/channels/${config.idle.channel}/messages`, { method: "POST", body: embed("Ticket needs attention", `<#${row.channel}> · ${details.category} · ${details.priority}\nAssigned: ${row.claimed ? `<@${row.claimed}>` : "Unclaimed"}\nInactive since <t:${Math.floor(details.last / 1000)}:R>.`) }); details.reminded = true; saveTicketDetails(store, row.id, details); }
        catch { const settings = store.settings(row.guild); settings.ticketError = "An inactivity reminder could not be delivered."; store.saveSettings(row.guild, settings); }
    }
}
