/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { featureEnabled } from "./featureGroups.mjs";
import { channelPermissions, embed, fail, PERMS, requirePermission } from "./discord.mjs";

export async function starboardCommand(context, store) {
    const { command, guild, api, actor, bot, roles } = context, settings = store.settings(guild.id);
    if (command.sub === "starboardview") return embed("Starboard", settings.starboard ? `Channel: <#${settings.starboard.channel}>\nThreshold: ${settings.starboard.threshold} ⭐\nStatus: ${settings.starboard.enabled ? "On" : "Off"}${settings.starboard.error ? `\nLast issue: ${settings.starboard.error}` : ""}` : "Starboard is not configured. Use starboard setup <channel> <stars>.");
    if (command.sub === "starboardoff") {
        if (settings.starboard) settings.starboard.enabled = false;
    } else {
        const channel = await api(`/channels/${command.options.channel}`);
        if (channel.guild_id !== guild.id || ![0, 5].includes(channel.type)) fail("Choose a text or announcement channel in this server.");
        requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW);
        requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.SEND | PERMS.EMBEDS | PERMS.HISTORY);
        settings.starboard = { channel: channel.id, threshold: command.options.threshold, enabled: true };
    }
    store.saveSettings(guild.id, settings);
    return embed("Starboard saved", command.sub === "starboardoff" ? "Starboard is paused. Existing highlights are kept." : `Messages with ${settings.starboard.threshold} ⭐ reactions will appear in <#${settings.starboard.channel}>. Restricted channels are only copied to a board with matching visibility. Age-restricted messages stay in age-restricted channels.`);
}

const visibility = channel => JSON.stringify((channel.permission_overwrites ?? []).filter(value => (BigInt(value.allow) | BigInt(value.deny)) & PERMS.VIEW).map(value => [value.id, value.type, String(BigInt(value.allow) & PERMS.VIEW), String(BigInt(value.deny) & PERMS.VIEW)]).sort((a, b) => a[0].localeCompare(b[0])));
const mediaUrl = value => typeof value === "string" && /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\//.test(value);

export async function starboardEvent(type, data, store, api) {
    if (data.guild_id && !featureEnabled(store.settings(data.guild_id), "server")) return;
    const config = store.settings(data.guild_id).starboard;
    if (type === "MESSAGE_DELETE" || type === "MESSAGE_DELETE_BULK") {
        for (const id of data.ids ?? [data.id]) {
            for (const row of store.all("SELECT * FROM starboard_posts WHERE guild=? AND source=?", data.guild_id, id)) {
                await api(`/channels/${row.board}/messages/${row.message}`, { method: "DELETE", optional: true });
                store.run("DELETE FROM starboard_posts WHERE guild=? AND source=? AND board=?", row.guild, id, row.board);
            }
            store.run("DELETE FROM starboard_posts WHERE guild=? AND board=? AND message=?", data.guild_id, data.channel_id, id);
        }
        return;
    }
    if (!config?.enabled || data.channel_id === config.channel || (data.emoji && (data.emoji.id || data.emoji.name !== "⭐"))) return;
    const id = data.message_id ?? data.id;
    const row = store.get("SELECT * FROM starboard_posts WHERE guild=? AND source=? AND board=?", data.guild_id, id, config.channel);
    if (type === "MESSAGE_UPDATE" && !row) return;
    const message = await api(`/channels/${data.channel_id}/messages/${id}`, { optional: true });
    if (!message) return;
    const reaction = message.reactions?.find(value => value.emoji.name === "⭐" && !value.emoji.id);
    const count = reaction?.count_details?.normal ?? reaction?.count ?? 0;
    const [source, board] = await Promise.all([api(`/channels/${data.channel_id}`), api(`/channels/${config.channel}`)]);
    const eligible = !message.author.bot && !message.webhook_id && source.guild_id === data.guild_id && board.guild_id === data.guild_id && [0, 5].includes(source.type) && (!source.nsfw || board.nsfw) && visibility(source) === visibility(board);
    if (count < config.threshold || !eligible) {
        if (row) {
            await api(`/channels/${row.board}/messages/${row.message}`, { method: "DELETE", optional: true });
            store.run("DELETE FROM starboard_posts WHERE guild=? AND source=? AND board=?", row.guild, id, row.board);
        }
        return;
    }
    const link = `https://discord.com/channels/${data.guild_id}/${data.channel_id}/${id}`;
    const body = embed(`⭐ ${count} · #${source.name || "channel"}`, `${(message.content ?? "").slice(0, 1400)}\n\n[Jump to message](${link})`);
    const card = body.embeds[0];
    card.color = 0xc18b8f;
    card.author = { name: (message.author.global_name || message.author.username || message.author.id).slice(0, 256), ...(message.author.avatar ? { icon_url: `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.png?size=64` } : {}) };
    card.footer = { text: `User ${message.author.id} · Message ${id}` };
    if (message.timestamp) card.timestamp = message.timestamp;
    const files = (message.attachments ?? []).filter(file => mediaUrl(file.url));
    const image = files.find(file => file.content_type?.startsWith("image/"));
    if (image) card.image = { url: image.url };
    if (files.length) card.fields = [{ name: "Attachments", value: files.slice(0, 5).map((file, index) => `[File ${index + 1}](${file.url})`).join(" · ") }];
    body.components = [{ type: 1, components: [{ type: 2, style: 5, label: "Original message", url: link }] }];
    if (row && await api(`/channels/${row.board}/messages/${row.message}`, { method: "PATCH", body, optional: true })) return;
    const posted = await api(`/channels/${config.channel}/messages`, { method: "POST", body: { ...body, nonce: `sb:${id}`, enforce_nonce: true } });
    store.run("INSERT INTO starboard_posts VALUES (?,?,?,?,?) ON CONFLICT(guild,source,board) DO UPDATE SET message=excluded.message", data.guild_id, id, data.channel_id, config.channel, posted.id);
}
