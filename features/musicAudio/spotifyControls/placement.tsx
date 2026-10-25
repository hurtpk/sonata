/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Puts the player at the top of the user area (above Voice Connected and the
// screen-share panel). Discord only lets us hook in next to the account panel,
// so we render the player into a small slot at the top of the panel stack.
// If that stack can't be found, it simply stays above the account panel.

import { ReactDOM, useLayoutEffect, useRef, useState } from "@webpack/common";

/** The user-area panel stack (its class always starts with "panels_"). */
export function findPanelStack(from: Element | null): HTMLElement | null {
    return from?.closest<HTMLElement>('[class^="panels_"], [class*=" panels_"]') ?? null;
}

export function AtTopOfPanels({ children }: { children: React.ReactNode; }) {
    const anchor = useRef<HTMLSpanElement>(null);
    const [slot, setSlot] = useState<HTMLElement | null | "inline">(null);

    useLayoutEffect(() => {
        const stack = findPanelStack(anchor.current);
        if (!stack) {
            setSlot("inline");
            return;
        }
        const el = document.createElement("div");
        el.className = "vc-spotify-top-slot";
        stack.prepend(el);
        setSlot(el);
        return () => { el.remove(); };
    }, []);

    return (
        <>
            <span ref={anchor} hidden />
            {slot === "inline" ? children : slot ? ReactDOM.createPortal(children, slot) : null}
        </>
    );
}
