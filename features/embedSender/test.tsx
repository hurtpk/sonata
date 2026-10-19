/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Test send: try a message before the real post.
//  • Only me — it shows up in the chat you have open, like a bot's "only you
//    can see this" reply. Nothing is sent; it's gone when you reload.
//  • Test channel — a real post in a channel you pick. Normal accounts can't
//    post embeds, so Sonata makes (and keeps reusing) its own "Sonata test"
//    webhook there; you never have to set one up. Needs Manage Webhooks there.

import { sendBotMessage } from "@api/Commands";
import { classes } from "@utils/misc";
import { ChannelStore, GuildStore, PermissionsBits, PermissionStore, ReactDOM, RestAPI, SelectedChannelStore, SortedGuildStore, useEffect, useMemo, useRef, useState } from "@webpack/common";

export interface TestChannel { channelId: string; url: string; }

const TEST_NAME = "Sonata test";

export function loadTestChannel(raw: string | undefined): TestChannel | null {
    try { const v = JSON.parse(raw || "null"); return v?.channelId && v?.url ? v : null; } catch { return null; }
}

const apiError = (e: any) => e?.body?.message ?? e?.message ?? "Discord said no";

/** The "Sonata test" webhook in a channel — found, or made. */
export async function testWebhookFor(channelId: string): Promise<{ url?: string; error?: string; }> {
    try {
        const list: any = await RestAPI.get({ url: `/channels/${channelId}/webhooks` });
        const mine = (list?.body ?? []).find((w: any) => w?.name === TEST_NAME && w.token);
        if (mine) return { url: `https://discord.com/api/webhooks/${mine.id}/${mine.token}` };
        const made: any = await RestAPI.post({ url: `/channels/${channelId}/webhooks`, body: { name: TEST_NAME } });
        return made?.body?.token ? { url: `https://discord.com/api/webhooks/${made.body.id}/${made.body.token}` } : { error: "Discord didn't hand back the webhook" };
    } catch (e: any) {
        return { error: e?.status === 403 ? "You need the Manage Webhooks permission in that channel" : apiError(e) };
    }
}

/* ── Only me ── */

/** A picture's size, so Discord's local preview lays it out (it won't load a picture without one). */
function sizeOf(url: string): Promise<{ width: number; height: number; } | null> {
    return new Promise(res => {
        const img = new Image();
        const done = (v: { width: number; height: number; } | null) => { img.onload = img.onerror = null; res(v); };
        img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => done(null);
        setTimeout(() => done(null), 3000);
        img.src = url;
    });
}

export interface LocalFile { name: string; contentType: string; size: number; url?: string; }

/**
 * Shows a webhook message body in a channel, only on this computer. `files`
 * stand in for the uploads (attachment://name is pointed at their previews).
 */
export async function showOnlyMe(channelId: string, body: Record<string, any>, files: LocalFile[], author: { id?: string; name: string; avatar?: string | null; }) {
    const byName = new Map(files.map(f => [f.name, f.url ?? ""]));
    const swap = (url: string) => url?.startsWith("attachment://") ? byName.get(url.slice(13)) ?? "" : url;

    // Pictures in embeds and cards need their sizes for Discord to draw them.
    const sized = async (url: string) => {
        const real = swap(url);
        const s = real ? await sizeOf(real) : null;
        return { url: real, proxy_url: real, width: s?.width ?? 400, height: s?.height ?? 225, content_type: "image/png", loading_state: 2 };
    };
    const embeds = await Promise.all((body.embeds ?? []).map(async (e: any) => ({
        ...e,
        type: "rich",
        ...(e.image?.url && { image: await sized(e.image.url) }),
        ...(e.thumbnail?.url && { thumbnail: await sized(e.thumbnail.url) }),
        ...(e.author?.icon_url && { author: { ...e.author, icon_url: swap(e.author.icon_url), proxy_icon_url: swap(e.author.icon_url) } }),
        ...(e.footer?.icon_url && { footer: { ...e.footer, icon_url: swap(e.footer.icon_url), proxy_icon_url: swap(e.footer.icon_url) } }),
    })));
    const walk = async (node: any): Promise<any> => {
        if (Array.isArray(node)) return Promise.all(node.map(walk));
        if (!node || typeof node !== "object") return node;
        const out: any = {};
        for (const [k, v] of Object.entries(node)) out[k] = (k === "media" || k === "file") && (v as any)?.url ? await sized((v as any).url) : await walk(v);
        return out;
    };
    const components = await walk(body.components ?? []);
    const pictured = JSON.stringify([body.embeds, body.components]);
    const attachments = (body.flags ? [] : files.filter(f => !pictured.includes(`attachment://${f.name}`))).map((f, i) => ({
        id: String(Date.now() + i), filename: f.name, size: f.size, url: f.url ?? "", proxy_url: f.url ?? "", content_type: f.contentType,
    }));

    sendBotMessage(channelId, {
        content: body.content ?? "",
        embeds,
        components,
        attachments,
        // Discord's "only you can see this" mark (64), plus the card layout's flag if it's used.
        flags: (body.flags ?? 0) | 64,
        author: { id: author.id ?? "0", username: author.name, globalName: author.name, avatar: author.avatar ?? null, bot: true, discriminator: "0000" } as any,
    } as any);
}

/* ── The menu ── */

function manageable(guildId: string) {
    const out: { id: string; name: string; }[] = [];
    for (const c of Object.values<any>(ChannelStore.getMutableGuildChannelsForGuild?.(guildId) ?? {})) {
        if ((c.type === 0 || c.type === 5) && PermissionStore.can(PermissionsBits.MANAGE_WEBHOOKS, c)) out.push({ id: c.id, name: c.name });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function TestButton({ raw, write, autoDelete, setAutoDelete, onOnlyMe, onPost, host }: {
    /** Where the menu is drawn — inside the editor, since Discord's window footer cuts off anything that sticks out of it. */
    host?: HTMLElement | null;
    raw: string | undefined;
    write(json: string): void;
    autoDelete: boolean;
    setAutoDelete(v: boolean): void;
    onOnlyMe(channelId: string): void;
    onPost(target: TestChannel): void;
}) {
    const [open, setOpen] = useState(false);
    const [choosing, setChoosing] = useState(false);
    const [guildId, setGuildId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const box = useRef<HTMLDivElement>(null);
    const pop = useRef<HTMLDivElement>(null);
    const target = loadTestChannel(raw);
    const targetChannel: any = target ? ChannelStore.getChannel(target.channelId) : null;
    const here: any = ChannelStore.getChannel(SelectedChannelStore.getChannelId());

    useEffect(() => {
        if (!open) return;
        const away = (e: MouseEvent) => {
            const t = e.target as Node;
            if (box.current?.contains(t) || pop.current?.contains(t)) return;
            setOpen(false); setChoosing(false);
        };
        document.addEventListener("mousedown", away);
        return () => document.removeEventListener("mousedown", away);
    }, [open]);

    const guilds = useMemo(() => {
        const ids: string[] = (SortedGuildStore?.getFlattenedGuildIds?.() as string[] | undefined) ?? Object.keys(GuildStore.getGuilds());
        return ids.map(id => GuildStore.getGuild(id)).filter(Boolean).filter((g: any) => manageable(g.id).length > 0) as any[];
    }, [choosing]);
    const channels = guildId ? manageable(guildId) : [];

    const choose = async (channelId: string) => {
        setBusy(true); setError(null);
        const r = await testWebhookFor(channelId);
        setBusy(false);
        if (!r.url) { setError(r.error ?? "Couldn't use that channel"); return; }
        write(JSON.stringify({ channelId, url: r.url }));
        setChoosing(false);
    };

    const menu = (
                <div className="vc-es-test-pop" ref={pop}>
                    <b>Try it first</b>
                    <button type="button" className="vc-es-test-opt" disabled={!here} onClick={() => { setOpen(false); onOnlyMe(here.id); }}>
                        <span>👁</span>
                        <div><b>Only me, here</b><small>{here ? `Shows in ${here.guild_id ? "#" + here.name : "this chat"} — just for you, nothing is sent` : "Open a chat first"}</small></div>
                    </button>
                    <button type="button" className="vc-es-test-opt" disabled={!target} onClick={() => { if (target) { setOpen(false); onPost(target); } }}>
                        <span>📨</span>
                        <div><b>Post in my test channel</b><small>{target ? `#${targetChannel?.name ?? "unknown"}${targetChannel?.guild_id ? ` · ${GuildStore.getGuild(targetChannel.guild_id)?.name ?? ""}` : ""} — a real post` : "Pick one below"}</small></div>
                    </button>
                    {choosing ? (
                        <div className="vc-es-test-choose">
                            <select className="vc-tool-input" value={guildId} onChange={e => setGuildId(e.currentTarget.value)}>
                                <option value="">Server…</option>
                                {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                            {guildId && (
                                <select className="vc-tool-input" defaultValue="" disabled={busy} onChange={e => e.currentTarget.value && void choose(e.currentTarget.value)}>
                                    <option value="">Channel…</option>
                                    {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                                </select>
                            )}
                            <span className="vc-tool-hint">{busy ? "Setting it up…" : "Only servers where you can manage webhooks are listed. A private channel just for you works best."}</span>
                        </div>
                    ) : (
                        <button type="button" className="vc-tool-link" onClick={() => setChoosing(true)}>{target ? "Change the test channel" : "Choose a test channel…"}</button>
                    )}
                    {error && <span className="vc-tool-error">{error}</span>}
                    <label className="vc-tool-check"><input type="checkbox" checked={autoDelete} onChange={e => setAutoDelete(e.currentTarget.checked)} /> Delete test posts after 2 minutes</label>
                </div>
    );

    return (
        <div className="vc-es-test" ref={box}>
            <button type="button" className={classes("vc-tool-btn", open && "vc-es-test-on")} onClick={() => setOpen(o => !o)} title="Try it before the real post">🧪 Test</button>
            {open && (host ? ReactDOM.createPortal(menu, host) : menu)}
        </div>
    );
}
