/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useEffect, UserStore } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { CODE_FONTS, DEFAULT_LOOK, FontChoice, fontCss, FontLook, FONTS, PRESETS, safeFontName } from "./fonts";
import { currentLook, setLook, settings, stackOf } from "./index";

const cl = classNameFactory("vc-tool-");
const fs = classNameFactory("vc-font-");

/** Loads every web font while the window is open, so each name can be shown in its own font. */
function usePreviewFonts() {
    useEffect(() => {
        const links = [...FONTS, ...CODE_FONTS].filter(f => f.kind === "web").flatMap(f => fontCss(f).slice(0, 2)).map(href => {
            const l = document.createElement("link");
            l.rel = "stylesheet";
            l.href = href;
            l.dataset.sonataFontPreview = "";
            document.head.appendChild(l);
            return l;
        });
        return () => links.forEach(l => l.remove());
    }, []);
}

function Slider({ label, value, min, max, step = 1, unit, onChange, def }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange(v: number): void; def: number; }) {
    return (
        <label className={fs("slider")}>
            <span className={fs("slider-head")}>
                <span>{label}</span>
                <b>{value}{unit}</b>
                {value !== def && <button type="button" className={fs("reset")} onClick={e => { e.preventDefault(); onChange(def); }}>Reset</button>}
            </span>
            <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.currentTarget.value))} />
        </label>
    );
}

function FontButton({ f, on, onPick }: { f: FontChoice; on: boolean; onPick(): void; }) {
    return (
        <button type="button" className={classes(fs("font"), on && fs("font-on"))} onClick={onPick} title={f.blurb}>
            <span className={fs("font-sample")} style={f.stack ? { fontFamily: f.stack } : undefined}>Aa</span>
            <span className={fs("font-name")} style={f.stack ? { fontFamily: f.stack } : undefined}>{f.name}</span>
        </button>
    );
}

function Preview({ look }: { look: FontLook; }) {
    const me: any = UserStore.getCurrentUser();
    const stack = stackOf(look) || undefined;
    const k = look.size / 100;
    const text: React.CSSProperties = { fontFamily: stack, fontSize: `${k}rem`, lineHeight: `${1.375 * k * look.lineHeight / 100}rem`, letterSpacing: `${look.letterSpacing / 100}em` };
    const name: React.CSSProperties = { fontFamily: look.scope === "all" ? stack : undefined };
    const code = CODE_FONTS.find(f => f.id === look.codeFont)?.stack || undefined;
    return (
        <div className={fs("preview")}>
            {[
                { who: me?.globalName || me?.username || "You", body: "The quick brown fox jumps over the lazy dog — 0123456789, Il1 O0 rn m." },
                { who: "A friend", body: "Long messages are where a comfortable font really matters: they're easier to follow when the letters are clear and the lines aren't cramped together." },
            ].map((m, i) => (
                <div key={i} className={fs("msg")}>
                    <span className={fs("avatar")} aria-hidden />
                    <div>
                        <div className={fs("who")} style={name}>{m.who} <span>Today at 9:41</span></div>
                        <div style={text}>{m.body}</div>
                        {i === 1 && <pre className={fs("code")} style={{ fontFamily: code }}>{"const answer = 42; // code blocks"}</pre>}
                    </div>
                </div>
            ))}
        </div>
    );
}

function FontModal({ modalProps }: { modalProps: RenderModalProps; }) {
    settings.use();
    usePreviewFonts();
    const accent = windowAccent("fontSwapper");
    const look = currentLook();
    const pick = (font: string) => setLook({ font });
    const web = FONTS.filter(f => f.kind === "web"), installed = FONTS.filter(f => f.kind === "installed" && f.id !== "custom");
    const custom = FONTS.find(f => f.id === "custom")!;

    return (
        <Modal {...modalProps} size="lg" title="Font Swapper" subtitle="Changes show straight away — in this window and in Discord.">
            <div className={classes(cl("wrap"), fs("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <Preview look={look} />

                <span className={cl("label")}>Presets</span>
                <div className={fs("presets")}>
                    {PRESETS.map(p => {
                        const full = { ...DEFAULT_LOOK, ...p.look };
                        const on = (Object.keys(full) as (keyof FontLook)[]).every(k => k === "customFont" || full[k] === look[k]);
                        return (
                            <button key={p.id} type="button" className={classes(fs("preset"), on && fs("preset-on"))} onClick={() => setLook({ ...full, customFont: look.customFont })}>
                                <b>{p.name}</b>
                                <span>{p.blurb}</span>
                            </button>
                        );
                    })}
                </div>

                <span className={cl("label")}>Font</span>
                <div className={fs("fonts")}>
                    <FontButton f={FONTS[0]} on={look.font === "discord"} onPick={() => pick("discord")} />
                    {web.map(f => <FontButton key={f.id} f={f} on={look.font === f.id} onPick={() => pick(f.id)} />)}
                </div>
                <span className={cl("hint")}>Fonts above are downloaded once (from Fontsource). The ones below are already on your computer.</span>
                <div className={fs("fonts")}>
                    {installed.map(f => <FontButton key={f.id} f={f} on={look.font === f.id} onPick={() => pick(f.id)} />)}
                    <FontButton f={{ ...custom, stack: look.customFont ? `"${safeFontName(look.customFont)}"` : "" }} on={look.font === "custom"} onPick={() => pick("custom")} />
                </div>
                {look.font === "custom" && (
                    <input className={cl("input")} autoFocus placeholder="Type the name of a font you have installed, e.g. Bahnschrift" value={look.customFont}
                        onChange={e => setLook({ customFont: e.currentTarget.value })} />
                )}

                <div className={cl("row")}>
                    <span className={cl("label")}>Use it for</span>
                    <div className={cl("seg")}>
                        {([["all", "Everything"], ["messages", "Messages only"]] as const).map(([v, label]) => (
                            <button key={v} type="button" className={classes(cl("seg-btn"), look.scope === v && cl("seg-on"))} onClick={() => setLook({ scope: v })}>{label}</button>
                        ))}
                    </div>
                </div>

                <div className={fs("sliders")}>
                    <Slider label="Text size" value={look.size} min={80} max={140} unit="%" def={100} onChange={v => setLook({ size: v })} />
                    <Slider label="Line spacing" value={look.lineHeight} min={80} max={200} step={2} unit="%" def={100} onChange={v => setLook({ lineHeight: v })} />
                    <Slider label="Letter spacing" value={look.letterSpacing} min={-4} max={10} unit="" def={0} onChange={v => setLook({ letterSpacing: v })} />
                </div>

                <span className={cl("label")}>Code blocks</span>
                <div className={fs("fonts")}>
                    {CODE_FONTS.map(f => <FontButton key={f.id} f={f} on={look.codeFont === f.id} onPick={() => setLook({ codeFont: f.id })} />)}
                </div>

                <div className={cl("footer")}>
                    <span className={cl("spacer")} />
                    <button type="button" className={cl("btn")} onClick={() => setLook(DEFAULT_LOOK)}>Back to Discord's look</button>
                    <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={modalProps.onClose}>Done</button>
                </div>
            </div>
        </Modal>
    );
}

export function openFontSwapper() {
    openModal(props => <FontModal modalProps={props} />);
}
