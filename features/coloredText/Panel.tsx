/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, showToast, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { BACKGROUNDS, colorOf, fromAnsi, PLAIN, runs, Style, TEXT_COLORS, toAnsi } from "./ansi";

const cl = classNameFactory("vc-tool-");
const ct = classNameFactory("vc-ansi-");

const LIMIT = 2000;

function ColoredTextModal({ modalProps, initial }: { modalProps: RenderModalProps; initial: string; }) {
    const accent = windowAccent("coloredText");
    const start = initial ? fromAnsi(initial) : { text: "", styles: [] as Style[] };
    const [text, setText] = useState(start.text);
    const [styles, setStyles] = useState<Style[]>(start.styles);
    /** The style new typing gets, when you pick one with nothing selected. */
    const [pen, setPen] = useState<Style | null>(null);
    const area = useRef<HTMLTextAreaElement>(null);

    const output = text ? toAnsi(text, styles) : "";

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

    /** Change the selected text's style, or the pen if nothing is selected. */
    const apply = (change: (s: Style, all: Style[]) => Style) => {
        const [a, b] = selection();
        if (a === b) {
            const base = pen ?? styles[a - 1] ?? PLAIN;
            setPen(change(base, [base]));
            area.current?.focus();
            return;
        }
        const picked = styles.slice(a, b);
        setStyles(styles.map((s, i) => i >= a && i < b ? change(s, picked) : s));
        setPen(null);
        // Keep the selection so you can stack styles.
        requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(a, b); });
    };

    const setFg = (fg: number | null) => apply(s => ({ ...s, fg }));
    const setBg = (bg: number | null) => apply(s => ({ ...s, bg }));
    const toggle = (key: "bold" | "underline") => apply((s, all) => ({ ...s, [key]: !all.every(x => x[key]) }));

    const insert = () => {
        if (!output) return;
        if (output.length > LIMIT) { showToast(`That's ${output.length} characters — the limit is ${LIMIT}`, "failure"); return; }
        insertTextIntoChatInputBox(output);
        modalProps.onClose();
    };
    const copy = async () => {
        try { await navigator.clipboard.writeText(output); showToast("Copied", "success"); } catch { showToast("Couldn't copy", "failure"); }
    };

    return (
        <Modal {...modalProps} size="lg" title="Colored Text" subtitle="Select some text, then pick a colour or style">
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className={ct("bar")}>
                    <span className={cl("label")}>Text</span>
                    {TEXT_COLORS.map(c => (
                        <button key={c.code} type="button" title={c.name} aria-label={`${c.name} text`} className={ct("swatch")} style={{ background: c.color }} onMouseDown={e => e.preventDefault()} onClick={() => setFg(c.code)} />
                    ))}
                    <button type="button" title="Default text colour" className={classes(ct("swatch"), ct("none"))} onMouseDown={e => e.preventDefault()} onClick={() => setFg(null)} />
                </div>
                <div className={ct("bar")}>
                    <span className={cl("label")}>Back</span>
                    {BACKGROUNDS.map(c => (
                        <button key={c.code} type="button" title={c.name} aria-label={`${c.name} background`} className={ct("swatch")} style={{ background: c.color }} onMouseDown={e => e.preventDefault()} onClick={() => setBg(c.code)} />
                    ))}
                    <button type="button" title="No background" className={classes(ct("swatch"), ct("none"))} onMouseDown={e => e.preventDefault()} onClick={() => setBg(null)} />
                </div>
                <div className={cl("row")}>
                    <button type="button" className={cl("btn")} onMouseDown={e => e.preventDefault()} onClick={() => toggle("bold")}><b>B</b> Bold</button>
                    <button type="button" className={cl("btn")} onMouseDown={e => e.preventDefault()} onClick={() => toggle("underline")}><u>U</u> Underline</button>
                    <button type="button" className={cl("btn")} onMouseDown={e => e.preventDefault()} onClick={() => apply(() => PLAIN)}>Clear style</button>
                    <span className={cl("spacer")} />
                    {pen && <span className={cl("hint")}>Typing in: <Preview text="Aa" styles={[pen, pen]} inline /></span>}
                </div>

                <textarea ref={area} className={classes(cl("area"), cl("mono"))} autoFocus value={text} spellCheck={false}
                    placeholder="Type your message here…" onChange={e => onChange(e.currentTarget.value)} onPaste={onPaste} />

                <div className={cl("label")}>Preview</div>
                <Preview text={text} styles={styles} />

                <div className={cl("footer")}>
                    <span className={classes(cl("hint"), output.length > LIMIT && cl("error"))}>{output ? `${output.length} / ${LIMIT}` : "Only people on desktop see the colours."}</span>
                    <span className={cl("spacer")} />
                    <button type="button" className={cl("btn")} disabled={!text} onClick={() => { setText(""); setStyles([]); setPen(null); }}>Clear</button>
                    <button type="button" className={cl("btn")} disabled={!output} onClick={copy}>Copy</button>
                    <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={!output} onClick={insert}>Insert into message</button>
                </div>
            </div>
        </Modal>
    );
}

function Preview({ text, styles, inline }: { text: string; styles: Style[]; inline?: boolean; }) {
    if (!text && !inline) return <div className={classes(ct("preview"), cl("out-empty"))}>Your coloured text shows up here.</div>;
    const Tag = inline ? "span" : "div";
    return (
        <Tag className={classes(ct("preview"), inline && ct("inline"))}>
            {runs(text, styles).map((r, i) => (
                <span key={i} style={{
                    color: colorOf(r.style.fg, TEXT_COLORS),
                    background: colorOf(r.style.bg, BACKGROUNDS),
                    fontWeight: r.style.bold ? 700 : undefined,
                    textDecoration: r.style.underline ? "underline" : undefined,
                }}>{r.text}</span>
            ))}
        </Tag>
    );
}

export function openColoredText(initial = "") {
    openModal(props => <ColoredTextModal modalProps={props} initial={initial} />);
}
