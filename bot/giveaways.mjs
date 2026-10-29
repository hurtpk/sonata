/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomInt } from "node:crypto";
import { parseDuration } from "./commands.mjs";
import { messageChannel } from "./community.mjs";
import { embed, fail, isId, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { button, rows } from "./interactionUI.mjs";

const eligible = (member, data) => member && !member.user.bot && (!data.role || member.roles.includes(data.role)) && Date.now() - Number((BigInt(member.user.id) >> 22n) + 1420070400000n) >= data.age * 86400_000;
export function giveawayCard(row, store) {
    const data = JSON.parse(row.data), count = store.get("SELECT COUNT(*) AS n FROM giveaway_entries WHERE id=?", row.id).n;
    const body = embed(row.state === "active" ? "Sonata giveaway" : row.state === "cancelled" ? "Giveaway cancelled" : "Giveaway ended", `**${data.prize}**\n${row.state === "active" ? `Ends <t:${Math.floor(row.due / 1000)}:R>` : `Winners: ${data.winners?.map(id => `<@${id}>`).join(", ") || "No eligible winners found"}`}\nEntries: ${count} · Winners to draw: ${data.count}\n${data.role ? `Required role: <@&${data.role}>\n` : ""}Minimum account age: ${data.age} days${data.error ? `\n${data.error}` : ""}`);
    body.components = row.state === "active" ? rows([button(`sngive:enter:${row.id}`, "Enter", 3), button(`sngive:leave:${row.id}`, "Leave")]) : [];
    return body;
}
async function publish(row, store, api) {
    await api(`/channels/${row.channel}/messages/${row.message}`, { method: "PATCH", body: giveawayCard(row, store) });
    store.run("UPDATE giveaways SET dirty=0 WHERE id=?", row.id);
}
export async function drawGiveaway(row, store, api, reroll = false) {
    const now = Date.now(), locked = store.get("UPDATE giveaways SET locked=? WHERE id=? AND locked<? RETURNING *", now + 180_000, row.id, now);
    if (!locked) fail("This giveaway is already being drawn. Try again shortly.");
    try {
        const data = JSON.parse(locked.data);
        if ((!reroll && locked.state !== "active") || (reroll && locked.state !== "ended")) fail("This giveaway is not available for that draw.");
        if ((data.history?.length ?? 0) >= 100) fail("This giveaway reached its reroll limit.");
        const excluded = new Set(data.history ?? []), candidates = store.all("SELECT user FROM giveaway_entries WHERE id=?", row.id).map(value => value.user).filter(id => !excluded.has(id)), winners = [];
        let checked = 0;
        while (candidates.length && winners.length < data.count && checked++ < 50) {
            const index = randomInt(candidates.length), [id] = candidates.splice(index, 1);
            const member = await api(`/guilds/${row.guild}/members/${id}`, { optional: true });
            if (eligible(member, data)) winners.push(id);
        }
        data.winners = winners; data.history = [...excluded, ...winners]; data.error = checked >= 50 && winners.length < data.count ? "Some winner slots remain empty after the eligibility check limit." : "";
        store.run("UPDATE giveaways SET state='ended',data=?,dirty=1 WHERE id=?", JSON.stringify(data), row.id);
        try { await publish(store.get("SELECT * FROM giveaways WHERE id=?", row.id), store, api); }
        catch { return embed("Winners saved", "The draw is saved, but the giveaway message could not be updated. Sonata will retry the update."); }
        return embed("Giveaway drawn", winners.map(id => `<@${id}>`).join(", ") || "No eligible winners were found.");
    } finally { store.run("UPDATE giveaways SET locked=0 WHERE id=?", row.id); }
}

export async function giveawayCommand(context, store) {
    const { command, guild, api, actor, roles } = context, o = command.options;
    if (command.sub === "list") return embed("Recent giveaways", store.all("SELECT * FROM giveaways WHERE guild=? ORDER BY due DESC LIMIT 8", guild.id).map(row => `${JSON.parse(row.data).prize} · ${row.state}\nhttps://discord.com/channels/${guild.id}/${row.channel}/${row.message}`).join("\n\n") || "No giveaways created.");
    requirePermission(memberPermissions(actor, roles, guild), PERMS.GUILD);
    if (command.sub === "start") {
        await messageChannel(context, command.channel);
        if (store.get("SELECT COUNT(*) AS n FROM giveaways WHERE guild=? AND state='active'", guild.id).n >= 10) fail("Use at most ten active giveaways per server.");
        if (o.role && (o.role === guild.id || !roles.some(role => role.id === o.role))) fail("Choose a required role in this server other than everyone.");
        const due = Date.now() + parseDuration(o.duration, 30 * 86400_000), id = crypto.randomUUID();
        const data = { prize: o.prize, count: o.winners, role: o.role ?? "", age: o.age ?? 0, creator: actor.user.id, history: [], winners: [] };
        store.run("INSERT INTO giveaways (id,guild,channel,message,due,state,data) VALUES (?,?,?,?,?,?,?)", id, guild.id, command.channel, "", due, "active", JSON.stringify(data));
        try {
            const posted = await api(`/channels/${command.channel}/messages`, { method: "POST", body: giveawayCard(store.get("SELECT * FROM giveaways WHERE id=?", id), store) });
            store.run("UPDATE giveaways SET message=? WHERE id=?", posted.id, id);
            return embed("Giveaway created", `https://discord.com/channels/${guild.id}/${command.channel}/${posted.id}`);
        } catch (error) { store.run("DELETE FROM giveaways WHERE id=?", id); throw error; }
    }
    if (!isId(o.message)) fail("Use the giveaway's message ID.");
    const row = store.get("SELECT * FROM giveaways WHERE guild=? AND message=?", guild.id, o.message);
    if (!row) fail("That giveaway does not exist in this server.");
    await messageChannel(context, row.channel);
    if (command.sub === "cancel") {
        if (row.state !== "active") fail("Only active giveaways can be cancelled.");
        store.run("UPDATE giveaways SET state='cancelled',dirty=1 WHERE id=?", row.id);
        try { await publish(store.get("SELECT * FROM giveaways WHERE id=?", row.id), store, api); } catch { return embed("Giveaway cancelled", "The saved state is cancelled. The public message will be updated on a retry."); }
        return embed("Giveaway cancelled", "No winners were drawn.");
    }
    return drawGiveaway(row, store, api, command.sub === "reroll");
}

export async function giveawayEntry(context, store, id, action, message) {
    const row = store.get("SELECT * FROM giveaways WHERE guild=? AND id=?", context.guild.id, id);
    if (!row || row.message !== message.id || row.channel !== context.command.channel || row.state !== "active" || row.due <= Date.now()) fail("This giveaway has ended or its control is unavailable.");
    if (action === "leave") { store.run("DELETE FROM giveaway_entries WHERE id=? AND user=?", id, context.actor.user.id); return embed("Giveaway entry removed", "You are no longer entered."); }
    if (!eligible(context.actor, JSON.parse(row.data))) fail("You do not meet this giveaway's membership, role or account-age requirements.");
    if (store.get("SELECT COUNT(*) AS n FROM giveaway_entries WHERE id=?", id).n >= 1000 && !store.get("SELECT user FROM giveaway_entries WHERE id=? AND user=?", id, context.actor.user.id)) fail("This giveaway reached its 1,000-entry limit.");
    store.run("INSERT OR IGNORE INTO giveaway_entries VALUES (?,?)", id, context.actor.user.id);
    store.run("UPDATE giveaways SET dirty=1 WHERE id=?", id);
    return embed("Giveaway entered", "Your entry is saved. You can use Leave to remove it before the draw.");
}

export async function giveawayTimers(store, api) {
    for (const row of store.all("SELECT * FROM giveaways WHERE state='active' AND due<=? AND locked<? LIMIT 2", Date.now(), Date.now())) {
        try { await drawGiveaway(row, store, api); }
        catch { const data = JSON.parse(row.data); data.error = "The automatic draw could not complete. Staff can retry with giveaway end."; store.run("UPDATE giveaways SET data=?,due=?,dirty=1 WHERE id=? AND state='active'", JSON.stringify(data), Date.now() + 60_000, row.id); }
    }
    for (const row of store.all("SELECT * FROM giveaways WHERE dirty=1 AND message<>'' LIMIT 5")) try { await publish(row, store, api); } catch { continue; }
}
