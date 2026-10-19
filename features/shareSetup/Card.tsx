/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The card under a shared setup (or a pasted code): what's in it, a tick for
// each part, Apply, and Undo afterwards.

import { showNotice } from "@api/Notices";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { showToast, useEffect, useState } from "@webpack/common";

import { apply, CODE_RE, decode, describe, Part, Setup, Snapshot, undo } from "./setup";

const ss = classNameFactory("vc-sset-");

const PART_INFO: Record<Part, { emoji: string; name: string; }> = {
    look: { emoji: "🎨", name: "Design & accent" },
    dock: { emoji: "🧩", name: "Dock" },
    features: { emoji: "⚙️", name: "Features" },
};

const askReload = () => showNotice("Some features you just switched need a quick reload (Ctrl+R) to apply.", "Reload", () => location.reload());

export function SetupCard({ setup, compact }: { setup: Setup; compact?: boolean; }) {
    const d = describe(setup);
    const available = (["look", "dock", "features"] as Part[]).filter(p => p === "look" ? setup.look : p === "dock" ? setup.dock : setup.off);
    const [chosen, setChosen] = useState<Part[]>(available);
    const [before, setBefore] = useState<Snapshot | null>(null);
    const detail: Record<Part, string | undefined> = { look: [d.look, d.accent].filter(Boolean).join(" · "), dock: d.dock, features: d.features };

    const doApply = () => {
        const r = apply(setup, chosen);
        setBefore(r.before);
        showToast("Setup applied ✓", "success");
        if (r.reload) askReload();
    };
    const doUndo = () => {
        if (!before) return;
        const needsReload = undo(before);
        setBefore(null);
        showToast("Put back how it was", "message");
        if (needsReload) askReload();
    };

    return (
        <div className={classes(ss("card"), compact && ss("card-compact"))}>
            <div className={ss("head")}>
                <span className={ss("swatch")} style={{ background: d.colors?.length ? `linear-gradient(135deg, ${d.colors[0]}, ${d.colors[1] ?? d.colors[0]})` : undefined }}>♫</span>
                <div className={ss("titles")}>
                    <span className={ss("title")}>{setup.from ? `${setup.from}'s Sonata setup` : "A Sonata setup"}</span>
                    <span className={ss("sub")}>Pick what to use — you can undo it straight after.</span>
                </div>
            </div>
            <div className={ss("parts")}>
                {available.map(p => (
                    <label key={p} className={classes(ss("part"), chosen.includes(p) && ss("part-on"))}>
                        <input type="checkbox" checked={chosen.includes(p)} disabled={!!before} onChange={e => { const on = e.currentTarget.checked; setChosen(c => on ? [...c, p] : c.filter(x => x !== p)); }} />
                        <span className={ss("part-emoji")}>{PART_INFO[p].emoji}</span>
                        <span className={ss("part-text")}>
                            <span className={ss("part-name")}>{PART_INFO[p].name}</span>
                            <span className={ss("sub")}>{detail[p]}</span>
                        </span>
                    </label>
                ))}
            </div>
            <div className={ss("actions")}>
                {before
                    ? <><span className={ss("done")}>Applied ✓</span><button type="button" className={ss("btn")} onClick={doUndo}>Undo</button></>
                    : <button type="button" className={classes(ss("btn"), ss("primary"))} disabled={!chosen.length} onClick={doApply}>Apply {chosen.length === available.length ? "everything" : "selected"}</button>}
            </div>
        </div>
    );
}

/** Under a message carrying a setup code. */
export function SetupAccessory({ message }: { message: any; }) {
    const code = message?.content?.match(CODE_RE)?.[1];
    const [setup, setSetup] = useState<Setup | null | undefined>(undefined);
    useEffect(() => {
        let alive = true;
        if (code) void decode(code).then(s => { if (alive) setSetup(s); });
        return () => { alive = false; };
    }, [code]);
    if (!code) return null;
    if (setup === undefined) return null;
    if (setup === null) return <div className={classes(ss("card"), ss("bad"))}>🎁 This setup couldn't be read — it may be from a newer Sonata.</div>;
    return <SetupCard setup={setup} />;
}
