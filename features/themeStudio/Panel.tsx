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
import { Modal, openModal, showToast, useEffect, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { activeId, putTheme, removeTheme, setActive, themeById, useThemes } from "./store";
import { DEFAULT_FX, Effects, fileName, FONTS, fromPreset, NO_FX, PRESETS, Theme, themeCss, themeFile, themeVars } from "./theme";

const HEX = /^#[0-9a-f]{6}$/i;

function ColorRow({ label, hint, value, onChange, extra }: { label: string; hint?: string; value: string; onChange(v: string): void; extra?: React.ReactNode; }) {
    const [text, setText] = useState(value);
    useEffect(() => setText(value), [value]);
    return (
        <div className="vc-ts-color">
            <input type="color" className="vc-ts-swatch" value={value} onChange={e => onChange(e.currentTarget.value)} aria-label={label} />
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
    const pic = t.image ? { backgroundImage: `linear-gradient(hsl(0 0% 0% / ${d}), hsl(0 0% 0% / ${d})), url("${t.image}")`, filter: t.blur ? `blur(${Math.round(t.blur / 3)}px)` : undefined } : null;
    return (
        <div className={classes("vc-ts-preview", t.opacity < 100 && "vc-ts-preview-see")} style={{ ...vars, "--ts-accent": t.accent, "--ts-bg": t.bg } as React.CSSProperties} aria-hidden>
            {pic && <i className="vc-ts-p-pic" style={pic} />}
            {t.moving && <i className="vc-ts-p-moving" />}
            <div className="vc-ts-p-rail">
                <i className="vc-ts-p-server vc-ts-p-on" />
                <i className="vc-ts-p-server" />
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
                <div className="vc-ts-p-msg">
                    <i className="vc-ts-p-ava vc-ts-p-ava2" />
                    <div><b>Alex</b> <small>Today at 9:42</small><p>on repeat all week — <span className="vc-ts-p-link">open.spotify.com</span></p></div>
                </div>
                <div className="vc-ts-p-box">Message #music</div>
                <div className="vc-ts-p-btn">Join</div>
            </div>
        </div>
    );
}

/** Shrinks a picture so it doesn't weigh Discord down (and keeps it under a few MB). */
function readPicture(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
            const c = document.createElement("canvas");
            c.width = Math.round(img.width * scale);
            c.height = Math.round(img.height * scale);
            c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            resolve(c.toDataURL("image/jpeg", 0.86));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That picture couldn't be opened")); };
        img.src = url;
    });
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

const LIST_FX: [Effects["channels"], string][] = [["none", "Nothing"], ["slide", "Slide"], ["bar", "Accent bar"], ["tint", "Tint"], ["grow", "Grow"]];

function Animations({ fx, onChange }: { fx: Effects; onChange(fx: Effects): void; }) {
    const set = (p: Partial<Effects>) => onChange({ ...fx, ...p });
    const off = JSON.stringify({ ...fx, speed: "normal" }) === JSON.stringify(NO_FX);
    return (
        <section className="vc-ts-group">
            <div className="vc-tool-row">
                <h4 className="vc-ts-group-title">Hover animations</h4>
                <span className="vc-tool-spacer" />
                {off
                    ? <button type="button" className="vc-tool-link" onClick={() => onChange({ ...DEFAULT_FX, speed: fx.speed })}>Turn them on</button>
                    : <button type="button" className="vc-tool-link" onClick={() => onChange({ ...NO_FX, speed: fx.speed })}>Turn all off</button>}
            </div>
            <Choice label="💬 Chat bar" value={fx.chatBar} onChange={chatBar => set({ chatBar })}
                options={[["none", "Nothing"], ["glow", "Inner glow"], ["lift", "Lift"], ["pulse", "Pulse while typing"]]} />
            <Choice label="# Channels" value={fx.channels} onChange={channels => set({ channels })} options={LIST_FX} />
            <Choice label="👤 DMs" value={fx.dms} onChange={dms => set({ dms })} options={LIST_FX} />
            <Choice label="📝 Messages" value={fx.messages} onChange={messages => set({ messages })}
                options={[["none", "Nothing"], ["tint", "Tint"], ["bar", "Accent line"]]} />
            <Choice label="🏠 Server icons" value={fx.servers} onChange={servers => set({ servers })}
                options={[["none", "Nothing"], ["grow", "Grow"], ["bounce", "Bounce"], ["wiggle", "Wiggle"]]} />
            <Choice label="⏱ Speed" value={fx.speed} onChange={speed => set({ speed })}
                options={[["snappy", "Snappy"], ["normal", "Normal"], ["relaxed", "Relaxed"]]} />
            <Toggle label="Buttons squish a little when you press them" checked={fx.buttons} onChange={buttons => set({ buttons })} />
            <span className="vc-tool-hint">Point at things in Discord to try them. They switch off if Windows is set to reduce animations.</span>
        </section>
    );
}

/** What Discord's window was when it started — the see-through switch only changes on a restart. */
const STARTED = { transparent: !!Settings.transparent, material: Settings.windowsMaterial ?? "none" };

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
        <div className={classes("vc-ts-see", on && "vc-ts-see-on")}>
            <div className="vc-ts-see-head">
                <span className="vc-ts-see-icon" aria-hidden>👁</span>
                <div className="vc-ts-see-text">
                    <b>See other apps through Discord</b>
                    <span>Watch a video, a game or anything else behind Discord while you chat.</span>
                </div>
                <button type="button" role="switch" aria-checked={on} className={classes("vc-ts-switch", on && "vc-ts-switch-on")} onClick={() => toggle(!on)}><i /></button>
            </div>

            <label className="vc-tool-field">
                <span className="vc-tool-label">See-through · {see === 0 ? "solid" : see === 100 ? "fully see-through" : `${see}%`}</span>
                <input type="range" className="vc-tool-range" min={0} max={100} value={see} onChange={e => set({ opacity: 100 - Number(e.currentTarget.value) })} />
                <span className="vc-tool-hint">
                    {on ? "The higher, the more you see of what's behind Discord. Text stays solid." : "Shows the picture or moving colours below — or, with the switch on, whatever's behind Discord."}
                </span>
            </label>
            <div className="vc-ts-toggles">
                <Toggle label="Popouts, menus and the chat bar too" checked={t.seeAll} onChange={seeAll => set({ seeAll })} />
                {glass && <Toggle label="Blur what's behind (frosted glass)" checked={frosted} onChange={v => { Settings.windowsMaterial = v ? "acrylic" : "none"; }} />}
            </div>
            {on && <span className="vc-tool-hint">While this is on, Windows doesn't let Discord be resized or snapped to the screen's edges. Switch it off any time. It's for every theme.</span>}
            {restart && (
                <div className="vc-ts-restart">
                    <span>{on !== STARTED.transparent ? (on ? "Restart Discord to make the window see-through." : "Restart Discord to make the window solid again.") : "Restart Discord to change the frosted glass."}</span>
                    <span className="vc-tool-spacer" />
                    <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => relaunch()}>Restart Discord now</button>
                </div>
            )}
        </div>
    );
}

function Editor({ t }: { t: Theme; }) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [sure, setSure] = useState(false);
    useEffect(() => { if (!sure) return; const x = setTimeout(() => setSure(false), 3000); return () => clearTimeout(x); }, [sure]);
    // On top of the latest saved copy, so quick changes in a row (or a picture that takes a moment to load) never undo each other.
    const set = (patch: Partial<Theme>) => putTheme({ ...(themeById(t.id) ?? t), ...patch });
    const sonata = windowAccent("themeStudio");
    const on = activeId() === t.id;

    return (
        <div className="vc-ts-editor">
            <Preview t={t} />
            <div className="vc-tool-row">
                <input className="vc-tool-input vc-ts-name" value={t.name} maxLength={40} placeholder="Theme name" onChange={e => set({ name: e.currentTarget.value })} />
                {on
                    ? <button type="button" className="vc-tool-btn" onClick={() => setActive(null)}>Turn off</button>
                    : <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => setActive(t.id)}>Put on Discord</button>}
            </div>

            <section className="vc-ts-group">
                <h4 className="vc-ts-group-title">Colours</h4>
                <ColorRow label="Background" hint="Everything else is shaded from this" value={t.bg} onChange={bg => set({ bg })} />
                <ColorRow label="Chat area" hint={t.chat ? "Its own colour" : "Same as the background"} value={t.chat ?? t.bg} onChange={chat => set({ chat })}
                    extra={t.chat ? <button type="button" className="vc-tool-link" onClick={() => set({ chat: null })}>Same as background</button> : null} />
                <ColorRow label="Text" value={t.text} onChange={text => set({ text })} />
                <ColorRow label="Faded text" hint="Times, channel names, hints" value={t.muted} onChange={muted => set({ muted })} />
                <ColorRow label="Accent" hint="Buttons, links, selected things" value={t.accent} onChange={accent => set({ accent })}
                    extra={sonata && sonata.toLowerCase() !== t.accent ? <button type="button" className="vc-tool-link" onClick={() => HEX.test(sonata) && set({ accent: sonata.toLowerCase() })}>Sonata's colour</button> : null} />
            </section>

            <section className="vc-ts-group">
                <h4 className="vc-ts-group-title">Shape & font</h4>
                <label className="vc-tool-field">
                    <span className="vc-tool-label">Corners · {t.radius === 0 ? "square" : t.radius === 1 ? "Discord's own" : `${Math.round(t.radius * 100)}%`}</span>
                    <input type="range" className="vc-tool-range" min={0} max={2.5} step={0.1} value={t.radius} onChange={e => set({ radius: Number(e.currentTarget.value) })} />
                </label>
                <label className="vc-tool-field">
                    <span className="vc-tool-label">Font</span>
                    <select className="vc-tool-select" value={t.font} onChange={e => set({ font: e.currentTarget.value })}>
                        {FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                    <span className="vc-tool-hint">For hundreds more fonts, use Font Swapper.</span>
                </label>
            </section>

            <section className="vc-ts-group">
                <h4 className="vc-ts-group-title">Background & see-through</h4>
                <SeeThrough t={t} set={set} />
                <div className="vc-tool-row">
                    {t.image && <img className="vc-ts-thumb" src={t.image} alt="" />}
                    <button type="button" className="vc-tool-btn" onClick={() => fileRef.current?.click()}>{t.image ? "Change picture" : "🖼 Picture behind Discord"}</button>
                    {t.image && <button type="button" className="vc-tool-link" onClick={() => set({ image: null })}>Remove</button>}
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={async e => {
                        const f = e.currentTarget.files?.[0];
                        e.currentTarget.value = "";
                        if (!f) return;
                        try { set({ image: await readPicture(f), ...(t.opacity === 100 ? { opacity: 70 } : {}) }); } catch (err) { showToast(String((err as Error).message), "failure"); }
                    }} />
                    <span className="vc-tool-spacer" />
                    <Toggle label="🌈 Moving colours" checked={t.moving} onChange={moving => set({ moving, ...(moving && t.opacity > 70 ? { opacity: 65 } : {}) })} />
                </div>
                {t.image && <div className="vc-tool-grid2">
                    <label className="vc-tool-field">
                        <span className="vc-tool-label">Blur the picture · {t.blur ? `${t.blur}px` : "sharp"}</span>
                        <input type="range" className="vc-tool-range" min={0} max={30} value={t.blur} onChange={e => set({ blur: Number(e.currentTarget.value) })} />
                    </label>
                    <label className="vc-tool-field">
                        <span className="vc-tool-label">Darken the picture · {t.dim}%</span>
                        <input type="range" className="vc-tool-range" min={0} max={80} value={t.dim} onChange={e => set({ dim: Number(e.currentTarget.value) })} />
                    </label>
                </div>}
            </section>

            <Animations fx={t.fx} onChange={fx => set({ fx })} />

            <section className="vc-ts-group">
                <h4 className="vc-ts-group-title">Little touches</h4>
                <div className="vc-ts-toggles">
                    <Toggle label="Scroll bars in the accent colour" checked={t.scrollbars === "accent"} onChange={v => set({ scrollbars: v ? "accent" : "discord" })} />
                    <Toggle label="@mentions in the accent colour" checked={t.mentions} onChange={mentions => set({ mentions })} />
                </div>
            </section>

            <div className="vc-tool-row vc-ts-actions">
                <button type="button" className="vc-tool-btn" onClick={() => saveFile(new File([themeFile(t)], fileName(t), { type: "text/css" }))}>Save as theme file</button>
                <button type="button" className="vc-tool-btn" onClick={() => { copyToClipboard(themeCss(t)); showToast("Copied the CSS", "success"); }}>Copy CSS</button>
                <span className="vc-tool-spacer" />
                {sure
                    ? <button type="button" className="vc-tool-btn vc-ts-sure" onClick={() => removeTheme(t.id)}>Delete "{t.name}"</button>
                    : <button type="button" className="vc-tool-link vc-ts-del" onClick={() => setSure(true)}>Delete</button>}
            </div>
        </div>
    );
}

function Swatches({ t }: { t: Theme; }) {
    return (
        <span className="vc-ts-swatches" aria-hidden>
            {[t.bg, t.chat ?? t.bg, t.text, t.accent].map((c, i) => <i key={i} style={{ background: c }} />)}
        </span>
    );
}

function ThemeModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const state = useThemes();
    const accent = windowAccent("themeStudio");
    const [pick, setPick] = useState<string | null>(state.active ?? state.themes[0]?.id ?? null);
    const editing = themeById(pick) ?? state.themes[0] ?? null;
    const on = state.themes.find(t => t.id === state.active);

    const start = (i: number) => {
        const t = fromPreset(PRESETS[i]);
        putTheme(t);
        setActive(t.id);
        setPick(t.id);
    };
    const copy = (t: Theme) => {
        const c = { ...t, id: Math.random().toString(36).slice(2, 10), name: `${t.name} copy` };
        putTheme(c);
        setPick(c.id);
    };

    return (
        <Modal {...modalProps} size="lg" title="Theme Studio" subtitle="Make Discord your own colours — every change shows straight away">
            <div className="vc-tool-wrap vc-ts-wrap" style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="🎨" kicker="Theme Studio" title={on ? on.name : "Discord's own look"}
                    sub={on ? "This theme is on. Changes show on Discord as you make them." : "Pick a starting point below, then make it yours."}
                    numbers={[{ value: state.themes.length, label: state.themes.length === 1 ? "theme" : "themes" }]}>
                    {on && <button type="button" className="vc-tool-btn" onClick={() => setActive(null)}>Back to Discord's look</button>}
                </ToolHero>

                <div className="vc-ts-starts">
                    <span className="vc-tool-label">Start from</span>
                    <div className="vc-tool-chips">
                        {PRESETS.map((p, i) => (
                            <button key={p.name} type="button" className="vc-tool-chip vc-ts-start" onClick={() => start(i)} title={`New theme from ${p.name}`}>
                                <span className="vc-ts-dot" style={{ background: `linear-gradient(135deg, ${p.bg} 50%, ${p.accent} 50%)` }} />{p.name}
                            </button>
                        ))}
                    </div>
                </div>

                {editing ? (
                    <div className="vc-ts-body">
                        <aside className="vc-ts-list">
                            <span className="vc-tool-label">Your themes</span>
                            {state.themes.map(t => (
                                <div key={t.id} className={classes("vc-ts-item", t.id === editing.id && "vc-ts-item-sel")}>
                                    <button type="button" className="vc-ts-item-main" title="Put this theme on" onClick={() => { setPick(t.id); setActive(t.id); }}>
                                        <Swatches t={t} />
                                        <span className="vc-ts-item-name">{t.name || "Untitled"}</span>
                                        {t.id === state.active && <span className="vc-tool-badge vc-tool-badge-accent">On</span>}
                                    </button>
                                    <button type="button" className="vc-ts-item-copy" title="Make a copy" aria-label="Make a copy" onClick={() => copy(t)}>⧉</button>
                                </div>
                            ))}
                        </aside>
                        <Editor key={editing.id} t={editing} />
                    </div>
                ) : (
                    <div className="vc-tool-empty"><span className="vc-tool-empty-icon">🎨</span>No themes yet. Pick a starting point above — it goes on Discord straight away, and you can change every colour.</div>
                )}
            </div>
        </Modal>
    );
}

export function openThemeStudio() {
    openModal(props => <ThemeModal modalProps={props} />);
}
