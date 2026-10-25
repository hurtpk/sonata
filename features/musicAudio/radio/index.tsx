/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Radio: internet radio stations (lofi, news, any genre), your public
// SoundCloud likes and your own music files, playing quietly while you chat.
// A small player in the corner keeps the controls when the window is closed.

import "../../_shared/tool.css";
import "./styles.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { createRoot } from "@webpack/common";

import { NowPlaying, openRadio } from "./Panel";
import { stop, usePlayer } from "./player";
import { loadRadio, settings } from "./store";

const native = () => VencordNative.pluginHelpers.Sonata as any;

/** The small player in the corner, while something is playing. */
function Mini() {
    const p = usePlayer();
    if (!p.item || p.windowOpen) return null;
    return (
        <div className="vc-radio-mini" role="region" aria-label="Radio">
            <button type="button" className="vc-radio-mini-open" title="Open Radio" onClick={openRadio} aria-label="Open Radio" />
            <NowPlaying compact />
        </div>
    );
}
const SafeMini = ErrorBoundary.wrap(Mini, { noop: true });

let host: HTMLDivElement | null = null;
let root: { render(n: React.ReactNode): void; unmount(): void; } | null = null;

export default definePlugin({
    name: "Radio",
    description: "Internet radio stations, your SoundCloud likes and your own music files, playing while you chat. A small player in the corner keeps the controls.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,
    openSettingsModal: () => openRadio(),
    start() {
        void loadRadio();
        host = document.createElement("div");
        host.className = "vc-radio-mini-host";
        document.body.appendChild(host);
        root = createRoot(host);
        root.render(<SafeMini />);
    },
    stop() {
        stop();
        void native().radioStopAll?.();
        root?.unmount();
        root = null;
        host?.remove();
        host = null;
    },
});
