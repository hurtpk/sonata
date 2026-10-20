/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Scam Shield window: what it's protected you from (links it stopped you
// opening, warnings it put under messages), the links you checked yourself,
// and the websites you told it to trust.

import ErrorBoundary from "@components/ErrorBoundary";
import { copyWithToast } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { NavigationRouter, openModal, useMemo, useState } from "@webpack/common";

import { clearLog, LogEntry, logPrefs, removeLog, useLog } from "../_shared/scamLog";
import { Window } from "../_shared/Window";
import { openChecker } from "./Checker";

export interface DashboardHooks { trusted(): string[]; untrust(site: string): void; }

type Tab = "protected" | "checked" | "trusted";
type Filter = "all" | "scam" | "careful" | "file" | "qr" | "text" | "account";
const PERIODS: [number, string][] = [[7, "7 days"], [30, "30 days"], [0, "All time"]];

const KIND_ICON: Record<string, string> = { link: "🔗", file: "📦", qr: "▦", text: "💬", account: "🐣" };
const LEVEL = {
    scam: { label: "Scam", cls: "bad" },
    suspicious: { label: "Be careful", cls: "warn" },
    safe: { label: "Official", cls: "good" },
    other: { label: "Nothing found", cls: "plain" },
} as const;
const OUTCOME = { safe: "You stayed safe", opened: "You opened it anyway", trusted: "You trusted the site" } as const;

function ago(t: number) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return d < 30 ? `${d} day${d === 1 ? "" : "s"} ago` : new Date(t).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** What to call an entry: its website, its file, or what kind of warning it was. */
function titleOf(e: LogEntry) {
    if (e.kind === "file") return decodeURIComponent(e.url.split("?")[0].split("/").pop() ?? "A program");
    if (e.kind === "text") return "A message that sounds like a scam";
    if (e.kind === "account") return "A brand-new account sent a link";
    if (e.kind === "qr") return `QR code → ${e.host || "a link"}`;
    return e.host || e.url.slice(0, 60) || "A link";
}

function jump(e: LogEntry) {
    const w = e.where;
    if (w?.channelId && w.messageId) NavigationRouter.transitionTo(`/channels/${w.guildId ?? "@me"}/${w.channelId}/${w.messageId}`);
}

function Row({ e, onClose }: { e: LogEntry; onClose(): void; }) {
    const lv = LEVEL[e.level] ?? LEVEL.other;
    const isLink = !e.kind || e.kind === "link" || e.kind === "qr";
    return (
        <div className={classes("vc-shield-row", `vc-shield-row-${lv.cls}`)}>
            <span className="vc-shield-row-icon" aria-hidden>{KIND_ICON[e.kind ?? "link"] ?? "🔗"}</span>
            <div className="vc-shield-row-main">
                <div className="vc-shield-row-top">
                    <b className="vc-shield-row-title">{titleOf(e)}</b>
                    <span className={classes("vc-shield-pill", `vc-shield-pill-${lv.cls}`)}>{lv.label}</span>
                    {e.type === "blocked" && <span className={classes("vc-shield-pill", e.outcome === "opened" ? "vc-shield-pill-warn" : "vc-shield-pill-good")}>{e.outcome ? OUTCOME[e.outcome] : "Click stopped"}</span>}
                    {e.source === "roblox" && <span className="vc-shield-pill vc-shield-pill-plain">Roblox Tools</span>}
                </div>
                {e.reason && <span className="vc-shield-row-reason">{e.reason}</span>}
                {e.final && <span className="vc-shield-row-url">→ led to {e.final}</span>}
                {e.type === "checked" && !e.final && isLink && <span className="vc-shield-row-url">{e.url}</span>}
                <span className="vc-shield-row-meta">
                    {[e.type === "blocked" ? "You clicked it" : e.type === "warned" ? "Warning shown" : "You checked it", e.where?.label, e.author ? `from ${e.author.name}` : null, ago(e.at)].filter(Boolean).join(" · ")}
                </span>
            </div>
            <div className="vc-shield-row-actions">
                {e.where?.messageId && <button type="button" className="vc-tool-icon" title="Go to the message" onClick={() => { onClose(); jump(e); }}>↗</button>}
                {isLink && e.url && <button type="button" className="vc-tool-icon" title="Check it again" onClick={() => openChecker(e.url)}>🔍</button>}
                {isLink && e.url && <button type="button" className="vc-tool-icon" title="Copy the link (don't open it!)" onClick={() => copyWithToast(e.url, "Link copied")}>📋</button>}
                <button type="button" className="vc-tool-icon" title="Remove from history" onClick={() => void removeLog(e.id)}>✕</button>
            </div>
        </div>
    );
}

function DashboardModal({ modalProps, hooks }: { modalProps: RenderModalProps; hooks: DashboardHooks; }) {
    const log = useLog();
    const [tab, setTab] = useState<Tab>("protected");
    const [days, setDays] = useState(30);
    const [filter, setFilter] = useState<Filter>("all");
    const [find, setFind] = useState("");
    const [trusted, setTrusted] = useState(hooks.trusted());

    const inPeriod = useMemo(() => days ? log.filter(e => e.at >= Date.now() - days * 86400_000) : log, [log, days]);
    const protectedList = inPeriod.filter(e => e.type !== "checked");
    const checkedList = inPeriod.filter(e => e.type === "checked");
    const stopped = protectedList.filter(e => e.type === "blocked");
    const warned = protectedList.filter(e => e.type === "warned");
    const scams = protectedList.filter(e => e.level === "scam");
    const checkedScams = checkedList.filter(e => e.level === "scam");
    const period = days ? `the last ${days} days` : "all this time";

    const q = find.trim().toLowerCase();
    const matches = (e: LogEntry) => !q || [e.host, e.url, e.reason, e.where?.label, e.author?.name, e.final].some(x => x?.toLowerCase().includes(q));
    const shownProtected = protectedList.filter(e => {
        if (!matches(e)) return false;
        switch (filter) {
            case "scam": return e.level === "scam";
            case "careful": return e.level === "suspicious";
            case "all": return true;
            default: return (e.kind ?? "link") === filter;
        }
    });
    const shownChecked = checkedList.filter(matches);
    const counts = (f: Filter) => f === "all" ? protectedList.length : f === "scam" ? scams.length : f === "careful" ? protectedList.filter(e => e.level === "suspicious").length : protectedList.filter(e => (e.kind ?? "link") === f).length;
    const FILTERS: [Filter, string][] = ([["all", "All"], ["scam", "🚨 Scams"], ["careful", "⚠️ Be careful"], ["file", "📦 Programs"], ["qr", "▦ QR codes"], ["text", "💬 Messages"], ["account", "🐣 New accounts"]] as [Filter, string][]).filter(([f]) => f === "all" || counts(f) > 0);

    const headline = !protectedList.length ? "Nothing risky yet" : scams.length ? `${scams.length} scam${scams.length === 1 ? "" : "s"} caught` : `${protectedList.length} warning${protectedList.length === 1 ? "" : "s"}`;

    return (
        <Window {...modalProps} size="lg" title="Scam Shield" subtitle="What it's protected you from, and the links you've checked">
            <div className="vc-tool-wrap vc-shield-dash">
                <div className="vc-shield-hero">
                    <div className="vc-shield-hero-badge" aria-hidden>
                        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>
                    </div>
                    <div className="vc-shield-hero-text">
                        <b>{headline}</b>
                        <span>{protectedList.length ? `In ${period}: ${stopped.length} click${stopped.length === 1 ? "" : "s"} stopped and ${warned.length} warning${warned.length === 1 ? "" : "s"} shown under messages.` : `Scam Shield is watching your chats. Anything it catches in ${period} shows up here.`}</span>
                    </div>
                    <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => openChecker()}>🔍 Check a link</button>
                </div>

                <div className="vc-shield-stats">
                    <div className="vc-shield-stat"><span>Clicks stopped</span><b>{stopped.length}</b><small>{(n => `you stayed safe ${n === 1 ? "once" : `${n} times`}`)(stopped.filter(e => e.outcome !== "opened").length)}</small></div>
                    <div className="vc-shield-stat"><span>Warnings shown</span><b>{warned.length}</b><small>{(n => `${n} ${n === 1 ? "was a scam" : "were scams"}`)(warned.filter(e => e.level === "scam").length)}</small></div>
                    <div className="vc-shield-stat"><span>Links you checked</span><b>{checkedList.length}</b><small>{checkedScams.length} {checkedScams.length === 1 ? "was a scam" : "were scams"}</small></div>
                    <div className="vc-shield-stat"><span>Trusted sites</span><b>{trusted.length}</b><small>never warned about</small></div>
                </div>

                <div className="vc-shield-bar">
                    <div className="vc-tool-tabs">
                        <button type="button" className={classes("vc-tool-tab", tab === "protected" && "vc-tool-tab-on")} onClick={() => setTab("protected")}>🛡️ Protected you · {protectedList.length}</button>
                        <button type="button" className={classes("vc-tool-tab", tab === "checked" && "vc-tool-tab-on")} onClick={() => setTab("checked")}>🔍 You checked · {checkedList.length}</button>
                        <button type="button" className={classes("vc-tool-tab", tab === "trusted" && "vc-tool-tab-on")} onClick={() => setTab("trusted")}>✅ Trusted sites · {trusted.length}</button>
                    </div>
                    <span className="vc-tool-spacer" />
                    {tab !== "trusted" && (
                        <div className="vc-tool-seg">
                            {PERIODS.map(([d, l]) => <button key={d} type="button" className={classes("vc-tool-seg-btn", days === d && "vc-tool-seg-on")} onClick={() => setDays(d)}>{l}</button>)}
                        </div>
                    )}
                </div>

                {tab !== "trusted" && (
                    <div className="vc-shield-tools">
                        <input className="vc-tool-input" value={find} placeholder="Search websites, people, places…" onChange={e => setFind(e.currentTarget.value)} />
                        {tab === "protected" && FILTERS.length > 1 && (
                            <div className="vc-tool-chips">
                                {FILTERS.map(([f, l]) => <button key={f} type="button" className={classes("vc-tool-chip", filter === f && "vc-tool-chip-on")} onClick={() => setFilter(f)}>{l} · {counts(f)}</button>)}
                            </div>
                        )}
                    </div>
                )}

                {tab === "protected" && (
                    shownProtected.length ? <div className="vc-shield-list">{shownProtected.map(e => <Row key={e.id} e={e} onClose={modalProps.onClose} />)}</div>
                        : <div className="vc-tool-empty"><span className="vc-tool-empty-icon">🛡️</span>{q || filter !== "all" ? "Nothing matches that." : `Nothing caught in ${period} — when Scam Shield warns you about a link, file or message, it shows up here.`}</div>
                )}

                {tab === "checked" && (
                    shownChecked.length ? <div className="vc-shield-list">{shownChecked.map(e => <Row key={e.id} e={e} onClose={modalProps.onClose} />)}</div>
                        : <div className="vc-tool-empty"><span className="vc-tool-empty-icon">🔍</span>{q ? "Nothing matches that." : <>Links you check yourself show up here. <button type="button" className="vc-tool-link" onClick={() => openChecker()}>Check one now</button></>}</div>
                )}

                {tab === "trusted" && (
                    trusted.length ? (
                        <div className="vc-tool-list">
                            {trusted.map(site => (
                                <div key={site} className="vc-tool-item">
                                    <span className="vc-shield-row-icon" aria-hidden>✅</span>
                                    <span className="vc-tool-item-main"><span className="vc-tool-item-title">{site}</span><span className="vc-tool-item-sub">Scam Shield won't warn about this website</span></span>
                                    <button type="button" className="vc-tool-btn" onClick={() => { hooks.untrust(site); setTrusted(hooks.trusted()); }}>Stop trusting</button>
                                </div>
                            ))}
                        </div>
                    ) : <div className="vc-tool-empty"><span className="vc-tool-empty-icon">✅</span>No trusted sites. If Scam Shield warns about a site you know is fine, choose “Trust” in its popup.</div>
                )}

                <div className="vc-shield-foot">
                    <span className="vc-tool-hint">{logPrefs.on ? `History is kept only on this computer${logPrefs.days ? `, for ${logPrefs.days} days` : ""}.` : "History is switched off in Scam Shield's settings."}</span>
                    <span className="vc-tool-spacer" />
                    {tab !== "trusted" && (tab === "checked" ? checkedList : protectedList).length > 0 && (
                        <button type="button" className="vc-tool-link" onClick={() => void clearLog(tab === "checked" ? ["checked"] : ["blocked", "warned"])}>Clear {tab === "checked" ? "checked links" : "history"}</button>
                    )}
                </div>
            </div>
        </Window>
    );
}

export const openDashboard = (hooks: DashboardHooks) => openModal(props => <ErrorBoundary><DashboardModal modalProps={props} hooks={hooks} /></ErrorBoundary>);
