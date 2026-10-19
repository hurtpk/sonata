/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { Channel, RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Constants, GuildMemberStore, Modal, NavigationRouter, openModal, RestAPI, useEffect, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { DayWindow, inDay, pastDays, timeOf } from "./dates";

const cl = classNameFactory("vc-otd-");
const PAGE = 100;

interface RawMessage {
    id: string;
    content: string;
    author: { id: string; username: string; global_name?: string | null; avatar?: string | null; };
    attachments?: unknown[];
    embeds?: unknown[];
    sticker_items?: unknown[];
}

interface YearResult { day: DayWindow; messages: RawMessage[]; more: boolean; error?: string; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The first messages of that day, oldest first, read straight from the channel's history. */
async function fetchDay(channelId: string, day: DayWindow): Promise<YearResult> {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res: any = await RestAPI.get({ url: Constants.Endpoints.MESSAGES(channelId), query: { after: day.afterId, limit: PAGE } });
            const all: RawMessage[] = (res.body ?? []).slice().sort((a: RawMessage, b: RawMessage) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
            const messages = all.filter(m => inDay(m.id, day));
            return { day, messages, more: messages.length === all.length && all.length === PAGE };
        } catch (e: any) {
            // Slowed down by Discord: wait as long as it asks, then try again.
            const wait = Number(e?.body?.retry_after ?? 0);
            if (e?.status === 429 && wait) { await sleep(wait * 1000 + 100); continue; }
            return { day, messages: [], more: false, error: e?.status === 403 ? "You can't read this channel's history." : "Couldn't load this day." };
        }
    }
    return { day, messages: [], more: false, error: "Discord kept asking to slow down — try again in a bit." };
}

function avatarOf(a: RawMessage["author"]) {
    if (a.avatar) return `https://cdn.discordapp.com/avatars/${a.id}/${a.avatar}.webp?size=64`;
    try { return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(a.id) >> 22n) % 6n)}.png`; } catch { return ""; }
}

/** Mentions and custom emoji written as readable text. */
function readable(text: string, guildId?: string | null) {
    return text
        .replace(/<@!?(\d+)>/g, (_, id) => `@${(guildId && GuildMemberStore.getNick(guildId, id)) || UserStore.getUser(id)?.username || "someone"}`)
        .replace(/<#(\d+)>/g, (_, id) => `#${ChannelStore.getChannel(id)?.name ?? "channel"}`)
        .replace(/<@&\d+>/g, "@role")
        .replace(/<a?:(\w+):\d+>/g, ":$1:")
        .replace(/<t:(\d+)(?::\w)?>/g, (_, s) => new Date(Number(s) * 1000).toLocaleString());
}

function extras(m: RawMessage) {
    const parts: string[] = [];
    if (m.attachments?.length) parts.push(`${m.attachments.length} attachment${m.attachments.length === 1 ? "" : "s"}`);
    if (m.sticker_items?.length) parts.push("sticker");
    if (!m.content && m.embeds?.length) parts.push("embed");
    return parts.join(" · ");
}

const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

function OnThisDayModal({ modalProps, channel }: { modalProps: RenderModalProps; channel: Channel; }) {
    const accent = windowAccent("onThisDay");
    const days = pastDays(new Date(), timeOf(channel.id));
    const [results, setResults] = useState<YearResult[]>([]);
    const [done, setDone] = useState(days.length === 0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            for (const day of days) {
                const r = await fetchDay(channel.id, day);
                if (cancelled) return;
                setResults(prev => [...prev, r]);
                await sleep(250);
            }
            if (!cancelled) setDone(true);
        })();
        return () => { cancelled = true; };
    }, []);

    const jump = (id: string) => {
        NavigationRouter.transitionTo(`/channels/${channel.guild_id ?? "@me"}/${channel.id}/${id}`);
        modalProps.onClose();
    };

    const where = channel.isDM?.() ? `your DM with ${UserStore.getUser(channel.recipients?.[0])?.username ?? "them"}` : channel.name ? `#${channel.name}` : "this chat";
    const withMessages = results.filter(r => r.messages.length);
    const today = new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" });

    return (
        <Modal {...modalProps} size="lg" title={`On This Day · ${today}`} subtitle={`In ${where}`}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="📅" kicker={`In ${where}`} title={today}
                    sub={!done ? `Looking back ${results.length + 1} year${results.length ? "s" : ""}…` : withMessages.length ? "Here's what was said on this day before." : "A quiet day in past years."}
                    numbers={[{ value: withMessages.length, label: withMessages.length === 1 ? "year" : "years" }, { value: withMessages.reduce((n, r) => n + r.messages.length, 0), label: "messages" }]} />
                {days.length === 0 && <div className={cl("empty")}>This chat is less than a year old — come back on its first birthday.</div>}
                {withMessages.map(r => (
                    <section key={r.day.year} className={cl("year")}>
                        <div className={cl("year-head")}>
                            <span className={cl("ago")}>{r.day.yearsAgo} year{r.day.yearsAgo === 1 ? "" : "s"} ago</span>
                            <span className={cl("date")}>{fmtDay(r.day.start)}</span>
                            <span className={cl("count")}>{r.messages.length}{r.more ? "+" : ""}</span>
                        </div>
                        <div className={cl("list")}>
                            {r.messages.map(m => (
                                <button key={m.id} type="button" className={cl("msg")} title="Jump to this message" onClick={() => jump(m.id)}>
                                    <img className={cl("avatar")} src={avatarOf(m.author)} alt="" />
                                    <span className={cl("body")}>
                                        <span className={cl("meta")}>
                                            <span className={cl("name")}>{(channel.guild_id && GuildMemberStore.getNick(channel.guild_id, m.author.id)) || m.author.global_name || m.author.username}</span>
                                            <span className={cl("time")}>{new Date(timeOf(m.id)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                                        </span>
                                        {m.content && <span className={cl("text")}>{readable(m.content, channel.guild_id)}</span>}
                                        {extras(m) && <span className={cl("extra")}>{extras(m)}</span>}
                                    </span>
                                </button>
                            ))}
                            {r.more && <button type="button" className={cl("more")} onClick={() => jump(r.messages[r.messages.length - 1].id)}>That day kept going — jump in to read the rest</button>}
                        </div>
                    </section>
                ))}
                {results.filter(r => r.error).slice(0, 1).map(r => <div key="err" className={cl("error")}>{r.error}</div>)}
                {!done && <div className={cl("note")}><span className={cl("spinner")} />Looking back {results.length + 1} year{results.length ? "s" : ""}…</div>}
                {done && days.length > 0 && withMessages.length === 0 && !results.some(r => r.error) && (
                    <div className={cl("empty")}>Nothing was said here on {today} in the past {days.length === 1 ? "year" : `${days.length} years`}.</div>
                )}
            </div>
        </Modal>
    );
}

export function openOnThisDay(channel: Channel) {
    openModal(props => <OnThisDayModal modalProps={props} channel={channel} />);
}
