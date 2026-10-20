/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sonata's window: the frame every feature window sits in, so they all look
// and work the same. "sonata — name" along the top, underline tabs under it,
// the window's own content, and a status line along the bottom.
// It takes the same props as Discord's Modal, so a window moves over by
// swapping <Modal> for <Window>, and adds tabs, header tools and the footer.

import "./tool.css";
import "./window.css";

import { useSettings } from "@api/Settings";
import { classes } from "@utils/misc";
import type { ModalAction, RenderModalProps } from "@vencord/discord-types";
import type { CSSProperties, ReactNode } from "react";

import { windowAccent } from "../../controller/accent";

export type WindowSize = "sm" | "md" | "lg" | "xl" | "xxl" | (string & {});

export interface WindowProps extends RenderModalProps {
    size?: WindowSize;
    /** The window's name: shown as "sonata — name". */
    title: ReactNode;
    /** What the window is for. Shown on the status line when the window doesn't give one of its own. */
    subtitle?: ReactNode;
    children?: ReactNode;
    className?: string;
    /** Buttons and search at the right of the top bar. */
    tools?: ReactNode;
    /** Underline tabs under the top bar. */
    tabs?: readonly (readonly [string, ReactNode])[];
    tab?: string;
    onTab?(id: string): void;
    /** What's going on, along the bottom: the first item gets the accent dot. */
    status?: ReactNode[];
    /** Shown at the right of the status line. */
    statusRight?: ReactNode;
    /** No padding round the content, for windows that lay it out edge to edge (list + details, editors). */
    flush?: boolean;
    /** Buttons along the bottom, like Discord's Modal. */
    actions?: ModalAction[];
    actionBarInput?: ReactNode;
    role?: "dialog" | "alertdialog";
}

/* ── Window style: what people can change for every window ── */

export type Darkness = "dark" | "darker" | "black";
export type Borders = "subtle" | "clear";
export interface WindowStyle { roundness: number; darkness: Darkness; borders: Borders; footer: boolean; }

export const ROUNDNESS_MIN = 0.4;
export const ROUNDNESS_MAX = 1.6;
export const DEFAULT_WINDOW_STYLE: WindowStyle = { roundness: 1, darkness: "dark", borders: "subtle", footer: true };

const STYLE_KEYS = ["sonataWinRound", "sonataWinDark", "sonataWinBorders", "sonataWinFooter"] as const;

export function readWindowStyle(store: any): WindowStyle {
    const r = Number(store?.sonataWinRound);
    return {
        roundness: Number.isFinite(r) && r > 0 ? Math.min(ROUNDNESS_MAX, Math.max(ROUNDNESS_MIN, r)) : 1,
        darkness: (["dark", "darker", "black"] as const).includes(store?.sonataWinDark) ? store.sonataWinDark : "dark",
        borders: store?.sonataWinBorders === "clear" ? "clear" : "subtle",
        footer: store?.sonataWinFooter !== false,
    };
}

export function useWindowStyle(): WindowStyle {
    const s = useSettings(STYLE_KEYS.map(k => `plugins.Sonata.${k}`) as any);
    return readWindowStyle((s as any)?.plugins?.Sonata);
}

/** Dark or light text for on top of a colour. */
export function textOn(hex: string) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return "#fff";
    const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join("") : m[1];
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? "#0d0b1a" : "#ffffff";
}

/** The attributes and variables that give an element the window style, for Sonata bits that aren't in a Window. */
export function windowStyleProps(style: WindowStyle, accent = windowAccent()) {
    return {
        "data-sw-dark": style.darkness,
        "data-sw-borders": style.borders,
        style: { "--sw-r": style.roundness, "--vc-tool-accent": accent, "--sw-on": textOn(accent) } as CSSProperties,
    };
}

const nameOf = (title: ReactNode) => typeof title === "string" ? title.toLowerCase() : title;

export function Window({ transitionState, onClose, size = "md", title, subtitle, children, className, tools, tabs, tab, onTab, status, statusRight, flush, actions, actionBarInput, role = "dialog" }: WindowProps) {
    const style = useWindowStyle();
    const accent = windowAccent();
    const closing = transitionState >= 2;
    const line = status?.length ? status : subtitle ? [subtitle] : [];
    const showFooter = style.footer && (line.length > 0 || statusRight != null);
    const showActions = !!actions?.length || actionBarInput != null;

    return (
        <div className={classes("vc-sw-layer", closing && "vc-sw-layer-closing")}>
            <div
                {...windowStyleProps(style, accent)}
                role={role}
                aria-modal
                aria-label={typeof title === "string" ? title : undefined}
                className={classes("vc-sw", `vc-sw-${size}`, className)}
            >
                <header className="vc-sw-top">
                    <div className="vc-sw-name" title={typeof subtitle === "string" ? subtitle : undefined}>
                        sonata <span className="vc-sw-dash">—</span> <span className="vc-sw-here">{nameOf(title)}</span>
                    </div>
                    {tools && <div className="vc-sw-tools">{tools}</div>}
                    <button type="button" className="vc-sw-close" aria-label="Close" onClick={onClose}>
                        <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                </header>
                {tabs && tabs.length > 0 && (
                    <nav className="vc-sw-tabs" role="tablist">
                        {tabs.map(([id, label]) => (
                            <button key={id} type="button" role="tab" aria-selected={tab === id} className={classes("vc-sw-tab", tab === id && "vc-sw-tab-on")} onClick={() => onTab?.(id)}>{label}</button>
                        ))}
                    </nav>
                )}
                <div className={classes("vc-sw-body", flush && "vc-sw-body-flush")}>{children}</div>
                {showActions && (
                    <div className="vc-sw-actions">
                        <div className="vc-sw-actions-left">{actionBarInput}</div>
                        {actions?.map((a, i) => (
                            <button key={i} type="button" disabled={a.disabled || a.loading} onClick={a.onClick}
                                className={classes("vc-tool-btn", a.variant === "primary" && "vc-tool-primary", a.variant?.startsWith("critical") && "vc-tool-danger")}>
                                {a.loading ? "…" : a.text}
                            </button>
                        ))}
                    </div>
                )}
                {showFooter && (
                    <footer className="vc-sw-foot">
                        {line.map((item, i) => (
                            <span key={i} className="vc-sw-foot-item">{i === 0 && <i className="vc-sw-dot" aria-hidden />}{item}</span>
                        ))}
                        {statusRight != null && <span className="vc-sw-foot-right">{statusRight}</span>}
                    </footer>
                )}
            </div>
        </div>
    );
}
