/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { showToast, useMemo, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { FormGroup, FormRow, Toggle } from "../_shared/WindowParts";
import { openModeration, registerModerationPart } from "../serverTools/Moderation";
import { generate, MAX_LEN, type Opts } from "./regex";
import { readOpts, writeOpt } from "./settings";

const cl = classNameFactory("vc-amr-");
const tl = classNameFactory("vc-tool-");

async function copy(text: string, what = "Copied") {
    try { await navigator.clipboard.writeText(text); showToast(what, "success"); } catch { showToast("Couldn't copy", "failure"); }
}

const OPTIONS: [keyof Opts, string, string][] = [
    ["leet", "Look-alike symbols", "a → 4 or @, o → 0, s → $ and so on"],
    ["homoglyphs", "Cyrillic look-alikes", "Letters from other alphabets that look the same"],
    ["separators", "Spaces and punctuation", "Catches b.a.d  w o r d style splitting"],
    ["stretch", "Repeated letters", "Catches baaadword"],
    ["wordStart", "Start of a word only", "Stops “grape” or “therapist” matching a shorter term"],
    ["vowelSwap", "Swapped vowels", "Any character in place of a vowel (fxggot). Only for terms of 5+ letters"],
    ["ignoreCase", "Ignore capitals", "Adds (?i). Turn it off if Discord rejects it"],
];

function AutoModModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const accent = windowAccent("autoModRegex");
    const [text, setText] = useState("");
    const [opts, setOpts] = useState<Opts>(readOpts);

    const set = (k: keyof Opts, v: boolean) => { writeOpt(k, v); setOpts(o => ({ ...o, [k]: v })); };
    const { rules, skipped, short, total } = useMemo(() => generate(text, opts), [text, opts]);

    return (
        <Window {...modalProps} size="xl" title="AutoMod Regex" subtitle="Turn a word list into AutoMod regex patterns"
            status={[total ? `${total} pattern${total === 1 ? "" : "s"} in ${rules.length} rule${rules.length === 1 ? "" : "s"}` : "Paste a word list to start", "10 patterns per rule · 260 characters each"]}>
            <div className={classes(tl("wrap"), cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="🛡️" kicker="AutoMod" title="Regex generator"
                    sub="Paste your own terms and get patterns that also catch look-alike characters, spacing and stretched letters."
                    numbers={[{ value: total, label: "patterns" }, { value: rules.length, label: "rules" }]} />

                <div className={cl("cols")}>
                    <div className={cl("left")}>
                        <span className={tl("label")}>Words — one per line</span>
                        <textarea className={classes(tl("area"), tl("mono"), cl("area"))} autoFocus spellCheck={false} value={text}
                            placeholder={"One term per line.\nLines starting with # are ignored."}
                            onChange={e => setText(e.currentTarget.value)} />
                        <span className={tl("hint")}>Start a line with * to match it inside any word (lolxxxx, xxxxlol). Nothing here is saved.</span>

                        <FormGroup title="What to catch">
                            {OPTIONS.map(([k, label, help]) => (
                                <FormRow key={k} label={label} help={help}>
                                    <Toggle value={opts[k]} onChange={v => set(k, v)} label={label} />
                                </FormRow>
                            ))}
                        </FormGroup>
                    </div>

                    <div className={cl("right")}>
                        {short > 0 && <div className={classes(tl("badge"), tl("badge-bad"))}>{short} short term{short === 1 ? "" : "s"} (under 4 letters): test those, they match inside other words</div>}
                        {skipped.length > 0 && <div className={tl("error")}>Over {MAX_LEN} characters even with everything off (line {skipped.join(", ")}). Add those as plain keywords instead.</div>}

                        {total === 0 && (
                            <div className={tl("empty")}><span className={tl("empty-icon")}>🧩</span>Your patterns show up here.</div>
                        )}

                        {rules.map((rule, i) => (
                            <section key={i} className={cl("rule")}>
                                <div className={cl("rule-head")}>
                                    <b>Rule {i + 1}</b>
                                    <span className={tl("hint")}>{rule.length} pattern{rule.length === 1 ? "" : "s"}</span>
                                    <span className={tl("spacer")} />
                                    <button type="button" className={tl("btn")} onClick={() => copy(rule.join("\n"), `Rule ${i + 1} copied`)}>Copy rule</button>
                                </div>
                                {rule.map((p, j) => (
                                    <button key={j} type="button" className={classes(cl("pat"), tl("mono"))} title="Click to copy" onClick={() => copy(p, "Pattern copied")}>{p}</button>
                                ))}
                            </section>
                        ))}

                        {total > 0 && <span className={tl("hint")}>In Discord: Server Settings → Safety Setup → AutoMod → Create Rule → Block Custom Words, then paste each pattern into the regex field. Start with Send Alert only, and switch to Block Message once the alerts look clean.</span>}
                    </div>
                </div>

                <div className={tl("footer")}>
                    <span className={tl("hint")}>{total ? "Click a pattern to copy it" : ""}</span>
                    <span className={tl("spacer")} />
                    <button type="button" className={tl("btn")} disabled={!text} onClick={() => setText("")}>Clear</button>
                    <button type="button" className={classes(tl("btn"), tl("primary"))} disabled={!total} onClick={() => copy(rules.flat().join("\n"), "All patterns copied")}>Copy all patterns</button>
                </div>
            </div>
        </Window>
    );
}

export const openAutoModRegex = () => openModeration("autoModRegex", props => renderAutoModRegex(props));

export function renderAutoModRegex(props: RenderModalProps) { return (<AutoModModal modalProps={props} />); }
registerModerationPart("autoModRegex", renderAutoModRegex);
