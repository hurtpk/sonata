/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// One ♫ button in the chat bar instead of a row of them: every running
// feature's chat bar button lives in a tray that slides out to its left.
// Right-click the ♫ to pin a button next to it (so it's always showing) or
// to hide one altogether — or move one to the start or the end of the row.

import "./chatTray.css";

import { addChatBarButton, ChatBarButton, ChatBarButtonData, ChatBarButtonFactory, removeChatBarButton } from "@api/ChatButtons";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import type { IconProps } from "@utils/types";
import { ContextMenuApi, Menu, useEffect, useReducer } from "@webpack/common";

import { noteUse } from "./usage";

export const TRAY_ID = "Sonata";

interface TrayButton extends ChatBarButtonData { key: string; name: string; }

const buttons = new Map<string, TrayButton>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(l => l());

export function addTrayButton(key: string, name: string, data: ChatBarButtonData) {
    buttons.set(key, { key, name, ...data });
    changed();
}

export function removeTrayButton(key: string) {
    if (buttons.delete(key)) changed();
}

function useTrayButtons() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        listeners.add(bump);
        return () => void listeners.delete(bump);
    }, []);
    return [...buttons.values()];
}

/** A to Z, except the ones you put first or last (in the order you put them there). */
function arrange(all: TrayButton[], first: string[], last: string[]) {
    const rank = (k: string) => first.includes(k) ? first.indexOf(k) - 1000 : last.includes(k) ? 1000 + last.indexOf(k) : 0;
    return [...all].sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));
}

type TraySettings = { chatTrayOpen: boolean; chatTrayPinned: string; chatTrayHidden: string; chatTrayFirst: string; chatTrayLast: string; };
interface SettingsLike { store: TraySettings; use(keys: (keyof TraySettings)[]): TraySettings; }

let settings: SettingsLike | null = null;

const list = (json: string): string[] => {
    try { const v = JSON.parse(json || "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; } catch { return []; }
};

function toggleIn(setting: "chatTrayPinned" | "chatTrayHidden", key: string) {
    if (!settings) return;
    const cur = list(settings.store[setting]);
    settings.store[setting] = JSON.stringify(cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key]);
}

export function TrayIcon({ height = 22, width = 30, className, open }: IconProps & { open?: boolean; }) {
    return (
        <svg viewBox="0 0 30 24" width={width} height={height} className={classes("vc-sonata-tray-icon", open && "vc-sonata-tray-icon-open", className)} fill="currentColor" aria-hidden>
            <path className="vc-sonata-tray-chevron" d="M7.6 7.2 3.4 12l4.2 4.8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {/* Two beamed notes: ♫ */}
            <path d="M14 6.1v9.4a3 3 0 1 0 2 2.8V9.9l8-1.8v5.4a3 3 0 1 0 2 2.8V3.6a.9.9 0 0 0-1.1-.9l-10.2 2.3a.9.9 0 0 0-.7 1.1Z" />
        </svg>
    );
}

type Place = "normal" | "first" | "last";

function placeIn(key: string, place: Place) {
    if (!settings) return;
    const first = list(settings.store.chatTrayFirst).filter(k => k !== key), last = list(settings.store.chatTrayLast).filter(k => k !== key);
    if (place === "first") first.push(key);
    if (place === "last") last.push(key);
    settings.store.chatTrayFirst = JSON.stringify(first);
    settings.store.chatTrayLast = JSON.stringify(last);
}

function TrayMenu({ all: unordered }: { all: TrayButton[]; }) {
    const s = settings!.use(["chatTrayPinned", "chatTrayHidden", "chatTrayFirst", "chatTrayLast"]);
    const pinned = list(s.chatTrayPinned), hidden = list(s.chatTrayHidden);
    const first = list(s.chatTrayFirst), last = list(s.chatTrayLast);
    const all = arrange(unordered, first, last);
    const placeOf = (k: string): Place => first.includes(k) ? "first" : last.includes(k) ? "last" : "normal";
    return (
        <Menu.Menu navId="vc-sonata-chat-tray" onClose={ContextMenuApi.closeContextMenu} aria-label="Sonata chat buttons">
            <Menu.MenuGroup label="Always showing next to ♫">
                {all.map(b => (
                    <Menu.MenuCheckboxItem key={b.key} id={`pin-${b.key}`} label={b.name} checked={pinned.includes(b.key)}
                        disabled={hidden.includes(b.key)} action={() => toggleIn("chatTrayPinned", b.key)} />
                ))}
            </Menu.MenuGroup>
            <Menu.MenuItem id="hidden" label="Show in the chat bar">
                {all.map(b => (
                    <Menu.MenuCheckboxItem key={b.key} id={`show-${b.key}`} label={b.name} checked={!hidden.includes(b.key)}
                        action={() => toggleIn("chatTrayHidden", b.key)} />
                ))}
            </Menu.MenuItem>
            <Menu.MenuItem id="order" label="Move a button">
                {all.filter(b => !hidden.includes(b.key)).map(b => (
                    <Menu.MenuItem key={b.key} id={`order-${b.key}`} label={placeOf(b.key) === "normal" ? b.name : `${b.name} (${placeOf(b.key)})`}>
                        {([["normal", "In A–Z order"], ["first", "First (far left)"], ["last", "Last (far right)"]] as [Place, string][]).map(([p, label]) => (
                            <Menu.MenuRadioItem key={p} id={`order-${b.key}-${p}`} group={`order-${b.key}`} label={label} checked={placeOf(b.key) === p} action={() => placeIn(b.key, p)} />
                        ))}
                    </Menu.MenuItem>
                ))}
            </Menu.MenuItem>
        </Menu.Menu>
    );
}

const Tray: ChatBarButtonFactory = props => {
    const unordered = useTrayButtons();
    const s = settings!.use(["chatTrayOpen", "chatTrayPinned", "chatTrayHidden", "chatTrayFirst", "chatTrayLast"]);
    const all = arrange(unordered, list(s.chatTrayFirst), list(s.chatTrayLast));
    if (!props.isMainChat || !all.length) return null;

    const pinned = list(s.chatTrayPinned), hidden = list(s.chatTrayHidden);
    const shown = all.filter(b => !hidden.includes(b.key));
    const inTray = shown.filter(b => !pinned.includes(b.key));
    const pins = shown.filter(b => pinned.includes(b.key));
    const open = !!s.chatTrayOpen && inTray.length > 0;

    const render = (b: TrayButton) => {
        const Button = b.render;
        return (
            <ErrorBoundary noop key={b.key}>
                <span className="vc-sonata-tray-slot" onClickCapture={() => noteUse(b.key)}><Button {...props} /></span>
            </ErrorBoundary>
        );
    };

    return (
        <>
            {open && <div className="vc-sonata-tray">{inTray.map(render)}</div>}
            {pins.map(render)}
            <ChatBarButton
                tooltip={inTray.length ? open ? "Hide Sonata buttons" : `Sonata buttons (${inTray.length})` : "Sonata buttons — right-click to choose"}
                onClick={() => { if (inTray.length) settings!.store.chatTrayOpen = !open; }}
                onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <TrayMenu all={all} />)}
            >
                <TrayIcon open={open} />
            </ChatBarButton>
        </>
    );
};

export function startChatTray(s: SettingsLike) {
    settings = s;
    addChatBarButton(TRAY_ID, Tray, TrayIcon);
}

export function stopChatTray() {
    removeChatBarButton(TRAY_ID);
}
