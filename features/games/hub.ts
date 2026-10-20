/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Game Hub is one window that stays open while you switch platforms. Steam's
// and Roblox's sections draw only their content inside it, and tell it which
// tabs and status line to show with useHubFrame.

import { React } from "@webpack/common";
import type { ReactNode } from "react";

export interface HubFrame {
    tabs?: readonly (readonly [string, ReactNode])[];
    tab?: string;
    onTab?(id: string): void;
    status?: ReactNode[];
    statusRight?: ReactNode;
}

type Setter = (f: HubFrame) => void;

// Made the first time it's needed: React isn't there yet when Equicord first loads this file.
let ctx: React.Context<Setter> | null = null;
export const hubContext = () => ctx ??= React.createContext<Setter>(() => { });

/** Compares frames by what they show (React elements are compared by their text only). */
const showKey = (f: HubFrame) => JSON.stringify([f.tabs, f.tab, f.status, f.statusRight], (_, v) => v && typeof v === "object" && "$$typeof" in v ? String(v.props?.children ?? "") : v);

/** A Game Hub section's tabs and status line, sent to the window before it's drawn (so nothing flickers). */
export function useHubFrame(frame: HubFrame) {
    const set = React.useContext(hubContext());
    const onTab = React.useRef(frame.onTab);
    onTab.current = frame.onTab;
    const key = showKey(frame);
    React.useLayoutEffect(() => { set({ ...frame, onTab: id => onTab.current?.(id) }); }, [key]);
}
