/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Find the culprit: when something's wrong (Discord crashes, something looks
// broken) and you don't know which feature does it, this switches half of the
// suspects off, reloads, and asks whether it still happens. Each answer halves
// the suspects, so even 100 features take about 7 rounds. At the end the
// culprit is left off and everything else goes back exactly as it was.
//
// The question after each reload is plain page content, not a Discord
// window, so it still shows even when part of Discord is broken.

import { doctor } from "../../../sonata/doctorBridge";

interface State {
    /** Features that were on before it started (put back at the end). */
    original: string[];
    suspects: string[];
    /** The half switched off this round. */
    off: string[];
    round: number;
    /** Roughly how many rounds it will take, from the start. */
    total: number;
}

const SELF = "brokenPatchFinder";
let read: () => string = () => "";
let write: (v: string) => void = () => { };

/** Insights' settings hold the state, so it survives the reloads. */
export function bindCulpritStore(get: () => string, set: (v: string) => void) { read = get; write = set; }

const load = (): State | null => { try { const s = JSON.parse(read() || "null"); return s?.suspects ? s : null; } catch { return null; } };
const save = (s: State | null) => write(s ? JSON.stringify(s) : "");

export const culpritActive = () => !!load();

const nameOf = (key: string) => doctor()?.features().find(f => f.key === key)?.name ?? key;

/** Turns exactly these features on (and every other suspect-able one off), then reloads. */
function applyAndReload(on: Set<string>, all: string[]) {
    const store = doctor()?.store;
    if (!store) return;
    for (const key of all) store[`on_${key}`] = on.has(key);
    // Settings are written to disk straight away; a moment's pause makes sure it lands before the reload.
    setTimeout(() => doctor()?.reload(), 700);
}

export function startCulpritHunt(): string | null {
    const d = doctor();
    if (!d) return "Sonata isn't ready yet";
    const original = d.features().filter(f => f.on).map(f => f.key);
    const suspects = original.filter(k => k !== SELF);
    if (suspects.length < 2) return "There's nothing to narrow down — fewer than two features are on.";
    const off = suspects.slice(0, Math.ceil(suspects.length / 2));
    save({ original, suspects, off, round: 1, total: Math.ceil(Math.log2(suspects.length)) });
    applyAndReload(new Set(original.filter(k => !off.includes(k))), original);
    return null;
}

/** Your answer after a reload: is the problem still happening? */
function answer(stillBroken: boolean) {
    const s = load();
    if (!s) return;
    // Still broken with this half off → the culprit isn't in it. Fixed → it is.
    const suspects = stillBroken ? s.suspects.filter(k => !s.off.includes(k)) : s.off;
    if (!suspects.length) return finish(null, s);
    // "It's fine now" with one switched off proves it. One left over from "still happening" hasn't been
    // tried on its own yet, so it gets one last round — if it's still happening then, it isn't Sonata.
    if (suspects.length === 1 && !stillBroken) return finish(suspects[0], s);
    const off = suspects.slice(0, Math.ceil(suspects.length / 2));
    save({ ...s, suspects, off, round: s.round + 1 });
    applyAndReload(new Set(s.original.filter(k => !off.includes(k))), s.original);
}

function finish(culprit: string | null, s: State) {
    save(null);
    // Everything back as it was — except the culprit, which stays off.
    const on = new Set(s.original.filter(k => k !== culprit));
    try { localStorage.setItem("vc-doc-culprit-result", JSON.stringify({ culprit, at: Date.now() })); } catch { }
    applyAndReload(on, s.original);
}

export function stopCulpritHunt() {
    const s = load();
    save(null);
    if (s) applyAndReload(new Set(s.original), s.original);
}

/* ── The banner shown after each reload ───────────────────────────────── */

let banner: HTMLDivElement | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string; }, ...kids: (Node | string)[]) {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
}

function button(label: string, primary: boolean, onClick: () => void) {
    return el("button", { type: "button", className: `vc-doc-cb-btn${primary ? " vc-doc-cb-primary" : ""}`, onclick: onClick }, label);
}

function render(content: Node[]) {
    banner?.remove();
    banner = el("div", { className: "vc-doc-cb" }, ...content);
    document.body.appendChild(banner);
}

export function showCulpritBanner() {
    const s = load();
    let result: { culprit: string | null; at: number; } | null = null;
    try { result = JSON.parse(localStorage.getItem("vc-doc-culprit-result") ?? "null"); } catch { }

    if (!s && result && Date.now() - result.at < 5 * 60_000) {
        localStorage.removeItem("vc-doc-culprit-result");
        const name = result.culprit ? nameOf(result.culprit) : null;
        render([
            el("b", { className: "vc-doc-cb-title" }, name ? `🎯 Found it: ${name}` : "🤷 It wasn't a Sonata feature"),
            el("span", { className: "vc-doc-cb-text" }, name
                ? `${name} has been left off, and everything else is back the way it was. Turn it back on from Sonata if you still want it — and tell whoever made it what went wrong.`
                : "The problem happened with every suspect switched off, so it's coming from somewhere else (Discord itself, another plugin, or a theme). Everything is back the way it was."),
            el("div", { className: "vc-doc-cb-row" },
                ...(result.culprit ? [button("Turn it back on", false, () => { const store = doctor()?.store; if (store) store[`on_${result!.culprit}`] = true; setTimeout(() => doctor()?.reload(), 700); })] : []),
                button("OK", true, () => banner?.remove())),
        ]);
        return;
    }
    if (!s) return;

    const left = s.suspects.length;
    render([
        el("b", { className: "vc-doc-cb-title" }, `🔎 Finding the culprit — round ${s.round} of about ${s.total}`),
        el("span", { className: "vc-doc-cb-text" }, `${s.off.length} of ${left} suspects are switched off right now. Use Discord for a bit the way that caused the problem — then:`),
        el("div", { className: "vc-doc-cb-row" },
            button("😣 Still happening", false, () => answer(true)),
            button("🙂 It's fine now", true, () => answer(false)),
        ),
        el("button", { type: "button", className: "vc-doc-cb-stop", onclick: () => stopCulpritHunt() }, "Stop and put everything back"),
    ]);
}

export function hideCulpritBanner() {
    banner?.remove();
    banner = null;
}
