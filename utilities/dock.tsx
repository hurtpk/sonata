/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The plugin dock (the row of quick-access buttons under your user panel).
// This used to be its own plugin, PluginDock; it now lives inside
// ChannelSettings as a plain module. ChannelSettings wires up the patch,
// context menus, and renderDock (see index.tsx), and everything else in the
// plugin imports the dock API from here instead of "../pluginDock".

import "./dock.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { findComponentByCodeLazy } from "@webpack";
import { Menu, useCallback, useEffect, useRef, useState } from "@webpack/common";
import type { ComponentType, MouseEventHandler, ReactNode } from "react";

const cl = classNameFactory("vc-plugin-dock-");
const logger = new Logger("ChannelSettings:Dock");

const PanelButton = findComponentByCodeLazy("tooltipPositionKey", "positionKeyStemOverride");

export interface DockButtonProps {
    icon: ComponentType<{ width?: number; height?: number; size?: string; color?: string; colorClass?: string; }>;
    tooltipText: string;
    onClick: MouseEventHandler;
    onContextMenu?: MouseEventHandler;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    glowing?: boolean;
    glowColor?: "red" | "green";
    priority?: number;
    /**
     * When provided, renders the button as a toggle and shows Discord's
     * native "checked" highlight (the same boxed look the panel's own
     * mute/deafen buttons get) whenever this is true. Leave unset for
     * buttons that aren't a persistent on/off toggle.
     */
    selected?: boolean;
}

export interface DockEntry {
    props: DockButtonProps;
    priority: number;
}

const dockItems = new Map<string, DockEntry>();

/** The dock button that's always there, first. */
export const PINNED_DOCK_ID = "sonata";
const listeners = new Set<() => void>();

function notify() {
    listeners.forEach(fn => fn());
}

export function addDockButton(id: string, props: DockButtonProps) {
    dockItems.set(id, { props, priority: props.priority ?? 0 });
    notify();
}

export function removeDockButton(id: string) {
    dockItems.delete(id);
    notify();
}

export function getDockItems(): Array<[string, DockEntry]> {
    return Array.from(dockItems);
}

export function addDockMutationListener(fn: () => void) {
    listeners.add(fn);
}

export function removeDockMutationListener(fn: () => void) {
    listeners.delete(fn);
}

interface DockOverride {
    getHidden(): Set<string>;
    getOrder(): string[];
    /** An icon you picked for a built-in button, instead of its own. */
    getIcon?(id: string): DockButtonProps["icon"] | undefined;
}

let dockOverride: DockOverride | null = null;

export function setDockOverride(override: DockOverride | null) {
    dockOverride = override;
    notify();
}

export function refreshDock() {
    notify();
}

export type UserContextEntryRenderer = (userId: string, channelId?: string) => ReactNode | null;

const userContextEntries = new Map<string, UserContextEntryRenderer>();

export function addUserContextEntry(id: string, render: UserContextEntryRenderer) {
    userContextEntries.set(id, render);
}

export function removeUserContextEntry(id: string) {
    userContextEntries.delete(id);
}

const userContextPatch: NavContextMenuPatchCallback = (children, props) => {
    try {
    if (!props) return;
    if (!props.user?.id) return;
    if (userContextEntries.size === 0) return;

    const userId = props.user.id;
    const channelId = props.channel?.id;

    const items = Array.from(userContextEntries).map(([, render]) => {
        try { return render(userId, channelId); } catch { return null; }
    }).filter(Boolean);

    if (items.length === 0) return;

    children.push(<Menu.MenuGroup>{items}</Menu.MenuGroup>);
    } catch { }
};

export type MessageContextEntryRenderer = (message: any, channelId?: string) => ReactNode | null;
const messageContextEntries = new Map<string, MessageContextEntryRenderer>();
export function addMessageContextEntry(id: string, render: MessageContextEntryRenderer) {
    messageContextEntries.set(id, render);
}
export function removeMessageContextEntry(id: string) {
    messageContextEntries.delete(id);
}
const messageContextPatch: NavContextMenuPatchCallback = (children, props) => {
    try {
        if (!props?.message || messageContextEntries.size === 0) return;
        const { message } = props;
        const channelId = message.channel_id ?? props.channel?.id;
        const items = Array.from(messageContextEntries).map(([, render]) => {
            try { return render(message, channelId); } catch { return null; }
        }).filter(Boolean);
        if (items.length) children.push(<Menu.MenuGroup>{items}</Menu.MenuGroup>);
    } catch { }
};

export type GuildContextEntryRenderer = (guild: any) => ReactNode | null;
const guildContextEntries = new Map<string, GuildContextEntryRenderer>();
export function addGuildContextEntry(id: string, render: GuildContextEntryRenderer) {
    guildContextEntries.set(id, render);
}
export function removeGuildContextEntry(id: string) {
    guildContextEntries.delete(id);
}
const guildContextPatch: NavContextMenuPatchCallback = (children, props) => {
    try {
        if (!props?.guild) return;
        if (guildContextEntries.size === 0) return;
        const items = Array.from(guildContextEntries).map(([, render]) => {
            try { return render(props.guild); } catch { return null; }
        }).filter(Boolean);
        if (items.length === 0) return;
        children.push(<Menu.MenuGroup>{items}</Menu.MenuGroup>);
    } catch { }
};

export type ChatInputContextEntryRenderer = () => ReactNode | null;
const chatInputContextEntries = new Map<string, ChatInputContextEntryRenderer>();
export function addChatInputContextEntry(id: string, render: ChatInputContextEntryRenderer) {
    chatInputContextEntries.set(id, render);
}
export function removeChatInputContextEntry(id: string) {
    chatInputContextEntries.delete(id);
}
const chatInputContextPatch: NavContextMenuPatchCallback = children => {
    try {
        if (chatInputContextEntries.size === 0) return;
        const items = Array.from(chatInputContextEntries).map(([, render]) => {
            try { return render(); } catch { return null; }
        }).filter(Boolean);
        if (items.length === 0) return;
        children.push(<Menu.MenuGroup>{items}</Menu.MenuGroup>);
    } catch { }
};

function DockItem({ props }: { props: DockButtonProps; }) {
    const [pressed, setPressed] = useState(false);
    const [animating, setAnimating] = useState(false);
    const cooldown = useRef(false);
    const itemRef = useRef<HTMLDivElement>(null);

    const handleMouseDown = useCallback(() => setPressed(true), []);

    const handleMouseEnter = useCallback(() => {
        itemRef.current?.classList.add(cl("hovered"));
        props.onMouseEnter?.();
    }, [props.onMouseEnter]);

    const handleMouseLeave = useCallback(() => {
        props.onMouseLeave?.();
        itemRef.current?.classList.remove(cl("hovered"));
    }, [props.onMouseLeave]);

    const handleContextMenu = useCallback<MouseEventHandler>(e => {
        if (!props.onContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        props.onContextMenu(e);
    }, [props.onContextMenu]);

    const handleClick = useCallback<MouseEventHandler>(e => {
        if (cooldown.current) return;
        cooldown.current = true;
        setAnimating(true);
        props.onClick(e);
        setTimeout(() => { setAnimating(false); cooldown.current = false; }, 400);
    }, [props.onClick]);

    useEffect(() => {
        const up = () => setPressed(false);
        window.addEventListener("mouseup", up);
        return () => { window.removeEventListener("mouseup", up); };
    }, []);

    return (
        <div
            ref={itemRef}
            className={classes(
                cl("item"),
                props.glowing ? cl("glowing") : "",
                props.glowing && props.glowColor === "green" ? cl("glow-green") : "",
                props.selected ? cl("selected") : "",
                pressed ? cl("pressed") : "",
                animating ? cl("pop") : ""
            )}
            onMouseDown={handleMouseDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onContextMenu={handleContextMenu}
        >
            <PanelButton
                icon={props.icon}
                tooltipText={props.tooltipText}
                onClick={handleClick}
                {...(props.selected !== undefined
                    ? { role: "switch", "aria-checked": props.selected }
                    : {})}
            />
        </div>
    );
}

let globalCollapsed = false;
let globalHidden = false;
const collapseListeners = new Set<() => void>();

function setCollapsed(val: boolean) {
    globalCollapsed = val;
    collapseListeners.forEach(fn => fn());
}

function setHidden(val: boolean) {
    globalHidden = val;
    collapseListeners.forEach(fn => fn());
}

function PluginDockComponent() {
    const [, forceUpdate] = useState(0);
    const [collapsed, setLocalCollapsed] = useState(globalCollapsed);
    const [hidden, setLocalHidden] = useState(globalHidden);
    const dragging = useRef(false);
    const startY = useRef(0);
    const sepRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);

    useEffect(() => {
        const listener = () => {
            setLocalCollapsed(globalCollapsed);
            setLocalHidden(globalHidden);
        };
        collapseListeners.add(listener);
        return () => { collapseListeners.delete(listener); };
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.altKey && e.key.toLowerCase() === "h") {
                e.preventDefault();
                setHidden(!globalHidden);
            }
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
    }, []);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        dragging.current = true;
        startY.current = e.clientY;
        sepRef.current?.classList.add(cl("dragging"));

        const onMove = (ev: MouseEvent) => {
            if (!dragging.current) return;
            const delta = ev.clientY - startY.current;
            if (delta > 20 && !globalCollapsed) {
                setCollapsed(true);
                dragging.current = false;
                sepRef.current?.classList.remove(cl("dragging"));
            } else if (delta < -20 && globalCollapsed) {
                setCollapsed(false);
                dragging.current = false;
                sepRef.current?.classList.remove(cl("dragging"));
            }
        };

        const onUp = () => {
            dragging.current = false;
            sepRef.current?.classList.remove(cl("dragging"));
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, []);

    if (dockItems.size === 0) return null;

    const withIcon = (id: string, props: DockButtonProps) => {
        const icon = dockOverride?.getIcon?.(id);
        return icon ? { ...props, icon } : props;
    };

    const overrideHidden = dockOverride?.getHidden() ?? new Set<string>();
    const order = dockOverride?.getOrder() ?? [];
    const orderIndex = new Map(order.map((id, i) => [id, i]));
    // Sonata's own button always comes first and can't be hidden.
    const sorted = Array.from(dockItems)
        .filter(([id]) => id === PINNED_DOCK_ID || !overrideHidden.has(id))
        .sort(([aId, a], [bId, b]) => {
            if (aId === PINNED_DOCK_ID) return -1;
            if (bId === PINNED_DOCK_ID) return 1;
            const ai = orderIndex.get(aId);
            const bi = orderIndex.get(bId);
            if (ai != null && bi != null) return ai - bi;
            if (ai != null) return -1;
            if (bi != null) return 1;
            return a.priority - b.priority;
        });

    if (sorted.length === 0) return null;
    const pinned = sorted.find(([id]) => id === PINNED_DOCK_ID);
    const rest = sorted.filter(([id]) => id !== PINNED_DOCK_ID);

    return (
        <div className={classes(cl("container"), hidden ? cl("hidden") : "")}>
            <div
                ref={sepRef}
                className={cl("separator")}
                onMouseDown={onMouseDown}
            />
            <div className={classes(cl("buttons-wrapper"), collapsed ? cl("collapsed") : "")}>
                <div className={cl("row")}>
                    {/* Sonata's button sits on the left, centred on the whole dock, with a fading line after it. */}
                    {pinned && (
                        <>
                            <div className={cl("pinned")}>
                                <ErrorBoundary noop onError={e => logger.error("Failed to render the pinned dock button", e.error)}>
                                    <DockItem props={withIcon(pinned[0], pinned[1].props)} />
                                </ErrorBoundary>
                            </div>
                            {rest.length > 0 && <div className={cl("pin-line")} aria-hidden />}
                        </>
                    )}
                    {rest.length > 0 && (
                        <div className={cl("buttons")}>
                            {rest.map(([id, { props }]) => (
                                <ErrorBoundary noop key={id} onError={e => logger.error(`Failed to render dock button ${id}`, e.error)}>
                                    <DockItem props={withIcon(id, props)} />
                                </ErrorBoundary>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Hooks ChannelSettings plugs into its own definePlugin ───

/** Context-menu patches for the entries other features add through the dock API (shown in the Sonata submenu). */
export const dockContextMenus = {
    "message": messageContextPatch,
    "user-context": userContextPatch,
    "guild-context": guildContextPatch,
    "guild-header-popout": guildContextPatch,
    "textarea-context": chatInputContextPatch,
};

/**
 * Injects the dock under the user panel. Insert as a new sibling inside the
 * panel-buttons array itself, right before it closes. This is anchored to
 * the array's own closing bracket rather than whatever follows the component
 * afterward, so it keeps working even if Discord changes how that outer
 * component/class is declared. Calls $self.renderDock(), so the plugin using
 * this patch must expose renderDock.
 */
export const dockPatch = {
    find: "dismissTooltips:this.dismissTooltips",
    replacement: {
        match: /(dismissTooltips:this\.dismissTooltips\}\))\]/,
        replace: "$1,$self.renderDock()]"
    }
};

export const renderDock = ErrorBoundary.wrap(PluginDockComponent, { noop: true });
