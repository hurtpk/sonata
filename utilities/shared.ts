/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import { classNameFactory } from "@utils/css";
import { OptionType, Plugin } from "@utils/types";

import Plugins, { PluginMeta } from "~plugins";

import { addDockButton, refreshDock, removeDockButton } from "./dock";
import { DEFAULT_DOCK_ICON_KEY, DOCK_ICON_MAP } from "./icons";

export const cl = classNameFactory("vc-chsettings-");

export const MY_DISCORD_ID = "779172192461783110";

/** Every plugin registered in the client, regardless of author or enabled state. */
export function getAllPlugins(): Plugin[] {
    return Object.values(Plugins).sort((a, b) => a.name.localeCompare(b.name));
}

/** Every plugin that is currently enabled, regardless of who wrote it. */
export function getEnabledPlugins(): Plugin[] {
    return getAllPlugins().filter(p => isPluginEnabled(p.name));
}

export function findPlugin(name: string): Plugin | undefined {
    return (Plugins as Record<string, Plugin>)[name];
}

export interface SettingEntry {
    plugin: Plugin;
    key: string;
    label: string;
    default: string;
}

export function parseStringArray(raw: string | undefined): string[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(x => typeof x === "string") : [];
    } catch {
        return [];
    }
}

export function parseStringMap(raw: string | undefined): Record<string, string> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string") out[k] = v;
        }
        return out;
    } catch {
        return {};
    }
}

export interface ParsedKeybind {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    key: string;
}

export function parseKeybind(str: string | undefined): ParsedKeybind | null {
    if (!str) return null;
    const parts = str.split("+").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return null;
    const kb: ParsedKeybind = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
    for (const p of parts) {
        if (p === "ctrl" || p === "control") kb.ctrl = true;
        else if (p === "alt") kb.alt = true;
        else if (p === "shift") kb.shift = true;
        else if (p === "meta" || p === "cmd" || p === "super") kb.meta = true;
        else kb.key = p;
    }
    return kb.key ? kb : null;
}

export function matchKeybind(e: KeyboardEvent, kb: ParsedKeybind): boolean {
    return kb.ctrl === e.ctrlKey
        && kb.alt === e.altKey
        && kb.shift === e.shiftKey
        && kb.meta === e.metaKey
        && e.key.toLowerCase() === kb.key;
}

/**
 * A plugin's own custom interface (e.g. StreamQuality's Quality/Preview
 * window), if it has one. The contract is a function named
 * `openSettingsModal` on the plugin object. Plugins no longer register their
 * own dock buttons, so this is how a dock button added from the Dock tab
 * knows it can open that interface instead of the generic settings page.
 *
 * The click event is passed through, so interfaces that are menus (e.g.
 * FakeDeafen's quick menu) can open at the cursor. Window-style interfaces
 * just ignore it.
 */
export function getCustomInterface(plugin: Plugin | undefined): ((e?: any) => void) | null {
    const fn = (plugin as any)?.openSettingsModal;
    return typeof fn === "function" ? (e?: any) => fn.call(plugin, e) : null;
}

/**
 * Whether a plugin exposes any settings UI at all - either a custom settings
 * modal (openSettingsModal) or standard def-based settings. Used to drive the
 * "Has settings" filter, so it actually matches what the plugin card renders
 * a settings button for instead of only checking for a custom modal.
 */
export function pluginHasSettingsUi(plugin: Plugin): boolean {
    const hasCustomModal = !!getCustomInterface(plugin);
    const hasDefSettings = !!(plugin.settings && Object.keys(plugin.settings.def ?? {}).length > 0);
    return hasCustomModal || hasDefSettings;
}

export function getBooleanSettings(): Map<string, SettingEntry[]> {
    const grouped = new Map<string, SettingEntry[]>();
    for (const p of getEnabledPlugins()) {
        const def = p.settings?.def;
        if (!def) continue;
        for (const key of Object.keys(def)) {
            if (def[key]?.type !== OptionType.BOOLEAN) continue;
            // Bookkeeping switches ("Internal: …") aren't something to bind a key to.
            if (/^internal\b/i.test(String((def[key] as any)?.description ?? ""))) continue;
            const entry: SettingEntry = {
                plugin: p,
                key,
                label: (def[key] as any)?.description ?? key,
                default: String((def[key] as any)?.default ?? false),
            };
            const list = grouped.get(p.name) ?? [];
            list.push(entry);
            grouped.set(p.name, list);
        }
    }
    return grouped;
}

export function getKeybindSettings(): Map<string, SettingEntry[]> {
    const grouped = new Map<string, SettingEntry[]>();
    for (const p of getEnabledPlugins()) {
        const def = p.settings?.def;
        if (!def) continue;
        for (const key of Object.keys(def)) {
            if (!key.toLowerCase().includes("keybind")) continue;
            const entry: SettingEntry = {
                plugin: p,
                key,
                label: (def[key] as any)?.description ?? key,
                default: (def[key] as any)?.default ?? "",
            };
            const list = grouped.get(p.name) ?? [];
            list.push(entry);
            grouped.set(p.name, list);
        }
    }
    return grouped;
}

// ─── Custom dock buttons (user-picked plugin + icon) ───

const CUSTOM_DOCK_PREFIX = "custom-plugin:";

export function customDockId(pluginName: string): string {
    return CUSTOM_DOCK_PREFIX + pluginName;
}

export function isCustomDockId(id: string): boolean {
    return id.startsWith(CUSTOM_DOCK_PREFIX);
}

export function customDockPluginName(id: string): string {
    return id.slice(CUSTOM_DOCK_PREFIX.length);
}

/**
 * What a dock button added from the Dock tab does on left-click: the plugin's
 * custom interface if it has one, otherwise its plugin settings page. Looked
 * up at click time (not when the button is registered), so a plugin that
 * gains or loses a custom interface after an update is picked up without
 * re-adding it. If the custom interface throws, the settings page opens
 * instead of the click silently doing nothing.
 */
export function openPluginUi(pluginName: string, e?: any) {
    const plugin = findPlugin(pluginName);
    if (!plugin) return;
    const custom = getCustomInterface(plugin);
    if (custom) {
        try {
            custom(e);
            return;
        } catch (e) {
            console.error(`[ChannelSettings] ${pluginName}'s custom interface failed to open, falling back to its settings`, e);
        }
    }
    openPluginModal(plugin, () => { });
}

// ─── Sonata's own features in the dock ───
// Saved like plugins, as "opticord:<featureKey>". Sonata tells the dock
// which features exist and what clicking one should open.

export const FEATURE_PREFIX = "opticord:";

export type Opens = "window" | "options" | "page" | "settings";

export interface FeatureDockInfo {
    key: string;
    name: string;
    running: boolean;
    opens: Exclude<Opens, "settings">;
}

interface FeatureDockProvider {
    list(): FeatureDockInfo[];
    /** Left-click: its window, else its options, else the Sonata page. */
    open(key: string, e?: any): void;
    /** Right-click: its options. */
    openOptions(key: string): void;
}

let featureProvider: FeatureDockProvider | null = null;

export function setFeatureDockProvider(provider: FeatureDockProvider | null) {
    featureProvider = provider;
}

export const isFeatureEntry = (name: string) => name.startsWith(FEATURE_PREFIX);

function featureInfo(name: string) {
    return featureProvider?.list().find(f => FEATURE_PREFIX + f.key === name);
}

/** Display name for a dock entry: the feature's name, or the plugin's. */
export function dockLabel(name: string): string {
    return isFeatureEntry(name) ? featureInfo(name)?.name ?? name.slice(FEATURE_PREFIX.length) : name;
}

export interface DockCandidate {
    value: string;
    label: string;
    opens: Opens;
    /** A Sonata feature (with its key, for its icon) or one of your own plugins. */
    kind: "feature" | "plugin";
    featureKey?: string;
}

const isUserPlugin = (p: Plugin) => !!(PluginMeta as Record<string, { userPlugin?: boolean; }>)[p.name]?.userPlugin;

/** A dock entry as a choice (also for one that's already in the dock). */
export function dockCandidate(name: string): DockCandidate {
    if (isFeatureEntry(name)) {
        const f = featureInfo(name);
        return { value: name, label: f?.name ?? name.slice(FEATURE_PREFIX.length), opens: (f?.opens ?? "page") as Opens, kind: "feature", featureKey: name.slice(FEATURE_PREFIX.length) };
    }
    const p = findPlugin(name);
    return { value: name, label: name, opens: (p && getCustomInterface(p) ? "window" : "settings") as Opens, kind: "plugin" };
}

/** Everything that can be added to the dock: Sonata's running features, then your own plugins (not Equicord's built-in ones, or Sonata itself). */
export function getDockCandidates(added: Set<string>): DockCandidate[] {
    const features = (featureProvider?.list() ?? [])
        .filter(f => f.running && !added.has(FEATURE_PREFIX + f.key))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(f => dockCandidate(FEATURE_PREFIX + f.key));
    const plugins = getEnabledPlugins()
        .filter(p => isUserPlugin(p) && p.name !== "Sonata" && !added.has(p.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => dockCandidate(p.name));
    return [...features, ...plugins];
}

export function registerCustomDockButton(pluginName: string, iconKey: string): void {
    const iconDef = DOCK_ICON_MAP[iconKey] ?? DOCK_ICON_MAP[DEFAULT_DOCK_ICON_KEY];
    if (isFeatureEntry(pluginName)) {
        const key = pluginName.slice(FEATURE_PREFIX.length);
        addDockButton(customDockId(pluginName), {
            icon: iconDef.Icon,
            tooltipText: dockLabel(pluginName),
            onClick: e => featureProvider?.open(key, e),
            onContextMenu: (e: React.MouseEvent) => {
                e.preventDefault();
                featureProvider?.openOptions(key);
            },
        });
        return;
    }
    addDockButton(customDockId(pluginName), {
        icon: iconDef.Icon,
        tooltipText: pluginName,
        // Left-click: custom interface, or settings if there isn't one.
        // Right-click: always the settings page.
        onClick: e => openPluginUi(pluginName, e),
        onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault();
            const plugin = findPlugin(pluginName);
            if (plugin) openPluginModal(plugin, () => { });
        },
    });
}

export function unregisterCustomDockButton(pluginName: string): void {
    removeDockButton(customDockId(pluginName));
}

/** Re-registers every saved custom dock button, e.g. on plugin start. */
export function syncCustomDockButtons(raw: string | undefined): void {
    const map = parseStringMap(raw);
    for (const [pluginName, iconKey] of Object.entries(map)) {
        registerCustomDockButton(pluginName, iconKey);
    }
    refreshDock();
}

/** Unregisters every saved custom dock button, e.g. on plugin stop. */
export function clearCustomDockButtons(raw: string | undefined): void {
    const map = parseStringMap(raw);
    for (const pluginName of Object.keys(map)) {
        unregisterCustomDockButton(pluginName);
    }
    refreshDock();
}
