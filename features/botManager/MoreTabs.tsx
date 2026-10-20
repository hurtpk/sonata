/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Bot Manager's slash command viewer, command builder and hosting guide.

import { copyToClipboard } from "@utils/clipboard";
import { classes } from "@utils/misc";
import { showToast, useEffect, useState } from "@webpack/common";

import { BLANK_SPEC, canChoose, CmdOpt, CmdSpec, jsCode, OPT_TYPES, OptType, problems, pyCode } from "./builder";
import { appCommands, Cmd, CmdOption, COMMAND_TYPES, guildCommands, OPTION_TYPES, usage } from "./commands";
import { sharedServers, useBotState } from "./store";

const open = (url: string) => VencordNative.native.openExternal(url);

/* ── Slash command viewer ── */

function OptionRow({ o, depth = 0 }: { o: CmdOption; depth?: number; }) {
    return (
        <>
            <div className="vc-bm-opt" style={{ paddingLeft: 10 + depth * 16 }}>
                <code>{o.type <= 2 ? o.name : `${o.name}${o.required ? "" : "?"}`}</code>
                <span className="vc-bm-opt-type">{OPTION_TYPES[o.type] ?? "option"}{o.autocomplete ? " · suggestions" : ""}{o.min_value != null || o.max_value != null ? ` · ${o.min_value ?? "…"}–${o.max_value ?? "…"}` : ""}</span>
                <span className="vc-bm-opt-desc">{o.description}</span>
                {!!o.choices?.length && <span className="vc-bm-opt-choices">{o.choices.slice(0, 12).map(c => c.name).join(" · ")}{o.choices.length > 12 ? ` · +${o.choices.length - 12}` : ""}</span>}
            </div>
            {o.options?.map(sub => <OptionRow key={sub.name} o={sub} depth={depth + 1} />)}
        </>
    );
}

export function CommandsTab({ initial }: { initial: string | null; }) {
    const s = useBotState();
    const choices = s.bots.filter(b => b.botId);
    const [appId, setAppId] = useState(initial ?? choices[0]?.appId ?? "");
    const bot = choices.find(b => b.appId === appId) ?? null;
    const servers = bot?.botId ? sharedServers(bot.botId) : [];
    const [where, setWhere] = useState<string>("everywhere");
    const [cmds, setCmds] = useState<Cmd[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const [q, setQ] = useState("");
    useEffect(() => { if (!appId && choices[0]) setAppId(choices[0].appId); }, [choices.length]);
    useEffect(() => { setWhere("everywhere"); }, [appId]);
    useEffect(() => {
        if (!appId) return;
        let stop = false;
        setBusy(true); setFailed(false);
        void (where === "everywhere" ? appCommands(appId) : guildCommands(where, appId)).then(r => {
            if (stop) return;
            setBusy(false);
            if (r === null) { setFailed(true); setCmds([]); } else setCmds(r);
        });
        return () => { stop = true; };
    }, [appId, where]);
    const t = q.trim().toLowerCase();
    const shown = (cmds ?? []).filter(c => !t || c.name.includes(t) || c.description.toLowerCase().includes(t)).sort((a, b) => a.type - b.type || a.name.localeCompare(b.name));

    if (!choices.length) return <div className="vc-tool-empty"><span className="vc-tool-empty-icon">⌨️</span>Your bots show up here once you've made one.</div>;
    return (
        <>
            <div className="vc-bm-cmd-bar">
                <select className="vc-tool-select" value={appId} onChange={e => setAppId(e.currentTarget.value)}>{choices.map(b => <option key={b.appId} value={b.appId}>{b.botName ?? b.name}</option>)}</select>
                <select className="vc-tool-select" value={where} onChange={e => setWhere(e.currentTarget.value)}>
                    <option value="everywhere">Everywhere (global commands)</option>
                    {servers.map(g => <option key={g.id} value={g.id}>In {g.name}</option>)}
                </select>
                <input className="vc-tool-input vc-tool-grow" value={q} placeholder="Find a command…" onChange={e => setQ(e.currentTarget.value)} />
            </div>
            <span className="vc-tool-hint">{busy ? "Loading…" : failed ? "Discord didn't share this list — try another server, or check the bot is invited with the applications.commands scope." : `${shown.length} command${shown.length === 1 ? "" : "s"}${where === "everywhere" ? " that work everywhere" : " in this server (including its own commands)"}.`}</span>
            <div className="vc-bm-cmds">
                {shown.map(c => (
                    <div key={c.id} className="vc-bm-cmd">
                        <div className="vc-bm-cmd-head">
                            <code>{usage(c)}</code>
                            {c.type !== 1 && <span className="vc-tool-badge">{COMMAND_TYPES[c.type]}</span>}
                            {c.guildId && <span className="vc-tool-badge">This server only</span>}
                            {c.defaultPerms === "0" && <span className="vc-tool-badge">Admins only</span>}
                            {c.defaultPerms && c.defaultPerms !== "0" && <span className="vc-tool-badge">Needs a permission</span>}
                            <span className="vc-tool-spacer" />
                            <button type="button" className="vc-tool-link" title="Copy the command's ID" onClick={() => { copyToClipboard(c.id); showToast("Copied the command ID", "success"); }}>ID</button>
                        </div>
                        {c.description && <span className="vc-bm-cmd-desc">{c.description}</span>}
                        {c.options.length > 0 && <div className="vc-bm-opts">{c.options.map(o => <OptionRow key={o.name} o={o} />)}</div>}
                    </div>
                ))}
                {!busy && !failed && cmds && !cmds.length && (
                    <div className="vc-tool-empty"><span className="vc-tool-empty-icon">🫥</span>No commands {where === "everywhere" ? "registered yet" : "here"}. If your code registers them, check its log for errors and that it was invited with "applications.commands".</div>
                )}
            </div>
        </>
    );
}

/* ── Command builder ── */

function CodeBox({ title, code, hint }: { title: string; code: string; hint?: string; }) {
    return (
        <div className="vc-bm-code">
            <div className="vc-tool-row">
                <b>{title}</b>
                <span className="vc-tool-spacer" />
                <button type="button" className="vc-tool-btn" onClick={() => { copyToClipboard(code); showToast("Copied", "success"); }}>Copy</button>
            </div>
            {hint && <span className="vc-tool-hint">{hint}</span>}
            <pre>{code}</pre>
        </div>
    );
}

export function BuilderTab() {
    const [s, setS] = useState<CmdSpec>(BLANK_SPEC);
    const [lang, setLang] = useState<"js" | "py">("js");
    const set = (p: Partial<CmdSpec>) => setS(x => ({ ...x, ...p }));
    const setOpt = (i: number, p: Partial<CmdOpt>) => set({ options: s.options.map((o, j) => j === i ? { ...o, ...p } : o) });
    const issues = problems(s);
    const js = issues.length ? null : jsCode(s);
    const py = issues.length ? null : pyCode(s);
    const fills = s.options.map(o => `{${o.name}}`).join(" ");

    return (
        <div className="vc-bm-builder">
            <div className="vc-bm-builder-form">
                <div className="vc-tool-grid2">
                    <label className="vc-tool-field">
                        <span className="vc-tool-label">Command</span>
                        <div className="vc-bm-slash"><span>/</span><input className="vc-tool-input" value={s.name} maxLength={32} onChange={e => set({ name: e.currentTarget.value.toLowerCase().replace(/\s+/g, "-") })} /></div>
                    </label>
                    <label className="vc-tool-field">
                        <span className="vc-tool-label">What it does</span>
                        <input className="vc-tool-input" value={s.description} maxLength={100} onChange={e => set({ description: e.currentTarget.value })} />
                    </label>
                </div>

                <div className="vc-tool-row"><span className="vc-tool-label">Options · {s.options.length}</span><span className="vc-tool-spacer" />
                    <button type="button" className="vc-tool-btn" disabled={s.options.length >= 25} onClick={() => set({ options: [...s.options, { type: "string", name: `option${s.options.length + 1}`, description: "", required: false, choices: [] }] })}>＋ Add option</button>
                </div>
                <div className="vc-bm-bopts">
                    {s.options.map((o, i) => (
                        <div key={i} className="vc-bm-bopt">
                            <div className="vc-bm-bopt-row">
                                <select className="vc-tool-select" value={o.type} onChange={e => setOpt(i, { type: e.currentTarget.value as OptType, choices: canChoose(e.currentTarget.value as OptType) ? o.choices : [] })}>
                                    {OPT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                                <input className="vc-tool-input" value={o.name} placeholder="name" maxLength={32} onChange={e => setOpt(i, { name: e.currentTarget.value.toLowerCase().replace(/[\s-]+/g, "_") })} />
                                <input className="vc-tool-input vc-tool-grow" value={o.description} placeholder="What to put here" maxLength={100} onChange={e => setOpt(i, { description: e.currentTarget.value })} />
                                <label className="vc-tool-check"><input type="checkbox" checked={o.required} onChange={e => setOpt(i, { required: e.currentTarget.checked })} /> Required</label>
                                <button type="button" className="vc-bm-x" aria-label="Remove option" onClick={() => set({ options: s.options.filter((_, j) => j !== i) })}>✕</button>
                            </div>
                            {canChoose(o.type) && (
                                <div className="vc-bm-choices">
                                    {o.choices.map((c, j) => (
                                        <span key={j} className="vc-bm-choice">
                                            <input value={c.name} placeholder="Shown as" onChange={e => setOpt(i, { choices: o.choices.map((x, k) => k === j ? { ...x, name: e.currentTarget.value } : x) })} />
                                            <input value={c.value} placeholder="value" onChange={e => setOpt(i, { choices: o.choices.map((x, k) => k === j ? { ...x, value: e.currentTarget.value } : x) })} />
                                            <button type="button" aria-label="Remove choice" onClick={() => setOpt(i, { choices: o.choices.filter((_, k) => k !== j) })}>✕</button>
                                        </span>
                                    ))}
                                    <button type="button" className="vc-tool-link" onClick={() => setOpt(i, { choices: [...o.choices, { name: "", value: "" }] })}>＋ {o.choices.length ? "Another choice" : "Only allow certain choices"}</button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <label className="vc-tool-field">
                    <span className="vc-tool-label">It replies with</span>
                    <textarea className="vc-tool-area vc-bm-reply" value={s.reply} rows={2} onChange={e => set({ reply: e.currentTarget.value })} />
                    {fills && <span className="vc-tool-hint">Use {fills} to put in what was typed.</span>}
                </label>
                <div className="vc-ts-toggles vc-bm-toggles">
                    <label className="vc-tool-check"><input type="checkbox" checked={s.private} onChange={e => set({ private: e.currentTarget.checked })} /> Only the person who used it sees the reply</label>
                    <label className="vc-tool-check"><input type="checkbox" checked={s.adminOnly} onChange={e => set({ adminOnly: e.currentTarget.checked })} /> Only for people who can manage the server</label>
                </div>
            </div>

            <div className="vc-bm-builder-code">
                <div className="vc-tool-seg">
                    <button type="button" className={classes("vc-tool-seg-btn", lang === "js" && "vc-tool-seg-on")} onClick={() => setLang("js")}>JavaScript</button>
                    <button type="button" className={classes("vc-tool-seg-btn", lang === "py" && "vc-tool-seg-on")} onClick={() => setLang("py")}>Python</button>
                </div>
                {issues.length ? (
                    <div className="vc-bm-warn vc-bm-warn-soft"><b>Almost there:</b><ul>{issues.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                ) : lang === "js" ? (
                    <>
                        <CodeBox title="1. The command" code={js!.def} hint="In index.js, paste this inside const commands = [ … ]." />
                        <CodeBox title="2. What it does" code={js!.handler} hint="Paste this inside client.on(Events.InteractionCreate, …), after the other commands." />
                        {(js!.def.includes("PermissionFlagsBits") || js!.handler.includes("MessageFlags")) && <span className="vc-tool-hint">Make sure {[js!.def.includes("PermissionFlagsBits") && "PermissionFlagsBits", js!.handler.includes("MessageFlags") && "MessageFlags"].filter(Boolean).join(" and ")} is in the require("discord.js") line at the top.</span>}
                    </>
                ) : (
                    <>
                        {py!.imports && <CodeBox title="At the top" code={py!.imports} hint="Add this next to the other imports in bot.py." />}
                        <CodeBox title="The command" code={py!.code} hint="In bot.py, paste this above the last lines (token = …)." />
                    </>
                )}
                <span className="vc-tool-hint">Restart the bot afterwards — the starter project registers its commands when it starts.</span>
            </div>
        </div>
    );
}

/* ── Hosting guide ── */

interface Host { icon: string; title: string; cost: string; good: string; bad: string; steps: string[]; }

const HOSTS: Host[] = [
    {
        icon: "🖥", title: "This PC", cost: "Free", good: "Easiest — nothing to set up. Great for testing.",
        bad: "The bot is offline whenever the PC is off, asleep or the window is closed.",
        steps: [
            "Double-click Start bot.bat and leave the window open.",
            "Stop the PC from sleeping: Settings → System → Power → Screen and sleep → \"Never\" while plugged in.",
            "Start it with Windows: press Win+R, type shell:startup, and put a shortcut to Start bot.bat in that folder.",
        ],
    },
    {
        icon: "🍓", title: "A spare computer at home", cost: "Free, or a small one-off cost", good: "Always on, and it's yours — an old laptop or a Raspberry Pi works.",
        bad: "Needs a little setup, and it stops if your power or internet goes out.",
        steps: [
            "Install Node.js or Python on it, and copy your bot's folder over (a USB stick is fine).",
            "Run the bot with a process manager that restarts it if it crashes: npm install -g pm2, then pm2 start index.js --name my-bot (Python: pm2 start bot.py --interpreter python3).",
            "Make it start after a reboot: pm2 save, then pm2 startup (and run the command it prints).",
        ],
    },
    {
        icon: "☁️", title: "A small rented server (VPS)", cost: "A few dollars a month", good: "Reliable, always online, fast — what most serious bots use.",
        bad: "You manage it yourself (a Linux server you control from a terminal).",
        steps: [
            "Rent the smallest Linux server (Ubuntu) from any VPS company — a bot needs very little.",
            "Connect to it (ssh), install Node.js or Python, and upload your bot's folder (for example with git, or an SFTP app).",
            "Put the token in the .env file on the server, then run it with pm2 like above, so it restarts and survives reboots.",
        ],
    },
    {
        icon: "🚀", title: "A bot hosting service", cost: "Free plans exist; paid ones are a few dollars", good: "No server to manage — upload the project and press start.",
        bad: "Free plans often sleep, limit hours or restart a lot. Check what you get before relying on it.",
        steps: [
            "Make an account, start a new Node.js or Python app, and upload your bot's folder (or link a private GitHub repo).",
            "Add the token as a secret / environment variable called TOKEN in the dashboard — don't upload the .env file.",
            "Set the start command to npm start (JavaScript) or python bot.py (Python), and start it.",
        ],
    },
];

export function HostingTab() {
    const [openI, setOpenI] = useState(0);
    return (
        <>
            <span className="vc-tool-hint">A bot is online only while its program runs. Here are the ways to keep it running — start on this PC, and move when you need it on 24/7.</span>
            <div className="vc-bm-hosts">
                {HOSTS.map((h, i) => (
                    <div key={h.title} className={classes("vc-bm-host", openI === i && "vc-bm-host-open")}>
                        <button type="button" className="vc-bm-host-head" onClick={() => setOpenI(openI === i ? -1 : i)}>
                            <span className="vc-bm-host-icon">{h.icon}</span>
                            <span className="vc-bm-host-text"><b>{h.title}</b><small>{h.cost}</small></span>
                            <i>{openI === i ? "−" : "+"}</i>
                        </button>
                        {openI === i && (
                            <div className="vc-bm-host-body">
                                <div className="vc-bm-proscons"><span className="vc-bm-pro">👍 {h.good}</span><span className="vc-bm-con">👎 {h.bad}</span></div>
                                <ol>{h.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <div className="vc-bm-warn vc-bm-warn-soft">🔑 Wherever it runs: keep the token in .env or the host's secrets, never in the code, and never in a public GitHub repo — Discord resets tokens it finds there, and anyone else can find them too.</div>
            <div className="vc-tool-row">
                <button type="button" className="vc-tool-btn" onClick={() => open("https://pm2.keymetrics.io/docs/usage/quick-start/")}>pm2 quick start ↗</button>
            </div>
        </>
    );
}
