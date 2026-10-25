/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { showToast, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { ColorPicker } from "../../_shared/ColorPicker";
import { openSection, registerSection } from "../../_shared/Hub";
import { Window } from "../../_shared/Window";
import { BACKGROUNDS, Colour, cssColour, effectColours, fromAnsi, Mark, PLAIN, runs, Style, Swatch, TEXT_COLORS, toAnsi } from "./ansi";

const cl = classNameFactory("vc-tool-");
const ct = classNameFactory("vc-ansi-");

/** Somewhere else to put the result (Embed Sender's description) instead of the message box. */
export interface ColoredTarget {
    /** "the description" — shown on the button. */
    name: string;
    /** Characters left there. */
    limit: number;
    put(text: string): void;
}

const MARK_BUTTONS: { mark: Mark; label: string; look: React.CSSProperties; }[] = [
    { mark: "bold", label: "Bold", look: { fontWeight: 800 } },
    { mark: "italic", label: "Italic", look: { fontStyle: "italic" } },
    { mark: "underline", label: "Underline", look: { textDecoration: "underline" } },
    { mark: "strike", label: "Strikethrough", look: { textDecoration: "line-through" } },
    { mark: "overline", label: "Overline", look: { textDecoration: "overline" } },
];

function ColoredTextModal({ modalProps, initial, target }: { modalProps: RenderModalProps; initial: string; target?: ColoredTarget; }) {
    const LIMIT = target?.limit ?? 2000;
    const accent = windowAccent("coloredText");
    const start = initial ? fromAnsi(initial) : { text: "", styles: [] as Style[] };
    const [text, setText] = useState(start.text);
    const [styles, setStyles] = useState<Style[]>(start.styles);
    /** The style new typing gets, when you pick one with nothing selected. */
    const [pen, setPen] = useState<Style | null>(null);
    const [ownFg, setOwnFg] = useState("#ff7ac6");
    const [ownBg, setOwnBg] = useState("#3b2a66");
    const [from, setFrom] = useState("#ff5f9e");
    const [to, setTo] = useState("#5f8fff");
    const area = useRef<HTMLTextAreaElement>(null);

    // Exact colours where they fit; close shades from the 256-colour table when that's what fits in a message.
    const exact = text ? toAnsi(text, styles) : "";
    const short = exact.length > LIMIT ? toAnsi(text, styles, true) : exact;
    const output = exact.length > LIMIT && short.length <= LIMIT ? short : exact;
    const shaded = output !== exact;

    const selection = () => {
        const el = area.current;
        return el ? [el.selectionStart, el.selectionEnd] as const : [0, 0] as const;
    };

    // Typing: keep each character's style, new characters take the pen (or the style before them).
    const onChange = (next: string) => {
        let p = 0;
        while (p < text.length && p < next.length && text[p] === next[p]) p++;
        let s = 0;
        while (s < text.length - p && s < next.length - p && text[text.length - 1 - s] === next[next.length - 1 - s]) s++;
        const inserted = next.length - p - s;
        const fill = pen ?? styles[p - 1] ?? PLAIN;
        setStyles([...styles.slice(0, p), ...Array(inserted).fill(fill), ...styles.slice(text.length - s)]);
        setText(next);
    };

    // Pasting coloured text (from Discord or elsewhere) keeps its colours.
    const onPaste = (e: React.ClipboardEvent) => {
        const pasted = e.clipboardData.getData("text/plain");
        if (!pasted.includes("\u001b[")) return;
        e.preventDefault();
        const parsed = fromAnsi(pasted);
        const [a, b] = selection();
        setText(text.slice(0, a) + parsed.text + text.slice(b));
        setStyles([...styles.slice(0, a), ...parsed.styles, ...styles.slice(b)]);
    };

    /**
     * Change the selected text's style, or the pen if nothing is selected.
     * `refocus` puts you back in the text box (not while a colour picker is open).
     */
    const apply = (change: (s: Style, all: Style[], i: number) => Style, refocus = true) => {
        const [a, b] = selection();
        if (a === b) {
            const base = pen ?? styles[a - 1] ?? PLAIN;
            setPen(change(base, [base], 0));
            if (refocus) area.current?.focus();
            return;
        }
        const picked = styles.slice(a, b);
        setStyles(styles.map((s, i) => i >= a && i < b ? change(s, picked, i - a) : s));
        setPen(null);
        // Keep the selection so you can stack styles.
        if (refocus) requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(a, b); });
    };

    const setFg = (fg: Colour | null, refocus?: boolean) => apply(s => ({ ...s, fg }), refocus);
    const setBg = (bg: Colour | null, refocus?: boolean) => apply(s => ({ ...s, bg }), refocus);
    const toggle = (mark: Mark) => apply((s, all) => ({ ...s, [mark]: !all.every(x => x[mark]) }));

    /** Rainbow or a fade across the selection — or across everything when nothing is selected. */
    const effect = (kind: "rainbow" | "gradient") => {
        let [a, b] = selection();
        if (a === b) [a, b] = [0, text.length];
        if (a === b) { showToast("Type something first", "message"); return; }
        const colours = effectColours(text.slice(a, b), kind === "rainbow" ? { kind } : { kind, from, to });
        setStyles(text.split("").map((_, i) => {
            const s = styles[i] ?? PLAIN;
            return i >= a && i < b && colours[i - a] ? { ...s, fg: colours[i - a] } : s;
        }));
        setPen(null);
        requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(a, b); });
    };

    const insert = () => {
        if (!output) return;
        if (output.length > LIMIT) { showToast(`That's ${output.length} characters — the limit is ${LIMIT}`, "failure"); return; }
        if (target) target.put(output);
        else insertTextIntoChatInputBox(output);
        modalProps.onClose();
    };
    const copy = async () => {
        try { await navigator.clipboard.writeText(output); showToast("Copied", "success"); } catch { showToast("Couldn't copy", "failure"); }
    };

    const palette = (list: Swatch[], kind: string, set: (c: Colour | null, refocus?: boolean) => void, own: string, setOwn: (v: string) => void) => (
        <div className={ct("bar")}>
            <span className={cl("label")}>{kind}</span>
            <div className={ct("swatches")}>
                {list.map(c => (
                    <button key={c.code} type="button" title={c.name} aria-label={`${c.name} ${kind.toLowerCase()}`} className={ct("swatch")} style={{ background: c.color }} onMouseDown={e => e.preventDefault()} onClick={() => set(c.code)} />
                ))}
            </div>
            <ColorPicker className={classes(ct("swatch"), ct("own"))} label={`Any colour for the ${kind.toLowerCase()}`} value={own}
                onChange={v => { setOwn(v); set(v, false); }}>
                <span className={ct("own-dot")} style={{ background: own }} />Any
            </ColorPicker>
            <button type="button" title={kind === "Text" ? "Default text colour" : "No background"} className={classes(ct("swatch"), ct("none"))} onMouseDown={e => e.preventDefault()} onClick={() => set(null)} />
        </div>
    );

    return (
        <Window {...modalProps} size="lg" title="Colored Text" subtitle="Select some text, then pick a colour or style">
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                {palette(TEXT_COLORS, "Text", setFg, ownFg, setOwnFg)}
                {palette(BACKGROUNDS, "Back", setBg, ownBg, setOwnBg)}
                <div className={cl("row")}>
                    {MARK_BUTTONS.map(m => (
                        <button key={m.mark} type="button" className={cl("btn")} title={m.label} onMouseDown={e => e.preventDefault()} onClick={() => toggle(m.mark)}>
                            <span style={m.look}>{m.label}</span>
                        </button>
                    ))}
                    <button type="button" className={cl("btn")} onMouseDown={e => e.preventDefault()} onClick={() => apply(() => PLAIN)}>Clear style</button>
                </div>
                <div className={classes(cl("row"), ct("effects"))}>
                    <span className={cl("label")}>Effects</span>
                    <button type="button" className={cl("btn")} onMouseDown={e => e.preventDefault()} onClick={() => effect("rainbow")}><span className={ct("rainbow")}>Rainbow</span></button>
                    <span className={ct("fade")}>
                        <ColorPicker className={ct("swatch")} label="Fade from" value={from} onChange={setFrom} />
                        <span className={ct("fade-line")} style={{ background: `linear-gradient(90deg, ${from}, ${to})` }} />
                        <ColorPicker className={ct("swatch")} label="Fade to" value={to} onChange={setTo} />
                    </span>
                    <button type="button" className={cl("btn")} onMouseDown={e => e.preventDefault()} onClick={() => effect("gradient")}>Fade</button>
                    <span className={cl("spacer")} />
                    {pen && <span className={cl("hint")}>Typing in: <Preview text="Aa" styles={[pen, pen]} inline /></span>}
                </div>

                <textarea ref={area} className={classes(cl("area"), cl("mono"))} autoFocus value={text} spellCheck={false}
                    placeholder="Type your message here…" onChange={e => onChange(e.currentTarget.value)} onPaste={onPaste} />

                <div className={cl("label")}>Preview</div>
                <Preview text={text} styles={styles} />

                <div className={cl("footer")}>
                    <span className={classes(cl("hint"), output.length > LIMIT && cl("error"))}>
                        {!output ? "Only people on desktop see the colours."
                            : output.length > LIMIT ? `${output.length} / ${LIMIT} — too long; colour less of it, or fewer colours`
                                : shaded ? `${output.length} / ${LIMIT} · using close shades so it fits`
                                    : `${output.length} / ${LIMIT}`}
                    </span>
                    <span className={cl("spacer")} />
                    <button type="button" className={cl("btn")} disabled={!text} onClick={() => { setText(""); setStyles([]); setPen(null); }}>Clear</button>
                    <button type="button" className={cl("btn")} disabled={!output} onClick={copy}>Copy</button>
                    <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={!output} onClick={insert}>{target ? `Put it in ${target.name}` : "Insert into message"}</button>
                </div>
            </div>
        </Window>
    );
}

function Preview({ text, styles, inline }: { text: string; styles: Style[]; inline?: boolean; }) {
    if (!text && !inline) return <div className={classes(ct("preview"), cl("out-empty"))}>Your coloured text shows up here.</div>;
    const Tag = inline ? "span" : "div";
    return (
        <Tag className={classes(ct("preview"), inline && ct("inline"))}>
            {runs(text, styles).map((r, i) => {
                const lines = [r.style.underline && "underline", r.style.strike && "line-through", r.style.overline && "overline"].filter(Boolean);
                return (
                    <span key={i} style={{
                        color: cssColour(r.style.fg, TEXT_COLORS),
                        background: cssColour(r.style.bg, BACKGROUNDS),
                        fontWeight: r.style.bold ? 700 : undefined,
                        fontStyle: r.style.italic ? "italic" : undefined,
                        textDecorationLine: lines.length ? lines.join(" ") : undefined,
                    }}>{r.text}</span>
                );
            })}
        </Tag>
    );
}

registerSection("textStyles", { id: "coloredText", feature: "coloredText", name: "Colored Text", sub: "Coloured words in code blocks", render: p => <ColoredTextModal modalProps={p} initial="" /> });
export function openColoredText(initial = "", target?: ColoredTarget) {
    openSection("textStyles", "coloredText", initial || target ? props => <ColoredTextModal modalProps={props} initial={initial} target={target} /> : undefined);
}
