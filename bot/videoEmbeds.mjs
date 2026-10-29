/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Buffer } from "node:buffer";
import { channelPermissions, embed, PERMS, requirePermission } from "./discord.mjs";

export { videoSource } from "./music/videoSource.mjs";
import { videoSource } from "./music/videoSource.mjs";

export async function videoCommand(context, bridge) {
    const { command, channel, actor, bot, guild, roles } = context;
    requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW | PERMS.SEND);
    requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.SEND | PERMS.ATTACH | PERMS.EMBEDS);
    const source = videoSource(command.options.url);
    const response = embed("Video", `[Original video](${source})`);
    if (!bridge?.online()) throw new Error("The video service is offline. Try again after it reconnects.");
    const typing = () => context.api(`/channels/${channel.id}/typing`, { method: "POST" }).catch(() => false);
    void typing(); const timer = setInterval(typing, 8000);
    let result;
    try { result = await bridge.submit({ id: command.id, kind: "video", guild: guild.id, channel: channel.id, source }); }
    finally { clearInterval(timer); }
    if (!result.video) throw new Error(result.description || "The video service could not download this video. Try another public link.");
    const host = new URL(source).hostname, platform = host.endsWith("tiktok.com") ? "TikTok" : host.endsWith("instagram.com") ? "Instagram" : host === "x.com" ? "X" : "YouTube";
    const stats = [["views", "👁"], ["likes", "❤️"], ["comments", "💬"], ["shares", "🔁"]].filter(([key]) => result.stats?.[key] !== undefined).map(([key, emoji]) => `${emoji} ${typeof result.stats[key] === "number" ? result.stats[key].toLocaleString("en-US") : result.stats[key]}`);
    response.embeds[0].footer = { text: [platform, ...stats, `Sent by ${actor.nick || actor.user.global_name || actor.user.username || actor.user.id}`].join(" • "), ...(platform === "TikTok" ? { icon_url: "https://www.tiktok.com/favicon.ico" } : {}) };
    if (result.published) response.embeds[0].timestamp = result.published;
    response.embeds[0].title = result.title || "Video";
    response.embeds[0].url = source;
    response.embeds[0].description = result.description || "";
    response.files = [{ name: "sonata-video.mp4", type: "video/mp4", bytes: Buffer.from(result.video, "base64") }];
    return response;
}
