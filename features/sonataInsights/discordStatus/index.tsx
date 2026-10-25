/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord Status: a bar along the top of Discord when Discord itself is having
// problems (from discordstatus.com), so you know it's not your internet. Its
// window shows what's affected, Discord's latest update, voice regions and
// planned maintenance.

import "../../_shared/tool.css";
import "./styles.css";

import { showNotice } from "@api/Notices";
import { showNotification } from "@api/Notifications";
import { classes } from "@utils/misc";
import { openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { useEffect, useState } from "@webpack/common";

import { defineFeatureSettings } from "../../../featureSettings";
import { Window } from "../../_shared/Window";
import { FormGroup } from "../../_shared/WindowParts";
import type { Health, StatusIncident, StatusSummary } from "./native";

const settings = defineFeatureSettings("discordStatus", {
    banner: { type: OptionType.BOOLEAN, description: "Show a bar at the top of Discord while Discord is having problems", default: true },
    alerts: { type: OptionType.BOOLEAN, description: "Also send a pop-up when a problem starts and when it's fixed", default: false },
    maintenance: { type: OptionType.BOOLEAN, description: "Show the bar during Discord's planned maintenance too", default: false },
});

const native = () => VencordNative.pluginHelpers.Sonata as any;

let latest: StatusSummary | null = null;
let error: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
/** Problems you've already been shown (or closed), so each one shows once. */
const told = new Set<string>();
let hadProblem = false;

const HEALTH: Record<Health, [string, string]> = {
    operational: ["Working", "#23a55a"],
    degraded_performance: ["Slow", "#f0b232"],
    partial_outage: ["Partly down", "#f57731"],
    major_outage: ["Down", "#f23f43"],
    under_maintenance: ["Maintenance", "#5865f2"],
};
const IMPACT: Record<string, string> = { none: "#80848e", minor: "#f0b232", major: "#f57731", critical: "#f23f43", maintenance: "#5865f2" };

const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString();
};
const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Problems happening right now: open incidents, and maintenance that's underway (if you want those). */
function problems(s: StatusSummary) {
    const out: { id: string; text: string; }[] = s.incidents.filter(i => !/resolved|postmortem/.test(i.status)).map(i => ({ id: i.id, text: i.name }));
    if (settings.store.maintenance) for (const m of s.maintenance) if (m.status === "in_progress") out.push({ id: m.id, text: `Planned maintenance: ${m.name}` });
    return out;
}

const STYLE_ID = "vc-dstatus-bar-style";
function paint() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
[class*="notice__"]:has(.vc-dstatus-bar) { background: #3a1416 !important; color: #ffb3b5 !important; border-bottom: 1px solid #5c2023 !important; }
[class*="notice__"]:has(.vc-dstatus-bar) [class*="button__"] { color: #ffb3b5 !important; border: 1px solid #e0565b !important; background: transparent !important; border-radius: 4px !important; }
[class*="notice__"]:has(.vc-dstatus-bar) [class*="button__"]:hover { color: #fff !important; background: rgb(224 86 91 / 0.2) !important; }
[class*="notice__"]:has(.vc-dstatus-bar) [class*="closeIcon__"], [class*="notice__"]:has(.vc-dstatus-bar) [class*="closeButton__"] { color: #ffb3b5 !important; }
.vc-dstatus-bar { font-weight: 500; }`;
    document.head.appendChild(style);
    // The colour goes once the bar has (it's only there while the bar shows).
    const watch = setInterval(() => {
        if (document.querySelector(".vc-dstatus-bar")) return;
        clearInterval(watch);
        document.getElementById(STYLE_ID)?.remove();
    }, 3000);
}

async function check() {
    const r = await native().statusSummary?.().catch(() => null);
    if (!r?.ok) { error = r?.error ?? "Couldn't check"; emit(); return; }
    error = null;
    latest = r.summary as StatusSummary;
    emit();
    const now = problems(latest);
    const fresh = now.filter(p => !told.has(p.id));
    for (const p of fresh) told.add(p.id);
    if (fresh.length) {
        if (settings.store.banner) {
            paint();
            showNotice(<span className="vc-dstatus-bar">Discord is having problems: {fresh[0].text}{now.length > 1 ? ` (and ${now.length - 1} more)` : ""}. It's not your internet.</span>, "Details", () => openStatus());
        }
        if (settings.store.alerts) showNotification({ title: "Discord is having problems", body: fresh[0].text, onClick: () => openStatus() });
    }
    if (hadProblem && !now.length && settings.store.alerts) showNotification({ title: "Discord's problem is fixed", body: latest.description, onClick: () => openStatus() });
    hadProblem = now.length > 0;
}

function useStatus() {
    const [, bump] = useState(0);
    useEffect(() => { const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return { latest, error };
}

/* ── The window ── */

function Incident({ i }: { i: StatusIncident; }) {
    return (
        <div className="vc-dstatus-incident" style={{ "--k": IMPACT[i.impact] ?? IMPACT.minor } as React.CSSProperties}>
            <div className="vc-dstatus-incident-head">
                <b>{i.name}</b>
                <span className="vc-dstatus-tag">{i.status.replace(/_/g, " ")}</span>
            </div>
            {i.latest && <p>{i.latest}</p>}
            <small>
                Started {ago(i.started)}{i.updated ? ` · updated ${ago(i.updated)}` : ""}{i.parts.length ? ` · ${i.parts.slice(0, 4).join(", ")}${i.parts.length > 4 ? "…" : ""}` : ""} · <a href={i.link} target="_blank" rel="noreferrer">Read more</a>
            </small>
        </div>
    );
}

function StatusWindow({ modalProps }: { modalProps: RenderModalProps; }) {
    const { latest: s, error: err } = useStatus();
    const [busy, setBusy] = useState(false);
    const refresh = async () => { setBusy(true); await check(); setBusy(false); };
    useEffect(() => { if (!s || Date.now() - s.checked > 60_000) void refresh(); }, []);

    const top = s?.parts.filter(p => !p.group) ?? [];
    const groups = new Map<string, typeof top>();
    for (const p of s?.parts ?? []) if (p.group) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
    const open = s?.incidents.filter(i => !/resolved|postmortem/.test(i.status)) ?? [];
    const recent = s?.incidents.filter(i => /resolved|postmortem/.test(i.status)) ?? [];
    const allGood = s && s.indicator === "none" && !open.length;

    return (
        <Window {...modalProps} size="md" title="Discord Status" subtitle="Whether Discord itself is working, from discordstatus.com"
            status={[s ? s.description.toLowerCase() : busy ? "checking…" : "not checked yet", s ? `checked ${ago(s.checked)}` : ""]}
            statusRight="from discordstatus.com"
            tools={<button type="button" className="vc-tool-btn" disabled={busy} onClick={() => void refresh()}>{busy ? "Checking…" : "Check now"}</button>}>
            <div className="vc-tool-wrap vc-dstatus">
                <div className={classes("vc-dstatus-hero", allGood && "vc-dstatus-hero-ok")} style={{ "--k": allGood ? "#23a55a" : IMPACT[s?.indicator ?? "none"] } as React.CSSProperties}>
                    <i />
                    <div>
                        <b>{s ? allGood ? "Discord is working normally" : s.description : err ?? "Checking Discord's status…"}</b>
                        <span>{s ? allGood ? "If something's wrong, it's probably your internet or this app — not Discord." : `${open.length} problem${open.length === 1 ? "" : "s"} Discord is working on` : "From Discord's own status page."}</span>
                    </div>
                </div>
                {err && s && <div className="vc-tool-hint">Couldn't check just now ({err}). Showing what it said {ago(s.checked)}.</div>}

                {open.length > 0 && <FormGroup title="Happening now">{open.map(i => <Incident key={i.id} i={i} />)}</FormGroup>}
                {s?.maintenance.length ? (
                    <FormGroup title="Planned maintenance">
                        {s.maintenance.map(m => (
                            <div key={m.id} className="vc-dstatus-incident" style={{ "--k": IMPACT.maintenance } as React.CSSProperties}>
                                <div className="vc-dstatus-incident-head"><b>{m.name}</b><span className="vc-dstatus-tag">{m.status.replace(/_/g, " ")}</span></div>
                                <small>{when(m.from)} – {when(m.to)} · <a href={m.link} target="_blank" rel="noreferrer">Read more</a></small>
                            </div>
                        ))}
                    </FormGroup>
                ) : null}

                {s && (
                    <FormGroup title="Parts of Discord">
                        <div className="vc-dstatus-parts">
                            {top.map(p => <Part key={p.id} name={p.name} h={p.status} />)}
                        </div>
                    </FormGroup>
                )}
                {[...groups].map(([g, list]) => (
                    <FormGroup key={g} title={g === "Voice" ? "Voice regions" : g}>
                        <div className="vc-dstatus-parts">{list.map(p => <Part key={p.id} name={p.name} h={p.status} />)}</div>
                    </FormGroup>
                ))}
                {recent.length > 0 && <FormGroup title="Fixed recently">{recent.slice(0, 3).map(i => <Incident key={i.id} i={i} />)}</FormGroup>}
            </div>
        </Window>
    );
}

function Part({ name, h }: { name: string; h: Health; }) {
    const [label, colour] = HEALTH[h] ?? ["Unknown", "#80848e"];
    return <div className="vc-dstatus-part"><i style={{ background: colour }} /><span>{name}</span><small style={h === "operational" ? undefined : { color: colour }}>{label}</small></div>;
}

const openStatus = () => openModal(props => <StatusWindow modalProps={props} />);

/** Sonata Insights' Overview: whether Discord itself is working, so you can tell whose problem it is. */
export function DiscordStatusLine() {
    const { latest: s, error: err } = useStatus();
    useEffect(() => { if (!s || Date.now() - s.checked > 5 * 60_000) void check(); }, []);
    const open = s?.incidents.filter(i => !/resolved|postmortem/.test(i.status)) ?? [];
    const ok = !!s && s.indicator === "none" && !open.length;
    const colour = !s ? "#80848e" : ok ? "#23a55a" : IMPACT[s.indicator] ?? "#f0b232";
    return (
        <button type="button" className="vc-dstatus-line" style={{ "--k": colour } as React.CSSProperties} onClick={() => openStatus()} title="Open Discord Status">
            <i />
            <span className="vc-dstatus-line-text">
                <b>{!s ? (err ? "Couldn't check Discord's status" : "Checking Discord's status…") : ok ? "Discord itself is working" : `Discord is having problems: ${open[0]?.name ?? s.description}`}</b>
                <span>{s ? `${ok ? "So anything wrong is on this side — see below." : "Some trouble may be Discord's, not Sonata's."} Checked ${ago(s.checked)}.` : "From discordstatus.com"}</span>
            </span>
            <span className="vc-dstatus-line-go">Details ›</span>
        </button>
    );
}

let timer: ReturnType<typeof setInterval> | undefined;
let first: ReturnType<typeof setTimeout> | undefined;

export default definePlugin({
    name: "DiscordStatus",
    description: "A bar at the top of Discord when Discord itself is having problems, so you know it's not your internet. Shows what's affected and Discord's latest update.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,
    openSettingsModal: () => openStatus(),
    start() {
        first = setTimeout(() => void check(), 20_000);
        timer = setInterval(() => void check(), 3 * 60_000);
    },
    stop() {
        clearTimeout(first);
        clearInterval(timer);
        document.getElementById(STYLE_ID)?.remove();
    },
});
