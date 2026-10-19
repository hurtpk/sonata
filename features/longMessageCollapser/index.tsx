/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import definePlugin, { OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";

export const settings = defineFeatureSettings("longMessageCollapser", {
    maxLines: {
        type: OptionType.SLIDER,
        description: "Fold messages taller than this many lines",
        markers: [5, 8, 10, 15, 20, 30],
        default: 10,
        stickToMarkers: true,
        onChange: () => { setLines(); refreshAll(); },
    },
});

// Works on the page itself rather than patching Discord's code, so it switches
// on and off instantly. It only sets data- attributes (which React leaves
// alone); the fade and the "Show more" pill are pure CSS (styles.css).

const CONTENT = '[id^="message-content-"]';
/** Messages you opened, so they stay open when Discord redraws them. */
const opened = new Set<string>();

let observer: MutationObserver | null = null;
let pending = new Set<Element>();
let frame = 0;

const lineHeightOf = (el: Element) => parseFloat(getComputedStyle(el).lineHeight) || 22;
const maxHeight = (el: Element) => settings.store.maxLines * lineHeightOf(el);

function setState(el: HTMLElement, state: "closed" | "open" | null, lines = 0) {
    const host = el.parentElement;
    if (state == null) {
        delete el.dataset.vcLmc;
        if (host) { delete host.dataset.vcLmcHost; delete host.dataset.vcLmcLabel; }
        return;
    }
    el.dataset.vcLmc = state;
    if (host) {
        host.dataset.vcLmcHost = "";
        host.dataset.vcLmcLabel = state === "closed" ? `Show more · ${lines} lines` : "Show less";
    }
}

function check(el: HTMLElement) {
    if (!el.isConnected) return;
    // scrollHeight is the full height even while folded (it's clipped, not shrunk).
    const full = el.scrollHeight;
    const lines = Math.round(full / lineHeightOf(el));
    // A little slack, so a message just over the limit isn't folded to hide one line.
    if (full <= maxHeight(el) + lineHeightOf(el) * 2) return setState(el, null);
    setState(el, opened.has(el.id) ? "open" : "closed", lines);
}

function flush() {
    frame = 0;
    const batch = pending;
    pending = new Set();
    batch.forEach(el => check(el as HTMLElement));
}

function queue(el: Element | null) {
    if (!el) return;
    pending.add(el);
    frame ||= requestAnimationFrame(flush);
}

function onMutations(records: MutationRecord[]) {
    for (const r of records) {
        const target = r.target instanceof Element ? r.target : r.target.parentElement;
        queue(target?.closest(CONTENT) ?? null);
        r.addedNodes.forEach(n => {
            if (!(n instanceof Element)) return;
            if (n.matches(CONTENT)) queue(n);
            n.querySelectorAll(CONTENT).forEach(queue);
        });
    }
}

const setLines = () => document.documentElement.style.setProperty("--vc-lmc-lines", String(settings.store.maxLines));

function refreshAll() {
    if (!observer) return;
    document.querySelectorAll(CONTENT).forEach(queue);
}

// Clicks on a pseudo-element land on the element itself, so a click on the host
// (not on its text) below the message text is a click on the pill.
function onClick(e: MouseEvent) {
    const host = e.target as HTMLElement;
    if (!host?.dataset || !("vcLmcHost" in host.dataset)) return;
    const content = host.querySelector<HTMLElement>(`:scope > ${CONTENT}`);
    if (!content || e.clientY < content.getBoundingClientRect().bottom) return;
    e.preventDefault();
    e.stopPropagation();
    const open = content.dataset.vcLmc === "closed";
    if (open) opened.add(content.id); else opened.delete(content.id);
    setState(content, open ? "open" : "closed", Math.round(content.scrollHeight / lineHeightOf(content)));
    // Folding back up: keep the message in view instead of leaving you far below it.
    if (!open && content.getBoundingClientRect().top < 0) content.scrollIntoView({ block: "start" });
}

export default definePlugin({
    name: "LongMessageCollapser",
    description: "Folds huge pastes, code blocks and walls of text down to a few lines, with a \"Show more\" button to read the rest.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    start() {
        observer = new MutationObserver(onMutations);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        document.addEventListener("click", onClick, true);
        setLines();
        refreshAll();
    },

    stop() {
        observer?.disconnect();
        observer = null;
        cancelAnimationFrame(frame);
        frame = 0;
        pending.clear();
        document.removeEventListener("click", onClick, true);
        document.documentElement.style.removeProperty("--vc-lmc-lines");
        document.querySelectorAll<HTMLElement>("[data-vc-lmc]").forEach(el => setState(el, null));
    },
});
