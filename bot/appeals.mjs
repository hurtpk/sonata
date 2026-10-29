/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { messageChannel } from "./community.mjs";
import { embed, fail, PERMS, requirePermission, memberPermissions } from "./discord.mjs";
import { button, rows } from "./interactionUI.mjs";
import { caseLog } from "./moderation.mjs";

export const banKind = kind => kind === "ban" || kind === "tempban" || kind.endsWith(" ban");
export const appealButtons = (guild, n) => rows([button(`snappeal:open:${guild}:${n}`, "Appeal ban", 1)]);
const reviewButtons = (guild, n) => rows([button(`snappeal:approve:${guild}:${n}`, "Approve & unban", 3), button(`snappeal:deny:${guild}:${n}`, "Deny", 4), button(`snappeal:view:${guild}:${n}`, "Case & evidence")]);

export async function appealsCommand(context, store) {
    const { command, guild } = context, settings = store.settings(guild.id), o = command.options;
    if (["setup", "off"].includes(command.sub)) {
        requirePermission(memberPermissions(context.actor, context.roles, guild), PERMS.GUILD);
        if (command.sub === "setup") { await messageChannel(context, o.channel); context.botPermission(PERMS.BAN); settings.appeals = { enabled: true, channel: o.channel }; }
        else if (settings.appeals) settings.appeals.enabled = false;
        store.saveSettings(guild.id, settings);
        return embed("Ban appeals saved", "Enabled appeals add a form button to future ban DMs. Delivery depends on the member's DM settings. Staff review the original case before approving an unban.");
    }
    if (command.sub === "view") return embed("Ban appeals", settings.appeals?.enabled ? `Review channel: <#${settings.appeals.channel}>\nFuture ban DMs include an appeal form.` : "New appeals are disabled.");
    if (command.sub === "list") return embed("Recent appeals", store.all("SELECT * FROM appeals WHERE guild=? ORDER BY at DESC LIMIT 8", guild.id).map(row => `Case #${row.n} · ${row.status} · <@${row.target}>`).join("\n") || "No appeals submitted.");
    return appealCase(store, guild.id, o.case);
}

export function appealCase(store, guild, n) {
    const original = store.case(guild, n), appeal = store.get("SELECT * FROM appeals WHERE guild=? AND n=?", guild, n);
    if (!original || !banKind(original.kind)) fail("Choose a ban case in this server.");
    const notes = store.all("SELECT * FROM notes WHERE guild=? AND n=? ORDER BY CASE WHEN kind='evidence' THEN 0 ELSE 1 END,at DESC LIMIT 5", guild, n);
    const body = embed(`Case #${n} and appeal`, `Target: <@${original.target}> (${original.target})\nAction: ${original.kind} · ${original.status}\nOriginal moderator: <@${original.actor}>\nReason: ${original.reason}\n\nAppeal: ${appeal?.status ?? "None"}\n${appeal?.text ?? ""}`);
    body.embeds.push(...embed("Evidence and recent notes", notes.map(note => `${note.kind}: ${note.value}`).join("\n\n") || "No evidence or notes attached to this case.").embeds);
    return body;
}

export function appealEligible(store, guild, n, actor) {
    const row = store.case(guild, n);
    if (!store.settings(guild).appeals?.enabled || !row || row.target !== actor || !banKind(row.kind) || row.status !== "completed") fail("This ban is not eligible for an appeal, or its action has not completed yet.");
    if (store.get("SELECT n FROM appeals WHERE guild=? AND n=?", guild, n)) fail("An appeal was already submitted for this case. Staff can review its status.");
    return row;
}

export async function submitAppeal(form, store, api) {
    const n = form.details.n, original = appealEligible(store, form.guild, n, form.actor), settings = store.settings(form.guild);
    const ban = await api(`/guilds/${form.guild}/bans/${form.actor}`, { optional: true });
    if (!ban || !ban.reason?.startsWith(`[Sonata case ${form.guild}-${n}] `)) fail("This case is no longer the current ban. Staff must review the current ban manually.");
    store.run("INSERT INTO appeals (guild,n,target,text,status,at,channel) VALUES (?,?,?,?,?,?,?)", form.guild, n, form.actor, form.value, "pending", Date.now(), settings.appeals.channel);
    store.addNote(form.guild, n, form.actor, "appeal submitted", form.value);
    try {
        const message = await api(`/channels/${settings.appeals.channel}/messages`, { method: "POST", body: { ...embed(`Ban appeal · case #${n}`, `<@${form.actor}> (${form.actor})\nBan reason: ${original.reason}\n\n${form.value}`), components: reviewButtons(form.guild, n) } });
        store.run("UPDATE appeals SET message=? WHERE guild=? AND n=?", message.id, form.guild, n);
    } catch { return embed("Appeal saved", "Your appeal is saved with the case, but the review channel could not receive it. Staff can find it with appeals list."); }
    return embed("Appeal submitted", "Staff can review your appeal alongside the original case and its evidence. One appeal can be submitted per ban case.");
}

export async function decideAppeal(context, store, n, action, message) {
    const { guild, command, api } = context, row = store.get("SELECT * FROM appeals WHERE guild=? AND n=?", guild.id, n);
    context.botPermission(PERMS.BAN);
    if (!row || (message && (row.message !== message.id || row.channel !== command.channel))) fail("This appeal control is no longer available.");
    if (action === "view") return appealCase(store, guild.id, n);
    if (row.status !== "pending") fail(`This appeal is already ${row.status}.`);
    const accepted = store.get("UPDATE appeals SET status='processing',actor=? WHERE guild=? AND n=? AND status='pending' RETURNING *", command.actor, guild.id, n);
    if (!accepted) fail("Another staff member already handled this appeal.");
    let decisionCase;
    try {
        if (action === "approve") {
            decisionCase = store.begin(command, "appeal unban", row.target, `Appeal for case #${n} approved by staff.`);
            const ban = await api(`/guilds/${guild.id}/bans/${row.target}`, { optional: true });
            if (ban && !ban.reason?.startsWith(`[Sonata case ${guild.id}-${n}] `)) fail("A different ban is now active. It was kept for manual staff review.");
            if (ban) await api(`/guilds/${guild.id}/bans/${row.target}`, { method: "DELETE", reason: `Sonata appeal approved by ${command.actor}, original case #${n}` });
            store.cancelJobs(guild.id, row.target, "tempban");
            store.status(guild.id, decisionCase, "completed");
        }
        store.run("UPDATE appeals SET status=? WHERE guild=? AND n=?", action === "approve" ? "approved" : "denied", guild.id, n);
        store.addNote(guild.id, n, command.actor, "appeal decision", action === "approve" ? "Approved and matching ban removed or already absent." : "Denied; ban kept.");
    } catch (error) { if (decisionCase) store.status(guild.id, decisionCase, "needs_review", error.message); store.run("UPDATE appeals SET status='needs_review' WHERE guild=? AND n=?", guild.id, n); store.addNote(guild.id, n, command.actor, "appeal review issue", error.message); throw error; }
    if (decisionCase) try { await caseLog(store, api, guild.id, decisionCase); } catch { store.addNote(guild.id, decisionCase, command.actor, "appeal log", "The unban succeeded, but its case log could not be delivered."); }
    const body = embed(`Appeal ${action === "approve" ? "approved" : "denied"}`, `Case #${n} · <@${row.target}>\nReviewed by <@${command.actor}>. ${action === "approve" ? "The matching ban was removed. A server invite is still needed to rejoin." : "The ban remains in place."}`);
    if (row.message) try { await api(`/channels/${row.channel}/messages/${row.message}`, { method: "PATCH", body: { ...body, components: [] } }); } catch { store.addNote(guild.id, n, command.actor, "appeal notice", "The review message could not be updated."); }
    try { const dm = await api("/users/@me/channels", { method: "POST", body: { recipient_id: row.target } }); await api(`/channels/${dm.id}/messages`, { method: "POST", body }); } catch { store.addNote(guild.id, n, command.actor, "appeal notice", "The member could not receive the decision DM."); }
    return body;
}
