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
    description: "Build Discord AutoMod regex patterns and manage the server's rules, actions and exemptions from Server Tools.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: openAutoModRegex,
});
