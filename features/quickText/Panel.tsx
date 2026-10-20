/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { insertTextIntoChatInputBox } from "@utils/discord";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, showToast, useEffect, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { KINDS } from "../wallet/kinds";
import { blanksOf, fill, putSnippet, removeSnippet, Snippet, TRIGGER, used, useSnippets, VARIABLES } from "./expand";

const WALLET_WORDS = new Set(KINDS.map(k => k.word));
const style = () => { const a = windowAccent("quickText"); return a ? ({ "--vc-tool-accent": a } as React.CSSProperties) : undefined; };

/* ── Filling in the blanks ── */

function FillModal({ modalProps, blanks, text, onDone }: { modalProps: RenderModalProps; blanks: string[]; text: (v: Record<string, string>) => Promise<string>; onDone(values: Record<string, string>): void; }) {
    const [values, setValues] = useState<Record<string, string>>({});
    const [preview, setPreview] = useState("");
    useEffect(() => { let live = true; void text(values).then(t => { if (live) setPreview(t); }); return () => { live = false; }; }, [JSON.stringify(values)]);
    const ready = blanks.every(b => values[b]?.trim());
    const done = () => { onDone(values); modalProps.onClose(); };
    return (
        <Window {...modalProps} size="md" title="Fill in the blanks" subtitle="Then it goes in your message box, ready to send">
            <div className="vc-tool-wrap vc-qtext-wrap" style={style()}>
                {blanks.map((b, i) => (
                    <label key={b} className="vc-tool-field">
                        <span className="vc-tool-label">{b}</span>
                        <input className="vc-tool-input" autoFocus={i === 0} value={values[b] ?? ""} placeholder={`Type the ${b}…`}
                            onChange={e => { const v = e.currentTarget.value; setValues(x => ({ ...x, [b]: v })); }}
                            onKeyDown={e => { if (e.key === "Enter" && ready) done(); }} />
                    </label>
                ))}
                <div className="vc-qtext-preview">{preview}</div>
                <div className="vc-tool-footer">
                    <span className="vc-tool-spacer" />
                    <button type="button" className="vc-tool-btn" onClick={modalProps.onClose}>Cancel</button>
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!ready} onClick={done}>Put in message box</button>
                </div>
            </div>
        </Window>
    );
}

/** Asks for the blanks (showing what it'll look like), then hands back what was typed. */
export function askBlanks(blanks: string[], preview: (v: Record<string, string>) => Promise<string>, onDone: (values: Record<string, string>) => void) {
    openModal(props => <FillModal modalProps={props} blanks={blanks} text={preview} onDone={onDone} />);
}

/** Asks for any blanks, then hands back the finished text. */
export function withBlanks(raw: string, blanks: string[], onDone: (result: string) => void) {
    if (!blanks.length) { void fill(raw).then(onDone); return; }
    askBlanks(blanks, v => fill(raw, v), v => void fill(raw, v).then(onDone));
}

/* ── Your snippets ── */

function Editor({ start, all, onDone }: { start: Snippet; all: Snippet[]; onDone(): void; }) {
    const [trigger, setTrigger] = useState(start.trigger);
    const [text, setText] = useState(start.text);
    const [preview, setPreview] = useState("");
    const area = useRef<HTMLTextAreaElement>(null);
    const blanks = blanksOf(text);
    useEffect(() => { let live = true; void fill(text, Object.fromEntries(blanks.map(b => [b, `‹${b}›`]))).then(t => { if (live) setPreview(t); }); return () => { live = false; }; }, [text]);

    const t = trigger.trim().replace(/^;/, "");
    const taken = all.some(s => s.id !== start.id && s.trigger.toLowerCase() === t.toLowerCase());
    const problem = !t ? null : !TRIGGER.test(t) ? "Use letters, numbers, - or _ (up to 20)." : taken ? "You already have a snippet with that word." : WALLET_WORDS.has(t.toLowerCase()) ? `;${t} is your Wallet's — pick another word.` : null;
    const insert = (v: string) => {
        const el = area.current;
        const a = el?.selectionStart ?? text.length, b = el?.selectionEnd ?? text.length;
        setText(text.slice(0, a) + v + text.slice(b));
        setTimeout(() => { el?.focus(); el?.setSelectionRange(a + v.length, a + v.length); }, 0);
    };

    return (
        <section className="vc-qtext-editor">
            <div className="vc-tool-row">
                <span className="vc-qtext-semi">;</span>
                <input className="vc-tool-input vc-qtext-trigger" autoFocus value={trigger} maxLength={21} placeholder="addr" onChange={e => setTrigger(e.currentTarget.value.replace(/\s/g, ""))} />
                <span className="vc-tool-hint">Type <b>;{t || "word"}</b> in a message and it becomes the text below when you send.</span>
            </div>
            {problem && <span className="vc-tool-error">{problem}</span>}
            <textarea ref={area} className="vc-tool-area vc-qtext-text" value={text} placeholder="What it turns into. Add {name} for a blank you fill in each time." onChange={e => setText(e.currentTarget.value)} />
            <div className="vc-tool-chips">
                {VARIABLES.map(([v, label]) => <button key={v} type="button" className="vc-tool-chip" title={`Put in ${label}`} onClick={() => insert(v)}>{v} <small>{label}</small></button>)}
                <button type="button" className="vc-tool-chip" title="A blank you fill in when you use it" onClick={() => insert("{name}")}>＋ Blank <small>{"{name}"}</small></button>
            </div>
            {text.trim() && (
                <>
                    <span className="vc-tool-label">Preview{blanks.length ? ` · blanks: ${blanks.join(", ")}` : ""}</span>
                    <div className="vc-qtext-preview">{preview}</div>
                </>
            )}
            <div className="vc-tool-footer">
                <span className="vc-tool-spacer" />
                <button type="button" className="vc-tool-btn" onClick={onDone}>Cancel</button>
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!t || !!problem || !text.trim()}
                    onClick={() => { putSnippet({ ...start, trigger: t, text }); showToast(`Saved ;${t}`, "success"); onDone(); }}>Save</button>
            </div>
        </section>
    );
}

function SnippetCard({ s, onEdit, onUse }: { s: Snippet; onEdit(): void; onUse(): void; }) {
    const [sure, setSure] = useState(false);
    useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 3000); return () => clearTimeout(t); }, [sure]);
    const blanks = blanksOf(s.text);
    return (
        <div className="vc-qtext-card">
            <button type="button" className="vc-qtext-main" title="Put it in your message box" onClick={onUse}>
                <span className="vc-qtext-word">;{s.trigger}</span>
                <span className="vc-qtext-body">{s.text}</span>
                <span className="vc-tool-hint">{blanks.length ? `Asks for: ${blanks.join(", ")}` : "Ready to go"}{s.uses ? ` · used ${s.uses}×` : ""}</span>
            </button>
            <div className="vc-qtext-tools">
                <button type="button" className="vc-tool-btn" onClick={onEdit}>✎</button>
                {sure
                    ? <button type="button" className="vc-tool-btn vc-qtext-sure" onClick={() => removeSnippet(s.id)}>Delete</button>
                    : <button type="button" className="vc-qtext-x" title="Delete" aria-label="Delete" onClick={() => setSure(true)}>✕</button>}
            </div>
        </div>
    );
}

const STARTERS: [string, string][] = [["gm", "Good morning {me} here ☀️ — hope your {day} is a good one!"], ["brb", "Be right back — {random:5 min|2 secs|one moment} ⏳"], ["addr", "My address is {street}, {city}."], ["ty", "Thank you so much, {name}! 💖"]];

function QuickTextModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const list = useSnippets();
    const [editing, setEditing] = useState<Snippet | null>(null);
    const fresh = (trigger = "", text = ""): Snippet => ({ id: `q${Date.now().toString(36)}`, trigger, text, uses: 0 });
    const use = (s: Snippet) => withBlanks(s.text, blanksOf(s.text), out => { insertTextIntoChatInputBox(out); used(s.id); modalProps.onClose(); });
    const total = list.reduce((n, s) => n + s.uses, 0);

    return (
        <Window {...modalProps} size="lg" title="Quick Text" subtitle="Type ;word in a message and it turns into your saved text when you send">
            <div className="vc-tool-wrap vc-qtext-wrap" style={style()}>
                <ToolHero icon="⌨️" kicker="Quick Text" title={list.length ? `${list.length} snippet${list.length === 1 ? "" : "s"}` : "Save text you type a lot"}
                    sub={list.length ? "Type ;word in a message, or click one below to put it in your message box." : "Addresses, greetings, rules, links — with blanks to fill in and {date}, {time} or {me} filled in for you."}
                    numbers={total ? [{ value: total, label: "times used" }] : []}>
                    {!editing && <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => setEditing(fresh())}>＋ New snippet</button>}
                </ToolHero>
                {editing ? <Editor start={editing} all={list} onDone={() => setEditing(null)} /> : list.length ? (
                    <div className="vc-qtext-grid">{[...list].sort((a, b) => b.uses - a.uses).map(s => <SnippetCard key={s.id} s={s} onEdit={() => setEditing(s)} onUse={() => use(s)} />)}</div>
                ) : (
                    <>
                        <span className="vc-tool-label">Start from one of these</span>
                        <div className="vc-qtext-grid">
                            {STARTERS.map(([t, x]) => (
                                <button key={t} type="button" className="vc-qtext-card vc-qtext-starter" onClick={() => setEditing(fresh(t, x))}>
                                    <span className="vc-qtext-word">;{t}</span><span className="vc-qtext-body">{x}</span>
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </Window>
    );
}

export const openQuickText = () => openModal(props => <QuickTextModal modalProps={props} />);
