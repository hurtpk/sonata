/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Theme Studio: build your own Discord look — colours (one or two accents),
// corners, a font, see-through Discord, a picture, GIF, video or moving colours
// behind it, hover and message animations, message bubbles and badge colours —
// with a live preview. Themes can be made from a picture and shared with a
// short code. Turning the feature off puts Discord's own look back.

import "../_shared/tool.css";
import "./styles.css";

import definePlugin from "@utils/types";
import { showToast, UserStore, useState } from "@webpack/common";

import { openThemeStudio } from "./Panel";
import { CODE_PREFIX, CODE_RE, readShared } from "./share";
import { putTheme, setActive, startThemes, stopThemes } from "./store";
import { OWN_MARK } from "./theme";

/** A theme someone shared in chat: what it looks like, and a button to add it. */
function SharedTheme({ code }: { code: string; }) {
    const [theme] = useState(() => readShared(code));
    const [added, setAdded] = useState(false);
    if (!theme) return null;
    return (
        <div className="vc-ts-shared">
            <span className="vc-ts-shared-swatch" style={{ background: `linear-gradient(135deg, ${theme.bg} 0 50%, ${theme.accent} 50% 75%, ${theme.accent2 ?? theme.accent} 75%)` }} />
            <span className="vc-ts-shared-text"><b>🎨 {theme.name}</b><span>A Theme Studio theme</span></span>
            {added
                ? <button type="button" className="vc-ts-shared-btn" onClick={() => openThemeStudio()}>Open Theme Studio</button>
                : <button type="button" className="vc-ts-shared-btn" onClick={() => { putTheme(theme); setActive(theme.id); setAdded(true); showToast(`"${theme.name}" is on — change it in Theme Studio`, "success"); }}>Try it</button>}
        </div>
    );
}

function Accessory({ message }: { message: any; }) {
    const own = !!message?.author?.id && message.author.id === UserStore.getCurrentUser()?.id;
    const content: string = message?.content ?? "";
    const code = content.includes(CODE_PREFIX) ? content.match(CODE_RE)?.[0] : null;
    if (!own && !code) return null;
    return (
        <>
            {/* Marks your own messages, so bubbles can put yours on the right. */}
            {own && <i className={OWN_MARK} hidden />}
            {code && <SharedTheme code={code} />}
        </>
    );
}

export default definePlugin({
    name: "ThemeStudio",
    description: "Build your own Discord look: colours (one or two accents), corners, a font, see-through Discord, a picture, GIF, video or moving colours behind it, hover and message animations, message bubbles and badge colours — with a live preview. Make a theme from a picture, and share it with a short code.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    openSettingsModal: () => openThemeStudio(),
    renderMessageAccessory: (props: any) => <Accessory message={props.message} />,

    start() {
        startThemes();
    },
    stop() {
        stopThemes();
    },
});
