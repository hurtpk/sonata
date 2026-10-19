/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Profiles: save which features are on as a named set — School, Gaming,
// Streaming — and switch between them in one click. A profile remembers what
// was on and what was off; features added to Sonata after you saved it are
// left as they are. The switch you just made can be undone.

import { classes } from "@utils/misc";
import { useEffect, useRef, useState } from "@webpack/common";

import type { QolApi } from "../controller/ControlCenter";

export interface Profile { id: string; name: string; icon: string; on: string[]; off: string[]; at: number; }

const ICONS = ["🏫", "🎮", "📺", "🌙", "💼", "🎧", "🧪", "⭐"];
const SUGGESTED: [string, string][] = [["🏫", "School"], ["🎮", "Gaming"], ["📺", "Streaming"], ["🌙", "Night"]];

export function loadProfiles(raw: string | undefined): Profile[] {
    try {
        const v = JSON.parse(raw || "[]");
        return Array.isArray(v) ? v.filter(p => p && typeof p.name === "string" && Array.isArray(p.on)) : [];
    } catch { return []; }
}

function snapshot(api: QolApi) {
    return { on: api.keys.filter(k => api.isOn(k)), off: api.keys.filter(k => !api.isOn(k)) };
}

/** What switching to this profile would change. */
function changesFor(api: QolApi, p: Profile) {
    const known = new Set(api.keys);
    return {
        turnOn: p.on.filter(k => known.has(k) && !api.isOn(k)),
        turnOff: (p.off ?? []).filter(k => known.has(k) && api.isOn(k)),
    };
}

export function ProfilesButton({ api, raw, write }: { api: QolApi; raw: string | undefined; write(json: string): void; }) {
    const [open, setOpen] = useState(false);
    const [naming, setNaming] = useState<{ name: string; icon: string; } | null>(null);
    const [undo, setUndo] = useState<{ name: string; on: string[]; off: string[]; } | null>(null);
    const [, rerender] = useState(0);
    const box = useRef<HTMLDivElement>(null);
    const profiles = loadProfiles(raw);
    const save = (list: Profile[]) => write(JSON.stringify(list));

    useEffect(() => {
        if (!open) return;
        const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
        document.addEventListener("mousedown", away);
        document.addEventListener("keydown", esc, true);
        return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc, true); };
    }, [open]);

    const active = profiles.find(p => { const c = changesFor(api, p); return !c.turnOn.length && !c.turnOff.length; });

    const switchTo = (p: Profile) => {
        const { turnOn, turnOff } = changesFor(api, p);
        if (!turnOn.length && !turnOff.length) return;
        // Remember just the features this switch touches, so Undo puts exactly those back.
        setUndo({ name: p.name, on: turnOff, off: turnOn });
        if (turnOn.length) api.setManyOn(turnOn, true);
        if (turnOff.length) api.setManyOn(turnOff, false);
        rerender(n => n + 1);
    };

    const undoSwitch = () => {
        if (!undo) return;
        if (undo.on.length) api.setManyOn(undo.on, true);
        if (undo.off.length) api.setManyOn(undo.off, false);
        setUndo(null);
        rerender(n => n + 1);
    };

    const create = () => {
        if (!naming?.name.trim()) return;
        const name = naming.name.trim().slice(0, 32);
        const existing = profiles.find(p => p.name.toLowerCase() === name.toLowerCase());
        const p: Profile = { id: existing?.id ?? Date.now().toString(36), name, icon: naming.icon, ...snapshot(api), at: Date.now() };
        save(existing ? profiles.map(x => x.id === existing.id ? p : x) : [...profiles, p].slice(0, 20));
        setNaming(null);
    };

    return (
        <div className="sonata-profiles" ref={box}>
            <button type="button" className={classes("sonata-updates", open && "sonata-profiles-open")} title="Save sets of features and switch between them" onClick={() => setOpen(o => !o)} aria-expanded={open}>
                <span aria-hidden>{active?.icon ?? "🗂️"}</span>
                {active ? active.name : "Profiles"}
            </button>
            {open && (
                <div className="sonata-profiles-pop" role="dialog" aria-label="Profiles">
                    <div className="sonata-profiles-head">
                        <b>Profiles</b>
                        <span>Save which features are on, then switch in one click.</span>
                    </div>

                    {undo && (
                        <div className="sonata-profiles-undo">
                            Switched to {undo.name}.
                            <button type="button" className="sonata-link" onClick={undoSwitch}>↩ Undo</button>
                        </div>
                    )}

                    {profiles.length > 0 && (
                        <ul className="sonata-profiles-list">
                            {profiles.map(p => {
                                const c = changesFor(api, p), isActive = p === active;
                                const n = c.turnOn.length + c.turnOff.length;
                                return (
                                    <li key={p.id} className={classes("sonata-profiles-row", isActive && "sonata-profiles-row-on")}>
                                        <button type="button" className="sonata-profiles-use" disabled={isActive} onClick={() => switchTo(p)}
                                            title={isActive ? "This is what's on now" : `Turns on ${c.turnOn.length}, turns off ${c.turnOff.length}`}>
                                            <span className="sonata-profiles-icon">{p.icon}</span>
                                            <span className="sonata-profiles-name">
                                                <b>{p.name}</b>
                                                <small>{isActive ? "Active now" : `${p.on.length} on · ${n} change${n === 1 ? "" : "s"}`}</small>
                                            </span>
                                        </button>
                                        <button type="button" className="sonata-profiles-mini" title="Save what's on now into this profile"
                                            onClick={() => save(profiles.map(x => x.id === p.id ? { ...x, ...snapshot(api), at: Date.now() } : x))}>⟳</button>
                                        <button type="button" className="sonata-profiles-mini" title="Delete this profile"
                                            onClick={() => save(profiles.filter(x => x.id !== p.id))}>✕</button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {naming ? (
                        <div className="sonata-profiles-new">
                            <div className="sonata-profiles-icons">
                                {ICONS.map(i => (
                                    <button key={i} type="button" className={classes("sonata-profiles-icon-pick", naming.icon === i && "sonata-profiles-icon-on")} onClick={() => setNaming({ ...naming, icon: i })}>{i}</button>
                                ))}
                            </div>
                            <input autoFocus className="sonata-profiles-input" maxLength={32} placeholder="Name, like Gaming" value={naming.name}
                                onChange={e => setNaming({ ...naming, name: e.currentTarget.value })}
                                onKeyDown={e => { if (e.key === "Enter") create(); if (e.key === "Escape") { e.stopPropagation(); setNaming(null); } }} />
                            <div className="sonata-profiles-actions">
                                <button type="button" className="sonata-btn sonata-btn-light" disabled={!naming.name.trim()} onClick={create}>Save what's on now</button>
                                <button type="button" className="sonata-link" onClick={() => setNaming(null)}>Cancel</button>
                            </div>
                        </div>
                    ) : (
                        <div className="sonata-profiles-new">
                            {!profiles.length && (
                                <div className="sonata-profiles-suggest">
                                    {SUGGESTED.map(([icon, name]) => (
                                        <button key={name} type="button" className="sonata-chip" onClick={() => setNaming({ name, icon })}>{icon} {name}</button>
                                    ))}
                                </div>
                            )}
                            <button type="button" className="sonata-btn sonata-btn-light" onClick={() => setNaming({ name: "", icon: ICONS[0] })}>＋ Save what's on now</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
