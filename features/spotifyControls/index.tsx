/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Spotify player above your user panel: cover art, song + artist, a seek bar
// you can drag, previous / play-pause / next / shuffle / repeat (sliding up
// on hover), an album-cover ambience, and synced lyrics (🎤 button).
// The Spotify parts of Equicord's Music Controls (latest upstream), without
// Tidal. Pauses itself while Equicord's Music Controls is on.

import "./lyrics.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";

import { migrateOldLyrics } from "./lyrics/api";
import { AtTopOfPanels } from "./placement";
import { SpotifyPlayer } from "./PlayerComponent";
import { settings, toggleHoverControls } from "./settings";

export default definePlugin({
    name: "SpotifyControls",
    description: "Spotify player above your user panel: album cover with a moving ambience, song and artist, a draggable seek bar, controls that slide up on hover, and synced lyrics.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                // react.jsx)(AccountPanel, { ..., showTaglessAccountPanel: blah })
                match: /(?<=\i\.jsxs?\)\()(\i),{(?=[^}]*?userTag:\i,occluded:)/,
                // react.jsx(WrapperComponent, { VencordOriginal: AccountPanel, ...
                replace: "$self.PanelWrapper,{VencordOriginal:$1,"
            },
        },
        {
            find: ".PLAYER_DEVICES",
            replacement: [{
                // Adds POST and a Marker to the SpotifyAPI (so we can easily find it)
                match: /get:(\i)\.bind\(null,(\i\.\i)\.get\)/,
                replace: "post:$1.bind(null,$2.post),vcSpotifyMarker:1,$&"
            },
            {
                // Spotify Connect API returns status 202 instead of 204 when skipping tracks.
                // Discord rejects 202 which causes the request to send twice. This patch prevents this.
                match: /202===\i\.status/,
                replace: "false",
            }]
        },
        {
            find: 'repeat:"off"!==',
            replacement: [
                {
                    // Discord doesn't give you shuffle state and the repeat kind, only a boolean
                    match: /repeat:"off"!==(\i),/,
                    replace: "shuffle:arguments[2]?.shuffle_state??false,actual_repeat:$1,$&"
                },
                {
                    match: /(?<=artists.filter\(\i=>).{0,10}\i\.id\)&&/,
                    replace: ""
                }
            ]
        },
    ],

    PanelWrapper({ VencordOriginal, ...props }: { VencordOriginal: React.ComponentType<any>; [k: string]: any; }) {
        const player = <ErrorBoundary noop><SpotifyPlayer /></ErrorBoundary>;
        return (
            <>
                {settings.store.playerPosition === "account"
                    ? player
                    : <AtTopOfPanels>{player}</AtTopOfPanels>}
                <VencordOriginal {...props} />
            </>
        );
    },

    async start() {
        toggleHoverControls(settings.store.hoverControls);
        await migrateOldLyrics().catch(() => { });
    },

    stop() {
        toggleHoverControls(false);
    },
});
