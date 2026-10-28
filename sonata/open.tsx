/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sonata as its own full-screen window over Discord — no channel needed.
// It's opened through Discord's modal system (so Esc closes it and focus
// stays inside), but drawn edge to edge instead of as a small box.

import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { closeModal, openModal, useEffect, useRef, useState } from "@webpack/common";

import type { QolApi } from "../controller/ControlCenter";
import { openAccessPanel } from "./access/Panel";
import { canUseSonata } from "./access/session";
import { SonataScreen } from "./Screen";

let openKey: string | null = null;

/**
 * While Sonata covers the whole window, Discord underneath can't be seen, but
 * Chromium keeps drawing it and holds its picture in graphics memory. This
 * hides the big parts of Discord behind Sonata (only those: anything small,
 * like tooltips and popups, is left alone) and puts them back as Sonata closes.
 */
function hideUnderneath(el: HTMLElement) {
    const hidden: { el: HTMLElement; was: string; }[] = [];
    const screen = innerWidth * innerHeight;
    for (let node: HTMLElement | null = el; node?.parentElement && node !== document.body; node = node.parentElement) {
        for (const sib of Array.from(node.parentElement.children)) {
            if (sib === node || !(sib instanceof HTMLElement) || sib.style.visibility === "hidden") continue;
            const r = sib.getBoundingClientRect();
            if (r.width * r.height < screen * 0.8 || sib.getElementsByTagName("*").length < 300) continue;
            hidden.push({ el: sib, was: sib.style.visibility });
            sib.style.visibility = "hidden";
        }
    }
    return () => hidden.forEach(h => { h.el.style.visibility = h.was; });
}

/**
 * How much room to leave along the top of the window for the minimise,
 * maximise and close buttons, so Sonata never sits under them. Those are
 * drawn either by Discord's page (its own top bar) or by Windows itself on top
 * of the page ("window controls overlay", which the page can only find out
 * about by asking), so it checks every way and takes the biggest. 0 in a
 * browser or full screen.
 */
function titleBarHeight() {
    let h = 0;
    // Windows' own buttons drawn over the page.
    const wco = (navigator as any).windowControlsOverlay;
    if (wco?.visible) {
        const r = wco.getTitlebarAreaRect?.();
        if (r) h = Math.max(h, r.y + r.height);
    }
    // The same thing as CSS sees it.
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:env(titlebar-area-height, 0px)";
    document.body.appendChild(probe);
    h = Math.max(h, probe.getBoundingClientRect().height);
    probe.remove();
    // How tall Discord itself makes its top bar.
    for (const el of [document.documentElement, document.getElementById("app-mount")]) {
        const v = el && parseFloat(getComputedStyle(el).getPropertyValue("--custom-app-top-bar-height"));
        if (v && v > 0) h = Math.max(h, v);
    }
    // Discord's own top bar, and its buttons.
    for (const el of document.querySelectorAll<HTMLElement>('[data-fullscreen] > [class*="bar_"], [class*="winButtons_"], [class*="titleBar_"]')) {
        const r = el.getBoundingClientRect();
        if (r.height && r.top < 4) h = Math.max(h, r.bottom);
    }
    return h > 0 && h < 80 ? Math.ceil(h) : 0;
}

function useTitleBarHeight() {
    const [h, setH] = useState(titleBarHeight);
    useEffect(() => {
        const update = () => setH(titleBarHeight());
        const wco = (navigator as any).windowControlsOverlay;
        addEventListener("resize", update);
        wco?.addEventListener?.("geometrychange", update);
        // Discord's bar can appear a moment after Sonata opens.
        const t = setTimeout(update, 600);
        return () => { removeEventListener("resize", update); wco?.removeEventListener?.("geometrychange", update); clearTimeout(t); };
    }, []);
    return h;
}

const Window = ErrorBoundary.wrap(({ api, onClose, transitionState }: { api: QolApi; onClose(): void; transitionState: number; }) => {
    const ref = useRef<HTMLDivElement>(null);
    const top = useTitleBarHeight();
    // transitionState 0 = opening, 1 = open, 2+ = closing or covered by another window.
    useEffect(() => {
        if (transitionState !== 1 || !ref.current) return;
        // After Sonata's own fade-in, so Discord is never hidden while it still shows through.
        let restore: (() => void) | null = null;
        const t = setTimeout(() => { if (ref.current) restore = hideUnderneath(ref.current); }, 450);
        return () => { clearTimeout(t); restore?.(); };
    }, [transitionState]);
    return (
        <div ref={ref} className={classes("sonata-window", transitionState >= 2 && "sonata-window-closing")} style={{ "--sn-safe-top": `${top}px` } as React.CSSProperties}>
            {/* The strip along the top, under the window buttons: drag it to move the window, like a title bar. */}
            {top > 0 && <div className="sonata-drag" />}
            <SonataScreen api={api} onClose={onClose} />
        </div>
    );
});

export function openSonata(api: QolApi) {
    if (!canUseSonata()) { openAccessPanel(); return; }
    if (openKey) return;
    openKey = openModal(props => <Window api={api} onClose={props.onClose} transitionState={props.transitionState} />, {
        onCloseCallback: () => { openKey = null; },
    });
}

export function closeSonata() {
    if (openKey) closeModal(openKey);
    openKey = null;
}

export const isSonataOpen = () => openKey != null;
