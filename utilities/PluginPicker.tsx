/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Picking what a dock button opens: Sonata's features (each with its icon)
// and your own plugins, in a list you can search.

import { Settings } from "@api/Settings";
import { classes } from "@utils/misc";
import { useEffect, useMemo, useRef, useState } from "@webpack/common";

import { featureIconKey } from "../sonata/featureIcons";
import { DOCK_ICON_MAP } from "./icons";
import { cl, DockCandidate } from "./shared";

/** The icon a choice shows: a feature's own (or the one you picked for it), or a puzzle piece for plugins. */
export function candidateIcon(c: DockCandidate) {
    return c.kind === "feature" && c.featureKey ? featureIconKey(Settings.plugins.Sonata, c.featureKey) : "puzzle";
}

function Row({ c, on, active, onPick, onHover }: { c: DockCandidate; on: boolean; active: boolean; onPick(): void; onHover(): void; }) {
    const { Icon } = DOCK_ICON_MAP[candidateIcon(c)] ?? DOCK_ICON_MAP.puzzle;
    return (
        <button type="button" role="option" aria-selected={on} data-active={active || undefined}
            className={classes(cl("dock-pp-row"), on && cl("dock-pp-row-on"), active && cl("dock-pp-row-active"))}
            onMouseEnter={onHover} onClick={onPick}>
            <span className={cl("dock-pp-icon")}><Icon width={18} height={18} /></span>
            <span className={cl("dock-pp-name")}>{c.label}</span>
            <small>{c.opens === "window" ? "window" : c.opens === "options" ? "options" : c.opens === "page" ? "Sonata page" : "settings"}</small>
        </button>
    );
}

export function PluginPicker({ options, value, onPick, placeholder }: { options: DockCandidate[]; value: string | null; onPick(c: DockCandidate): void; placeholder: string; }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const box = useRef<HTMLDivElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const picked = options.find(o => o.value === value);

    const q = query.trim().toLowerCase();
    const shown = useMemo(() => options.filter(o => !q || o.label.toLowerCase().includes(q)), [options, q]);
    const features = shown.filter(o => o.kind === "feature"), plugins = shown.filter(o => o.kind === "plugin");
    const ordered = [...features, ...plugins];

    // Click anywhere else to close it.
    useEffect(() => {
        if (!open) return;
        const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", away);
        return () => document.removeEventListener("mousedown", away);
    }, [open]);
    useEffect(() => { setActive(0); }, [q, open]);
    useEffect(() => { list.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" }); }, [active]);

    const pick = (c: DockCandidate) => { onPick(c); setOpen(false); setQuery(""); };
    const onKey = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(ordered.length - 1, a + 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
        else if (e.key === "Enter" && ordered[active]) { e.preventDefault(); pick(ordered[active]); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    };
    const PickedIcon = picked ? (DOCK_ICON_MAP[candidateIcon(picked)] ?? DOCK_ICON_MAP.puzzle).Icon : null;
    const section = (title: string, items: DockCandidate[], offset: number) => items.length > 0 && (
        <>
            <div className={cl("dock-pp-head")}>{title}<small>{items.length}</small></div>
            {items.map((c, i) => <Row key={c.value} c={c} on={c.value === value} active={offset + i === active} onPick={() => pick(c)} onHover={() => setActive(offset + i)} />)}
        </>
    );

    return (
        <div ref={box} className={classes(cl("dock-pp"), open && cl("dock-pp-open"))}>
            {open ? (
                <input className={cl("dock-pp-field")} autoFocus value={query} placeholder={`Search ${options.length} features and plugins`} aria-label="Search features and plugins"
                    onChange={e => setQuery(e.currentTarget.value)} onKeyDown={onKey} />
            ) : (
                <button type="button" className={cl("dock-pp-field")} disabled={!options.length} aria-haspopup="listbox" onClick={() => setOpen(true)}>
                    {picked && PickedIcon ? <><span className={cl("dock-pp-icon")}><PickedIcon width={18} height={18} /></span><span className={cl("dock-pp-name")}>{picked.label}</span></> : <span className={cl("dock-pp-placeholder")}>{placeholder}</span>}
                    <svg className={cl("dock-pp-chev")} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
                </button>
            )}
            {open && (
                <div ref={list} className={cl("dock-pp-list")} role="listbox">
                    {section("Sonata features", features, 0)}
                    {section("Your plugins", plugins, features.length)}
                    {!ordered.length && <div className={cl("dock-pp-empty")}>Nothing matches “{query.trim()}”.</div>}
                </div>
            )}
        </div>
    );
}
