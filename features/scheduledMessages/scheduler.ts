/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sends due messages. Checks every 2 seconds; anything that came due while
// Discord was closed (or the computer was asleep) by more than GRACE_MS is
// NOT sent automatically — it's marked "missed" and waits for you to choose
// Send now / Reschedule / Discard. Repeating messages just skip the missed
// occurrence and roll on to the next one.

import { sendMessage } from "@utils/discord";
import { ChannelStore, showToast } from "@webpack/common";

import * as Q from "./store";

/** How late a message may still be sent automatically. */
export const GRACE_MS = 2 * 60 * 1000;
/** Gap between messages that come due at the same time. */
export const SEND_GAP_MS = 1500;
const TICK_MS = 2000;

let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export function markMissed(now = Date.now()) {
    for (const item of Q.pending()) {
        if (item.sendAt >= now - GRACE_MS) continue;
        if (item.repeat !== "none") {
            Q.recordHistory(item, "failed", "Missed — Discord wasn't running at the time");
            Q.updateItem(item.id, { sendAt: Q.nextOccurrence(item.sendAt, item.repeat, now) });
        } else {
            Q.updateItem(item.id, { status: "missed" });
        }
    }
}

/** Send one message now and move it to history (repeats roll forward). */
export async function sendOne(item: Q.ScheduledMessage) {
    let error: string | undefined;
    if (!ChannelStore.getChannel(item.channelId)) {
        error = "Channel not found — you may have left that server or closed the DM";
    } else {
        try {
            await sendMessage(item.channelId, { content: item.content }, false);
        } catch (e: any) {
            error = String(e?.message ?? e ?? "Unknown error");
        }
    }

    Q.recordHistory(item, error ? "failed" : "sent", error);
    if (item.repeat !== "none" && item.status === "pending") {
        Q.updateItem(item.id, { sendAt: Q.nextOccurrence(item.sendAt, item.repeat) });
    } else {
        Q.removeItem(item.id);
    }

    if (error) showToast(`Scheduled message failed: ${error}`, "failure");
    else showToast("Scheduled message sent", "success");
    return !error;
}

export async function tick() {
    if (busy || !Q.isLoaded()) return;
    busy = true;
    try {
        markMissed();
        const due = Q.pending().filter(i => i.sendAt <= Date.now());
        for (let i = 0; i < due.length; i++) {
            await sendOne(due[i]);
            if (i < due.length - 1) await wait(SEND_GAP_MS);
        }
    } finally {
        busy = false;
    }
}

export function startScheduler() {
    stopScheduler();
    markMissed();
    timer = setInterval(tick, TICK_MS);
}

export function stopScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
}
