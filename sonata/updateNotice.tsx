/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "Sonata 2026.10.20 is out" — a blue bar along the top of Discord, like
// Discord's own notices, when GitHub has a newer Sonata than this one. It
// looks a minute after Discord starts and then every 15 minutes, shows each
// new version once, and its Update button opens Install Sonata.bat (which
// shows what changed and asks before updating). Switch it off in Updates.

import { showNotice } from "@api/Notices";
import { showToast } from "@webpack/common";

import { LATEST } from "./changelog";

const native = () => VencordNative.pluginHelpers.Sonata as any;

const STYLE_ID = "sonata-update-notice";
const EVERY = 15 * 60_000;
let timers: ReturnType<typeof setTimeout>[] = [];
let shown = new Set<string>();

/** Blue, only for Sonata's own bar, and only while it's showing (so it costs nothing the rest of the time). */
function paint() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
[class*="notice__"]:has(.vc-sonata-update) { background: linear-gradient(90deg, #1e40af, #2563eb 45%, #3b82f6) !important; color: #fff !important; }
[class*="notice__"]:has(.vc-sonata-update) [class*="button__"] { color: #fff !important; border-color: rgb(255 255 255 / 0.75) !important; background: rgb(255 255 255 / 0.08) !important; }
[class*="notice__"]:has(.vc-sonata-update) [class*="button__"]:hover { background: rgb(255 255 255 / 0.2) !important; }
[class*="notice__"]:has(.vc-sonata-update) [class*="closeIcon__"], [class*="notice__"]:has(.vc-sonata-update) [class*="closeButton__"] { color: #fff !important; }
.vc-sonata-update b { font-weight: 700; }`;
    document.head.appendChild(style);
    // Take the colour away once the bar has gone.
    const watch = setInterval(() => {
        if (document.querySelector(".vc-sonata-update")) return;
        clearInterval(watch);
        document.getElementById(STYLE_ID)?.remove();
    }, 3000);
}

async function check(isOn: () => boolean) {
    if (!isOn()) return;
    const latest: { version: string; title: string; } | null = await native().sonataLatest?.().catch(() => null);
    if (!latest || latest.version <= LATEST || shown.has(latest.version)) return;
    shown.add(latest.version);
    paint();
    showNotice(
        <span className="vc-sonata-update">🎵 <b>Sonata {latest.version}</b> is out{latest.title ? ` — ${latest.title}` : ""}</span>,
        "Update",
        async () => {
            const how = await native().sonataRunUpdater?.().catch(() => null);
            showToast(how === "installer" ? "The installer shows what changed and asks before updating" : "Opened Sonata's GitHub page", "message");
        },
    );
}

export function startUpdateNotice(isOn: () => boolean) {
    stopUpdateNotice();
    timers.push(setTimeout(() => void check(isOn), 60_000));
    timers.push(setInterval(() => void check(isOn), EVERY) as any);
}

export function stopUpdateNotice() {
    timers.forEach(t => { clearTimeout(t); clearInterval(t as any); });
    timers = [];
    shown = new Set();
    document.getElementById(STYLE_ID)?.remove();
}

/** "Check now" in the Updates window: true if a newer one was found (and shown). */
export async function checkNow() {
    const latest: { version: string; } | null = await native().sonataLatest?.().catch(() => null);
    if (!latest) return null;
    if (latest.version > LATEST) { shown.delete(latest.version); await check(() => true); return latest.version; }
    return false;
}
