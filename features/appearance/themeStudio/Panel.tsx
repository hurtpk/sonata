/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings, useSettings } from "@api/Settings";
import { copyToClipboard } from "@utils/clipboard";
import { classes } from "@utils/misc";
import { relaunch } from "@utils/native";
import { saveFile } from "@utils/web";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, showToast, useEffect, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { isFeatureRunning } from "../../../featureSettings";
import { ColorPicker } from "../../_shared/ColorPicker";
import { Window } from "../../_shared/Window";
import { FontBody } from "../fontSwapper/Panel";
import { SmoothBody } from "../smoothChat/Panel";
import { coloursFrom } from "./palette";
import { readShared, themeCode, themeFileText } from "./share";
import { activeId, putTheme, removeTheme, setActive, themeById, useThemes, videoSrc } from "./store";
import { DEFAULT_FX, Effects, fileName, fixReadability, FONTS, fromPreset, newId, NO_FX, normalize, PRESETS, readability, Theme, themeCss, themeFile, themeVars } from "./theme";

const HEX = /^#[0-9a-f]{6}$/i;
const MB = 1024 * 1024;

function ColorRow({ label, hint, value, onChange, extra }: { label: string; hint?: string; value: string; onChange(v: string): void; extra?: React.ReactNode; }) {
    const [text, setText] = useState(value);
    useEffect(() => setText(value), [value]);
    return (
        <div className="vc-ts-color">
            <ColorPicker className="vc-ts-swatch" value={value} onChange={onChange} label={label} />
            <div className="vc-ts-color-text">
                <b>{label}</b>
                {hint && <span className="vc-tool-hint">{hint}</span>}
            </div>
            {extra}
            <input className="vc-tool-input vc-ts-hex" value={text} spellCheck={false} maxLength={7}
                onChange={e => { const v = e.currentTarget.value.trim(); setText(v); const full = v.startsWith("#") ? v : `#${v}`; if (HEX.test(full)) onChange(full.toLowerCase()); }}
                onBlur={() => setText(value)} />
        </div>
    );
}

/** A tiny Discord drawn with the theme's own colours. */
function Preview({ t }: { t: Theme; }) {
    const vars = themeVars(t) as React.CSSProperties;
    const d = Math.max(0, Math.min(80, t.dim)) / 100;
    const blur = t.blur ? `blur(${Math.round(t.blur / 3)}px)` : undefined;
    const pic = !t.video && t.image ? { backgroundImage: `linear-gradient(hsl(0 0% 0% / ${d}), hsl(0 0% 0% / ${d})), url("${t.image}")`, filter: blur } : null;
    const grad = t.accent2 ? `linear-gradient(135deg, ${t.accent}, ${t.accent2})` : t.accent;
    return (
        <div className={classes("vc-ts-preview", t.bubbles && "vc-ts-preview-bubbles", t.bubblesRight && "vc-ts-preview-right")}
            style={{ ...vars, "--ts-accent": t.accent, "--ts-accent2": t.accent2 ?? t.accent, "--ts-grad": grad, "--ts-bg": t.bg, "--ts-badge": t.badge === "accent" ? grad : t.badge ?? "#f23f43" } as React.CSSProperties} aria-hidden>
            {t.video && <video className="vc-ts-p-pic vc-ts-p-video" src={videoSrc(t.video)} muted loop autoPlay playsInline style={{ filter: blur }} />}
            {t.video && d > 0 && <i className="vc-ts-p-pic" style={{ background: `hsl(0 0% 0% / ${d})` }} />}
            {pic && <i className="vc-ts-p-pic" style={pic} />}
            {t.moving && <i className="vc-ts-p-moving" />}
            <div className="vc-ts-p-rail">
                <i className="vc-ts-p-server vc-ts-p-on" />
                <i className="vc-ts-p-server"><b className="vc-ts-p-badge">3</b></i>
                <i className="vc-ts-p-server" />
            </div>
            <div className="vc-ts-p-channels">
                <b>My Server</b>
                <span># general</span>
                <span className="vc-ts-p-sel"># music</span>
                <span># memes</span>
            </div>
            <div className="vc-ts-p-chat">
                <div className="vc-ts-p-msg">
                    <i className="vc-ts-p-ava" />
                    <div><b>Sam</b> <small>Today at 9:41</small><p>has anyone heard the new album?</p></div>
                </div>
                <div className="vc-ts-p-msg vc-ts-p-mine">
                    <i className="vc-ts-p-ava vc-ts-p-ava2" />
                    <div><b>You</b> <small>Today at 9:42</small><p>on repeat all week — <span className="vc-ts-p-link">open.spotify.com</span></p></div>
                </div>
                <div className="vc-ts-p-box">Message #music</div>
                <div className="vc-ts-p-btn">Join</div>
            </div>
        </div>
    );
}

function fileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("That file couldn't be read"));
        r.readAsDataURL(file);
    });
}

function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That picture couldn't be opened")); };
        img.src = url;
    });
}

/** Shrinks a still picture so it doesn't weigh Discord down. */
async function readPicture(file: File): Promise<string> {
    const img = await loadImage(file);
    const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.86);
}

/** A picture, GIF or video to go behind Discord. GIFs are kept as they are, so they keep moving. */
async function readMedia(file: File): Promise<Pick<Theme, "image" | "video">> {
    if (file.type.startsWith("video/")) {
        if (!/^video\/(mp4|webm|ogg)$/.test(file.type)) throw new Error("Use an MP4 or WebM video");
        if (file.size > 40 * MB) throw new Error("That video is too big — keep it under 40 MB (a short loop works best)");
        return { video: await fileAsDataUrl(file), image: null };
    }
    if (file.type === "image/gif" || file.type === "image/webp") {
        if (file.size > 15 * MB) throw new Error("That GIF is too big — keep it under 15 MB");
        return { image: await fileAsDataUrl(file), video: null };
    }
    if (!file.type.startsWith("image/")) throw new Error("Pick a picture, GIF or video");
    return { image: await readPicture(file), video: null };
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void; }) {
    return (
        <label className="vc-tool-check vc-ts-toggle">
            <input type="checkbox" checked={checked} onChange={e => onChange(e.currentTarget.checked)} />
            {label}
        </label>
    );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange(v: T): void; }) {
    return (
        <div className="vc-ts-choice">
            <span className="vc-ts-choice-label">{label}</span>
            <div className="vc-tool-chips">
                {options.map(([v, l]) => <button key={v} type="button" className={classes("vc-tool-chip", value === v && "vc-tool-chip-on")} onClick={() => onChange(v)}>{l}</button>)}
            </div>
        </div>
    );
}

const LIST_FX: [Effects["channels"], string][] = [["none", "Off"], ["slide", "Slide"], ["bar", "Bar"], ["tint", "Tint"], ["grow", "Grow"]];

/** Text that's hard to read on the background (or white text on the accent), with a one-click fix. */
function Readability({ t, set }: { t: Theme; set(p: Partial<Theme>): void; }) {
    const issues = readability(t);
    if (!issues.length) return <span className="vc-ts-read vc-ts-read-ok">✓ Easy to read</span>;
    return (
        <div className="vc-ts-read vc-ts-read-bad">
            <span>⚠ Hard to read: {issues.map(i => `${i.what.toLowerCase()} (${i.ratio.toFixed(1)}:1)`).join(", ")}</span>
            <span className="vc-tool-spacer" />
            <button type="button" className="vc-tool-btn" onClick={() => set(fixReadability(t))}>Fix it</button>
        </div>
    );
}

/** What Discord's window was when it started — the see-through switch only changes on a restart. */
const STARTED = { transparent: !!Settings.transparent, material: Settings.windowsMaterial ?? "none" };

function Switch({ on, onChange, label }: { on: boolean; onChange(v: boolean): void; label: string; }) {
    return <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} className={classes("vc-ts-switch", on && "vc-ts-switch-on")} onClick={() => onChange(!on)}><i /></button>;
}

/**
 * See-through Discord: Equicord's own window setting (for every theme) makes the window
 * itself see-through, so the apps behind it show wherever Discord's backgrounds are see-through.
 * The slider (this theme's) sets how see-through they are.
 */
function SeeThrough({ t, set }: { t: Theme; set(p: Partial<Theme>): void; }) {
    const s = useSettings(["windowsMaterial", "transparent"]);
    const glass = !IS_WEB && (VencordNative as any).native?.supportsWindowsMaterial?.();
    const on = !!s.transparent;
    const frosted = (s.windowsMaterial ?? "none") !== "none";
    const restart = on !== STARTED.transparent || (s.windowsMaterial ?? "none") !== STARTED.material;
    const see = 100 - t.opacity;

    const toggle = (v: boolean) => {
        Settings.transparent = v;
        // Switching it on: make this theme see-through (and on), so it works straight after the restart.
        if (v) { set({ opacity: t.opacity > 60 ? 45 : t.opacity }); if (activeId() !== t.id) setActive(t.id); }
    };

    return (
        <div className={classes("vc-ts-card", "vc-ts-see", on && "vc-ts-see-on")}>
            <div className="vc-ts-see-head">
                <span className="vc-ts-see-icon" aria-hidden>👁</span>
                <div className="vc-ts-see-text">
                    <b>See other apps through Discord</b>
                    <span>{on ? "Discord can't be resized or snapped while this is on." : "Watch a video or game behind Discord while you chat."}</span>
                </div>
                <Switch on={on} onChange={toggle} label="See other apps through Discord" />
            </div>
            <label className="vc-tool-field">
                <span className="vc-tool-label">See-through · {see === 0 ? "solid" : see === 100 ? "fully" : `${see}%`}</span>
                <input type="range" className="vc-tool-range" min={0} max={100} value={see} onChange={e => set({ opacity: 100 - Number(e.currentTarget.value) })} />
            </label>
            <div className="vc-ts-toggles">
                <Toggle label="Menus & chat bar too" checked={t.seeAll} onChange={seeAll => set({ seeAll })} />
                {glass && <Toggle label="Frosted glass" checked={frosted} onChange={v => { Settings.windowsMaterial = v ? "acrylic" : "none"; }} />}
            </div>
            {restart && (
                <div className="vc-ts-restart">
                    <span>{on !== STARTED.transparent ? (on ? "Restart to make the window see-through" : "Restart to make the window solid again") : "Restart to change the frosted glass"}</span>
                    <span className="vc-tool-spacer" />
                    <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => relaunch()}>Restart Discord</button>
                </div>
            )}
        </div>
    );
}

/* ── The tabs ── */

type Tab = "colours" | "background" | "motion" | "chat" | "share" | "text" | "messages";
const TABS: [Tab, string][] = [["colours", "Colours"], ["background", "Background"], ["motion", "Motion"], ["chat", "Chat"], ["share", "Share"]];
let lastTab: Tab = "colours";

function ColoursTab({ t, set }: { t: Theme; set(p: Partial<Theme>): void; }) {
    const sonata = windowAccent("themeStudio");
    return (
        <>
            <div className="vc-ts-colors">
                <ColorRow label="Background" value={t.bg} onChange={bg => set({ bg })} />
                <ColorRow label="Chat area" hint={t.chat ? undefined : "same as background"} value={t.chat ?? t.bg} onChange={chat => set({ chat })}
                    extra={t.chat ? <button type="button" className="vc-ts-mini" title="Same as the background" onClick={() => set({ chat: null })}>↺</button> : null} />
                <ColorRow label="Text" value={t.text} onChange={text => set({ text })} />
                <ColorRow label="Faded text" value={t.muted} onChange={muted => set({ muted })} />
                <ColorRow label="Accent" value={t.accent} onChange={accent => set({ accent })}
                    extra={sonata && HEX.test(sonata) && sonata.toLowerCase() !== t.accent ? <button type="button" className="vc-ts-mini" title="Use Sonata's colour" onClick={() => set({ accent: sonata.toLowerCase() })}>♫</button> : null} />
                {t.accent2
                    ? <ColorRow label="Second accent" value={t.accent2} onChange={accent2 => set({ accent2 })}
                        extra={<button type="button" className="vc-ts-mini" title="Back to one accent colour" onClick={() => set({ accent2: null })}>✕</button>} />
                    : <button type="button" className="vc-ts-add2" onClick={() => set({ accent2: "#ff7ab6" })}><span>+</span>Second accent<small>a gradient</small></button>}
            </div>
            <Readability t={t} set={set} />
            <div className="vc-tool-grid2">
                <label className="vc-tool-field">
                    <span className="vc-tool-label">Corners · {t.radius === 0 ? "square" : t.radius === 1 ? "Discord's own" : `${Math.round(t.radius * 100)}%`}</span>
                    <input type="range" className="vc-tool-range" min={0} max={2.5} step={0.1} value={t.radius} onChange={e => set({ radius: Number(e.currentTarget.value) })} />
                </label>
                <label className="vc-tool-field">
                    <span className="vc-tool-label">Font</span>
                    <select className="vc-tool-select" value={t.font} onChange={e => set({ font: e.currentTarget.value })}>
                        {FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                </label>
            </div>
        </>
    );
}

function BackgroundTab({ t, set }: { t: Theme; set(p: Partial<Theme>): void; }) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const hasMedia = !!(t.image || t.video);
    return (
        <div className="vc-ts-two">
            <SeeThrough t={t} set={set} />
            <div className="vc-ts-card vc-ts-media">
                <div className="vc-ts-media-row">
                    <button type="button" className={classes("vc-ts-media-pick", hasMedia && "vc-ts-media-has")} disabled={busy} onClick={() => fileRef.current?.click()} title="A picture, GIF or MP4/WebM video">
                        {t.video ? <video src={videoSrc(t.video)} muted loop autoPlay playsInline /> : t.image ? <img src={t.image} alt="" /> : <span>{busy ? "Loading…" : "🖼"}</span>}
                    </button>
                    <div className="vc-ts-media-text">
                        <b>{t.video ? "Video behind Discord" : t.image ? "Picture behind Discord" : "Picture, GIF or video"}</b>
                        <span>{t.video ? "Muted, on a loop, paused when minimised" : hasMedia ? "Turn See-through up to show more of it" : "Shows behind Discord's see-through backgrounds"}</span>
                        <div className="vc-tool-row">
                            <button type="button" className="vc-tool-btn" disabled={busy} onClick={() => fileRef.current?.click()}>{hasMedia ? "Change" : "Choose…"}</button>
                            {hasMedia && <button type="button" className="vc-tool-link" onClick={() => set({ image: null, video: null })}>Remove</button>}
                        </div>
                    </div>
                    <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm" hidden onChange={async e => {
                        const f = e.currentTarget.files?.[0];
                        e.currentTarget.value = "";
                        if (!f) return;
                        setBusy(true);
                        try { set({ ...await readMedia(f), ...(t.opacity === 100 ? { opacity: 70 } : {}) }); } catch (err) { showToast(String((err as Error).message), "failure"); }
                        setBusy(false);
                    }} />
                </div>
                {hasMedia && <>
                    <label className="vc-tool-field">
                        <span className="vc-tool-label">Blur · {t.blur ? `${t.blur}px` : "sharp"}</span>
                        <input type="range" className="vc-tool-range" min={0} max={30} value={t.blur} onChange={e => set({ blur: Number(e.currentTarget.value) })} />
                    </label>
                    <label className="vc-tool-field">
                        <span className="vc-tool-label">Darken · {t.dim}%</span>
                        <input type="range" className="vc-tool-range" min={0} max={80} value={t.dim} onChange={e => set({ dim: Number(e.currentTarget.value) })} />
                    </label>
                </>}
                <div className="vc-ts-line">
                    <span><b>🌈 Moving colours</b><small>Soft colours drifting behind Discord</small></span>
                    <Switch on={t.moving} label="Moving colours" onChange={moving => set({ moving, ...(moving && t.opacity > 70 ? { opacity: 65 } : {}) })} />
                </div>
            </div>
        </div>
    );
}

function MotionTab({ t, set }: { t: Theme; set(p: Partial<Theme>): void; }) {
    const { fx } = t;
    const setFx = (p: Partial<Effects>) => set({ fx: { ...fx, ...p } });
    const off = JSON.stringify({ ...fx, speed: "normal" }) === JSON.stringify(NO_FX) && t.msgIn === "none";
    return (
        <>
            <div className="vc-ts-choices">
                <Choice label="Chat bar" value={fx.chatBar} onChange={chatBar => setFx({ chatBar })} options={[["none", "Off"], ["glow", "Glow"], ["lift", "Lift"], ["pulse", "Pulse"]]} />
                <Choice label="Channels" value={fx.channels} onChange={channels => setFx({ channels })} options={LIST_FX} />
                <Choice label="DMs" value={fx.dms} onChange={dms => setFx({ dms })} options={LIST_FX} />
                <Choice label="Messages" value={fx.messages} onChange={messages => setFx({ messages })} options={[["none", "Off"], ["tint", "Tint"], ["bar", "Line"]]} />
                <Choice label="Server icons" value={fx.servers} onChange={servers => setFx({ servers })} options={[["none", "Off"], ["grow", "Grow"], ["bounce", "Bounce"], ["wiggle", "Wiggle"]]} />
                <Choice label="New messages" value={t.msgIn} onChange={msgIn => set({ msgIn })} options={[["none", "Off"], ["fade", "Fade"], ["slide", "Slide"], ["pop", "Pop"]]} />
                <Choice label="Speed" value={fx.speed} onChange={speed => setFx({ speed })} options={[["snappy", "Snappy"], ["normal", "Normal"], ["relaxed", "Relaxed"]]} />
            </div>
            <div className="vc-tool-row">
                <Toggle label="Buttons squish when pressed" checked={fx.buttons} onChange={buttons => setFx({ buttons })} />
                <span className="vc-tool-spacer" />
                {off
                    ? <button type="button" className="vc-tool-link" onClick={() => set({ fx: { ...DEFAULT_FX, speed: fx.speed }, msgIn: "fade" })}>Turn them all on</button>
                    : <button type="button" className="vc-tool-link" onClick={() => set({ fx: { ...NO_FX, speed: fx.speed }, msgIn: "none" })}>Turn them all off</button>}
            </div>
            <span className="vc-tool-hint">Point at things in Discord to try them. They switch off if Windows is set to reduce animations.</span>
        </>
    );
}

function ChatTab({ t, set }: { t: Theme; set(p: Partial<Theme>): void; }) {
    const badgeMode = t.badge === null ? "discord" : t.badge === "accent" ? "accent" : "custom";
    return (
        <div className="vc-ts-lines">
            <div className="vc-ts-line">
                <span><b>💬 Message bubbles</b><small>Rounded bubbles around every message</small></span>
                <Switch on={t.bubbles} label="Message bubbles" onChange={bubbles => set({ bubbles })} />
            </div>
            <div className={classes("vc-ts-line", !t.bubbles && "vc-ts-line-off")}>
                <span><b>➡ Yours on the right</b><small>Like on a phone, in your accent colour</small></span>
                <Switch on={t.bubblesRight} label="Your messages on the right" onChange={bubblesRight => set({ bubblesRight, ...(bubblesRight ? { bubbles: true } : {}) })} />
            </div>
            <div className="vc-ts-line">
                <span><b>@ Mentions in your accent</b><small>Instead of Discord's blue</small></span>
                <Switch on={t.mentions} label="Mentions in the accent colour" onChange={mentions => set({ mentions })} />
            </div>
            <div className="vc-ts-line">
                <span><b>↕ Accent scroll bars</b><small>Scroll bars take your accent colour</small></span>
                <Switch on={t.scrollbars === "accent"} label="Accent scroll bars" onChange={v => set({ scrollbars: v ? "accent" : "discord" })} />
            </div>
            <div className="vc-ts-line vc-ts-line-wide">
                <span><b>🔴 Ping badges</b><small>The little number on servers and DMs</small></span>
                <div className="vc-tool-chips">
                    <button type="button" className={classes("vc-tool-chip", badgeMode === "discord" && "vc-tool-chip-on")} onClick={() => set({ badge: null })}>Red</button>
                    <button type="button" className={classes("vc-tool-chip", badgeMode === "accent" && "vc-tool-chip-on")} onClick={() => set({ badge: "accent" })}>Accent</button>
                    <ColorPicker className={classes("vc-tool-chip", "vc-ts-chip-color", badgeMode === "custom" && "vc-tool-chip-on")} label="Pick a colour"
                        value={badgeMode === "custom" ? t.badge! : "#f23f43"} onChange={v => set({ badge: v })}>
                        <i className="vc-ts-chip-dot" />Own
                    </ColorPicker>
                </div>
            </div>
            <div className="vc-ts-line vc-ts-line-wide">
                <span><b>🎛 Dock buttons</b><small>The icons under your profile, all together (Sonata → Dock's colour wins if you set one there)</small></span>
                <div className="vc-tool-chips">
                    <button type="button" className={classes("vc-tool-chip", !t.dock && "vc-tool-chip-on")} onClick={() => set({ dock: null })}>Discord's</button>
                    <button type="button" className={classes("vc-tool-chip", t.dock === "accent" && "vc-tool-chip-on")} onClick={() => set({ dock: "accent" })}>Accent</button>
                    <ColorPicker className={classes("vc-tool-chip", "vc-ts-chip-color", !!t.dock && t.dock !== "accent" && "vc-tool-chip-on")} label="Pick a colour"
                        value={t.dock && t.dock !== "accent" ? t.dock : t.text} onChange={v => set({ dock: v })}>
                        <i className="vc-ts-chip-dot" />Own
                    </ColorPicker>
                </div>
            </div>
        </div>
    );
}

function ShareTab({ t }: { t: Theme; }) {
    const hasMedia = !!(t.image || t.video);
    const [copied, setCopied] = useState(false);
    return (
        <div className="vc-ts-two">
            <div className="vc-ts-card vc-ts-share">
                <b>🔗 Share code</b>
                <span>A short code to paste in any chat. Friends with Sonata get a <b>Try it</b> button under your message.</span>
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => { copyToClipboard(themeCode(t)); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>{copied ? "✓ Copied" : "Copy share code"}</button>
                {hasMedia && <span className="vc-tool-hint">The code has everything but the {t.video ? "video" : "picture"} — save a file for that.</span>}
            </div>
            <div className="vc-ts-card vc-ts-share">
                <b>📁 Files</b>
                <span>{hasMedia ? `A .sonatatheme file keeps the ${t.video ? "video" : "picture"} too.` : "Keep a copy, or use it in other Discord mods."}</span>
                <div className="vc-tool-row vc-ts-wrap-row">
                    {hasMedia && <button type="button" className="vc-tool-btn" onClick={() => saveFile(new File([themeFileText(t)], fileName(t).replace(/\.theme\.css$/, ".sonatatheme"), { type: "application/json" }))}>Save with {t.video ? "video" : "picture"}</button>}
                    <button type="button" className="vc-tool-btn" onClick={() => saveFile(new File([themeFile(t)], fileName(t), { type: "text/css" }))}>Theme file (.css)</button>
                    <button type="button" className="vc-tool-btn" onClick={() => { copyToClipboard(themeCss(t)); showToast("Copied the CSS", "success"); }}>Copy CSS</button>
                </div>
            </div>
        </div>
    );
}

function Swatches({ t }: { t: Theme; }) {
    return (
        <span className="vc-ts-swatches" aria-hidden>
            {[t.bg, t.chat ?? t.bg, t.text, t.accent, ...(t.accent2 ? [t.accent2] : [])].map((c, i) => <i key={i} style={{ background: c }} />)}
        </span>
    );
}

/* ── New theme: presets, from a picture, or a share code ── */

function NewTheme({ onAdd, onClose }: { onAdd(t: Theme): void; onClose(): void; }) {
    const picRef = useRef<HTMLInputElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const [reading, setReading] = useState(false);
    const [code, setCode] = useState("");
    const take = (t: Theme) => { onAdd(t); onClose(); };
    const fromPicture = async (f: File) => {
        setReading(true);
        try {
            const c = coloursFrom(await loadImage(f));
            const media = await readMedia(f);
            const name = f.name.replace(/\.[^.]+$/, "").slice(0, 32) || "My picture";
            take(normalize({ ...fromPreset({ name, bg: c.bg, text: c.text, muted: c.muted, accent: c.accent, accent2: c.accent2 }), ...media, opacity: 72, dim: c.light ? 0 : 30 }));
            showToast("Made a theme from your picture", "success");
        } catch (e) { showToast(String((e as Error).message), "failure"); }
        setReading(false);
    };
    const paste = (raw: string) => {
        const t = readShared(raw);
        if (!t) { showToast("That isn't a Theme Studio code or file", "failure"); return; }
        take(t);
        showToast(`Added "${t.name}"`, "success");
    };
    return (
        <div className="vc-ts-new">
            <div className="vc-ts-new-head">
                <b>New theme</b>
                <button type="button" className="vc-ts-mini" aria-label="Close" onClick={onClose}>✕</button>
            </div>
            <button type="button" className="vc-ts-new-pic" disabled={reading} onClick={() => picRef.current?.click()}>
                <span>🖼</span><b>{reading ? "Reading colours…" : "From a picture"}</b><small>Its colours become the theme</small>
            </button>
            <input ref={picRef} type="file" accept="image/*" hidden onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) void fromPicture(f); }} />
            <div className="vc-ts-presets">
                {PRESETS.map(p => (
                    <button key={p.name} type="button" className="vc-ts-preset" title={`Start from ${p.name}`} onClick={() => take(fromPreset(p))}>
                        <span style={{ background: `linear-gradient(135deg, ${p.bg} 0 55%, ${p.accent} 55% 80%, ${p.accent2 ?? p.accent} 80%)` }} />{p.name}
                    </button>
                ))}
            </div>
            <div className="vc-ts-import">
                <input className="vc-tool-input vc-tool-grow" value={code} placeholder="Paste a share code" onChange={e => setCode(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter" && code.trim()) paste(code); }} />
                <button type="button" className="vc-tool-btn" disabled={!code.trim()} onClick={() => paste(code)}>Add</button>
                <button type="button" className="vc-ts-mini" title="Open a .sonatatheme file" onClick={() => fileRef.current?.click()}>📁</button>
                <input ref={fileRef} type="file" accept=".sonatatheme,application/json" hidden onChange={async e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) paste(await f.text()); }} />
            </div>
        </div>
    );
}

/* ── The window ── */

/**
 * Appearance: your themes, and — as more tabs in the same window — Font
 * Swapper's text settings and Smooth Chat's new-message animation. A tab only
 * shows while its part is switched on in Sonata.
 */
function ThemeModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const state = useThemes();
    const themesOn = isFeatureRunning("themeStudio");
    const extras: [Tab, string][] = [
        ...(isFeatureRunning("fontSwapper") ? [["text", "Text"] as [Tab, string]] : []),
        ...(isFeatureRunning("smoothChat") ? [["messages", "New messages"] as [Tab, string]] : []),
    ];
    const accent = windowAccent("themeStudio");
    const [pick, setPick] = useState<string | null>(state.active ?? state.themes[0]?.id ?? null);
    const [tab, setTabState] = useState<Tab>(lastTab);
    const [adding, setAdding] = useState(false);
    const [sure, setSure] = useState(false);
    useEffect(() => { if (!sure) return; const x = setTimeout(() => setSure(false), 3000); return () => clearTimeout(x); }, [sure]);
    const t = themeById(pick) ?? state.themes[0] ?? null;
    const setTab = (v: Tab) => { lastTab = v; setTabState(v); };
    // On top of the latest saved copy, so quick changes in a row (or a picture that takes a moment to load) never undo each other.
    const set = (patch: Partial<Theme>) => { if (t) putTheme({ ...(themeById(t.id) ?? t), ...patch }); };
    const add = (n: Theme) => { putTheme(n); setActive(n.id); setPick(n.id); };
    const isOn = !!t && state.active === t.id;
    const showNew = adding || !state.themes.length;
    // What's showing: a theme tab, or Text / New messages.
    const extra = extras.some(([id]) => id === tab) ? tab : !themesOn ? extras[0]?.[0] : undefined;
    const view: Tab = extra ?? (tab === "text" || tab === "messages" ? "colours" : tab);
    const themeTabs: [Tab, string][] = !themesOn ? [] : t && !showNew ? TABS : [["colours", "Themes"]];
    const allTabs = [...themeTabs, ...extras];

    return (
        <Window {...modalProps} size="xl" title="Appearance" subtitle="Make Discord your own — every change shows straight away" flush
            tabs={allTabs.length > 1 ? allTabs : undefined} tab={view} onTab={id => setTab(id as Tab)}
            status={extra === "text" ? ["Your font, text size and spacing"] : extra === "messages" ? ["How new messages come into the chat"]
                : [state.active ? `${themeById(state.active)?.name || "Untitled"} is on` : "Discord's own look", `${state.themes.length} theme${state.themes.length === 1 ? "" : "s"}`]}
            statusRight="every change shows straight away">
            {extra ? (
                <div className="vc-ap-extra" style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                    {extra === "text" ? <FontBody /> : <SmoothBody />}
                </div>
            ) : !themesOn ? (
                <div className="vc-tool-empty vc-ap-extra">Switch on a part of Appearance in Sonata to change it here.</div>
            ) : (
            <div className="vc-tool-wrap vc-ts-wrap" style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className="vc-sw-split vc-ts-layout">
                    <aside className="vc-sw-split-list vc-ts-side">
                        <button type="button" className={classes("vc-ts-newbtn", showNew && "vc-ts-newbtn-on")} onClick={() => setAdding(a => !a)}>＋ New theme</button>
                        <div className="vc-ts-list">
                            {state.themes.map(x => (
                                <div key={x.id} className={classes("vc-ts-item", x.id === t?.id && "vc-ts-item-sel")}>
                                    <button type="button" className="vc-ts-item-main" title="Put this theme on" onClick={() => { setPick(x.id); setActive(x.id); setAdding(false); }}>
                                        <Swatches t={x} />
                                        <span className="vc-ts-item-name">{x.name || "Untitled"}</span>
                                        {x.id === state.active && <i className="vc-ts-item-on" title="On" />}
                                    </button>
                                    <button type="button" className="vc-ts-item-copy" title="Make a copy" aria-label="Make a copy" onClick={() => { const c = { ...x, id: newId(), name: `${x.name} copy` }; putTheme(c); setPick(c.id); }}>⧉</button>
                                </div>
                            ))}
                        </div>
                        {state.active && <button type="button" className="vc-tool-link vc-ts-off" onClick={() => setActive(null)}>Back to Discord's look</button>}
                    </aside>

                    <main className="vc-sw-split-detail vc-ts-main">
                        {showNew && <NewTheme onAdd={n => { add(n); }} onClose={() => setAdding(false)} />}
                        {t && !showNew && <>
                            <div className="vc-ts-top">
                                <input className="vc-tool-input vc-ts-name" value={t.name} maxLength={40} placeholder="Theme name" onChange={e => set({ name: e.currentTarget.value })} />
                                <span className={classes("vc-ts-onlabel", isOn && "vc-ts-onlabel-on")}>{isOn ? "On" : "Off"}</span>
                                <Switch on={isOn} label={isOn ? "Turn this theme off" : "Put this theme on"} onChange={v => setActive(v ? t.id : null)} />
                                {sure
                                    ? <button type="button" className="vc-tool-btn vc-ts-sure" onClick={() => { removeTheme(t.id); setSure(false); }}>Delete?</button>
                                    : <button type="button" className="vc-ts-mini vc-ts-del" title="Delete this theme" aria-label="Delete" onClick={() => setSure(true)}>🗑</button>}
                            </div>
                            <Preview t={t} />
                            <section className="vc-ts-pane" key={`${t.id}-${view}`}>
                                {view === "colours" && <ColoursTab t={t} set={set} />}
                                {view === "background" && <BackgroundTab t={t} set={set} />}
                                {view === "motion" && <MotionTab t={t} set={set} />}
                                {view === "chat" && <ChatTab t={t} set={set} />}
                                {view === "share" && <ShareTab t={t} />}
                            </section>
                        </>}
                    </main>
                </div>
            </div>
            )}
        </Window>
    );
}

/** Opens Appearance, on a tab if given (Text for Font Swapper, New messages for Smooth Chat). */
export function openAppearance(tab?: Tab) {
    if (tab) lastTab = tab;
    openModal(props => <ThemeModal modalProps={props} />);
}

/** Theme Studio's own window: Appearance on its themes. */
export const openThemeStudio = () => openAppearance(lastTab === "text" || lastTab === "messages" ? "colours" : undefined);
