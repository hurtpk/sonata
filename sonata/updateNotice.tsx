/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "Sonata 2026.10.20 is out" — a blue bar along the top of Discord, like
// Discord's own notices, when GitHub has a newer Sonata than this one. It
// looks a minute after Discord starts and then every 15 minutes, shows each
// new version once, and its Update button updates Sonata right inside Discord
// (UpdateNow.tsx) — or opens the installer if it can't. With "Install it by
// itself" on (the default), it updates in the background first and the bar only
// asks to restart. Switch either off in Updates.

import { showNotice } from "@api/Notices";
import { relaunch } from "@utils/native";
import { showToast } from "@webpack/common";

import { LATEST } from "./changelog";
import { openUpdateNow } from "./UpdateNow";

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
    // Dark navy with light blue text and an outlined button — like Discord's dark notices.
    style.textContent = `
[class*="notice__"]:has(.vc-sonata-update) { background: #0a1630 !important; color: #8db4ff !important; border-bottom: 1px solid #16284f !important; }
[class*="notice__"]:has(.vc-sonata-update) [class*="button__"] { color: #8db4ff !important; border: 1px solid #5f8ff0 !important; background: transparent !important; border-radius: 4px !important; }
[class*="notice__"]:has(.vc-sonata-update) [class*="button__"]:hover { color: #fff !important; background: rgb(95 143 240 / 0.18) !important; }
[class*="notice__"]:has(.vc-sonata-update) [class*="closeIcon__"], [class*="notice__"]:has(.vc-sonata-update) [class*="closeButton__"] { color: #8db4ff !important; }
.vc-sonata-update { font-weight: 500; }`;
    document.head.appendChild(style);
    // Take the colour away once the bar has gone.
    const watch = setInterval(() => {
        if (document.querySelector(".vc-sonata-update")) return;
        clearInterval(watch);
        document.getElementById(STYLE_ID)?.remove();
    }, 3000);
}

/**
 * Updates in the background (the same steps as the Update button), then a bar asks to restart.
 * False if it couldn't — then the normal "update ready" bar shows, and its Update button explains why.
 */
async function updateQuietly(version: string): Promise<boolean> {
    if (!native().sonataUpdateStart) return false;
    const r = await native().sonataUpdateStart().catch(() => null);
    if (!r?.ok) return false;
    for (let i = 0; i < 400; i++) {
        await new Promise(res => setTimeout(res, 3000));
        const j = await native().sonataUpdateStatus().catch(() => null);
        if (!j || j.step === "error") return false;
        if (j.step === "done") break;
        if (i === 399) return false;
    }
    paint();
    showNotice(
        <span className="vc-sonata-update" title={`Sonata ${version}`}>Sonata {version} is installed. Restart Discord to start using it.</span>,
        "Restart",
        () => relaunch(),
    );
    return true;
}

async function check(isOn: () => boolean, isAuto: () => boolean = () => false) {
    if (!isOn()) return;
    const latest: { version: string; title: string; } | null = await native().sonataLatest?.().catch(() => null);
    if (!latest || latest.version <= LATEST || shown.has(latest.version)) return;
    shown.add(latest.version);
    if (isAuto() && await updateQuietly(latest.version)) return;
    paint();
    showNotice(
        <span className="vc-sonata-update" title={`Sonata ${latest.version}`}>Sonata update ready.</span>,
        "Update",
        // Updates right here — no installer window. (Older Discord sessions without the new helper fall back to the installer.)
        async () => {
            if (native().sonataUpdateStart) { openUpdateNow(latest.version); return; }
            const how = await native().sonataRunUpdater?.().catch(() => null);
            showToast(how === "installer" ? "The installer shows what changed and asks before updating" : "Opened Sonata's GitHub page", "message");
        },
    );
}

export function startUpdateNotice(isOn: () => boolean, isAuto: () => boolean = () => false) {
    stopUpdateNotice();
    timers.push(setTimeout(() => void check(isOn, isAuto), 60_000));
    timers.push(setInterval(() => void check(isOn, isAuto), EVERY) as any);
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
