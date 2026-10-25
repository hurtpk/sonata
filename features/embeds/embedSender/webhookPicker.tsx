/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "Pick or create a webhook": the servers where you're allowed to manage
// webhooks (with their icons, searchable), their channels, that channel's
// webhooks (with their pictures — use one, or change its name and picture),
// and making a new one with its own name and picture. The same thing Server
// Settings → Integrations does.

import "../../_shared/tool.css";
import "./webhookPicker.css";

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { Channel, Guild, RenderModalProps } from "@vencord/discord-types";
import { GuildChannelStore, GuildStore, IconUtils, openModal, PermissionsBits, PermissionStore, RestAPI, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { Window } from "../../_shared/Window";

const cl = classNameFactory("vc-tool-");
const wp = classNameFactory("vc-whp-");

interface Webhook { id: string; name: string | null; token?: string; type: number; avatar?: string | null; }

const TEXT = 0, ANNOUNCEMENT = 5;
const DEFAULT_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

const webhookUrl = (w: Webhook) => `https://discord.com/api/webhooks/${w.id}/${w.token}`;
const webhookAvatar = (w: Webhook) => w.avatar ? `https://cdn.discordapp.com/avatars/${w.id}/${w.avatar}.png?size=64` : DEFAULT_AVATAR;

function manageableChannels(guildId: string): Channel[] {
    const entries: any[] = GuildChannelStore.getChannels(guildId)?.SELECTABLE ?? [];
    return entries.map(e => e.channel as Channel)
        .filter(c => c && (c.type === TEXT || c.type === ANNOUNCEMENT) && PermissionStore.can(PermissionsBits.MANAGE_WEBHOOKS, c));
}

function apiError(e: any) {
    const body = e?.body ?? e;
    if (body?.code === 30007) return "This channel already has the most webhooks it can (15). Delete one in Server Settings → Integrations, or pick one below.";
    if (body?.code === 50013) return "You don't have permission to manage webhooks there.";
    if (body?.errors?.avatar) return "Discord didn't accept that picture — try a PNG, JPG or GIF under 8 MB.";
    return body?.message ?? String(e?.message ?? e ?? "Something went wrong");
}

function readImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith("image/")) { reject(new Error("That isn't a picture.")); return; }
        if (file.size > 8 * 1024 * 1024) { reject(new Error("That picture is over 8 MB.")); return; }
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error("Couldn't read that picture."));
        r.readAsDataURL(file);
    });
}

function GuildIcon({ guild }: { guild: Guild; }) {
    const url = guild.icon ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 64, canAnimate: false }) : null;
    if (url) return <img className={wp("guild-icon")} src={url} alt="" />;
    // No icon: the server's initials, like Discord shows.
    const initials = guild.name.split(/\s+/).map(w => w[0]).join("").slice(0, 3);
    return <span className={classes(wp("guild-icon"), wp("guild-initials"))}>{initials}</span>;
}

/** A round picture you click to change (or clear). */
function AvatarPicker({ src, onChange, onError }: { src: string | null; onChange(dataUrl: string | null): void; onError(msg: string): void; }) {
    const input = useRef<HTMLInputElement>(null);
    return (
        <div className={wp("avatar-pick")}>
            <button type="button" className={wp("avatar-button")} title="Choose a picture" onClick={() => input.current?.click()}>
                <img src={src ?? DEFAULT_AVATAR} alt="" />
                <span>Change</span>
            </button>
            {src && <button type="button" className={wp("avatar-clear")} title="Use the default picture" onClick={() => onChange(null)}>×</button>}
            <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={async e => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (!f) return;
                try { onChange(await readImage(f)); } catch (err: any) { onError(err.message); }
            }} />
        </div>
    );
}

function WebhookRow({ hook, onUse, onSaved, onError }: { hook: Webhook; onUse(): void; onSaved(w: Webhook): void; onError(msg: string): void; }) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(hook.name ?? "");
    // undefined = leave the picture as it is; null = back to the default; string = new picture.
    const [avatar, setAvatar] = useState<string | null | undefined>(undefined);
    const [busy, setBusy] = useState(false);

    const save = async () => {
        if (!name.trim()) return;
        setBusy(true);
        try {
            const body: Record<string, unknown> = { name: name.trim().slice(0, 80) };
            if (avatar !== undefined) body.avatar = avatar;
            const res: any = await RestAPI.patch({ url: `/webhooks/${hook.id}`, body });
            onSaved({ ...hook, ...res.body });
            setEditing(false);
            setAvatar(undefined);
        } catch (e) {
            onError(apiError(e));
        } finally { setBusy(false); }
    };

    if (!editing) {
        return (
            <div className={wp("hook")}>
                <img className={wp("hook-avatar")} src={webhookAvatar(hook)} alt="" />
                <span className={wp("hook-name")}>{hook.name || "Unnamed webhook"}</span>
                <button type="button" className={cl("btn")} onClick={() => setEditing(true)}>Edit</button>
                <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={onUse}>Use</button>
            </div>
        );
    }
    return (
        <div className={classes(wp("hook"), wp("hook-editing"))}>
            <AvatarPicker src={avatar === undefined ? webhookAvatar(hook) : avatar} onChange={setAvatar} onError={onError} />
            <input className={classes(cl("input"), cl("grow"))} value={name} maxLength={80} placeholder="Webhook name" autoFocus
                onChange={e => setName(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} />
            <button type="button" className={cl("btn")} onClick={() => { setEditing(false); setName(hook.name ?? ""); setAvatar(undefined); }}>Cancel</button>
            <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={busy || !name.trim()} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </div>
    );
}

function PickerModal({ modalProps, onPick }: { modalProps: RenderModalProps; onPick(url: string, name: string): void; }) {
    const accent = windowAccent("embedSender");
    const guilds = useMemo(() => Object.values(GuildStore.getGuilds())
        .map(g => ({ guild: g, channels: manageableChannels(g.id) }))
        .filter(g => g.channels.length)
        .sort((a, b) => a.guild.name.localeCompare(b.guild.name)), []);

    const [query, setQuery] = useState("");
    const [guildId, setGuildId] = useState(guilds[0]?.guild.id ?? "");
    const channels = guilds.find(g => g.guild.id === guildId)?.channels ?? [];
    const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
    const [existing, setExisting] = useState<Webhook[] | "loading" | null>(null);
    const [name, setName] = useState("Embed Sender");
    const [avatar, setAvatar] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const q = query.trim().toLowerCase();
    const shownGuilds = q ? guilds.filter(g => g.guild.name.toLowerCase().includes(q)) : guilds;
    const channel = channels.find(c => c.id === channelId);

    // A different server starts on its first channel.
    useEffect(() => { setChannelId(channels[0]?.id ?? ""); }, [guildId]);

    useEffect(() => {
        if (!channelId) { setExisting(null); return; }
        let cancelled = false;
        setExisting("loading");
        setError(null);
        RestAPI.get({ url: `/channels/${channelId}/webhooks` })
            .then((res: any) => { if (!cancelled) setExisting((res.body as Webhook[]).filter(w => w.type === 1 && w.token)); })
            .catch(e => { if (!cancelled) { setExisting([]); setError(apiError(e)); } });
        return () => { cancelled = true; };
    }, [channelId]);

    const pick = (w: Webhook) => { onPick(webhookUrl(w), w.name ?? "webhook"); modalProps.onClose(); };

    const create = async () => {
        if (!channelId || !name.trim()) return;
        setBusy(true);
        setError(null);
        try {
            const body: Record<string, unknown> = { name: name.trim().slice(0, 80) };
            if (avatar) body.avatar = avatar;
            const res: any = await RestAPI.post({ url: `/channels/${channelId}/webhooks`, body });
            pick(res.body as Webhook);
        } catch (e) {
            setError(apiError(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Window {...modalProps} size="lg" title="Pick or create a webhook" subtitle="Servers where you can manage webhooks">
            <div className={classes(cl("wrap"), wp("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                {guilds.length === 0 ? (
                    <div className={cl("hint")}>
                        You can't manage webhooks in any of your servers. Someone with the Manage Webhooks permission can make one for you.
                    </div>
                ) : (
                    <>
                        <div className={wp("columns")}>
                            <div className={wp("column")}>
                                <div className={cl("label")}>Server</div>
                                {guilds.length > 6 && <input className={cl("input")} value={query} placeholder="Search servers…" onChange={e => setQuery(e.currentTarget.value)} />}
                                <div className={wp("list")}>
                                    {shownGuilds.map(({ guild, channels }) => (
                                        <button key={guild.id} type="button" className={classes(wp("item"), guild.id === guildId && wp("item-on"))} onClick={() => setGuildId(guild.id)}>
                                            <GuildIcon guild={guild} />
                                            <span className={wp("item-name")}>{guild.name}</span>
                                            <span className={wp("item-meta")}>{channels.length}</span>
                                        </button>
                                    ))}
                                    {!shownGuilds.length && <div className={cl("hint")}>No server matches “{query}”.</div>}
                                </div>
                            </div>
                            <div className={wp("column")}>
                                <div className={cl("label")}>Channel</div>
                                <div className={wp("list")}>
                                    {channels.map(c => (
                                        <button key={c.id} type="button" className={classes(wp("item"), c.id === channelId && wp("item-on"))} onClick={() => setChannelId(c.id)}>
                                            <span className={wp("hash")}>{c.type === ANNOUNCEMENT ? "📣" : "#"}</span>
                                            <span className={wp("item-name")}>{c.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className={cl("card")}>
                            <div className={cl("label")}>Webhooks in {channel ? `#${channel.name}` : "this channel"}</div>
                            {existing === "loading" && <div className={cl("hint")}>Loading…</div>}
                            {Array.isArray(existing) && existing.length === 0 && <div className={cl("hint")}>None yet — make one below.</div>}
                            {Array.isArray(existing) && existing.length > 0 && (
                                <div className={wp("hooks")}>
                                    {existing.map(w => (
                                        <WebhookRow key={w.id} hook={w} onUse={() => pick(w)} onError={setError}
                                            onSaved={nw => setExisting(list => Array.isArray(list) ? list.map(x => x.id === nw.id ? nw : x) : list)} />
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className={cl("card")}>
                            <div className={cl("label")}>Create a new one</div>
                            <div className={wp("create")}>
                                <AvatarPicker src={avatar} onChange={setAvatar} onError={setError} />
                                <input className={classes(cl("input"), cl("grow"))} value={name} maxLength={80} placeholder="Webhook name" onChange={e => setName(e.currentTarget.value)}
                                    onKeyDown={e => { if (e.key === "Enter") create(); }} />
                                <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={busy || !name.trim() || !channelId} onClick={create}>
                                    {busy ? "Creating…" : "Create & use"}
                                </button>
                            </div>
                            <div className={cl("hint")}>
                                The name and picture are what messages from it show by default. It appears in that server's Integrations settings, where anyone with Manage Webhooks can rename or delete it.
                            </div>
                        </div>
                    </>
                )}
                {error && <div className={cl("error")}>{error}</div>}
            </div>
        </Window>
    );
}

export function openWebhookPicker(onPick: (url: string, name: string) => void) {
    openModal(props => <PickerModal modalProps={props} onPick={onPick} />);
}
