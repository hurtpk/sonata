/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A game's own page: trailers and screenshots, the details, how reviews break
// down, your achievements (with your Steam profile linked), what it needs to
// run, and its DLC.

import { classNameFactory } from "@utils/css";
import { openImageModal } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, showToast, useEffect, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { Window } from "../../_shared/Window";
import { checkGames, opts } from "./check";
import type { SteamAchievement, SteamDetails, SteamItem, SteamReviewSummary } from "./native";
import { isWatched, profile, unwatch, useSteam, watch } from "./store";

const cl = classNameFactory("vc-tool-");
const gp = classNameFactory("vc-steam-gp-");
const native = () => VencordNative.pluginHelpers.Sonata as any;
const open = (url: string) => window.open(url, "_blank", "noopener");
const storeUrl = (appid: number) => `https://store.steampowered.com/app/${appid}`;

type Media = { kind: "movie"; name: string; thumb: string; mp4: string; } | { kind: "shot"; thumb: string; full: string; };

function MediaViewer({ d }: { d: SteamDetails; }) {
    const media: Media[] = [...d.movies.map(m => ({ kind: "movie" as const, ...m })), ...d.screenshots.map(s => ({ kind: "shot" as const, ...s }))];
    const [pick, setPick] = useState(0);
    const [broken, setBroken] = useState<Set<string>>(new Set());
    const m = media[pick];
    if (!m) return null;
    return (
        <section className={gp("media")}>
            <div className={gp("stage")}>
                {m.kind === "movie" && !broken.has(m.mp4) ? (
                    <video key={m.mp4} className={gp("stage-media")} src={m.mp4} poster={m.thumb} controls autoPlay muted playsInline
                        onError={() => setBroken(b => new Set(b).add(m.mp4))} />
                ) : m.kind === "movie" ? (
                    <button type="button" className={gp("stage-fallback")} onClick={() => open(storeUrl(d.appid))}>
                        <img className={gp("stage-media")} src={m.thumb} alt="" />
                        <span>▶ Watch “{m.name}” on Steam</span>
                    </button>
                ) : (
                    <img className={classes(gp("stage-media"), gp("stage-zoom"))} src={m.full} alt="" title="Click to see it bigger" onClick={() => openImageModal({ url: m.full })} />
                )}
            </div>
            <div className={gp("strip")}>
                {media.map((x, i) => (
                    <button key={i} type="button" className={classes(gp("thumb"), i === pick && gp("thumb-on"))} onClick={() => setPick(i)} title={x.kind === "movie" ? x.name : "Screenshot"}>
                        <img src={x.thumb} alt="" loading="lazy" />
                        {x.kind === "movie" && <span className={gp("thumb-play")} aria-hidden>▶</span>}
                    </button>
                ))}
            </div>
        </section>
    );
}

function Reviews({ r }: { r: SteamReviewSummary; }) {
    const pct = r.total ? Math.round(r.positive / r.total * 100) : 0;
    return (
        <section className={gp("card")}>
            <span className={cl("label")}>Reviews</span>
            <div className={gp("rev-head")}><b>{r.label || "No score yet"}</b><span>{pct}% positive · {r.total.toLocaleString()} reviews</span></div>
            <div className={gp("rev-bar")}><i style={{ width: `${pct}%` }} /></div>
            <div className={gp("rev-counts")}><span>👍 {r.positive.toLocaleString()}</span><span>👎 {r.negative.toLocaleString()}</span></div>
        </section>
    );
}

function Achievements({ appid, total }: { appid: number; total: number; }) {
    const p = profile();
    const [state, setState] = useState<{ list?: SteamAchievement[]; error?: string; } | null>(null);
    const [show, setShow] = useState<"all" | "got" | "left">("all");
    useEffect(() => {
        if (!p) return;
        native().steamAchievements(p.steamid, appid).then((r: any) => setState(r?.ok ? { list: r.list } : { error: r?.error ?? "Couldn't load them" }), () => setState({ error: "Couldn't reach Steam" }));
    }, [appid, p?.steamid]);
    if (!total) return null;
    if (!p) return <section className={gp("card")}><span className={cl("label")}>🏆 Achievements · {total}</span><span className={cl("hint")}>Link your Steam profile in My Steam to see yours.</span></section>;
    if (!state) return <section className={gp("card")}><span className={cl("label")}>🏆 Your achievements</span><span className={cl("hint")}>Loading…</span></section>;
    if (state.error) return <section className={gp("card")}><span className={cl("label")}>🏆 Your achievements</span><span className={cl("hint")}>{state.error === "Your game details are private" ? "Your game details are private — in Steam's privacy settings, set Game details to Public." : state.error}</span></section>;
    const list = state.list!;
    const got = list.filter(a => a.unlocked).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const left = list.filter(a => !a.unlocked);
    const shown = show === "got" ? got : show === "left" ? left : [...got, ...left];
    const pct = list.length ? Math.round(got.length / list.length * 100) : 0;
    return (
        <section className={gp("card")}>
            <div className={gp("ach-head")}>
                <span className={cl("label")}>🏆 Your achievements</span>
                <span className={cl("spacer")} />
                <div className={cl("seg")}>
                    {([["all", "All"], ["got", `Unlocked · ${got.length}`], ["left", `Locked · ${left.length}`]] as const).map(([v, l]) => (
                        <button key={v} type="button" className={classes(cl("seg-btn"), show === v && cl("seg-on"))} onClick={() => setShow(v)}>{l}</button>
                    ))}
                </div>
            </div>
            <div className={gp("rev-head")}><b>{got.length} / {list.length}</b><span>{pct === 100 ? "Every one — perfect game! 🎉" : `${pct}% done`}</span></div>
            <div className={gp("rev-bar")}><i style={{ width: `${pct}%` }} /></div>
            <div className={gp("ach-grid")}>
                {shown.map(a => (
                    <div key={a.key} className={classes(gp("ach"), !a.unlocked && gp("ach-locked"))}>
                        <img src={a.unlocked ? a.icon : a.iconLocked} alt="" loading="lazy" />
                        <span className={gp("ach-text")}>
                            <b>{a.hidden && !a.unlocked ? "Hidden achievement" : a.name}</b>
                            <small>{a.hidden && !a.unlocked ? "Keep playing to find out" : a.description}</small>
                            {a.unlocked && a.at && <small className={gp("ach-when")}>Unlocked {new Date(a.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</small>}
                        </span>
                    </div>
                ))}
            </div>
        </section>
    );
}

function Dlc({ ids }: { ids: number[]; }) {
    useSteam();
    const [items, setItems] = useState<SteamItem[] | null>(null);
    useEffect(() => { native().steamItems(ids.slice(0, 30), opts.country).then((r: any) => setItems(r?.ok ? r.items.filter((i: SteamItem) => i.name) : []), () => setItems([])); }, [ids.join()]);
    if (!ids.length) return null;
    return (
        <section className={gp("card")}>
            <span className={cl("label")}>DLC · {ids.length}</span>
            {!items ? <span className={cl("hint")}>Loading…</span> : (
                <div className={gp("dlc")}>
                    {items.map(i => {
                        const on = isWatched(i.appid);
                        return (
                            <div key={i.appid} className={gp("dlc-row")}>
                                {i.header && <img src={i.header} alt="" loading="lazy" />}
                                <span className={gp("dlc-text")}>
                                    <b>{i.name}</b>
                                    <small>{i.free ? "Free" : i.price ? <>{i.price.pct > 0 && <span className={gp("off")}>−{i.price.pct}%</span>} {i.price.formatted}</> : "—"}</small>
                                </span>
                                <button type="button" className={classes(cl("btn"), !on && cl("primary"))} onClick={() => { if (on) unwatch(i.appid); else if (watch(i.appid, i.name, i.header)) void checkGames([i.appid]); }}>{on ? "✓ Watching" : "＋ Watch"}</button>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

function GameModal({ modalProps, appid }: { modalProps: RenderModalProps; appid: number; }) {
    useSteam();
    const accent = windowAccent("games");
    const [d, setD] = useState<SteamDetails | null>(null);
    const [reviews, setReviews] = useState<SteamReviewSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        native().steamAppDetails(appid, opts.country).then((r: any) => r?.ok ? setD(r.details) : setError(r?.error ?? "Couldn't load the game"), () => setError("Couldn't reach Steam"));
        native().steamReviews(appid).then((r: any) => r?.ok && setReviews(r.reviews), () => { });
    }, [appid]);
    const watching = isWatched(appid);

    return (
        <Window {...modalProps} size="xl" title={d?.name ?? "Steam game"} subtitle={d ? [d.developers[0], d.release].filter(Boolean).join(" · ") : "Loading from Steam…"}>
            <div className={classes("vc-tool-wrap", "vc-steam-wrap", gp("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                {error ? <div className={cl("error")}>{error}</div> : !d ? <div className={cl("empty")}><span className={cl("empty-icon")}>⏳</span>Loading…</div> : (
                    <>
                        <section className={gp("hero")} style={d.background ? { backgroundImage: `linear-gradient(180deg, hsl(0 0% 0% / 0.15), hsl(220 25% 8% / 0.92)), url("${d.background}")` } : undefined}>
                            <img className={gp("header")} src={d.header} alt="" />
                            <div className={gp("hero-text")}>
                                <b>{d.name}</b>
                                <span className={gp("about")}>{d.about}</span>
                                <div className={gp("price")}>
                                    {d.comingSoon ? <span className={gp("soon")}>Coming {d.release ?? "soon"}</span>
                                        : d.free ? <span className={gp("now")}>Free to play</span>
                                            : d.price ? <>
                                                {d.price.pct > 0 && <span className={gp("off")}>−{d.price.pct}%</span>}
                                                {d.price.initial && <s>{d.price.initial}</s>}
                                                <span className={gp("now")}>{d.price.final}</span>
                                            </> : null}
                                </div>
                                <div className={cl("row")}>
                                    <button type="button" className={classes(cl("btn"), !watching && cl("primary"))} onClick={() => {
                                        if (watching) { unwatch(appid); showToast(`Stopped watching ${d.name}`, "message"); } else if (watch(appid, d.name, d.header)) { void checkGames([appid]); showToast(`Watching ${d.name}`, "success"); }
                                    }}>{watching ? "✓ Watching" : "＋ Watch"}</button>
                                    <button type="button" className={cl("btn")} onClick={() => open(storeUrl(appid))}>Open in Steam</button>
                                    {d.website && <button type="button" className={cl("btn")} onClick={() => open(d.website!)}>Website</button>}
                                </div>
                            </div>
                        </section>

                        <MediaViewer d={d} />

                        <div className={gp("cols")}>
                            <div className={gp("col")}>
                                <section className={gp("card")}>
                                    <span className={cl("label")}>Details</span>
                                    <dl className={gp("facts")}>
                                        {d.release && <><dt>Release</dt><dd>{d.release}</dd></>}
                                        {d.developers.length > 0 && <><dt>Developer</dt><dd>{d.developers.join(", ")}</dd></>}
                                        {d.publishers.length > 0 && <><dt>Publisher</dt><dd>{d.publishers.join(", ")}</dd></>}
                                        {d.platforms.length > 0 && <><dt>Plays on</dt><dd>{d.platforms.join(" · ")}</dd></>}
                                        {d.metacritic && <><dt>Metacritic</dt><dd><button type="button" className={gp("meta")} onClick={() => open(d.metacritic!.url)}>{d.metacritic.score}</button></dd></>}
                                    </dl>
                                    {d.genres.length > 0 && <div className={cl("chips")}>{d.genres.map(g => <span key={g} className={cl("chip")}>{g}</span>)}</div>}
                                </section>
                                {reviews && <Reviews r={reviews} />}
                                {(d.requirements.minimum.length > 0 || d.requirements.recommended.length > 0) && (
                                    <section className={gp("card")}>
                                        <span className={cl("label")}>What it needs (PC)</span>
                                        <div className={gp("reqs")}>
                                            {[["Minimum", d.requirements.minimum], ["Recommended", d.requirements.recommended]].filter(([, l]) => (l as string[]).length).map(([t, l]) => (
                                                <div key={t as string}>
                                                    <b>{t as string}</b>
                                                    <ul>{(l as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul>
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                )}
                            </div>
                            <div className={gp("col")}>
                                <Achievements appid={appid} total={d.achievements} />
                                <Dlc ids={d.dlc} />
                            </div>
                        </div>
                    </>
                )}
            </div>
        </Window>
    );
}

export const openGame = (appid: number) => openModal(props => <GameModal modalProps={props} appid={appid} />);
