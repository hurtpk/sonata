/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Theme Studio: build your own Discord look — background, chat, text and
// accent colours, corner roundness, a font and a picture behind Discord — with
// a live preview, and save it as a theme file to share. Turning the feature
// off puts Discord's own look back.

import "../_shared/tool.css";
import "./styles.css";

import definePlugin from "@utils/types";

import { openThemeStudio } from "./Panel";
import { startThemes, stopThemes } from "./store";

export default definePlugin({
    name: "ThemeStudio",
    description: "Build your own Discord look: pick the background, chat, text and accent colours, corner roundness, a font and a picture behind Discord, with a live preview. Save it as a theme file to share.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    openSettingsModal: () => openThemeStudio(),

    start() {
        startThemes();
    },
    stop() {
        stopThemes();
    },
});
