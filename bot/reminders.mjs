/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { command, duration, option, sub } from "./commandOptions.mjs";
import { embed, fail } from "./discord.mjs";
import { parseDuration } from "./commands.mjs";
import { button, rows } from "./interactionUI.mjs";

export const REMIND_COMMAND = command("remind", "Schedule a private reminder", 0n, [
    sub("set", "Schedule a reminder by direct message", [duration(), option("message", 3, "What to remind you about", true, { max_length: 300 })]),
    sub("list", "Receive your pending reminders in a direct message"),
    sub("cancel", "Cancel one of your reminders", [option("id", 3, "Reminder ID from your confirmation or list", true, { max_length: 16 })]),
], ["remindme"]);

const stamp = ms => "<t:" + Math.floor(ms / 1000) + ":R>";

export async function reminderCommand(context, store) {
    const { command, api } = context, { actor, options: o } = command;
    if (command.sub === "cancel") return reminderControl(store, actor, o.id, "cancel");
    if (command.sub === "list") {
        const found = store.all("SELECT * FROM reminders WHERE user=? AND state IN ('pending','sending','failed') ORDER BY due LIMIT 20", actor);
        if (!found.length) return embed("Reminders", "You have no pending reminders.");
        const dm = await api("/users/@me/channels", { method: "POST", body: { recipient_id: actor } });
        for (let offset = 0; offset < found.length; offset += 5) await api("/channels/" + dm.id + "/messages", { method: "POST", body: embed("Your reminders", found.slice(offset, offset + 5).map(row => "**" + row.id + "** · " + (row.state === "failed" ? "Delivery failed" : stamp(row.due)) + "\n" + row.text).join("\n\n")) });
        return embed("Reminders sent", "Check your direct messages for the list.");
    }
    const ms = parseDuration(o.duration);
    if (ms < 60_000) fail("Choose a reminder at least one minute from now.");
    if (!o.message.trim()) fail("Enter something to be reminded about.");
    if (store.get("SELECT COUNT(*) AS n FROM reminders WHERE user=? AND state IN ('pending','sending')", actor).n >= 20) fail("Cancel a reminder before scheduling more than 20.");
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16), now = Date.now(), due = now + ms;
    store.run("INSERT INTO reminders (id,user,text,due,state,at) VALUES (?,?,?,?,'pending',?)", id, actor, o.message.trim(), due, now);
    return { ...embed("Reminder scheduled", "I'll DM you " + stamp(due) + ". ID: " + id + "."), components: rows([button("snremind:" + id + ":cancel", "Cancel reminder", 4)]) };
}

export function reminderControl(store, user, id, action, message) {
    const now = Date.now();
    if (action === "cancel") {
        const row = store.get("UPDATE reminders SET state='cancelled',at=? WHERE id=? AND user=? AND state IN ('pending','sent','failed') RETURNING id", now, id, user);
        if (!row) fail("This reminder isn't yours, has already ended or is being delivered.");
        return embed("Reminder cancelled", "This reminder will not be sent again.");
    }
    const minutes = action === "s10" ? 10 : action === "s60" ? 60 : 0;
    if (!minutes || !message) fail("Choose a snooze button on your latest reminder.");
    if (store.get("SELECT COUNT(*) AS n FROM reminders WHERE user=? AND state IN ('pending','sending')", user).n >= 20) fail("Cancel an active reminder before snoozing.");
    const due = now + minutes * 60_000;
    const row = store.get("UPDATE reminders SET state='pending',due=?,at=?,attempts=0,message='' WHERE id=? AND user=? AND state='sent' AND message=? RETURNING id", due, now, id, user, message);
    if (!row) fail("This reminder isn't yours or has already been snoozed.");
    return embed("Reminder snoozed", "I'll DM you again " + stamp(due) + ".");
}

export async function reminderTimers(store, api, now = Date.now()) {
    store.run("DELETE FROM reminders WHERE state IN ('sent','cancelled','failed') AND at<?", now - 30 * 86_400_000);
    for (const entry of store.all("SELECT id FROM reminders WHERE (state='pending' AND due<=?) OR (state='sending' AND at<?) ORDER BY due LIMIT 5", now, now - 120_000)) {
        const row = store.get("UPDATE reminders SET state='sending',attempts=attempts+1,at=? WHERE id=? AND ((state='pending' AND due<=?) OR (state='sending' AND at<?)) RETURNING *", now, entry.id, now, now - 120_000);
        if (!row) continue;
        if (store.get("SELECT id FROM user_blacklist WHERE id=?", row.user)) { store.run("UPDATE reminders SET state='cancelled',at=? WHERE id=?", now, row.id); continue; }
        try {
            const dm = await api("/users/@me/channels", { method: "POST", body: { recipient_id: row.user } });
            const sent = await api("/channels/" + dm.id + "/messages", { method: "POST", body: {
                ...embed("Your Sonata reminder", row.text), nonce: row.id, enforce_nonce: true,
                components: rows([button("snremind:" + row.id + ":s10", "Snooze 10 min"), button("snremind:" + row.id + ":s60", "Snooze 1 hour"), button("snremind:" + row.id + ":cancel", "Dismiss")]),
            } });
            store.run("UPDATE reminders SET state='sent',message=?,at=? WHERE id=?", sent.id, Date.now(), row.id);
        } catch (error) {
            const retry = row.attempts < 3 && ![400, 401, 403, 404].includes(error.status);
            store.run("UPDATE reminders SET state=?,due=?,at=? WHERE id=?", retry ? "pending" : "failed", now + 60_000, Date.now(), row.id);
        }
    }
}
