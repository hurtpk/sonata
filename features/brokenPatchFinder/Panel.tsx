/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { plugins } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { showToast, useEffect, useState } from "@webpack/common";
import { patches as pendingPatches } from "@webpack/patcher";

import { QOL_NAME } from "../../featureSettings";
import { code, getProblems, onProblem, Problem } from "./recorder";

const cl = classNameFactory("vc-bpf-");

const KIND_LABEL: Record<Problem["kind"] | "notFound", string> = {
    noEffect: "No effect",
    errored: "Errored",
    groupUndone: "Undone",
    notFound: "Not found yet",
};

const KIND_HELP: Record<Problem["kind"] | "notFound", string> = {
    noEffect: "Found the right part of Discord, but the code it changes has moved — this part of the plugin isn't working.",
    errored: "Changing Discord's code broke it, so Equicord skipped the change.",
    groupUndone: "One of a set of linked changes failed, so the whole set was skipped.",
    notFound: "The part of Discord it changes hasn't loaded yet. It may load later (opening a menu or page), or it may no longer exist.",
};

interface Owner { plugin: string; feature?: string; featureName?: string; }

/** Sonata's patches are all filed under "Sonata" — work out which of its features each belongs to. */
function opticordFeatureFor(match: string, find?: string): { key: string; name: string; } | undefined {
    const features: Record<string, any> = (plugins[QOL_NAME] as any)?.f ?? {};
    for (const [key, f] of Object.entries(features)) {
        for (const p of f.patches ?? []) {
            const reps = Array.isArray(p.replacement) ? p.replacement : [p.replacement];
            if ((find && String(p.find) === find) || reps.some((r: any) => String(r.match) === match)) {
                return { key, name: String(f.name).replace(/([a-z])([A-Z])/g, "$1 $2") };
            }
        }
    }
    return undefined;
}

function ownerOf(plugin: string, match: string, find?: string): Owner {
    if (plugin !== QOL_NAME) return { plugin };
    const f = opticordFeatureFor(match, find);
    return { plugin, feature: f?.key, featureName: f?.name };
}

interface Entry { kind: Problem["kind"] | "notFound"; match: string; find?: string; error?: string; }
interface Group { id: string; owner: Owner; entries: Entry[]; }

export function collect(): { broken: Group[]; pending: Group[]; } {
    const groups = (list: { plugin: string; entry: Entry; }[]) => {
        const map = new Map<string, Group>();
        for (const { plugin, entry } of list) {
            const owner = ownerOf(plugin, entry.match, entry.find);
            const id = owner.feature ? `${plugin}:${owner.feature}` : plugin;
            if (!map.has(id)) map.set(id, { id, owner, entries: [] });
            map.get(id)!.entries.push(entry);
        }
        return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
    };

    const broken = groups(getProblems().map(p => ({ plugin: p.plugin, entry: { kind: p.kind, match: p.match, find: p.find, error: p.error } })));
    const pending = groups(pendingPatches.filter(p => !p.all).map(p => {
        const reps = Array.isArray(p.replacement) ? p.replacement : [p.replacement];
        return { plugin: p.plugin, entry: { kind: "notFound" as const, find: String(p.find), match: String(reps[0]?.match ?? "") } };
    }));
    return { broken, pending };
}

const titleOf = (g: Group) => g.owner.featureName ? `${QOL_NAME} → ${g.owner.featureName}` : g.owner.plugin;

function turnOff(g: Group) {
    if (g.owner.feature) Settings.plugins[QOL_NAME][`on_${g.owner.feature}`] = false;
    else if (Settings.plugins[g.owner.plugin]) Settings.plugins[g.owner.plugin].enabled = false;
    showToast(`${titleOf(g)} will be off after a reload (Ctrl+R)`, "message");
}

export function report(groups: Group[]) {
    const lines = [`Broken patches (Discord build ${(window as any).GLOBAL_ENV?.SENTRY_TAGS?.buildId ?? "?"}):`, ""];
    for (const g of groups) {
        lines.push(`## ${titleOf(g)}`);
        for (const e of g.entries) lines.push(`- ${KIND_LABEL[e.kind]}: ${e.find ? `find ${code(e.find)} · ` : ""}${code(e.match)}${e.error ? ` (${e.error})` : ""}`);
        lines.push("");
    }
    return lines.join("\n");
}

function GroupCard({ g, canTurnOff }: { g: Group; canTurnOff: boolean; }) {
    return (
        <section className={cl("group")}>
            <div className={cl("group-head")}>
                <span className={cl("plugin")}>{titleOf(g)}</span>
                <span className={cl("count")}>{g.entries.length}</span>
                <span style={{ flex: 1 }} />
                {canTurnOff && <button type="button" className={cl("btn")} onClick={() => turnOff(g)}>Turn off</button>}
            </div>
            {g.entries.map((e, i) => (
                <div key={i} className={cl("entry")}>
                    <span className={classes(cl("kind"), cl(`kind-${e.kind}`))} title={KIND_HELP[e.kind]}>{KIND_LABEL[e.kind]}</span>
                    <code className={cl("code")}>{e.find ? `${e.find}` : e.match}</code>
                    {e.find && e.match && <code className={classes(cl("code"), cl("code-sub"))}>{e.match}</code>}
                    {e.error && <span className={cl("err")}>{e.error}</span>}
                </div>
            ))}
        </section>
    );
}

/** The broken-patch list: Sonata Insights' "Patches" tab. */
export function PatchesSection() {
    const [{ broken, pending }, setData] = useState(collect);
    const [showPending, setShowPending] = useState(false);
    useEffect(() => onProblem(() => setData(collect())), []);

    return (
        <div className={cl("wrap")}>
            <div className={cl("intro")}>
                Plugins work by changing bits of Discord's code. When Discord updates, some of those bits move and the change silently stops working — this lists the ones that did.
            </div>

            {broken.length === 0
                ? <div className={cl("ok")}>✓ No broken patches found.</div>
                : broken.map(g => <GroupCard key={g.id} g={g} canTurnOff />)}

            <button type="button" className={cl("toggle")} onClick={() => setShowPending(s => !s)}>
                {showPending ? "▾" : "▸"} Not matched yet ({pending.reduce((n, g) => n + g.entries.length, 0)}) — usually fine, see why
            </button>
            {showPending && (
                <>
                    <div className={cl("intro")}>{KIND_HELP.notFound}</div>
                    {pending.map(g => <GroupCard key={g.id} g={g} canTurnOff={false} />)}
                </>
            )}

            <div className={cl("footer")}>
                <button type="button" className={cl("btn")} onClick={() => setData(collect())}>Refresh</button>
                <button type="button" className={cl("btn")} disabled={!broken.length}
                    onClick={() => { copyToClipboard(report(broken)); showToast("Report copied — paste it to the plugin's developer", "success"); }}>
                    Copy report
                </button>
            </div>
        </div>
    );
}
