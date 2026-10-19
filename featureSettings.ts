/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * QOL — per-feature settings.
 *
 * Every bundled feature keeps using its settings exactly like it did as a
 * standalone plugin (settings.store.x, settings.use([...]), settings.plain),
 * but the values actually live on the QOL plugin, prefixed with the feature
 * key: e.g. ShowHiddenChannels' "showMode" is stored as
 * Settings.plugins.Sonata["showHiddenChannels_showMode"].
 *
 * Keeping them under QOL (instead of under each feature's own name) is what
 * lets defaults resolve: Equicord only resolves a setting's default for
 * plugins it has registered, and QOL is the registered plugin.
 */

import { PlainSettings, Settings, useSettings } from "@api/Settings";
import { DefinedSettings, SettingsChecks, SettingsDefinition } from "@utils/types";

export const QOL_NAME = "Sonata";

export const prefixKey = (feature: string, key: string) => `${feature}_${key}`;

/** Keys of the features currently running inside QOL. */
export const runningFeatures = new Set<string>();

/**
 * Whether a QOL feature is running. For bundled features that used to check
 * each other with isPluginEnabled("Name") — e.g. Show Hidden Channels
 * asking about Permissions Viewer — which would only see the built-ins.
 */
export const isFeatureRunning = (key: string) => runningFeatures.has(key);

/** Whether a feature's switch is on — usable before features start, e.g. in a patch predicate. */
export const isFeatureSwitchedOn = (key: string) => Settings.plugins[QOL_NAME]?.[`on_${key}`] !== false;

/** Feature key -> that feature's settings object, in definition order. */
export const featureSettings = new Map<string, DefinedSettings<any, any>>();

/**
 * A view over QOL's settings object that only exposes one feature's keys,
 * without the prefix. Reads and writes go straight through, so it stays
 * reactive exactly like the real settings store.
 */
function scoped(getTarget: () => any, feature: string): any {
    const pre = `${feature}_`;
    const target = () => getTarget() ?? {};
    return new Proxy({}, {
        get: (_, k) => typeof k === "string" ? target()[pre + k] : undefined,
        set: (_, k, v) => {
            if (typeof k === "string") target()[pre + k] = v;
            return true;
        },
        has: (_, k) => typeof k === "string" && (pre + k) in target(),
        deleteProperty: (_, k) => {
            if (typeof k === "string") delete target()[pre + k];
            return true;
        },
        ownKeys: () => Object.keys(target()).filter(k => k.startsWith(pre)).map(k => k.slice(pre.length)),
        getOwnPropertyDescriptor: (_, k) => typeof k === "string" && (pre + k) in target()
            ? { configurable: true, enumerable: true, writable: true, value: target()[pre + k] }
            : undefined,
    });
}

/** Drop-in replacement for definePluginSettings, scoped to one QOL feature. */
export function defineFeatureSettings<
    Def extends SettingsDefinition,
    Checks extends SettingsChecks<Def>,
    PrivateSettings extends object = {}
>(feature: string, def: Def, checks?: Checks): DefinedSettings<Def, PrivateSettings> {
    if (checks) {
        for (const [name, check] of Object.entries(checks)) {
            Object.assign(def[name], check);
        }
    }

    const definedSettings: DefinedSettings<Def, PrivateSettings> = {
        get store() {
            return scoped(() => Settings.plugins[QOL_NAME], feature);
        },
        get plain() {
            return scoped(() => PlainSettings.plugins[QOL_NAME], feature);
        },
        use: filter => {
            const paths = filter
                ? filter.map(name => `plugins.${QOL_NAME}.${prefixKey(feature, name)}`)
                : [`plugins.${QOL_NAME}.*`];
            const all = (useSettings(paths as any) as any).plugins[QOL_NAME];
            return scoped(() => all, feature);
        },
        def,
        pluginName: QOL_NAME,
        withPrivateSettings<T extends object>() {
            return this as unknown as DefinedSettings<Def, T>;
        }
    };

    featureSettings.set(feature, definedSettings);
    return definedSettings;
}
