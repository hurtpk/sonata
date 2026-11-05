/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { channel, option, reason, sub } from "./commandOptions.mjs";
import { channelPermissions, embed, fail, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { button, rows } from "./interactionUI.mjs";
import { commandContext, executeCommand } from "./moderation.mjs";
import { COMMANDS } from "./commands.mjs";

const permissions = { ban: PERMS.BAN, tempban: PERMS.BAN, kick: PERMS.KICK, timeout: PERMS.TIMEOUT };
const reviewId = () => option("id", 3, "Pending approval request ID", true, { max_length: 16 });
export const APPROVAL_OPTIONS = [
    sub("approvalrule", "Require a second moderator for a selected action", [option("action", 3, "Action to require approval for", true, { choices: Object.keys(permissions).map(value => ({ name: value, value })) }), option("enabled", 5, "Require approval"), channel([0, 5], false)]),
    sub("approvals", "Browse recent moderation approval requests", [option("page", 4, "Approval requests page", false, { min_value: 1, max_value: 50 })]),
    sub("approve", "Approve and perform a pending moderation request", [reviewId()]),
    sub("reject", "Reject a pending moderation request without acting", [reviewId(), reason()]),
];

async function reviewChannel(context, id) {
    const { api, guild, roles, bot } = context, channel = await api("/channels/" + id);
    if (channel.guild_id !== guild.id || ![0, 5].includes(channel.type)) fail("Choose a staff text channel in this server.");
    const staff = PERMS.ADMIN | PERMS.BAN | PERMS.KICK | PERMS.TIMEOUT;
    const everyone = roles.find(role => role.id === guild.id);
    if (channelPermissions({ user: { id: "0" }, roles: [] }, [everyone], guild, channel) & PERMS.VIEW) fail("Choose a staff channel that everyone cannot view.");
    for (const role of roles) {
        if ((BigInt(role.permissions) | BigInt(everyone.permissions)) & staff) continue;
        const member = { user: { id: "0" }, roles: role.id === guild.id ? [] : [role.id] };
        if (channelPermissions(member, [everyone, role], guild, channel) & PERMS.VIEW) fail("Choose a staff channel that ordinary roles cannot view.");
    }
    if ((channel.permission_overwrites ?? []).some(overwrite => overwrite.type === 1 && (BigInt(overwrite.allow) & PERMS.VIEW))) fail("Use staff roles for access to the review channel instead of individual overrides.");
    requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.SEND | PERMS.EMBEDS);
    return channel;
}

export async function requestApproval(context, store) {
    const { command, guild, api } = context, channel = context.settings.approvalRules[command.name];
    await reviewChannel(context, channel);
    if (store.get("SELECT COUNT(*) AS n FROM moderation_approvals WHERE guild=? AND state='pending' AND expires>?", guild.id, Date.now()).n >= 30) fail("Review existing approval requests before submitting more.");
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16), now = Date.now(), expires = now + 30 * 60_000;
    const { name, sub, options, actor, evidence, prefix } = command;
    const data = JSON.stringify({ name, sub, options, actor, evidence, prefix, channel: command.channel });
    store.run("INSERT INTO moderation_approvals (guild,id,channel,data,expires,at) VALUES (?,?,?,?,?,?)", guild.id, id, channel, data, expires, now);
    try {
        const card = await api("/channels/" + channel + "/messages", { method: "POST", body: {
            ...embed("Moderation approval requested", "**" + name + "** · <@" + options.member + ">\nRequested by <@" + actor + ">\nReason: " + (options.reason ?? "No reason supplied.") + "\nRequest " + id + " · Expires <t:" + Math.floor(expires / 1000) + ":R>"),
            components: rows([button("snapprove:" + id + ":approve", "Approve", 3), button("snapprove:" + id + ":reject", "Reject", 4)]),
        } });
        store.run("UPDATE moderation_approvals SET message=? WHERE guild=? AND id=?", card.id, guild.id, id);
    } catch (error) {
        store.run("DELETE FROM moderation_approvals WHERE guild=? AND id=?", guild.id, id);
        throw error;
    }
    return embed("Awaiting staff approval", "Request " + id + " needs approval from a different moderator within 30 minutes. No action has been taken.");
}

export async function approvalCommand(context, store, botId, receipt) {
    const { command, guild, api, actor, roles } = context, o = command.options, bits = memberPermissions(actor, roles, guild);
    if (command.sub === "approvalrule") {
        requirePermission(bits, PERMS.ADMIN);
        const settings = store.settings(guild.id), rules = settings.approvalRules ?? {}, previous = rules[o.action];
        if (o.enabled) {
            if (!o.channel) fail("Choose the staff review channel.");
            const channel = await reviewChannel(context, o.channel);
            requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW);
            rules[o.action] = channel.id;
        } else delete rules[o.action];
        if (previous !== rules[o.action]) store.run("UPDATE moderation_approvals SET state='cancelled',at=? WHERE guild=? AND state='pending' AND json_extract(data,'$.name')=?", Date.now(), guild.id, o.action);
        settings.approvalRules = rules; store.saveSettings(guild.id, settings);
        return embed("Approval rule saved", o.action + (o.enabled ? " now requires a second moderator through <#" + o.channel + ">." : " no longer requires approval. Outstanding requests under this rule cannot be approved."));
    }
    if (!(bits & (PERMS.ADMIN | PERMS.BAN | PERMS.KICK | PERMS.TIMEOUT))) fail("Moderation permissions are required to review requests.", "denied");
    if (command.sub === "approvals") {
        const list = store.all("SELECT * FROM moderation_approvals WHERE guild=? ORDER BY at DESC LIMIT 8 OFFSET ?", guild.id, ((o.page ?? 1) - 1) * 8);
        return embed("Moderation approvals", list.map(row => {
            const data = JSON.parse(row.data);
            return "**" + row.id + "** · " + data.name + " · " + (row.state === "pending" && row.expires <= Date.now() ? "expired" : row.state) + (row.case_n ? " · Case #" + row.case_n : "");
        }).join("\n") || "No approval requests on this page.");
    }
    const row = store.get("SELECT * FROM moderation_approvals WHERE guild=? AND id=?", guild.id, o.id);
    if (!row || row.state !== "pending" || row.expires <= Date.now()) fail("This request expired or was already decided.");
    if (receipt && (row.channel !== command.channel || row.message !== receipt)) fail("Use the original review message.");
    const data = JSON.parse(row.data), definition = COMMANDS.find(value => value.name === data.name);
    if (command.sub === "approve") {
        if (data.actor === command.actor) fail("Another moderator must approve your request.", "denied");
        if (store.settings(guild.id).approvalRules?.[data.name] !== row.channel) fail("The approval rule changed. Submit a new request.");
        await reviewChannel(context, row.channel);
    }
    requirePermission(bits, permissions[data.name]);
    if (command.sub === "approve") {
        const preview = await commandContext({ ...data, definition, actor: command.actor, guild: guild.id, id: command.id }, botId, api, store.settings(guild.id));
        await preview.target(data.options.member, ["ban", "tempban"].includes(data.name));
    }
    const claimed = store.get("UPDATE moderation_approvals SET state=?,decided_by=?,at=? WHERE guild=? AND id=? AND state='pending' AND expires>? RETURNING id", command.sub === "approve" ? "processing" : "rejected", command.actor, Date.now(), guild.id, row.id, Date.now());
    if (!claimed) fail("This request expired or was already decided.");
    let state = "rejected", number = null;
    if (command.sub === "approve") {
        const id = "approved:" + row.id;
        try {
            await executeCommand({ ...data, definition, id, guild: guild.id, approval: { id: row.id, actor: command.actor } }, store, api, botId);
            const result = store.get("SELECT n,status FROM cases WHERE request=?", id);
            state = result?.status === "completed" ? "approved" : "needs review"; number = result?.n ?? null;
        } catch { state = "needs review"; }
    }
    store.run("UPDATE moderation_approvals SET state=?,case_n=?,detail=? WHERE guild=? AND id=?", state, number, o.reason ?? "", guild.id, row.id);
    const status = embed("Moderation request " + state, "Request " + row.id + " · Reviewer <@" + command.actor + ">" + (number ? "\nCase #" + number : "") + (o.reason ? "\nReason: " + o.reason : "") + (state === "needs review" ? "\nCheck the case or Command failures before retrying." : ""));
    if (row.message) await api("/channels/" + row.channel + "/messages/" + row.message, { method: "PATCH", body: { ...status, components: [] }, optional: true }).catch(() => null);
    return status;
}
