/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { channel, command, member, option, reason, role, sub, text } from "./commandOptions.mjs";
import { PERMS } from "./discord.mjs";

export const ADVANCED_COMMANDS = [
    command("prefix", "View or change server and personal command prefixes", 0n, [
        sub("view", "Show server and personal prefixes"),
        sub("set", "Set this server's prefix", [option("prefix", 3, "One to five characters", true, { max_length: 5 })]),
        sub("remove", "Reset this server's prefix to a comma"),
        sub("self", "Set your own prefix across Sonata servers", [option("prefix", 3, "One to five characters", true, { max_length: 5 })]),
        sub("selfclear", "Remove your personal prefix"),
    ]),
    command("honeypot", "Configure channels that catch spammers", PERMS.ADMIN, [
        sub("add", "Enable a trap in an existing channel", [channel([0, 5]), option("action", 3, "What happens to non-exempt posters", true, { choices: ["timeout", "kick", "ban"].map(value => ({ name: value, value })) })]),
        sub("remove", "Disable a honeypot channel", [channel([0, 5])]),
        sub("list", "List honeypot channels and actions"),
        sub("exempt", "Exempt or unexempt a role", [role(), option("enabled", 5, "Exempt this role")]),
        sub("exemptions", "List honeypot exemptions"),
    ]),
    command("download", "Download Discord attachments and server expressions", 0n, [
        sub("message", "Download an attachment, or reply with download to detect media", [text("message", "A message ID or link"), option("index", 4, "Attachment number", false, { min_value: 1, max_value: 10 })]),
        sub("url", "Download a direct Discord CDN file link", [text("url", "A direct Discord CDN URL")]),
        sub("attachment", "Download a file attached to this command", [option("file", 11, "The file to copy")]),
        sub("emoji", "Download a Unicode or custom emoji image", [text("emoji", "An emoji or custom emoji ID")]),
        sub("sticker", "Download a sticker file", [text("id", "Sticker ID")]),
    ]),
    command("emoji", "Import and manage custom server emojis", 0n, [
        sub("steal", "Copy an emoji, or reply with emoji steal", [text("emoji", "An emoji, custom emoji ID, or reply"), option("name", 3, "Optional new emoji name", false, { max_length: 32 })]),
        sub("add", "Create an emoji from an uploaded image", [option("file", 11, "PNG, GIF or JPEG image up to 256 KiB"), option("name", 3, "Emoji name", true, { max_length: 32 })]),
        sub("rename", "Rename a server emoji", [text("id", "Emoji ID"), option("name", 3, "New emoji name", true, { max_length: 32 })]),
        sub("remove", "Delete a server emoji", [text("id", "Emoji ID")]),
        sub("info", "Show a custom emoji's image and ID", [text("emoji", "Custom emoji or emoji ID")]),
        sub("list", "Browse server emojis", [option("page", 4, "Page number", false, { min_value: 1 })]),
    ]),
    command("sticker", "Import and manage server stickers", 0n, [
        sub("steal", "Copy a PNG, APNG or GIF sticker, or reply with sticker steal", [text("id", "Sticker ID, or reply"), option("name", 3, "Optional new name", false, { max_length: 30 })]),
        sub("add", "Create a sticker from an uploaded image", [option("file", 11, "Sticker image up to 512 KiB"), option("name", 3, "Sticker name", true, { max_length: 30 })]),
        sub("rename", "Rename a server sticker", [text("id", "Sticker ID"), option("name", 3, "New sticker name", true, { max_length: 30 })]),
        sub("remove", "Delete a server sticker", [text("id", "Sticker ID")]),
        sub("info", "Show sticker details and download link", [text("id", "Sticker ID")]),
        sub("list", "Browse server stickers", [option("page", 4, "Page number", false, { min_value: 1 })]),
    ]),
    command("voicemaster", "Create and manage temporary voice rooms", 0n, [
        sub("setup", "Choose a join-to-create lobby and category", [channel([2]), option("category", 7, "Category for new rooms", true, { channel_types: [4] })]),
        sub("disable", "Stop creating rooms, keeping existing rooms"),
        sub("config", "Show the voice room configuration"),
        sub("room", "Open your current voice room control panel"),
        sub("name", "Rename your voice room", [option("name", 3, "Room name", true, { max_length: 100 })]),
        sub("limit", "Set your room's member limit", [option("limit", 4, "Zero means unlimited", true, { min_value: 0, max_value: 99 })]),
        sub("bitrate", "Set your room's bitrate in kbps", [option("kbps", 4, "Voice bitrate", true, { min_value: 8, max_value: 384 })]),
        ...["lock", "unlock", "hide", "unhide", "claim"].map(name => sub(name, `${name[0].toUpperCase() + name.slice(1)} your voice room`)),
        sub("transfer", "Transfer room ownership to a member in it", [member()]),
        sub("permit", "Allow a member to view and connect", [member()]),
        sub("reject", "Block a member and disconnect them from your room", [member(), reason()]),
        sub("reset", "Restore the room's original privacy permissions"),
    ]),
];
