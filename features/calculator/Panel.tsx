/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, showToast, useMemo, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { DatesTab } from "./Dates";
import { AngleMode, asFraction, CalcError, evaluateFull, formatResult, inBases, Rounding } from "./engine";
import { GraphsTab } from "./Graphs";
import { addEntry, clearHistory, removeEntry, useHistory } from "./history";
import { MoneyTab } from "./Money";
import { ToolsTab } from "./Tools";
import { removeVar, setVar, useVars } from "./variables";

const cl = classNameFactory("vc-calc-");

const KEYS: { label: string; insert?: string; kind?: "op" | "fn" | "eq" | "clear" | "back"; wide?: boolean; }[] = [
    { label: "C", kind: "clear" }, { label: "(", insert: "(" }, { label: ")", insert: ")" }, { label: "÷", insert: "÷", kind: "op" },
    { label: "7", insert: "7" }, { label: "8", insert: "8" }, { label: "9", insert: "9" }, { label: "×", insert: "×", kind: "op" },
    { label: "4", insert: "4" }, { label: "5", insert: "5" }, { label: "6", insert: "6" }, { label: "−", insert: "−", kind: "op" },
    { label: "1", insert: "1" }, { label: "2", insert: "2" }, { label: "3", insert: "3" }, { label: "+", insert: "+", kind: "op" },
    { label: "0", insert: "0" }, { label: ".", insert: "." }, { label: "⌫", kind: "back" }, { label: "=", kind: "eq" },
];

const SCI = [
    { label: "√", insert: "√" }, { label: "xʸ", insert: "^" }, { label: "π", insert: "π" }, { label: "e", insert: "e" },
    { label: "sin", insert: "sin(" }, { label: "cos", insert: "cos(" }, { label: "tan", insert: "tan(" }, { label: "%", insert: "%" },
    { label: "ln", insert: "ln(" }, { label: "log", insert: "log(" }, { label: "x!", insert: "!" }, { label: "ans", insert: "ans" },
];

type Tab = "calc" | "graphs" | "money" | "dates" | "tools";
const TABS: [Tab, string][] = [["calc", "🧮 Calculator"], ["graphs", "📈 Graphs"], ["money", "💰 Money"], ["dates", "📅 Dates & time"], ["tools", "🛠️ Tools"]];

const ROUNDINGS: [Rounding, string][] = [["auto", "Auto"], ["0", "0"], ["2", "0.00"], ["4", "4 dp"], ["6", "6 dp"], ["sig3", "3 sig"], ["sig5", "5 sig"]];

export interface CalcPrefs { angle: AngleMode; rounding: Rounding; fraction: boolean; bases: boolean; }

function CalcModal({ modalProps, prefs: initial, setPrefs: save }: { modalProps: RenderModalProps; prefs: CalcPrefs; setPrefs(p: Partial<CalcPrefs>): void; }) {
    const [tab, setTab] = useState<Tab>("calc");
    // Kept here too, so a change shows straight away (and is saved for next time).
    const [prefs, setPrefsState] = useState(initial);
    const setPrefs = (p: Partial<CalcPrefs>) => { setPrefsState(s => ({ ...s, ...p })); save(p); };
    const accent = windowAccent("calculator");
    return (
        <Modal {...modalProps} size="lg" title="Calculator" subtitle={tab === "calc" ? (prefs.angle === "deg" ? "Angles in degrees" : "Angles in radians") : tab === "graphs" ? "Draw y = anything — drag, zoom and hover" : tab === "money" ? "Answers as you type — click one to copy it" : tab === "dates" ? "Days, ages and durations" : "Statistics, graphs and more"}>
            <div className={cl("wrap")} style={accent ? ({ "--vc-calc-accent": accent, "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className={cl("tabs")} role="tablist">
                    {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={classes(cl("tab"), tab === id && cl("tab-on"))} onClick={() => setTab(id)}>{label}</button>)}
                </div>
                {tab === "calc" ? <CalcTab prefs={prefs} setPrefs={setPrefs} /> : tab === "graphs" ? <GraphsTab /> : tab === "money" ? <MoneyTab /> : tab === "dates" ? <DatesTab /> : <ToolsTab />}
            </div>
        </Modal>
    );
}

function CalcTab({ prefs, setPrefs }: { prefs: CalcPrefs; setPrefs(p: Partial<CalcPrefs>): void; }) {
    const history = useHistory();
    const vars = useVars();
    const mode = prefs.angle;
    const [expr, setExpr] = useState("");
    const [angle, setAngleState] = useState<AngleMode>(mode);
    const setMode = (m: AngleMode) => setPrefs({ angle: m });
    const [shown, setShown] = useState<{ expr: string; result: string; } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const ans = history[0]?.value;

    // Live preview while typing (errors stay quiet until you press =).
    const previewValue = useMemo(() => {
        if (!expr.trim()) return null;
        try { return evaluateFull(expr, { mode: angle, ans, vars }).value; } catch { return null; }
    }, [expr, angle, ans, vars]);
    const preview = previewValue == null ? null : formatResult(previewValue, prefs.rounding);

    const focus = () => setTimeout(() => input.current?.focus(), 0);

    const insertAtCursor = (text: string) => {
        const el = input.current;
        const start = el?.selectionStart ?? expr.length;
        const end = el?.selectionEnd ?? expr.length;
        const next = expr.slice(0, start) + text + expr.slice(end);
        setExpr(next);
        setError(null);
        setTimeout(() => { el?.focus(); el?.setSelectionRange(start + text.length, start + text.length); }, 0);
    };

    const calculate = () => {
        try {
            const { value, assigned } = evaluateFull(expr, { mode: angle, ans, vars });
            const result = formatResult(value, prefs.rounding);
            if (assigned) { setVar(assigned, value); showToast(`Saved ${assigned} = ${result}`, "success"); }
            addEntry({ expr: expr.trim(), result, value, t: Date.now() });
            setShown({ expr: expr.trim(), result });
            setExpr(result);
            setError(null);
        } catch (e) {
            setError(e instanceof CalcError ? e.message : "Something went wrong");
        }
        focus();
    };

    const press = (k: typeof KEYS[number]) => {
        if (k.kind === "clear") { setExpr(""); setShown(null); setError(null); focus(); }
        else if (k.kind === "back") { setExpr(expr.slice(0, -1)); setError(null); focus(); }
        else if (k.kind === "eq") calculate();
        else insertAtCursor(k.insert!);
    };

    const result = shown && shown.result === expr ? shown.result : preview;
    const copy = async (text: string) => {
        try { await navigator.clipboard.writeText(text); showToast("Copied", "success"); } catch { showToast("Couldn't copy", "failure"); }
    };

    const extra = previewValue != null || (shown && shown.result === expr) ? (() => {
        const v = previewValue ?? Number(expr);
        const parts: string[] = [];
        if (prefs.fraction) { const f = asFraction(v); if (f) parts.push(`= ${f}`); }
        if (prefs.bases) { const b = inBases(v); if (b) parts.push(`${b.hex} · ${b.bin} · ${b.oct}`); }
        return parts.join("   ");
    })() : "";

    return (
        <>
                <div className={cl("layout")}>
                    <section className={cl("calc")}>
                        <div className={classes(cl("display"), error && cl("display-error"))}>
                            <div className={cl("display-top")}>{shown && shown.result === expr ? `${shown.expr} =` : error ?? (preview != null ? `= ${preview}` : "\u00a0")}</div>
                            <input
                                ref={input}
                                className={cl("input")}
                                value={expr}
                                autoFocus
                                spellCheck={false}
                                placeholder="0"
                                aria-label="Calculation"
                                onChange={e => { setExpr(e.currentTarget.value); setShown(null); setError(null); }}
                                onKeyDown={e => {
                                    if (e.key === "Enter") { e.preventDefault(); calculate(); }
                                    else if (e.key === "Escape" && expr) { e.preventDefault(); e.stopPropagation(); setExpr(""); setShown(null); setError(null); }
                                    else if (e.key === "ArrowUp" && history[0]) { e.preventDefault(); setExpr(history[0].expr); setShown(null); }
                                }}
                            />
                        </div>

                        {extra && <div className={cl("extra")}>{extra}</div>}
                        <div className={cl("toolbar")}>
                            <div className={cl("seg")} role="radiogroup" aria-label="Angle unit">
                                {(["deg", "rad"] as const).map(m => (
                                    <button key={m} type="button" role="radio" aria-checked={angle === m}
                                        className={classes(cl("seg-btn"), angle === m && cl("seg-active"))}
                                        onClick={() => { setAngleState(m); setMode(m); focus(); }}>
                                        {m === "deg" ? "Deg" : "Rad"}
                                    </button>
                                ))}
                            </div>
                            <div className={cl("result-actions")}>
                                <button type="button" className={cl("mini")} disabled={!result} onClick={() => result && copy(result)}>Copy</button>
                                <button type="button" className={cl("mini")} disabled={!result} title="Insert the result into your message"
                                    onClick={() => { if (result) { insertTextIntoChatInputBox(result); showToast("Inserted into your message", "success"); } }}>
                                    Insert
                                </button>
                            </div>
                        </div>

                        <div className={cl("prefs")}>
                            <select className={cl("select")} value={prefs.rounding} title="How many decimals to show" onChange={e => setPrefs({ rounding: e.currentTarget.value as Rounding })}>
                                {ROUNDINGS.map(([v, l]) => <option key={v} value={v}>Rounding: {l}</option>)}
                            </select>
                            <label className={cl("toggle")}><input type="checkbox" checked={prefs.fraction} onChange={e => setPrefs({ fraction: e.currentTarget.checked })} /> Fractions</label>
                            <label className={cl("toggle")}><input type="checkbox" checked={prefs.bases} onChange={e => setPrefs({ bases: e.currentTarget.checked })} /> Hex / binary</label>
                        </div>
                        <div className={cl("sci")}>
                            {SCI.map(k => <button key={k.label} type="button" className={cl("key")} onClick={() => insertAtCursor(k.insert)}>{k.label}</button>)}
                        </div>
                        <div className={cl("pad")}>
                            {KEYS.map(k => (
                                <button key={k.label} type="button" onClick={() => press(k)}
                                    className={classes(cl("key"), k.kind && cl(`key-${k.kind}`))}>
                                    {k.label}
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className={cl("history")}>
                        {Object.keys(vars).length > 0 && (
                            <div className={cl("vars")}>
                                <div className={cl("history-head")}><span>Saved values</span></div>
                                {Object.entries(vars).map(([name, value]) => (
                                    <div key={name} className={cl("var")}>
                                        <button type="button" className={cl("entry-result")} title="Use it" onClick={() => insertAtCursor(name)}>{name} = {formatResult(value, prefs.rounding)}</button>
                                        <button type="button" className={cl("entry-x")} aria-label={`Forget ${name}`} onClick={() => removeVar(name)}>✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className={cl("history-head")}>
                            <span>History</span>
                            {history.length > 0 && <button type="button" className={cl("link")} onClick={clearHistory}>Clear</button>}
                        </div>
                        <div className={cl("history-list")}>
                            {history.length === 0 ? (
                                <div className={cl("empty")}><span className={cl("empty-icon")}>🧮</span>Your calculations will show up here.</div>
                            ) : history.map(h => (
                                <div key={h.t} className={cl("entry")}>
                                    <button type="button" className={cl("entry-expr")} title="Load this calculation" onClick={() => { setExpr(h.expr); setShown(null); setError(null); focus(); }}>{h.expr}</button>
                                    <div className={cl("entry-row")}>
                                        <button type="button" className={cl("entry-result")} title="Use this result" onClick={() => insertAtCursor(h.result)}>= {h.result}</button>
                                        <button type="button" className={cl("entry-x")} aria-label="Remove" onClick={() => removeEntry(h.t)}>✕</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className={cl("tip")}>Tips: <b>200 + 10%</b> · <b>20% of 150</b> · <b>rent = 1200</b> then <b>rent / 3</b> · <b>avg(4, 8, 15)</b> · <b>round(x, 2)</b></div>
                    </section>
                </div>
        </>
    );
}

export function openCalculator(prefs: CalcPrefs, setPrefs: (p: Partial<CalcPrefs>) => void) {
    openModal(props => <CalcModal modalProps={props} prefs={prefs} setPrefs={setPrefs} />);
}
