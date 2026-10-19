/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Auto Volume window: everyone in the call and how loud they are right
// now, anyone Sonata muted (and why, and how loud they were) with an unmute
// button, and a log of who joined and left and how loud they were.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Modal, openModal, useEffect, useReducer, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { activity, allowAlways, inCall, LogEntry, onBalancerChange, peopleNow, PersonState, release, resetEveryone, unmuteNow } from "./balancer";
import { settings } from "./index";

const cl = classNameFactory("vc-tool-");
const av = classNameFactory("vc-avb-");

// ─── Loudness, in words ───

/** dB below the maximum → a word anyone understands. */
function loudWord(db: number | null) {
    if (db == null) return "—";
    if (db >= -2) return "Maxed out";
    if (db >= -6) return "Very loud";
    if (db >= -12) return "Loud";
    if (db >= -24) return "Normal";
    return "Quiet";
}

const loudLevel = (db: number | null) => db == null ? "none" : db >= -2 ? "max" : db >= -6 ? "vloud" : db >= -12 ? "loud" : db >= -24 ? "normal" : "quiet";
/** -40 dB … 0 dB → 0 … 1 along a meter. */
const meter = (db: number | null) => db == null ? 0 : Math.max(0, Math.min(1, (db + 40) / 40));
const dB = (db: number | null) => db == null ? "" : `${Math.round(db)} dB`;
const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function Avatar({ src }: { src?: string; }) {
    return src ? <img className={av("avatar")} src={src} alt="" /> : <span className={av("avatar")} />;
}

const userBits = (id: string) => {
    const u: any = UserStore.getUser(id);
    return { name: u?.globalName || u?.username || "Someone", avatar: u?.getAvatarURL?.(undefined, 40, false) as string | undefined };
};

/** A loudness meter with its zones marked, and where they are right now. */
function Meter({ now, usual }: { now: number | null; usual: number | null; }) {
    return (
        <div className={av("meter")} title={now != null ? `Right now: ${loudWord(now)} (${dB(now)})` : "Not talking"}>
            <div className={av("meter-zones")} />
            <div className={classes(av("meter-fill"), av(`lv-${loudLevel(now)}`))} style={{ transform: `scaleX(${meter(now)})` }} />
            {usual != null && <span className={av("meter-usual")} style={{ left: `${meter(usual) * 100}%` }} title={`Usually ${loudWord(usual)} (${dB(usual)})`} />}
        </div>
    );
}

// ─── Sections ───

function NowRow({ p }: { p: PersonState; }) {
    const { name, avatar } = userBits(p.userId);
    const talking = p.now != null;
    const tag = p.status === "manual" ? "Volume set by you"
        : p.allowed ? "Never auto-muted"
            : p.friend && settings.store.spareFriends ? "Friend · never auto-muted"
                : p.status === "balanced" ? "Balanced" : p.status === "set" ? "Starting volume" : "";
    return (
        <div className={classes(av("row"), talking && av("row-talking"))}>
            <Avatar src={avatar} />
            <div className={av("who")}>
                <span className={av("name")}>{name}</span>
                <span className={av("sub")}>{tag || (talking ? "Talking" : "Quiet right now")}</span>
            </div>
            <div className={av("level")}>
                <Meter now={p.now} usual={p.usual} />
                <div className={av("level-text")}>
                    <span className={classes(av("word"), av(`lv-${loudLevel(p.now)}`))}>{talking ? loudWord(p.now) : "Not talking"}</span>
                    <span className={av("dim")}>{talking ? dB(p.now) : p.usual != null ? `usually ${loudWord(p.usual).toLowerCase()}` : ""}</span>
                </div>
            </div>
            <span className={av("vol")} title="The volume you hear them at">{Math.round(p.volume)}%</span>
            {p.status === "manual" && <button type="button" className={cl("btn")} onClick={() => release(p.userId)} title="Let Sonata balance them again">Balance</button>}
        </div>
    );
}

function MutedCard({ p, now }: { p: PersonState; now: number; }) {
    const { name, avatar } = userBits(p.userId);
    const m = p.muted!;
    const left = p.mutedUntil ? Math.max(0, Math.ceil((p.mutedUntil - now) / 1000)) : null;
    return (
        <div className={av("muted")}>
            <Avatar src={avatar} />
            <div className={av("who")}>
                <span className={av("name")}>🔇 {name}</span>
                <span className={av("sub")}>
                    <b className={av("why")}>{m.why[0].toUpperCase() + m.why.slice(1)}</b> · at {time(m.at)} · loudest {loudWord(m.peak).toLowerCase()} ({dB(m.peak)}){m.usual != null ? `, around ${dB(m.usual)}` : ""}
                </span>
                <span className={av("sub")}>{left != null ? `Unmutes by itself in ${left}s` : "Stays muted until you unmute them"}</span>
            </div>
            <div className={av("actions")}>
                <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={() => unmuteNow(p.userId)}>Unmute now</button>
                <button type="button" className={cl("btn")} onClick={() => allowAlways(p.userId)} title="Unmute them, and never auto-mute them again">Always allow</button>
            </div>
        </div>
    );
}

const LOG_TEXT: Record<LogEntry["kind"], [string, string]> = {
    here: ["👋", "was here when you joined"],
    join: ["➡️", "joined"],
    leave: ["⬅️", "left"],
    mute: ["🔇", "was muted"],
    unmute: ["🔊", "was unmuted"],
};

function LogRow({ e, live }: { e: LogEntry; live?: PersonState; }) {
    const [icon, text] = LOG_TEXT[e.kind];
    // Joins show how loud they've been since, while they're still here.
    const sinceJoin = e.kind === "join" || e.kind === "here";
    const usual = sinceJoin ? live?.usual ?? null : e.usual;
    const peak = sinceJoin ? live?.peak ?? null : e.peak;
    let detail: string;
    if (e.kind === "mute") detail = `${e.why} · loudest ${dB(peak)}`;
    else if (e.kind === "unmute") detail = e.why ?? "";
    else if (usual != null) detail = `${e.kind === "leave" ? "was" : "is"} usually ${loudWord(usual).toLowerCase()} (${dB(usual)}) · loudest ${dB(peak)}`;
    else detail = e.kind === "leave" ? "didn't talk" : live ? "hasn't talked yet" : "";
    return (
        <div className={classes(av("log"), av(`log-${e.kind}`))}>
            <span className={av("log-icon")}>{icon}</span>
            <Avatar src={e.avatar} />
            <div className={av("who")}>
                <span className={av("log-line")}><b>{e.name}</b> {text}</span>
                {detail && <span className={av("sub")}>{detail}</span>}
            </div>
            <span className={av("dim")}>{time(e.t)}</span>
        </div>
    );
}

type Tab = "now" | "activity";

function AutoVolumeModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const accent = windowAccent("autoVolume");
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => onBalancerChange(bump), []);
    const [tab, setTab] = useState<Tab>("now");
    const people = peopleNow();
    const log = activity();
    const channelId = inCall();
    const channel: any = channelId && ChannelStore.getChannel(channelId);
    const now = Date.now();
    const muted = people.filter(p => p.status === "muted" && p.muted);
    // Loudest talkers first, then the quiet ones.
    const others = people.filter(p => p.status !== "muted").sort((a, b) => (b.now ?? -99) - (a.now ?? -99));
    const where = channel?.name ? `🔊 ${channel.name}` : "In a call";

    return (
        <Modal {...modalProps} size="lg" title="Auto Volume" subtitle={channelId ? `${where} · ${people.length} other${people.length === 1 ? "" : "s"}${muted.length ? ` · ${muted.length} muted` : ""}` : "Not in a call"}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                {channelId && (
                    <ToolHero icon="🎚️" kicker={where} title={`${people.length} other${people.length === 1 ? "" : "s"} in the call`}
                        sub="Loud people are turned down and quiet ones up, so everyone sounds about the same."
                        numbers={[{ value: muted.length, label: "muted" }]} />
                )}
                {!channelId ? (
                    <div className={av("empty")}>🎧 Join a voice channel or call — everyone in it shows up here, with how loud they are.</div>
                ) : (
                    <>
                        {muted.length > 0 && (
                            <section className={av("section")}>
                                <div className={av("heading")}>Muted by Sonata</div>
                                {muted.map(p => <MutedCard key={p.userId} p={p} now={now} />)}
                            </section>
                        )}

                        <div className={cl("seg")}>
                            <button type="button" className={classes(cl("seg-btn"), tab === "now" && cl("seg-on"))} onClick={() => setTab("now")}>Right now</button>
                            <button type="button" className={classes(cl("seg-btn"), tab === "activity" && cl("seg-on"))} onClick={() => setTab("activity")}>Joined &amp; left{log.length ? ` (${log.length})` : ""}</button>
                        </div>

                        {tab === "now" && (
                            others.length
                                ? <section className={av("section")}>{others.map(p => <NowRow key={p.userId} p={p} />)}</section>
                                : <div className={av("empty")}>{muted.length ? "Everyone else here is muted." : "It's just you in here for now."}</div>
                        )}

                        {tab === "activity" && (
                            log.length
                                ? <section className={av("section")}>{log.map(e => <LogRow key={e.key} e={e} live={people.find(p => p.userId === e.userId)} />)}</section>
                                : <div className={av("empty")}>Nothing yet — people joining and leaving show up here.</div>
                        )}

                        <div className={av("legend")}>
                            <span><i className={av("lv-quiet")} />Quiet</span>
                            <span><i className={av("lv-normal")} />Normal</span>
                            <span><i className={av("lv-loud")} />Loud</span>
                            <span><i className={av("lv-vloud")} />Very loud</span>
                            <span><i className={av("lv-max")} />Maxed out</span>
                            <span><i className={av("legend-usual")} />Their usual level</span>
                        </div>
                    </>
                )}
                <div className={cl("footer")}>
                    <span className={cl("hint")}>Only changes what you hear.</span>
                    <span className={cl("spacer")} />
                    <button type="button" className={cl("btn")} onClick={resetEveryone} disabled={!people.length}>Reset everyone to 100%</button>
                </div>
            </div>
        </Modal>
    );
}

export function openAutoVolume() {
    openModal(props => <AutoVolumeModal modalProps={props} />);
}
