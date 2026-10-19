/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Where a message is on screen, for Spotlight and Love; the newest message if it has no element yet. */
export function messageRect(channelId: string, ...ids: (string | undefined)[]): DOMRect | null {
    for (const id of ids) {
        const el = id && document.getElementById(`chat-messages-${channelId}-${id}`);
        if (el) return el.getBoundingClientRect();
    }
    const items = document.querySelectorAll('[data-list-id="chat-messages"] > li');
    return items.length ? items[items.length - 1].getBoundingClientRect() : null;
}
