/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { openImageModal } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, showToast, useEffect, useMemo, useReducer, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { useHubFrame } from "../games/hub";
import { openGames } from "../games/Panel";
import { checkGames, isUpdate, onStatus, opts, runCheck, status } from "./check";
import { openGame } from "./GamePage";
import type { SteamFriend, SteamNews, SteamSearchHit } from "./native";
import { NoteBlock, parseNotes } from "./notes";
import { clearFeed, FeedItem, FeedKind, game, games, isWatched, markSeen, setProfile, unseen, unwatch, updateGame, useSteam, watch, Watched } from "./store";

const cl = classNameFactory("vc-tool-");
const sw = classNameFactory("vc-steam-");
const native = () => VencordNative.pluginHelpers.Sonata as any;

const CURRENCY: Record<string, string> = { US: "USD", GB: "GBP", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", CA: "CAD", AU: "AUD", NZ: "NZD", BR: "BRL", MX: "MXN", PL: "PLN", IN: "INR", JP: "JPY" };
const money = (cents: number) => {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY[opts.country] ?? "USD" }).format(cents / 100); } catch { return (cents / 100).toFixed(2); }
};

function ago(t: number) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
function until(t: number) {
    const m = Math.round((t - Date.now()) / 60000);
    if (m <= 1) return "any moment";
    if (m < 60) return `in ${m} min`;
    if (m < 1440) return `in ${Math.round(m / 60)} h`;
    return `in ${Math.round(m / 1440)} d`;
}
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
const storeUrl = (appid: number) => `https://store.steampowered.com/app/${appid}`;
const open = (url: string) => window.open(url, "_blank", "noopener");
const headerOf = (appid: number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;

function useStatus() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => onStatus(bump), []);
    useEffect(() => { const t = setInterval(bump, 30_000); return () => clearInterval(t); }, []);
    return status;
}

function Cover({ src, appid, className }: { src?: string; appid: number; className?: string; }) {
    const [broken, setBroken] = useState(false);
    const url = src ?? headerOf(appid);
    return broken ? <span className={classes(className, sw("cover-none"))} aria-hidden>🎮</span> : <img className={className} src={url} alt="" onError={() => setBroken(true)} />;
}

/* ── Patch notes reader ── */

// Steam's and YouTube's pictures load straight away. Pictures a developer hosts
// on their own site are fetched by Sonata (Discord's window can't load them).
const DIRECT = /(^|\.)(steamstatic\.com|ytimg\.com|youtube\.com)$/i;
const fetched = new Map<string, Promise<string | null>>();
function usePicture(src: string | undefined) {
    const direct = (() => { try { return !src || DIRECT.test(new URL(src).hostname); } catch { return true; } })();
    const [url, setUrl] = useState<string | null | undefined>(direct ? src : undefined);
    useEffect(() => {
        if (direct || !src) { setUrl(src); return; }
        let live = true;
        if (!fetched.has(src)) fetched.set(src, native().steamNoteImage(src).then((r: any) => r?.ok ? r.data as string : null, () => null));
        fetched.get(src)!.then(u => { if (live) setUrl(u); });
        return () => { live = false; };
    }, [src]);
    return url;
}

function Thumb({ src }: { src?: string; }) {
    const url = usePicture(src);
    const [broken, setBroken] = useState(false);
    return url && !broken ? <img className={sw("reader-thumb")} src={url} alt="" loading="lazy" onError={() => setBroken(true)} /> : null;
}

function NoteImage({ src, href }: { src: string; href?: string; }) {
    const url = usePicture(src);
    const [broken, setBroken] = useState(false);
    if (broken || url === null) return href ? <button type="button" className={sw("media-link")} onClick={() => open(href)}>🔗 Open link</button> : null;
    if (url === undefined) return <figure className={sw("media")}><span className={sw("media-wait")}>Loading picture…</span></figure>;
    return (
        <figure className={sw("media")}>
            <img className={sw("media-img")} src={url} alt="" loading="lazy" title="Click to see it bigger" onError={() => setBroken(true)}
                onClick={() => openImageModal({ url })} />
            {href && <button type="button" className={sw("media-link")} onClick={() => open(href)}>🔗 Open link</button>}
        </figure>
    );
}

function NoteClip({ b }: { b: Extract<NoteBlock, { kind: "clip"; }>; }) {
    const [broken, setBroken] = useState(false);
    if (broken) return b.poster ? <NoteImage src={b.poster} /> : null;
    return (
        <figure className={sw("media")}>
            <video className={sw("media-img")} autoPlay loop muted playsInline poster={b.poster} onError={() => setBroken(true)}>
                {b.webm && <source src={b.webm} type="video/webm" />}
                {b.mp4 && <source src={b.mp4} type="video/mp4" />}
            </video>
        </figure>
    );
}

function NoteVideo({ id }: { id: string; }) {
    return (
        <figure className={sw("media")}>
            <button type="button" className={sw("yt")} title="Watch on YouTube" onClick={() => open(`https://www.youtube.com/watch?v=${id}`)}>
                <img className={sw("media-img")} src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
                <span className={sw("yt-play")} aria-hidden>▶</span>
                <span className={sw("yt-label")}>Watch on YouTube</span>
            </button>
        </figure>
    );
}

function NewsBody({ text }: { text: string; }) {
    const blocks = useMemo(() => parseNotes(text), [text]);
    if (!blocks.length) return <div className={cl("empty")}><span className={cl("empty-icon")}>📄</span>Nothing to show here — open it on Steam to see it.</div>;
    return (
        <div className={sw("notes")}>
            {blocks.map((b, i) => b.kind === "h" ? <h4 key={i}>{b.text}</h4>
                : b.kind === "li" ? <div key={i} className={sw("notes-li")}>{b.text}</div>
                    : b.kind === "p" ? <p key={i}>{b.text}</p>
                        : b.kind === "img" ? <NoteImage key={i} src={b.src} href={b.href} />
                            : b.kind === "clip" ? <NoteClip key={i} b={b} />
                                : b.kind === "yt" ? <NoteVideo key={i} id={b.id} /> : null)}
        </div>
    );
}

/** The first picture in an announcement, for its thumbnail in the list. */
const firstPicture = (n: SteamNews) => {
    for (const b of parseNotes(n.contents)) {
        if (b.kind === "img") return b.src;
        if (b.kind === "clip" && b.poster) return b.poster;
        if (b.kind === "yt") return `https://i.ytimg.com/vi/${b.id}/hqdefault.jpg`;
    }
};

function NewsModal({ modalProps, appid, gid }: { modalProps: RenderModalProps; appid: number; gid?: string; }) {
    const g = game(appid);
    const accent = windowAccent("steamWatcher");
    const [news, setNews] = useState<SteamNews[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pick, setPick] = useState<string | undefined>(gid);
    useEffect(() => {
        native().steamNews(appid, 10).then((r: any) => r?.ok ? setNews(r.news) : setError(r?.error ?? "Couldn't load the news"), () => setError("Couldn't load the news"));
    }, [appid]);
    const item = news?.find(n => n.gid === pick) ?? news?.[0];
    return (
        <Window {...modalProps} size="xl" title={g?.name ?? "Steam news"} subtitle="Updates and announcements from the developer">
            <div className={classes("vc-tool-wrap", sw("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                {error ? <div className={cl("error")}>{error}</div> : !news ? <div className={cl("empty")}><span className={cl("empty-icon")}>⏳</span>Loading…</div> : !item ? (
                    <div className={cl("empty")}><span className={cl("empty-icon")}>📭</span>No announcements yet.</div>
                ) : (
                    <>
                        <ToolHero icon={<Cover src={g?.header} appid={appid} className={sw("hero-cover")} />} kicker={`${isUpdate(item) ? "🛠️ Update" : "📰 News"} · ${day(item.date)}`} title={item.title}
                            sub={g?.name}>
                            <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={() => open(item.url)}>Open on Steam</button>
                        </ToolHero>
                        <div className={sw("reader")}>
                            <nav className={sw("reader-list")}>
                                {news.map(n => (
                                    <button key={n.gid} type="button" className={classes(sw("reader-item"), n.gid === item.gid && sw("reader-on"))} onClick={() => setPick(n.gid)}>
                                        <Thumb src={firstPicture(n)} />
                                        <b>{isUpdate(n) ? "🛠️" : "📰"} {n.title}</b>
                                        <span>{ago(n.date)}</span>
                                    </button>
                                ))}
                            </nav>
                            <div className={sw("reader-body")}><NewsBody text={item.contents} /></div>
                        </div>
                    </>
                )}
            </div>
        </Window>
    );
}

export const openNews = (appid: number, gid?: string) => openModal(props => <NewsModal modalProps={props} appid={appid} gid={gid} />);

/* ── Watchlist ── */

function AddBar() {
    const [q, setQ] = useState("");
    const [hits, setHits] = useState<SteamSearchHit[] | null>(null);
    const [busy, setBusy] = useState(false);
    const direct = q.match(/store\.steampowered\.com\/app\/(\d+)/i)?.[1] ?? q.match(/steamcommunity\.com\/app\/(\d+)/i)?.[1] ?? (/^\d{2,8}$/.test(q.trim()) ? q.trim() : null);

    useEffect(() => {
        if (!q.trim() || direct) { setHits(null); return; }
        setBusy(true);
        const t = setTimeout(() => {
            native().steamSearch(q, opts.country).then((r: any) => { setHits(r?.ok ? r.hits : []); setBusy(false); }, () => { setHits([]); setBusy(false); });
        }, 400);
        return () => clearTimeout(t);
    }, [q]);

    const add = (appid: number, name = "") => {
        if (!watch(appid, name)) { showToast("Already watching that one", "message"); return; }
        showToast(`Watching ${name || "that game"} — you'll hear about sales and updates`, "success");
        void checkGames([appid]);
    };

    return (
        <div className={sw("add")}>
            <div className={sw("add-bar")}>
                <span className={sw("add-icon")} aria-hidden>🔎</span>
                <input className={classes(cl("input"), sw("add-input"))} value={q} placeholder="Search Steam, or paste a store link…" onChange={e => setQ(e.currentTarget.value)} />
                {direct && <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={() => { add(Number(direct)); setQ(""); }}>＋ Watch #{direct}</button>}
            </div>
            {(hits || busy) && !direct && (
                <div className={sw("hits")}>
                    {busy && !hits?.length ? <span className={cl("hint")}>Searching Steam…</span> : !hits?.length ? <span className={cl("hint")}>Nothing found on Steam for “{q}”.</span> : hits.map(h => {
                        const on = isWatched(h.appid);
                        return (
                            <div key={h.appid} className={sw("hit")}>
                                <img className={sw("hit-img")} src={h.image} alt="" />
                                <button type="button" className={sw("hit-text")} title="See the game" onClick={() => openGame(h.appid)}><b>{h.name}</b><small>{h.price}</small></button>
                                <button type="button" className={classes(cl("btn"), !on && cl("primary"))} disabled={on} onClick={() => add(h.appid, h.name)}>{on ? "✓ Watching" : "＋ Watch"}</button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function TargetInput({ g }: { g: Watched; }) {
    const [v, setV] = useState(g.target != null ? (g.target / 100).toString() : "");
    const commit = () => {
        const n = Number(v.replace(/[^\d.,]/g, "").replace(",", "."));
        const cents = v.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
        updateGame(g.appid, x => { x.target = cents; x.targetHit = cents != null && !!x.price && x.price.final <= cents; });
        if (cents != null) showToast(`You'll be told when ${g.name} is ${money(cents)} or less`, "success");
    };
    return (
        <label className={classes(sw("target"), g.targetHit && sw("target-hit"))}>
            <span>🎯 {g.targetHit ? "Price reached!" : "Tell me under"}</span>
            <input className={classes(cl("input"), sw("target-input"))} inputMode="decimal" value={v} placeholder="Any price"
                onChange={e => setV(e.currentTarget.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        </label>
    );
}

function GameCard({ g }: { g: Watched; }) {
    const [sure, setSure] = useState(false);
    useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 3000); return () => clearTimeout(t); }, [sure]);
    const p = g.price;
    const sale = !!p && p.pct > 0;
    const soon = g.release?.soon;
    return (
        <div className={classes(sw("card"), sale && sw("card-sale"), g.targetHit && sw("card-hit"))}>
            <button type="button" className={sw("cover")} title="Trailers, screenshots, achievements and more" onClick={() => openGame(g.appid)}>
                <Cover src={g.header} appid={g.appid} className={sw("cover-img")} />
                {sale && <span className={sw("badge")}>−{p!.pct}%</span>}
                {soon && <span className={classes(sw("badge"), sw("badge-soon"))}>Coming soon</span>}
                {g.freeWeekend && <span className={classes(sw("badge"), sw("badge-free"))}>Free to play now</span>}
            </button>
            <div className={sw("body")}>
                <button type="button" className={sw("name")} title={g.name} onClick={() => openGame(g.appid)}>{g.name}</button>
                <div className={sw("price-row")}>
                    {g.free && !p ? <span className={sw("price")}>Free to play</span>
                        : p ? <>
                            <span className={classes(sw("price"), sale && sw("price-sale"))}>{p.pct === 100 ? "Free to keep" : p.formatted}</span>
                            {sale && p.formattedInitial && <s className={sw("was")}>{p.formattedInitial}</s>}
                        </>
                            : <span className={sw("price-none")}>{soon ? (g.release?.date ? `Out ${day(g.release.date)}` : g.release?.text ?? "Coming soon") : g.lastCheck ? "No price" : "Checking…"}</span>}
                </div>
                <div className={sw("meta")}>
                    {sale && p!.ends && <span className={sw("chip-hot")}>⏳ ends {day(p!.ends)}</span>}
                    {soon && p && g.release?.date && <span className={sw("chip")}>📅 {day(g.release.date)}</span>}
                    {g.release?.early && !soon && <span className={sw("chip")}>Early Access</span>}
                    {g.review && <span className={sw("chip")} title={`${g.review.pct}% of ${g.review.count.toLocaleString()} reviews are positive`}>👍 {g.review.label}</span>}
                </div>
                {g.lastNews && (
                    <button type="button" className={sw("news")} onClick={() => openNews(g.appid, g.lastNews!.gid)} title="Read it">
                        <span>{g.lastNews.update ? "🛠️" : "📰"}</span><span className={sw("news-title")}>{g.lastNews.title}</span><small>{ago(g.lastNews.date)}</small>
                    </button>
                )}
                {g.error && <span className={sw("error")}>⚠ {g.error}</span>}
                <div className={sw("foot")}>
                    <TargetInput g={g} />
                    {sure
                        ? <button type="button" className={classes(cl("btn"), sw("x-sure"))} onClick={() => unwatch(g.appid)}>Remove</button>
                        : <button type="button" className={sw("x")} title="Stop watching" aria-label="Stop watching" onClick={() => setSure(true)}>✕</button>}
                </div>
            </div>
        </div>
    );
}

type Sort = "added" | "discount" | "price" | "release";

function WatchTab({ list }: { list: Watched[]; }) {
    const [sort, setSort] = useState<Sort>("added");
    const sorted = [...list].sort((a, b) =>
        sort === "discount" ? (b.price?.pct ?? 0) - (a.price?.pct ?? 0)
            : sort === "price" ? (a.price?.final ?? (a.free ? 0 : 1e12)) - (b.price?.final ?? (b.free ? 0 : 1e12))
                : sort === "release" ? (Number(!!b.release?.soon) - Number(!!a.release?.soon)) || ((a.release?.date ?? 9e15) - (b.release?.date ?? 9e15))
                    : b.addedAt - a.addedAt);
    return (
        <>
            <AddBar />
            {list.length > 1 && (
                <div className={cl("chips")}>
                    {([["added", "Newest added"], ["discount", "Biggest discount"], ["price", "Cheapest"], ["release", "Coming soon first"]] as const).map(([id, label]) => (
                        <button key={id} type="button" className={classes(cl("chip"), sort === id && cl("chip-on"))} onClick={() => setSort(id)}>{label}</button>
                    ))}
                </div>
            )}
            {list.length ? (
                <div className={sw("grid")}>{sorted.map(g => <GameCard key={g.appid} g={g} />)}</div>
            ) : (
                <div className={cl("empty")}><span className={cl("empty-icon")}>🎮</span>No games yet. Search above, paste a store link, or link your Steam profile to add your wishlist.</div>
            )}
        </>
    );
}

/* ── Activity ── */

const KIND: Record<FeedKind, { icon: string; color: string; }> = {
    sale: { icon: "🏷️", color: "#ffb020" }, target: { icon: "🎯", color: "#3ddc84" }, update: { icon: "🛠️", color: "#66c0f4" }, news: { icon: "📰", color: "#8f98a0" },
    release: { icon: "🚀", color: "#c26bff" }, date: { icon: "📅", color: "#7c5cff" }, free: { icon: "🎁", color: "#ff5c6c" }, freeWeekend: { icon: "🎮", color: "#ff6fae" },
};
const FILTERS: { id: string; label: string; kinds: FeedKind[] | null; }[] = [
    { id: "all", label: "Everything", kinds: null },
    { id: "sales", label: "🏷️ Sales", kinds: ["sale", "target"] },
    { id: "updates", label: "🛠️ Updates", kinds: ["update", "news"] },
    { id: "releases", label: "🚀 Releases", kinds: ["release", "date"] },
    { id: "free", label: "🎁 Free", kinds: ["free", "freeWeekend"] },
];

function ActivityTab({ items }: { items: FeedItem[]; }) {
    const [filter, setFilter] = useState("all");
    const [sure, setSure] = useState(false);
    const f = FILTERS.find(x => x.id === filter)!;
    const shown = f.kinds ? items.filter(i => f.kinds!.includes(i.kind)) : items;
    return (
        <>
            <div className={sw("row")}>
                <div className={cl("chips")}>
                    {FILTERS.map(x => (
                        <button key={x.id} type="button" className={classes(cl("chip"), filter === x.id && cl("chip-on"))} onClick={() => setFilter(x.id)}>
                            {x.label} <span className={sw("count")}>{x.kinds ? items.filter(i => x.kinds!.includes(i.kind)).length : items.length}</span>
                        </button>
                    ))}
                </div>
                <span className={cl("spacer")} />
                {items.length > 0 && <button type="button" className={cl("link")} onMouseLeave={() => setSure(false)} onClick={() => { if (sure) { clearFeed(); setSure(false); } else setSure(true); }}>{sure ? "Sure? Click to clear" : "Clear"}</button>}
            </div>
            {shown.length ? (
                <div className={sw("feed")}>
                    {shown.map(i => (
                        <button key={i.id} type="button" className={sw("event")} style={{ "--k": KIND[i.kind].color } as React.CSSProperties}
                            onClick={() => i.newsGid ? openNews(i.appid, i.newsGid) : openGame(i.appid)}>
                            <span className={sw("event-icon")} aria-hidden>{KIND[i.kind].icon}</span>
                            <Cover src={game(i.appid)?.header} appid={i.appid} className={sw("event-cover")} />
                            <span className={sw("event-text")}>
                                <b>{i.title.replace(/^\S+\s/, "")}</b>
                                {i.body && <small>{i.body}</small>}
                            </span>
                            <span className={sw("event-time")}>{ago(i.t)}</span>
                        </button>
                    ))}
                </div>
            ) : (
                <div className={cl("empty")}><span className={cl("empty-icon")}>🔔</span>{items.length ? "Nothing of that kind yet." : "Sales, updates, releases and free games for what you watch show up here."}</div>
            )}
        </>
    );
}

/* ── My Steam profile ── */

function ProfileTab() {
    const { profile: p } = useSteam();
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sure, setSure] = useState(false);

    const link = async (raw: string) => {
        setBusy("link"); setError(null);
        const r = await native().steamProfile(raw).catch(() => null);
        setBusy(null);
        if (!r?.ok) { setError(r?.error ?? "Couldn't reach Steam"); return; }
        setProfile({ ...r.profile, input: raw, checkedAt: Date.now() });
        setInput("");
    };

    const importWishlist = async () => {
        if (!p) return;
        setBusy("wish"); setError(null);
        const r = await native().steamWishlist(p.steamid).catch(() => null);
        if (!r?.ok) { setBusy(null); setError(r?.error ?? "Couldn't load your wishlist"); return; }
        const fresh = (r.appids as number[]).filter(id => !isWatched(id));
        if (!r.appids.length) { setBusy(null); setError("Your wishlist is empty, or private — set Game details to Public in Steam's privacy settings."); return; }
        for (const id of [...fresh].reverse()) watch(id);
        showToast(fresh.length ? `Added ${fresh.length} game${fresh.length === 1 ? "" : "s"} from your wishlist` : "Everything on your wishlist is already watched", "success");
        if (fresh.length) await checkGames(fresh);
        setBusy(null);
    };

    if (!p) {
        return (
            <div className={sw("link-card")}>
                <span className={sw("link-icon")} aria-hidden>🔗</span>
                <b>Link your Steam profile</b>
                <span className={cl("hint")}>See your profile here, watch the games you've been playing, and add your whole wishlist in one click. Only public info is read — no login, no password.</span>
                <div className={sw("link-bar")}>
                    <input className={classes(cl("input"), cl("grow"))} value={input} placeholder="steamcommunity.com/id/yourname  ·  or your 17-digit Steam ID" onChange={e => setInput(e.currentTarget.value)}
                        onKeyDown={e => { if (e.key === "Enter" && input.trim()) void link(input); }} />
                    <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={!input.trim() || !!busy} onClick={() => void link(input)}>{busy ? "Looking…" : "Link"}</button>
                </div>
                {error && <div className={cl("error")}>{error}</div>}
                <span className={cl("hint")}>Find it in Steam: click your name → Profile, then copy the address.</span>
            </div>
        );
    }

    const state = /^in-game/i.test(p.stateMessage) ? "ingame" : p.state === "online" ? "online" : "offline";
    const isPublic = p.privacy === "public";

    return (
        <>
            <div className={classes(sw("profile"), sw(`profile-${state}`))}>
                <img className={sw("avatar")} src={p.avatar} alt="" />
                <div className={sw("profile-text")}>
                    <span className={sw("profile-state")}>{p.stateMessage.replace(/\n/g, " · ") || state}</span>
                    <b className={sw("profile-name")}>{p.name}</b>
                    <span className={sw("profile-meta")}>
                        {p.memberSince && <span>🗓️ Since {p.memberSince}</span>}
                        {p.location && <span>📍 {p.location}</span>}
                        {!isPublic && <span>🔒 Profile isn't public</span>}
                    </span>
                    {p.summary && <span className={sw("profile-summary")}>{p.summary}</span>}
                </div>
                {p.level != null && <div className={sw("level")}><b>{p.level}</b><span>level</span></div>}
            </div>

            <div className={sw("row")}>
                <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={!!busy} onClick={() => void importWishlist()}>{busy === "wish" ? "Adding your wishlist…" : "❤️ Watch my wishlist"}</button>
                <button type="button" className={cl("btn")} disabled={!!busy} onClick={() => void link(p.input)}>{busy === "link" ? "Refreshing…" : "↻ Refresh"}</button>
                <button type="button" className={cl("btn")} onClick={() => open(p.url)}>Open on Steam</button>
                <span className={cl("spacer")} />
                <span className={cl("hint")}>Updated {ago(p.checkedAt)}</span>
                {sure
                    ? <button type="button" className={classes(cl("btn"), sw("x-sure"))} onClick={() => { setProfile(undefined); setSure(false); }}>Unlink</button>
                    : <button type="button" className={cl("link")} onClick={() => setSure(true)}>Unlink</button>}
            </div>
            {error && <div className={cl("error")}>{error}</div>}

            <section className={sw("section")}>
                <span className={cl("label")}>Played lately</span>
                {p.recent.length ? (
                    <div className={sw("recent")}>
                        {p.recent.map(r => {
                            const on = isWatched(r.appid);
                            return (
                                <div key={r.appid} className={sw("recent-card")}>
                                    <Cover appid={r.appid} className={sw("recent-cover")} />
                                    <button type="button" className={sw("recent-text")} title="See the game and your achievements" onClick={() => openGame(r.appid)}>
                                        <b>{r.name}</b>
                                        <small>{[r.hours, r.last].filter(Boolean).join(" · ")} · 🏆</small>
                                    </button>
                                    <button type="button" className={classes(cl("btn"), !on && cl("primary"))} disabled={on}
                                        onClick={() => { if (watch(r.appid, r.name)) void checkGames([r.appid]); }}>{on ? "✓ Watching" : "＋ Watch"}</button>
                                </div>
                            );
                        })}
                    </div>
                ) : <span className={cl("hint")}>{isPublic ? "Nothing played in the last two weeks." : "Steam only shows this when your profile's game details are public."}</span>}
            </section>
        </>
    );
}

/* ── Friends ── */

// Kept for a few minutes, so switching tabs doesn't ask Steam again.
let friendCache: { steamid: string; at: number; friends: SteamFriend[]; private: boolean; } | null = null;
const STATE: Record<SteamFriend["state"], string> = { "in-game": "Playing", online: "Online", offline: "Offline" };

async function watchByName(name: string) {
    const r = await native().steamSearch(name, opts.country).catch(() => null);
    const hits: SteamSearchHit[] = r?.ok ? r.hits : [];
    const hit = hits.find(h => h.name.toLowerCase() === name.toLowerCase()) ?? hits[0];
    if (!hit) { showToast(`Couldn't find ${name} on the Steam store`, "failure"); return; }
    if (!watch(hit.appid, hit.name)) { showToast(`Already watching ${hit.name}`, "message"); return; }
    showToast(`Watching ${hit.name}`, "success");
    void checkGames([hit.appid]);
}

function FriendCard({ f }: { f: SteamFriend; }) {
    const [busy, setBusy] = useState(false);
    const watching = !!f.game && games().some(g => g.name.toLowerCase() === f.game!.toLowerCase());
    return (
        <div className={classes(sw("friend"), sw(`friend-${f.state}`))}>
            <img className={sw("friend-avatar")} src={f.avatar} alt="" loading="lazy" />
            <span className={sw("friend-text")}>
                <b title={f.name}>{f.name}</b>
                <small>{f.state === "in-game" ? <>🎮 {f.game}</> : STATE[f.state]}</small>
            </span>
            <span className={sw("friend-acts")}>
                {f.game && (
                    <button type="button" className={classes(cl("btn"), !watching && cl("primary"))} disabled={watching || busy} title={`Watch ${f.game} for sales and updates`}
                        onClick={async () => { setBusy(true); await watchByName(f.game!); setBusy(false); }}>{watching ? "✓ Watching" : busy ? "…" : "＋ Watch game"}</button>
                )}
                <button type="button" className={sw("friend-open")} title="Open their Steam profile" aria-label="Open their Steam profile" onClick={() => open(f.url)}>↗</button>
            </span>
        </div>
    );
}

function FriendsTab({ goProfile }: { goProfile(): void; }) {
    const { profile: p } = useSteam();
    const [data, setData] = useState(friendCache && friendCache.steamid === p?.steamid ? friendCache : null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [q, setQ] = useState("");
    const [showOffline, setShowOffline] = useState(false);

    const load = async () => {
        if (!p) return;
        setBusy(true); setError(null);
        const r = await native().steamFriends(p.steamid).catch(() => null);
        setBusy(false);
        if (!r?.ok) { setError(r?.error ?? "Couldn't reach Steam"); return; }
        friendCache = { steamid: p.steamid, at: Date.now(), friends: r.friends, private: r.private };
        setData(friendCache);
    };
    useEffect(() => { if (p && (!data || Date.now() - data.at > 5 * 60_000)) void load(); }, [p?.steamid]);

    if (!p) {
        return (
            <div className={sw("link-card")}>
                <span className={sw("link-icon")} aria-hidden>👥</span>
                <b>See your Steam friends</b>
                <span className={cl("hint")}>Link your Steam profile first — then you'll see who's online and what everyone's playing.</span>
                <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={goProfile}>Link my Steam profile</button>
            </div>
        );
    }

    const all = data?.friends ?? [];
    const needle = q.trim().toLowerCase();
    const match = (f: SteamFriend) => !needle || f.name.toLowerCase().includes(needle) || (f.game ?? "").toLowerCase().includes(needle);
    const playing = all.filter(f => f.state === "in-game" && match(f)).sort((a, b) => (a.game ?? "").localeCompare(b.game ?? "") || a.name.localeCompare(b.name));
    const online = all.filter(f => f.state === "online" && match(f));
    const offline = all.filter(f => f.state === "offline" && match(f));
    // What friends are playing most right now.
    const popular = Object.entries(all.filter(f => f.game).reduce<Record<string, number>>((m, f) => (m[f.game!] = (m[f.game!] ?? 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 4);

    return (
        <>
            <div className={sw("row")}>
                <div className={sw("friend-stats")}>
                    <span className={sw("stat")}><b>{all.filter(f => f.state === "in-game").length}</b> playing</span>
                    <span className={sw("stat")}><b>{all.filter(f => f.state === "online").length}</b> online</span>
                    <span className={sw("stat")}><b>{all.length}</b> friends</span>
                </div>
                <span className={cl("spacer")} />
                {data && <span className={cl("hint")}>Updated {ago(data.at)}</span>}
                <button type="button" className={cl("btn")} disabled={busy} onClick={() => void load()}>{busy ? "Checking…" : "↻ Refresh"}</button>
            </div>
            {error && <div className={cl("error")}>{error}</div>}

            {data?.private ? (
                <div className={cl("empty")}><span className={cl("empty-icon")}>🔒</span>Your friends list is private, so Steam doesn't show it. In Steam: your profile → Edit Profile → Privacy Settings → set Friends List to Public.</div>
            ) : !data ? (
                <div className={cl("empty")}><span className={cl("empty-icon")}>⏳</span>Loading your friends…</div>
            ) : (
                <>
                    {all.length > 8 && <input className={cl("input")} value={q} placeholder={`Search ${all.length} friends or games…`} onChange={e => setQ(e.currentTarget.value)} />}
                    {popular.length > 0 && !needle && (
                        <div className={sw("popular")}>
                            <span className={cl("label")}>Popular with friends right now</span>
                            <div className={cl("chips")}>
                                {popular.map(([name, n]) => (
                                    <button key={name} type="button" className={cl("chip")} title={`Watch ${name}`} onClick={() => void watchByName(name)}>
                                        🎮 {name} <span className={sw("count")}>{n}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className={sw("friends")}>
                        {playing.length > 0 && <><span className={classes(cl("label"), sw("group"))}>🎮 Playing · {playing.length}</span><div className={sw("friend-grid")}>{playing.map(f => <FriendCard key={f.steamid} f={f} />)}</div></>}
                        {online.length > 0 && <><span className={classes(cl("label"), sw("group"))}>🟢 Online · {online.length}</span><div className={sw("friend-grid")}>{online.map(f => <FriendCard key={f.steamid} f={f} />)}</div></>}
                        {offline.length > 0 && (
                            <>
                                <button type="button" className={classes(cl("label"), sw("group"), sw("group-toggle"))} onClick={() => setShowOffline(v => !v)}>{showOffline ? "▾" : "▸"} Offline · {offline.length}</button>
                                {(showOffline || !!needle) && <div className={sw("friend-grid")}>{offline.map(f => <FriendCard key={f.steamid} f={f} />)}</div>}
                            </>
                        )}
                        {!playing.length && !online.length && !offline.length && <div className={cl("empty")}><span className={cl("empty-icon")}>🔍</span>{all.length ? "Nobody matches that." : "No friends on this profile yet."}</div>}
                    </div>
                </>
            )}
        </>
    );
}

/* ── The window ── */

type Tab = "watch" | "activity" | "friends" | "profile";

let lastTab: Tab = "watch";

/** Steam, as a section of Game Hub: its content here, its tabs and status line on Game Hub's window. */
export function SteamSection({ start }: { start?: string; }) {
    const data = useSteam();
    const st = useStatus();
    const accent = windowAccent("steamWatcher");
    const [tab, setTabState] = useState<Tab>((start as Tab) ?? lastTab);
    const setTab = (t: Tab) => { lastTab = t; setTabState(t); };

    const list = data.games;
    const onSale = list.filter(g => (g.price?.pct ?? 0) > 0);
    const week = data.feed.filter(f => f.t > Date.now() - 7 * 86400_000);
    // Counted once when the window opens, so it doesn't vanish the moment you look.
    const [unread] = useState(unseen);
    useEffect(() => { if (tab === "activity") markSeen(); }, [tab]);
    const best = [...onSale].sort((a, b) => (b.price!.pct) - (a.price!.pct))[0];

    useHubFrame({
        tabs: [["watch", `Watchlist · ${list.length}`], ["activity", unread && tab !== "activity" ? `Activity · ${unread} new` : "Activity"], ["friends", "Friends"], ["profile", "My Steam"]],
        tab, onTab: id => setTab(id as Tab),
        status: [st.running ? "checking Steam…" : `watching ${list.length} game${list.length === 1 ? "" : "s"}`, st.lastRun ? `checked ${ago(st.lastRun)}` : "not checked yet"],
        statusRight: st.nextRun ? `next check ${until(st.nextRun)}` : undefined,
    });

    return (
            <div className={classes("vc-tool-wrap", sw("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon={best ? <Cover src={best.header} appid={best.appid} className={sw("hero-cover")} /> : "🎮"}
                    kicker={st.running ? "Checking Steam…" : best ? "Best deal right now" : "Steam Watcher"}
                    title={best ? `${best.name} · −${best.price!.pct}%` : list.length ? `Watching ${list.length} game${list.length === 1 ? "" : "s"}` : "Watch your first game"}
                    sub={st.error ? `⚠ ${st.error}` : best ? `${best.price!.formatted}${best.price!.formattedInitial ? ` (was ${best.price!.formattedInitial})` : ""}${best.price!.ends ? ` · ends ${day(best.price!.ends)}` : ""}`
                        : list.length ? `${st.lastRun ? `Checked ${ago(st.lastRun)}` : "Not checked yet"}${st.nextRun ? ` · next check ${until(st.nextRun)}` : ""}` : "You'll get a pop-up when it goes on sale, updates, releases or turns free."}
                    numbers={[{ value: onSale.length, label: "on sale" }, { value: week.filter(f => f.kind === "update").length, label: "updates this week" }]}>
                    <button type="button" className={cl("btn")} disabled={st.running || !list.length} onClick={() => void runCheck()}>{st.running ? "Checking…" : "↻ Check now"}</button>
                </ToolHero>

                {tab === "watch" ? <WatchTab list={list} /> : tab === "activity" ? <ActivityTab items={data.feed} /> : tab === "friends" ? <FriendsTab goProfile={() => setTab("profile")} /> : <ProfileTab />}
            </div>
    );
}

/** Opens the window; "news:<appid>:<gid>" opens those patch notes instead. */
export function openWatcher(start = "watch") {
    if (start.startsWith("news:")) {
        const [, appid, gid] = start.split(":");
        openNews(Number(appid), gid || undefined);
        return;
    }
    // Steam lives in Game Hub now.
    openGames({ platform: "steam", steamTab: ["watch", "activity", "friends", "profile"].includes(start) ? start : "watch" });
}
