/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyToClipboard } from "@utils/clipboard";
import { classes } from "@utils/misc";
import { saveFile } from "@utils/web";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, showToast, useEffect, useMemo, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { Window } from "../_shared/Window";
import { ActionRow, DetailHead, Facts, FormGroup, FormRow, ListHead, ListRow, Split, Toggle } from "../_shared/WindowParts";
import { FIXES } from "./fixes";
import { BuilderTab, CommandsTab, HostingTab } from "./MoreTabs";
import { fromNumber, GROUPS, inviteUrl, PERM_PRESETS, PERMS, toNumber } from "./permissions";
import { DEFAULT_PARTS, intentsNeeded, Lang, permsFor, slugOf, starterZip } from "./starter";
import { Bot, botPicture, guideDone, isWatched, portalUrl, refreshBots, setGuideStep, setWatched, sharedServers, Status, statusOf, useBotState } from "./store";

const open = (url: string) => VencordNative.native.openExternal(url);
const PORTAL = "https://discord.com/developers/applications";

type Tab = "bots" | "guide" | "invite" | "commands" | "builder" | "starter" | "hosting" | "fix";
const TABS: [Tab, string][] = [["bots", "Bots"], ["guide", "Guide"], ["invite", "Invite"], ["commands", "Commands"], ["builder", "Builder"], ["starter", "Starter"], ["hosting", "Hosting"], ["fix", "Fix"]];
let lastTab: Tab = "bots";

const STATUS_TEXT: Record<Status, string> = { online: "Online", idle: "Idle", dnd: "Do not disturb", offline: "Offline", unknown: "Status unknown" };

function Avatar({ b, size = 44 }: { b: Bot; size?: number; }) {
    const src = botPicture(b, 128);
    return src
        ? <img className="vc-bm-ava" src={src} alt="" style={size ? { width: size, height: size } : undefined} />
        : <span className="vc-bm-ava vc-bm-ava-none" style={size ? { width: size, height: size } : undefined}>{(b.botName ?? b.name).slice(0, 1).toUpperCase()}</span>;
}

/* ── Your bots: the list on the left, the picked one on the right ── */

const DOT: Record<Status, string> = { online: "#23a55a", idle: "#f0b232", dnd: "#f23f43", offline: "#80848e", unknown: "#4d4d4d" };

function BotDetails({ b, onInvite, onFix, onCommands }: { b: Bot; onInvite(): void; onFix(): void; onCommands(): void; }) {
    const status = statusOf(b.botId);
    const shared = b.botId ? sharedServers(b.botId) : [];
    const watched = !!b.botId && isWatched(b.botId);
    const sharedText = shared.length
        ? shared.slice(0, 4).map(g => g.name).join(", ") + (shared.length > 4 ? ` and ${shared.length - 4} more` : "")
        : "None — add it to a server you're in to see if it's online";
    return (
        <>
            <DetailHead pic={<Avatar b={b} size={0} />} title={b.botName ?? b.name} dot={DOT[status]}
                sub={[STATUS_TEXT[status], b.isPublic ? "Public" : "Private", b.team && `Team: ${b.team}`].filter(Boolean).join(" · ")} />
            <Facts items={[
                ["Servers", b.guilds != null ? b.guilds.toLocaleString() : shared.length ? `${shared.length}+` : "—"],
                ["With you", shared.length],
                ["Made", b.createdAt ? new Date(b.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—"],
            ]} />
            <FormGroup>
                {b.botId
                    ? <FormRow label="Watch it" help="Tell me when it goes offline, and when it's back"><Toggle value={watched} label="Watch it" onChange={v => setWatched(b.botId!, v)} /></FormRow>
                    : <FormRow label="No bot yet" help="This app doesn't have a bot — open it in the Developer Portal → Bot." />}
                {b.botId && <FormRow label="Servers you share" help={sharedText} />}
                <FormRow label="App ID" help={<code className="vc-bm-id">{b.appId}</code>}>
                    <button type="button" className="vc-tool-btn" onClick={() => { copyToClipboard(b.appId); showToast("Copied the app ID", "success"); }}>Copy</button>
                </FormRow>
            </FormGroup>
            {status === "offline" && (
                <div className="vc-bm-error">It's offline — its program isn't running, or it lost its connection. <button type="button" className="vc-tool-link" onClick={onFix}>What to check</button></div>
            )}
            <ActionRow>
                {b.botId && <button type="button" className="vc-tool-btn vc-tool-primary" onClick={onInvite}>Invite</button>}
                {b.botId && <button type="button" className="vc-tool-btn" onClick={onCommands}>Commands</button>}
                <button type="button" className="vc-tool-btn" onClick={() => open(portalUrl(b.appId, "bot"))}>Portal ↗</button>
            </ActionRow>
        </>
    );
}

function BotsTab({ query, onInvite, onFix, onGuide, onCommands }: { query: string; onInvite(b: Bot): void; onFix(): void; onGuide(): void; onCommands(b: Bot): void; }) {
    const s = useBotState();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [picked, setPicked] = useState<string | null>(null);
    const [, tick] = useState(0);
    const reload = async () => { setBusy(true); setError(null); const r = await refreshBots(); if (!r.ok) setError(r.error); setBusy(false); };
    // Fresh on open (the list is kept, so it shows straight away), and statuses every 15 seconds.
    useEffect(() => {
        void reload();
        const t = setInterval(() => tick(n => n + 1), 15_000);
        return () => clearInterval(t);
    }, []);

    const q = query.trim().toLowerCase();
    const shown = q ? s.bots.filter(b => `${b.botName ?? ""} ${b.name}`.toLowerCase().includes(q)) : s.bots;
    const sel = shown.find(b => b.appId === picked) ?? shown[0];
    const online = s.bots.filter(b => ["online", "idle", "dnd"].includes(statusOf(b.botId))).length;

    if (!s.bots.length) return (
        <>
            {error && <div className="vc-bm-error">{error}</div>}
            {busy ? <div className="vc-tool-empty">Loading your bots…</div> : (
                <div className="vc-tool-empty">
                    <span className="vc-tool-empty-icon">🤖</span>
                    You haven't made a bot yet. The guide walks you through it — it takes about ten minutes.
                    <button type="button" className="vc-tool-btn vc-tool-primary" onClick={onGuide}>Start the guide</button>
                </div>
            )}
        </>
    );

    return (
        <Split list={<>
            <ListHead right={<button type="button" className="vc-tool-link" disabled={busy} onClick={() => void reload()}>{busy ? "Loading…" : "Refresh"}</button>}>
                Your bots · {s.bots.length} · {online} online
            </ListHead>
            {shown.map(b => {
                const st = statusOf(b.botId);
                return <ListRow key={b.appId} on={b.appId === sel?.appId} onClick={() => setPicked(b.appId)} pic={<Avatar b={b} size={0} />} title={b.botName ?? b.name} dot={DOT[st]} sub={b.botId ? STATUS_TEXT[st] : "No bot yet"} />;
            })}
            {!shown.length && <span className="vc-tool-hint vc-bm-none">No bot called “{query.trim()}”.</span>}
        </>}>
            {error && <div className="vc-bm-error">{error}</div>}
            {sel && <BotDetails key={sel.appId} b={sel} onInvite={() => onInvite(sel)} onFix={onFix} onCommands={() => onCommands(sel)} />}
        </Split>
    );
}

/* ── Guide ── */

const GUIDE: { title: string; body: string; link?: [string, string]; go?: Tab; }[] = [
    { title: "Make an app", body: "Open the Developer Portal, press New Application, give it a name and agree to the terms.", link: ["Open the Developer Portal", PORTAL] },
    { title: "Turn it into a bot", body: "Open the Bot page on the left. Set its name and picture — that's what people see in chat." },
    { title: "Get the token — and keep it secret", body: "On the Bot page, press Reset Token and copy it. It's your bot's password: anyone with it controls your bot. Never post it, screenshot it or upload it." },
    { title: "Turn on what it needs", body: "Still on the Bot page, under Privileged Gateway Intents: turn on Message Content if it reads messages, and Server Members if it welcomes people. Save." },
    { title: "Invite it to a server", body: "Pick its permissions in the Invite tab and open the link. You need Manage Server in the server you add it to.", go: "invite" },
    { title: "Make its code", body: "The Starter project tab makes a ready-to-run bot in JavaScript or Python with the parts you pick.", go: "starter" },
    { title: "Paste the token and start it", body: "Open the project's .env file in Notepad, paste the token after TOKEN=, save, and double-click Start bot.bat. When it says \"Logged in\", your bot is online." },
    { title: "Keep it running", body: "Your bot is online only while its program runs. Leave the window open, or move it somewhere that's always on (a spare PC, or a hosting service) when you're ready." },
];

function GuideTab({ go }: { go(t: Tab): void; }) {
    useBotState();
    const done = guideDone();
    const pct = Math.round(done.length / GUIDE.length * 100);
    return (
        <>
            <div className="vc-bm-progress"><b>{done.length} of {GUIDE.length} done</b><div className="vc-tool-bar"><div style={{ width: `${pct}%` }} /></div></div>
            <ol className="vc-bm-guide">
                {GUIDE.map((s, i) => {
                    const ok = done.includes(i);
                    return (
                        <li key={i} className={classes("vc-bm-step", ok && "vc-bm-step-done")}>
                            <button type="button" className="vc-bm-step-check" aria-label={ok ? "Mark as not done" : "Mark as done"} onClick={() => setGuideStep(i, !ok)}>{ok ? "✓" : i + 1}</button>
                            <div className="vc-bm-step-text">
                                <b>{s.title}</b>
                                <span>{s.body}</span>
                                {(s.link || s.go) && (
                                    <div className="vc-tool-row">
                                        {s.link && <button type="button" className="vc-tool-btn" onClick={() => open(s.link![1])}>{s.link[0]} ↗</button>}
                                        {s.go && <button type="button" className="vc-tool-btn" onClick={() => go(s.go!)}>Open {TABS.find(t => t[0] === s.go)![1].replace(/^\S+ /, "")}</button>}
                                    </div>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>
        </>
    );
}

/* ── Invite builder ── */

function InviteTab({ initial, initialBits }: { initial: string | null; initialBits: number[] | null; }) {
    const s = useBotState();
    const choices = s.bots.filter(b => b.botId);
    const [appId, setAppId] = useState(initial ?? choices[0]?.appId ?? "");
    const [bits, setBits] = useState<Set<number>>(() => new Set(initialBits ?? PERM_PRESETS[0].bits));
    const [slash, setSlash] = useState(true);
    const [num, setNum] = useState("");
    useEffect(() => { if (!appId && choices[0]) setAppId(choices[0].appId); }, [choices.length]);
    const value = toNumber(bits).toString();
    const risky = PERMS.filter(p => p.risky && bits.has(p.bit));
    const admin = bits.has(3);
    const url = /^\d{15,25}$/.test(appId) ? inviteUrl(appId, bits, slash) : null;
    const toggle = (b: number) => setBits(prev => { const n = new Set(prev); if (n.has(b)) n.delete(b); else n.add(b); return n; });

    return (
        <div className="vc-bm-invite">
            <div className="vc-bm-invite-side">
                <label className="vc-tool-field">
                    <span className="vc-tool-label">Bot</span>
                    {choices.length
                        ? <select className="vc-tool-select" value={appId} onChange={e => setAppId(e.currentTarget.value)}>{choices.map(b => <option key={b.appId} value={b.appId}>{b.botName ?? b.name}</option>)}</select>
                        : <input className="vc-tool-input" value={appId} placeholder="The app's ID (from the Developer Portal)" onChange={e => setAppId(e.currentTarget.value.trim())} />}
                </label>
                <div className="vc-tool-field">
                    <span className="vc-tool-label">Start from</span>
                    <div className="vc-tool-chips">
                        {PERM_PRESETS.map(p => <button key={p.name} type="button" className="vc-tool-chip" onClick={() => setBits(new Set(p.bits))}>{p.name}</button>)}
                        <button type="button" className="vc-tool-chip" onClick={() => setBits(new Set())}>None</button>
                    </div>
                </div>
                <label className="vc-tool-check"><input type="checkbox" checked={slash} onChange={e => setSlash(e.currentTarget.checked)} /> Slash commands (applications.commands)</label>
                <div className="vc-bm-number">
                    <span className="vc-tool-label">Permissions number</span>
                    <div className="vc-tool-row">
                        <code>{value}</code>
                        <button type="button" className="vc-tool-link" onClick={() => { copyToClipboard(value); showToast("Copied", "success"); }}>Copy</button>
                    </div>
                    <div className="vc-tool-row">
                        <input className="vc-tool-input vc-tool-grow" value={num} placeholder="Or paste a number to tick its boxes" onChange={e => setNum(e.currentTarget.value.replace(/\D/g, ""))} />
                        <button type="button" className="vc-tool-btn" disabled={!num} onClick={() => { setBits(new Set(fromNumber(num))); setNum(""); }}>Use</button>
                    </div>
                </div>
                {admin
                    ? <div className="vc-bm-warn">⚠ Administrator gives the bot every permission in the server. Almost no bot needs it — if its token ever leaks, the whole server is at risk.</div>
                    : risky.length > 0 && <div className="vc-bm-warn vc-bm-warn-soft">Careful with: {risky.map(p => p.name).join(", ")}. Only tick these if the bot really uses them.</div>}
                <div className="vc-tool-row vc-bm-invite-go">
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!url} onClick={() => url && open(url)}>Invite to a server ↗</button>
                    <button type="button" className="vc-tool-btn" disabled={!url} onClick={() => { if (url) { copyToClipboard(url); showToast("Copied the invite link", "success"); } }}>Copy link</button>
                </div>
            </div>
            <div className="vc-bm-perms">
                {GROUPS.map(g => (
                    <section key={g} className="vc-bm-perm-group">
                        <h4>{g}</h4>
                        {PERMS.filter(p => p.group === g).map(p => (
                            <label key={p.bit} className={classes("vc-bm-perm", bits.has(p.bit) && "vc-bm-perm-on", p.risky && "vc-bm-perm-risky")} title={p.what}>
                                <input type="checkbox" checked={bits.has(p.bit)} onChange={() => toggle(p.bit)} />
                                <span><b>{p.name}{p.risky ? " ⚠" : ""}</b><small>{p.what}</small></span>
                            </label>
                        ))}
                    </section>
                ))}
            </div>
        </div>
    );
}

/* ── Starter project ── */

type Parts = typeof DEFAULT_PARTS;
type BoolPart = Exclude<keyof Parts, "status">;

function StarterTab({ onInvite }: { onInvite(bits: number[]): void; }) {
    const s = useBotState();
    const firstName = s.bots.find(b => b.botId)?.botName ?? "My bot";
    const [name, setName] = useState(firstName);
    const [lang, setLang] = useState<Lang>("js");
    const [parts, setParts] = useState<Parts>(DEFAULT_PARTS);
    const opts = { name, lang, ...parts };
    const intents = intentsNeeded(opts);
    const pick = (k: BoolPart) => setParts(p => ({ ...p, [k]: !p[k] }));
    const PARTS: [BoolPart, string, string][] = [
        ["slash", "Slash commands", "/ping and /hello"],
        ["embeds", "Info card", "An /info command that sends an embed"],
        ["moderation", "Moderation", "/kick, /ban, /timeout and /clear — only for people allowed to"],
        ["roleButtons", "Role buttons", "/rolebutton posts a button that gives a role"],
        ["welcome", "Welcome messages", "Greets new members — needs Server Members"],
        ["logs", "Log channel", "Deleted and edited messages, to a channel — needs Message Content"],
        ["replies", "Chat replies", "Answers \"hello\" — needs Message Content"],
        ["music", "Music player", "/play songs from the bot's music folder in voice"],
    ];
    const files = (lang === "js" ? ["index.js", "package.json"] : ["bot.py", "requirements.txt"]).concat(["Start bot.bat", `.env  ← paste the token${parts.logs ? " (and log channel)" : ""}`, "README.txt"], parts.music ? ["music/  ← put songs here"] : []);
    return (
        <div className="vc-bm-starter">
            <div className="vc-bm-starter-form">
                <div className="vc-tool-grid2">
                    <label className="vc-tool-field">
                        <span className="vc-tool-label">Bot name</span>
                        <input className="vc-tool-input" value={name} maxLength={60} onChange={e => setName(e.currentTarget.value)} />
                    </label>
                    <label className="vc-tool-field">
                        <span className="vc-tool-label">"Playing…" status (optional)</span>
                        <input className="vc-tool-input" value={parts.status} maxLength={100} placeholder="e.g. with slash commands" onChange={e => { const status = e.currentTarget.value; setParts(p => ({ ...p, status })); }} />
                    </label>
                </div>
                <div className="vc-tool-field">
                    <span className="vc-tool-label">Language</span>
                    <div className="vc-tool-seg">
                        <button type="button" className={classes("vc-tool-seg-btn", lang === "js" && "vc-tool-seg-on")} onClick={() => setLang("js")}>JavaScript</button>
                        <button type="button" className={classes("vc-tool-seg-btn", lang === "py" && "vc-tool-seg-on")} onClick={() => setLang("py")}>Python</button>
                    </div>
                    <span className="vc-tool-hint">{lang === "js" ? "Uses discord.js. Needs Node.js — the Sonata installer already set it up on this PC." : "Uses discord.py. Needs Python from python.org."}</span>
                </div>
                <div className="vc-tool-field">
                    <span className="vc-tool-label">What it does</span>
                    <div className="vc-bm-parts">
                        {PARTS.map(([k, label, hint]) => (
                            <label key={k} className={classes("vc-bm-part", parts[k] && "vc-bm-part-on")}>
                                <input type="checkbox" checked={parts[k]} onChange={() => pick(k)} />
                                <span><b>{label}</b><small>{hint}</small></span>
                            </label>
                        ))}
                    </div>
                </div>
            </div>
            <div className="vc-bm-starter-side">
                <div className="vc-bm-files">
                    <b>📁 {slugOf(name)}</b>
                    {files.map(f => <span key={f}>{f}</span>)}
                </div>
                {intents.length > 0 && <div className="vc-bm-warn vc-bm-warn-soft">Turn on <b>{intents.join(" and ")}</b> in the Developer Portal → Bot → Privileged Gateway Intents, or it won't start.</div>}
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => {
                    saveFile(new File([starterZip(opts) as BlobPart], `${slugOf(name)}.zip`, { type: "application/zip" }));
                    showToast("Saved — unzip it, paste your token into .env, then double-click Start bot.bat", "success");
                }}>⬇ Download the project</button>
                <button type="button" className="vc-tool-btn" onClick={() => onInvite(permsFor(parts))}>🔗 Invite link with the right permissions</button>
                <span className="vc-tool-hint">Unzip it, paste your token into the .env file, then double-click Start bot.bat.</span>
            </div>
        </div>
    );
}

/* ── Fix problems ── */

function FixTab({ startWith }: { startWith: string | null; }) {
    const s = useBotState();
    const [q, setQ] = useState("");
    const [openId, setOpenId] = useState<string | null>(startWith);
    const bot = s.bots.find(b => b.botId) ?? null;
    const list = useMemo(() => {
        const t = q.trim().toLowerCase();
        if (!t) return FIXES;
        return FIXES.filter(f => [f.problem, f.why, ...(f.errors ?? []), ...f.steps].some(x => x.toLowerCase().includes(t)));
    }, [q]);
    return (
        <>
            <input className="vc-tool-input" value={q} placeholder="What's wrong? Type it, or paste the error (like 50013 or Missing Access)…" onChange={e => setQ(e.currentTarget.value)} />
            <div className="vc-bm-fixes">
                {list.map(f => {
                    const isOpen = openId === f.id || (!!q.trim() && list.length <= 2);
                    return (
                        <div key={f.id} className={classes("vc-bm-fix", isOpen && "vc-bm-fix-open")}>
                            <button type="button" className="vc-bm-fix-head" onClick={() => setOpenId(isOpen ? null : f.id)}>
                                <span>{f.icon}</span><b>{f.problem}</b><i>{isOpen ? "−" : "+"}</i>
                            </button>
                            {isOpen && (
                                <div className="vc-bm-fix-body">
                                    <span className="vc-bm-fix-why">{f.why}</span>
                                    <ol>{f.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
                                    {f.portal && <button type="button" className="vc-tool-btn" onClick={() => open(bot ? portalUrl(bot.appId, f.portal) : PORTAL)}>Open the Developer Portal{bot ? ` (${bot.botName ?? bot.name})` : ""} ↗</button>}
                                </div>
                            )}
                        </div>
                    );
                })}
                {!list.length && <span className="vc-tool-hint">Nothing matches that. Try a shorter word, or the error number.</span>}
            </div>
        </>
    );
}

/* ── The window ── */

function ago(t: number) {
    const m = Math.round((Date.now() - t) / 60_000);
    return m < 1 ? "just now" : m < 60 ? `${m} min ago` : new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function BotManager({ modalProps }: { modalProps: RenderModalProps; }) {
    const accent = windowAccent("botManager");
    const s = useBotState();
    const [tab, setTabState] = useState<Tab>(lastTab);
    const [query, setQuery] = useState("");
    const [inviteFor, setInviteFor] = useState<string | null>(null);
    const [fixFor, setFixFor] = useState<string | null>(null);
    const [commandsFor, setCommandsFor] = useState<string | null>(null);
    const [inviteBits, setInviteBits] = useState<number[] | null>(null);
    const go = (t: Tab) => { lastTab = t; setTabState(t); };
    const withBots = s.bots.filter(b => b.botId);
    const watching = withBots.filter(b => isWatched(b.botId!)).length;
    const online = withBots.filter(b => ["online", "idle", "dnd"].includes(statusOf(b.botId))).length;
    return (
        <Window {...modalProps} size="lg" title="Bot Manager" subtitle="Your Discord bots, a step-by-step guide, invites, commands, starter code, hosting and fixes"
            tabs={TABS} tab={tab} onTab={id => go(id as Tab)} flush={tab === "bots" && s.bots.length > 0}
            tools={tab === "bots" && <>
                <label className="vc-sw-search">
                    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                    <input aria-label="Search bots" placeholder="Search" value={query} onChange={e => setQuery(e.currentTarget.value)} />
                </label>
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => open(PORTAL)}>New bot ↗</button>
            </>}
            status={[watching ? `watching ${watching} bot${watching === 1 ? "" : "s"}` : "not watching any bots", `${online} of ${withBots.length} online`]}
            statusRight={s.loadedAt ? `updated ${ago(s.loadedAt)}` : "tokens never read"}>
            <div className="vc-tool-wrap vc-bm" style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <section className="vc-bm-pane" key={tab}>
                    {tab === "bots" && <BotsTab query={query} onInvite={b => { setInviteFor(b.appId); setInviteBits(null); go("invite"); }} onFix={() => { setFixFor("offline"); go("fix"); }} onGuide={() => go("guide")} onCommands={b => { setCommandsFor(b.appId); go("commands"); }} />}
                    {tab === "guide" && <GuideTab go={go} />}
                    {tab === "invite" && <InviteTab initial={inviteFor} initialBits={inviteBits} />}
                    {tab === "commands" && <CommandsTab initial={commandsFor} />}
                    {tab === "builder" && <BuilderTab />}
                    {tab === "starter" && <StarterTab onInvite={bits => { setInviteBits(bits); go("invite"); }} />}
                    {tab === "hosting" && <HostingTab />}
                    {tab === "fix" && <FixTab startWith={fixFor} />}
                </section>
            </div>
        </Window>
    );
}

export function openBotManager() {
    openModal(props => <BotManager modalProps={props} />);
}
