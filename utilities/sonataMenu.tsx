/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Gathers everything Sonata adds to any right-click menu (messages, people,
// servers, channels, the chat box…) into one "Sonata ›" submenu, instead of a
// long run of extra items.
//
// When a feature starts, any menu patches it registers are taken out of
// Equicord's lists and kept here. One global patch of Sonata's runs them
// against each menu, takes out whatever they added (wherever they put it) and
// puts it in the submenu, in the same order.

import { addGlobalContextMenuPatch, GlobalContextMenuPatchCallback, globalPatches, NavContextMenuPatchCallback, navPatches, removeGlobalContextMenuPatch } from "@api/ContextMenu";
import { Logger } from "@utils/Logger";
import { Menu } from "@webpack/common";
import type { ReactElement, ReactNode } from "react";

import { SonataIcon } from "./icons";

const logger = new Logger("Sonata:Menu");

/** Per menu: each patch, and the feature it belongs to. */
const owned = new Map<string, Map<NavContextMenuPatchCallback, string>>();
/** Patches for every menu, and the feature each belongs to. */
const ownedGlobal = new Map<GlobalContextMenuPatchCallback, string>();

export function addOwnedMenuPatch(navId: string, patch: NavContextMenuPatchCallback, owner: string) {
    if (!owned.has(navId)) owned.set(navId, new Map());
    owned.get(navId)!.set(patch, owner);
}

/** Run a feature's start, keeping hold of any menu patches it adds. */
export function captureMenuPatches<T>(feature: string, start: () => T): T {
    const before = new Map([...navPatches].map(([id, set]) => [id, new Set(set)]));
    const beforeGlobal = new Set(globalPatches);
    try {
        return start();
    } finally {
        for (const [id, patches] of navPatches) {
            const had = before.get(id);
            for (const patch of [...patches]) {
                if (had?.has(patch)) continue;
                patches.delete(patch);
                addOwnedMenuPatch(id, patch, feature);
            }
        }
        for (const patch of [...globalPatches]) {
            if (beforeGlobal.has(patch) || patch === groupingPatch) continue;
            globalPatches.delete(patch);
            ownedGlobal.set(patch, feature);
        }
    }
}

/** A feature stopped: forget its patches. */
export function releaseMenuPatches(feature: string) {
    for (const patches of owned.values()) {
        for (const [patch, key] of patches) if (key === feature) patches.delete(patch);
    }
    for (const [patch, key] of ownedGlobal) if (key === feature) ownedGlobal.delete(patch);
}

type Kids = Array<ReactElement<any> | null | undefined>;

const kidsOf = (el: any): Kids | null => {
    const c = el?.props?.children;
    return Array.isArray(c) ? c : null;
};

/** Every element in the menu, and every item id, as it is now. */
function snapshot(children: Kids, els = new Set<unknown>(), ids = new Set<string>()) {
    for (const c of children) {
        if (!c || typeof c !== "object") continue;
        els.add(c);
        const id = (c as any).props?.id;
        if (typeof id === "string") ids.add(id);
        const sub = kidsOf(c);
        if (sub) snapshot(sub, els, ids);
        else if ((c as any).props?.children && typeof (c as any).props.children === "object") snapshot([(c as any).props.children], els, ids);
    }
    return { els, ids };
}

/** Takes out everything that wasn't there before, wherever it was put. */
function takeAdded(children: Kids, before: ReturnType<typeof snapshot>, out: ReactNode[]) {
    for (let i = 0; i < children.length; i++) {
        const c = children[i];
        if (!c || typeof c !== "object") continue;
        const id = (c as any).props?.id;
        // A changed copy of one of Discord's own items stays where it is.
        if (!before.els.has(c) && !(typeof id === "string" && before.ids.has(id))) {
            out.push(c);
            children.splice(i--, 1);
            continue;
        }
        const sub = kidsOf(c);
        if (sub) takeAdded(sub, before, out);
    }
}

const isGroup = (el: any) => el?.type === Menu.MenuGroup;

function MenuIcon(props: { className?: string; }) {
    return <span className={props.className} style={{ display: "flex" }}><SonataIcon width={18} height={18} /></span>;
}

let openSonata: (() => void) | null = null;

const groupingPatch: GlobalContextMenuPatchCallback = (navId, children, ...args) => {
    const patches = owned.get(navId);
    if (!patches?.size && !ownedGlobal.size) return;
    // Sonata's own menus (like the dock's) are left alone.
    if (navId.startsWith("sonata")) return;

    const before = snapshot(children);
    for (const [patch, feature] of patches ?? []) {
        try { patch(children, ...args); } catch (e) { logger.error(`${feature}'s ${navId} menu patch failed`, e); }
    }
    for (const [patch, feature] of ownedGlobal) {
        try { patch(navId, children, ...args); } catch (e) { logger.error(`${feature}'s menu patch failed on ${navId}`, e); }
    }
    const added: ReactNode[] = [];
    takeAdded(children, before, added);
    if (!added.length) return;

    // Loose items are grouped together; groups the features made keep their own dividers.
    const groups: ReactNode[] = [];
    let loose: ReactNode[] = [];
    const flush = () => {
        if (loose.length) groups.push(<Menu.MenuGroup key={`g${groups.length}`}>{loose}</Menu.MenuGroup>);
        loose = [];
    };
    for (const el of added) {
        if (isGroup(el)) { flush(); groups.push(el); } else loose.push(el);
    }
    flush();
    if (openSonata) groups.push(<Menu.MenuGroup key="open"><Menu.MenuItem id="sonata-open" label="Open Sonata" action={openSonata} /></Menu.MenuGroup>);

    const menu = (
        <Menu.MenuGroup>
            <Menu.MenuItem id="sonata-menu" label="Sonata" icon={MenuIcon}>
                {groups}
            </Menu.MenuItem>
        </Menu.MenuGroup>
    );
    // On a message it goes right above Reply and Forward; everywhere else, at the end.
    const at = navId === "message" ? children.findIndex(c => hasItem(c, ["reply", "forward"])) : -1;
    if (at >= 0) children.splice(at, 0, menu);
    else children.push(menu);
};

/** Whether one of these items is somewhere in this part of the menu. */
function hasItem(el: any, ids: string[], depth = 0): boolean {
    if (!el || typeof el !== "object" || depth > 4) return false;
    if (ids.includes(el.props?.id)) return true;
    const c = el.props?.children;
    return Array.isArray(c) ? c.some(x => hasItem(x, ids, depth + 1)) : hasItem(c, ids, depth + 1);
}

export function installSonataMenus(open: () => void) {
    openSonata = open;
    addGlobalContextMenuPatch(groupingPatch);
}

export function uninstallSonataMenus() {
    removeGlobalContextMenuPatch(groupingPatch);
    owned.clear();
    ownedGlobal.clear();
    openSonata = null;
}
