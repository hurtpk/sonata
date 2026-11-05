/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { caseLog, caseMarker } from "./moderation.mjs";
import { releaseJail } from "./restrictions.mjs";
import { expireWarnings } from "./escalation.mjs";
import { giveawayTimers } from "./giveaways.mjs";
import { ticketTimers } from "./ticketExtras.mjs";
import { highestRole, PERMS, requirePermission, memberPermissions, fail } from "./discord.mjs";
import { maintainProfileBio } from "./guildProfile.mjs";
import { reminderTimers } from "./reminders.mjs";

export async function runDueJobs(store, api, botId) {
    for (const row of store.all("SELECT guild_profiles.guild FROM guild_profiles JOIN bot_guilds ON bot_guilds.id=guild_profiles.guild WHERE bot_guilds.active=1 AND COALESCE(json_extract(guild_profiles.data,'$.error'),'')<>'' LIMIT 1")) await maintainProfileBio(store, api, row.guild);
    store.run("DELETE FROM role_returns WHERE expires<=?", Date.now());
    for (const row of store.all("SELECT guild FROM settings")) expireWarnings(store, row.guild);
    const now = Date.now();
    store.run("DELETE FROM image_edits WHERE expires<=?", now);
    store.run("DELETE FROM moderation_approvals WHERE at<?", now - 30 * 86_400_000);
    await reminderTimers(store, api, now);
    for (const found of store.all("SELECT * FROM jobs WHERE state='pending' AND due<=? ORDER BY due LIMIT 5", now)) {
        const job = store.get("UPDATE jobs SET due=?,tries=tries+1 WHERE id=? AND state='pending' AND due<=? RETURNING *", now + 60_000, found.id, now);
        if (!job) continue;
        try {
            let note = "";
            if (job.kind.startsWith("temprole:")) {
                const roleId = job.kind.slice(9);
                const [guild, roles, target, bot] = await Promise.all([api(`/guilds/${job.guild}`), api(`/guilds/${job.guild}/roles`), api(`/guilds/${job.guild}/members/${job.target}`, { optional: true }), api(`/guilds/${job.guild}/members/${botId}`)]);
                const role = roles.find(value => value.id === roleId);
                if (role && target?.roles.includes(roleId)) {
                    requirePermission(memberPermissions(bot, roles, guild), PERMS.ROLES);
                    const top = highestRole(bot, roles, guild.id);
                    if (role.managed || top.position < role.position || (top.position === role.position && BigInt(top.id) >= BigInt(role.id))) fail("Move Sonata's role above the temporary role so it can expire.");
                    await api(`/guilds/${job.guild}/members/${job.target}/roles/${roleId}`, { method: "DELETE", reason: `Sonata temporary role expired, original case #${job.n}` });
                }
                note = `Temporary role <@&${roleId}> expired.${!target ? " The member is no longer in the server." : ""}`;
            }
            if (job.kind === "tempban") {
                const ban = await api(`/guilds/${job.guild}/bans/${job.target}`, { optional: true });
                if (ban && !ban.reason?.startsWith(caseMarker(job.guild, job.n) + " ")) { store.run("UPDATE jobs SET state='cancelled',detail=? WHERE id=?", "The ban reason changed. The newer ban was kept.", job.id); continue; }
                if (ban) await api(`/guilds/${job.guild}/bans/${job.target}`, { method: "DELETE", reason: `Sonata temp ban expired, original case #${job.n}` });
                else note = "The user was already unbanned.";
            }
            if (job.kind === "jail") {
                const [guild, roles, target, bot] = await Promise.all([api(`/guilds/${job.guild}`), api(`/guilds/${job.guild}/roles`), api(`/guilds/${job.guild}/members/${job.target}`, { optional: true }), api(`/guilds/${job.guild}/members/${botId}`)]);
                if (target) note = await releaseJail({ api, guild, roles, actor: { user: { id: guild.owner_id }, roles: [] }, bot }, store, target, `Sonata timed jail expired, original case #${job.n}`);
                else { store.clearRestriction(job.guild, job.target, "jail"); note = "Jail expired while the member was absent. No roles were granted to an absent member."; }
            }
            const existing = store.get("SELECT n FROM cases WHERE request=?", `job:${job.id}`);
            const n = existing?.n ?? store.begin({ id: `job:${job.id}`, guild: job.guild, actor: botId }, job.kind.startsWith("temprole:") ? "temporary role expired" : job.kind === "tempban" ? "automatic unban" : "automatic unjail", job.target, `Timed action from case #${job.n} expired.`, 0);
            store.status(job.guild, n, "completed", note);
            store.run("UPDATE jobs SET state='completed' WHERE id=?", job.id);
            try { await caseLog(store, api, job.guild, n); } catch { store.status(job.guild, n, "completed", [note, "Could not post the log message."].filter(Boolean).join(" ")); }
        } catch (error) {
            const retry = job.tries < 8 && ![400, 401, 403].includes(error.status);
            store.run("UPDATE jobs SET state=?,due=?,detail=? WHERE id=?", retry ? "pending" : "failed", Date.now() + Math.min(3600_000, 60_000 * 2 ** Math.min(job.tries, 6)), error.message.slice(0, 500), job.id);
            store.addNote(job.guild, job.n, botId, "timer", retry ? "A scheduled action failed and will be retried." : "A scheduled action could not complete. Staff must review the member's current state.");
        }
    }
    await giveawayTimers(store, api);
    await ticketTimers(store, api);
}
