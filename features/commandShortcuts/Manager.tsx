/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { GuildStore, openModal, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { describe, loadRecent, loadShortcuts, runCommand, saveShortcuts, Shortcut, textOf, Used } from ".";

const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const serverName = (id: string | null) => id ? GuildStore.getGuild(id)?.name ?? "a server" : "DMs";

/** The text options can be changed; mentions, emoji and files stay as they were. */
function ValueEditor({ s, onChange }: { s: Shortcut; onChange(next: Shortcut): void; }) {
    const entries = Object.entries(s.values).filter(([, v]) => v.every(n => n?.type === "text"));
    if (!entries.length) return null;
    return (
        <div className="vc-cmdsc-values">
            {entries.map(([name, nodes]) => (
                <label key={name} className="vc-cmdsc-value">
                    <span>{name}</span>
                    <input className="vc-tool-input" value={nodes.map(textOf).join("")} onChange={e => onChange({ ...s, values: { ...s.values, [name]: [{ type: "text", text: e.currentTarget.value }] } })} />
                </label>
            ))}
        </div>
    );
}

function ShortcutsModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const accent = windowAccent("commandShortcuts");
    const [list, setList] = useState<Shortcut[]>(loadShortcuts);
    const [recent] = useState<Used[]>(loadRecent);
    const [editing, setEditing] = useState<string | null>(null);
    const write = (next: Shortcut[]) => { setList(next); saveShortcuts(next); };
    const save = (u: Used) => {
        const s: Shortcut = { ...u, id: Date.now().toString(36), label: (u.command.displayName || u.command.name).replace(/^\w/, c => c.toUpperCase()) };
        write([...list, s]);
        setEditing(s.id);
    };
    const isSaved = (u: Used) => list.some(s => s.command.id === u.command.id && JSON.stringify(s.values) === JSON.stringify(u.values));
    const move = (i: number, d: number) => { const n = [...list]; [n[i], n[i + d]] = [n[i + d], n[i]]; write(n); };

    return (
        <Window {...modalProps} size="lg" title="Command shortcuts" subtitle="Bot commands you use a lot, one click away — from the ⚡ button in the chat bar">
            <div className={classes("vc-tool-wrap", "vc-cmdsc-wrap")} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="⚡" kicker="Command shortcuts" title={list.length ? `${list.length} shortcut${list.length === 1 ? "" : "s"}` : "No shortcuts yet"}
                    sub="Bot commands you use a lot, one click away from the ⚡ button in the chat bar." />
                <span className="vc-tool-label">Your shortcuts</span>
                {list.length ? list.map((s, i) => (
                    <div key={s.id} className="vc-cmdsc-row">
                        <div className="vc-cmdsc-main">
                            {editing === s.id
                                ? <input className="vc-tool-input" autoFocus maxLength={40} value={s.label} onChange={e => write(list.map(x => x.id === s.id ? { ...x, label: e.currentTarget.value } : x))} />
                                : <b>⚡ {s.label}</b>}
                            <code>{describe(s.command, s.values)}</code>
                            <small>Saved from {serverName(s.guildId)}</small>
                            {editing === s.id && <ValueEditor s={s} onChange={next => write(list.map(x => x.id === s.id ? next : x))} />}
                        </div>
                        <div className="vc-cmdsc-tools">
                            <button type="button" className="vc-tool-btn vc-tool-primary" title="Run it in the channel you're looking at" onClick={() => void runCommand(s).then(ok => ok && modalProps.onClose())}>Run</button>
                            <button type="button" className="vc-tool-icon" title={editing === s.id ? "Done" : "Rename or change what it fills in"} onClick={() => setEditing(editing === s.id ? null : s.id)}>{editing === s.id ? "✓" : "✎"}</button>
                            <button type="button" className="vc-tool-icon" disabled={i === 0} title="Move up" onClick={() => move(i, -1)}>▲</button>
                            <button type="button" className="vc-tool-icon" disabled={i === list.length - 1} title="Move down" onClick={() => move(i, 1)}>▼</button>
                            <button type="button" className="vc-tool-icon" title="Delete" onClick={() => write(list.filter(x => x.id !== s.id))}>✕</button>
                        </div>
                    </div>
                )) : <div className="vc-tool-hint">None yet — save one from the commands you ran below.</div>}

                <span className="vc-tool-label">Commands you ran lately</span>
                {recent.length ? recent.map((u, i) => (
                    <div key={i} className="vc-cmdsc-row vc-cmdsc-recent">
                        <div className="vc-cmdsc-main">
                            <code>{describe(u.command, u.values)}</code>
                            <small>{serverName(u.guildId)} · {ago(u.at)}</small>
                        </div>
                        <button type="button" className="vc-tool-btn" disabled={isSaved(u)} onClick={() => save(u)}>{isSaved(u) ? "Saved" : "☆ Save"}</button>
                    </div>
                )) : <div className="vc-tool-hint">Use any bot's slash command the normal way (type / in the chat box), and it shows up here to save.</div>}
                <span className="vc-tool-hint">A shortcut runs in whichever channel you're looking at, just like typing it — the bot has to be in that server. If a bot changes its command, run it once more and save it again.</span>
            </div>
        </Window>
    );
}

export function openShortcuts() {
    openModal(props => <ErrorBoundary><ShortcutsModal modalProps={props} /></ErrorBoundary>);
}
