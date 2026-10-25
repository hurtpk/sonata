/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../../_shared/tool.css";
import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { Menu, openModal, showToast, useEffect, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { defineFeatureSettings } from "../../../featureSettings";
import { imageFromMenu, MediaNative } from "../../_shared/media";
import { Window } from "../../_shared/Window";
import { GoogleLanguages } from "../../translate/languages";
import { translateWithGoogle } from "../../translate/utils";

const cl = classNameFactory("vc-ocr-");

export const settings = defineFeatureSettings("imageToText", {
    autoCopy: {
        type: OptionType.BOOLEAN,
        description: "Copy the text straight away (the window still shows it so you can check it)",
        default: false,
    },
    translateTo: {
        type: OptionType.STRING,
        description: "Internal: the language the Translate tab uses.",
        default: "",
        hidden: true,
    },
});

/** Your language, to start with (e.g. "en" from "en-GB"). */
const myLanguage = () => {
    const l = (navigator.language || "en").toLowerCase();
    return l in GoogleLanguages ? l : l.split("-")[0] in GoogleLanguages ? l.split("-")[0] : "en";
};
const LANGUAGES = Object.entries(GoogleLanguages).filter(([code]) => code !== "auto").sort((a, b) => a[1].localeCompare(b[1]));

/** The text in another language (done again whenever the text or language changes). */
function useTranslation(text: string, to: string, on: boolean) {
    const [out, setOut] = useState<{ status: "idle" | "loading" | "done" | "error"; text: string; from?: string; error?: string; }>({ status: "idle", text: "" });
    useEffect(() => {
        if (!on || !text.trim()) return;
        let cancelled = false;
        setOut(o => ({ ...o, status: "loading" }));
        const t = setTimeout(() => {
            translateWithGoogle(text, to).then(
                r => { if (!cancelled) setOut({ status: "done", text: r.text, from: r.sourceLanguage }); },
                e => { if (!cancelled) setOut({ status: "error", text: "", error: e instanceof Error ? e.message.split("\n")[0] : "Couldn't translate it" }); },
            );
        }, 350);
        return () => { cancelled = true; clearTimeout(t); };
    }, [text, to, on]);
    return out;
}

async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); showToast("Text copied", "success"); return true; } catch { showToast("Couldn't copy", "failure"); return false; }
}

function OcrModal({ modalProps, src }: { modalProps: RenderModalProps; src: string; }) {
    const [state, setState] = useState<{ status: "loading"; } | { status: "error"; error: string; } | { status: "done"; }>({ status: "loading" });
    const [text, setText] = useState("");
    const [tab, setTab] = useState<"text" | "translate">("text");
    const [to, setTo] = useState(() => settings.store.translateTo || myLanguage());
    const [translated, setTranslated] = useState<string | null>(null);
    const tr = useTranslation(text, to, tab === "translate");
    // The translation can be edited too; a fresh translation replaces the edit.
    useEffect(() => { setTranslated(null); }, [tr.text]);
    const shownTranslation = translated ?? tr.text;
    const accent = windowAccent("imageToText");

    useEffect(() => {
        let cancelled = false;
        if (!MediaNative) { setState({ status: "error", error: "Image to Text needs the Discord desktop app." }); return; }
        MediaNative.recognizeText(src).then(r => {
            if (cancelled) return;
            if (!r.ok) return setState({ status: "error", error: r.error });
            setText(r.text);
            setState({ status: "done" });
            if (r.text && settings.store.autoCopy) copy(r.text);
        }).catch(e => { if (!cancelled) setState({ status: "error", error: String(e?.message ?? e) }); });
        return () => { cancelled = true; };
    }, [src]);

    const lines = text ? text.split("\n").length : 0;

    return (
        <Window {...modalProps} size="lg" title="Text from image"
            subtitle={state.status === "done" ? (text ? `${lines} line${lines === 1 ? "" : "s"} found — edit anything before copying` : "No text found") : "Read on your computer — nothing is uploaded"}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className={cl("layout")}>
                    <img className={cl("image")} src={src} alt="" />
                    <div className={cl("side")}>
                        {state.status === "loading" && <div className={cl("note")}><span className={cl("spinner")} />Reading the text…</div>}
                        {state.status === "error" && <div className={cl("error")}>{state.error}</div>}
                        {state.status === "done" && text && (
                            <div className={cl("tabs")} role="tablist">
                                <button type="button" role="tab" aria-selected={tab === "text"} className={classes(cl("tab"), tab === "text" && cl("tab-on"))} onClick={() => setTab("text")}>📝 Text</button>
                                <button type="button" role="tab" aria-selected={tab === "translate"} className={classes(cl("tab"), tab === "translate" && cl("tab-on"))} onClick={() => setTab("translate")}>🌐 Translate</button>
                                {tab === "translate" && (
                                    <select className={cl("lang")} value={to} onChange={e => { setTo(e.currentTarget.value); settings.store.translateTo = e.currentTarget.value; }} aria-label="Translate to">
                                        {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                                    </select>
                                )}
                            </div>
                        )}
                        {state.status === "done" && !text && <div className={cl("note")}>No text could be found in this image.</div>}
                        {state.status === "done" && text && tab === "text" && (
                            <textarea className={cl("text")} value={text} onChange={e => setText(e.currentTarget.value)} spellCheck={false} />
                        )}
                        {state.status === "done" && text && tab === "translate" && (
                            <>
                                {tr.status === "error"
                                    ? <div className={cl("error")}>{tr.error}</div>
                                    : <textarea className={classes(cl("text"), tr.status === "loading" && cl("text-busy"))} value={tr.status === "loading" && !shownTranslation ? "Translating…" : shownTranslation} onChange={e => setTranslated(e.currentTarget.value)} spellCheck={false} />}
                                <span className={cl("hint")}>{tr.status === "loading" ? "Translating…" : tr.from ? `From ${tr.from} · Google Translate` : "Google Translate"}</span>
                            </>
                        )}
                        <div className={cl("actions")}>
                            <button type="button" className={cl("btn")} onClick={modalProps.onClose}>Close</button>
                            <button type="button" className={cl("btn-primary")} disabled={tab === "text" ? !text : !shownTranslation || tr.status !== "done"} onClick={() => copy(tab === "text" ? text : shownTranslation)}>{tab === "text" ? "Copy text" : "Copy translation"}</button>
                        </div>
                    </div>
                </div>
            </div>
        </Window>
    );
}

const openOcr = (src: string) => openModal(props => <OcrModal modalProps={props} src={src} />);

const menu: NavContextMenuPatchCallback = (children, props) => {
    const image = imageFromMenu(props);
    if (image) children.push(<Menu.MenuItem id="vc-ocr-copy" label="Copy text from image" action={() => openOcr(image)} />);
};

export default definePlugin({
    name: "ImageToText",
    description: "Right-click an image → Copy text from image. Uses your computer's own text recognition (built into Windows 10/11; tesseract on Linux) — nothing is uploaded.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    contextMenus: {
        "message": menu,
        "image-context": menu,
    },
});
