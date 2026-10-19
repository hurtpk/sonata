/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, showToast, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { allSounds, CATEGORIES, Category, clearSounds, customSounds, exportPack, importPack, isAudioFile, onSoundsChange, preview, previewOriginal, removeSound, setSoundFile, SoundInfo, stopPreview, updateSound } from "./sounds";

const cl = classNameFactory("vc-tool-");
const ss = classNameFactory("vc-sstudio-");

const PlayIcon = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>;

function SoundRow({ sound, onError }: { sound: SoundInfo; onError(msg: string): void; }) {
    const custom = customSounds()[sound.id];
    const [over, setOver] = useState(false);
    const [busy, setBusy] = useState(false);
    const input = useRef<HTMLInputElement>(null);

    const use = async (file?: File | null) => {
        if (!file) return;
        setBusy(true);
        try {
            await setSoundFile(sound.id, file);
            showToast(`${sound.name} now uses ${file.name}`, "success");
        } catch (e: any) { onError(String(e?.message ?? e)); } finally { setBusy(false); }
    };

    return (
        <div className={classes(ss("row"), custom && ss("row-custom"), custom && !custom.enabled && ss("row-off"), over && ss("row-drop"))}
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); use(Array.from(e.dataTransfer.files).find(isAudioFile)); }}>
            <button type="button" className={ss("play")} title="Play Discord's sound" aria-label={`Play Discord's ${sound.name} sound`} onClick={() => previewOriginal(sound.id)}><PlayIcon /></button>
            <div className={ss("info")}>
                <div className={ss("name")}>{sound.name}</div>
                <div className={ss("sub")}>{custom ? <>Yours: <b>{custom.fileName}</b></> : over ? "Drop to use this file" : "Discord's sound"}</div>
            </div>
            {custom && (
                <div className={ss("custom")}>
                    <button type="button" className={classes(ss("play"), ss("play-custom"))} title="Play your sound" aria-label={`Play your ${sound.name} sound`} onClick={() => preview(custom.dataUri, custom.volume)}><PlayIcon /></button>
                    <label className={ss("volume")} title="Volume of your sound">
                        <input type="range" min={0} max={100} value={custom.volume} onChange={e => updateSound(sound.id, { volume: Number(e.currentTarget.value) })} />
                        <span>{custom.volume}%</span>
                    </label>
                    <button type="button" role="switch" aria-checked={custom.enabled} title={custom.enabled ? "On — click to use Discord's sound for now" : "Off — click to use yours again"}
                        className={classes(ss("switch"), custom.enabled && ss("switch-on"))} onClick={() => updateSound(sound.id, { enabled: !custom.enabled })}><i /></button>
                </div>
            )}
            <button type="button" className={cl("btn")} disabled={busy} onClick={() => input.current?.click()}>{busy ? "Loading…" : custom ? "Replace" : "Upload"}</button>
            {custom && <button type="button" className={classes(cl("btn"), ss("remove"))} title="Go back to Discord's sound" onClick={() => removeSound(sound.id)}>×</button>}
            <input ref={input} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,.mp3,.wav,.ogg,.oga,.m4a" hidden
                onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; use(f); }} />
        </div>
    );
}

function StudioModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const accent = windowAccent("soundStudio");
    const [, rerender] = useState(0);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<Category | "all" | "mine">("all");
    const [error, setError] = useState<string | null>(null);
    const packInput = useRef<HTMLInputElement>(null);
    const sounds = useMemo(allSounds, []);

    useEffect(() => onSoundsChange(() => rerender(n => n + 1)), []);
    useEffect(() => () => stopPreview(), []);

    const mine = customSounds();
    const count = Object.keys(mine).length;
    const q = query.trim().toLowerCase();
    const shown = sounds.filter(s =>
        (category === "all" || (category === "mine" ? !!mine[s.id] : s.category === category))
        && (!q || s.name.toLowerCase().includes(q) || s.id.includes(q)));

    const download = () => {
        const url = URL.createObjectURL(new Blob([exportPack()], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "sonata-sounds.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    };

    return (
        <Modal {...modalProps} size="lg" title="Sound Studio" subtitle="Swap any of Discord's sounds for your own MP3, WAV or OGG">
            <div className={classes(cl("wrap"), ss("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="🔊" kicker="Sound Studio"
                    title={count ? `${count} sound${count === 1 ? "" : "s"} made yours` : "Every sound is Discord's own"}
                    sub={count ? `${Object.values(mine).filter(m => m.enabled).length} on right now · drop a file on any row to swap it` : "Drop an MP3, WAV or OGG on any sound below to make it yours."}
                    numbers={[{ value: count, label: "changed" }, { value: sounds.length, label: "sounds" }]}>
                    <button type="button" className={cl("btn")} disabled={!count} onClick={download} title="Save all your sounds as one file, to back up or share">Export pack</button>
                    <button type="button" className={cl("btn")} onClick={() => packInput.current?.click()}>Import pack</button>
                </ToolHero>
                <div className={cl("row")}>
                    <input className={classes(cl("input"), cl("grow"))} value={query} placeholder={`Search ${sounds.length} sounds…`} onChange={e => setQuery(e.currentTarget.value)} />
                    <input ref={packInput} type="file" accept=".json,application/json" hidden onChange={async e => {
                        const f = e.currentTarget.files?.[0];
                        e.currentTarget.value = "";
                        if (!f) return;
                        try { const n = await importPack(await f.text()); showToast(`Imported ${n} sound${n === 1 ? "" : "s"}`, "success"); } catch (err: any) { setError(String(err?.message ?? err)); }
                    }} />
                </div>
                <div className={ss("chips")}>
                    {(["all", ...CATEGORIES, "mine"] as const).map(c => (
                        <button key={c} type="button" className={classes(ss("chip"), category === c && ss("chip-on"))} onClick={() => setCategory(c)}>
                            {c === "all" ? "All" : c === "mine" ? `Changed (${count})` : c}
                        </button>
                    ))}
                </div>
                <div className={cl("hint")}>Press ▶ on the left to hear Discord's sound. Upload a file, or drop one onto a row. Your sound plays at Discord's notification volume, scaled by its own slider.</div>

                <div className={ss("list")}>
                    {shown.map(s => <SoundRow key={s.id} sound={s} onError={setError} />)}
                    {!shown.length && <div className={cl("empty")}><span className={cl("empty-icon")}>🔇</span>{category === "mine" ? "You haven't changed any sounds yet." : `No sound matches “${query}”.`}</div>}
                </div>

                {error && <div className={cl("error")}>{error}</div>}
                <div className={cl("footer")}>
                    <span className={cl("hint")}>{count ? `${count} sound${count === 1 ? "" : "s"} changed` : "Nothing changed yet"}</span>
                    <span className={cl("spacer")} />
                    {count > 0 && <button type="button" className={classes(cl("btn"), cl("danger"))} onClick={() => { if (confirm("Put every sound back to Discord's own?")) clearSounds(); }}>Reset all</button>}
                    <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={modalProps.onClose}>Done</button>
                </div>
            </div>
        </Modal>
    );
}

export function openSoundStudio() {
    openModal(props => <StudioModal modalProps={props} />);
}
