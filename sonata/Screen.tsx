/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sonata's screen, set into the window as a rounded canvas: a floating pill
// of tabs (Features, Plugins, Dock, Keybinds, Appearance, Performance) and a
// pane under it that scrolls on its own. Features opens on a big headline and
// a turning music note, then a toolbar that stays put while you scroll the cards.

import "./sonata.css";
import "../utilities/styles.css";

import { isPluginEnabled, isSettingHidden } from "@api/PluginManager";
import { OptionComponentMap } from "@components/settings/tabs/plugins/components";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import { classes } from "@utils/misc";
import { OptionType, Plugin, PluginSettingDef } from "@utils/types";
import { useEffect, useMemo, useRef, useState } from "@webpack/common";

import { CATEGORIES, categoryOf } from "../controller/categories";
import type { FeatureStatus, QolApi } from "../controller/ControlCenter";
import { QOL_NAME } from "../featureSettings";
import { DockTab, IconPicker } from "../utilities/DockTab";
import { DOCK_ICON_MAP, SonataIcon } from "../utilities/icons";
import { KeybindsTab } from "../utilities/KeybindsTab";
import { isUserPlugin, togglePlugin } from "../utilities/PluginsTab";
import { getAllPlugins, pluginHasSettingsUi } from "../utilities/shared";
import { accentColors, AccentMode, albumState, chosenOccasion, DEFAULT_ACCENT, GRADIENTS, HOLIDAYS, Occasion, occasionOn, onAlbumChange, SEASONS, upcomingHolidays, validHex } from "./accent";
import { Ambience } from "./Ambience";
import { formatBytes, totalFreed } from "./cache";
import { CacheCard } from "./CacheCard";
import { CHANGELOG, LATEST, newerThan } from "./changelog";
import { FeatureIcon, featureIconKey, featureIconsOn, hasPickedIcon, setFeatureIcon } from "./featureIcons";
import { Note3D } from "./Note3D";
import { DEFAULT_HOTKEY, DISCORD_OPTIONS, discordState, hasBackup, Impact, isOn, keyName, OPTIONS, prettyKey, putBack, setDiscord, setGaming, speedUp } from "./performance";
import { ProfilesButton } from "./Profiles";
import { layersOn, presetOf, readLayers } from "./scenes/presets";
import { unseenCount, UpdateLog } from "./UpdateLog";
import { Welcome, WhatsNew } from "./Welcome";
import { WindowStylePanel } from "./WindowStylePanel";

export const ACCENTS: { name: string; hex: string; }[] = [
    { name: "Sapphire", hex: "#3b82f6" },
    { name: "Iris", hex: "#6366f1" },
    { name: "Violet", hex: "#8b5cf6" },
    { name: "Orchid", hex: "#d946ef" },
    { name: "Rose", hex: "#f43f5e" },
    { name: "Ember", hex: "#f97316" },
    { name: "Amber", hex: "#f59e0b" },
    { name: "Emerald", hex: "#10b981" },
    { name: "Lagoon", hex: "#06b6d4" },
    { name: "Silver", hex: "#a1a1aa" },
];

type StatusFilter = "all" | "on" | "off" | "pending";

/** The features you pinned, in the order you pinned them. */
const readPinned = (raw: unknown): string[] => { try { const v = JSON.parse(typeof raw === "string" && raw ? raw : "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; } catch { return []; } };

const isPending = (s: FeatureStatus) => s === "apply-on" || s === "apply-off";
const isLit = (s: FeatureStatus) => s === "active" || s === "apply-on";

function statusLabel(api: QolApi, key: string, s: FeatureStatus) {
    switch (s) {
        case "active": return "On";
        case "off": return "Off";
        case "apply-on": return "On after reload";
        case "apply-off": return "Off after reload";
        case "paused": return `Paused — ${api.pausedBy(key) ?? "another plugin"} is on`;
        case "needs": return `Needs ${api.missingRequirement(key) ?? "another feature"}`;
    }
}

// ─── Small pieces ───

function GlassSwitch({ on, onChange, label, pending }: { on: boolean; onChange(v: boolean): void; label: string; pending?: boolean; }) {
    return (
        <button type="button" role="switch" aria-checked={on} aria-label={label}
            className={classes("sonata-switch", on && "sonata-switch-on", pending && "sonata-switch-pending")}
            onClick={e => { e.stopPropagation(); onChange(!on); }}>
            <span className="sonata-switch-knob" />
        </button>
    );
}

function Chevron({ open }: { open: boolean; }) {
    return (
        <svg className={classes("sonata-chevron", open && "sonata-chevron-open")} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function SearchBox({ value, onChange, inputRef, placeholder, wide }: { value: string; onChange(v: string): void; inputRef: React.RefObject<HTMLInputElement | null>; placeholder: string; wide?: boolean; }) {
    return (
        <div className={classes("sonata-searchbox", wide && "sonata-searchbox-wide")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input ref={inputRef} className="sonata-search" value={value} placeholder={placeholder} spellCheck={false}
                onChange={e => onChange(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Escape" && value) { e.stopPropagation(); onChange(""); } }} />
            {value
                ? <button type="button" className="sonata-clear" onClick={() => onChange("")} aria-label="Clear search">×</button>
                : <span className="sonata-kbd" aria-hidden>Ctrl F</span>}
        </div>
    );
}

/** A page's heading: a small label, a big wide title, and a word written huge and faint behind it. */
function PaneHead({ kicker, title, sub, giant, children }: { kicker: string; title: React.ReactNode; sub?: React.ReactNode; giant?: string; children?: React.ReactNode; }) {
    return (
        <header className="sonata-head">
            <div>
                <span className="sonata-kicker"><i />{kicker}</span>
                <h2 className="sonata-head-title">{title}</h2>
                {sub && <p className="sonata-head-sub">{sub}</p>}
            </div>
            {giant && <span className="sonata-head-giant" aria-hidden>{giant}</span>}
            {children && <div className="sonata-pane-tools">{children}</div>}
        </header>
    );
}

// ─── Features ───

function featureOptions(api: QolApi, key: string) {
    return api.optionKeys(key).filter(k => {
        const def = api.settings.def[k] as PluginSettingDef;
        return def.type !== OptionType.CUSTOM && !isSettingHidden(api.settings, def);
    });
}

/** Pick a different icon for a feature's card. */
function IconChooser({ featureKey, store }: { featureKey: string; store: any; }) {
    const [open, setOpen] = useState(false);
    const current = featureIconKey(store, featureKey);
    return (
        <div className="sonata-icon-choose">
            <div className="sonata-icon-choose-row">
                <span className="sonata-card-icon"><FeatureIcon store={store} featureKey={featureKey} /></span>
                <span className="sonata-field-hint">Icon on this card: {DOCK_ICON_MAP[current]?.label ?? current}</span>
                <span className="sonata-spacer" />
                {hasPickedIcon(store, featureKey) && <button type="button" className="sonata-btn" onClick={() => setFeatureIcon(store, featureKey, null)}>Reset</button>}
                <button type="button" className="sonata-btn" onClick={() => setOpen(o => !o)}>{open ? "Done" : "Change icon"}</button>
            </div>
            {open && <IconPicker selected={current} onSelect={k => setFeatureIcon(store, featureKey, k)} />}
        </div>
    );
}

function FeatureOptions({ api, featureKey, pluginSettings }: { api: QolApi; featureKey: string; pluginSettings: any; }) {
    const keys = featureOptions(api, featureKey);
    const name = api.name(featureKey);
    return (
        <div className="sonata-options" onClick={e => e.stopPropagation()}>
            <p className="sonata-options-desc">{api.description(featureKey)}</p>
            {api.hasWindow(featureKey) && (
                <button type="button" className="sonata-btn sonata-btn-accent" onClick={() => api.openWindow(featureKey)}>Open {name}</button>
            )}
            {!api.isOn(featureKey) ? (
                keys.length > 0 && <div className="sonata-options-note">Turn {name} on to change its options.</div>
            ) : keys.length === 0 ? (
                !api.hasWindow(featureKey) && <div className="sonata-options-note">Nothing to set up — it just works.</div>
            ) : (
                <div className="sonata-options-list">
                    {keys.map(k => {
                        const def = api.settings.def[k] as PluginSettingDef;
                        const Component = OptionComponentMap[def.type];
                        return (
                            <Component key={k} id={k} setting={def as any} pluginSettings={pluginSettings} definedSettings={api.settings}
                                closePluginSettings={() => { }}
                                onChange={(v: any) => {
                                    pluginSettings[k] = v;
                                    if ((def as any).restartNeeded) api.markOptionPending(featureKey);
                                }} />
                        );
                    })}
                </div>
            )}
            {featureIconsOn(pluginSettings) && <IconChooser featureKey={featureKey} store={pluginSettings} />}
        </div>
    );
}

/** Tilts the card under the mouse a little towards it, with a soft shine where the mouse is. Only that card, only while hovered. */
function tilt(e: React.PointerEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.classList.contains("sonata-card-open") || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--ry", `${((x - 0.5) * 7).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${((0.5 - y) * 7).toFixed(2)}deg`);
    el.style.setProperty("--sx", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--sy", `${(y * 100).toFixed(1)}%`);
}

function untilt(e: React.PointerEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    for (const k of ["--rx", "--ry", "--sx", "--sy"]) el.style.removeProperty(k);
}

function FeatureCard({ api, featureKey, open, onToggleOpen, pluginSettings, pinned, onPin }: {
    api: QolApi; featureKey: string; open: boolean; onToggleOpen(): void; pluginSettings: any; pinned: boolean; onPin(): void;
}) {
    const status = api.status(featureKey);
    const on = api.isOn(featureKey);
    const name = api.name(featureKey);
    const icons = featureIconsOn(pluginSettings);
    const expandable = icons || featureOptions(api, featureKey).length > 0 || api.hasWindow(featureKey);
    const label = statusLabel(api, featureKey, status);

    // The icon gives a little hop when the feature is switched on.
    const [pop, setPop] = useState(false);
    const wasOn = useRef(on);
    useEffect(() => {
        if (on && !wasOn.current) { setPop(true); const t = setTimeout(() => setPop(false), 700); wasOn.current = on; return () => clearTimeout(t); }
        wasOn.current = on;
    }, [on]);

    return (
        <div className={classes("sonata-card", isLit(status) && "sonata-card-lit", open && "sonata-card-open", isPending(status) && "sonata-card-pending", pop && "sonata-card-pop", pinned && "sonata-card-pinned")}
            onClick={expandable ? onToggleOpen : undefined} role={expandable ? "button" : undefined} tabIndex={expandable ? 0 : undefined}
            aria-expanded={expandable ? open : undefined} onPointerMove={tilt} onPointerLeave={untilt}
            onKeyDown={e => { if (expandable && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); onToggleOpen(); } }}>
            <div className="sonata-card-top">
                {icons && <span className="sonata-card-icon"><FeatureIcon store={pluginSettings} featureKey={featureKey} /></span>}
                <div className="sonata-card-name">{name}</div>
                <GlassSwitch on={on} pending={isPending(status)} onChange={v => api.setOn(featureKey, v)} label={`Turn ${name} ${on ? "off" : "on"}`} />
            </div>
            {!open && <p className="sonata-card-desc">{api.description(featureKey)}</p>}
            <div className="sonata-card-foot">
                <span className={classes("sonata-status", `sonata-status-${status}`)} title={label}><i /><span>{label}</span></span>
                {api.isInstant(featureKey) && (
                    <span className="sonata-instant" title="Switches on and off straight away, no reload">
                        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" fill="currentColor" /></svg>Instant
                    </span>
                )}
                <button type="button" className={classes("sonata-pin", pinned && "sonata-pin-on")} title={pinned ? "Unpin" : "Pin to the top"} aria-label={pinned ? `Unpin ${name}` : `Pin ${name} to the top`} aria-pressed={pinned}
                    onClick={e => { e.stopPropagation(); onPin(); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
                </button>
                {expandable && <span className="sonata-card-more">{open ? "Close" : "Options"}<Chevron open={open} /></span>}
            </div>
            {open && <FeatureOptions api={api} featureKey={featureKey} pluginSettings={pluginSettings} />}
        </div>
    );
}

/**
 * Turn on / off every feature you can see right now (so a category or search
 * narrows it). Turning off asks for a second click.
 */
function BulkSwitch({ api, keys }: { api: QolApi; keys: string[]; }) {
    const [confirm, setConfirm] = useState(false);
    useEffect(() => {
        if (!confirm) return;
        const t = setTimeout(() => setConfirm(false), 3500);
        return () => clearTimeout(t);
    }, [confirm]);
    const off = keys.filter(k => !api.isOn(k)).length;
    const on = keys.length - off;
    return (
        <div className="sonata-bulk">
            <button type="button" className="sonata-bulk-btn sonata-bulk-on" disabled={!off} title={`Turn on the ${off} shown that are off`} onClick={() => { api.setManyOn(keys, true); setConfirm(false); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                All on
            </button>
            <button type="button" className={classes("sonata-bulk-btn", "sonata-bulk-off", confirm && "sonata-bulk-confirm")} disabled={!on} title={`Turn off the ${on} shown that are on`}
                onClick={() => { if (!confirm) { setConfirm(true); return; } api.setManyOn(keys, false); setConfirm(false); }}>
                {confirm ? `Turn off ${on}?` : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>All off</>}
            </button>
        </div>
    );
}

function FeaturesTab({ api, s, query, setQuery, search, onSearchPlugins, onOpenLog, footer }: {
    api: QolApi; s: any; query: string; setQuery(q: string): void; search: React.RefObject<HTMLInputElement | null>; onSearchPlugins(): void; onOpenLog(): void; footer: React.ReactNode;
}) {
    const [category, setCategory] = useState<string>(() => lastCategory);
    const [status, setStatus] = useState<StatusFilter>("all");
    const [openKey, setOpenKey] = useState<string | null>(null);
    const pane = useRef<HTMLDivElement>(null);
    const toolbar = useRef<HTMLDivElement>(null);
    // Picking a category or filter brings the cards up under the toolbar.
    const toCards = () => { const p = pane.current, t = toolbar.current; if (p && t && p.scrollTop > t.offsetTop) p.scrollTo({ top: t.offsetTop - 6 }); };
    useEffect(() => { lastCategory = category; toCards(); }, [category, status]);

    const q = query.trim().toLowerCase();
    const passes = (key: string) => {
        const st = api.status(key);
        if (status === "on" && !isLit(st)) return false;
        if (status === "off" && isLit(st)) return false;
        if (status === "pending" && !isPending(st)) return false;
        return !q || `${api.name(key)} ${api.description(key)} ${api.originalName(key)} ${categoryOf(key).label}`.toLowerCase().includes(q);
    };
    // Everything that passes the search and status filter; the category narrows it further.
    const base = api.keys.filter(passes);
    const shown = category === "all" ? base : base.filter(k => categoryOf(k).id === category);
    const onCount = api.keys.filter(k => isLit(api.status(k))).length;
    const running = getAllPlugins().filter(p => isPluginEnabled(p.name) && p.name !== QOL_NAME).length;
    const cats = CATEGORIES.filter(c => api.keys.some(k => categoryOf(k).id === c.id));
    const pending = api.pendingCount();
    const latest = CHANGELOG[0];
    const unseen = unseenCount(s.sonataSeenVersion);

    // Pinned features: a row of your favourites above the categories.
    const pinned = readPinned(s.sonataPinned).filter(k => api.keys.includes(k));
    const togglePin = (k: string) => { const now = readPinned(s.sonataPinned); api.settings.store.sonataPinned = JSON.stringify(now.includes(k) ? now.filter(x => x !== k) : [...now, k]); };
    const card = (k: string, prefix = "") => (
        <FeatureCard key={prefix + k} api={api} featureKey={k} pluginSettings={s} open={openKey === prefix + k} pinned={pinned.includes(k)} onPin={() => togglePin(k)}
            onToggleOpen={() => setOpenKey(openKey === prefix + k ? null : prefix + k)} />
    );
    const showPinned = pinned.length > 0 && category === "all" && status === "all" && !q;

    return (
        <div className="sonata-pane" ref={pane}>
            <div className="sonata-pane-inner">
                <section className="sonata-hero">
                    <Note3D className="sonata-hero-note" />
                    <span className="sonata-hero-giant" aria-hidden>SONATA</span>
                    <div className="sonata-hero-text">
                        <span className="sonata-kicker"><i />Sonata · {api.keys.length} features</span>
                        <h1 className="sonata-display">
                            <span>Your Discord,</span>
                            <span>
                                <button type="button" className="sonata-hero-arrow" aria-label="Go to the features" title="Go to the features"
                                    onClick={() => { const t = toolbar.current; if (t) pane.current?.scrollTo({ top: t.offsetTop - 6, behavior: "smooth" }); }}>
                                    <svg viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 4v16m0 0-6-6m6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </button>
                                <b><em>composed</em></b>
                            </span>
                        </h1>
                        <p className="sonata-hero-lead">Every feature in one place. Switch on what you like, open a card for its options.</p>
                    </div>
                    <button type="button" className="sonata-hero-news" onClick={onOpenLog}>
                        <small>{unseen ? `${unseen} new update${unseen === 1 ? "" : "s"}` : "Latest update"}<span>{latest.date}</span></small>
                        <b>{latest.title}</b>
                        <span>See everything that changed →</span>
                    </button>
                    <div className="sonata-hero-foot">
                        <span className="sonata-badge"><b>{onCount}</b>of {api.keys.length} features on</span>
                        <span className="sonata-badge"><b>{running}</b>other plugins running</span>
                        {pending > 0 && <button type="button" className="sonata-badge" onClick={api.apply}><b>{pending}</b>waiting for a reload — apply now</button>}
                    </div>
                </section>

                <div className="sonata-toolbar" ref={toolbar}>
                    <SearchBox value={query} onChange={setQuery} inputRef={search} placeholder="Search features…" />
                    <div className="sonata-toolbar-cats" onWheel={e => { const el = e.currentTarget; if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY; }}>
                        <button type="button" className={classes("sonata-chip", category === "all" && "sonata-chip-on")} onClick={() => setCategory("all")}>All<small>{base.length}</small></button>
                        {cats.map(c => {
                            const n = base.filter(k => categoryOf(k).id === c.id).length;
                            return (
                                <button key={c.id} type="button" className={classes("sonata-chip", category === c.id && "sonata-chip-on")} onClick={() => setCategory(category === c.id ? "all" : c.id)}>
                                    <i style={{ background: c.color }} />{c.label}<small>{n}</small>
                                </button>
                            );
                        })}
                    </div>
                    <div className="sonata-toolbar-end">
                        <select className="sonata-select" value={status} onChange={e => setStatus(e.currentTarget.value as StatusFilter)} aria-label="Show">
                            <option value="all">Any status</option>
                            <option value="on">On</option>
                            <option value="off">Off</option>
                            <option value="pending">Waiting for reload</option>
                        </select>
                        <BulkSwitch api={api} keys={shown} />
                    </div>
                </div>

                {showPinned && (
                    <section className="sonata-group sonata-group-pinned">
                        <h3 className="sonata-group-head">
                            <span className="sonata-group-name"><span className="sonata-group-star" aria-hidden>★</span>Pinned</span>
                            <span className="sonata-group-count"><b>{pinned.filter(k => api.isOn(k)).length}</b> of {pinned.length} on</span>
                        </h3>
                        <div className="sonata-grid">{pinned.map(k => card(k, "pin:"))}</div>
                    </section>
                )}

                {cats.map(c => {
                    if (category !== "all" && category !== c.id) return null;
                    const keys = shown.filter(k => categoryOf(k).id === c.id);
                    if (!keys.length) return null;
                    const lit = keys.filter(k => api.isOn(k)).length;
                    return (
                        <section key={c.id} className="sonata-group">
                            <h3 className="sonata-group-head">
                                <span className="sonata-group-name"><i style={{ background: c.color }} />{c.label}</span>
                                <span className="sonata-group-count"><b>{lit}</b> of {keys.length} on</span>
                            </h3>
                            <div className="sonata-grid">
                                {keys.map(k => card(k))}
                            </div>
                        </section>
                    );
                })}
                {shown.length === 0 && (
                    <div className="sonata-empty">
                        No features match{q ? ` “${query.trim()}”` : ""}{category !== "all" ? " in this category" : ""}.
                        <div className="sonata-field-actions">
                            {category !== "all" && <button type="button" className="sonata-btn" onClick={() => setCategory("all")}>Search every category</button>}
                            {q && <button type="button" className="sonata-btn" onClick={onSearchPlugins}>Search plugins instead</button>}
                            {status !== "all" && <button type="button" className="sonata-btn" onClick={() => setStatus("all")}>Show any status</button>}
                        </div>
                    </div>
                )}
                {footer}
            </div>
        </div>
    );
}

// ─── Plugins ───

type PluginFilter = "running" | "all" | "user";

function PluginRow({ plugin, onChange }: { plugin: Plugin; onChange(): void; }) {
    const on = isPluginEnabled(plugin.name);
    const required = !!(plugin.required || plugin.isDependency);
    return (
        <div className={classes("sonata-prow", on && "sonata-prow-on")}>
            <div className="sonata-prow-text">
                <div className="sonata-prow-name">{plugin.name}{isUserPlugin(plugin) && <span className="sonata-tag">User</span>}</div>
                <div className="sonata-prow-desc" title={plugin.description}>{plugin.description}</div>
            </div>
            {pluginHasSettingsUi(plugin) && (
                <button type="button" className="sonata-icon-btn" title="Settings" aria-label={`${plugin.name} settings`} onClick={() => openPluginModal(plugin, onChange)}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" stroke="currentColor" strokeWidth="1.6" /></svg>
                </button>
            )}
            <GlassSwitch on={on} onChange={() => { if (!required) { togglePlugin(plugin); onChange(); } }} label={required ? `${plugin.name} is required` : `Turn ${plugin.name} ${on ? "off" : "on"}`} />
        </div>
    );
}

function PluginsTab({ query, setQuery, search }: { query: string; setQuery(q: string): void; search: React.RefObject<HTMLInputElement | null>; }) {
    const [filter, setFilter] = useState<PluginFilter>(() => query ? "all" : "running");
    const [tick, force] = useState(0);
    const [limit, setLimit] = useState(90);
    const all = useMemo(() => getAllPlugins().filter(p => p.name !== QOL_NAME && !p.hidden).sort((a, b) => a.name.localeCompare(b.name)), [tick]);
    const q = query.trim().toLowerCase();
    const list = all.filter(p => {
        if (filter === "running" && !isPluginEnabled(p.name)) return false;
        if (filter === "user" && !isUserPlugin(p)) return false;
        return !q || p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q);
    });
    const running = all.filter(p => isPluginEnabled(p.name)).length;

    return (
        <div className="sonata-pane">
            <div className="sonata-pane-inner">
                <PaneHead kicker="Plugins" title={<>Everything else <b>Equicord</b> runs</>} giant="PLUGINS" sub={`${running} of ${all.length} running. Plugins that change Discord's code apply after a reload.`}>
                    <SearchBox value={query} onChange={setQuery} inputRef={search} placeholder="Search plugins…" wide />
                    <div className="sonata-segment" role="tablist">
                        {([["running", "Running"], ["all", "All"], ["user", "User plugins"]] as [PluginFilter, string][]).map(([id, label]) => (
                            <button key={id} type="button" role="tab" aria-selected={filter === id} className={classes("sonata-seg", filter === id && "sonata-seg-on")} onClick={() => { setFilter(id); setLimit(90); }}>{label}</button>
                        ))}
                    </div>
                </PaneHead>
                <div className="sonata-plist">
                    {list.slice(0, limit).map(p => <PluginRow key={p.name} plugin={p} onChange={() => force(n => n + 1)} />)}
                </div>
                {list.length === 0 && <div className="sonata-empty">{q ? "No plugins match your search." : "Nothing here."}</div>}
                {list.length > limit && <button type="button" className="sonata-btn sonata-more" onClick={() => setLimit(l => l + 150)}>Show {Math.min(150, list.length - limit)} more</button>}
            </div>
        </div>
    );
}

// ─── Appearance ───

const ACCENT_MODES: [AccentMode, string][] = [["solid", "Solid"], ["gradient", "Gradient"], ["seasonal", "Seasons & holidays"], ["album", "Album art"]];

const shortDate = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Today's season or holiday (or the one you picked), every palette to pick from, and the switches. */
function SeasonalPanel({ store }: { store: any; }) {
    const holidays = store.sonataHolidays !== false, southern = !!store.sonataSouthern;
    const now = new Date();
    const following = !store.sonataOccasion || store.sonataOccasion === "current";
    const today = occasionOn(now, holidays, southern);
    const cur = chosenOccasion(store, now);
    const next = holidays ? upcomingHolidays(now, 3) : [];
    const chip = (colors: string[]) => <span className="sonata-occasion-chip" style={{ background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})` }} />;
    const pill = (o: Occasion) => (
        <button key={o.id} type="button" title={`Always use ${o.name}'s colours`} onClick={() => { store.sonataOccasion = o.id; }}
            className={classes("sonata-occasion-pill", !following && cur.id === o.id && "sonata-occasion-pill-on", following && today.id === o.id && "sonata-occasion-pill-today")}>
            {chip(o.colors)}{o.emoji} {o.name}
        </button>
    );
    return (
        <div className="sonata-field">
            <div className="sonata-occasion">
                <span className="sonata-occasion-emoji">{cur.emoji}</span>
                <div className="sonata-occasion-text">
                    <div className="sonata-occasion-name">{cur.name}</div>
                    <div className="sonata-field-hint">
                        {following
                            ? <>{cur.kind === "holiday" ? "Holiday colours" : "This season's colours"} until {shortDate(today.until)}, then they change by themselves.</>
                            : <>Always these colours — press <b>Current</b> to follow the date again.</>}
                    </div>
                </div>
                {chip(cur.colors)}
            </div>
            <div className="sonata-occasion-all">
                <button type="button" onClick={() => { store.sonataOccasion = "current"; }} title="Follow the date: today's holiday, or the season"
                    className={classes("sonata-occasion-pill", "sonata-occasion-current", following && "sonata-occasion-pill-on")}>
                    ✨ Current <span className="sonata-occasion-now">{today.emoji} {today.name}</span>
                </button>
                {SEASONS.map(pill)}
                {HOLIDAYS.map(pill)}
            </div>
            {next.length > 0 && <div className="sonata-field-hint">Coming up: {next.map(n => `${n.holiday.emoji} ${n.holiday.name} (${shortDate(n.start)})`).join(" · ")}</div>}
            <div className="sonata-occasion-switches">
                <label className="sonata-check"><input type="checkbox" checked={holidays} onChange={e => { store.sonataHolidays = e.currentTarget.checked; }} /> Holiday colours on holidays</label>
                <label className="sonata-check"><input type="checkbox" checked={southern} onChange={e => { store.sonataSouthern = e.currentTarget.checked; }} /> I live in the southern hemisphere</label>
            </div>
        </div>
    );
}

function AlbumStatus() {
    const [, tick] = useState(0);
    useEffect(() => onAlbumChange(() => tick(n => n + 1)), []);
    const a = albumState();
    if (!a.url) return <div className="sonata-field-hint">Nothing is playing on Spotify right now, so your Solid accent is used until something plays. Spotify needs to be connected to Discord.</div>;
    return (
        <div className="sonata-album">
            <img src={a.url} alt="" />
            <div>
                <div className="sonata-album-title">{a.title ?? "Now playing"}</div>
                <div className="sonata-field-hint">{a.colors ? "Sonata is using the colours of this cover." : "Couldn't read this cover's colours — using your Solid accent."}</div>
            </div>
            {a.colors && <div className="sonata-album-chips">{a.colors.map(c => <span key={c} style={{ background: c }} />)}</div>}
        </div>
    );
}

function Seg<T extends string | boolean>({ value, options, onChange }: { value: T; options: [T, string][]; onChange(v: T): void; }) {
    return (
        <div className="sonata-segment sonata-segment-left">
            {options.map(([id, label]) => (
                <button key={String(id)} type="button" className={classes("sonata-seg", value === id && "sonata-seg-on")} onClick={() => onChange(id)}>{label}</button>
            ))}
        </div>
    );
}

function AppearanceTab({ store }: { store: any; }) {
    const accent = validHex(store.aboutAmbientColor) ? store.aboutAmbientColor.trim() : DEFAULT_ACCENT;
    const mode: AccentMode = store.sonataAccentMode ?? "solid";
    const gradient: string = store.sonataGradient ?? "aurora";
    const gA = validHex(store.sonataGradientA) ? store.sonataGradientA : "#22d3ee";
    const gB = validHex(store.sonataGradientB) ? store.sonataGradientB : "#8b5cf6";
    const full = (hex: string) => hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join("")}` : hex;
    const preset = presetOf(store.sonataPreset);
    const layers = readLayers(store.sonataLayers);
    const on = layersOn(preset, layers);
    const setLayer = (id: string, value: boolean) => { store.sonataLayers = JSON.stringify({ ...layers, [preset.id]: { ...layers[preset.id], [id]: value } }); };

    return (
        <div className="sonata-pane">
            <div className="sonata-pane-inner">
                <PaneHead kicker="Appearance" title={<>Make it <b><em>yours</em></b></>} giant="COLOUR" sub="The accent colours the background and every highlight — Sonata's windows use it too." />
                <div className="sonata-cols">
                    <div className="sonata-panel sonata-appearance">
                        <h3 className="sonata-panel-title">Colour</h3>
                        <div className="sonata-field">
                            <div className="sonata-field-label">Accent style</div>
                            <Seg value={mode} options={ACCENT_MODES} onChange={v => { store.sonataAccentMode = v; }} />
                        </div>

                        {(mode === "solid" || mode === "album") && (
                            <div className="sonata-field">
                                <div className="sonata-field-label">{mode === "album" ? "When nothing is playing" : "Accent"}</div>
                                <div className="sonata-swatches">
                                    {ACCENTS.map(a => (
                                        <button key={a.hex} type="button" title={a.name} aria-label={a.name}
                                            className={classes("sonata-swatch", accent.toLowerCase() === a.hex && "sonata-swatch-on")} style={{ "--sw": a.hex } as React.CSSProperties}
                                            onClick={() => { store.aboutAmbientColor = a.hex; }} />
                                    ))}
                                    <label className={classes("sonata-swatch", "sonata-swatch-custom", !ACCENTS.some(a => a.hex === accent.toLowerCase()) && "sonata-swatch-on")} title="Pick any colour" style={{ "--sw": accent } as React.CSSProperties}>
                                        <input type="color" value={full(accent)} onChange={e => { store.aboutAmbientColor = e.currentTarget.value; }} aria-label="Custom accent colour" />
                                        <span>+</span>
                                    </label>
                                </div>
                            </div>
                        )}

                        {mode === "gradient" && (
                            <div className="sonata-field">
                                <div className="sonata-field-label">Gradient</div>
                                <div className="sonata-swatches">
                                    {GRADIENTS.map(g => (
                                        <button key={g.id} type="button" title={g.name} aria-label={g.name}
                                            className={classes("sonata-swatch", "sonata-swatch-grad", gradient === g.id && "sonata-swatch-on")} style={{ "--sw": g.a, "--sw2": g.b } as React.CSSProperties}
                                            onClick={() => { store.sonataGradient = g.id; }} />
                                    ))}
                                    <button type="button" title="Your own gradient" aria-label="Custom gradient"
                                        className={classes("sonata-swatch", "sonata-swatch-grad", "sonata-swatch-custom", gradient === "custom" && "sonata-swatch-on")} style={{ "--sw": gA, "--sw2": gB } as React.CSSProperties}
                                        onClick={() => { store.sonataGradient = "custom"; }}><span>+</span></button>
                                </div>
                                {gradient === "custom" && (
                                    <div className="sonata-gradient-edit">
                                        <label className="sonata-color"><input type="color" value={full(gA)} onChange={e => { store.sonataGradientA = e.currentTarget.value; }} /><span>From</span></label>
                                        <div className="sonata-gradient-bar" style={{ background: `linear-gradient(90deg, ${gA}, ${gB})` }} />
                                        <label className="sonata-color"><input type="color" value={full(gB)} onChange={e => { store.sonataGradientB = e.currentTarget.value; }} /><span>To</span></label>
                                        <button type="button" className="sonata-btn" onClick={() => { store.sonataGradientA = gB; store.sonataGradientB = gA; }}>⇄ Swap</button>
                                    </div>
                                )}
                            </div>
                        )}

                        {mode === "seasonal" && <SeasonalPanel store={store} />}
                        {mode === "album" && <AlbumStatus />}
                    </div>

                    <div className="sonata-col">
                        <div className="sonata-panel sonata-appearance">
                            <h3 className="sonata-panel-title">Background</h3>
                            <div className="sonata-field">
                                <div className="sonata-field-label">Layers</div>
                                <div className="sonata-layers">
                                    {preset.layers.map(l => (
                                        <button key={l.id} type="button" role="switch" aria-checked={on.has(l.id)} className={classes("sonata-layer", on.has(l.id) && "sonata-layer-on")} onClick={() => setLayer(l.id, !on.has(l.id))}>
                                            <i />{l.name}
                                        </button>
                                    ))}
                                </div>
                                <div className="sonata-field-hint">{preset.blurb}</div>
                            </div>
                            <div className="sonata-field">
                                <div className="sonata-field-label">Motion</div>
                                <Seg value={store.sonataAnimate !== false} options={[[true, "On"], [false, "Off"]]} onChange={v => { store.sonataAnimate = v; }} />
                                <div className="sonata-field-hint">The colour wash drifts, the note turns and rings spread out from it. Off holds it all still.</div>
                            </div>
                            <div className="sonata-field">
                                <div className="sonata-field-label">Brightness</div>
                                <Seg value={!!store.sonataInverted} options={[[false, "Dark"], [true, "Light"]]} onChange={v => { store.sonataInverted = v; }} />
                                <div className="sonata-field-hint">Light gives Sonata a pale canvas with dark text; your colour stays the same.</div>
                            </div>
                        </div>
                        <div className="sonata-panel sonata-appearance">
                            <h3 className="sonata-panel-title">Feature icons</h3>
                            <div className="sonata-field">
                                <Seg value={featureIconsOn(store)} options={[[true, "Show"], [false, "Hide"]]} onChange={v => { store.sonataFeatureIcons = v; }} />
                                <div className="sonata-field-hint">An icon on each feature's card here and on the Quality of Life page. Open a feature's card to pick a different one.</div>
                            </div>
                        </div>
                        <WindowStylePanel store={store} />
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Performance ───

const IMPACT_LABEL: Record<Impact, string> = { big: "Big boost", medium: "Helps", small: "Small boost" };

/** One option as a small tile: name, how much it helps, a switch — and its full explanation on hover. */
function PerfTile({ title, detail, impact, on, recommended, onChange }: { title: string; detail: string; impact: Impact; on: boolean; recommended?: boolean; onChange(v: boolean): void; }) {
    return (
        <label className={classes("sonata-ptile", on && "sonata-ptile-on")} title={detail}>
            <span className="sonata-ptile-text">
                <span className="sonata-ptile-name">{title}</span>
                <span className="sonata-ptile-meta">
                    <i className={`sonata-ptile-dot sonata-perf-${impact}`} />{IMPACT_LABEL[impact]}{recommended && <span className="sonata-ptile-rec"> · recommended</span>}
                </span>
            </span>
            <input type="checkbox" checked={on} onChange={e => onChange(e.currentTarget.checked)} />
            <span className="sonata-perf-switch" aria-hidden />
        </label>
    );
}

function HotkeyField({ value, onChange }: { value: string; onChange(k: string): void; }) {
    const [recording, setRecording] = useState(false);
    return (
        <button type="button" className={classes("sonata-btn", recording && "sonata-btn-light")} title="Gaming mode hotkey (works while Discord is focused) — click, then press keys"
            onClick={() => setRecording(true)} onBlur={() => setRecording(false)}
            onKeyDown={e => {
                if (!recording) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.key === "Escape") { setRecording(false); return; }
                const k = keyName(e.nativeEvent);
                if (!k || ["ctrl", "alt", "shift", "meta"].includes(k)) return;
                onChange(k);
                setRecording(false);
            }}>
            {recording ? "Press keys…" : `⌨ ${prettyKey(value || DEFAULT_HOTKEY)}`}
        </button>
    );
}

const PAUSE_MODES: [string, string][] = [["off", "Never"], ["hidden", "When minimised"], ["unfocused", "When another window is in front"]];
const BIG_SERVERS: [number, string][] = [[0, "Never"], [5000, "With 5,000+ members"], [20000, "With 20,000+ members"], [100000, "With 100,000+ members"]];

type Mode = "normal" | "light" | "gaming";
const MODES: { id: Mode; icon: string; name: string; sub: string; }[] = [
    { id: "normal", icon: "🎵", name: "Normal", sub: "Your own settings" },
    { id: "light", icon: "⚡", name: "Light", sub: "Everything recommended" },
    { id: "gaming", icon: "🎮", name: "Gaming", sub: "Light, and pauses while you play" },
];

function PerformanceTab({ store }: { store: any; }) {
    const [, bump] = useState(0);
    const refresh = () => bump(n => n + 1);
    const [cleanup, setCleanup] = useState(false);
    const mode: Mode = store.perfGaming ? "gaming" : hasBackup() ? "light" : "normal";
    const pause = store.perfPause ?? "off";
    const big = Number(store.perfBigServer) || 0;
    const onCount = OPTIONS.filter(o => isOn(o.key)).length + DISCORD_OPTIONS.filter(o => discordState(o.key)).length;
    const total = OPTIONS.length + DISCORD_OPTIONS.length;

    const pick = (m: Mode) => {
        if (m === mode) return;
        if (m === "gaming") setGaming(true);
        else if (mode === "gaming") { setGaming(false); if (m === "light") speedUp(); }
        else if (m === "light") speedUp();
        else putBack();
        refresh();
    };

    return (
        <div className="sonata-pane">
            <div className="sonata-pane-inner">
                <PaneHead kicker="Performance" title={<>Make it <b><em>faster</em></b></>} giant="SPEED"
                    sub="Pick a mode, or switch single things off. Nothing here changes how Discord works — only how much it animates and redraws." />

                <div className="sonata-modes" role="radiogroup" aria-label="Performance mode">
                    {MODES.map(m => (
                        <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={classes("sonata-mode", mode === m.id && "sonata-mode-on", `sonata-mode-${m.id}`)} onClick={() => pick(m.id)}>
                            <span className="sonata-mode-icon">{m.icon}</span>
                            <span className="sonata-mode-text"><b>{m.name}</b><small>{m.sub}</small></span>
                        </button>
                    ))}
                    <div className="sonata-modes-end">
                        <span className="sonata-field-hint">{onCount} of {total} savings on</span>
                        <HotkeyField value={store.perfGamingKey} onChange={k => { store.perfGamingKey = k; refresh(); }} />
                    </div>
                </div>

                <section className="sonata-panel sonata-psection">
                    <h3 className="sonata-panel-title">Drawing <small>Sonata turns these off for you</small></h3>
                    <div className="sonata-ptiles">
                        {OPTIONS.map(o => <PerfTile key={o.key} title={o.title} detail={o.detail} impact={o.impact} recommended={o.recommended} on={isOn(o.key)} onChange={v => { store[o.key] = v; refresh(); }} />)}
                    </div>
                    <h3 className="sonata-panel-title">Discord's own settings <small>the same switches as in Discord's settings</small></h3>
                    <div className="sonata-ptiles">
                        {DISCORD_OPTIONS.map(o => <PerfTile key={o.key} title={o.title} detail={o.detail} impact={o.impact} recommended={o.recommended} on={discordState(o.key)} onChange={v => { setDiscord(o.key, v); setTimeout(refresh, 150); }} />)}
                    </div>
                </section>

                <section className="sonata-panel sonata-psection">
                    <h3 className="sonata-panel-title">In the background</h3>
                    <div className="sonata-pbg">
                        <label className="sonata-pbg-item" title="Freezes every animation in Discord (and Sonata) while you're not looking, and picks up where it left off. Videos and voice keep playing.">
                            <span className="sonata-ptile-name">Pause animations <i className="sonata-perf-impact sonata-perf-big">Big boost</i></span>
                            <select className="sonata-select" value={pause} onChange={e => { store.perfPause = e.currentTarget.value; refresh(); }}>
                                {PAUSE_MODES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                            </select>
                        </label>
                        <label className="sonata-pbg-item" title="In servers with tens of thousands of people the member list redraws constantly. Hide it in servers this big.">
                            <span className="sonata-ptile-name">Hide the member list in huge servers <i className="sonata-perf-impact sonata-perf-big">Big boost</i></span>
                            <select className="sonata-select" value={big} onChange={e => { store.perfBigServer = Number(e.currentTarget.value); refresh(); }}>
                                {BIG_SERVERS.map(([n, label]) => <option key={n} value={n}>{label}</option>)}
                            </select>
                        </label>
                        <PerfTile title="Start features after Discord has loaded" impact="medium"
                            detail="Features that don't change Discord's code wait until Discord is idle after start-up, then start a few at a time, so Discord opens faster. Takes effect next time Discord starts."
                            on={!!store.perfDeferStart} onChange={v => { store.perfDeferStart = v; refresh(); }} />
                    </div>
                </section>

                <section className={classes("sonata-panel", "sonata-psection", "sonata-pclean", cleanup && "sonata-pclean-open")}>
                    <button type="button" className="sonata-pclean-head" onClick={() => setCleanup(c => !c)} aria-expanded={cleanup}>
                        <span className="sonata-mode-icon">🧹</span>
                        <span className="sonata-mode-text"><b>Disk space & memory</b><small>Free up space Discord keeps on disk, and see how much memory it uses{totalFreed() > 0 ? ` · ${formatBytes(totalFreed())} freed so far` : ""}</small></span>
                        <span className="sonata-pclean-open-label">{cleanup ? "Close" : "Open"}<Chevron open={cleanup} /></span>
                    </button>
                    {cleanup && <CacheCard store={store} />}
                </section>
            </div>
        </div>
    );
}

// ─── Screen ───

type Tab = "features" | "plugins" | "dock" | "keybinds" | "appearance" | "performance";

const TABS: [Tab, string][] = [["features", "Features"], ["plugins", "Plugins"], ["dock", "Dock"], ["keybinds", "Keybinds"], ["appearance", "Appearance"], ["performance", "Performance"]];

// Remembered while Discord is open, so Sonata opens where you left it.
let lastTab: Tab = "features";
let lastCategory = "all";

/** The wide display font for headings (Equicord allows Google Fonts); body text keeps Discord's font. */
function loadDisplayFont() {
    if (document.getElementById("sonata-display-font")) return;
    const link = document.createElement("link");
    link.id = "sonata-display-font";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Unbounded:wght@300;500;700;800&display=swap";
    document.head.appendChild(link);
}

export function SonataScreen({ api, onClose }: { api: QolApi; onClose?(): void; }) {
    const s = api.settings.use() as any;
    const store = api.settings.store as any;
    const [tab, setTabState] = useState<Tab>(lastTab);
    const setTab = (t: Tab) => { lastTab = t; setTabState(t); };
    const [query, setQuery] = useState("");
    const search = useRef<HTMLInputElement>(null);

    const accentMode: AccentMode = s.sonataAccentMode ?? "solid";

    useEffect(loadDisplayFont, []);

    // Album art changes as songs change; seasons change at midnight.
    const [, albumTick] = useState(0);
    useEffect(() => onAlbumChange(() => albumTick(n => n + 1)), []);
    useEffect(() => {
        if (accentMode !== "seasonal") return;
        const t = setInterval(() => albumTick(n => n + 1), 60_000);
        return () => clearInterval(t);
    }, [accentMode]);

    const [accentA, accentB] = accentColors(s);
    const on = layersOn(presetOf(s.sonataPreset), readLayers(s.sonataLayers));
    const pending = api.pendingCount();
    const [welcome, setWelcome] = useState(() => !s.sonataWelcomed);
    const [news, setNews] = useState(() => s.sonataWelcomed ? newerThan(s.sonataSeenVersion) : []);
    const closeNews = () => { store.sonataSeenVersion = LATEST; setNews([]); };
    const [log, setLog] = useState(false);
    const openLog = () => { setNews([]); setLog(true); };
    const closeLog = () => { setLog(false); store.sonataSeenVersion = LATEST; };
    const unseen = unseenCount(s.sonataSeenVersion);
    const onCount = api.keys.filter(k => isLit(api.status(k))).length;

    // Ctrl+F or "/" goes to search (on the Features tab unless you're on Plugins).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.key === "f" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName ?? ""))) {
                e.preventDefault();
                if (lastTab !== "features" && lastTab !== "plugins") setTab("features");
                setTimeout(() => search.current?.focus(), 0);
            }
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
    }, []);

    const footer = (
        <footer className="sonata-footer">
            <SonataIcon width={13} height={13} /> Sonata · by aiqen
            <span> · <button type="button" className="sonata-link" onClick={openLog}>Update log</button></span>
            <span> · <button type="button" className="sonata-link" onClick={() => setWelcome(true)}>Welcome tour</button></span>
            {onClose && <span> · Esc to close</span>}
        </footer>
    );

    return (
        <div className={classes("sonata", "sonata-preset-minimal", accentA !== accentB && "sonata-duo", s.sonataInverted && "sonata-inverted", s.sonataAnimate === false && "sonata-still")}
            style={{ "--sn-accent": accentA, "--sn-accent-2": accentB } as React.CSSProperties}>
            <div className="sonata-frame">
                <Ambience on={on} />
                {welcome && <Welcome api={api} store={store} accents={ACCENTS} onDone={() => { setWelcome(false); store.sonataSeenVersion = LATEST; }} />}
                {!welcome && !log && news.length > 0 && <WhatsNew entries={news} onClose={closeNews} />}
                {log && <UpdateLog seen={s.sonataSeenVersion} onClose={closeLog} store={store} />}

                <header className="sonata-top">
                    <button type="button" className="sonata-brand" title="Features" onClick={() => setTab("features")}>
                        <SonataIcon width={20} height={20} /><span>Sonata</span>
                    </button>
                    <nav className="sonata-tabs" role="tablist" aria-label="Sonata">
                        {TABS.map(([id, label]) => (
                            <button key={id} type="button" role="tab" aria-selected={tab === id} className={classes("sonata-tab", tab === id && "sonata-tab-on")} onClick={() => setTab(id)}>
                                {label}{id === "features" && <b title={`${onCount} of ${api.keys.length} on`}>{onCount}</b>}
                            </button>
                        ))}
                    </nav>
                    <div className="sonata-corner">
                        {pending > 0 && <button type="button" className="sonata-btn sonata-btn-light" onClick={api.apply}>Apply {pending} · reload</button>}
                        <ProfilesButton api={api} raw={s.sonataProfiles} write={json => { store.sonataProfiles = json; }} />
                        <button type="button" className="sonata-updates" title="Every Sonata update, newest first" onClick={openLog}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 8v4l2.5 2.5M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5v4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            Updates
                            {unseen > 0 && <span className="sonata-updates-count">{unseen}</span>}
                        </button>
                        {onClose && (
                            <button type="button" className="sonata-close" aria-label="Close Sonata" title="Close (Esc)" onClick={onClose}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                            </button>
                        )}
                    </div>
                </header>

                <div className="sonata-body">
                    {tab === "features" && <FeaturesTab api={api} s={s} query={query} setQuery={setQuery} search={search} onSearchPlugins={() => setTab("plugins")} onOpenLog={openLog} footer={footer} />}
                    {tab === "plugins" && <PluginsTab query={query} setQuery={setQuery} search={search} />}
                    {tab === "dock" && (
                        <div className="sonata-pane">
                            <div className="sonata-pane-inner sonata-pane-narrow">
                                <PaneHead kicker="Dock" title={<>The <b>dock</b></>} giant="DOCK" sub="Buttons under your user panel. Sonata's own button always sits first." />
                                <div className="sonata-panel sonata-legacy"><DockTab settings={store} /></div>
                                {footer}
                            </div>
                        </div>
                    )}
                    {tab === "keybinds" && (
                        <div className="sonata-pane">
                            <div className="sonata-pane-inner sonata-pane-narrow">
                                <PaneHead kicker="Keybinds" title={<>Shortcuts for <b>everything</b></>} giant="KEYS" sub="Give any on/off setting a key combination." />
                                <div className="sonata-panel sonata-legacy"><KeybindsTab /></div>
                                {footer}
                            </div>
                        </div>
                    )}
                    {tab === "appearance" && <AppearanceTab store={store} />}
                    {tab === "performance" && <PerformanceTab store={store} />}
                </div>
            </div>
        </div>
    );
}
