/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, showToast, useMemo, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { CODECS, detect } from "./codecs";

const cl = classNameFactory("vc-tool-");

async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); showToast("Copied", "success"); } catch { showToast("Couldn't copy", "failure"); }
}

type Direction = "encode" | "decode";

function EncoderModal({ modalProps, initial, initialCodec, initialDirection, onUse }: {
    modalProps: RenderModalProps; initial: string; initialCodec: string; initialDirection: Direction; onUse(codec: string): void;
}) {
    const accent = windowAccent("encoderTools");
    const [text, setText] = useState(initial);
    const [codecId, setCodecId] = useState(initialCodec);
    const [direction, setDirection] = useState<Direction>(initialDirection);
    const codec = CODECS.find(c => c.id === codecId) ?? CODECS[0];

    const { out, error } = useMemo(() => {
        if (!text) return { out: "", error: null };
        try { return { out: codec[direction](text), error: null }; } catch (e: any) { return { out: "", error: String(e?.message ?? e) }; }
    }, [text, codec, direction]);

    // What the text already looks like, so one click decodes it.
    const guesses = useMemo(() => detect(text).filter(c => !(c.id === codecId && direction === "decode")), [text, codecId, direction]);

    const insert = () => {
        if (!out) return;
        insertTextIntoChatInputBox(out);
        onUse(codec.id);
        modalProps.onClose();
    };

    return (
        <Modal {...modalProps} size="lg" title="Encoder Tools" subtitle="Turn text into Morse, binary, Base64 and more, or back again">
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className={cl("seg")}>
                    {CODECS.map(c => (
                        <button key={c.id} type="button" className={classes(cl("seg-btn"), c.id === codecId && cl("seg-on"))} onClick={() => setCodecId(c.id)}>{c.name}</button>
                    ))}
                </div>
                <div className={cl("row")}>
                    <div className={classes(cl("seg"), cl("grow"))}>
                        {(["encode", "decode"] as Direction[]).map(d => (
                            <button key={d} type="button" className={classes(cl("seg-btn"), direction === d && cl("seg-on"))} onClick={() => setDirection(d)}>
                                {d === "encode" ? `Text → ${codec.name}` : `${codec.name} → Text`}
                            </button>
                        ))}
                    </div>
                    <button type="button" className={cl("btn")} disabled={!out} title="Use the result as the new input and flip the direction"
                        onClick={() => { setText(out); setDirection(direction === "encode" ? "decode" : "encode"); }}>⇅ Swap</button>
                </div>

                <div className="vc-enc-io">
                <div className="vc-enc-side">
                <div className={cl("label")}>{direction === "encode" ? "Text" : codec.name}</div>
                <textarea className={classes(cl("area"), "vc-enc-area", direction === "decode" && cl("mono"))} autoFocus value={text} spellCheck={false}
                    placeholder={direction === "encode" ? "Type or paste text…" : `Paste ${codec.name}…`}
                    onChange={e => setText(e.currentTarget.value)} />

                {guesses.length > 0 && (
                    <div className={cl("row")}>
                        <span className={cl("hint")}>This looks like</span>
                        {guesses.map(g => (
                            <button key={g.id} type="button" className={cl("btn")} onClick={() => { setCodecId(g.id); setDirection("decode"); }}>Decode {g.name}</button>
                        ))}
                    </div>
                )}

                </div>
                <div className="vc-enc-side">
                <div className={cl("label")}>{direction === "encode" ? codec.name : "Text"}</div>
                <div className={classes(cl("out"), "vc-enc-out", !out && cl("out-empty"), direction === "encode" && codec.id !== "rot13" && codec.id !== "reverse" && cl("mono"))}>
                    {out || (error ? "" : "The result shows up here.")}
                </div>
                </div>
                </div>
                {error && <div className={cl("error")}>{error}</div>}

                <div className={cl("footer")}>
                    <span className={cl("hint")}>{out ? `${[...out].length} characters` : ""}</span>
                    <span className={cl("spacer")} />
                    <button type="button" className={cl("btn")} disabled={!out} onClick={() => copy(out)}>Copy</button>
                    <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={!out} onClick={insert}>Insert into message</button>
                </div>
            </div>
        </Modal>
    );
}

export function openEncoder(opts: { text?: string; codec: string; direction?: Direction; onUse(codec: string): void; }) {
    const text = opts.text ?? "";
    // Opened on a message: if it's already encoded, start by decoding it.
    const guess = text ? detect(text)[0] : undefined;
    openModal(props => (
        <EncoderModal modalProps={props} initial={text} onUse={opts.onUse}
            initialCodec={guess?.id ?? opts.codec} initialDirection={opts.direction ?? (guess ? "decode" : "encode")} />
    ));
}
