/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle } from "@api/Styles";
import { ButtonCompat } from "@components/Button";
import { makeRange, OptionType } from "@utils/types";
import { showToast } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import hoverOnlyStyle from "./hoverOnly.css?managed";
import hoverSwapStyle from "./hoverSwap.css?managed";
import { clearLyricsCache, removeTranslations } from "./lyrics/api";
import languages from "./lyrics/providers/translator/languages";
import { Provider } from "./lyrics/providers/types";

/** Hover controls on or off, in the chosen style (read from the settings when not given). */
export function toggleHoverControls(value: boolean, style?: string) {
    const how = style ?? (settings?.store?.hoverStyle as string | undefined) ?? "swap";
    (value && how === "below" ? enableStyle : disableStyle)(hoverOnlyStyle);
    (value && how !== "below" ? enableStyle : disableStyle)(hoverSwapStyle);
}

export const settings = defineFeatureSettings("spotifyControls", {
    hoverControls: {
        description: "Hide the controls until you hover over the player",
        type: OptionType.BOOLEAN,
        default: true,
        onChange: v => toggleHoverControls(v),
    },
    hoverStyle: {
        description: "How they show up",
        type: OptionType.SELECT,
        options: [
            { label: "In place of the song info — the player never changes size (smoothest)", value: "swap", default: true },
            { label: "Opening underneath (the player grows, which can stutter in busy servers)", value: "below" },
        ],
        hidden: () => !settings.store.hoverControls,
        onChange: (v: string) => toggleHoverControls(settings.store.hoverControls, v),
    },
    playerPosition: {
        description: "Where the player goes",
        type: OptionType.SELECT,
        options: [
            { label: "Top of the user area (above Voice Connected and screen share)", value: "top", default: true },
            { label: "Just above my account panel", value: "account" },
        ],
    },
    ambience: {
        description: "Moving background behind the player, made from the album cover",
        type: OptionType.BOOLEAN,
        default: true,
    },
    ambienceRespectMotion: {
        description: "Keep the background still if your system is set to reduce motion (Windows: Settings → Accessibility → Visual effects → Animation effects)",
        type: OptionType.BOOLEAN,
        default: false,
    },
    previousButtonRestartsTrack: {
        type: OptionType.BOOLEAN,
        description: "Restart the current song when pressing ⏮ after more than 3 seconds (like Spotify does)",
        default: true,
    },
    useSpotifyUris: {
        type: OptionType.BOOLEAN,
        description: "Open songs, artists and albums in the Spotify app instead of the browser (needs Spotify installed)",
        default: false,
    },

    // ─── Lyrics (from Equicord's Music Controls) ───
    showLyrics: {
        type: OptionType.BOOLEAN,
        description: "Show synced lyrics under the player (the 🎤 button toggles this)",
        default: false,
    },
    lyricsProvider: {
        description: "Where lyrics come from",
        type: OptionType.SELECT,
        options: [
            { value: Provider.Lrclib, label: "LRCLIB", default: true },
            { value: Provider.Spotify, label: "Spotify (Musixmatch)" },
        ],
    },
    fallbackProvider: {
        description: "If one lyrics source has nothing, try the other",
        type: OptionType.BOOLEAN,
        default: true,
    },
    lyricsConversion: {
        description: "Automatically translate or romanize lyrics",
        type: OptionType.SELECT,
        options: [
            { value: Provider.None, label: "None", default: true },
            { value: Provider.Translated, label: "Translate" },
            { value: Provider.Romanized, label: "Romanize" },
        ],
    },
    translateTo: {
        description: "Translate lyrics to (changing this clears saved translations)",
        type: OptionType.SELECT,
        options: languages,
        onChange: async () => {
            await removeTranslations();
            showToast("Translations cleared", "success");
        },
    },
    lyricDelay: {
        description: "Lyrics timing offset (ms) — nudge this if lyrics run early or late",
        type: OptionType.SLIDER,
        default: 0,
        markers: makeRange(-2500, 2500, 250),
        stickToMarkers: true,
    },
    showMusicNoteOnNoLyrics: {
        description: "Show a music note when a song has no lyrics",
        type: OptionType.BOOLEAN,
        default: true,
    },
    showFailedToasts: {
        description: "Show a message when lyrics can't be found",
        type: OptionType.BOOLEAN,
        default: true,
    },
    spotifyLyricsApiUrl: {
        type: OptionType.STRING,
        description: "Spotify lyrics API base URL",
        hidden: true,
        default: "https://spotify-lyrics-api-pi.vercel.app",
        onChange: async () => {
            await clearLyricsCache();
            showToast("Lyrics cache purged", "success");
        },
    },
    purgeLyricsCache: {
        type: OptionType.COMPONENT,
        component: () => (
            <ButtonCompat color={ButtonCompat.Colors.RED} onClick={async () => { await clearLyricsCache(); showToast("Lyrics cache purged", "success"); }}>
                Clear saved lyrics
            </ButtonCompat>
        ),
    },
});
