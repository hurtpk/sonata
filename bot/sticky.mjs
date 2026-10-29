/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { channelPermissions, embed, fail, isId, PERMS, requirePermission } from "./discord.mjs";

export async function stickyCommand(context, store) {
    const { command, guild, channel, api, actor, bot, roles } = context;
    if (![0, 5].includes(channel.type)) fail("Use a regular text or announcement channel.");
    for (const member of [actor, bot]) requirePermission(channelPermissions(member, roles, guild, channel), PERMS.VIEW | PERMS.SEND | PERMS.HISTORY);
    const old = store.get("SELECT * FROM sticky_messages WHERE channel=? AND guild=?", channel.id, guild.id), raw = command.options.message;
    if (command.sub === "remove") {
        if (!old) fail("There is no sticky message in this channel.");
        if (raw && raw !== old.message && raw !== old.original && raw !== `https://discord.com/channels/${guild.id}/${channel.id}/${old.message}` && raw !== `https://discord.com/channels/${guild.id}/${channel.id}/${old.original}`) fail("Use the current sticky message link or its original message link in this channel.");
        store.run("DELETE FROM sticky_messages WHERE channel=?", channel.id);
        await api(`/channels/${channel.id}/messages/${old.message}`, { method: "DELETE", optional: true });
        return embed("Sticky message removed", "The message will no longer be reposted.");
    }
    let text = raw, original = "";
    const link = /^https:\/\/(?:canary\.|ptb\.)?discord.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})$/.exec(raw || "");
    if (!raw || raw === "reply" || link) {
        const reference = command.reply;
        if (link && (link[1] !== guild.id || link[2] !== channel.id)) fail("Choose a message from this channel.");
        original = link?.[3] || reference?.message_id;
        if (!isId(original) || (!link && reference?.channel_id && reference.channel_id !== channel.id)) fail("Supply text or reply to a message in this channel.");
        const source = await api(`/channels/${channel.id}/messages/${original}`, { optional: true });
        if (!source?.content?.trim()) fail("Choose a message with text. Attachments are not copied into sticky messages.");
        text = source.content;
    }
    if (!text?.trim() || text.length > 1800) fail("Use between one and 1,800 characters.");
    if (old) await api(`/channels/${channel.id}/messages/${old.message}`, { method: "DELETE", optional: true });
    const body = embed("Sticky message", text); body.embeds[0].footer = { text: "Use /stick remove to stop reposting." };
    const posted = await api(`/channels/${channel.id}/messages`, { method: "POST", body });
    store.run("INSERT INTO sticky_messages VALUES (?,?,?,?,?,?,?) ON CONFLICT(channel) DO UPDATE SET content=excluded.content,message=excluded.message,original=excluded.original,actor=excluded.actor,error=''", guild.id, channel.id, text, posted.id, original || "", actor.user.id, "");
    return { ...embed("Sticky message saved", "This channel's sticky message moves below new messages. Use unstick or /stick remove to stop."), silent: true };
}

export async function stickyEvent(data, store, api) {
    if (!data.guild_id || data.author?.bot || data.webhook_id || !data.id) return;
    const row = store.get("SELECT * FROM sticky_messages WHERE channel=? AND guild=?", data.channel_id, data.guild_id);
    if (!row || row.message === data.id || (row.message && BigInt(data.id) < BigInt(row.message))) return;
    if (/^[,/]?(?:unstick(?:message)?|stick(?:message)?)(?:\s|$)/i.test(data.content || "")) return;
    if (!store.claim(`sticky:${data.id}`)) return;
    try {
        await api(`/channels/${row.channel}/messages/${row.message}`, { method: "DELETE", optional: true });
        const message = embed("Sticky message", row.content); message.embeds[0].footer = { text: "Use /stick remove to stop reposting." };
        const posted = await api(`/channels/${row.channel}/messages`, { method: "POST", body: message });
        store.run("UPDATE sticky_messages SET message=?,error='' WHERE channel=?", posted.id, row.channel);
    } catch (error) { store.run("UPDATE sticky_messages SET error=? WHERE channel=?", String(error.message).slice(0, 300), row.channel); }
}
