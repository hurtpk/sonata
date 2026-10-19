/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sound Studio: swap any of Discord's sounds (messages, mentions, calls,
// mute/deafen, joins and leaves, streams…) for your own MP3, WAV or OGG,
// from one window. Your files stay in Equicord's local storage on this
// computer, and you can export them all as a sound pack.

import "../_shared/tool.css";
import "./styles.css";

import definePlugin from "@utils/types";

import { openSoundStudio } from "./Panel";
import { loadSounds, swapSound } from "./sounds";

export default definePlugin({
    name: "SoundStudio",
    description: "Change any of Discord's sound effects — messages, mentions, calls, mute and deafen, people joining and leaving, streams and more — to your own MP3, WAV or OGG file, with a volume for each, previews of the original and yours, and sound packs to back up or share.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    dependencies: ["AudioPlayerAPI"],

    openSettingsModal: () => openSoundStudio(),

    audioProcessor: swapSound,

    start() {
        loadSounds();
    },
});
