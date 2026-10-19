/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The present: a wrapped box that wobbles until you tap it, then unwraps —
// the lid flies off, confetti bursts, and the gift inside is revealed.

import { classes } from "@utils/misc";
import { Parser, useEffect, useMemo, UserStore, useState } from "@webpack/common";

import { decodeGift, Gift, GIFT_RE, IMAGE_RE, loadOpened, markOpened, RIBBONS } from "./gift";

const CONFETTI = ["#f472b6", "#60a5fa", "#facc15", "#34d399", "#a78bfa", "#fb923c"];

/** "2d 4h", "3h 12m", "45s". */
function countdown(ms: number) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s % 60}s`;
    return `${s}s`;
}

/** The wrapped box on its own (also used for the preview when wrapping). */
export function Box({ gift, opening, onClick, small }: { gift: Gift; opening?: boolean; onClick?: () => void; small?: boolean; }) {
    const ribbon = RIBBONS.find(r => r.id === gift.r)?.color ?? "#f5c542";
    return (
        <button type="button" className={classes("vc-gw-box", `vc-gw-paper-${gift.p}`, opening && "vc-gw-opening", small && "vc-gw-small")} onClick={onClick} disabled={!onClick}
            style={{ "--gw-ribbon": ribbon } as React.CSSProperties} aria-label={onClick ? "Open the present" : "Present"}>
            <span className="vc-gw-lid"><span className="vc-gw-bow" /></span>
            <span className="vc-gw-body" />
            {gift.n && <span className="vc-gw-tag">{gift.n}</span>}
        </button>
    );
}

function Confetti() {
    const bits = useMemo(() => Array.from({ length: 26 }, (_, i) => {
        const angle = (i / 26) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 60 + Math.random() * 70;
        return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist - 40, r: Math.random() * 540 - 270, c: CONFETTI[i % CONFETTI.length], d: Math.random() * 0.12, w: 5 + Math.random() * 5 };
    }), []);
    return (
        <span className="vc-gw-confetti" aria-hidden>
            {bits.map((b, i) => (
                <i key={i} style={{ "--x": `${b.x.toFixed(0)}px`, "--y": `${b.y.toFixed(0)}px`, "--r": `${b.r.toFixed(0)}deg`, background: b.c, width: b.w, animationDelay: `${b.d.toFixed(2)}s` } as React.CSSProperties} />
            ))}
        </span>
    );
}

function Inside({ gift, channelId, messageId }: { gift: Gift; channelId: string; messageId: string; }) {
    const text = gift.c.trim();
    const isImage = IMAGE_RE.test(text);
    return (
        <div className="vc-gw-inside">
            {gift.n && <div className="vc-gw-note">{gift.n}</div>}
            {isImage
                ? <img className="vc-gw-image" src={text} alt="Your gift" />
                : <div className="vc-gw-content">{Parser.parse(text, true, { channelId, messageId, allowLinks: true })}</div>}
            {gift.f && <div className="vc-gw-from">— from {gift.f} 🎁</div>}
        </div>
    );
}

export function GiftAccessory({ message }: { message: any; }) {
    const code = message?.content?.match(GIFT_RE)?.[1];
    const gift = useMemo(() => code ? decodeGift(code) : null, [code]);
    const [state, setState] = useState<"wrapped" | "opening" | "open">("wrapped");
    const [now, setNow] = useState(Date.now());
    const [nudge, setNudge] = useState(false);
    const opensAt = gift?.u ? gift.u * 1000 : 0;
    const waiting = opensAt > now;
    // You wrapped it, so you can peek.
    const mine = message?.author?.id === UserStore.getCurrentUser()?.id;

    useEffect(() => {
        let alive = true;
        void loadOpened().then(set => { if (alive && set.has(message.id)) setState("open"); });
        return () => { alive = false; };
    }, [message.id]);

    // Count down while it's waiting: every second in the last minute, otherwise every half minute.
    useEffect(() => {
        if (!waiting) return;
        const t = setTimeout(() => setNow(Date.now()), opensAt - now < 60_000 ? 1000 : 30_000);
        return () => clearTimeout(t);
    }, [waiting, now, opensAt]);
    useEffect(() => { if (!nudge) return; const t = setTimeout(() => setNudge(false), 600); return () => clearTimeout(t); }, [nudge]);

    if (!code) return null;
    if (!gift) return <div className="vc-gw-card vc-gw-bad">🎁 This gift couldn't be opened — it may be from a newer Sonata.</div>;

    if (waiting && state !== "open" && !mine) {
        return (
            <div className="vc-gw-card">
                <div className={classes("vc-gw-stage", nudge && "vc-gw-nudge")}>
                    <Box gift={gift} onClick={() => setNudge(true)} />
                    <span className="vc-gw-lock">⏳ Opens in {countdown(opensAt - now)}</span>
                    <span className="vc-gw-hint">{new Date(opensAt).toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </div>
            </div>
        );
    }

    const open = () => {
        setState("opening");
        markOpened(message.id);
        setTimeout(() => setState("open"), 900);
    };

    return (
        <div className={classes("vc-gw-card", state === "open" && "vc-gw-card-open")}>
            {state !== "open" ? (
                <div className="vc-gw-stage">
                    <Box gift={gift} opening={state === "opening"} onClick={state === "wrapped" ? open : undefined} />
                    {state === "opening" && <Confetti />}
                    {state === "wrapped" && <span className="vc-gw-hint">{waiting && mine ? `Your gift opens in ${countdown(opensAt - now)} for them — tap to peek` : "Tap to unwrap"}</span>}
                </div>
            ) : (
                <>
                    <Inside gift={gift} channelId={message.channel_id} messageId={message.id} />
                    <button type="button" className="vc-gw-again" onClick={() => setState("wrapped")} title="Wrap it back up">↺ Wrap again</button>
                </>
            )}
        </div>
    );
}
