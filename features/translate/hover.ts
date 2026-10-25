/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Hold Alt and point at a message: its translation shows in a small bubble,
// without changing the message. Let go of Alt and it's gone. Each message is
// translated once and remembered while Discord is open.

import { MessageStore } from "@webpack/common";

import { settings } from "./settings";
import { translate, TranslationValue } from "./utils";

const HOLD_MS = 220;
const cache = new Map<string, Promise<TranslationValue | null>>();
let x = -1, y = -1;
let alt = false;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let frame = 0;
let shownFor: string | null = null;
let bubble: HTMLDivElement | null = null;

function messageAt(px: number, py: number) {
    const row = document.elementFromPoint(px, py)?.closest<HTMLElement>('[id^="chat-messages-"]');
    if (!row) return null;
    // chat-messages-<channel id>-<message id>
    const [, , channelId, messageId] = row.id.split("-");
    const msg: any = channelId && messageId ? MessageStore.getMessage(channelId, messageId) : null;
    const text = msg?.content || msg?.messageSnapshots?.[0]?.message?.content || "";
    return text.trim() ? { row, id: messageId, text } : null;
}

function hide() {
    shownFor = null;
    bubble?.remove();
    bubble = null;
}

function place(row: HTMLElement) {
    if (!bubble) return;
    const r = row.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left + 56, window.innerWidth - b.width - 8));
    // Above the message if there's room, otherwise below it.
    const top = r.top - b.height - 6 >= 8 ? r.top - b.height - 6 : Math.min(r.bottom + 6, window.innerHeight - b.height - 8);
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
}

function show(row: HTMLElement, head: string, body: string, wait = false) {
    if (!bubble) {
        bubble = document.createElement("div");
        bubble.className = "vc-trans-hover";
        bubble.setAttribute("role", "tooltip");
        document.body.appendChild(bubble);
    }
    bubble.classList.toggle("vc-trans-hover-wait", wait);
    bubble.replaceChildren();
    const h = document.createElement("span");
    h.className = "vc-trans-hover-head";
    h.textContent = head;
    const p = document.createElement("span");
    p.className = "vc-trans-hover-text";
    p.textContent = body;
    bubble.append(h, p);
    place(row);
}

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

function update() {
    if (!alt) return;
    const hit = messageAt(x, y);
    if (!hit) { hide(); return; }
    if (hit.id === shownFor) { place(hit.row); return; }
    shownFor = hit.id;
    let job = cache.get(hit.id);
    if (!job) {
        job = translate("received", hit.text).catch(() => null);
        cache.set(hit.id, job);
        if (cache.size > 300) cache.delete(cache.keys().next().value!);
    }
    show(hit.row, "🌐 Translating…", hit.text.length > 160 ? `${hit.text.slice(0, 160)}…` : hit.text, true);
    const { id } = hit;
    void job.then(t => {
        if (shownFor !== id || !alt) return;
        if (!t) { show(hit.row, "🌐 Couldn't translate this one", "Check Translate's settings, or try again later."); return; }
        if (same(t.text, hit.text)) show(hit.row, `🌐 Already in ${t.sourceLanguage || "your language"}`, hit.text.length > 160 ? `${hit.text.slice(0, 160)}…` : hit.text);
        else show(hit.row, `🌐 From ${t.sourceLanguage || "another language"}`, t.text);
    });
}

/** Once a frame at most — with a timer too, as frames don't come while the window isn't being drawn. */
function soon() {
    if (frame) return;
    frame = 1;
    const run = () => { if (!frame) return; frame = 0; update(); };
    requestAnimationFrame(run);
    setTimeout(run, 50);
}

function onMove(e: MouseEvent) {
    x = e.clientX; y = e.clientY;
    if (alt) soon();
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Alt") {
        // Alt + another key is a shortcut, not a hover.
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (alt) { alt = false; hide(); }
        return;
    }
    if (e.repeat || alt || holdTimer || settings.store.hoverTranslate === false) return;
    holdTimer = setTimeout(() => { holdTimer = null; alt = true; update(); }, HOLD_MS);
}

function onKeyUp(e: KeyboardEvent) {
    if (e.key !== "Alt") return;
    // Stops Alt from moving focus to the window's menu.
    if (alt) e.preventDefault();
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    alt = false;
    hide();
}

function reset() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    alt = false;
    hide();
}

export function startHover() {
    window.addEventListener("mousemove", onMove, { passive: true, capture: true });
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", reset);
    window.addEventListener("wheel", soon, { passive: true, capture: true });
}

export function stopHover() {
    window.removeEventListener("mousemove", onMove, { capture: true });
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", reset);
    window.removeEventListener("wheel", soon, { capture: true });
    reset();
    cache.clear();
}
