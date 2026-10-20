/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";

import { classNameFactory } from "@utils/css";
import { sendMessage } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, SelectedChannelStore, showToast, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { Window } from "../_shared/Window";
import { encodeGift, Gift, PAPERS, RIBBONS } from "./gift";
import { Box } from "./Present";

const cl = classNameFactory("vc-tool-");

const myName = () => { const u: any = UserStore.getCurrentUser(); return u?.globalName || u?.username || ""; };

/** For "don't open until": tomorrow at 9am, and a time as the date-and-time box wants it. */
function tomorrowMorning() { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function WrapModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const accent = windowAccent("giftWrap");
    const [content, setContent] = useState("");
    const [note, setNote] = useState("");
    const [paper, setPaper] = useState("classic");
    const [ribbon, setRibbon] = useState("gold");
    const [wait, setWait] = useState<"now" | "later">("now");
    const [until, setUntil] = useState(() => localInput(tomorrowMorning()));
    const unlock = wait === "later" && until ? Math.floor(new Date(until).getTime() / 1000) : undefined;
    const unlockOk = !unlock || unlock * 1000 > Date.now() + 60_000;
    const gift: Gift = { f: myName(), n: note.trim() || undefined, c: content, p: paper, r: ribbon, u: unlock };
    // Discord shows <t:…> in everyone's own time zone, even for people without Sonata.
    const message = `🎁 **${gift.f || "Someone"} sent you a gift!** ${unlock ? `Opens <t:${unlock}:R> — unwrap it with Sonata` : "Unwrap it with Sonata"}\n-# ||${encodeGift(gift)}||`;
    const tooLong = message.length > 1990;
    const channelId = SelectedChannelStore.getChannelId();

    const send = () => {
        if (!channelId || !content.trim()) return;
        sendMessage(channelId, { content: message });
        showToast("Gift sent 🎁", "success");
        modalProps.onClose();
    };

    return (
        <Window {...modalProps} size="lg" title="Gift Wrap" subtitle="Wrap a message, link or picture as a present">
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className="vc-gw-layout">
                <div className="vc-gw-preview">
                    <Box gift={{ ...gift, c: "" }} />
                </div>
                <div className="vc-gw-side">
                <div className={cl("card")}>
                    <span className={cl("label")}>What's inside</span>
                    <textarea className={cl("area")} rows={3} value={content} maxLength={1200} autoFocus
                        placeholder="A message, a link (a song, a video, a game…), or a picture's link" onChange={e => setContent(e.currentTarget.value)} />
                    <input className={cl("input")} value={note} maxLength={40} placeholder="Gift tag (optional) — e.g. For Sam 💖" onChange={e => setNote(e.currentTarget.value)} />
                </div>
                <div className={cl("card")}>
                    <span className={cl("label")}>When can they open it?</span>
                    <div className="vc-tool-seg">
                        <button type="button" className={classes("vc-tool-seg-btn", wait === "now" && "vc-tool-seg-on")} onClick={() => setWait("now")}>🎁 Straight away</button>
                        <button type="button" className={classes("vc-tool-seg-btn", wait === "later" && "vc-tool-seg-on")} onClick={() => setWait("later")}>⏳ Not until…</button>
                    </div>
                    {wait === "later" && (
                        <div className="vc-gw-when">
                            <input className={cl("input")} type="datetime-local" value={until} min={localInput(new Date())} onChange={e => setUntil(e.currentTarget.value)} />
                            <button type="button" className="vc-tool-chip" onClick={() => setUntil(localInput(tomorrowMorning()))}>Tomorrow 9am</button>
                        </div>
                    )}
                    {!unlockOk && <span className={cl("error")}>Pick a time at least a minute from now.</span>}
                </div>
                <div className={cl("card")}>
                    <span className={cl("label")}>Wrapping paper</span>
                    <div className="vc-gw-pick">
                        {PAPERS.map(p => (
                            <button key={p.id} type="button" title={p.name} aria-label={p.name} className={classes("vc-gw-swatch", `vc-gw-paper-${p.id}`, paper === p.id && "vc-gw-swatch-on")} onClick={() => setPaper(p.id)} />
                        ))}
                    </div>
                    <span className={cl("label")}>Ribbon</span>
                    <div className="vc-gw-pick">
                        {RIBBONS.map(r => (
                            <button key={r.id} type="button" title={r.name} aria-label={r.name} className={classes("vc-gw-swatch", "vc-gw-swatch-round", ribbon === r.id && "vc-gw-swatch-on")} style={{ background: r.color }} onClick={() => setRibbon(r.id)} />
                        ))}
                    </div>
                </div>
                </div>
                </div>
                <span className={cl("hint")}>Friends with Sonata get a wrapped present to tap open. It's a surprise, not a secret — don't wrap anything private. A "not until" gift just waits; it isn't locked away.</span>
                {tooLong && <div className={cl("error")}>That's a little long for one message — trim it a bit.</div>}
                <div className={cl("footer")}>
                    <span className={cl("spacer")} />
                    <button type="button" className={cl("btn")} onClick={modalProps.onClose}>Cancel</button>
                    <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={!content.trim() || tooLong || !channelId || !unlockOk} onClick={send}>Send gift 🎁</button>
                </div>
            </div>
        </Window>
    );
}

export function openGiftWrap() {
    openModal(props => <WrapModal modalProps={props} />);
}
