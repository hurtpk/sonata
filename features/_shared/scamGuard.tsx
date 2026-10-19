/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The scam warnings both Roblox Tools and Scam Shield show: a bar under the
// message, a popup explaining why, and a check on every link you click in
// chat. Each guard brings its own checker; this is just how it looks.

import "./scam.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useEffect, useRef, useState } from "@webpack/common";

import { isShortener, whereItGoes } from "../linkCleaner/preview";
import { linksIn, siteOf, Verdict } from "./scam";
import { logEvent, Outcome, placeOf, verdictEntry } from "./scamLog";

export interface GuardConfig {
    check(raw: string, shown: string, context: string): Verdict;
    /** Is it worth asking where short links in this message go? */
    shortContext(text: string): boolean;
    /** Shown when a warning names no brand. */
    fallback: string;
    /** Whose guard this is, for the Scam Shield window's history. */
    source: "shield" | "roblox";
}

/** A message on screen, for logging where a warning was. */
export interface MessageMeta { messageId?: string; channelId?: string; author?: { id: string; name: string; }; }

export function makeGuard(cfg: GuardConfig) {
    const guard = { on: true, shortLinks: true, trusted: [] as string[], trust: (_site: string) => { } };

    const isTrusted = (host: string) => !!host && guard.trusted.includes(siteOf(host));
    const flagged = (v: Verdict) => (v.level === "scam" || v.level === "suspicious") && (v.kind === "file" || !isTrusted(v.host));

    /** Where short links went, once checked (so a click is instant). */
    const resolved = new Map<string, Promise<Verdict | null>>();
    function resolveShort(url: string, context: string): Promise<Verdict | null> {
        let p = resolved.get(url);
        if (!p) {
            p = whereItGoes(url).then(r => {
                if (!r.final || r.final === url) return null;
                const v = cfg.check(r.final, "", context);
                return { ...v, reasons: [`This short link really goes to ${v.host || r.final}.`, ...v.reasons] };
            }, () => null);
            resolved.set(url, p);
        }
        return p;
    }

    /** What's wrong with each link in a message (only the flagged ones). */
    function messageVerdicts(text: string): Verdict[] {
        if (!guard.on || !text) return [];
        return linksIn(text).map(l => cfg.check(l.url, l.shown, text)).filter(flagged);
    }

    function WarningModal({ modalProps, v, also, onDecide }: { modalProps: RenderModalProps; v: Verdict; also: string[]; onDecide?(o: Outcome): void; }) {
        const scam = v.level === "scam";
        const kind = v.kind ?? "link";
        // A popup from a click records what you chose (closing it counts as staying safe).
        const decided = useRef(false);
        const decide = (o: Outcome) => { if (!decided.current) { decided.current = true; onDecide?.(o); } };
        useEffect(() => () => decide("safe"), []);
        const open = () => { decide("opened"); modalProps.onClose(); VencordNative.native.openExternal(v.url); };
        const brand = v.brand ? `${v.brand} ` : "";
        const [title, subtitle] = {
            file: ["⚠️ This file is a program", "Programs sent in chat are a common way to steal accounts."],
            text: ["⚠️ This message sounds like a scam", "Messages like this are written to trick you into giving up your account."],
            qr: [scam ? "🚨 Don't scan this QR code" : "⚠️ Be careful with this QR code", "QR codes hide where they go until it's too late."],
            account: ["⚠️ This account is brand new", "New accounts sending links are often scammers who were banned before."],
            link: scam
                ? [`🚨 This looks like a ${brand}scam`, `Links like this are made to steal ${v.brand ?? "your"} accounts${v.brand ? "" : " and money"}.`]
                : ["⚠️ Be careful with this link", `It might be fine — but it isn't ${v.brand ? `${v.brand}'s` : "a website you know"} own website.`],
        }[kind];
        const where = kind === "file" ? ["The file", decodeURIComponent(v.url.split("?")[0].split("/").pop() ?? "")]
            : kind === "qr" ? ["The QR code leads to", v.host || v.url.slice(0, 60)]
                : kind === "link" ? ["It really goes to", v.host || v.url.slice(0, 60)] : null;
        const reasons = [...new Set([...v.reasons, ...also])];
        return (
            <Modal {...modalProps} size="sm" title={title} subtitle={subtitle}>
                <div className={classes("vc-tool-wrap", "vc-scam-modal", scam && "vc-scam-modal-bad")}>
                    {where && (
                        <div className="vc-scam-where">
                            <span>{where[0]}</span>
                            <b>{where[1]}</b>
                        </div>
                    )}
                    <ul className="vc-scam-why">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    <div className="vc-scam-tip">
                        {kind === "file"
                            ? "Only open programs from people you know in real life — and even then, ask them first. A friend's account can be stolen and used to send these."
                            : kind === "qr"
                                ? "Never scan a QR code someone sent you with the Discord app. Discord only shows a login QR code on its own login screen — and you'd only ever scan one you opened yourself, on your own computer."
                                : <>{v.home && <>{v.brand}'s real website is always <b>{v.home}</b> — check what comes right before the first “/”. </>}Never log in from a link someone sent you, never scan a QR code to “claim” something, and never paste anything into your browser's console.</>}
                    </div>
                    <div className="vc-scam-actions">
                        <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => { decide("safe"); modalProps.onClose(); }}>Keep me safe</button>
                        <span className="vc-tool-spacer" />
                        {kind === "link" && v.host && <button type="button" className="vc-tool-link" title={`Stop warning about ${siteOf(v.host)}`} onClick={() => { decide("trusted"); guard.trust(siteOf(v.host)); VencordNative.native.openExternal(v.url); modalProps.onClose(); }}>Trust {siteOf(v.host)}</button>}
                        {(kind === "link" || kind === "file") && <button type="button" className="vc-tool-btn vc-tool-danger" onClick={open}>{kind === "file" ? "Download anyway" : "Open anyway"}</button>}
                    </div>
                </div>
            </Modal>
        );
    }

    const openWarning = (v: Verdict, also: string[] = [], onDecide?: (o: Outcome) => void) => openModal(props => <ErrorBoundary><WarningModal modalProps={props} v={v} also={also} onDecide={onDecide} /></ErrorBoundary>);

    /** A link click that was stopped: the popup, and what you chose goes in the history. */
    const stopped = (v: Verdict, where: MessageMeta) => {
        const place = placeOf(where.channelId);
        openWarning(v, [], outcome => void logEvent(verdictEntry(v, "blocked", { outcome, source: cfg.source, author: where.author, where: { ...where, guildId: place.guildId, label: place.label } })));
    };

    /** The bar under a message. `extra` are warnings that aren't about a link in the text (files, scam talk). */
    function ScamBanner({ text, extra = [], meta }: { text: string; extra?: Verdict[]; meta?: MessageMeta; }) {
        const [found, setFound] = useState<Verdict[]>(() => messageVerdicts(text));
        useEffect(() => {
            const now = messageVerdicts(text);
            setFound(now);
            if (!guard.on || !guard.shortLinks || !cfg.shortContext(text)) return;
            let alive = true;
            const short = linksIn(text).filter(l => isShortener(l.url));
            if (!short.length) return;
            void Promise.all(short.map(l => resolveShort(l.url, text))).then(list => {
                const bad = list.filter((v): v is Verdict => !!v && flagged(v));
                if (alive && bad.length) setFound([...now, ...bad]);
            });
            return () => { alive = false; };
        }, [text]);
        const all = guard.on ? [...found, ...extra.filter(flagged)] : [];
        // Each warning under a message goes in the history once.
        const logKey = all.map(v => v.url + v.kind).join("|");
        useEffect(() => {
            if (!meta?.messageId || !all.length) return;
            const place = placeOf(meta.channelId);
            for (const v of all) void logEvent(verdictEntry(v, "warned", { source: cfg.source, author: meta.author, where: { ...meta, guildId: place.guildId, label: place.label } }));
        }, [logKey, meta?.messageId]);
        if (!all.length) return null;
        const worst = all.find(v => v.level === "scam") ?? all[0];
        const scam = worst.level === "scam";
        const label = { file: "Program file", text: "Likely scam", qr: scam ? "Login QR code" : "Risky QR code", account: "Brand-new account", link: scam ? "Scam link" : "Careful" }[worst.kind ?? "link"];
        // The popup explains the worst one, and lists the rest too.
        const also = all.filter(v => v !== worst).flatMap(v => v.reasons.slice(0, 1));
        return (
            <div className={classes("vc-scam", scam ? "vc-scam-bad" : "vc-scam-warn")} role="alert">
                <span className="vc-scam-icon">{scam ? "🚨" : "⚠️"}</span>
                <div className="vc-scam-text">
                    <b>{label}{all.length > 1 ? ` (${all.length} warnings)` : ""}</b>
                    <span>{worst.reasons[0] ?? cfg.fallback}</span>
                </div>
                <button type="button" className="vc-tool-btn" onClick={() => openWarning(worst, also)}>Why?</button>
            </div>
        );
    }

    function onClick(e: MouseEvent) {
        if (!guard.on || (e.type === "auxclick" && e.button !== 1)) return;
        const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!a) return;
        // Only links in chat (messages and embeds), not Discord's own buttons and menus.
        const msg = a.closest('[id^="chat-messages-"], [class*="messageListItem"], [class*="embedWrapper"], [class*="messageContent"]');
        if (!msg) return;
        const href = a.getAttribute("href") ?? "";
        const context = msg.textContent ?? "";
        const v = cfg.check(href, a.textContent ?? "", context);
        // "chat-messages-<channel>-<message>" says where it was.
        const ids = /^chat-messages-(\d+)-(\d+)$/.exec(a.closest('[id^="chat-messages-"]')?.id ?? "");
        const where: MessageMeta = ids ? { channelId: ids[1], messageId: ids[2] } : {};
        if (flagged(v)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            stopped(v, where);
            return;
        }
        // A short link that's been checked and goes somewhere bad: warn first.
        if (guard.shortLinks && isShortener(href) && cfg.shortContext(context)) {
            const known = resolved.get(href);
            if (!known) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            void known.then(r => { if (r && flagged(r)) stopped(r, where); else void VencordNative.native.openExternal(href); });
        }
    }

    return {
        guard, flagged, messageVerdicts, openWarning, ScamBanner,
        start() {
            document.addEventListener("click", onClick, true);
            document.addEventListener("auxclick", onClick, true);
        },
        stop() {
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("auxclick", onClick, true);
        },
    };
}

/** Who sent a message and where, for the history. */
export function metaOf(message: any): MessageMeta {
    const a = message?.author;
    return { messageId: message?.id, channelId: message?.channel_id, author: a?.id ? { id: a.id, name: a.globalName ?? a.global_name ?? a.username ?? "Someone" } : undefined };
}
