/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Every permission a bot can ask for, in plain English, and how risky it is
// to hand out. The bit numbers are Discord's own.

export interface Perm { bit: number; name: string; what: string; group: "Basics" | "Messages" | "Voice" | "Moderation" | "Server"; risky?: boolean; }

export const PERMS: Perm[] = [
    { bit: 10, name: "View channels", what: "See channels (it can't do much without this)", group: "Basics" },
    { bit: 31, name: "Use slash commands", what: "Let people use its / commands", group: "Basics" },
    { bit: 26, name: "Change its own nickname", what: "Rename itself in the server", group: "Basics" },
    { bit: 0, name: "Create invites", what: "Make invite links to the server", group: "Basics" },
    { bit: 50, name: "Use external apps", what: "Use other apps' commands in the server", group: "Basics" },

    { bit: 11, name: "Send messages", what: "Post messages in channels", group: "Messages" },
    { bit: 38, name: "Send messages in threads", what: "Post inside threads", group: "Messages" },
    { bit: 16, name: "Read message history", what: "See messages sent before it joined the channel", group: "Messages" },
    { bit: 14, name: "Embed links", what: "Send embeds (the boxes with titles and colours)", group: "Messages" },
    { bit: 15, name: "Attach files", what: "Send pictures and files", group: "Messages" },
    { bit: 6, name: "Add reactions", what: "React to messages", group: "Messages" },
    { bit: 18, name: "Use external emoji", what: "Use emoji from other servers", group: "Messages" },
    { bit: 37, name: "Use external stickers", what: "Use stickers from other servers", group: "Messages" },
    { bit: 35, name: "Create public threads", what: "Start threads anyone can see", group: "Messages" },
    { bit: 36, name: "Create private threads", what: "Start invite-only threads", group: "Messages" },
    { bit: 49, name: "Create polls", what: "Post polls", group: "Messages" },
    { bit: 46, name: "Send voice messages", what: "Send voice messages", group: "Messages" },
    { bit: 12, name: "Send text-to-speech", what: "Send messages that are read aloud", group: "Messages" },
    { bit: 13, name: "Manage messages", what: "Delete and pin anyone's messages", group: "Messages", risky: true },
    { bit: 17, name: "Mention @everyone", what: "Ping @everyone, @here and every role", group: "Messages", risky: true },

    { bit: 20, name: "Connect", what: "Join voice channels", group: "Voice" },
    { bit: 21, name: "Speak", what: "Talk or play audio in voice (music bots need this)", group: "Voice" },
    { bit: 25, name: "Use voice activity", what: "Talk without push-to-talk", group: "Voice" },
    { bit: 9, name: "Video", what: "Share video or a screen in voice", group: "Voice" },
    { bit: 8, name: "Priority speaker", what: "Be heard over others", group: "Voice" },
    { bit: 42, name: "Use soundboard", what: "Play soundboard sounds", group: "Voice" },
    { bit: 22, name: "Mute members", what: "Server-mute people in voice", group: "Voice", risky: true },
    { bit: 23, name: "Deafen members", what: "Server-deafen people in voice", group: "Voice", risky: true },
    { bit: 24, name: "Move members", what: "Move people between voice channels (or disconnect them)", group: "Voice", risky: true },

    { bit: 40, name: "Time out members", what: "Stop people from talking for a while", group: "Moderation", risky: true },
    { bit: 1, name: "Kick members", what: "Remove people from the server", group: "Moderation", risky: true },
    { bit: 2, name: "Ban members", what: "Ban people from the server", group: "Moderation", risky: true },
    { bit: 27, name: "Manage nicknames", what: "Change other people's nicknames", group: "Moderation", risky: true },
    { bit: 7, name: "View audit log", what: "See the server's log of changes", group: "Moderation" },
    { bit: 34, name: "Manage threads", what: "Rename, lock and delete threads", group: "Moderation" },

    { bit: 28, name: "Manage roles", what: "Make roles and give them out (only below its own role)", group: "Server", risky: true },
    { bit: 4, name: "Manage channels", what: "Make, change and delete channels", group: "Server", risky: true },
    { bit: 29, name: "Manage webhooks", what: "Make webhooks (which can post as anyone)", group: "Server", risky: true },
    { bit: 30, name: "Manage emoji & stickers", what: "Add and remove the server's emoji and stickers", group: "Server" },
    { bit: 33, name: "Manage events", what: "Make and change server events", group: "Server" },
    { bit: 5, name: "Manage server", what: "Change the server's name, icon and settings", group: "Server", risky: true },
    { bit: 3, name: "Administrator", what: "EVERYTHING — every permission, everywhere. Almost no bot needs this", group: "Server", risky: true },
];

export const GROUPS: Perm["group"][] = ["Basics", "Messages", "Voice", "Moderation", "Server"];

/** Ready-made sets for common kinds of bot. */
export const PERM_PRESETS: { name: string; bits: number[]; }[] = [
    { name: "Chat bot", bits: [10, 31, 11, 38, 16, 14, 15, 6, 18] },
    { name: "Music bot", bits: [10, 31, 11, 14, 20, 21, 25] },
    { name: "Moderation bot", bits: [10, 31, 11, 16, 14, 13, 40, 1, 2, 27, 7, 34, 28] },
    { name: "Welcome bot", bits: [10, 31, 11, 14, 15, 28] },
];

export const toNumber = (bits: Iterable<number>) => [...bits].reduce((n, b) => n | (1n << BigInt(b)), 0n);

/** "274877975552" → the permissions it holds (any unknown bits are kept as numbers). */
export function fromNumber(value: string): number[] {
    let n: bigint;
    try { n = BigInt(value.trim() || "0"); } catch { return []; }
    const out: number[] = [];
    for (let b = 0; b < 64; b++) if (n & (1n << BigInt(b))) out.push(b);
    return out;
}

export function inviteUrl(clientId: string, bits: Iterable<number>, slash: boolean) {
    const p = new URLSearchParams({ client_id: clientId, permissions: toNumber(bits).toString(), scope: slash ? "bot applications.commands" : "bot", integration_type: "0" });
    return `https://discord.com/oauth2/authorize?${p.toString().replace(/\+/g, "%20")}`;
}
