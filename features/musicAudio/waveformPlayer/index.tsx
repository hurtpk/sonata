/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Audio Waveform Player: audio files in chat (mp3, wav, ogg, flac…) play
// in a player that shows the file's waveform — click or drag anywhere on it
// to jump, hover to see the time. Stereo files can show left and right
// separately. Speed, loop, volume and download are built in; ⧉ pops it out
// into a corner player that keeps going while you move around (showing who
// sent it), and "All" plays the channel's audio one after another. Voice
// messages keep Discord's own player.

import "./styles.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore } from "@webpack/common";

import { defineFeatureSettings } from "../../../featureSettings";
import { mountMini, trackOf, unmountMini } from "./mini";
import { audioFilesOf, WaveformPlayer } from "./Player";

const settings = defineFeatureSettings("waveformPlayer", {
    split: {
        type: OptionType.BOOLEAN,
        description: "Show left and right separately for stereo files",
        default: true,
    },
});

const Players = ErrorBoundary.wrap(({ message }: { message: any; }) => {
    const { split } = settings.use(["split"]);
    const guildId = ChannelStore.getChannel(message.channel_id)?.guild_id;
    return <div className="vc-wave-list">{audioFilesOf(message).map(f => <WaveformPlayer key={f.url} file={f} split={!!split} track={trackOf(f, message, guildId)} />)}</div>;
}, { noop: true });

export default definePlugin({
    name: "AudioWaveformPlayer",
    description: "Audio files in chat play in a player with the file's waveform — click or drag to jump, hover for the time, left and right shown separately for stereo files, plus speed, loop, volume and download.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    renderMessageAccessory: ({ message }: Record<string, any>) => audioFilesOf(message).length ? <Players message={message} /> : null,

    start() {
        mountMini();
    },

    stop() {
        unmountMini();
    },
});
