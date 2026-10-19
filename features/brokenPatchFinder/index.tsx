/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sonata Insights (formerly Sonata Doctor, and before that Broken Patch Finder): finds what's wrong and what's
// slow — features that didn't start or are stuck waiting, patches that broke
// after a Discord update, settings that can't be read, and heavy settings —
// and fixes most of it in one click.

import "../_shared/tool.css";
import "./styles.css";
import "./doctor.css";

import { showNotification } from "@api/Notifications";
import definePlugin, { OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";
import { summary } from "./checks";
import { bindCulpritStore, hideCulpritBanner, showCulpritBanner } from "./culprit";
import { openDoctor } from "./Doctor";
import { runLayoutCheck } from "./layout";
import { installRecorder } from "./recorder";

// Starts listening as soon as Sonata loads (patching happens right after),
// whether or not the feature is on — it only keeps a list, nothing more.
installRecorder();

export const settings = defineFeatureSettings("brokenPatchFinder", {
    notify: {
        type: OptionType.BOOLEAN,
        description: "Let me know when Discord opens with problems (broken patches, features that didn't start, damaged settings)",
        default: true,
    },
    culpritJson: {
        type: OptionType.STRING,
        description: "Internal: where Find the culprit is up to.",
        default: "",
        hidden: true,
    },
});

bindCulpritStore(() => settings.store.culpritJson ?? "", v => { settings.store.culpritJson = v; });

let timer: ReturnType<typeof setTimeout> | undefined;

export default definePlugin({
    name: "SonataInsights",
    description: "Finds what's wrong and what's slow — features that didn't start or are stuck, plugin patches that broke after a Discord update, settings that can't be read, and heavy settings — with one-click fixes and a report to share.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openDoctor(),

    toolboxActions: {
        "Sonata Insights": () => openDoctor(),
    },

    start() {
        // Find the culprit asks its question soon after each reload.
        setTimeout(showCulpritBanner, 2500);
        // Give Discord a moment to finish loading first.
        timer = setTimeout(async () => {
            await runLayoutCheck().catch(() => { });
            if (!settings.store.notify) return;
            const s = summary();
            const parts = [
                s.patches && `${s.patches} broken patch${s.patches === 1 ? "" : "es"}`,
                s.layout && `${s.layout} feature${s.layout === 1 ? "" : "s"} affected by a Discord update`,
                s.features && `${s.features} feature${s.features === 1 ? "" : "s"} needing a look`,
                s.settings && `${s.settings} damaged setting${s.settings === 1 ? "" : "s"}`,
            ].filter(Boolean);
            if (!parts.length) return;
            showNotification({
                title: "Sonata Insights found something",
                body: `${parts.join(", ")}. Click to see and fix.`,
                onClick: () => openDoctor(),
            });
        }, 20_000);
    },

    stop() {
        hideCulpritBanner();
        clearTimeout(timer);
    },
});
