/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The downloader window: paste a link (or open it from a message), see what
// it is, pick video or audio and a quality, and download. Below, everything
// you've downloaded — with progress while it's going, then open it, show it
// in its folder, or attach it to a message.

import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, DraftType, Modal, openModal, SelectedChannelStore, showToast, UploadHandler, useEffect, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { isSpotify, siteOf } from "./links";
import { cancelDownload, clearFinished, Info, isActive, Item, native, removeItem, settings, startDownload, useItems } from "./store";

interface Setup { ytdlp: string | null; version: string | null; ffmpeg: string | null; folder: string; }

const QUALITIES: [number, string][] = [[0, "Best"], [2160, "4K"], [1440, "1440p"], [1080, "1080p"], [720, "720p"], [480, "480p"], [360, "360p"]];

const length = (s: number | null) => {
    if (s == null) return null;
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
const sizeOf = (n?: number) => !n ? "" : n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const fileName = (p?: string) => p?.split(/[\\/]/).pop() ?? "";

/* ── Not installed yet ── */

function Missing({ onRecheck }: { onRecheck(): void; }) {
    return (
        <section className="vc-dl-missing">
            <b>yt-dlp isn't installed yet</b>
            <span>It's the free program that does the downloading. Install it once by running this in a terminal (PowerShell or Command Prompt):</span>
            <code className="vc-dl-cmd">winget install yt-dlp</code>
            <span className="vc-tool-hint">If you've just installed it, it should be found straight away — press Check again. If not, restart Discord fully (right-click its tray icon → Quit, then open it).</span>
            <div className="vc-tool-row"><button type="button" className="vc-tool-btn vc-tool-primary" onClick={onRecheck}>Check again</button></div>
        </section>
    );
}

/* ── The link you're about to download ── */

function Picker({ info, setup, onDone }: { info: Info; setup: Setup; onDone(): void; }) {
    const s = settings.use(["mode", "quality", "audio"]);
    const [mode, setMode] = useState<"video" | "audio">(info.hasVideo ? (s.mode === "audio" ? "audio" : "video") : "audio");
    // The qualities this video actually has (its real heights, the common ones first), or the usual list when the site doesn't say.
    const offered: [number, string][] = info.heights.length
        ? [[0, "Best"], ...[...new Set(info.heights)].filter(h => h >= 144).slice(0, 6).map(h => [h, h >= 2160 ? "4K" : `${h}p`] as [number, string])]
        : QUALITIES;
    const [quality, setQuality] = useState(() => offered.some(([h]) => h === s.quality) ? s.quality : 0);
    const [audio, setAudio] = useState<"mp3" | "original">(s.audio === "original" || !setup.ffmpeg ? "original" : "mp3");
    const [busy, setBusy] = useState(false);

    const go = async () => {
        setBusy(true);
        settings.store.mode = mode;
        if (mode === "video") settings.store.quality = quality; else settings.store.audio = audio;
        if (await startDownload(info, mode, quality, audio)) onDone();
        setBusy(false);
    };

    return (
        <section className="vc-dl-card">
            {info.thumbnail ? <img className="vc-dl-thumb" src={info.thumbnail} alt="" /> : <div className="vc-dl-thumb vc-dl-thumb-none">{info.hasVideo ? "🎬" : "🎵"}</div>}
            <div className="vc-dl-card-main">
                <b className="vc-dl-title" title={info.title}>{info.title}</b>
                <span className="vc-tool-hint">{[info.uploader, info.site, length(info.duration)].filter(Boolean).join(" · ")}</span>
                {info.isLive && <span className="vc-dl-warn">This is live right now — it can only be downloaded once the stream has ended.</span>}

                {info.hasVideo && (
                    <div className="vc-tool-seg">
                        <button type="button" className={classes("vc-tool-seg-btn", mode === "video" && "vc-tool-seg-on")} onClick={() => setMode("video")}>🎬 Video</button>
                        <button type="button" className={classes("vc-tool-seg-btn", mode === "audio" && "vc-tool-seg-on")} onClick={() => setMode("audio")}>🎵 Audio only</button>
                    </div>
                )}
                <div className="vc-tool-chips">
                    {mode === "video"
                        ? offered.map(([h, label]) => <button key={h} type="button" className={classes("vc-tool-chip", quality === h && "vc-tool-chip-on")} onClick={() => setQuality(h)}>{label}</button>)
                        : <>
                            <button type="button" disabled={!setup.ffmpeg} title={setup.ffmpeg ? "Converted to MP3, with the title, artist and cover art" : "Needs FFmpeg — see below"} className={classes("vc-tool-chip", audio === "mp3" && "vc-tool-chip-on")} onClick={() => setAudio("mp3")}>MP3</button>
                            <button type="button" title="The site's own audio file (usually M4A or Opus) — best quality, no converting" className={classes("vc-tool-chip", audio === "original" && "vc-tool-chip-on")} onClick={() => setAudio("original")}>Original</button>
                        </>}
                </div>
                <div className="vc-tool-row">
                    <span className="vc-tool-hint">{mode === "video" ? "MP4 that plays everywhere, including in Discord." : audio === "mp3" ? "MP3 with the title and cover art." : "The original audio, untouched."}</span>
                    <span className="vc-tool-spacer" />
                    <button type="button" className="vc-tool-btn" onClick={onDone}>Cancel</button>
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || info.isLive} onClick={() => void go()}>⬇ Download</button>
                </div>
            </div>
        </section>
    );
}

/* ── Your downloads ── */

async function sendInChat(i: Item) {
    const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    if (!channel) return showToast("Open a chat first", "failure");
    const bytes: Uint8Array | null = await native().dlReadFile(i.job.file);
    if (!bytes) return showToast("That file is too big to attach (over 500 MB), or it's been moved", "failure");
    const name = fileName(i.job.file);
    const type = /\.mp3$/i.test(name) ? "audio/mpeg" : /\.(m4a|aac)$/i.test(name) ? "audio/mp4" : /\.(opus|ogg)$/i.test(name) ? "audio/ogg" : /\.webm$/i.test(name) ? "video/webm" : "video/mp4";
    UploadHandler.promptToUpload([new File([bytes as BlobPart], name, { type })], channel, DraftType.ChannelMessage);
    showToast("Added to your message — Discord tells you if it's too big for your upload limit", "success");
}

function Row({ i, close }: { i: Item; close(): void; }) {
    const active = isActive(i);
    const j = i.job;
    return (
        <div className={classes("vc-dl-row", j.status === "error" && "vc-dl-row-error", j.status === "done" && "vc-dl-row-done")}>
            {i.thumbnail ? <img className="vc-dl-rthumb" src={i.thumbnail} alt="" /> : <span className="vc-dl-rthumb vc-dl-thumb-none">{i.mode === "audio" ? "🎵" : "🎬"}</span>}
            <div className="vc-dl-rmain">
                <b title={i.title}>{i.title}</b>
                {active ? (
                    <>
                        <div className="vc-dl-bar"><i style={{ width: `${j.status === "processing" ? 100 : j.percent}%` }} className={j.status === "processing" ? "vc-dl-bar-busy" : undefined} /></div>
                        <span className="vc-tool-hint">
                            {j.status === "starting" ? "Starting…" : j.status === "processing" ? (i.mode === "audio" ? "Converting…" : "Putting the video and sound together…") : `${j.percent.toFixed(0)}%${j.speed ? ` · ${j.speed}` : ""}${j.eta ? ` · ${j.eta} left` : ""}`}
                        </span>
                    </>
                ) : (
                    <span className={classes("vc-tool-hint", j.status === "error" && "vc-dl-err")}>
                        {j.status === "done" ? [i.mode === "audio" ? "🎵 Audio" : "🎬 Video", sizeOf(j.size), i.site, new Date(i.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })].filter(Boolean).join(" · ")
                            : j.status === "cancelled" ? "Cancelled" : j.error ?? "Didn't work"}
                    </span>
                )}
            </div>
            <div className="vc-dl-ractions">
                {active
                    ? <button type="button" className="vc-tool-btn" onClick={() => void cancelDownload(i.id)}>Cancel</button>
                    : <>
                        {j.status === "done" && <button type="button" className="vc-tool-btn" title="Open it" onClick={() => void native().dlOpen(j.file)}>▶</button>}
                        {j.status === "done" && <button type="button" className="vc-tool-btn" title="Show it in its folder" onClick={() => void native().dlReveal(j.file)}>📂</button>}
                        {j.status === "done" && <button type="button" className="vc-tool-btn" title="Attach it to a message in the chat you have open" onClick={() => { void sendInChat(i); close(); }}>💬 Send</button>}
                        <button type="button" className="vc-dl-x" title="Remove from this list (the file stays)" aria-label="Remove from list" onClick={() => removeItem(i.id)}>✕</button>
                    </>}
            </div>
        </div>
    );
}

/* ── The window ── */

function DownloaderModal({ modalProps, start }: { modalProps: RenderModalProps; start?: string; }) {
    const accent = windowAccent("mediaDownloader");
    const items = useItems();
    const s = settings.use(["folder"]);
    const [setup, setSetup] = useState<Setup | null>(null);
    const [url, setUrl] = useState(start ?? "");
    const [looking, setLooking] = useState(false);
    const [info, setInfo] = useState<Info | null>(null);
    const [error, setError] = useState<string | null>(null);

    const check = () => void native().dlCheck().then(setSetup).catch(() => setSetup({ ytdlp: null, version: null, ffmpeg: null, folder: "" }));
    useEffect(check, []);

    const lookUp = async (u = url) => {
        const link = u.trim();
        setInfo(null); setError(null);
        if (!/^https?:\/\//i.test(link)) { setError("Paste a link that starts with https://"); return; }
        if (isSpotify(link)) { setError("Spotify songs are copy-protected (DRM), so they can't be downloaded. Spotify Premium can save them for offline listening in the Spotify app."); return; }
        setLooking(true);
        const r = await native().dlInfo(link).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
        setLooking(false);
        if (r.ok) setInfo(r.info); else setError(r.error);
    };
    // Opened from a message: look it up straight away (once yt-dlp is found).
    useEffect(() => { if (start && setup?.ytdlp) void lookUp(start); }, [setup?.ytdlp]);

    const paste = async () => {
        try { const t = (await navigator.clipboard.readText()).trim(); setUrl(t); void lookUp(t); } catch { showToast("Couldn't read the clipboard", "failure"); }
    };
    const pickFolder = async () => { const f = await native().dlPickFolder(s.folder || setup?.folder); if (f) settings.store.folder = f; };

    const folder = s.folder || setup?.folder || "";
    const done = items.filter(i => !isActive(i)).length;
    const running = items.filter(isActive).length;

    return (
        <Modal {...modalProps} size="lg" title="Media Downloader" subtitle="Save videos and music from YouTube, SoundCloud, TikTok, Instagram, X, Reddit and a thousand more sites">
            <div className="vc-tool-wrap vc-dl" style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="⬇️" kicker="Media Downloader" title={running ? `Downloading ${running}…` : "Paste a link"}
                    sub={setup?.version ? `yt-dlp ${setup.version}${setup.ffmpeg ? " · FFmpeg ready" : ""}` : "Videos as MP4, music as MP3 — saved on your computer."}
                    numbers={[{ value: done, label: done === 1 ? "download" : "downloads" }]} />

                {setup && !setup.ytdlp ? <Missing onRecheck={check} /> : (
                    <>
                        <div className="vc-dl-input">
                            <input className="vc-tool-input vc-tool-grow" autoFocus={!start} value={url} placeholder="https://www.youtube.com/watch?v=…  ·  soundcloud.com/…  ·  tiktok.com/@…"
                                onChange={e => { setUrl(e.currentTarget.value); setError(null); }} onKeyDown={e => { if (e.key === "Enter") void lookUp(); }} />
                            <button type="button" className="vc-tool-btn" onClick={() => void paste()}>📋 Paste</button>
                            <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!url.trim() || looking || !setup} onClick={() => void lookUp()}>{looking ? "Looking…" : "Look up"}</button>
                        </div>
                        {url && !info && !error && !looking && siteOf(url) && <span className="vc-tool-hint">{siteOf(url)} link — press Look up.</span>}
                        {looking && <div className="vc-dl-looking"><span className="vc-dl-spinner" />Asking {siteOf(url) ?? "the site"} what this is…</div>}
                        {error && <div className="vc-dl-error">{error}</div>}
                        {info && setup && <Picker info={info} setup={setup} onDone={() => { setInfo(null); setUrl(""); }} />}

                        {setup && !setup.ffmpeg && (
                            <span className="vc-dl-note">FFmpeg wasn't found, so MP3s and HD video with sound are off (you'll get the site's own files). Get it with <code>winget install yt-dlp.FFmpeg</code>, then press <button type="button" className="vc-tool-link" onClick={check}>Check again</button>.</span>
                        )}
                        <div className="vc-tool-row">
                            <span className="vc-tool-hint" title={folder}>Saves to <b>{folder || "…"}</b></span>
                            <button type="button" className="vc-tool-link" onClick={() => void pickFolder()}>Change</button>
                            {s.folder && <button type="button" className="vc-tool-link" onClick={() => { settings.store.folder = ""; }}>Reset</button>}
                            <span className="vc-tool-spacer" />
                            {folder && <button type="button" className="vc-tool-link" onClick={() => void native().dlReveal(folder)}>Open folder</button>}
                        </div>
                    </>
                )}

                {items.length > 0 && (
                    <section className="vc-dl-list">
                        <div className="vc-tool-row">
                            <span className="vc-tool-label">Your downloads · {items.length}</span>
                            <span className="vc-tool-spacer" />
                            {done > 0 && <button type="button" className="vc-tool-link" onClick={clearFinished}>Clear list</button>}
                        </div>
                        {items.map(i => <Row key={i.id} i={i} close={modalProps.onClose} />)}
                    </section>
                )}
                <span className="vc-tool-hint">What you save is up to you — keep to things you're allowed to download. Private and sign-in-only posts can't be downloaded.</span>
            </div>
        </Modal>
    );
}

export const openDownloader = (start?: string) => openModal(props => <DownloaderModal modalProps={props} start={start} />);
