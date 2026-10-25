/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, React, showToast, useEffect, useMemo, useState } from "@webpack/common";

import { Window } from "../_shared/Window";
import { FormGroup, FormRow, Toggle } from "../_shared/WindowParts";
import { hubContext, HubFrame } from "./hub";
import type { DealGame, DealStore, EpicGame, McServer, PassGame, ShopItem, StoreDeal } from "./native";
import { RobloxSection } from "./roblox/Panel";
import { historyLine, recordShop, returnsEvery, searchHistory, useHistory } from "./shopHistory";
import { SteamSection } from "./steam/Panel";
import { addServer, cache, checkServer, country, dealStores, isWatchingPrice, isWished, native, removeServer, renameServer, settings, setWished, unwatchPrice, useGames, watchPrice } from "./store";

const open = (url: string) => VencordNative.native.openExternal(url);
const money = (n: number) => `$${n.toFixed(2)}`;
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

type Platform = "steam" | "roblox" | "epic" | "pass" | "mc" | "deals";
const PLATFORMS: { id: Platform; name: string; sub: string; icon: string; tabs: [string, string][]; }[] = [
    // These two bring their own tabs (./steam, ./roblox).
    { id: "steam", name: "Steam", sub: "Sales, updates and friends", icon: "🚂", tabs: [] },
    { id: "roblox", name: "Roblox", sub: "Profiles, games and trades", icon: "🟥", tabs: [] },
    { id: "epic", name: "Epic & Fortnite", sub: "Free games and the item shop", icon: "🎁", tabs: [["free", "Free on Epic"], ["shop", "Fortnite shop"], ["history", "Shop history"]] },
    { id: "pass", name: "Xbox Game Pass", sub: "Added, coming and leaving", icon: "🎮", tabs: [["added", "Recently added"], ["coming", "Coming soon"], ["leaving", "Leaving soon"]] },
    { id: "mc", name: "Minecraft", sub: "Servers and players", icon: "⛏️", tabs: [["servers", "Servers"], ["players", "Players"]] },
    { id: "deals", name: "All stores", sub: "Prices everywhere at once", icon: "🏷️", tabs: [["search", "Find a game"], ["top", "Best deals"], ["watching", "Watching"]] },
];

/** Loads once per window (kept in the shared cache), with a Refresh. */
function useLoad<T>(key: string, load: () => Promise<{ ok: boolean; error?: string; } & T>, keep?: () => T | undefined, put?: (v: T) => void) {
    const [data, setData] = useState<T | undefined>(keep);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const run = async () => {
        setBusy(true); setError(null);
        const r = await load().catch(() => ({ ok: false, error: "Couldn't load that" } as any));
        if (r.ok) { setData(r); put?.(r); } else setError(r.error ?? "Couldn't load that");
        setBusy(false);
    };
    useEffect(() => { if (!data) void run(); }, [key]);
    return { data, error, busy, reload: run };
}

const Empty = ({ icon, children }: { icon: string; children: React.ReactNode; }) => <div className="vc-tool-empty"><span className="vc-tool-empty-icon">{icon}</span>{children}</div>;
const Problem = ({ text, retry }: { text: string; retry(): void; }) => <div className="vc-games-error">{text} <button type="button" className="vc-tool-link" onClick={retry}>Try again</button></div>;

/* ── Epic: free games ── */

/** Epic's pictures are huge (2560 px, ~3 MB): its image server sends a card-sized one instead. */
const epicImg = (url: string) => url.includes("cdn1.epicgames.com") ? `${url}?h=270&quality=medium&resize=1&w=480` : url;

function EpicFree() {
    const { data, error, busy, reload } = useLoad("epic", () => native().gamesEpicFree(country()), () => cache.epic && { games: cache.epic }, v => { cache.epic = (v as any).games; });
    const games = (data as any)?.games as EpicGame[] | undefined;
    if (error) return <Problem text={error} retry={reload} />;
    if (!games) return <Empty icon="🎁">{busy ? "Loading Epic's free games…" : "Nothing yet."}</Empty>;
    const now = games.filter(g => g.now), next = games.filter(g => !g.now);
    const card = (g: EpicGame) => (
        <div key={`${g.id}:${g.start}`} className={classes("vc-games-epic", g.now && "vc-games-epic-now")}>
            {g.image ? <img src={epicImg(g.image)} alt="" loading="lazy" /> : <div className="vc-games-noimg">🎁</div>}
            <div className="vc-games-epic-text">
                <b>{g.title}</b>
                <span>{g.now ? `Free until ${day(g.end)}` : `Free from ${day(g.start)} to ${day(g.end)}`}{g.price && g.price !== "0" ? ` · usually ${g.price}` : ""}</span>
                {g.seller && <small>{g.seller}</small>}
            </div>
            <button type="button" className={classes("vc-tool-btn", g.now && "vc-tool-primary")} onClick={() => open(g.url)}>{g.now ? "Get it on Epic ↗" : "See it ↗"}</button>
        </div>
    );
    return (
        <>
            <div className="vc-games-head"><b>Free now</b><span className="vc-tool-spacer" /><button type="button" className="vc-tool-link" disabled={busy} onClick={reload}>{busy ? "Loading…" : "Refresh"}</button></div>
            {now.length ? <div className="vc-games-epic-list">{now.map(card)}</div> : <Empty icon="🎁">No free games right now.</Empty>}
            {next.length > 0 && <>
                <div className="vc-games-head"><b>Coming next</b></div>
                <div className="vc-games-epic-list">{next.map(card)}</div>
            </>}
            <span className="vc-tool-hint">You claim them on Epic's site or launcher. {settings.store.epicAlerts ? "You'll get a notification when new ones go free." : "Turn on alerts in Game Hub's options to hear about new ones."}</span>
        </>
    );
}

/* ── Fortnite: item shop ── */

const RARITY: Record<string, string> = { common: "#8c8c8c", uncommon: "#5cb85c", rare: "#3d8bd6", epic: "#a24cd8", legendary: "#e08b2b", mythic: "#d4b13c", icon: "#2fbbd0", marvel: "#c4262e", dc: "#4a6fd9", starwars: "#8a8a8a", gaminglegends: "#6f4fd8", shadow: "#4a4a4a", slurp: "#28c9c4", dark: "#a8336f", frozen: "#8fc6e8", lava: "#d65a2e" };

function FortniteShop() {
    const g = useGames();
    const { data, error, busy, reload } = useLoad("shop", () => native().gamesFortniteShop(), () => cache.shop, v => { cache.shop = v as any; });
    const shop = data as { date: string; items: ShopItem[]; } | undefined;
    const [q, setQ] = useState("");
    const [section, setSection] = useState<string | null>(null);
    const [wishName, setWishName] = useState("");
    const sections = useMemo(() => [...new Set((shop?.items ?? []).map(i => i.section))], [shop]);
    useHistory();
    useEffect(() => { if (shop) void recordShop(shop.date, shop.items); }, [shop]);
    if (error) return <Problem text={error} retry={reload} />;
    if (!shop) return <Empty icon="🛒">{busy ? "Loading today's item shop…" : "Nothing yet."}</Empty>;
    const query = q.trim().toLowerCase();
    const items = shop.items.filter(i => (!section || i.section === section) && (!query || i.name.toLowerCase().includes(query) || i.type.toLowerCase().includes(query)));
    const inShop = new Set(shop.items.map(i => i.name.toLowerCase()));
    return (
        <>
            <FormGroup title={`Waiting for · ${g.wishlist.length}`}>
                <div className="vc-games-wish">
                    {g.wishlist.map(w => (
                        <span key={w} className={classes("vc-games-wish-chip", inShop.has(w) && "vc-games-wish-here")}>
                            {inShop.has(w) ? "● " : ""}{w}
                            <button type="button" aria-label={`Stop waiting for ${w}`} onClick={() => setWished(w, false)}>✕</button>
                        </span>
                    ))}
                    <input className="vc-tool-input vc-games-wish-add" value={wishName} placeholder="Add an item by name…" aria-label="Item name"
                        onChange={e => setWishName(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter" && wishName.trim()) { setWished(wishName, true); setWishName(""); } }} />
                </div>
                <span className="vc-tool-hint vc-games-pad">Star items below, or type a name. {settings.store.shopAlerts ? "You'll get a notification on days they're in the shop." : "Turn on shop alerts in Game Hub's options to be told."}</span>
            </FormGroup>
            <div className="vc-games-bar">
                <input className="vc-tool-input" value={q} placeholder={`Search ${shop.items.length} items`} aria-label="Search the shop" onChange={e => setQ(e.currentTarget.value)} />
                <button type="button" className="vc-tool-link" disabled={busy} onClick={reload}>{busy ? "Loading…" : "Refresh"}</button>
            </div>
            <div className="vc-tool-chips">
                <button type="button" className={classes("vc-tool-chip", !section && "vc-tool-chip-on")} onClick={() => setSection(null)}>All</button>
                {sections.map(s => <button key={s} type="button" className={classes("vc-tool-chip", section === s && "vc-tool-chip-on")} onClick={() => setSection(s)}>{s}</button>)}
            </div>
            <div className="vc-games-shop">
                {items.map(i => (
                    <div key={i.id} className="vc-games-item" style={{ "--rar": RARITY[i.rarity] ?? "#555" } as React.CSSProperties}>
                        {i.image ? <img src={i.image} alt="" loading="lazy" /> : <div className="vc-games-noimg">🛒</div>}
                        <button type="button" className={classes("vc-games-star", isWished(i.name) && "vc-games-star-on")} aria-label={isWished(i.name) ? "Stop waiting for it" : "Wait for it"} title={isWished(i.name) ? "Waiting for it" : "Tell me when it's back"}
                            onClick={() => setWished(i.name, !isWished(i.name))}>{isWished(i.name) ? "★" : "☆"}</button>
                        <b>{i.name}</b>
                        <small>{i.type}</small>
                        <span className="vc-games-vbucks">{i.price.toLocaleString()} V-Bucks{i.regular > i.price ? <s>{i.regular.toLocaleString()}</s> : null}</span>
                        {historyLine(i.name, shop.date) && <small className="vc-games-seen">{historyLine(i.name, shop.date)}</small>}
                    </div>
                ))}
            </div>
            {!items.length && <Empty icon="🔍">Nothing matches that.</Empty>}
        </>
    );
}

/* ── Fortnite shop history ── */

function ShopHistory() {
    const h = useHistory();
    const [q, setQ] = useState("");
    const results = searchHistory(q);
    const today = new Date().toISOString().slice(0, 10);
    const ago = (d: string) => { const n = Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000); return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`; };
    const count = Object.keys(h.items).length;
    return (
        <>
            <div className="vc-games-bar">
                <input className="vc-tool-input" value={q} autoFocus placeholder="When was it last in the shop? Type an item's name" aria-label="Search the shop history" onChange={e => setQ(e.currentTarget.value)} />
            </div>
            <span className="vc-tool-hint">{h.since ? `Game Hub has noted the shop every day it's been open since ${new Date(h.since).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} — ${count.toLocaleString()} items so far. Older visits aren't listed anywhere public, so they aren't here.` : "Game Hub notes the shop each day it looks at it. Open the Fortnite shop tab once to start."}</span>
            {q.trim().length >= 2 && !results.length && <Empty icon="🔍">Not seen in the shop yet{h.since ? " since Game Hub started watching" : ""}.</Empty>}
            {results.length > 0 && (
                <FormGroup>
                    {results.map(i => {
                        const every = returnsEvery(i);
                        return (
                            <div key={i.name} className="vc-games-hist" style={{ "--rar": RARITY[i.rarity ?? ""] ?? "#555" } as React.CSSProperties}>
                                {i.image ? <img src={i.image} alt="" loading="lazy" /> : <div className="vc-games-noimg">🛒</div>}
                                <span className="vc-games-hist-text"><b>{i.name}</b><small>{i.type}</small></span>
                                <span className="vc-games-hist-when"><b>Last: {ago(i.days.at(-1)!)}</b><small>{i.days.length} time{i.days.length === 1 ? "" : "s"}{every ? ` · back about every ${every} days` : ""}</small></span>
                            </div>
                        );
                    })}
                </FormGroup>
            )}
        </>
    );
}

/* ── Game Pass ── */

function GamePass({ list }: { list: "added" | "coming" | "leaving"; }) {
    const { data, error, busy, reload } = useLoad(list, () => native().gamesGamePass(list, country()), () => cache.pass[list] && { games: cache.pass[list] }, v => { cache.pass[list] = (v as any).games; });
    const games = (data as any)?.games as PassGame[] | undefined;
    if (error) return <Problem text={error} retry={reload} />;
    if (!games) return <Empty icon="🎮">{busy ? "Loading Game Pass…" : "Nothing yet."}</Empty>;
    return (
        <>
            <div className="vc-games-head"><b>{games.length} games</b><span className="vc-tool-spacer" /><button type="button" className="vc-tool-link" disabled={busy} onClick={reload}>{busy ? "Loading…" : "Refresh"}</button></div>
            {games.length ? (
                <div className="vc-games-posters">
                    {games.map(g => (
                        <button key={g.id} type="button" className="vc-games-poster" title={g.title} onClick={() => open(g.url)}>
                            {g.image ? <img src={`${g.image}?w=240`} alt="" loading="lazy" /> : <div className="vc-games-noimg">🎮</div>}
                            <b>{g.title}</b>
                            {g.publisher && <small>{g.publisher}</small>}
                        </button>
                    ))}
                </div>
            ) : <Empty icon="🎮">Nothing in this list right now.</Empty>}
        </>
    );
}

/* ── Minecraft ── */

function McServers() {
    const g = useGames();
    const [host, setHost] = useState("");
    const [live, setLive] = useState<Record<string, McServer | string>>({});
    const [naming, setNaming] = useState<{ host: string; text: string; } | null>(null);
    const refresh = async (h: string) => { const r = await checkServer(h); setLive(l => ({ ...l, [h]: r })); };
    useEffect(() => { g.servers.forEach(s => { if (!live[s.host]) void refresh(s.host); }); }, [g.servers.length]);
    const add = () => { const h = host.trim(); if (!h) return; addServer(h); setHost(""); void refresh(h.toLowerCase()); };
    return (
        <>
            <div className="vc-games-bar">
                <input className="vc-tool-input" value={host} placeholder="Server address, like mc.hypixel.net or play.example.com:25565" aria-label="Server address"
                    onChange={e => setHost(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!host.trim()} onClick={add}>Add server</button>
            </div>
            {!g.servers.length && <Empty icon="⛏️">Add a server to see if it's up and how many are playing.</Empty>}
            <div className="vc-games-servers">
                {g.servers.map(s => {
                    const info = live[s.host];
                    const srv = typeof info === "object" ? info : null;
                    return (
                        <div key={s.host} className="vc-games-server">
                            {srv?.icon || s.icon ? <img src={srv?.icon ?? s.icon} alt="" /> : <div className="vc-games-noimg">⛏️</div>}
                            <div className="vc-games-server-text">
                                {naming?.host === s.host
                                    ? <input className="vc-tool-input vc-games-name-edit" autoFocus value={naming.text} placeholder={s.host} aria-label="A name for this server"
                                        onChange={e => setNaming({ host: s.host, text: e.currentTarget.value })}
                                        onKeyDown={e => { if (e.key === "Enter") { renameServer(s.host, naming.text); setNaming(null); } if (e.key === "Escape") { e.stopPropagation(); setNaming(null); } }}
                                        onBlur={() => { renameServer(s.host, naming.text); setNaming(null); }} />
                                    : <b>{s.name ?? s.host}</b>}
                                <span><i className="vc-sw-status" style={{ background: !info ? "#4d4d4d" : srv?.online ? "#23a55a" : "#80848e" }} />
                                    {!info ? "Checking…" : typeof info === "string" ? info : srv!.online ? `${srv!.players.toLocaleString()} / ${srv!.max.toLocaleString()} playing${srv!.version ? ` · ${srv!.version}` : ""}` : "Offline"}</span>
                                {srv?.motd && <small>{srv.motd}</small>}
                                {srv?.names.length ? <small className="vc-games-names">{srv.names.join(", ")}</small> : null}
                            </div>
                            <div className="vc-games-server-tools">
                                <button type="button" className="vc-tool-icon" title="Check again" aria-label="Check again" onClick={() => { setLive(l => { const n = { ...l }; delete n[s.host]; return n; }); void refresh(s.host); }}>↻</button>
                                <button type="button" className="vc-tool-icon" title="Copy the address" aria-label="Copy the address" onClick={() => { void navigator.clipboard.writeText(s.host); showToast("Copied the address", "success"); }}>⧉</button>
                                <button type="button" className="vc-tool-icon" title="Name it" aria-label="Name it" onClick={() => setNaming({ host: s.host, text: s.name ?? "" })}>✎</button>
                                <button type="button" className="vc-tool-icon" title="Remove" aria-label="Remove" onClick={() => removeServer(s.host)}>✕</button>
                            </div>
                        </div>
                    );
                })}
            </div>
            {g.servers.length > 0 && (
                <FormGroup>
                    <FormRow label="Tell me when one goes offline" help="Checks your servers every 5 minutes while Discord is open.">
                        <Toggle value={!!settings.store.serverAlerts} label="Server alerts" onChange={v => { settings.store.serverAlerts = v; }} />
                    </FormRow>
                </FormGroup>
            )}
        </>
    );
}

function McPlayers() {
    const [name, setName] = useState("");
    const [found, setFound] = useState<{ id: string; name: string; } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const look = async () => {
        if (!name.trim()) return;
        setBusy(true); setError(null);
        const r = await native().gamesMcPlayer(name.trim()).catch(() => null);
        if (r?.ok) setFound({ id: r.id, name: r.name }); else { setFound(null); setError(r?.error ?? "Couldn't look that up"); }
        setBusy(false);
    };
    return (
        <>
            <div className="vc-games-bar">
                <input className="vc-tool-input" value={name} placeholder="Minecraft username" aria-label="Minecraft username" onChange={e => setName(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") void look(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || !name.trim()} onClick={look}>{busy ? "Looking…" : "Look up"}</button>
            </div>
            {error && <div className="vc-games-error">{error}</div>}
            {found ? (
                <div className="vc-games-player">
                    <img className="vc-games-player-body" src={`https://mc-heads.net/body/${found.id}/180`} alt={`${found.name}'s skin`} />
                    <div className="vc-games-player-text">
                        <div className="vc-games-player-name"><img src={`https://mc-heads.net/avatar/${found.id}/40`} alt="" /><b>{found.name}</b></div>
                        <small>UUID</small>
                        <code onClick={() => { void navigator.clipboard.writeText(found.id); showToast("Copied the UUID", "success"); }} title="Click to copy">{found.id}</code>
                        <div className="vc-tool-row">
                            <button type="button" className="vc-tool-btn" onClick={() => open(`https://mc-heads.net/skin/${found.id}`)}>Download skin ↗</button>
                            <button type="button" className="vc-tool-btn" onClick={() => open(`https://namemc.com/profile/${found.id}`)}>NameMC ↗</button>
                        </div>
                    </div>
                </div>
            ) : !error && <Empty icon="🧑">Type a username to see their skin and UUID.</Empty>}
        </>
    );
}

/* ── All stores (CheapShark) ── */

function StoreName({ id, stores }: { id: string; stores: Record<string, DealStore>; }) {
    const s = stores[id];
    return <span className="vc-games-store">{s?.icon && <img src={s.icon} alt="" />}{s?.name ?? `Store ${id}`}</span>;
}

function useStores() {
    const [stores, setStores] = useState<Record<string, DealStore>>(cache.stores ?? {});
    useEffect(() => { void dealStores().then(setStores); }, []);
    return stores;
}

const dealUrl = (dealId: string) => `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(dealId)}`;

function DealDetail({ game, onBack }: { game: { id: string; title: string; thumb?: string; }; onBack(): void; }) {
    useGames();
    const stores = useStores();
    const [d, setD] = useState<{ deals: StoreDeal[]; lowest?: { price: number; date: number; }; } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [target, setTarget] = useState("");
    useEffect(() => { void native().gamesDealGame(game.id).then((r: any) => r.ok ? setD(r) : setError(r.error)).catch(() => setError("Couldn't load prices")); }, [game.id]);
    const watching = isWatchingPrice(game.id);
    const best = d?.deals[0];
    return (
        <>
            <button type="button" className="vc-tool-link vc-games-back" onClick={onBack}>← Back to results</button>
            <div className="vc-games-deal-head">
                {game.thumb ? <img src={game.thumb} alt="" /> : <div className="vc-games-noimg">🏷️</div>}
                <div>
                    <b>{game.title}</b>
                    <span>{best ? `Cheapest now ${money(best.price)} on ${stores[best.store]?.name ?? "a store"}` : d ? "No store has it right now" : "Loading prices…"}{d?.lowest ? ` · lowest ever ${money(d.lowest.price)} (${new Date(d.lowest.date).toLocaleDateString(undefined, { month: "short", year: "numeric" })})` : ""}</span>
                </div>
            </div>
            {error && <div className="vc-games-error">{error}</div>}
            {d && (
                <FormGroup title={`At ${d.deals.length} store${d.deals.length === 1 ? "" : "s"}`}>
                    {d.deals.map(x => (
                        <div key={x.dealId} className="vc-games-deal-row">
                            <StoreName id={x.store} stores={stores} />
                            <span className="vc-games-price">{money(x.price)}{x.retail > x.price && <s>{money(x.retail)}</s>}</span>
                            {x.savings > 0 ? <span className="vc-tool-badge vc-tool-badge-good">-{x.savings}%</span> : <span />}
                            <button type="button" className="vc-tool-btn" onClick={() => open(dealUrl(x.dealId))}>Open ↗</button>
                        </div>
                    ))}
                </FormGroup>
            )}
            <FormGroup title="Price alert">
                <FormRow label={watching ? "Watching this game" : "Tell me when it's cheaper"} help={watching ? "You'll get a notification when it drops to your price (checked every few hours)." : "Pick the most you'd pay."}>
                    {watching
                        ? <button type="button" className="vc-tool-btn" onClick={() => unwatchPrice(game.id)}>Stop watching</button>
                        : <>
                            <input className="vc-tool-input vc-games-target" inputMode="decimal" value={target} placeholder={best ? (best.price * 0.75).toFixed(2) : "10.00"} aria-label="Your price"
                                onChange={e => setTarget(e.currentTarget.value.replace(/[^\d.]/g, ""))} />
                            <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!(Number(target) > 0)}
                                onClick={() => { watchPrice({ id: game.id, title: game.title, thumb: game.thumb, target: Number(target), last: best?.price }); setTarget(""); }}>Watch</button>
                        </>}
                </FormRow>
            </FormGroup>
        </>
    );
}

function DealSearch() {
    const [q, setQ] = useState("");
    const [results, setResults] = useState<DealGame[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [picked, setPicked] = useState<DealGame | null>(null);
    const search = async () => {
        if (!q.trim()) return;
        setBusy(true);
        const r = await native().gamesDealSearch(q).catch(() => null);
        setResults(r?.ok ? r.games : []);
        setBusy(false);
    };
    if (picked) return <DealDetail game={picked} onBack={() => setPicked(null)} />;
    return (
        <>
            <div className="vc-games-bar">
                <input className="vc-tool-input" value={q} placeholder="A game, like Hades or Elden Ring" aria-label="Game name" onChange={e => setQ(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") void search(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || !q.trim()} onClick={search}>{busy ? "Searching…" : "Find prices"}</button>
            </div>
            {results === null ? <Empty icon="🏷️">Search a game to see its price at Steam, Epic, GOG, Humble, Fanatical and 30 more stores at once.</Empty>
                : !results.length ? <Empty icon="🔍">No game found with that name.</Empty>
                    : (
                        <div className="vc-games-results">
                            {results.map(r => (
                                <button key={r.id} type="button" className="vc-games-result" onClick={() => setPicked(r)}>
                                    {r.thumb ? <img src={r.thumb} alt="" loading="lazy" /> : <div className="vc-games-noimg">🎮</div>}
                                    <b>{r.title}</b>
                                    <span>from {money(r.cheapest)}</span>
                                </button>
                            ))}
                        </div>
                    )}
        </>
    );
}

function DealTop() {
    const stores = useStores();
    const { data, error, busy, reload } = useLoad("top", () => native().gamesDealTop());
    const deals = (data as any)?.deals as (StoreDeal & { title: string; thumb?: string; })[] | undefined;
    if (error) return <Problem text={error} retry={reload} />;
    if (!deals) return <Empty icon="🏷️">{busy ? "Loading today's best deals…" : "Nothing yet."}</Empty>;
    return (
        <>
            <div className="vc-games-head"><b>Today's best-rated deals</b><span className="vc-tool-spacer" /><button type="button" className="vc-tool-link" disabled={busy} onClick={reload}>{busy ? "Loading…" : "Refresh"}</button></div>
            <FormGroup>
                {deals.map(x => (
                    <div key={x.dealId} className="vc-games-deal-row vc-games-deal-row-wide">
                        {x.thumb ? <img className="vc-games-deal-thumb" src={x.thumb} alt="" loading="lazy" /> : <span />}
                        <span className="vc-games-deal-title"><b>{x.title}</b><StoreName id={x.store} stores={stores} /></span>
                        <span className="vc-games-price">{money(x.price)}{x.retail > x.price && <s>{money(x.retail)}</s>}</span>
                        <span className="vc-tool-badge vc-tool-badge-good">-{x.savings}%</span>
                        <button type="button" className="vc-tool-btn" onClick={() => open(dealUrl(x.dealId))}>Open ↗</button>
                    </div>
                ))}
            </FormGroup>
        </>
    );
}

function DealWatching() {
    const g = useGames();
    const [picked, setPicked] = useState<{ id: string; title: string; thumb?: string; } | null>(null);
    if (picked) return <DealDetail game={picked} onBack={() => setPicked(null)} />;
    if (!g.prices.length) return <Empty icon="👀">Find a game and press Watch to be told when it drops to your price.</Empty>;
    return (
        <FormGroup title={`Watching ${g.prices.length}`}>
            {g.prices.map(p => (
                <div key={p.id} className="vc-games-deal-row vc-games-deal-row-wide">
                    {p.thumb ? <img className="vc-games-deal-thumb" src={p.thumb} alt="" /> : <span />}
                    <span className="vc-games-deal-title"><b>{p.title}</b><small>Your price {money(p.target)}</small></span>
                    <span className="vc-games-price">{p.last != null ? money(p.last) : "—"}</span>
                    {p.last != null && p.last <= p.target ? <span className="vc-tool-badge vc-tool-badge-good">At your price</span> : <span />}
                    <span className="vc-tool-row">
                        <button type="button" className="vc-tool-btn" onClick={() => setPicked(p)}>Prices</button>
                        <button type="button" className="vc-tool-icon" aria-label="Stop watching" title="Stop watching" onClick={() => unwatchPrice(p.id)}>✕</button>
                    </span>
                </div>
            ))}
        </FormGroup>
    );
}

/* ── The window ── */

/** Where Game Hub opens: a platform, and for Steam and Roblox the tab (and, for Roblox, what to look up). */
export interface GamesStart { platform?: Platform; steamTab?: string; robloxTab?: string; robloxInitial?: string; }

let lastPlatform: Platform = "epic";
const lastTab: Partial<Record<Platform, string>> = {};

function Rail({ platform, setPlatform }: { platform: Platform; setPlatform(p: Platform): void; }) {
    return (
        <>
            {PLATFORMS.map(x => (
                <button key={x.id} type="button" className={classes("vc-sw-row", x.id === platform && "vc-sw-row-on")} aria-pressed={x.id === platform} onClick={() => setPlatform(x.id)}>
                    <span className="vc-sw-pic" aria-hidden>{x.icon}</span>
                    <span className="vc-sw-row-text"><span className="vc-sw-row-title">{x.name}</span><span className="vc-sw-row-sub">{x.sub}</span></span>
                </button>
            ))}
        </>
    );
}

// One window for every platform: it stays put while you switch, and only what's inside changes.
function GameHubWindow({ modalProps, start }: { modalProps: RenderModalProps; start: GamesStart; }) {
    const g = useGames();
    const first = start.platform ?? lastPlatform;
    const [platform, setPlatformState] = useState<Platform>(PLATFORMS.some(x => x.id === first) ? first : "epic");
    const p = PLATFORMS.find(x => x.id === platform)!;
    const [tab, setTabState] = useState(lastTab[platform] ?? p.tabs[0]?.[0] ?? "");
    // What it was opened for (a Steam tab, a Roblox lookup) only counts until you switch platforms.
    const opening = React.useRef<GamesStart | null>(start);
    const setPlatform = (id: Platform) => {
        if (id === platform) return;
        opening.current = null;
        lastPlatform = id;
        setPlatformState(id);
        setTabState(lastTab[id] ?? PLATFORMS.find(x => x.id === id)!.tabs[0]?.[0] ?? "");
    };
    const setTab = (t: string) => { lastTab[platform] = t; setTabState(t); };
    // Steam's and Roblox's tabs and status line, sent up by their sections.
    const [section, setSection] = useState<HubFrame>({});
    const HubProvider = hubContext().Provider;

    const sectioned = platform === "steam" || platform === "roblox";
    const status: Partial<Record<Platform, string>> = {
        epic: `waiting for ${g.wishlist.length} item${g.wishlist.length === 1 ? "" : "s"}`,
        pass: `prices for ${country()}`,
        mc: `${g.servers.length} server${g.servers.length === 1 ? "" : "s"} saved`,
        deals: `watching ${g.prices.length} price${g.prices.length === 1 ? "" : "s"}`,
    };
    const o = opening.current;
    return (
        <Window {...modalProps} size="xxl" title="Game Hub" subtitle="Steam, Roblox, free games, Fortnite's shop, Game Pass, Minecraft and prices at every store"
            side={<Rail platform={platform} setPlatform={setPlatform} />}
            {...(sectioned
                ? { tabs: section.tabs, tab: section.tab, onTab: section.onTab, status: section.status, statusRight: section.statusRight }
                : { tabs: p.tabs, tab, onTab: setTab, status: [p.name.toLowerCase(), status[platform] ?? ""], statusRight: "no sign-in needed" })}>
            <HubProvider value={setSection}>
                {platform === "steam" && <SteamSection start={o?.platform === "steam" ? o.steamTab : undefined} />}
                {platform === "roblox" && <RobloxSection start={o?.platform === "roblox" ? o.robloxTab : undefined} initial={o?.platform === "roblox" ? o.robloxInitial : undefined} />}
            </HubProvider>
            {!sectioned && (
                <div className="vc-tool-wrap vc-games" key={`${platform}:${tab}`}>
                    {platform === "epic" && (tab === "shop" ? <FortniteShop /> : tab === "history" ? <ShopHistory /> : <EpicFree />)}
                    {platform === "pass" && <GamePass list={tab as "added" | "coming" | "leaving"} />}
                    {platform === "mc" && (tab === "players" ? <McPlayers /> : <McServers />)}
                    {platform === "deals" && (tab === "top" ? <DealTop /> : tab === "watching" ? <DealWatching /> : <DealSearch />)}
                </div>
            )}
        </Window>
    );
}

export function openGames(start: GamesStart | Platform = {}) {
    const s = typeof start === "string" ? { platform: start } : start;
    openModal(props => <GameHubWindow modalProps={props} start={s} />);
}
