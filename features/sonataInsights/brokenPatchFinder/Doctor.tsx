/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sonata Insights' window: an overview, then a tab each for features,
// broken patches, settings and performance — with one-click fixes.

import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, showToast, useEffect, useReducer, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { isFeatureRunning } from "../../../featureSettings";
import { doctor, DoctorFeature } from "../../../sonata/doctorBridge";
import { Window } from "../../_shared/Window";
import { DiscordStatusLine } from "../discordStatus";
import { featureIssue, fullReport, Hint, measureFps, memoryMb, performanceHints, problemFeatures, resetSetting, settingProblems, summary } from "./checks";
import { culpritActive, startCulpritHunt, stopCulpritHunt } from "./culprit";
import { checkLayout, onLayoutChecked, runLayoutCheck } from "./layout";
import { PatchesSection } from "./Panel";
import { onProblem } from "./recorder";
import { SpeedUp } from "./SpeedUp";

const dr = classNameFactory("vc-doc-");

type Tab = "overview" | "features" | "patches" | "settings" | "performance";

const TABS: { id: Tab; label: string; }[] = [
    { id: "overview", label: "Overview" },
    { id: "features", label: "Features" },
    { id: "patches", label: "Patches" },
    { id: "settings", label: "Settings" },
    { id: "performance", label: "Performance" },
];

function useRefresh() {
    const [n, bump] = useReducer((x: number) => x + 1, 0);
    useEffect(() => onProblem(bump), []);
    return [n, bump] as const;
}

// ─── Overview ───

function Overview({ go }: { go(t: Tab): void; }) {
    const s = summary();
    const total = s.patches + s.layout + s.features + s.settings + s.performance;
    const cards: { tab: Tab; icon: string; title: string; count: number; ok: string; bad: string; }[] = [
        { tab: "features", icon: "🧩", title: "Features", count: s.features, ok: `${s.feats.filter(f => f.status === "active").length} running smoothly`, bad: "need a look" },
        { tab: "patches", icon: "🩹", title: "Patches & layout", count: s.patches + s.layout, ok: "Everything Sonata changes in Discord still works", bad: "stopped working after a Discord update" },
        { tab: "settings", icon: "⚙️", title: "Settings", count: s.settings, ok: "Every setting reads fine", bad: "can't be read" },
        { tab: "performance", icon: "⚡", title: "Performance", count: s.performance, ok: "Nothing heavy to tune", bad: "easy speed-ups available" },
    ];
    return (
        <div className={dr("overview")}>
            <div className={classes(dr("verdict"), total ? dr("verdict-warn") : dr("verdict-ok"))}>
                <span className={dr("verdict-icon")}>{total ? "🩺" : "✓"}</span>
                <div>
                    <div className={dr("verdict-title")}>{total ? `${total} thing${total === 1 ? "" : "s"} to look at` : "Sonata is healthy"}</div>
                    <div className={dr("muted")}>{total ? "Click a card to see what and fix it." : "No broken patches, stuck features or damaged settings."}</div>
                </div>
            </div>
            <div className={dr("cards")}>
                {cards.map(c => (
                    <button key={c.tab} type="button" className={classes(dr("card"), c.count ? dr("card-warn") : dr("card-ok"))} onClick={() => go(c.tab)}>
                        <span className={dr("card-icon")}>{c.icon}</span>
                        <span className={dr("card-title")}>{c.title}</span>
                        <span className={dr("card-count")}>{c.count || "✓"}</span>
                        <span className={dr("muted")}>{c.count ? `${c.count} ${c.bad}` : c.ok}</span>
                    </button>
                ))}
            </div>
            <Culprit />
            <div className={dr("row")}>
                <span className={dr("muted")}>Asking for help? The report lists everything above, ready to paste.</span>
                <span className={dr("spacer")} />
                <button type="button" className={dr("btn")} onClick={() => { copyToClipboard(fullReport()); showToast("Insights report copied", "success"); }}>Copy full report</button>
            </div>
        </div>
    );
}

// ─── Find the culprit ───

function Culprit() {
    const [confirm, setConfirm] = useState(false);
    const n = (doctor()?.features() ?? []).filter(f => f.on && f.key !== "brokenPatchFinder").length;
    const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
    if (culpritActive()) {
        return (
            <div className={classes(dr("item"), dr("item-warn"), dr("culprit"))}>
                <span className={dr("card-icon")}>🔎</span>
                <div className={dr("item-main")}><b>Finding the culprit is under way</b><span className={dr("muted")}>Answer the question in the corner after each reload.</span></div>
                <button type="button" className={dr("btn")} onClick={stopCulpritHunt}>Stop and put everything back</button>
            </div>
        );
    }
    return (
        <div className={classes(dr("item"), dr("culprit"))}>
            <span className={dr("card-icon")}>🔎</span>
            <div className={dr("item-main")}>
                <b>Something wrong, but no idea which feature?</b>
                <span className={dr("muted")}>{confirm
                    ? `Discord will reload about ${rounds} times. Each time, half of the remaining features are switched off and you say whether the problem still happens. At the end the culprit stays off and everything else goes back exactly as it was.`
                    : `Find the culprit switches features off half at a time to find which one does it — about ${rounds} reloads for your ${n} features.`}</span>
            </div>
            {confirm
                ? <><button type="button" className={dr("btn")} onClick={() => setConfirm(false)}>Cancel</button><button type="button" className={classes(dr("btn"), dr("primary"))} onClick={() => { const err = startCulpritHunt(); if (err) showToast(err, "failure"); }}>Start (reloads Discord)</button></>
                : <button type="button" className={classes(dr("btn"), dr("primary"))} onClick={() => setConfirm(true)}>Find the culprit</button>}
        </div>
    );
}

// ─── Features ───

function Features() {
    const [, bump] = useReducer((x: number) => x + 1, 0);
    const [filter, setFilter] = useState<"problems" | "all" | "slow" | "patches">("problems");
    const d = doctor();
    const feats = d?.features() ?? [];
    const problems = problemFeatures(feats);
    let list: DoctorFeature[] = filter === "problems" ? problems : [...feats];
    if (filter === "slow") list = feats.filter(f => f.startMs != null).sort((a, b) => b.startMs! - a.startMs!).slice(0, 25);
    if (filter === "patches") list = feats.filter(f => f.patches).sort((a, b) => b.patches - a.patches).slice(0, 25);
    const needsReload = feats.some(f => f.status === "apply-on" || f.status === "apply-off");
    return (
        <div className={dr("section")}>
            <div className={dr("row")}>
                <div className={dr("seg")}>
                    {([["problems", `Need a look (${problems.length})`], ["slow", "Slowest to start"], ["patches", "Most patches"], ["all", "All"]] as const).map(([id, label]) => (
                        <button key={id} type="button" className={classes(dr("seg-btn"), filter === id && dr("seg-on"))} onClick={() => setFilter(id)}>{label}</button>
                    ))}
                </div>
                <span className={dr("spacer")} />
                {needsReload && <button type="button" className={classes(dr("btn"), dr("primary"))} onClick={() => d?.reload()}>Reload to apply</button>}
            </div>
            {list.length === 0 && <div className={dr("empty")}>✓ Nothing here — every feature is fine.</div>}
            {list.map(f => {
                const issue = featureIssue(f);
                return (
                    <div key={f.key} className={classes(dr("item"), issue && dr("item-warn"))}>
                        <span className={classes(dr("dot"), dr(`dot-${f.error ? "error" : f.status}`))} />
                        <div className={dr("item-main")}>
                            <span className={dr("item-name")}>{f.name}</span>
                            <span className={dr("muted")}>{issue ?? (f.status === "active" ? "Running" : "Off")}</span>
                        </div>
                        <span className={dr("stat")} title="Changes it makes to Discord's code">{f.patches} patch{f.patches === 1 ? "" : "es"}</span>
                        <span className={dr("stat")} title="How long it took to start">{f.startMs != null ? `${f.startMs < 1 ? "<1" : Math.round(f.startMs)} ms` : "—"}</span>
                        <button type="button" className={dr("btn")} onClick={() => { d?.setOn(f.key, !f.on); bump(); }}>{f.on ? "Turn off" : "Turn on"}</button>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Discord's layout ───

function LayoutSection() {
    const [, bump] = useReducer((x: number) => x + 1, 0);
    const [showAll, setShowAll] = useState(false);
    useEffect(() => { void runLayoutCheck(); return onLayoutChecked(bump); }, []);
    const results = checkLayout();
    const broken = results.filter(r => r.missing.length && r.inUse);
    const shown = showAll ? results : broken;
    return (
        <div className={dr("section")}>
            <div className={dr("row")}>
                <span className={dr("item-name")}>Discord's layout</span>
                <span className={dr("spacer")} />
                <button type="button" className={dr("link")} onClick={() => setShowAll(v => !v)}>{showAll ? "Only problems" : `Show all ${results.length} checks`}</button>
                <button type="button" className={dr("btn")} onClick={() => void runLayoutCheck()}>Check again</button>
            </div>
            <div className={dr("muted")}>Some features find parts of Discord by the names of its styles. When Discord renames one in an update, the feature quietly stops doing anything — this checks each name still exists.</div>
            {!shown.length && <div className={dr("empty")}>✓ Everything Sonata looks for in Discord's layout is still there.</div>}
            {shown.map(r => {
                const bad = r.missing.length > 0;
                return (
                    <div key={r.check.id} className={classes(dr("item"), bad && r.inUse && dr("item-warn"))}>
                        <span className={classes(dr("dot"), dr(bad ? (r.inUse ? "dot-error" : "dot-paused") : "dot-active"))} />
                        <div className={dr("item-main")}>
                            <span className={dr("item-name")}>{r.check.what}</span>
                            <span className={dr("muted")}>
                                {bad ? <>Discord no longer has <code>{r.missing.join(", ")}</code>{r.inUse ? " — this has probably stopped working. It needs a Sonata update." : " — you're not using it, so nothing's affected."}</> : "Working"}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Settings ───

function Settings() {
    const [, bump] = useReducer((x: number) => x + 1, 0);
    const problems = settingProblems();
    const fix = async (keys: string[]) => {
        for (const k of keys) await resetSetting(k);
        showToast(`Fixed ${keys.length} setting${keys.length === 1 ? "" : "s"} — the old values are kept in a backup`, "success");
        bump();
    };
    return (
        <div className={dr("section")}>
            <div className={dr("muted")}>Settings saved by older versions — or damaged by a crash — can stop features working. Fixing puts them back to their default; the old value is kept in a backup.</div>
            {problems.length === 0
                ? <div className={dr("empty")}>✓ Every one of Sonata's settings reads fine.</div>
                : (
                    <>
                        {problems.map(p => (
                            <div key={p.key} className={classes(dr("item"), dr("item-warn"))}>
                                <span className={classes(dr("dot"), dr("dot-error"))} />
                                <div className={dr("item-main")}>
                                    <span className={dr("item-name")}>{p.label}</span>
                                    <span className={dr("muted")}>{p.why} · <code>{p.value}</code></span>
                                </div>
                                <button type="button" className={dr("btn")} onClick={() => fix([p.key])}>Reset</button>
                            </div>
                        ))}
                        <div className={dr("row")}>
                            <span className={dr("spacer")} />
                            <button type="button" className={classes(dr("btn"), dr("primary"))} onClick={() => fix(problems.map(p => p.key))}>Fix all</button>
                        </div>
                    </>
                )}
        </div>
    );
}

// ─── Performance ───

function Performance() {
    const [, bump] = useReducer((x: number) => x + 1, 0);
    const [fps, setFps] = useState<number | null>(null);
    const [testing, setTesting] = useState(false);
    const hints = performanceHints();
    const d = doctor();
    const feats = d?.features() ?? [];
    const startTotal = feats.reduce((n, f) => n + (f.startMs ?? 0), 0);
    const patchTotal = feats.filter(f => f.on).reduce((n, f) => n + f.patches, 0);
    const mem = memoryMb();
    const test = async () => { setTesting(true); setFps(await measureFps()); setTesting(false); };
    const rating = fps == null ? "" : fps >= 55 ? "Smooth" : fps >= 40 ? "OK" : "Struggling";
    const run = (h: Hint) => { h.fix?.run(); showToast(`${h.fix?.label} ✓`, "success"); bump(); };
    const slow = feats.filter(f => f.startMs != null).sort((a, b) => b.startMs! - a.startMs!).slice(0, 8);
    const slowest = slow[0]?.startMs ?? 1;
    const deferred = !!d?.store?.perfDeferStart;
    return (
        <div className={dr("section")}>
            <SpeedUp cls={dr} onChange={bump} />
            <div className={dr("stats")}>
                <div className={dr("statbox")}><b>{Math.round(startTotal)} ms</b><span>to start Sonata's features</span></div>
                <div className={dr("statbox")}><b>{patchTotal}</b><span>changes to Discord's code</span></div>
                <div className={dr("statbox")}><b>{mem != null ? `${mem} MB` : "—"}</b><span>memory in use</span></div>
                <div className={dr("statbox")}>
                    <b>{testing ? "…" : fps != null ? `${fps} fps` : "—"}</b>
                    <span>{fps != null ? rating : <button type="button" className={dr("link")} onClick={test}>Test smoothness</button>}</span>
                </div>
            </div>
            <div className={dr("startup")}>
                <div className={dr("row")}>
                    <span className={dr("item-name")}>Start-up</span>
                    <span className={dr("muted")}>{Math.round(startTotal)} ms for {feats.filter(f => f.startMs != null).length} features this session</span>
                    <span className={dr("spacer")} />
                    <button type="button" className={classes(dr("btn"), !deferred && dr("primary"))} onClick={() => { if (d?.store) d.store.perfDeferStart = !deferred; bump(); }}>
                        {deferred ? "✓ Starting features after Discord loads" : "Start features after Discord loads"}
                    </button>
                </div>
                {slow.map(f => (
                    <div key={f.key} className={dr("bar-row")}>
                        <span className={dr("bar-name")}>{f.name}</span>
                        <span className={dr("bar")}><span style={{ width: `${Math.max(3, (f.startMs! / slowest) * 100)}%` }} /></span>
                        <span className={dr("stat")}>{f.startMs! < 1 ? "<1" : Math.round(f.startMs!)} ms</span>
                        <button type="button" className={dr("btn")} onClick={() => { d?.setOn(f.key, false); bump(); }}>Turn off</button>
                    </div>
                ))}
                <div className={dr("muted")}>"Start features after Discord loads" lets the ones that don't change Discord's code wait until Discord is idle, so Discord opens faster. It takes effect next time Discord starts.</div>
            </div>
            {fps != null && <div className={dr("muted")}>Measured with whatever's on screen now — try it with Sonata's page open to see how your design runs. <button type="button" className={dr("link")} onClick={test}>Test again</button></div>}
            {hints.length === 0
                ? <div className={dr("empty")}>✓ Nothing heavy to tune.</div>
                : hints.map(h => (
                    <div key={h.id} className={dr("item")}>
                        <span className={dr("item-icon")}>⚡</span>
                        <div className={dr("item-main")}>
                            <span className={dr("item-name")}>{h.title}</span>
                            <span className={dr("muted")}>{h.detail}</span>
                        </div>
                        {h.fix && <button type="button" className={dr("btn")} onClick={() => run(h)}>{h.fix.label}</button>}
                    </div>
                ))}
        </div>
    );
}

// ─── The window ───

function DoctorModal({ modalProps, start }: { modalProps: RenderModalProps; start: Tab; }) {
    const accent = windowAccent("brokenPatchFinder");
    const [tab, setTab] = useState<Tab>(start);
    useRefresh();
    const s = summary();
    const badge: Record<Tab, number> = { overview: 0, features: s.features, patches: s.patches + s.layout, settings: s.settings, performance: s.performance };
    const problems = s.features + s.patches + s.layout + s.settings + s.performance;
    return (
        <Window {...modalProps} size="lg" title="Sonata Insights" subtitle="Problems, broken patches and performance — with one-click fixes"
            tabs={TABS.map(t => [t.id, <>{t.label}{badge[t.id] ? <span className="vc-sw-count">{badge[t.id]}</span> : null}</>] as const)} tab={tab} onTab={id => setTab(id as Tab)}
            status={[problems ? `${problems} thing${problems === 1 ? "" : "s"} to look at` : "everything looks fine"]}>
            <div className={dr("wrap")} style={accent ? ({ "--doc-accent": accent, "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                {tab === "overview" && isFeatureRunning("discordStatus") && <DiscordStatusLine />}
                {tab === "overview" && <Overview go={setTab} />}
                {tab === "features" && <Features />}
                {tab === "patches" && <><LayoutSection /><PatchesSection /></>}
                {tab === "settings" && <Settings />}
                {tab === "performance" && <Performance />}
            </div>
        </Window>
    );
}

export function openDoctor(start: Tab = "overview") {
    openModal(props => <DoctorModal modalProps={props} start={start} />);
}
