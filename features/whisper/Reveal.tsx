/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Under a message with something hidden in it:
//  • a whisper you can open: blurred until you tap it, with picture and link
//    previews, a Reply button, and the lock it was opened with;
//  • one with a password you don't have: a box to type it;
//  • a pair request for you: Accept (which puts the reply in your message
//    box), and the reply to yours: paired, with the safety code to compare.
// When a whisper has two secrets, you only ever see the one(s) meant for
// you — nothing says another is there.

import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import { ChannelStore, FluxDispatcher, Parser, showToast, useEffect, UserStore, useState } from "@webpack/common";

import { Opened, pairMessage, Read, read } from "./codec";
import { remember } from "./historyStore";
import { addPair, loadKeys, myIdentity, offeredTo, pairWith, savePassword, useKeys } from "./keys";
import { choiceFrom, keyring, lockIcon, lockLabel } from "./locks";
import { openWhisper } from "./Panel";

const URL_RE = /https?:\/\/[^\s<>()]+/g;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif)(\?|$)/i;
const YOUTUBE_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/;

const nameOf = (u: any) => u?.globalName ?? u?.global_name ?? u?.username ?? "Someone";
const me = () => UserStore.getCurrentUser()?.id;

/** Pictures and videos linked in a whisper, shown once it's open. */
function Previews({ text }: { text: string; }) {
    const links = [...new Set(text.match(URL_RE) ?? [])].slice(0, 4);
    const [broken, setBroken] = useState<Set<string>>(new Set());
    if (!links.length) return null;
    return (
        <div className="vc-whisper-previews">
            {links.map(url => {
                const yt = url.match(YOUTUBE_RE)?.[1];
                const img = IMAGE_RE.test(url) || /(cdn|media)\.discordapp\.(com|net)\/attachments\//.test(url) ? url : yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null;
                let host = url;
                try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { }
                return img && !broken.has(url) ? (
                    <a key={url} className={classes("vc-whisper-pic", yt && "vc-whisper-yt")} href={url} target="_blank" rel="noreferrer" title={url}>
                        <img src={img} alt="" onError={() => setBroken(b => new Set(b).add(url))} />
                    </a>
                ) : <a key={url} className="vc-whisper-link" href={url} target="_blank" rel="noreferrer" title={url}>🔗 {host}</a>;
            })}
        </div>
    );
}

function OpenedSecret({ o, message }: { o: Opened; message: any; }) {
    const [shown, setShown] = useState(false);
    const expired = o.expiresAt != null && o.expiresAt < Date.now();
    const label = lockLabel(o.lock);

    const show = () => {
        setShown(s => !s);
        if (!shown) void remember({ messageId: message.id, channelId: message.channel_id, guildId: (ChannelStore.getChannel(message.channel_id) as any)?.guild_id ?? null, author: nameOf(message.author), text: o.text, lock: label, at: Date.now(), expiresAt: o.expiresAt });
    };
    const reply = () => {
        const channel = ChannelStore.getChannel(message.channel_id);
        if (channel) FluxDispatcher.dispatch({ type: "CREATE_PENDING_REPLY", channel, message, shouldMention: false, showMentionToggle: true } as any);
        openWhisper({ start: choiceFrom(o.lock) });
    };

    if (expired) return <div className="vc-whisper-box"><span className="vc-whisper-tag">{lockIcon(o.lock)} Whisper</span><span className="vc-whisper-locked">⌛ This whisper has expired.</span></div>;

    return (
        <div className="vc-whisper-box vc-whisper-box-open">
            <div className="vc-whisper-top">
                <span className="vc-whisper-tag" title={label}>{lockIcon(o.lock)} Whisper · {label}</span>
                {o.expiresAt && <span className="vc-whisper-locked">⌛ until {new Date(o.expiresAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>}
                <span className="vc-whisper-grow" />
                {shown && <button type="button" className="vc-whisper-mini" title="Reply with a whisper, locked the same way" onClick={reply}>↩ Reply</button>}
            </div>
            <button type="button" className={classes("vc-whisper-text", !shown && "vc-whisper-hidden")} onClick={show} title={shown ? "Hide it again" : "Tap to read"}>
                {Parser.parse(o.text, true, { channelId: message.channel_id, messageId: message.id, allowLinks: true })}
            </button>
            {shown ? <Previews text={o.text} /> : <span className="vc-whisper-hint">Tap to read</span>}
        </div>
    );
}

function PasswordBox({ message, onOpen }: { message: any; onOpen(r: Read): void; }) {
    const [typed, setTyped] = useState("");
    const [wrong, setWrong] = useState(false);
    const [save, setSave] = useState(true);
    const tryIt = async () => {
        const r = await read(message.content, await keyring([typed]));
        if (r.type === "whisper" && r.opened.length) { if (save) void savePassword("", typed); onOpen(r); } else setWrong(true);
    };
    return (
        <div className="vc-whisper-box">
            <span className="vc-whisper-tag">🔑 Whisper</span>
            <span className="vc-whisper-locked">This one needs a password.</span>
            <input className="vc-whisper-input" value={typed} placeholder="Password" onChange={e => { setTyped(e.currentTarget.value); setWrong(false); }} onKeyDown={e => { if (e.key === "Enter" && typed) void tryIt(); }} />
            <button type="button" className="vc-whisper-btn" disabled={!typed} onClick={() => void tryIt()}>Open</button>
            <label className="vc-whisper-save"><input type="checkbox" checked={save} onChange={e => setSave(e.currentTarget.checked)} /> Save it</label>
            {wrong && <span className="vc-whisper-wrong">Not that one.</span>}
        </div>
    );
}

function PairRequest({ message, pub }: { message: any; pub: Uint8Array; }) {
    useKeys();
    const { author } = message;
    const existing = pairWith(author?.id);
    const [busy, setBusy] = useState(false);
    const accept = async () => {
        setBusy(true);
        const p = await addPair(author.id, nameOf(author), pub);
        const mine = await myIdentity();
        insertTextIntoChatInputBox(pairMessage("🤝 Paired! (Sonata)", 4, author.id, mine.pub));
        showToast(`Paired with ${nameOf(author)} — send the reply in your message box so they're paired too`, "success");
        void p;
        setBusy(false);
    };
    return (
        <div className="vc-whisper-box">
            <span className="vc-whisper-tag">🤝 Pair request</span>
            {existing
                ? <span className="vc-whisper-locked">✓ You're paired with {existing.name} · safety code {existing.code}</span>
                : <>
                    <span className="vc-whisper-locked">{nameOf(author)} wants to whisper privately with you — no passwords, only you two can read them.</span>
                    <button type="button" className="vc-whisper-btn" disabled={busy} onClick={() => void accept()}>Accept</button>
                </>}
        </div>
    );
}

function PairReply({ message, pub }: { message: any; pub: Uint8Array; }) {
    useKeys();
    const { author } = message;
    const [pair, setPair] = useState(() => pairWith(author?.id));
    // Only from someone you sent a request to.
    useEffect(() => {
        if (pair || !author?.id) return;
        void loadKeys().then(async () => { if (offeredTo(author.id)) setPair(await addPair(author.id, nameOf(author), pub)); });
    }, [author?.id]);
    if (!pair) return null;
    return (
        <div className="vc-whisper-box">
            <span className="vc-whisper-tag">🤝 Paired</span>
            <span className="vc-whisper-locked">You and {pair.name} can now whisper privately. Safety code {pair.code} — it should match on their side.</span>
        </div>
    );
}

export function WhisperReveal({ message }: { message: any; }) {
    const [result, setResult] = useState<Read | null>(null);
    const keys = useKeys();

    useEffect(() => {
        let alive = true;
        void keyring().then(k => read(message.content, k)).then(r => { if (alive) setResult(r); });
        return () => { alive = false; };
    }, [message.content, keys.book.length, keys.pairs.length]);

    if (!result || result.type === "none") return null;
    const fromMe = message.author?.id === me();

    if (result.type === "pair-request") {
        if (result.to === me()) return <PairRequest message={message} pub={result.pub} />;
        if (fromMe) return <div className="vc-whisper-box"><span className="vc-whisper-tag">🤝 Pair request</span><span className="vc-whisper-locked">Sent — once they accept, you're paired.</span></div>;
        return null;
    }
    if (result.type === "pair-reply") return result.to === me() ? <PairReply message={message} pub={result.pub} /> : null;

    if (result.opened.length) {
        // With two secrets, the "anyone with Sonata" one is the decoy: if you can open a more private one, that's the one for you.
        const private_ = result.opened.filter(o => o.lock.kind !== "sonata");
        const mine = private_.length ? private_ : result.opened;
        return <>{mine.map((o, i) => <OpenedSecret key={i} o={o} message={message} />)}</>;
    }
    if (result.needsPassword) return <PasswordBox message={message} onOpen={setResult} />;
    if (result.forSomeoneElse) return <div className="vc-whisper-box vc-whisper-box-quiet"><span className="vc-whisper-tag">🤝 Whisper</span><span className="vc-whisper-locked">A private whisper between other people.</span></div>;
    return null;
}
