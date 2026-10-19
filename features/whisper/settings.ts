/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";

export const settings = defineFeatureSettings("whisper", {
    quickWhisper: {
        type: OptionType.BOOLEAN,
        description: "Quick whispers: type “cover ;; hidden” in the message box and the part after ;; is hidden when you send",
        default: true,
    },
    // Never a password here (settings can be shared): "auto", "sonata", or the name of one in your password book.
    quickLock: { type: OptionType.STRING, description: "Who can read quick whispers", default: "auto", hidden: true },
});
