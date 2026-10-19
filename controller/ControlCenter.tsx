/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The QOL page. Deliberately built in the same style as ChannelSettings'
// page (header, underlined tab bar, search + filter chips, plugin cards with
// a cog and a switch) so the two feel like one set — with a quiet
// dust/star particle background instead of ChannelSettings' glow.

import "./styles.css";

import { isSettingHidden } from "@api/PluginManager";
import { OptionComponentMap } from "@components/settings/tabs/plugins/components";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { DefinedSettings, OptionType, PluginSettingDef } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, ScrollerThin, TextInput, useMemo, useState } from "@webpack/common";

import { FeatureIcon, featureIconsOn } from "../sonata/featureIcons";
import { UtilitiesView } from "../utilities/UtilitiesView";
import { getChannelSettingsAccent } from "./accent";
import { CATEGORIES, categoryOf } from "./categories";
import { Particles } from "./Particles";

const cl = classNameFactory("vc-qolcc-");

export type FeatureStatus = "active" | "off" | "apply-on" | "apply-off" | "paused" | "needs";

/** What the page needs from QOL (index.tsx builds this). */
export interface QolApi {
    keys: string[];
    name(key: string): string;
    description(key: string): string;
    originalName(key: string): string;
    status(key: string): FeatureStatus;
    isOn(key: string): boolean;
    setOn(key: string, on: boolean): void;
    /** Switch many at once, with one message instead of one per feature. */
    setManyOn(keys: string[], on: boolean): void;
    /** Switches on/off immediately (no patches), instead of on the next reload. */
    isInstant(key: string): boolean;
    /** Display name of a required feature that isn't running, if any. */
    missingRequirement(key: string): string | undefined;
    /** QOL setting keys (prefixed) that belong to this feature. */
    optionKeys(key: string): string[];
    /** The enabled plugin a paused feature is waiting for. */
    pausedBy(key: string): string | undefined;
    /** The feature has its own window and is running. */
    hasWindow(key: string): boolean;
    openWindow(key: string): void;
    settings: DefinedSettings<any, any>;
    /** An option marked restartNeeded was changed. */
    markOptionPending(key: string): void;
    pendingCount(): number;
    /** Reload Discord's window so pending changes take effect. */
    apply(): void;
    autoApply(): boolean;
    setAutoApply(on: boolean): void;
}

type StatusFilter = "all" | "on" | "off" | "pending";

const STATUS_FILTERS: { id: StatusFilter; label: string; }[] = [
    { id: "all", label: "All" },
    { id: "on", label: "Enabled" },
    { id: "off", label: "Disabled" },
    { id: "pending", label: "Waiting for reload" },
];

const isPending = (s: FeatureStatus) => s === "apply-on" || s === "apply-off";

function statusText(api: QolApi, key: string, status: FeatureStatus) {
    switch (status) {
        case "active": return "Enabled";
        case "off": return "Disabled";
        case "apply-on": return "On after reload";
        case "apply-off": return "Off after reload";
        case "paused": return `Paused — the built-in ${api.pausedBy(key) ?? api.originalName(key)} plugin is on`;
        case "needs": return `Needs ${api.missingRequirement(key)}`;
    }
}

/** Same accent as ChannelSettings (its About tab color), so both pages match. */
function useAccent(): string | undefined {
    return getChannelSettingsAccent();
}

// ─── Pieces ───

function CogIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
        </svg>
    );
}

function OpenIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 9V3m0 0h-6m6 0-9 9M10 3H7.8C6.12 3 5.28 3 4.64 3.33a3 3 0 0 0-1.31 1.31C3 5.28 3 6.12 3 7.8v8.4c0 1.68 0 2.52.33 3.16a3 3 0 0 0 1.31 1.31c.64.33 1.48.33 3.16.33h8.4c1.68 0 2.52 0 3.16-.33a3 3 0 0 0 1.31-1.31c.33-.64.33-1.48.33-3.16V14" />
        </svg>
    );
}

function Toggle({ on, pending, onChange, label, small }: { on: boolean; pending?: boolean; onChange(v: boolean): void; label: string; small?: boolean; }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            className={classes(cl("toggle"), on && cl("toggle-on"), pending && cl("toggle-pending"), small && cl("toggle-small"))}
            onClick={e => { e.stopPropagation(); onChange(!on); }}
        >
            <span className={cl("toggle-knob")} />
        </button>
    );
}

function hasVisibleOptions(api: QolApi, key: string) {
    return api.optionKeys(key).some(k => (api.settings.def[k] as PluginSettingDef).type !== OptionType.CUSTOM);
}

// ─── Options window (the cog) ───

// Uses Discord's current Modal (the same one built-in plugins like Server
// Info use) — the old ModalRoot/ModalHeader pieces are deprecated.
function OptionsModal({ api, featureKey, modalProps }: { api: QolApi; featureKey: string; modalProps: RenderModalProps; }) {
    const pluginSettings = api.settings.use();
    const name = api.name(featureKey);
    const on = api.isOn(featureKey);

    const optionKeys = api.optionKeys(featureKey).filter(k => {
        const def = api.settings.def[k] as PluginSettingDef;
        return def.type !== OptionType.CUSTOM && !isSettingHidden(api.settings, def);
    });

    return (
        <Modal
            {...modalProps}
            size="md"
            title={name}
            subtitle={`${categoryOf(featureKey).label} · ${statusText(api, featureKey, api.status(featureKey))}`}
        >
            <div className={cl("modal-body")}>
                <p className={cl("modal-desc")}>{api.description(featureKey)}</p>
                {!on ? (
                    <div className={cl("modal-empty")}>Turn {name} on to change its options.</div>
                ) : optionKeys.length === 0 ? (
                    <div className={cl("modal-empty")}>Nothing to configure — it just works.</div>
                ) : (
                    <div className={cl("modal-options")}>
                        {optionKeys.map(k => {
                            const def = api.settings.def[k] as PluginSettingDef;
                            const Component = OptionComponentMap[def.type];
                            return (
                                <Component
                                    key={k}
                                    id={k}
                                    setting={def as any}
                                    pluginSettings={pluginSettings as any}
                                    definedSettings={api.settings}
                                    closePluginSettings={modalProps.onClose}
                                    onChange={(v: any) => {
                                        (pluginSettings as any)[k] = v;
                                        if ((def as any).restartNeeded) api.markOptionPending(featureKey);
                                    }}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
        </Modal>
    );
}

export function openOptions(api: QolApi, featureKey: string) {
    openModal(modalProps => <OptionsModal api={api} featureKey={featureKey} modalProps={modalProps} />);
}

// ─── Feature card (same shape as ChannelSettings' plugin card) ───

function FeatureCard({ api, featureKey }: { api: QolApi; featureKey: string; }) {
    const status = api.status(featureKey);
    const on = api.isOn(featureKey);
    const name = api.name(featureKey);
    const enabledLook = status === "active" || status === "apply-on";

    return (
        <div className={classes(cl("card"), enabledLook ? cl("card-enabled") : cl("card-disabled"))}>
            {featureIconsOn(api.settings.store) && <span className={cl("card-icon")}><FeatureIcon store={api.settings.store} featureKey={featureKey} /></span>}
            <div className={cl("card-info")}>
                <div className={cl("card-name")}>
                    {name}
                    {api.isInstant(featureKey) && <span className={cl("card-badge")} title="Switches on and off without a reload">Instant</span>}
                </div>
                <div className={cl("card-desc")}>{api.description(featureKey)}</div>
                <div className={classes(cl("card-status"), cl(`status-${status}`))}>
                    <span className={cl("status-dot")} />
                    {statusText(api, featureKey, status)}
                </div>
            </div>
            <div className={cl("card-actions")}>
                {api.hasWindow(featureKey) && (
                    <button
                        type="button"
                        className={cl("card-cog")}
                        onClick={() => api.openWindow(featureKey)}
                        aria-label={`Open ${name}`}
                        title={`Open ${name}`}
                    >
                        <OpenIcon />
                    </button>
                )}
                {hasVisibleOptions(api, featureKey) && (
                    <button
                        type="button"
                        className={cl("card-cog")}
                        onClick={() => openOptions(api, featureKey)}
                        aria-label={`${name} options`}
                        title="Options"
                    >
                        <CogIcon />
                    </button>
                )}
                <Toggle
                    on={on}
                    pending={isPending(status)}
                    onChange={v => api.setOn(featureKey, v)}
                    label={`Turn ${name} ${on ? "off" : "on"}`}
                />
            </div>
        </div>
    );
}

// ─── Page ───

export type PageView = "qol" | "utilities";

const VIEWS: { id: PageView; label: string; }[] = [
    { id: "qol", label: "Quality of Life" },
    { id: "utilities", label: "Plugin Utilities" },
];

export function ControlCenter({ api, initialView = "qol" }: { api: QolApi; initialView?: PageView; }) {
    // Re-render on any Sonata setting change (switches, options, accent...).
    api.settings.use();
    const accent = useAccent();
    const [view, setView] = useState<PageView>(initialView);

    const [category, setCategory] = useState<string>("all");
    const [filter, setFilter] = useState<StatusFilter>("all");
    const [query, setQuery] = useState("");

    const statuses = Object.fromEntries(api.keys.map(k => [k, api.status(k)] as const));
    const enabledCount = api.keys.filter(k => statuses[k] === "active").length;
    const pending = api.pendingCount();
    const autoApply = api.autoApply();

    const counts = useMemo(() => {
        const c: Record<string, number> = { all: api.keys.length };
        for (const k of api.keys) c[categoryOf(k).id] = (c[categoryOf(k).id] ?? 0) + 1;
        return c;
    }, [api.keys]);

    const q = query.trim().toLowerCase();
    const visible = api.keys.filter(k => {
        if (category !== "all" && categoryOf(k).id !== category) return false;
        if (filter === "on" && !api.isOn(k)) return false;
        if (filter === "off" && api.isOn(k)) return false;
        if (filter === "pending" && !isPending(statuses[k])) return false;
        if (q && !`${api.name(k)} ${api.originalName(k)} ${api.description(k)}`.toLowerCase().includes(q)) return false;
        return true;
    });

    const setAll = (on: boolean) => {
        for (const k of visible) if (api.isOn(k) !== on) api.setOn(k, on);
    };
    const narrowed = category !== "all" || filter !== "all" || !!q;

    return (
        <div className={cl("page")} style={accent ? ({ "--vc-qolcc-accent": accent, "--vc-chsettings-accent": accent } as React.CSSProperties) : undefined}>
            <Particles className={cl("particles")} />

            <div className={cl("header")}>
                <div className={cl("header-text")}>
                    <div className={cl("title-main")}>{view === "qol" ? "Quality of Life" : "Plugin Utilities"}</div>
                    <div className={cl("title-sub")}>
                        {view === "qol" ? (
                            <>
                                {enabledCount} of {api.keys.length} features enabled
                                {pending > 0 && <> · <span className={cl("title-pending")}>{pending} waiting for a reload</span></>}
                            </>
                        ) : "Manage your plugins, keybinds, dock, and more"}
                    </div>
                </div>
                <div className={cl("tagline")}>Thoughtful refinements for a better Discord experience.</div>
                <div className={cl("header-actions")}>
                {view === "qol" && <div className={cl("bulk")}>
                    <button type="button" className={cl("bulk-btn")} onClick={() => setAll(true)} disabled={!visible.length}
                        title={narrowed ? "Turn on everything shown below" : "Turn every feature on"}>
                        All on
                    </button>
                    <button type="button" className={cl("bulk-btn")} onClick={() => setAll(false)} disabled={!visible.length}
                        title={narrowed ? "Turn off everything shown below" : "Turn every feature off"}>
                        All off
                    </button>
                </div>}
                <div className={cl("view-switch")} role="tablist" aria-label="Sonata section">
                    {VIEWS.map(v => (
                        <button
                            key={v.id}
                            type="button"
                            role="tab"
                            aria-selected={view === v.id}
                            className={classes(cl("view-btn"), view === v.id && cl("view-btn-active"))}
                            onClick={() => setView(v.id)}
                        >
                            {v.label}
                        </button>
                    ))}
                </div>
                </div>
            </div>

            {view === "utilities" ? <UtilitiesView store={api.settings.store as any} /> : <>

            <div className={cl("tab-bar")} role="tablist" aria-label="Categories">
                {[{ id: "all", label: "All" }, ...CATEGORIES.filter(c => counts[c.id])].map(c => (
                    <button
                        key={c.id}
                        type="button"
                        role="tab"
                        aria-selected={category === c.id}
                        className={classes(cl("tab"), category === c.id && cl("tab-active"))}
                        onClick={() => setCategory(c.id)}
                    >
                        {c.label}
                        <span className={cl("tab-count")}>{counts[c.id]}</span>
                    </button>
                ))}
            </div>

            <ScrollerThin fade className={cl("scroller")}>
                <div className={cl("content")}>
                    <div className={cl("toolbar")}>
                        <div className={cl("search")}>
                            <TextInput value={query} onChange={setQuery} placeholder="Search features..." />
                        </div>
                    </div>
                    <div className={cl("filters")} role="tablist" aria-label="Status">
                        {STATUS_FILTERS.map(f => (
                            <button
                                key={f.id}
                                type="button"
                                role="tab"
                                aria-selected={filter === f.id}
                                className={classes(cl("filter-chip"), filter === f.id && cl("filter-chip-active"))}
                                onClick={() => setFilter(f.id)}
                            >
                                {f.label}
                                {f.id === "pending" && pending > 0 && <span className={cl("filter-badge")}>{pending}</span>}
                            </button>
                        ))}
                    </div>

                    {visible.length ? (
                        <div className={cl("grid")}>
                            {visible.map(k => <FeatureCard key={k} api={api} featureKey={k} />)}
                        </div>
                    ) : (
                        <div className={cl("empty")}>No features match your filters.</div>
                    )}

                    <div className={classes(cl("apply-bar"), pending > 0 && cl("apply-bar-pending"))}>
                        <span className={cl("apply-dot")} />
                        <span className={cl("apply-text")}>
                            {pending > 0
                                ? <>{pending} {pending === 1 ? "change" : "changes"} ready — a quick reload applies {pending === 1 ? "it" : "them"}, no full restart.</>
                                : "Everything's applied."}
                        </span>
                        <label className={cl("auto")} title="Reload automatically right after you switch a feature that needs it">
                            <Toggle small on={autoApply} onChange={api.setAutoApply} label="Auto-apply" />
                            Auto-apply
                        </label>
                        {pending > 0 && <button type="button" className={cl("apply-btn")} onClick={api.apply}>Apply now</button>}
                    </div>
                </div>
            </ScrollerThin>
            </>}
        </div>
    );
}
