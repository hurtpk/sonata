/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Parser, React, useEffect, useState } from "@webpack/common";

import { Entry, fmtBytes, LogRecord, Media } from "./data";

export const cl = classNameFactory("vc-mlx-");

/** What the window needs from Message Logger. Kept apart so the window itself has no database code. */
export interface Backend {
    load(): Promise<LogRecord[]>;
    remove(records: LogRecord[]): Promise<void>;
    clearAll(): Promise<void>;
    /** A saved picture's local copy. revoke() frees it when the picture leaves the screen. */
    localUrl(att: any): Promise<{ url: string; revoke(): void; } | null>;
    download(media: Media): Promise<void>;
    jump(e: Entry): void;
    profile(userId: string): void;
    quote(text: string): void;
    copy(text: string): void;
    save(name: string, type: string, data: string | Blob): void;
    confirm(title: string, body: string, ok: string, onOk: () => void): void;
    toast(text: string, ok?: boolean): void;
    /** Calls back whenever a message is deleted or edited while the window is open. */
    watch?(cb: () => void): () => void;
    storage?(): Promise<{ usage: number; quota: number; } | null>;
    importOld?(): Promise<void>;
    /** Your stars and notes. */
    meta(): Promise<Record<string, { star?: boolean; note?: string; }>>;
    setMeta(id: string, patch: { star?: boolean; note?: string; }): Promise<void>;
    /** IDs (people, channels, servers) Message Logger doesn't log. */
    ignored(): string[];
    setIgnored(id: string, ignored: boolean): void;
    /** People you're watching (told when they delete or edit). */
    watched?(): string[];
    setWatched?(id: string, on: boolean): void;
    cleanupDays(): number;
    setCleanupDays(days: number): void;
    /** Deletes logs older than this many days, except starred ones. Returns how many. */
    cleanupNow(days: number): Promise<number>;
    /** Names for an ID on the ignore list. */
    describe(id: string): { name: string; kind: string; icon?: string | null; };
    /** Discord's own message look, for the "Discord" view. */
    discordView?(e: Entry, groupStart: boolean): React.ReactNode;
}

// Made on first use: React isn't ready yet while Equicord is still loading.
let ctx: React.Context<Backend> | null = null;
export const backendCtx = () => ctx ??= React.createContext<Backend>(null as any);
export const useBackend = () => React.useContext(backendCtx());

export function Avatar({ src, size = 32, className }: { src: string; size?: number; className?: string; }) {
    const [bad, setBad] = useState(false);
    return <img className={classes(cl("avatar"), className)} src={bad ? "https://cdn.discordapp.com/embed/avatars/0.png" : src} width={size} height={size} style={{ width: size, height: size }} onError={() => setBad(true)} alt="" loading="lazy" />;
}

export function GuildIcon({ name, icon, size = 28 }: { name: string; icon: string | null; size?: number; }) {
    const [bad, setBad] = useState(false);
    if (icon && !bad) return <img className={cl("gicon")} src={icon} style={{ width: size, height: size }} onError={() => setBad(true)} alt="" loading="lazy" />;
    const letters = name.split(/\s+/).map(w => w[0]).filter(Boolean).join("").slice(0, 3) || "?";
    return <span className={cl("gicon", "gicon-text")} style={{ width: size, height: size, fontSize: size * (letters.length > 2 ? 0.32 : 0.4) }}>{letters}</span>;
}

export function classes(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(" "); }

/** Message text with mentions, emoji, links and formatting, like in chat. */
export function Content({ text, entry, className }: { text: string; entry: Entry; className?: string; }) {
    if (!text) return <div className={classes(cl("content"), cl("content-none"), className)}>No text</div>;
    let out: React.ReactNode = text;
    try { out = Parser.parse(text, true, { channelId: entry.channelId, messageId: entry.id, allowLinks: true, allowEmojiLinks: true, allowHeading: true, allowList: true }); } catch { }
    return <div className={classes(cl("content"), className)}>{out}</div>;
}

/** Where a picture can be shown from: the copy on this computer if there is one, otherwise Discord's link. */
export function useMediaUrl(media: Media | null): { url: string | null; local: boolean; } {
    const backend = useBackend();
    const [state, setState] = useState<{ url: string | null; local: boolean; }>({ url: media && !media.saved ? media.url : null, local: false });
    useEffect(() => {
        if (!media) return;
        if (!media.saved) { setState({ url: media.url, local: false }); return; }
        let alive = true, revoke: (() => void) | null = null;
        backend.localUrl(media.att).then(r => {
            if (!alive) { r?.revoke(); return; }
            revoke = r?.revoke ?? null;
            setState(r ? { url: r.url, local: true } : { url: media.url, local: false });
        }).catch(() => alive && setState({ url: media.url, local: false }));
        return () => { alive = false; revoke?.(); };
    }, [media?.key]);
    return state;
}

const FILE_ICON: Record<string, string> = { audio: "🎵", file: "📄" };
const fileIcon = (m: Media) => {
    if (m.kind === "audio") return FILE_ICON.audio;
    const ext = m.name.split(".").pop()?.toLowerCase() ?? "";
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "🗜️";
    if (["pdf"].includes(ext)) return "📕";
    if (["txt", "md", "log", "json", "js", "ts", "py", "css", "html", "lua", "cs", "cpp"].includes(ext)) return "📝";
    if (["exe", "msi", "apk", "dmg"].includes(ext)) return "⚙️";
    return FILE_ICON.file;
};

/** A picture or video preview. Shows a clear "gone" tile if Discord already removed it and there's no saved copy. */
export function Thumb({ media, className, onClick, big }: { media: Media; className?: string; onClick?(): void; big?: boolean; }) {
    const { url } = useMediaUrl(media);
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [url]);

    if (media.kind === "file" || media.kind === "audio") {
        return (
            <button type="button" className={classes(cl("file"), className)} onClick={onClick} title={media.name}>
                <span className={cl("file-icon")}>{fileIcon(media)}</span>
                <span className={cl("file-main")}><b>{media.name}</b><span>{[fmtBytes(media.size), media.saved ? "saved" : "not saved"].filter(Boolean).join(" · ")}</span></span>
            </button>
        );
    }

    return (
        <button type="button" className={classes(cl("thumb"), media.spoiler && cl("thumb-spoiler"), className)} onClick={onClick} title={media.name}>
            {failed || !url ? (
                <span className={cl("thumb-gone")}>{url ? <>🚫<small>{media.saved ? "Couldn't open" : "Removed by Discord"}</small></> : "⏳"}</span>
            ) : media.kind === "video" ? (
                <>
                    <video src={url} muted preload="metadata" playsInline onError={() => setFailed(true)} controls={big} autoPlay={big} loop={big} />
                    {!big && <span className={cl("thumb-play")}>▶</span>}
                </>
            ) : (
                <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
            )}
            {media.saved && !big && <span className={cl("thumb-saved")} title="Saved on this computer">💾</span>}
        </button>
    );
}

export function Badges({ e }: { e: Entry; }) {
    return (
        <>
            {e.ghost && <span className={classes("vc-tool-badge", cl("b-ghost"))}>👻 Ghost ping</span>}
            {e.deleted && !e.ghost && <span className={classes("vc-tool-badge", cl("b-del"))}>🗑️ Deleted</span>}
            {e.edited && <span className={classes("vc-tool-badge", cl("b-edit"))}>✏️ Edited{e.versions.length > 2 ? ` ×${e.versions.length - 1}` : ""}</span>}
            {e.author.bot && <span className="vc-tool-badge">BOT</span>}
        </>
    );
}
