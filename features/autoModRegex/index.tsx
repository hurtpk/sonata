/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";

import definePlugin from "@utils/types";

import { openAutoModRegex } from "./Panel";
import { settings } from "./settings";

export default definePlugin({
    name: "AutoModRegex",
    description: "Turn your own word list into Discord AutoMod regex patterns that also catch look-alike characters, spacing and stretched letters — batched ten to a rule, each under Discord's 260-character limit.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: openAutoModRegex,
});
