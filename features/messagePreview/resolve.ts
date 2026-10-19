/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Work out which DM a hovered server-list item belongs to — without relying
// on Discord's internal component code. An item in the server list is a DM
// only if Discord's own data says so: its list ID is one of your DM channels,
// or it shows the avatar of someone you have a DM with (or a group DM's icon).

export interface ResolveDeps {
    isPrivateChannel(id: string): boolean;
    dmFromUser(userId: string): string | null | undefined;
}

const NAV_ATTR = "data-list-item-id";
const NAV_PREFIX = "guildsnav___";

function urlsIn(el: Element): string[] {
    const urls: string[] = [];
    el.querySelectorAll("img, image, [style*='background-image']").forEach(node => {
        const src = node.getAttribute("src") ?? node.getAttribute("href") ?? node.getAttribute("xlink:href");
        if (src) urls.push(src);
        const bg = (node as HTMLElement).style?.backgroundImage;
        const m = bg && /url\(["']?([^"')]+)/.exec(bg);
        if (m) urls.push(m[1]);
    });
    return urls;
}

/** The DM/group DM channel ID for a hovered element in the server list, or null. */
export function dmChannelFor(target: Element | null, deps: ResolveDeps): { channelId: string; anchor: Element; } | null {
    const item = target?.closest?.(`[${NAV_ATTR}^="${NAV_PREFIX}"]`);
    if (!item) return null;

    const listId = item.getAttribute(NAV_ATTR)!.slice(NAV_PREFIX.length);
    if (/^\d{17,20}$/.test(listId) && deps.isPrivateChannel(listId)) return { channelId: listId, anchor: item };

    for (const url of urlsIn(item)) {
        const avatar = /\/avatars\/(\d{17,20})\//.exec(url);
        if (avatar) {
            const dm = deps.dmFromUser(avatar[1]);
            if (dm) return { channelId: dm, anchor: item };
        }
        const group = /\/channel-icons\/(\d{17,20})\//.exec(url);
        if (group && deps.isPrivateChannel(group[1])) return { channelId: group[1], anchor: item };
    }
    return null;
}

/** Is message `id` newer than the last one you've read (`ackId`)? */
export function isUnread(id: string, ackId: string | null | undefined) {
    if (!ackId) return true;
    try { return BigInt(id) > BigInt(ackId); } catch { return false; }
}

/** Plain-text version of message content for the preview (mentions/emoji readable). */
export function readableContent(content: string, nameFor: (userId: string) => string | undefined) {
    return content
        .replace(/<@!?(\d{17,20})>/g, (_, id) => `@${nameFor(id) ?? "someone"}`)
        .replace(/<a?:(\w+):\d{17,20}>/g, ":$1:")
        .replace(/<#\d{17,20}>/g, "#channel")
        .replace(/<t:(\d+)(?::\w)?>/g, (_, t) => new Date(Number(t) * 1000).toLocaleString());
}
