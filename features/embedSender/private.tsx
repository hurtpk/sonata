/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Private reply buttons: a button on your embed that answers whoever presses
// it with a message only they can see ("Only you can see this").
//
// Discord only lets a bot do that, so this talks to a tiny bot you own — a
// free Cloudflare Worker running worker/sonata-private-replies.js. Your
// replies are stored there; Sonata only keeps the Worker's address and the
// secret you chose, on this computer. The bot's own token never comes here.

import { classes } from "@utils/misc";
import { ChannelStore, SelectedChannelStore, useEffect, useState } from "@webpack/common";
import workerCode from "file://./worker/sonata-private-replies.js";

import { callNative } from "../_shared/native";

export { workerCode };

/** Button colours Discord allows for clickable buttons. */
export const PRIVATE_STYLES: { id: 1 | 2 | 3 | 4; label: string; color: string; }[] = [
    { id: 1, label: "Blue", color: "#5865f2" },
    { id: 2, label: "Grey", color: "#4e5058" },
    { id: 3, label: "Green", color: "#248046" },
    { id: 4, label: "Red", color: "#da373c" },
];

export interface PrivateConfig { url: string; secret: string; }

/** Set by the editor: where your Worker is, and its secret (from Sonata's settings). */
export const privateConfig = {
    read: (): PrivateConfig => ({ url: "", secret: "" }),
    write: (_c: PrivateConfig) => { },
};

const isSetUp = (c = privateConfig.read()) => !!c.url && !!c.secret;
export const privateRepliesReady = () => isSetUp();

async function call(path: string, method: "GET" | "POST" | "PUT" | "DELETE", body?: unknown, cfg = privateConfig.read()): Promise<{ ok: boolean; body: any; status: number; }> {
    const r: any = await callNative("privateRepliesApi", cfg.url, path, method, body ?? null, cfg.secret);
    if (r && typeof r === "object" && "status" in r) return r;
    return { ok: false, status: 0, body: { error: r?.error ?? "Couldn't reach your Worker" } };
}
const errorOf = (r: { body: any; status: number; }) => r.body?.error ?? r.body?.message ?? (r.status === 0 ? "Couldn't reach your Worker — check its address" : `Your Worker answered ${r.status}`);

export interface PingResult { ok: boolean; missing?: string[]; app?: { id: string; name: string; interactionsUrl: string | null; } | null; error?: string; }

export async function pingWorker(cfg = privateConfig.read()): Promise<PingResult> {
    if (!isSetUp(cfg)) return { ok: false, error: "Add your Worker's address and secret first" };
    const r = await call("/api/ping", "GET", undefined, cfg);
    if (!r.ok) return { ok: false, error: r.status === 401 ? "Your Worker didn't accept the secret — it must match SONATA_SECRET exactly" : errorOf(r) };
    return r.body;
}

/** Make a webhook owned by your bot in a channel (the only kind that can send clickable buttons). */
export async function makeBotWebhook(channelId: string, name: string): Promise<{ url?: string; error?: string; }> {
    const r = await call("/api/webhooks", "POST", { channel_id: channelId, name });
    if (!r.ok) return { error: r.status === 403 ? "Your bot can't make webhooks there — give it the Manage Webhooks permission in that channel" : errorOf(r) };
    return { url: r.body.url };
}

/** The button fields this cares about (the editor's button has more). */
export interface PrivateButtonLike { kind?: "link" | "private"; label: string; reply?: string; replyId?: string; }

/** Saves each private button's reply on your Worker (new ones get an ID, changed ones are updated). */
export async function syncReplies<T extends PrivateButtonLike>(buttons: T[]): Promise<{ buttons: T[]; } | { error: string; }> {
    const priv = buttons.filter(b => b.kind === "private" && b.label.trim());
    if (!priv.length) return { buttons };
    if (!isSetUp()) return { error: "Private reply buttons need your bot set up first — see “Private reply buttons” in the editor." };
    const out: T[] = [];
    for (const b of buttons) {
        if (b.kind !== "private" || !b.label.trim()) { out.push(b); continue; }
        const text = (b.reply ?? "").trim();
        if (!text && b.replyId) { out.push(b); continue; } // loaded back and untouched: keep what's saved
        if (!text) return { error: `The private button “${b.label}” has no message to show.` };
        if (b.replyId) {
            const r = await call(`/api/replies/${b.replyId}`, "PUT", { text });
            if (!r.ok) return { error: `Couldn't save “${b.label}”'s message: ${errorOf(r)}` };
            out.push(b);
        } else {
            const r = await call("/api/replies", "POST", { text });
            if (!r.ok || !r.body?.id) return { error: `Couldn't save “${b.label}”'s message: ${errorOf(r)}` };
            out.push({ ...b, replyId: String(r.body.id) });
        }
    }
    return { buttons: out };
}

/** Fills in the reply text of private buttons read back from a sent message. */
export async function fillReplyTexts<T extends PrivateButtonLike>(buttons: T[]): Promise<T[]> {
    if (!isSetUp() || !buttons.some(b => b.kind === "private" && b.replyId && !b.reply)) return buttons;
    return Promise.all(buttons.map(async b => {
        if (b.kind !== "private" || !b.replyId || b.reply) return b;
        const r = await call(`/api/replies/${b.replyId}`, "GET");
        return r.ok && typeof r.body?.text === "string" ? { ...b, reply: r.body.text } : b;
    }));
}

/* ── The setup panel, with the step-by-step guide ── */

const PORTAL = "https://discord.com/developers/applications";
const CLOUDFLARE = "https://dash.cloudflare.com/sign-up/workers-and-pages";

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean; }) {
    return (
        <li className={classes("vc-es-step", done && "vc-es-step-done")}>
            <span className="vc-es-step-n">{done ? "✓" : n}</span>
            <div className="vc-es-step-body"><b>{title}</b><div>{children}</div></div>
        </li>
    );
}

const copy = async (text: string, toast: (k: "success" | "error", m: string) => void, what: string) => {
    try { await navigator.clipboard.writeText(text); toast("success", `${what} copied.`); } catch { toast("error", "Couldn't copy — select it and press Ctrl+C."); }
};

function randomSecret() {
    const a = new Uint8Array(24);
    crypto.getRandomValues(a);
    return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function PrivateRepliesSetup({ toast, onWebhook }: { toast(kind: "success" | "error", msg: string): void; onWebhook(url: string, name: string): void; }) {
    const saved = privateConfig.read();
    const [url, setUrl] = useState(saved.url);
    const [secret, setSecret] = useState(saved.secret);
    const [show, setShow] = useState(false);
    const [status, setStatus] = useState<PingResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [guide, setGuide] = useState(!isSetUp(saved));

    const test = async (cfg: PrivateConfig = { url: url.trim(), secret: secret.trim() }) => {
        setBusy(true);
        const r = await pingWorker(cfg);
        setBusy(false); setStatus(r);
        return r;
    };
    useEffect(() => { if (isSetUp(saved)) void test(saved); }, []);

    const save = async () => {
        const cfg = { url: url.trim().replace(/\/+$/, ""), secret: secret.trim() };
        if (!/^https:\/\/[^/]+/i.test(cfg.url)) { toast("error", "Your Worker's address starts with https:// — copy it from Cloudflare."); return; }
        if (cfg.secret.length < 16) { toast("error", "Use a longer secret (at least 16 characters) — press “Make one”."); return; }
        privateConfig.write(cfg);
        const r = await test(cfg);
        toast(r.ok ? "success" : "error", r.ok ? `Connected to ${r.app?.name ?? "your bot"}.` : r.error ?? `Still to do: ${r.missing?.join(", ")}`);
    };

    const channelId = SelectedChannelStore.getChannelId();
    const channel: any = channelId ? ChannelStore.getChannel(channelId) : null;
    const makeHook = async () => {
        if (!channel?.guild_id) { toast("error", "Open the server channel you want to post in first, then come back."); return; }
        setBusy(true);
        const r = await makeBotWebhook(channel.id, "Sonata");
        setBusy(false);
        if (r.error || !r.url) { toast("error", r.error ?? "Couldn't make the webhook"); return; }
        onWebhook(r.url, `#${channel.name} (bot)`);
        toast("success", `Made a bot webhook in #${channel.name} — private buttons will work there.`);
    };

    const ready = !!status?.ok;
    const endpointSet = !!status?.app?.interactionsUrl;
    const invite = status?.app ? `https://discord.com/oauth2/authorize?client_id=${status.app.id}&scope=bot&permissions=536870912` : null;

    return (
        <div className="vc-es-private">
            <div className={classes("vc-es-private-status", ready ? "vc-es-ok" : "vc-es-warn")}>
                {busy ? "Checking…" : ready
                    ? <>✓ Connected to <b>{status!.app?.name ?? "your bot"}</b>{endpointSet ? "" : " — but Discord doesn't know your Worker's address yet (step 5)"}</>
                    : status?.error ? <>⚠ {status.error}</>
                        : status?.missing?.length ? <>⚠ Your Worker still needs: {status.missing.join(", ")}</>
                            : <>Not set up yet — it takes about 15 minutes, once.</>}
                <span className="vc-tool-spacer" />
                <button type="button" className="vc-tool-btn" onClick={() => setGuide(g => !g)}>{guide ? "Hide the guide" : "Show the guide"}</button>
            </div>

            {guide && (
                <ol className="vc-es-steps">
                    <Step n={1} title="Make a bot (free)">
                        Open the <a href={PORTAL} target="_blank" rel="noreferrer">Discord Developer Portal</a> → <b>New Application</b>, name it (e.g. “My Server Bot”).
                        On <b>General Information</b>, copy the <b>Public Key</b>. On <b>Bot</b>, press <b>Reset Token</b> and copy the token.
                        Keep the token secret — it never goes into Sonata.
                    </Step>
                    <Step n={2} title="Make the Worker (free)">
                        Sign in to <a href={CLOUDFLARE} target="_blank" rel="noreferrer">Cloudflare</a> → <b>Workers &amp; Pages</b> → <b>Create</b> → <b>Hello World</b> → <b>Deploy</b>, then <b>Edit code</b>.
                        Replace everything with Sonata's Worker code and press <b>Deploy</b>.
                        <div className="vc-es-step-actions"><button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => copy(workerCode, toast, "Worker code")}>Copy the Worker code</button></div>
                    </Step>
                    <Step n={3} title="Give it somewhere to keep replies">
                        In Cloudflare, <b>Storage &amp; Databases → KV → Create</b> a namespace (any name). Then in your Worker: <b>Settings → Bindings → Add → KV namespace</b>, variable name <code>REPLIES</code>, pick the namespace you made.
                    </Step>
                    <Step n={4} title="Add three secrets">
                        Worker → <b>Settings → Variables and Secrets → Add</b>, type <b>Secret</b>, three times:
                        <code>DISCORD_PUBLIC_KEY</code> (the Public Key), <code>DISCORD_BOT_TOKEN</code> (the token),
                        and <code>SONATA_SECRET</code> — any long password. Make one here and use the same one below:
                        <div className="vc-es-step-actions">
                            <button type="button" className="vc-tool-btn" onClick={() => { const s = randomSecret(); setSecret(s); void copy(s, toast, "A new secret"); }}>Make one &amp; copy it</button>
                        </div>
                    </Step>
                    <Step n={5} title="Tell Discord where the Worker is" done={endpointSet}>
                        Copy your Worker's address (like <code>https://name.you.workers.dev</code>). In the Developer Portal → <b>General Information</b>, paste it into <b>Interactions Endpoint URL</b> and <b>Save</b> — Discord checks it straight away.
                    </Step>
                    <Step n={6} title="Connect Sonata" done={ready}>
                        Paste the Worker's address and your secret below and press <b>Save &amp; check</b>.
                    </Step>
                    <Step n={7} title="Add the bot to your server">
                        {invite ? <><a href={invite} target="_blank" rel="noreferrer">Invite your bot</a> (it only asks for Manage Webhooks).</> : "Once connected, an invite link shows here."}
                        {" "}Then open the channel to post in and press <b>Make a bot webhook here</b> — clickable buttons only work through a webhook your bot made.
                    </Step>
                </ol>
            )}

            <div className="vc-es-private-fields">
                <input className="vc-tool-input" placeholder="https://your-worker.you.workers.dev" value={url} onChange={e => setUrl(e.target.value)} />
                <div style={{ display: "flex", gap: 8 }}>
                    <input className="vc-tool-input" style={{ flex: 1 }} type={show ? "text" : "password"} autoComplete="off" spellCheck={false} placeholder="Your SONATA_SECRET" value={secret} onChange={e => setSecret(e.target.value)} />
                    <button type="button" className="vc-tool-btn" onClick={() => setShow(s => !s)}>{show ? "🙈" : "👁"}</button>
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || !url.trim() || !secret.trim()} onClick={save}>Save &amp; check</button>
                </div>
                {ready && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="vc-tool-btn" disabled={busy} onClick={makeHook}>
                            🪝 Make a bot webhook here{channel?.name ? ` (#${channel.name})` : ""}
                        </button>
                        {invite && <a className="vc-tool-btn" href={invite} target="_blank" rel="noreferrer">Invite the bot</a>}
                    </div>
                )}
            </div>
            <div className="vc-es-private-note">
                The secret and address stay on this computer. Your bot's token only lives in Cloudflare. Replies can use <code>{"{user}"}</code> (mentions whoever pressed it) and <code>{"{name}"}</code> (their name).
                The full guide is also in <code>sonata/guides/private-reply-buttons.md</code>, to share.
            </div>
        </div>
    );
}
