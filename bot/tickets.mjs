/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { messageChannel } from "./community.mjs";
import { channelPermissions, embed, fail, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { button, rows } from "./interactionUI.mjs";
import { editBits } from "./restrictions.mjs";
import { saveTicketDetails, ticketDetails, ticketExtras } from "./ticketExtras.mjs";

const ticketButtons = (id, closed = false) => rows([button(`snticket:${closed ? "reopen" : "claim"}:${id}`, closed ? "Reopen" : "Claim", 1), ...(!closed ? [button(`snticket:close:${id}`, "Close & save transcript", 4)] : []), button(`snticket:transcript:${id}`, "Transcript")]);
const staff = (context, settings, details) => context.actor.roles.includes(details?.staffRole || settings.tickets?.role) || !!(memberPermissions(context.actor, context.roles, context.guild) & (PERMS.ADMIN | PERMS.CHANNELS));

export async function createTicket(context, store, topic, kind = "general") {
    const { guild, actor, bot, api, roles } = context, base = store.settings(guild.id).tickets;
    const config = kind === "general" ? base : base?.categories?.[kind] ? { ...base, ...base.categories[kind] } : null;
    if (!config?.enabled) fail("New tickets are disabled in this server.");
    if (store.get("SELECT id FROM tickets WHERE guild=? AND owner=? AND state='open'", guild.id, actor.user.id)) fail("You already have an open ticket. Close it before opening another.");
    if (store.get("SELECT COUNT(*) AS n FROM tickets WHERE guild=? AND state='open'", guild.id).n >= 25 || store.get("SELECT COUNT(*) AS n FROM tickets WHERE guild=? AND state<>'archived'", guild.id).n >= 100) fail("This server reached its ticket limit. Staff must archive older ticket records first.");
    context.botPermission(PERMS.CHANNELS | PERMS.ROLES);
    const category = await api(`/channels/${config.category}`);
    if (category.guild_id !== guild.id || category.type !== 4 || !roles.some(role => role.id === config.role && role.id !== guild.id)) fail("Staff must repair the ticket category or support role configuration.");
    const read = PERMS.VIEW | PERMS.SEND | PERMS.HISTORY | PERMS.ATTACH | PERMS.EMBEDS;
    const channel = await api(`/guilds/${guild.id}/channels`, { method: "POST", reason: `Sonata support ticket opened by ${actor.user.id}`, body: { name: `ticket-${actor.user.username || actor.user.id}`.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 90), type: 0, parent_id: category.id, permission_overwrites: [{ id: guild.id, type: 0, allow: "0", deny: PERMS.VIEW.toString() }, { id: actor.user.id, type: 1, allow: read.toString(), deny: "0" }, { id: config.role, type: 0, allow: read.toString(), deny: "0" }, { id: bot.user.id, type: 1, allow: (read | PERMS.CHANNELS | PERMS.ROLES).toString(), deny: "0" }] } });
    const id = crypto.randomUUID();
    store.run("INSERT INTO tickets (id,guild,owner,channel,state,at) VALUES (?,?,?,?,?,?)", id, guild.id, actor.user.id, channel.id, "open", Date.now());
    saveTicketDetails(store, id, { category: kind, staffRole: config.role, priority: "normal", last: Date.now(), reminded: false });
    try { await api(`/channels/${channel.id}/messages`, { method: "POST", body: { ...embed("Support ticket", `Opened by <@${actor.user.id}> (${actor.user.id})\nQueue: ${kind} · Priority: normal\n\n${topic}`), components: ticketButtons(id) } }); }
    catch { return embed("Ticket created", `<#${channel.id}> was created, but its control message could not be posted. Ticket commands still work inside the channel.`); }
    return embed("Ticket opened", `Your private support channel is <#${channel.id}>. Staff and Discord administrators can access it.`);
}

export async function ticketTranscript(context, store, row) {
    const { api, guild, bot, roles, actor } = context, config = store.settings(guild.id).tickets;
    if (!config?.log) fail("Configure a ticket transcript channel first.");
    const channel = await api(`/channels/${row.channel}`), log = await api(`/channels/${config.log}`);
    if (channel.guild_id !== guild.id || log.guild_id !== guild.id || ![0, 5].includes(log.type) || row.channel === config.log) fail("The ticket or transcript channel configuration is invalid.");
    requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW);
    requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.HISTORY);
    requirePermission(channelPermissions(bot, roles, guild, log), PERMS.VIEW | PERMS.SEND | PERMS.ATTACH);
    const messages = new Map(); let before = "";
    for (let page = 0; page < 5; page++) {
        const values = await api(`/channels/${row.channel}/messages?limit=100${before ? `&before=${before}` : ""}`);
        if (!values.length) break;
        for (const message of values) messages.set(message.id, { id: message.id, at: message.timestamp, author: { id: message.author.id, username: message.author.username }, content: message.content ?? "", attachments: (message.attachments ?? []).map(file => ({ name: file.filename, url: file.url })) });
        const next = values.at(-1).id;
        if (values.length < 100 || next === before) break;
        before = next;
    }
    const text = JSON.stringify({ ticket: row.id, guild: guild.id, channel: row.channel, owner: row.owner, exportedAt: new Date().toISOString(), limit: 500, attachments: "Links only. Attachment bytes are not archived.", messages: [...messages.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1) }, null, 2);
    if (new TextEncoder().encode(text).length > 8 * 1024 * 1024) fail("The latest ticket messages exceed the 8 MiB transcript limit.");
    const filename = `ticket-${row.channel}.json`, form = new FormData();
    form.set("payload_json", JSON.stringify({ ...embed("Ticket transcript", `Owner: <@${row.owner}>\nChannel: <#${row.channel}>\nLatest ${messages.size} messages, up to 500. Attachments are recorded as links.`), attachments: [{ id: "0", filename }] }));
    form.set("files[0]", new Blob([text], { type: "application/json" }), filename);
    const message = await api(`/channels/${config.log}/messages`, { method: "POST", form });
    const url = `https://discord.com/channels/${guild.id}/${config.log}/${message.id}`;
    store.run("UPDATE tickets SET transcript=? WHERE id=?", url, row.id);
    return url;
}

export async function ticketCommand(context, store, requestedId) {
    const { command, api, guild, actor, bot, roles } = context, settings = store.settings(guild.id), o = command.options;
    if (["categoryadd", "categoryremove", "priority", "assign", "idle"].includes(command.sub)) return ticketExtras(context, store);
    if (["setup", "panel", "off", "view"].includes(command.sub)) {
        requirePermission(memberPermissions(actor, roles, guild), PERMS.GUILD | PERMS.CHANNELS);
        if (command.sub === "view") return embed("Support tickets", settings.tickets ? `Enabled: ${settings.tickets.enabled}\nCategory: <#${settings.tickets.category}>\nSupport role: <@&${settings.tickets.role}>\nTranscripts: <#${settings.tickets.log}>` : "Not configured.");
        if (command.sub === "setup") {
            const category = await api(`/channels/${o.category}`), log = await messageChannel(context, o.channel);
            if (category.guild_id !== guild.id || category.type !== 4 || o.role === guild.id || !roles.some(role => role.id === o.role)) fail("Choose a server category and a support role other than everyone.");
            context.botPermission(PERMS.CHANNELS | PERMS.ROLES);
            requirePermission(channelPermissions(bot, roles, guild, log), PERMS.ATTACH);
            requirePermission(channelPermissions(bot, roles, guild, category), PERMS.VIEW | PERMS.CHANNELS | PERMS.ROLES);
            settings.tickets = { ...settings.tickets, enabled: true, category: category.id, role: o.role, log: o.channel };
        }
        if (command.sub === "off" && settings.tickets) settings.tickets.enabled = false;
        if (command.sub === "panel") {
            if (!settings.tickets?.enabled) fail("Enable ticket setup before posting a panel.");
            await messageChannel(context, o.channel);
            const components = rows([button(`snticket:open:${guild.id}`, "Open ticket", 1)]), categories = Object.keys(settings.tickets.categories ?? {});
            if (categories.length) components.push({ type: 1, components: [{ type: 3, custom_id: `snticket:category:${guild.id}`, placeholder: "Choose a support queue…", min_values: 1, max_values: 1, options: ["general", ...categories].map(name => ({ label: name, value: name })) }] });
            const message = await api(`/channels/${o.channel}/messages`, { method: "POST", body: { ...embed("Need help?", "Open a private ticket for server staff. One open ticket per person."), components } });
            settings.tickets.panel = { channel: o.channel, message: message.id };
        }
        store.saveSettings(guild.id, settings);
        return embed("Tickets saved", "Use ticket panel to post an open-ticket button. Closing saves a transcript before making the ticket read-only.");
    }
    if (["open", "openin"].includes(command.sub)) return createTicket(context, store, o.topic, o.category?.trim().toLowerCase() || "general");
    const row = requestedId ? store.get("SELECT * FROM tickets WHERE guild=? AND id=?", guild.id, requestedId) : store.get("SELECT * FROM tickets WHERE guild=? AND channel=?", guild.id, command.channel);
    if (!row || row.channel !== command.channel) fail("Use this control inside its original ticket channel.");
    const details = ticketDetails(store, row);
    if (!staff(context, settings, details) && (row.owner !== actor.user.id || ["claim", "reopen", "archive"].includes(command.sub))) fail("Only support staff can use this ticket control.");
    if (command.sub === "archive") {
        if (row.state !== "closed" || !row.transcript) fail("Close this ticket and save its transcript before archiving it.");
        store.run("UPDATE tickets SET state='archived' WHERE id=?", row.id);
        return embed("Ticket archived", `The transcript and private channel were kept. This record no longer counts toward the ticket limit.\n${row.transcript}`);
    }
    if (command.sub === "claim") {
        if (row.state !== "open") fail("Reopen the ticket before claiming it.");
        if (row.claimed && row.claimed !== actor.user.id) fail("Another staff member already claimed this ticket.");
        store.run("UPDATE tickets SET claimed=? WHERE id=?", actor.user.id, row.id);
        return { ...embed("Ticket claimed", `Assigned to <@${actor.user.id}>.`), components: ticketButtons(row.id) };
    }
    if (command.sub === "transcript") return embed("Transcript saved", await ticketTranscript(context, store, row));
    if (command.sub === "close" && row.state !== "open") fail("This ticket is already closed.");
    if (command.sub === "reopen" && (row.state !== "closed" || store.get("SELECT id FROM tickets WHERE guild=? AND owner=? AND state='open'", guild.id, row.owner))) fail("This ticket is open, or its owner already has another open ticket.");
    context.botPermission(PERMS.CHANNELS | PERMS.ROLES);
    const transcript = command.sub === "close" ? await ticketTranscript(context, store, row) : row.transcript;
    const channel = await api(`/channels/${row.channel}`);
    await editBits(api, channel, row.owner, 1, PERMS.SEND, command.sub === "close" ? 0n : PERMS.SEND, command.sub === "close" ? PERMS.SEND : 0n, `Sonata ticket ${command.sub} by ${actor.user.id}`);
    store.run("UPDATE tickets SET state=? WHERE id=?", command.sub === "close" ? "closed" : "open", row.id);
    details.last = Date.now(); details.reminded = false;
    if (command.sub === "close") { details.closedAt = Date.now(); details.closedBy = actor.user.id; }
    saveTicketDetails(store, row.id, details);
    return { ...embed(command.sub === "close" ? "Ticket closed" : "Ticket reopened", `${command.sub === "close" ? "The ticket is read-only for its owner." : "The ticket owner can send messages again."}\n${transcript || ""}`), components: ticketButtons(row.id, command.sub === "close") };
}
