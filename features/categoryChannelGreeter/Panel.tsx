/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Channel Greeter window: your greeters on the left, the chosen one's
// setup on the right (where, who to wait for, the messages), and what's being
// watched and what was sent underneath.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildMemberStore, GuildStore, NavigationRouter, openModal, SortedGuildStore, useEffect, useMemo, useReducer, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { cancelWatch, getRules, saveRules, settings } from "./index";
import { clearLog, newRule, onGreeterChange, previewOf, Rule, sentLog, Trigger, VARIABLES, watching } from "./rules";

const cl = classNameFactory("vc-tool-");
const cg = classNameFactory("vc-cg-");

const guildIcon = (g: any, size = 32) => g?.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=${size}` : null;
const ago = (t: number) => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(t).toLocaleDateString();
};

function GuildBadge({ guildId, size = 22 }: { guildId: string; size?: number; }) {
    const g: any = guildId ? GuildStore.getGuild(guildId) : null;
    const icon = guildIcon(g, 64);
    return icon
        ? <img className={cg("gicon")} src={icon} alt="" style={{ width: size, height: size }} />
        : <span className={cg("gicon")} style={{ width: size, height: size }}>{g?.name?.[0] ?? "?"}</span>;
}

/** Search the server's members you've seen (and bots), or paste an ID. */
function MemberPicker({ guildId, value, onChange }: { guildId: string; value: string; onChange(id: string): void; }) {
    const [q, setQ] = useState("");
    const picked: any = value ? UserStore.getUser(value) : null;
    const results = useMemo(() => {
        if (!guildId) return [];
        const query = q.trim().toLowerCase();
        if (/^\d{15,21}$/.test(query)) return [{ id: query, name: "Use this ID", sub: query, avatar: undefined as string | undefined, bot: false }];
        return (GuildMemberStore.getMembers(guildId) ?? [])
            .map((m: any) => {
                const u: any = UserStore.getUser(m.userId);
                return u && { id: u.id, name: m.nick || u.globalName || u.username, sub: u.username, avatar: u.getAvatarURL?.(guildId, 32, false), bot: !!u.bot };
            })
            .filter((x: any) => x && (!query || x.name.toLowerCase().includes(query) || x.sub.toLowerCase().includes(query)))
            // Bots first — they're usually what opens these channels.
            .sort((a: any, b: any) => Number(b.bot) - Number(a.bot) || a.name.localeCompare(b.name))
            .slice(0, 8);
    }, [guildId, q]);

    if (picked || (value && !q)) {
        return (
            <div className={cg("picked")}>
                {picked?.getAvatarURL ? <img src={picked.getAvatarURL(guildId, 32, false)} alt="" /> : <span className={cg("gicon")}>?</span>}
                <span className={cg("picked-name")}>{picked ? picked.globalName || picked.username : value}{picked?.bot && <span className={cg("bot")}>BOT</span>}</span>
                <button type="button" className={cl("btn")} onClick={() => { onChange(""); setQ(""); }}>Change</button>
            </div>
        );
    }
    return (
        <div className={cg("picker")}>
            <input className={cl("input")} value={q} placeholder={guildId ? "Search members and bots, or paste a user ID" : "Pick a server first"} disabled={!guildId} onChange={e => setQ(e.currentTarget.value)} />
            {q && (
                <div className={cg("results")}>
                    {results.length ? results.map((r: any) => (
                        <button key={r.id} type="button" className={cg("result")} onClick={() => { onChange(r.id); setQ(""); }}>
                            {r.avatar ? <img src={r.avatar} alt="" /> : <span className={cg("gicon")}>#</span>}
                            <span>{r.name}{r.bot && <span className={cg("bot")}>BOT</span>}</span>
                            <span className={cl("hint")}>{r.sub}</span>
                        </button>
                    )) : <div className={cl("hint")}>No one found — only members Discord has loaded show here. You can paste their user ID instead.</div>}
                </div>
            )}
        </div>
    );
}

function Editor({ rule, update, remove }: { rule: Rule; update(p: Partial<Rule>): void; remove(): void; }) {
    const guilds = (SortedGuildStore.getFlattenedGuildIds?.() ?? Object.keys(GuildStore.getGuilds())).map((id: string) => GuildStore.getGuild(id)).filter(Boolean) as any[];
    const categories = rule.guildId
        ? Object.values(ChannelStore.getMutableGuildChannelsForGuild(rule.guildId) ?? {}).filter((c: any) => c.type === 4).sort((a: any, b: any) => a.position - b.position) as any[]
        : [];
    const [previewIdx, setPreviewIdx] = useState(0);
    const msgs = rule.messages.length ? rule.messages : [""];
    const setMsg = (i: number, text: string) => update({ messages: msgs.map((m, j) => j === i ? text : m) });
    const insertVar = (key: string) => {
        const i = Math.min(previewIdx, msgs.length - 1);
        setMsg(i, `${msgs[i]}${msgs[i] && !msgs[i].endsWith(" ") ? " " : ""}${key}`);
    };
    const ready = rule.guildId && rule.categoryId && (rule.trigger !== "user" || rule.triggerUserId) && msgs.some(m => m.trim());

    return (
        <div className={cg("editor")}>
            <div className={cl("row")}>
                <input className={classes(cl("input"), cg("title"))} value={rule.name} maxLength={40} onChange={e => update({ name: e.currentTarget.value })} aria-label="Greeter name" />
                <label className={cg("switch")} title={rule.on ? "On" : "Off"}>
                    <input type="checkbox" checked={rule.on} onChange={e => update({ on: e.currentTarget.checked })} />
                    <span />
                </label>
            </div>
            {!ready && <div className={cg("todo")}>Finish setting this up: {[!rule.guildId && "pick a server", rule.guildId && !rule.categoryId && "pick a category", rule.trigger === "user" && !rule.triggerUserId && "pick who to wait for", !msgs.some(m => m.trim()) && "write a message"].filter(Boolean).join(", ")}.</div>}

            <section className={cl("card")}>
                <span className={cl("label")}>1 · Where</span>
                <div className={cg("grid2")}>
                    <label className={cg("field")}>
                        <span className={cl("hint")}>Server</span>
                        <select className={cl("input")} value={rule.guildId} onChange={e => update({ guildId: e.currentTarget.value, categoryId: "", triggerUserId: "" })}>
                            <option value="">Choose a server…</option>
                            {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                    </label>
                    <label className={cg("field")}>
                        <span className={cl("hint")}>Category new channels appear in</span>
                        <select className={cl("input")} value={rule.categoryId} disabled={!rule.guildId} onChange={e => update({ categoryId: e.currentTarget.value })}>
                            <option value="">{rule.guildId ? categories.length ? "Choose a category…" : "No categories here" : "Pick a server first"}</option>
                            {categories.map(c => <option key={c.id} value={c.id}>📁 {c.name}</option>)}
                        </select>
                    </label>
                </div>
            </section>

            <section className={cl("card")}>
                <span className={cl("label")}>2 · Wait for</span>
                <div className={cl("seg")}>
                    {([["user", "A member or bot"], ["anyone", "Anyone's first message"], ["nobody", "Don't wait"]] as [Trigger, string][]).map(([id, label]) => (
                        <button key={id} type="button" className={classes(cl("seg-btn"), rule.trigger === id && cl("seg-on"))} onClick={() => update({ trigger: id })}>{label}</button>
                    ))}
                </div>
                {rule.trigger === "user" && <MemberPicker guildId={rule.guildId} value={rule.triggerUserId} onChange={id => update({ triggerUserId: id })} />}
                {rule.trigger !== "nobody" && (
                    <input className={cl("input")} value={rule.keyword} placeholder="Only if their message contains… (optional)" onChange={e => update({ keyword: e.currentTarget.value })} />
                )}
                <span className={cl("hint")}>{rule.trigger === "nobody" ? "Greets as soon as the channel is created." : "Greets after their first matching message in the new channel."}</span>
                <div className={cl("row")}>
                    <span className={cl("hint")}>Then wait</span>
                    <input type="range" className={cg("range")} min={0} max={30} step={0.5} value={rule.delaySec} onChange={e => update({ delaySec: Number(e.currentTarget.value) })} />
                    <span className={cg("value")}>{rule.delaySec ? `${rule.delaySec} s` : "No delay"}</span>
                </div>
            </section>

            <section className={cl("card")}>
                <div className={cl("row")}>
                    <span className={cl("label")}>3 · Say</span>
                    <span className={cl("spacer")} />
                    <div className={cl("seg")}>
                        <button type="button" className={classes(cl("seg-btn"), rule.order === "random" && cl("seg-on"))} onClick={() => update({ order: "random" })}>🎲 Random</button>
                        <button type="button" className={classes(cl("seg-btn"), rule.order === "sequence" && cl("seg-on"))} onClick={() => update({ order: "sequence", next: 0 })}>🔁 In order</button>
                    </div>
                </div>
                {msgs.map((m, i) => (
                    <div key={i} className={classes(cg("msg"), previewIdx === i && cg("msg-on"))}>
                        <textarea className={cl("area")} rows={2} value={m} placeholder="Type a greeting…" onFocus={() => setPreviewIdx(i)} onChange={e => setMsg(i, e.currentTarget.value)} />
                        {msgs.length > 1 && <button type="button" className={cg("x")} onClick={() => { update({ messages: msgs.filter((_, j) => j !== i) }); setPreviewIdx(0); }} aria-label="Remove this message">✕</button>}
                    </div>
                ))}
                <div className={cl("row")}>
                    <button type="button" className={cl("btn")} onClick={() => { update({ messages: [...msgs, ""] }); setPreviewIdx(msgs.length); }}>＋ Add a message</button>
                    <span className={cl("hint")}>{msgs.length > 1 ? `${rule.order === "random" ? "One is picked at random" : "They're sent in turn"} each time.` : "Add more to vary it."}</span>
                </div>
                <div className={cg("vars")}>
                    {VARIABLES.map(v => <button key={v.key} type="button" className={cg("var")} title={v.label} onClick={() => insertVar(v.key)}>{v.key}</button>)}
                </div>
                <div className={cg("preview")}>
                    <span className={cl("label")}>Preview</span>
                    <div className={cg("bubble")}>{previewOf(msgs[Math.min(previewIdx, msgs.length - 1)] || "…", rule) || "…"}</div>
                </div>
            </section>

            <div className={cl("row")}>
                <span className={cl("spacer")} />
                <button type="button" className={classes(cl("btn"), cg("danger"))} onClick={remove}>Delete this greeter</button>
            </div>
        </div>
    );
}

function Activity() {
    const watches = [...watching.values()];
    return (
        <div className={cg("activity")}>
            <section>
                <div className={cg("heading")}>👀 Watching now {watches.length ? `(${watches.length})` : ""}</div>
                {watches.length ? watches.map(w => {
                    const ch: any = ChannelStore.getChannel(w.channelId);
                    const rule = getRules().find(r => r.id === w.ruleId);
                    return (
                        <div key={w.channelId} className={cg("item")}>
                            <GuildBadge guildId={ch?.guild_id} size={20} />
                            <span className={cg("item-main")}>#{ch?.name ?? "channel"} <span className={cl("hint")}>· {rule?.name} · gives up in {Math.max(1, Math.round((w.until - Date.now()) / 60000))} min</span></span>
                            <button type="button" className={cl("btn")} onClick={() => cancelWatch(w.channelId)}>Stop</button>
                        </div>
                    );
                }) : <div className={cl("hint")}>Nothing right now. New channels in your categories show up here while they wait.</div>}
            </section>
            <section>
                <div className={cl("row")}>
                    <div className={cg("heading")}>💬 Recent greetings</div>
                    <span className={cl("spacer")} />
                    {sentLog.length > 0 && <button type="button" className={cg("link")} onClick={clearLog}>Clear</button>}
                </div>
                {sentLog.length ? sentLog.slice(0, 12).map((e, i) => (
                    <button key={i} type="button" className={classes(cg("item"), cg("item-btn"))} title="Go to the channel"
                        onClick={() => e.guildId && NavigationRouter.transitionTo(`/channels/${e.guildId}/${e.channelId}`)}>
                        <GuildBadge guildId={e.guildId ?? ""} size={20} />
                        <span className={cg("item-main")}>
                            #{e.channelName} <span className={cl("hint")}>· {e.ruleName} · {ago(e.t)}</span>
                            <span className={cg("sent-text")}>{e.text}</span>
                        </span>
                    </button>
                )) : <div className={cl("hint")}>Nothing sent yet.</div>}
            </section>
        </div>
    );
}

function GreeterModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const accent = windowAccent("categoryChannelGreeter");
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => onGreeterChange(bump), []);
    const s = settings.use(["active", "rules"]);
    const rules = getRules();
    const [selected, setSelected] = useState<string | null>(rules[0]?.id ?? null);
    const rule = rules.find(r => r.id === selected) ?? rules[0];

    const update = (id: string, p: Partial<Rule>) => saveRules(getRules().map(r => r.id === id ? { ...r, ...p } : r));
    const add = () => { const r = newRule(rules.length + 1); saveRules([...rules, r]); setSelected(r.id); };

    return (
        <Window {...modalProps} size="lg" title="Channel Greeter" subtitle="Greets new channels in a category — like tickets — the moment someone posts">
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon={s.active ? "👋" : "⏸️"} kicker={s.active ? "Greeting" : "Paused"}
                    title={s.active ? `${rules.filter(r => r.on).length} of ${rules.length} greeter${rules.length === 1 ? "" : "s"} running` : "Nothing will be sent"}
                    sub={s.active ? "New channels in your categories get greeted the moment someone posts." : "Resume to start greeting new channels again."}
                    numbers={[{ value: rules.length, label: rules.length === 1 ? "greeter" : "greeters" }, { value: sentLog.length, label: "sent" }]}>
                    <button type="button" className={classes(cl("btn"), !s.active && cl("primary"))} onClick={() => { settings.store.active = !s.active; }}>{s.active ? "Pause all" : "▶ Resume"}</button>
                </ToolHero>

                <div className={cg("layout")}>
                    <nav className={cg("list")}>
                        {rules.map(r => {
                            const cat: any = r.categoryId ? ChannelStore.getChannel(r.categoryId) : null;
                            return (
                                <button key={r.id} type="button" className={classes(cg("rule"), rule?.id === r.id && cg("rule-on"), !r.on && cg("rule-off"))} onClick={() => setSelected(r.id)}>
                                    <GuildBadge guildId={r.guildId} />
                                    <span className={cg("rule-text")}>
                                        <span className={cg("rule-name")}>{r.name || "Untitled"}</span>
                                        <span className={cl("hint")}>{cat ? `📁 ${cat.name}` : "Not set up yet"}</span>
                                    </span>
                                    <span className={classes(cg("pip"), r.on && cg("pip-on"))} />
                                </button>
                            );
                        })}
                        <button type="button" className={classes(cg("rule"), cg("add"))} onClick={add}>＋ New greeter</button>
                    </nav>
                    <div className={cg("main")}>
                        {rule
                            ? <Editor key={rule.id} rule={rule} update={p => update(rule.id, p)} remove={() => { saveRules(rules.filter(r => r.id !== rule.id)); setSelected(null); }} />
                            : <div className={cg("empty")}>👋 No greeters yet.<br /><button type="button" className={classes(cl("btn"), cl("primary"))} onClick={add}>Create your first greeter</button></div>}
                    </div>
                </div>

                <Activity />
            </div>
        </Window>
    );
}

export function openGreeter() {
    openModal(props => <GreeterModal modalProps={props} />);
}
