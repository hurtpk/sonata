/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Plugin Utilities (formerly ChannelSettings): Plugins, Keybinds, Dock and
// About tabs, shown inside the Sonata page.

import "./styles.css";

import { classes } from "@utils/misc";
import { ScrollerThin, useState } from "@webpack/common";

import { AboutTab } from "./AboutTab";
import { DockTab } from "./DockTab";
import { KeybindsTab } from "./KeybindsTab";
import { PluginsTab } from "./PluginsTab";
import { cl } from "./shared";

const enum Tab {
    PLUGINS = "plugins",
    KEYBINDS = "keybinds",
    DOCK = "dock",
    ABOUT = "about",
}

const TAB_LABELS: Record<Tab, string> = {
    [Tab.PLUGINS]: "Plugins",
    [Tab.KEYBINDS]: "Keybinds",
    [Tab.DOCK]: "Dock",
    [Tab.ABOUT]: "About",
};

export interface UtilitiesStore {
    dockOrder: string;
    dockHidden: string;
    customDock: string;
    /** Icons chosen for built-in dock buttons (JSON). */
    dockIcons: string;
    aboutAmbientColor: string;
}

export function UtilitiesView({ store }: { store: UtilitiesStore; }) {
    const [activeTab, setActiveTab] = useState<Tab>(Tab.PLUGINS);
    const accent = store.aboutAmbientColor?.trim() || null;

    return (
        <>
            <div className={cl("tab-bar")} role="tablist" aria-label="Plugin Utilities">
                {(Object.keys(TAB_LABELS) as Tab[]).map(tab => (
                    <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === tab}
                        className={classes(cl("tab"), activeTab === tab && cl("tab-active"))}
                        onClick={() => setActiveTab(tab)}
                    >
                        {TAB_LABELS[tab]}
                    </button>
                ))}
            </div>

            <ScrollerThin fade className={cl("scroller")}>
                <div className={cl("content")}>
                    {activeTab === Tab.PLUGINS && <PluginsTab />}
                    {activeTab === Tab.KEYBINDS && <KeybindsTab />}
                    {activeTab === Tab.DOCK && <DockTab settings={store as any} />}
                    {activeTab === Tab.ABOUT && (
                        <AboutTab
                            accentColor={accent}
                            onAccentColorChange={hex => { store.aboutAmbientColor = hex ?? ""; }}
                        />
                    )}
                </div>
            </ScrollerThin>
        </>
    );
}
