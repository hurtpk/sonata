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
    const source = videoSource(command.options.url), url = new URL(source);
    const response = embed("Video", `[Original video](${source})`);
    const fixed = source.replace(url.hostname, url.hostname.endsWith("tiktok.com") ? url.hostname.replace("tiktok.com", "tnktok.com") : url.hostname.endsWith("instagram.com") ? "kkinstagram.com" : url.hostname === "x.com" ? "fxtwitter.com" : url.hostname);
    response.embeds[0].footer = { text: `Sent by ${actor.nick || actor.user.global_name || actor.user.username || actor.user.id}`, ...(/^(?:a_)?[a-f0-9]{32}$/i.test(actor.user.avatar || "") ? { icon_url: `https://cdn.discordapp.com/avatars/${actor.user.id}/${actor.user.avatar}.png?size=64` } : {}) };
    if (!bridge?.online()) return { ...response, content: fixed };
    const result = await bridge.submit({ id: command.id, kind: "video", guild: guild.id, channel: channel.id, source });
    if (!result.video) return { ...response, content: fixed };
    response.embeds[0].title = result.title || "Video";
    response.files = [{ name: "sonata-video.mp4", type: "video/mp4", bytes: Buffer.from(result.video, "base64") }];
    return response;
}
