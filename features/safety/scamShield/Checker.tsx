/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Check a link yourself: paste a link (or a whole message) and see what each
// link really is — with the same checks Scam Shield runs in chat, every brand
// included, and where short links and redirects actually lead.

import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, useEffect, useState } from "@webpack/common";

import { Brand, checkLinkFor, DISCORD, EPIC, linksIn, PAYPAL, ROBLOX, siteOf, STEAM, Verdict } from "../../_shared/scam";
import { logEvent, verdictEntry } from "../../_shared/scamLog";
import { Window } from "../../_shared/Window";
import { whereItGoes } from "../../linkCleaner/preview";
import { fileWarning, GENERAL_TALK, isIpLogger } from "./checks";

const ALL: Brand[] = [DISCORD, STEAM, EPIC, PAYPAL, ROBLOX];

/** Everything about one link, every brand counted (the in-chat checks can skip some). */
function judge(raw: string, shown: string, context: string): Verdict {
    let host = "", file = "";
    try { const u = new URL(raw.trim()); host = u.hostname.toLowerCase(); file = decodeURIComponent(u.pathname.split("/").pop() ?? ""); } catch { }
    if (host && isIpLogger(host)) return { level: "scam", url: raw, host, reasons: [`${siteOf(host)} is an IP logger — opening it gives whoever made it your IP address and rough location, and often your device details.`] };
    const v = checkLinkFor(ALL, raw, shown, context, GENERAL_TALK);
    if (v.level === "scam") return v;
    const f = fileWarning(file, raw, context);
    return f ? { ...f, kind: "link" } : v;
}

interface Checked { raw: string; shown: string; v: Verdict; final?: string; finalV?: Verdict; hops?: number; following?: boolean; followError?: string; insecure: boolean; }

const LOOK: Record<string, { icon: string; title: string; cls: string; }> = {
    scam: { icon: "🚨", title: "Scam", cls: "bad" },
    suspicious: { icon: "⚠️", title: "Be careful", cls: "warn" },
    safe: { icon: "✅", title: "Official website", cls: "good" },
    other: { icon: "⚪", title: "Nothing wrong found", cls: "plain" },
};
const rank = (l: string) => ({ scam: 3, suspicious: 2, other: 1, safe: 0 } as Record<string, number>)[l] ?? 1;

function Result({ c }: { c: Checked; }) {
    // A redirect that ends somewhere worse decides the verdict.
    const worst = c.finalV && rank(c.finalV.level) > rank(c.v.level) ? c.finalV : c.v;
    const look = LOOK[worst.level] ?? LOOK.other;
    const reasons = [...new Set([...(c.finalV && c.finalV !== c.v ? c.finalV.reasons : []), ...c.v.reasons])];
    return (
        <div className={classes("vc-shield-result", `vc-shield-${look.cls}`)}>
            <div className="vc-shield-result-head">
                <span className="vc-shield-result-icon">{look.icon}</span>
                <div>
                    <b>{look.title}</b>
                    <span className="vc-shield-url">{c.raw}</span>
                </div>
            </div>
            <div className="vc-shield-facts">
                {c.v.host && <span><i>Real website</i><b>{siteOf(c.v.host)}</b>{c.v.brand && c.v.level === "safe" ? ` · ${c.v.brand}` : ""}</span>}
                {c.shown && <span><i>Shows as</i><b>{c.shown}</b></span>}
                {c.following && <span><i>Leads to</i><b>checking…</b></span>}
                {c.final && <span><i>Leads to</i><b>{c.final}</b>{c.hops ? ` · after ${c.hops} redirect${c.hops === 1 ? "" : "s"}` : ""}</span>}
                {c.followError && <span><i>Leads to</i><b>couldn't check ({c.followError})</b></span>}
                {c.insecure && <span><i>Connection</i><b>not secure (http)</b></span>}
            </div>
            {reasons.length > 0 && <ul className="vc-shield-why">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
            {worst.level === "other" && <span className="vc-shield-note">Scam Shield doesn't know this site. That doesn't make it safe — don't log in or download anything unless you trust where it came from.</span>}
            {worst.level === "safe" && <span className="vc-shield-note">This is {worst.brand ?? "the brand"}'s real website. Still, never give your password or codes to anyone who messages you.</span>}
        </div>
    );
}

function CheckerModal({ modalProps, initial }: { modalProps: RenderModalProps; initial: string; }) {
    const [text, setText] = useState(initial);
    const [follow, setFollow] = useState(true);
    const [results, setResults] = useState<Checked[]>([]);

    useEffect(() => {
        const t = text.trim();
        if (!t) { setResults([]); return; }
        // A bare address ("roblox.com/…") counts as a link too.
        const found = linksIn(t);
        const links = found.length ? found : /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(t) ? [{ url: `https://${t}`, shown: "" }] : [];
        const list: Checked[] = links.slice(0, 8).map(l => ({ raw: l.url, shown: l.shown, v: judge(l.url, l.shown, t), insecure: /^http:/i.test(l.url), following: follow && /^https?:/i.test(l.url) }));
        setResults(list);
        if (!follow) return;
        let alive = true;
        list.forEach((c, i) => {
            if (!c.following) return;
            void whereItGoes(c.raw).then(r => {
                if (!alive) return;
                setResults(prev => prev.map((x, j) => {
                    if (j !== i) return x;
                    if (r.error) return { ...x, following: false, followError: r.error };
                    const moved = r.final && r.final.replace(/\/$/, "") !== x.raw.replace(/\/$/, "");
                    return { ...x, following: false, final: moved ? r.final : undefined, hops: r.hops, finalV: moved ? judge(r.final!, "", t) : undefined };
                }));
            });
        });
        return () => { alive = false; };
    }, [text, follow]);

    // Once you've stopped typing and every link is worked out, it goes in Scam Shield's history.
    useEffect(() => {
        if (!results.length || results.some(c => c.following)) return;
        const t = setTimeout(() => {
            for (const c of results) {
                const worst = c.finalV && rank(c.finalV.level) > rank(c.v.level) ? c.finalV : c.v;
                void logEvent(verdictEntry({ ...worst, url: c.raw, host: c.v.host }, "checked", { final: c.final, reason: (c.finalV && c.finalV !== c.v ? c.finalV.reasons[0] : null) ?? c.v.reasons[0] ?? "", source: "shield" }));
            }
        }, 1500);
        return () => clearTimeout(t);
    }, [results]);

    return (
        <Window {...modalProps} size="md" title="Check a link" subtitle="Paste a link — or a whole message — to see what it really is">
            <div className="vc-tool-wrap vc-shield-checker">
                <textarea className="vc-tool-input vc-shield-input" autoFocus value={text} rows={3} spellCheck={false}
                    placeholder="https://… or a message with links in it" onChange={e => setText(e.currentTarget.value)} />
                <label className="vc-tool-check">
                    <input type="checkbox" checked={follow} onChange={e => setFollow(e.currentTarget.checked)} />
                    Also find out where it leads (asks the site, without opening it — catches short links and redirects)
                </label>
                {text.trim() && !results.length && <span className="vc-tool-hint">No link in that — paste something starting with https://</span>}
                {results.map((c, i) => <Result key={`${i}-${c.raw}`} c={c} />)}
                {!text.trim() && (
                    <span className="vc-tool-hint">
                        It checks for look-alike websites (rob1ox.com, discord-gift.com, steamcommunlty.com…), disguised links, IP loggers, fake login QR links and programs to download — for Discord, Roblox, Steam, Epic Games and PayPal.
                    </span>
                )}
            </div>
        </Window>
    );
}

export const openChecker = (text = "") => openModal(props => <ErrorBoundary><CheckerModal modalProps={props} initial={text} /></ErrorBoundary>);
