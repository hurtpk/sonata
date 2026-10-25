/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, showToast, useEffect, useMemo, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { openSection, registerSection } from "../../_shared/Hub";
import { getBytes } from "../../_shared/media";
import { Window } from "../../_shared/Window";
import { checkLink, makeQr, qrPng, readQrImage } from "./qr";

const cl = classNameFactory("vc-qr-");
const tl = classNameFactory("vc-tool-");

function QrSvg({ text, px = 240 }: { text: string; px?: number; }) {
    const qr = useMemo(() => { try { return makeQr(text); } catch { return null; } }, [text]);
    if (!qr) return <div className={tl("empty")}><span className={tl("empty-icon")}>📏</span>That's too much text for one QR code.</div>;
    return (
        <svg className={cl("svg")} width={px} height={px} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label="QR code">
            <rect width={qr.size} height={qr.size} fill="#fff" />
            <path d={qr.path} fill="#000" />
        </svg>
    );
}

function MakeModal({ modalProps, initial }: { modalProps: RenderModalProps; initial: string; }) {
    const [text, setText] = useState(initial);
    const accent = windowAccent("qrCodes");
    const t = text.trim();

    const copyImage = async () => {
        try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": await qrPng(t) })]);
            showToast("QR code copied", "success");
        } catch { showToast("Couldn't copy the image", "failure"); }
    };
    const save = async () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(await qrPng(t));
        a.download = "qr-code.png";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };

    return (
        <Window {...modalProps} size="md" title="QR Code" subtitle="Scan it with your phone's camera">
            <div className={classes(tl("wrap"), cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className={cl("make")}>
                    <div className={cl("code")}>{t ? <QrSvg text={t} px={220} /> : <span className={cl("code-empty")}><span aria-hidden>▦</span>Your code shows up here</span>}</div>
                    <div className={cl("side")}>
                        <span className={tl("label")}>What's in it</span>
                        <textarea className={classes(tl("area"), cl("area"))} autoFocus value={text} placeholder="A link, an invite, any text…" onChange={e => setText(e.currentTarget.value)} />
                        <span className={tl("hint")}>{t ? `${t.length} characters · ${/^https?:\/\//i.test(t) ? "opens a link" : "shows as text"}` : "Anyone who scans it sees exactly this."}</span>
                        <div className={cl("btns")}>
                            <button type="button" className={classes(tl("btn"), tl("primary"))} disabled={!t} onClick={copyImage}>Copy image</button>
                            <button type="button" className={tl("btn")} disabled={!t} onClick={save}>Save PNG</button>
                        </div>
                    </div>
                </div>
            </div>
        </Window>
    );
}

function ScanModal({ modalProps, src }: { modalProps: RenderModalProps; src: string; }) {
    const [state, setState] = useState<{ status: "loading"; } | { status: "none"; } | { status: "error"; error: string; } | { status: "found"; text: string; }>({ status: "loading" });
    const accent = windowAccent("qrCodes");

    useEffect(() => {
        let cancelled = false;
        getBytes(src, 25 * 1048576)
            .then(readQrImage)
            .then(text => { if (!cancelled) setState(text == null ? { status: "none" } : { status: "found", text }); })
            .catch(e => { if (!cancelled) setState({ status: "error", error: String(e?.message ?? e) }); });
        return () => { cancelled = true; };
    }, [src]);

    const link = state.status === "found" ? checkLink(state.text) : null;
    const copy = async (s: string) => {
        try { await navigator.clipboard.writeText(s); showToast("Copied", "success"); } catch { showToast("Couldn't copy", "failure"); }
    };

    return (
        <Window {...modalProps} size="md" title="Scan QR code" subtitle="Check where it leads before opening it">
            <div className={classes(tl("wrap"), cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                {state.status === "loading" && <div className={tl("empty")}><span className={tl("empty-icon")}>🔍</span>Reading the image…</div>}
                {state.status === "none" && <div className={tl("empty")}><span className={tl("empty-icon")}>🤷</span>No QR code found in this image.</div>}
                {state.status === "error" && <div className={tl("empty")}><span className={tl("empty-icon")}>⚠️</span>Couldn't read the image: {state.error}</div>}
                {state.status === "found" && (
                    <>
                        {link ? (
                            <div className={classes(cl("link"), link.warnings.length > 0 && cl("link-warn"))}>
                                <span className={cl("link-icon")} aria-hidden>{link.warnings.length ? "⚠️" : "🔗"}</span>
                                <div className={cl("link-text")}>
                                    <span className={cl("link-kicker")}>{link.warnings.length ? "Be careful — goes to" : "Goes to"}</span>
                                    <div className={cl("link-host")}>{link.host}</div>
                                    {link.warnings.map(w => <div key={w} className={cl("warning")}>⚠ {w}</div>)}
                                </div>
                            </div>
                        ) : <span className={tl("label")}>Contains text</span>}
                        <div className={classes(tl("out"), tl("mono"))}>{state.text}</div>
                        <div className={tl("footer")}>
                            <span className={tl("spacer")} />
                            <button type="button" className={tl("btn")} onClick={() => copy(state.text)}>Copy</button>
                            {link && (
                                <button type="button" className={classes(tl("btn"), tl("primary"), link.warnings.length > 0 && cl("open-warn"))}
                                    onClick={() => { window.open(link.url.toString(), "_blank", "noopener"); modalProps.onClose(); }}>
                                    {link.warnings.length ? "Open anyway" : "Open link"}
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </Window>
    );
}

registerSection("safety", { id: "qrCodes", feature: "qrCodes", name: "QR Codes", sub: "Make one, or check where one leads", render: p => <MakeModal modalProps={p} initial="" /> });
export const openQrMaker = (text = "") => openSection("safety", "qrCodes", text ? props => <MakeModal modalProps={props} initial={text} /> : undefined);
export const openQrScan = (src: string) => openModal(props => <ScanModal modalProps={props} src={src} />);
