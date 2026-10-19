/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A Roblox card: a user, game, group or catalog item with its live numbers.
// Shown under messages with Roblox links, and in the Roblox Tools window.

import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { classes } from "@utils/misc";
import { React, showToast, useEffect, useReducer, useState } from "@webpack/common";

import { isSaved, onSavedChange, refreshSaved, savedFrom, toggleSaved } from "./bookmarks";
import { ago, cardActions, date, fetchRef, joinServer, PRESENCE, RbxGame, RbxGroup, RbxInfo, RbxItem, RbxRef, RbxUser, short, urlFor } from "./data";
import { GameHistory } from "./History";
import { ItemPrices } from "./ItemPrices";
import { isMe, onMeChange, setMe } from "./me";
import { OwnedGames } from "./OwnedGames";
import { FullProfile, uniqueNames } from "./Profile";
import { GameShop } from "./Shop";
import { isWatched, onPeopleChange, unwatchPerson, watchPerson } from "./watchlist";

export const rb = classNameFactory("vc-rbx-");

function Img({ src, className, alt = "" }: { src?: string; className: string; alt?: string; }) {
    const [bad, setBad] = useState(false);
    if (!src || bad) return <span className={classes(className, rb("img-none"))}>🧱</span>;
    return <img className={className} src={src} alt={alt} loading="lazy" onError={() => setBad(true)} />;
}

const Stat = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string; }) => (
    <div className={rb("stat")}><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>
);

function UserCard({ u, full }: { u: RbxUser; full?: boolean; }) {
    const [names, setNames] = useState(false);
    if (full) return <FullProfile u={u} Img={Img} />;
    const list = uniqueNames(u.names, u.name);
    return (
        <>
            <div className={rb("head")}>
                <Img src={u.avatar} className={rb("avatar")} />
                <div className={rb("who")}>
                    <b>{u.displayName}{u.verified && <span className={rb("tick")} title="Verified">✔</span>}{u.banned && <span className={rb("banned")}>Banned</span>}</b>
                    <span>@{u.name} · <i className={classes(rb("dot"), rb(`dot-${u.presence}`))} />{PRESENCE[u.presence] ?? "Offline"}{u.presence === 0 && u.lastOnline ? ` · last online ${ago(u.lastOnline)}` : ""}</span>
                </div>
            </div>
            <div className={rb("stats")}>
                <Stat label="Followers" value={short(u.followers)} />
                <Stat label="Following" value={short(u.following)} />
                <Stat label="Friends" value={short(u.friends)} />
                <Stat label="Joined Roblox" value={date(u.created)} sub={ago(u.created)} />
            </div>
            {list.some(n => !n.current) && (
                <div className={rb("names")}>
                    <button type="button" className={rb("link")} onClick={() => setNames(n => !n)}>
                        {names ? "Hide previous usernames" : `Had ${list.filter(n => !n.current).length} other username${list.filter(n => !n.current).length === 1 ? "" : "s"} — show`}
                    </button>
                    {names && <div className={rb("chips")}>{list.filter(n => !n.current).map(n => <button key={n.name} type="button" className={rb("chip")} onClick={() => copyWithToast(n.name)} title="Copy">{n.name}{n.times > 1 && <small>×{n.times}</small>}</button>)}</div>}
                </div>
            )}
        </>
    );
}

function GameCard({ g, full }: { g: RbxGame; full?: boolean; }) {
    const total = g.up + g.down;
    const like = total ? Math.round(g.up / total * 100) : null;
    return (
        <>
            {g.thumb && <Img src={g.thumb} className={rb("banner")} />}
            <div className={rb("head")}>
                <Img src={g.icon} className={rb("icon")} />
                <div className={rb("who")}>
                    <b>{g.name}</b>
                    <span>by {g.creator}{g.creatorType === "Group" ? " (group)" : ""}{g.genre ? ` · ${g.genre}` : ""}</span>
                </div>
            </div>
            <div className={rb("stats")}>
                <Stat label="Playing now" value={<><i className={rb("live-dot")} aria-hidden />{short(g.playing)}</>} />
                <Stat label="Visits" value={short(g.visits)} />
                <Stat label="Favourites" value={short(g.favorites)} />
                <Stat label="Likes" value={like == null ? "–" : `${like}%`} sub={total ? `${short(g.up)} 👍 · ${short(g.down)} 👎` : undefined} />
                <Stat label="Updated" value={ago(g.updated) || "–"} sub={date(g.updated)} />
                {full && <Stat label="Created" value={date(g.created)} />}
                {full && <Stat label="Server size" value={g.maxPlayers || "–"} />}
            </div>
            {full && <GameHistory placeId={g.placeId} />}
            {full && g.description && <div className={rb("bio")}>{g.description.slice(0, 600)}</div>}
            {full && <GameShop placeId={g.placeId} />}
        </>
    );
}

function GroupCard({ g, full }: { g: RbxGroup; full?: boolean; }) {
    return (
        <>
            <div className={rb("head")}>
                <Img src={g.icon} className={rb("icon")} />
                <div className={rb("who")}>
                    <b>{g.name}{g.verified && <span className={rb("tick")}>✔</span>}</b>
                    <span>{g.owner ? `Owned by @${g.owner}` : "No owner"} · {g.open ? "Anyone can join" : "Join by request"}</span>
                </div>
            </div>
            <div className={rb("stats")}>
                <Stat label="Members" value={g.members.toLocaleString()} />
            </div>
            {g.shout && <div className={rb("shout")}><span>📣 {g.shout.poster} · {ago(g.shout.updated)}</span>{g.shout.body}</div>}
            {full && g.description && <div className={rb("bio")}>{g.description.slice(0, 600)}</div>}
            {full && <OwnedGames kind="group" id={g.id} name={g.name} />}
        </>
    );
}

function ItemCard({ it, full }: { it: RbxItem; full?: boolean; }) {
    return (
        <>
        <div className={rb("item")}>
            <Img src={it.image} className={rb("item-img")} />
            <div className={rb("item-main")}>
                <b>{it.name}{it.limited && <span className={rb("limited")}>Limited</span>}</b>
                <span>{it.type} · by {it.creator}</span>
                <div className={rb("stats")}>
                    <Stat label="Price" value={it.price != null ? `R$ ${it.price.toLocaleString()}` : it.forSale ? "Free" : "Off sale"} />
                    {it.sales != null && <Stat label="Sold" value={short(it.sales)} />}
                    {it.updated && <Stat label="Updated" value={ago(it.updated)} />}
                </div>
            </div>
        </div>
        {full && it.limited && !it.bundle && <ItemPrices itemId={it.id} />}
        </>
    );
}

export function InfoCard({ info, full }: { info: RbxInfo; full?: boolean; }) {
    if (info.kind === "user") return <UserCard u={info} full={full} />;
    if (info.kind === "game") return <GameCard g={info} full={full} />;
    if (info.kind === "group") return <GroupCard g={info} full={full} />;
    return <ItemCard it={info} full={full} />;
}

async function play(g: RbxGame) {
    showToast(`Opening ${g.name} in Roblox…`, "message");
    const why = await joinServer(g.placeId);
    if (why) showToast(why, "failure");
}

/** Save / unsave to the sidebar. */
function SaveButton({ info }: { info: RbxInfo; }) {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => onSavedChange(bump), []);
    const s = savedFrom(info);
    const on = isSaved(s.kind, s.id);
    return (
        <button type="button" className={classes(rb("link"), on && rb("saved-on"))} title={on ? "Remove from Saved" : "Keep it in the Saved list in Roblox Tools"}
            onClick={async () => { await toggleSaved(info); showToast(on ? `Removed ${s.name} from Saved` : `Saved ${s.name}`, on ? "message" : "success"); }}>
            {on ? "★ Saved" : "☆ Save"}
        </button>
    );
}

/** Watch / stop watching a profile for changes. */
/** Set this profile as your own account. */
function MeButton({ u }: { u: RbxUser; }) {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    const [busy, setBusy] = useState(false);
    useEffect(() => onMeChange(bump), []);
    if (isMe(u.id)) return <span className={classes(rb("link"), rb("me-on"))} title="This is your account — it's always watched">👤 You</span>;
    return (
        <button type="button" className={rb("link")} disabled={busy} title="Set as your account: always watched, and at the top of the sidebar"
            onClick={async () => { setBusy(true); const e = await setMe(u.id); setBusy(false); showToast(e ?? `Set ${u.displayName} as your account`, e ? "failure" : "success"); }}>
            👤 This is me
        </button>
    );
}

function WatchButton({ u }: { u: RbxUser; }) {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    const [busy, setBusy] = useState(false);
    useEffect(() => { const a = onPeopleChange(bump), b = onMeChange(bump); return () => { a(); b(); }; }, []);
    if (isMe(u.id)) return <span className={rb("link")} title="Your own account is always watched">👁 Always watching</span>;
    const on = isWatched(u.id);
    const toggle = async () => {
        if (on) { unwatchPerson(u.id); showToast(`Stopped watching ${u.displayName}`, "message"); return; }
        setBusy(true);
        const e = await watchPerson(u.id);
        setBusy(false);
        showToast(e ?? `Watching ${u.displayName} — you'll hear about name, bio and avatar changes`, e ? "failure" : "success");
    };
    return <button type="button" className={rb("link")} disabled={busy} onClick={toggle} title="Get told when they change their name, bio or avatar">{on ? "👁 Watching" : "👁 Watch"}</button>;
}

/** A card for a link, fetched when it appears. */
export function RefCard({ refx, full, onOpen, onInfo }: { refx: RbxRef; full?: boolean; onOpen?(): void; onInfo?(info: RbxInfo): void; }) {
    const [state, setState] = useState<{ info?: RbxInfo; error?: string; }>({});
    const [tick, setTick] = useState(0);
    useEffect(() => {
        let alive = true;
        setState({});
        fetchRef(refx, tick > 0).then(r => {
            if (!alive) return;
            setState(r.ok ? { info: r.info } : { error: r.error });
            if (r.ok && r.info) { refreshSaved(r.info); onInfo?.(r.info); }
        });
        return () => { alive = false; };
    }, [refx.kind, refx.id, tick]);
    return (
        <div className={classes(rb("card"), full && rb("card-full"), state.info && rb(`card-${state.info.kind}`))}>
            {!state.info && !state.error && <div className={rb("loading")}><span className={rb("spin")} /> Asking Roblox…</div>}
            {state.error && <div className={rb("muted")}>🧱 {state.error}</div>}
            {state.info && <InfoCard info={state.info} full={full} />}
            <div className={rb("foot")}>
                <span className={rb("brand")}>Roblox</span>
                <span className={rb("spacer")} />
                <button type="button" className={rb("link")} onClick={() => setTick(t => t + 1)} title="Get the latest numbers">↻</button>
                {state.info?.kind === "game" && <button type="button" className={rb("link")} onClick={() => play(state.info as RbxGame)}>▶ Play</button>}
                {state.info?.kind === "game" && <button type="button" className={rb("link")} onClick={() => cardActions.servers((state.info as RbxGame).placeId)}>Servers</button>}
                {state.info?.kind === "game" && <button type="button" className={rb("link")} onClick={() => cardActions.compare((state.info as RbxGame).placeId)}>Compare</button>}
                {state.info?.kind === "user" && <WatchButton u={state.info} />}
                {state.info?.kind === "user" && full && <MeButton u={state.info} />}
                {state.info?.kind === "item" && !state.info.bundle && <button type="button" className={rb("link")} title="Get its 3D model, textures and other files" onClick={() => cardActions.assets((state.info as RbxItem).id)}>📦 Files</button>}
                {state.info && <SaveButton info={state.info} />}
                {onOpen && <button type="button" className={rb("link")} onClick={onOpen}>More</button>}
                <a className={rb("link")} href={urlFor(refx)} target="_blank" rel="noreferrer">Open on Roblox ↗</a>
            </div>
        </div>
    );
}
