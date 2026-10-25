/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { useEffect, useRef, useState } from "@webpack/common";

import { openSection, registerSection } from "../../_shared/Hub";
import { Window } from "../../_shared/Window";
import { FormGroup, FormRow, Toggle } from "../../_shared/WindowParts";
import { CloseIcon, NextIcon, PauseIcon, PlayIcon, VolumeIcon } from "../waveformPlayer/icons";
import type { Station } from "./native";
import { coverOf, failed, Item, next, play, playerState, position, previous, seek, serverBase, setVolume, shuffled, stop, toggle, useCovers, usePlayer, wantCover, windowOpened } from "./player";
import { addFiles, forgetSoundCloud, isFavorite, loadLikes, MusicFile, playedStation, radioTools, removeFile, settings, stations, toggleFavorite, useRadio } from "./store";

type Tab = "radio" | "soundcloud" | "files";
let lastTab: Tab = "radio";
const GENRES = ["lofi", "chill", "jazz", "classical", "rock", "pop", "hip hop", "electronic", "house", "80s", "k-pop", "anime", "country", "metal", "ambient", "news", "talk"];

/* ── Items for the player ── */

const stationItem = (s: Station): Item => ({ kind: "radio", key: `r:${s.id}`, title: s.name, sub: [s.country, s.tags.slice(0, 2).join(", ")].filter(Boolean).join(" · "), art: s.logo, station: s });
const fileItem = (f: MusicFile): Item => ({ kind: "file", key: `f:${f.id}`, title: f.name, sub: "Your music", file: f });

/* ── Small parts ── */

/** A song's cover (or a station's logo). It's only asked for once it's on screen. */
function Cover({ item, size = 40 }: { item: Item; size?: number; }) {
    useCovers();
    const ref = useRef<HTMLSpanElement>(null);
    const [bad, setBad] = useState<string | null>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { wantCover(item); io.disconnect(); } }, { rootMargin: "300px" });
        io.observe(el);
        return () => io.disconnect();
    }, [item.key]);
    const url = coverOf(item);
    return (
        <span ref={ref} className="vc-radio-cover" style={{ width: size, height: size }}>
            {url && bad !== url
                ? <img className="vc-radio-art" src={url} alt="" width={size} height={size} onError={() => setBad(url)} />
                : <Blank size={size} />}
        </span>
    );
}

function Blank({ size }: { size: number; }) {
    return <span className="vc-radio-art vc-radio-art-none" style={{ width: size, height: size }} aria-hidden>
            <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
        </span>;
}

function PlayButton({ item, queue }: { item: Item; queue?: Item[]; }) {
    const p = usePlayer();
    const on = p.item?.key === item.key;
    const label = on && p.playing ? "Pause" : on && p.loading ? "Loading" : "Play";
    return (
        <button type="button" className={classes("vc-radio-play", on && "vc-radio-play-on")} aria-label={`${label} ${item.title}`} title={label}
            onClick={() => { if (on) toggle(); else { if (item.kind === "radio") playedStation(item.station); void play(item, queue); } }}>
            {on && p.loading ? <span className="vc-radio-spin" /> : on && p.playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
        </button>
    );
}

const clock = (s: number) => { const t = Math.max(0, Math.floor(s)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, x = t % 60; return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(x).padStart(2, "0")}`; };

/** Where the song is, and moving along it. A station is live, so it has none. */
function Scrubber() {
    const p = usePlayer();
    const [, tick] = useState(0);
    const [drag, setDrag] = useState<number | null>(null);
    useEffect(() => { const t = setInterval(() => tick(n => n + 1), 400); return () => clearInterval(t); }, []);
    if (!p.item || p.item.kind === "radio") return null;
    const { time, duration } = position();
    const v = drag ?? time;
    const fill = duration ? `${Math.min(100, (v / duration) * 100)}%` : "0%";
    const commit = () => { if (drag != null) { void seek(drag); setDrag(null); } };
    return (
        <div className="vc-radio-scrub">
            <span>{clock(v)}</span>
            <input type="range" min={0} max={duration || 1} step={1} value={duration ? v : 0} disabled={!duration} aria-label="Where in the song"
                aria-valuetext={`${clock(v)} of ${clock(duration)}`} style={{ "--fill": fill } as React.CSSProperties}
                onChange={e => setDrag(Number(e.currentTarget.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
            <span>{duration ? clock(duration) : "–:––"}</span>
        </div>
    );
}

export function NowPlaying({ compact, onClose }: { compact?: boolean; onClose?(): void; }) {
    const p = usePlayer();
    const vol = settings.store.volume ?? 70;
    if (!p.item) return null;
    const many = p.queue.length > 1 && p.item.kind !== "radio";
    return (
        <div className={classes("vc-radio-now", compact && "vc-radio-now-compact")}>
        <div className="vc-radio-now-row">
            <Cover item={p.item} size={compact ? 42 : 56} />
            <div className="vc-radio-now-text">
                <b title={p.item.title}>{p.item.title}</b>
                <span>{p.error ?? (p.loading ? "Loading…" : p.item.kind === "radio" ? `Live${p.item.sub ? ` · ${p.item.sub}` : ""}` : p.item.sub ?? "")}{many ? ` · ${p.at + 1} of ${p.queue.length}` : ""}</span>
            </div>
            <div className="vc-radio-now-tools">
                {many && <button type="button" className="vc-radio-ctl vc-radio-prev" aria-label="Previous" title="Previous" onClick={() => void previous()}><NextIcon /></button>}
                <button type="button" className="vc-radio-ctl vc-radio-ctl-main" aria-label={p.playing ? "Pause" : "Play"} onClick={toggle}>{p.loading ? <span className="vc-radio-spin" /> : p.playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}</button>
                {many && <button type="button" className="vc-radio-ctl" aria-label="Next" title="Next" onClick={() => void next()}><NextIcon /></button>}
                {!compact && (
                    <label className="vc-radio-vol" title={`Volume ${vol}%`}>
                        <button type="button" className="vc-radio-ctl" aria-label={vol ? "Mute" : "Unmute"} onClick={() => setVolume(vol ? 0 : 70)}><VolumeIcon level={vol / 100} /></button>
                        <input type="range" min={0} max={100} value={vol} aria-label="Volume" style={{ "--fill": `${vol}%` } as React.CSSProperties} onChange={e => setVolume(Number(e.currentTarget.value))} />
                    </label>
                )}
                <button type="button" className="vc-radio-ctl" aria-label="Stop" title="Stop" onClick={() => { stop(); onClose?.(); }}><CloseIcon /></button>
            </div>
        </div>
            <Scrubber />
        </div>
    );
}

/* ── Radio stations ── */

function StationRow({ s, list }: { s: Station; list: Station[]; }) {
    useRadio();
    const fav = isFavorite(s.id);
    const item = stationItem(s);
    return (
        <div className={classes("vc-radio-row", playerState().item?.key === item.key && "vc-radio-row-on")}>
            <PlayButton item={item} queue={list.map(stationItem)} />
            <Cover item={item} size={36} />
            <span className="vc-radio-row-text">
                <b title={s.name}>{s.name}</b>
                <span>{[s.country, s.tags.slice(0, 3).join(", "), s.bitrate ? `${s.bitrate} kbps` : null].filter(Boolean).join(" · ")}</span>
            </span>
            {failed.get(item.key) && <span className="vc-radio-bad" title={failed.get(item.key)}>not working</span>}
            <button type="button" className={classes("vc-radio-star", fav && "vc-radio-star-on")} aria-pressed={fav} aria-label={fav ? "Remove from your stations" : "Add to your stations"} title={fav ? "In your stations" : "Add to your stations"} onClick={() => toggleFavorite(s)}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" /></svg>
            </button>
        </div>
    );
}

function RadioTab() {
    const saved = useRadio();
    const [query, setQuery] = useState("");
    const [genre, setGenre] = useState<string | null>(null);
    const [list, setList] = useState<Station[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const load = async (by: "top" | "tag" | "name", v = "") => {
        setBusy(true); setError(null);
        const r = await stations(by, v);
        setBusy(false);
        if (typeof r === "string") setError(r); else setList(r);
    };
    useEffect(() => { void load("top"); }, []);
    const heading = query.trim() && !genre ? `Stations called “${query.trim()}”` : genre ? `${genre[0].toUpperCase()}${genre.slice(1)} stations` : "Most played";
    return (
        <>
            <div className="vc-radio-bar">
                <input className="vc-tool-input" value={query} placeholder="Search stations, like BBC Radio 1 or Lofi Girl" aria-label="Search stations"
                    onChange={e => setQuery(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter" && query.trim()) { setGenre(null); void load("name", query); } }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!query.trim() || busy} onClick={() => { setGenre(null); void load("name", query); }}>Search</button>
            </div>
            <div className="vc-radio-genres">
                {GENRES.map(g => <button key={g} type="button" className={classes("vc-radio-genre", genre === g && "vc-radio-genre-on")} onClick={() => { setGenre(g); setQuery(""); void load("tag", g); }}>{g}</button>)}
            </div>
            {saved.favorites.length > 0 && <FormGroup title={`Your stations · ${saved.favorites.length}`}>{saved.favorites.map(s => <StationRow key={s.id} s={s} list={saved.favorites} />)}</FormGroup>}
            <FormGroup title={busy ? "Loading…" : heading}>
                {error && <div className="vc-tool-hint vc-radio-pad">{error}</div>}
                {list && !list.length && <div className="vc-tool-hint vc-radio-pad">No stations found. Try another word.</div>}
                {list?.map(s => <StationRow key={s.id} s={s} list={list} />)}
            </FormGroup>
        </>
    );
}

/* ── SoundCloud ── */

function SoundCloudTab() {
    const saved = useRadio();
    const [tools, setTools] = useState<{ ytdlp: boolean; ffmpeg: boolean; } | null>(null);
    const [profile, setProfile] = useState(saved.scUser ? `soundcloud.com/${saved.scUser}` : "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [q, setQ] = useState("");
    useEffect(() => { void radioTools().then(setTools); }, []);
    usePlayer();
    const load = async () => { setBusy(true); setError(null); setError(await loadLikes(profile)); setBusy(false); };
    const tracks = saved.scTracks ?? [];
    const items: Item[] = tracks.map(t => ({ kind: "sc", key: `s:${t.id}`, title: t.title, sub: t.artist, track: t }));
    const shown = items.filter(i => !q.trim() || `${i.title} ${i.sub}`.toLowerCase().includes(q.trim().toLowerCase()));
    if (tools && (!tools.ytdlp || !tools.ffmpeg)) return (
        <div className="vc-radio-note">
            <b>SoundCloud needs yt-dlp</b>
            <span>It's the free program Media Downloader uses too. Install it once by running this in PowerShell or Command Prompt, then reopen this window:</span>
            <code>winget install yt-dlp</code>
        </div>
    );
    return (
        <>
            <div className="vc-radio-bar">
                <input className="vc-tool-input" value={profile} placeholder="Your SoundCloud profile, like soundcloud.com/yourname" aria-label="SoundCloud profile"
                    onChange={e => setProfile(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") void load(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || !profile.trim()} onClick={() => void load()}>{busy ? "Loading…" : saved.scUser ? "Reload likes" : "Load likes"}</button>
            </div>
            {error && <div className="vc-tool-hint">{error}</div>}
            {!saved.scUser && !error && <div className="vc-tool-hint">Only public likes can be listed — no sign-in. Some songs are copy-protected by SoundCloud and can only be played there; they're marked if you try one.</div>}
            {tracks.length > 0 && (
                <>
                    <div className="vc-radio-bar">
                        <button type="button" className="vc-tool-btn" onClick={() => void play(items[0], items)}>Play all</button>
                        <button type="button" className="vc-tool-btn" onClick={() => { const s = shuffled(items); void play(s[0], s); }}>Shuffle</button>
                        <input className="vc-tool-input" value={q} placeholder={`Search ${tracks.length} likes`} aria-label="Search likes" onChange={e => setQ(e.currentTarget.value)} />
                        <button type="button" className="vc-tool-btn" onClick={forgetSoundCloud}>Forget</button>
                    </div>
                    <FormGroup title={`${saved.scUser}'s likes · ${tracks.length}`}>
                        {shown.map(i => (
                            <div key={i.key} className={classes("vc-radio-row", playerState().item?.key === i.key && "vc-radio-row-on")}>
                                <PlayButton item={i} queue={items} />
                                <Cover item={i} size={40} />
                                <span className="vc-radio-row-text"><b title={i.title}>{i.title}</b><span>{i.sub}</span></span>
                                {failed.get(i.key) && <span className="vc-radio-bad" title={failed.get(i.key)}>{/DRM|copy/i.test(failed.get(i.key)!) ? "copy-protected" : "can't play"}</span>}
                                <a className="vc-tool-btn vc-radio-small" href={i.kind === "sc" ? i.track.url : undefined} target="_blank" rel="noreferrer">SoundCloud</a>
                            </div>
                        ))}
                    </FormGroup>
                </>
            )}
        </>
    );
}

/* ── Your files ── */

function FilesTab() {
    const saved = useRadio();
    usePlayer();
    const [note, setNote] = useState<string | null>(null);
    const items = saved.files.filter(f => !f.missing).map(fileItem);
    const sizeOf = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
    return (
        <>
            <div className="vc-radio-bar">
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={async () => { const n = await addFiles(); setNote(n ? `Added ${n} song${n === 1 ? "" : "s"}.` : null); }}>Add music…</button>
                {items.length > 0 && <button type="button" className="vc-tool-btn" onClick={() => void play(items[0], items)}>Play all</button>}
                {items.length > 1 && <button type="button" className="vc-tool-btn" onClick={() => { const s = shuffled(items); void play(s[0], s); }}>Shuffle</button>}
                {note && <span className="vc-tool-hint">{note}</span>}
            </div>
            {!saved.files.length ? (
                <div className="vc-tool-empty">
                    <span className="vc-tool-empty-icon">🎵</span>
                    Add MP3, M4A, FLAC, WAV or OGG files from your computer. They stay where they are — nothing is copied or uploaded.
                </div>
            ) : (
                <FormGroup title={`Your music · ${saved.files.length}`}>
                    {saved.files.map(f => {
                        const item = fileItem(f);
                        return (
                            <div key={f.id} className={classes("vc-radio-row", playerState().item?.key === item.key && "vc-radio-row-on", f.missing && "vc-radio-row-missing")}>
                                {f.missing ? <span className="vc-radio-play" aria-hidden /> : <PlayButton item={item} queue={items} />}
                                {!f.missing && <Cover item={item} size={40} />}
                                <span className="vc-radio-row-text"><b title={f.path}>{f.name}</b><span>{f.missing ? "Moved or deleted — add it again from its new place" : `${sizeOf(f.size)} · ${f.path}`}</span></span>
                                <button type="button" className="vc-tool-btn vc-radio-small" onClick={() => { if (playerState().item?.key === item.key) stop(); removeFile(f.id); }}>Remove</button>
                            </div>
                        );
                    })}
                </FormGroup>
            )}
        </>
    );
}

export function RadioWindow({ modalProps }: { modalProps: RenderModalProps; }) {
    const [tab, setTabState] = useState<Tab>(lastTab);
    const setTab = (t: Tab) => { lastTab = t; setTabState(t); };
    const [ready, setReady] = useState(false);
    const p = usePlayer();
    useEffect(() => { void serverBase().then(() => setReady(true)); windowOpened(1); return () => windowOpened(-1); }, []);
    return (
        <Window {...modalProps} size="lg" title="Radio" subtitle="Radio stations, your SoundCloud likes and your own music"
            tabs={[["radio", "Radio"], ["soundcloud", "SoundCloud"], ["files", "My music"]]} tab={tab} onTab={id => setTab(id as Tab)}
            status={[p.item ? (p.playing ? `playing ${p.item.title.toLowerCase()}` : p.loading ? "loading…" : "paused") : "nothing playing", "keeps playing when this closes"]}
            statusRight="radio-browser.info · soundcloud via yt-dlp">
            <div className="vc-tool-wrap vc-radio" key={String(ready)}>
                <NowPlaying />
                {tab === "radio" && <RadioTab />}
                {tab === "soundcloud" && <SoundCloudTab />}
                {tab === "files" && <FilesTab />}
                {tab !== "radio" && (
                    <FormGroup>
                        <FormRow label="Start again from the top" help="When a list ends, play it again.">
                            <Toggle value={!!settings.store.repeat} label="Repeat" onChange={v => { settings.store.repeat = v; }} />
                        </FormRow>
                    </FormGroup>
                )}
            </div>
        </Window>
    );
}

registerSection("musicAudio", { id: "radio", feature: "radio", name: "Radio", sub: "Stations, SoundCloud and your music", render: p => <RadioWindow modalProps={p} /> });
export const openRadio = () => openSection("musicAudio", "radio");
