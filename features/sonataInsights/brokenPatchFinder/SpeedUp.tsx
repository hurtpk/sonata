/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "Speed up Discord": the features you have on, heaviest first (how many
// changes they make to Discord's code, and how long they take to start), with
// the heavy ones you haven't used lately ticked — switch them all off in one
// click, and turn them back on just as easily.

import { DataStore } from "@api/index";
import { classes } from "@utils/misc";
import { showToast, useEffect, useMemo, useState } from "@webpack/common";

import { doctor, DoctorFeature } from "../../../sonata/doctorBridge";
import { lastUsed, loadUsage, trackingSince } from "../../../sonata/usage";

const UNDO_KEY = "Sonata_speedUpUndo";
const DAY = 86400_000;
/** Insights itself, and the things that keep Sonata working, never get suggested. */
const NEVER = new Set(["brokenPatchFinder", "crashHandler", "shareSetup"]);

const cost = (f: DoctorFeature) => (f.startMs ?? 0) + f.patches * 4;
const ago = (t: number) => { const d = Math.floor((Date.now() - t) / DAY); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };

export function SpeedUp({ cls, onChange }: { cls(name: string): string; onChange(): void; }) {
    const d = doctor();
    const [ready, setReady] = useState(false);
    const [picked, setPicked] = useState<Set<string> | null>(null);
    const [undo, setUndo] = useState<string[]>([]);
    const [reloadNeeded, setReloadNeeded] = useState(false);
    useEffect(() => {
        void loadUsage().then(() => setReady(true));
        void DataStore.get<string[]>(UNDO_KEY).then(v => setUndo(v ?? [])).catch(() => { });
    }, []);

    const days = Math.floor((Date.now() - trackingSince()) / DAY);
    const watchedLongEnough = days >= 7;
    const list = useMemo(() => (d?.features() ?? []).filter(f => f.on && !NEVER.has(f.key) && cost(f) > 0).sort((a, b) => cost(b) - cost(a)), [ready, d]);
    const heavyFrom = list.length ? cost(list[Math.min(list.length - 1, Math.floor(list.length * 0.4))]) : 0;
    // A window you can open means Sonata can tell whether you use it; background features it can't.
    const hasWindow = (f: DoctorFeature) => !!(d as any)?.hasWindow?.(f.key);
    const unused = (f: DoctorFeature) => { const t = lastUsed(f.key); return t == null || Date.now() - t > 14 * DAY; };
    const suggested = (f: DoctorFeature) => watchedLongEnough && cost(f) >= heavyFrom && hasWindow(f) && unused(f);

    useEffect(() => { if (ready && picked == null) setPicked(new Set(list.filter(suggested).map(f => f.key))); }, [ready, list.length]);
    if (!d || !ready || !picked) return null;

    const top = cost(list[0] ?? { patches: 0 } as any) || 1;
    const toggle = (k: string) => setPicked(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    const turnOff = async () => {
        const keys = [...picked];
        if (!keys.length) return;
        const withPatches = list.filter(f => picked.has(f.key) && f.patches > 0).length;
        for (const k of keys) d.setOn(k, false);
        await DataStore.set(UNDO_KEY, keys);
        setUndo(keys); setPicked(new Set()); setReloadNeeded(withPatches > 0);
        showToast(`Switched off ${keys.length} feature${keys.length === 1 ? "" : "s"}${withPatches ? " — reload to finish" : ""}`, "success");
        onChange();
    };
    const turnBackOn = async () => {
        for (const k of undo) d.setOn(k, true);
        await DataStore.set(UNDO_KEY, []);
        showToast(`Turned ${undo.length} feature${undo.length === 1 ? "" : "s"} back on`, "success");
        setUndo([]); setReloadNeeded(true);
        onChange();
    };
    const pickedCost = list.filter(f => picked.has(f.key));

    return (
        <div className={cls("speed")}>
            <div className={cls("row")}>
                <span className={cls("item-name")}>⚡ Speed up Discord</span>
                <span className={cls("muted")}>{list.length} features on, heaviest first</span>
                <span className={cls("spacer")} />
                {undo.length > 0 && <button type="button" className={cls("btn")} title={undo.join(", ")} onClick={turnBackOn}>↺ Turn the {undo.length} back on</button>}
                {reloadNeeded && <button type="button" className={classes(cls("btn"), cls("primary"))} onClick={() => d.reload()}>Reload to finish</button>}
                <button type="button" className={classes(cls("btn"), picked.size > 0 && cls("primary"))} disabled={!picked.size} onClick={turnOff}>
                    Switch off {picked.size || ""} {picked.size === 1 ? "feature" : "features"}
                </button>
            </div>
            <div className={cls("muted")}>
                {watchedLongEnough
                    ? `Ticked: the heaviest features you haven't opened in two weeks. Sonata has been noting what you use for ${days} days.`
                    : `Sonata started noting which features you use ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`} — after a week it'll tick the heavy ones you don't use. Until then, tick any you know you don't need.`}
                {pickedCost.length > 0 && ` Switching off the ${pickedCost.length} ticked removes ${pickedCost.reduce((n, f) => n + f.patches, 0)} changes to Discord's code.`}
            </div>
            <div className={cls("speed-list")}>
                {list.slice(0, 30).map(f => {
                    const t = lastUsed(f.key);
                    const w = hasWindow(f);
                    return (
                        <label key={f.key} className={classes(cls("speed-row"), picked.has(f.key) && cls("speed-row-on"))}>
                            <input type="checkbox" checked={picked.has(f.key)} onChange={() => toggle(f.key)} />
                            <span className={cls("bar-name")}>{f.name}{suggested(f) && <i className={cls("speed-tag")}>suggested</i>}</span>
                            <span className={cls("bar")}><span style={{ width: `${Math.max(3, cost(f) / top * 100)}%` }} /></span>
                            <span className={cls("speed-facts")}>
                                {f.patches} change{f.patches === 1 ? "" : "s"} · {f.startMs != null ? `${f.startMs < 1 ? "<1" : Math.round(f.startMs)} ms` : "—"}
                                <small>{w ? (t ? `used ${ago(t)}` : "not used yet") : "works in the background"}</small>
                            </span>
                        </label>
                    );
                })}
            </div>
        </div>
    );
}
