/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, React, useEffect, useMemo, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { checkAll, checkOne, onProgress, opts, progress, refreshPosts, refreshRoblox, stopChecking } from "./refresh";
import { Account, addAccount, ago, at, date, dateTime, getAccounts, loadAccounts, onChange, parseTikTok, Post, removeAccount, short, signed, update } from "./store";

const tt = classNameFactory("vc-ttt-");

/* ── Small pieces ───────────────────────────────────────────────────── */

function useData() {
    const [, bump] = useState(0);
    useEffect(() => { void loadAccounts(); const a = onChange(() => bump(n => n + 1)); const b = onProgress(() => bump(n => n + 1)); return () => { a(); b(); }; }, []);
    return getAccounts();
}

function Pic({ src, name, size = 44, round = true }: { src?: string; name: string; size?: number; round?: boolean; }) {
    const [bad, setBad] = useState(false);
    useEffect(() => setBad(false), [src]);
    if (!src || bad) return <span className={tt("pic-none")} style={{ width: size, height: size, fontSize: size * 0.42, borderRadius: round ? "50%" : 10 }}>{(name[0] ?? "?").toUpperCase()}</span>;
    return <img className={tt("pic")} src={src} alt="" style={{ width: size, height: size, borderRadius: round ? "50%" : 10 }} onError={() => setBad(true)} loading="lazy" />;
}

const Delta = ({ n, big }: { n: number; big?: boolean; }) => (
    <span className={classes(tt("delta"), n > 0 ? tt("up") : n < 0 ? tt("down") : tt("flat"), big && tt("delta-big"))}>{signed(n)}</span>
);

const growth = (a: Account) => (a.last?.followers ?? 0) - (a.first?.followers ?? 0);
const likesGrowth = (a: Account) => (a.last?.likes ?? 0) - (a.first?.likes ?? 0);
const tiktokUrl = (u: string) => `https://www.tiktok.com/@${u}`;
const robloxUrl = (id?: number) => id ? `https://www.roblox.com/users/${id}/profile` : "";
const PRESENCE = ["Offline", "Online", "In a game", "In Studio"];

/** A line chart of one number over time; hover for the value at a point. */
function Chart({ points, color = "var(--tl-accent)", label }: { points: { t: number; v: number; }[]; color?: string; label: string; }) {
    const [hover, setHover] = useState<number | null>(null);
    if (points.length < 2) return <div className={tt("chart-empty")}>The graph fills in as {label.toLowerCase()} are checked over time.</div>;
    const W = 600, H = 150, P = 6;
    const t0 = points[0].t, t1 = points.at(-1)!.t || t0 + 1;
    let lo = Math.min(...points.map(p => p.v)), hi = Math.max(...points.map(p => p.v));
    if (lo === hi) { lo -= 1; hi += 1; }
    const x = (t: number) => P + (W - 2 * P) * ((t - t0) / Math.max(1, t1 - t0));
    const y = (v: number) => H - P - (H - 2 * P) * ((v - lo) / (hi - lo));
    const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const area = `${line}L${x(t1)},${H}L${x(t0)},${H}Z`;
    const hp = hover != null ? points[hover] : null;
    const id = `g${label.replace(/\W/g, "")}`;
    return (
        <div className={tt("chart")}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
                onMouseMove={e => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); const t = t0 + (t1 - t0) * ((e.clientX - r.left) / r.width); let best = 0; points.forEach((p, i) => { if (Math.abs(p.t - t) < Math.abs(points[best].t - t)) best = i; }); setHover(best); }}
                onMouseLeave={() => setHover(null)}>
                <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
                <path d={area} fill={`url(#${id})`} />
                <path d={line} fill="none" stroke={color} strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                {hp && <line x1={x(hp.t)} x2={x(hp.t)} y1={0} y2={H} stroke="hsl(0 0% 100% / 0.25)" vectorEffect="non-scaling-stroke" />}
            </svg>
            <div className={tt("chart-axis")}><span>{date(t0)}</span><span>{hp ? `${dateTime(hp.t)} — ${hp.v.toLocaleString()} ${label.toLowerCase()}` : `${short(lo)} – ${short(hi)}`}</span><span>{date(t1)}</span></div>
        </div>
    );
}

function Spark({ a }: { a: Account; }) {
    const pts = a.history.slice(-40);
    if (pts.length < 2) return null;
    const lo = Math.min(...pts.map(p => p.followers)), hi = Math.max(...pts.map(p => p.followers)) || 1;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${(i / (pts.length - 1)) * 100},${28 - ((p.followers - lo) / Math.max(1, hi - lo)) * 26}`).join("");
    return <svg className={tt("spark")} viewBox="0 0 100 30" preserveAspectRatio="none"><path d={d} fill="none" stroke="var(--tl-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}

/* ── The list ───────────────────────────────────────────────────────── */

type Sort = "growth" | "followers" | "likes" | "added" | "name";

function AddForm({ onAdded }: { onAdded(u: string): void; }) {
    const [tk, setTk] = useState("");
    const [rb, setRb] = useState("");
    const [err, setErr] = useState<string | null>(null);
    const add = () => {
        const u = parseTikTok(tk);
        if (!u) { setErr("Paste a TikTok @username or profile link."); return; }
        if (getAccounts().some(a => a.username === u)) { setErr(`@${u} is already being watched.`); return; }
        addAccount(u, rb);
        setTk(""); setRb(""); setErr(null);
        onAdded(u);
        void checkOne(u, { posts: opts.posts });
    };
    return (
        <section className={classes("vc-tool-section", tt("add"))}>
            <div className={tt("add-row")}>
                <input className="vc-tool-input" value={tk} placeholder="TikTok — @username or profile link" onChange={e => setTk(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} />
                <input className="vc-tool-input" value={rb} placeholder="Roblox profile link or username (optional)" onChange={e => setRb(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={add}>＋ Watch</button>
            </div>
            {err ? <span className="vc-tool-error">{err}</span> : <span className="vc-tool-hint">Growth is counted from the moment you add someone. Their Roblox account can be added now or later.</span>}
        </section>
    );
}

function Card({ a, onOpen }: { a: Account; onOpen(): void; }) {
    const checking = progress.running && progress.current === a.username;
    const rb = a.roblox;
    return (
        <button type="button" className={classes(tt("card"), a.error && tt("card-err"))} onClick={onOpen}>
            <div className={tt("card-head")}>
                <Pic src={a.avatar} name={a.nickname ?? a.username} />
                <div className={tt("who")}>
                    <b>{a.nickname ?? a.username}{a.verified && <span className={tt("tick")} title="Verified">✔</span>}</b>
                    <span>@{a.username}{a.private ? " · private" : ""}</span>
                </div>
                {checking && <span className={tt("spin")} title="Checking now" />}
            </div>
            {a.last ? (
                <div className={tt("nums")}>
                    <div><span>Followers</span><b>{short(a.last.followers)}</b><Delta n={growth(a)} /></div>
                    <div><span>Likes</span><b>{short(a.last.likes)}</b><Delta n={likesGrowth(a)} /></div>
                    <div><span>Videos</span><b>{short(a.last.videos)}</b><Delta n={(a.last.videos ?? 0) - (a.first?.videos ?? 0)} /></div>
                </div>
            ) : <div className={tt("waiting")}>{a.error ?? "Getting their numbers…"}</div>}
            <Spark a={a} />
            {rb && (
                <div className={tt("rb-mini")}>
                    <Pic src={rb.avatar} name={rb.name ?? "R"} size={22} round={false} />
                    <span className={tt("rb-name")}>{rb.error ? `Roblox: ${rb.error}` : rb.name ? `${rb.displayName} (@${rb.name})` : "Roblox…"}</span>
                    {rb.last && <span className={tt("rb-f")}>{short(rb.last.followers)} <Delta n={rb.last.followers - (rb.first?.followers ?? rb.last.followers)} /></span>}
                    {rb.presence != null && <i className={classes(tt("dot"), tt(`dot-${rb.presence}`))} title={PRESENCE[rb.presence]} />}
                </div>
            )}
            <span className={tt("since")}>{a.error && a.last ? `⚠️ ${a.error} · ` : ""}Watching since {date(a.addedAt)} · checked {ago(a.lastCheck)}</span>
        </button>
    );
}

function List({ onOpen }: { onOpen(u: string): void; }) {
    const accounts = useData();
    const [sort, setSort] = useState<Sort>("growth");
    const [find, setFind] = useState("");
    const shown = useMemo(() => {
        const q = find.trim().toLowerCase();
        const l = accounts.filter(a => !q || a.username.includes(q) || a.nickname?.toLowerCase().includes(q) || a.roblox?.name?.toLowerCase().includes(q));
        const by: Record<Sort, (a: Account, b: Account) => number> = {
            growth: (a, b) => growth(b) - growth(a), followers: (a, b) => (b.last?.followers ?? 0) - (a.last?.followers ?? 0),
            likes: (a, b) => (b.last?.likes ?? 0) - (a.last?.likes ?? 0), added: (a, b) => b.addedAt - a.addedAt, name: (a, b) => (a.nickname ?? a.username).localeCompare(b.nickname ?? b.username),
        };
        return l.sort(by[sort]);
    }, [accounts, sort, find]);
    const totals = accounts.reduce((t, a) => ({ f: t.f + growth(a), l: t.l + likesGrowth(a), v: t.v + ((a.last?.videos ?? 0) - (a.first?.videos ?? 0)) }), { f: 0, l: 0, v: 0 });
    const top = accounts.slice().sort((a, b) => growth(b) - growth(a))[0];

    return (
        <>
            <AddForm onAdded={() => { }} />
            {accounts.length > 0 && (
                <div className="vc-tool-stats">
                    <div className="vc-tool-stat vc-tool-stat-accent"><span>Creators watched</span><b>{accounts.length}</b></div>
                    <div className="vc-tool-stat"><span>Followers gained</span><b>{signed(totals.f)}</b></div>
                    <div className="vc-tool-stat"><span>Likes gained</span><b>{signed(totals.l)}</b></div>
                    <div className="vc-tool-stat"><span>New videos</span><b>{signed(totals.v)}</b></div>
                    {top && growth(top) > 0 && <div className="vc-tool-stat"><span>Growing fastest</span><b style={{ fontSize: 15 }}>{top.nickname ?? top.username}</b></div>}
                </div>
            )}
            {accounts.length > 0 && (
                <div className={tt("bar")}>
                    <input className="vc-tool-input" style={{ maxWidth: 240 }} value={find} placeholder="Find a creator" onChange={e => setFind(e.currentTarget.value)} />
                    <div className="vc-tool-seg">
                        {([["growth", "Most growth"], ["followers", "Followers"], ["likes", "Likes"], ["added", "Newest"], ["name", "A–Z"]] as [Sort, string][]).map(([k, l]) => (
                            <button key={k} type="button" className={classes("vc-tool-seg-btn", sort === k && "vc-tool-seg-on")} onClick={() => setSort(k)}>{l}</button>
                        ))}
                    </div>
                    <span className="vc-tool-spacer" />
                    {progress.running
                        ? <button type="button" className="vc-tool-btn" onClick={stopChecking}>Checking {progress.done + 1} of {progress.total}… Stop</button>
                        : <button type="button" className="vc-tool-btn" onClick={() => void checkAll(true)}>↻ Check everyone now</button>}
                </div>
            )}
            {progress.blockedUntil > Date.now() && <div className={tt("warn")}>⚠️ TikTok asked for a break, so checking paused until {new Date(progress.blockedUntil).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}. It carries on by itself.</div>}
            {!accounts.length ? (
                <div className="vc-tool-empty"><span className="vc-tool-empty-icon">📈</span><b>No one is being watched yet</b>Add a creator's TikTok above — and their Roblox if you like — and their followers, likes and posts are tracked from today.</div>
            ) : (
                <div className={tt("grid")}>{shown.map(a => <Card key={a.username} a={a} onOpen={() => onOpen(a.username)} />)}</div>
            )}
        </>
    );
}

/* ── One creator ────────────────────────────────────────────────────── */

type Metric = "followers" | "likes" | "videos";
type Range = 7 | 30 | 0;

function PostRow({ p, username }: { p: Post; username: string; }) {
    const l = p.last, f = p.first;
    return (
        <a className={classes(tt("post"), p.gone && tt("post-gone"))} href={`https://www.tiktok.com/@${username}/video/${p.id}`} target="_blank" rel="noreferrer">
            <Pic src={p.cover} name="▶" size={64} round={false} />
            <div className={tt("post-main")}>
                <span className={tt("post-desc")}>{p.desc || "(no caption)"}</span>
                <span className={tt("post-when")}>Posted {dateTime(p.created)} · {ago(p.created)}{p.gone ? " · removed or private now" : ""}</span>
                {l ? (
                    <div className={tt("post-stats")}>
                        <span title="Likes">❤ <b>{short(l.likes)}</b>{f && l.likes !== f.likes && <Delta n={l.likes - f.likes} />}</span>
                        <span title="Views">▶ <b>{short(l.views)}</b>{f && l.views !== f.views && <Delta n={l.views - f.views} />}</span>
                        <span title="Comments">💬 <b>{short(l.comments)}</b></span>
                        <span title="Shares">↗ <b>{short(l.shares)}</b></span>
                        <span title="Saves">🔖 <b>{short(l.saves)}</b></span>
                        <span className={tt("post-checked")}>checked {ago(l.t)}</span>
                    </div>
                ) : <span className="vc-tool-hint">Likes not checked yet</span>}
            </div>
        </a>
    );
}

function Detail({ username, onBack }: { username: string; onBack(): void; }) {
    const accounts = useData();
    const a = accounts.find(x => x.username === username);
    const [metric, setMetric] = useState<Metric>("followers");
    const [range, setRange] = useState<Range>(30);
    const [postSort, setPostSort] = useState<"new" | "likes" | "gained">("new");
    const [showPosts, setShowPosts] = useState(opts.posts);
    const [rbInput, setRbInput] = useState(a?.roblox?.input ?? "");
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState(a?.note ?? "");
    if (!a) return null;

    const now = Date.now();
    const since = (ms: number) => { const p = at(a.history, now - ms); return p && a.last ? a.last.followers - p.followers : 0; };
    const sinceLikes = (ms: number) => { const p = at(a.history, now - ms); return p && a.last ? a.last.likes - p.likes : 0; };
    const pts = a.history.filter(p => !range || p.t >= now - range * 86400_000).map(p => ({ t: p.t, v: p[metric] }));
    const posts = Object.values(a.posts).sort((p, q) => postSort === "new" ? q.created - p.created : postSort === "likes" ? (q.last?.likes ?? 0) - (p.last?.likes ?? 0) : ((q.last?.likes ?? 0) - (q.first?.likes ?? 0)) - ((p.last?.likes ?? 0) - (p.first?.likes ?? 0)));
    const rb = a.roblox;
    const run = async (label: string, fn: () => Promise<unknown>) => { setBusy(label); try { await fn(); } finally { setBusy(null); } };

    return (
        <>
            <div className={tt("dhead")}>
                <button type="button" className="vc-tool-icon" onClick={onBack} title="Back">←</button>
                <Pic src={a.avatar} name={a.nickname ?? a.username} size={60} />
                <div className={tt("who")}>
                    <b style={{ fontSize: 19 }}>{a.nickname ?? a.username}{a.verified && <span className={tt("tick")}>✔</span>}</b>
                    <span>@{a.username} · watching since {dateTime(a.addedAt)} · checked {ago(a.lastCheck)}</span>
                    {a.bio && <span className={tt("bio")}>{a.bio}</span>}
                </div>
                <div className={tt("dactions")}>
                    <a className="vc-tool-btn" href={tiktokUrl(a.username)} target="_blank" rel="noreferrer">Open TikTok</a>
                    {rb?.id && <a className="vc-tool-btn" href={robloxUrl(rb.id)} target="_blank" rel="noreferrer">Open Roblox</a>}
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!!busy || progress.running} onClick={() => run("all", () => checkOne(a.username, { posts: showPosts }))}>{busy === "all" ? "Checking…" : "↻ Check now"}</button>
                </div>
            </div>
            {a.error && <div className={tt("warn")}>⚠️ {a.error}</div>}

            {a.last && a.first && (
                <div className="vc-tool-stats">
                    <div className="vc-tool-stat vc-tool-stat-accent"><span>Followers</span><b>{a.last.followers.toLocaleString()}</b><Delta n={growth(a)} big /></div>
                    <div className="vc-tool-stat"><span>Likes</span><b>{a.last.likes.toLocaleString()}</b><Delta n={likesGrowth(a)} big /></div>
                    <div className="vc-tool-stat"><span>Videos</span><b>{a.last.videos.toLocaleString()}</b><Delta n={a.last.videos - a.first.videos} big /></div>
                    <div className="vc-tool-stat"><span>Following</span><b>{a.last.following.toLocaleString()}</b></div>
                    <div className="vc-tool-stat"><span>Last 24 hours</span><b>{signed(since(86400_000))}</b><small className={tt("sub")}>followers · {signed(sinceLikes(86400_000))} likes</small></div>
                    <div className="vc-tool-stat"><span>Last 7 days</span><b>{signed(since(7 * 86400_000))}</b><small className={tt("sub")}>followers · {signed(sinceLikes(7 * 86400_000))} likes</small></div>
                </div>
            )}

            <section className="vc-tool-section">
                <div className={tt("bar")}>
                    <div className="vc-tool-seg">
                        {(["followers", "likes", "videos"] as Metric[]).map(m => <button key={m} type="button" className={classes("vc-tool-seg-btn", metric === m && "vc-tool-seg-on")} onClick={() => setMetric(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}
                    </div>
                    <span className="vc-tool-spacer" />
                    <div className="vc-tool-seg">
                        {([[7, "7 days"], [30, "30 days"], [0, "Since added"]] as [Range, string][]).map(([r, l]) => <button key={r} type="button" className={classes("vc-tool-seg-btn", range === r && "vc-tool-seg-on")} onClick={() => setRange(r)}>{l}</button>)}
                    </div>
                </div>
                <Chart points={pts} label={metric[0].toUpperCase() + metric.slice(1)} />
            </section>

            <section className="vc-tool-section">
                <div className="vc-tool-head">
                    <span className="vc-tool-label">🎮 Roblox</span>
                    {rb?.id && <span className={classes("vc-tool-badge", rb.presence ? "vc-tool-badge-good" : "")}><i className={classes(tt("dot"), tt(`dot-${rb.presence ?? 0}`))} />{PRESENCE[rb.presence ?? 0]}</span>}
                </div>
                {rb?.id && !rb.error ? (
                    <div className={tt("rb")}>
                        <Pic src={rb.avatar} name={rb.name ?? "R"} size={56} round={false} />
                        <div className={tt("who")}>
                            <b>{rb.displayName}{rb.verified && <span className={tt("tick")}>✔</span>}{rb.banned && <span className="vc-tool-badge vc-tool-badge-bad" style={{ marginLeft: 6 }}>Banned</span>}</b>
                            <span>@{rb.name} · on Roblox since {rb.created ? date(Date.parse(rb.created)) : "–"}{rb.presence === 0 && rb.lastOnline ? ` · last online ${ago(Date.parse(rb.lastOnline))}` : ""}</span>
                            {rb.bio && <span className={tt("bio")}>{rb.bio}</span>}
                        </div>
                        {rb.last && (
                            <div className={tt("nums")} style={{ minWidth: 260 }}>
                                <div><span>Followers</span><b>{short(rb.last.followers)}</b><Delta n={rb.last.followers - (rb.first?.followers ?? rb.last.followers)} /></div>
                                <div><span>Following</span><b>{short(rb.last.following)}</b></div>
                                <div><span>Friends</span><b>{short(rb.last.friends)}</b><Delta n={rb.last.friends - (rb.first?.friends ?? rb.last.friends)} /></div>
                            </div>
                        )}
                    </div>
                ) : rb?.error ? <span className="vc-tool-error">{rb.error}</span> : <span className="vc-tool-hint">No Roblox account linked yet.</span>}
                <div className={tt("add-row")}>
                    <input className="vc-tool-input" value={rbInput} placeholder="Roblox profile link (roblox.com/users/…/profile) or username" onChange={e => setRbInput(e.currentTarget.value)} />
                    <button type="button" className="vc-tool-btn" disabled={!!busy} onClick={() => run("rb", async () => {
                        const v = rbInput.trim();
                        update(a.username, x => { x.roblox = v ? (x.roblox?.input === v ? x.roblox : { input: v, history: [] }) : undefined; });
                        if (v) await refreshRoblox(a.username);
                    })}>{busy === "rb" ? "Looking…" : rbInput.trim() ? (rb?.input === rbInput.trim() ? "↻ Refresh" : "Link") : "Remove link"}</button>
                </div>
            </section>

            <section className="vc-tool-section">
                <div className="vc-tool-head">
                    <span className="vc-tool-label">📱 Posts · {posts.length}</span>
                    <label className="vc-tool-check"><input type="checkbox" checked={showPosts} onChange={e => { setShowPosts(e.currentTarget.checked); opts.posts = e.currentTarget.checked; settingsHook.setPosts?.(e.currentTarget.checked); }} /> See current likes on posts</label>
                </div>
                {!showPosts ? <span className="vc-tool-hint">Turned off — only the account totals are checked.</span> : a.private ? <span className="vc-tool-hint">This account is private, so its posts can't be seen.</span> : (
                    <>
                        <div className={tt("bar")}>
                            <div className="vc-tool-seg">
                                {([["new", "Newest"], ["likes", "Most liked"], ["gained", "Most likes gained"]] as const).map(([k, l]) => <button key={k} type="button" className={classes("vc-tool-seg-btn", postSort === k && "vc-tool-seg-on")} onClick={() => setPostSort(k)}>{l}</button>)}
                            </div>
                            <span className="vc-tool-hint">Latest {opts.postsCount} posts are checked{a.lastPostsCheck ? `, last ${ago(a.lastPostsCheck)}` : ""}.</span>
                            <span className="vc-tool-spacer" />
                            <button type="button" className="vc-tool-btn" disabled={!!busy || progress.running} onClick={() => run("posts", () => refreshPosts(a.username))}>{busy === "posts" ? "Checking posts…" : "↻ Refresh posts"}</button>
                        </div>
                        {posts.length ? <div className={tt("posts")}>{posts.map(p => <PostRow key={p.id} p={p} username={a.username} />)}</div>
                            : <span className="vc-tool-hint">{busy === "posts" ? "Getting their posts…" : "No posts found yet — press Refresh posts."}</span>}
                    </>
                )}
            </section>

            <section className="vc-tool-section">
                <span className="vc-tool-label">Notes</span>
                <textarea className="vc-tool-area" style={{ minHeight: 60 }} value={note} placeholder="Anything about this creator — only you see it" onChange={e => setNote(e.currentTarget.value)} onBlur={() => update(a.username, x => { x.note = note.trim() || undefined; })} />
            </section>

            <div className="vc-tool-footer">
                <button type="button" className="vc-tool-btn vc-tool-danger" onClick={() => { removeAccount(a.username); onBack(); }}>Stop watching @{a.username}</button>
                <span className="vc-tool-spacer" />
                <span className="vc-tool-hint">Numbers come from TikTok's public profile page, the same one anyone can see.</span>
            </div>
        </>
    );
}

/** Lets the window flip the "See current likes on posts" setting. */
export const settingsHook: { setPosts?(v: boolean): void; } = {};

function TrackerModal({ modalProps, initial }: { modalProps: RenderModalProps; initial?: string; }) {
    const [open, setOpen] = useState<string | null>(initial ?? null);
    const accounts = useData();
    const accent = windowAccent("tiktokTracker");
    return (
        <Modal {...modalProps} size="lg" title="TikTok Tracker" subtitle={`Watching ${accounts.length} creator${accounts.length === 1 ? "" : "s"} · checked every ${opts.minutes >= 60 ? `${opts.minutes / 60} h` : `${opts.minutes} min`} while Discord is open`}>
            <div className={classes("vc-tool-wrap", tt("window"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                {open ? <Detail username={open} onBack={() => setOpen(null)} /> : <List onOpen={setOpen} />}
            </div>
        </Modal>
    );
}

export function openTracker(username?: string) {
    openModal(props => <TrackerModal modalProps={props} initial={username} />);
}
