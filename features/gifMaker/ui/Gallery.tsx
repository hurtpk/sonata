/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The start window (make a GIF from your computer) and the gallery of GIFs
// you've made — send one again, save it, or open it in the editor again.

import { getCurrentChannel } from "@utils/discord";
import { saveFile } from "@utils/web";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, React, showToast, UploadHandler, useEffect, useMemo, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { Window } from "../../_shared/Window";
import { getRecent, Recent, removeRecent } from "../store";
import { cl } from "./controls";
import { openEditor, pickFiles } from "./Editor";

const tint = () => { const a = windowAccent("gifMaker"); return a ? ({ "--vc-tool-accent": a } as React.CSSProperties) : undefined; };

const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

function RecentCard({ r, onRemove, close }: { r: Recent; onRemove(): void; close(): void; }) {
    const [sure, setSure] = useState(false);
    const url = useMemo(() => URL.createObjectURL(r.blob), [r]);
    useEffect(() => () => URL.revokeObjectURL(url), [url]);
    const file = () => new File([r.blob], r.name, { type: r.type });
    const send = () => {
        const channel = getCurrentChannel();
        if (!channel) return showToast("Open a channel to send it to", "failure");
        UploadHandler.promptToUpload([file()], channel, 0);
        close();
    };
    const reEdit = () => {
        close();
        if (r.inputs?.length) openEditor(r.inputs, { state: r.state });
        else {
            // Made from files on your computer: edit the GIF itself instead.
            const own = URL.createObjectURL(r.blob);
            openEditor([{ url: own, isVideo: r.type.startsWith("video/"), isGif: r.type === "image/gif" }], { ownedUrls: [own] });
        }
    };
    return (
        <div className={cl("recent")}>
            <div className={cl("recent-art", "checker")}>
                {r.type.startsWith("video/") ? <video src={url} muted autoPlay loop playsInline /> : <img src={url} alt="" />}
            </div>
            <div className={cl("recent-meta")}>
                <span>{r.width}×{r.height} · {(r.blob.size / 1024 / 1024 >= 1 ? `${(r.blob.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(r.blob.size / 1024))} KB`)}</span>
                <span className={cl("hint")}>{ago(r.at)}</span>
            </div>
            <div className={cl("recent-actions")}>
                <button type="button" onClick={send} title="Send it again">Send</button>
                <button type="button" onClick={() => saveFile(file())} title="Save to your computer">Save</button>
                <button type="button" onClick={reEdit} title={r.inputs?.length ? "Open the original edit again" : "Edit this GIF"}>Edit</button>
                <button type="button" className={cl("recent-x", sure && "recent-sure")} onClick={() => sure ? onRemove() : setSure(true)} onMouseLeave={() => setSure(false)} title="Remove from this list">{sure ? "Sure?" : "✕"}</button>
            </div>
        </div>
    );
}

function RecentModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [list, setList] = useState<Recent[] | null>(null);
    useEffect(() => void getRecent().then(setList), []);
    return (
        <Window {...modalProps} size="lg" title="Recent GIFs" subtitle="The last GIFs you made — send one again, save it or keep editing">
            <div className="vc-tool-wrap" style={tint()}>
                <div className={cl("recents")}>
                    {list == null ? <span className={cl("hint")}>Loading…</span>
                        : !list.length ? <div className="vc-tool-empty"><span className="vc-tool-empty-icon">🎞️</span>Nothing yet — GIFs you send or save from GIF Maker show up here.</div>
                            : list.map(r => <RecentCard key={r.id} r={r} close={modalProps.onClose} onRemove={() => void removeRecent(r.id).then(setList)} />)}
                </div>
            </div>
        </Window>
    );
}

export const openRecent = () => openModal(props => <RecentModal modalProps={props} />);

function StartModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [count, setCount] = useState(0);
    useEffect(() => void getRecent().then(l => setCount(l.length)), []);
    const fromComputer = async () => {
        const { inputs, urls } = await pickFiles();
        if (!inputs.length) return;
        modalProps.onClose();
        openEditor(inputs, { ownedUrls: urls });
    };
    return (
        <Window {...modalProps} size="lg" title="GIF Maker" subtitle="Make a GIF from a video, a GIF or pictures">
            <div className="vc-tool-wrap" style={tint()}>
            <div className={cl("start")}>
                <button type="button" className={cl("start-card")} onClick={fromComputer}>
                    <span className={cl("start-icon")}>📁</span>
                    <span className={cl("start-title")}>From my computer</span>
                    <span className={cl("hint")}>A video, a GIF or a picture — or pick several pictures for a slideshow.</span>
                </button>
                <button type="button" className={cl("start-card")} onClick={() => { modalProps.onClose(); openRecent(); }}>
                    <span className={cl("start-icon")}>🕘</span>
                    <span className={cl("start-title")}>Recent GIFs{count ? ` · ${count}` : ""}</span>
                    <span className={cl("hint")}>Send one again, save it, or keep editing.</span>
                </button>
            </div>
            <p className={cl("hint", "start-tip")}>Or right-click any picture, GIF or video in chat → <b>Make GIF</b>. Several pictures in one message → <b>Make slideshow GIF</b>.</p>
            </div>
        </Window>
    );
}

export const openStart = () => openModal(props => <StartModal modalProps={props} />);
