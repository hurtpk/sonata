/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildStore, NavigationRouter, showToast, useEffect, useReducer, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { openSection } from "../_shared/Hub";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { newReminder, remindersRunning } from "../reminders";
import { addItem, addLines, asText, clearDone, getList, getLists, Item, loadTodos, moveItem, onTodoChange, removeItem, renameItem, toggleItem } from "./store";

const cl = classNameFactory("vc-tool-");
const td = classNameFactory("vc-todo-");

export function useTodos() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { void loadTodos(); return onTodoChange(bump); }, []);
    return getLists();
}

/** "#general · My Server", "Sam" (DM), "Group with Sam, Alex". */
export function channelTitle(channelId: string) {
    const ch: any = ChannelStore.getChannel(channelId);
    if (!ch) return "A channel";
    if (ch.type === 1) {
        const u: any = UserStore.getUser(ch.recipients?.[0]);
        return u?.globalName || u?.username || "A DM";
    }
    if (ch.type === 3) return ch.name || "Group DM";
    const g = GuildStore.getGuild(ch.guild_id);
    return `#${ch.name}${g ? ` · ${g.name}` : ""}`;
}

function ItemRow({ channelId, item, index, dragging, setDragging }: { channelId: string; item: Item; index: number; dragging: string | null; setDragging(id: string | null): void; }) {
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState(item.text);
    const jump = item.link && (() => {
        const ch: any = ChannelStore.getChannel(channelId);
        NavigationRouter.transitionTo(`/channels/${ch?.guild_id ?? "@me"}/${channelId}/${item.link!.messageId}`);
    });

    return (
        <div className={classes(td("item"), item.done && td("item-done"), dragging === item.id && td("item-dragging"))}
            draggable={!editing}
            onDragStart={e => { setDragging(item.id); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => setDragging(null)}
            onDragOver={e => { if (dragging && dragging !== item.id) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
            onDrop={e => { e.preventDefault(); if (dragging) moveItem(channelId, dragging, index); setDragging(null); }}>
            <span className={td("grip")} aria-hidden>⋮⋮</span>
            <button type="button" role="checkbox" aria-checked={item.done} className={classes(td("check"), item.done && td("check-on"))} onClick={() => toggleItem(channelId, item.id)}>
                {item.done && <svg viewBox="0 0 16 16" aria-hidden><path d="M3.5 8.5l3 3 6-7" /></svg>}
            </button>
            {editing ? (
                <input className={classes(cl("input"), td("edit"))} autoFocus value={text} onChange={e => setText(e.currentTarget.value)}
                    onBlur={() => { renameItem(channelId, item.id, text); setEditing(false); }}
                    onKeyDown={e => {
                        if (e.key === "Enter") { renameItem(channelId, item.id, text); setEditing(false); }
                        if (e.key === "Escape") { e.stopPropagation(); setText(item.text); setEditing(false); }
                    }} />
            ) : (
                <span className={td("text")} onDoubleClick={() => { setText(item.text); setEditing(true); }} title="Double-click to edit">{item.text}</span>
            )}
            <span className={td("tools")}>
                {jump && <button type="button" title={`Go to ${item.link!.author ? `${item.link!.author}'s ` : "the "}message`} onClick={jump}>↗</button>}
                {remindersRunning() && !item.done && <button type="button" title="Remind me about this" onClick={() => newReminder(item.text, item.link ? { channelId, messageId: item.link.messageId, author: item.link.author } : undefined)}>⏰</button>}
                <button type="button" title="Edit" onClick={() => { setText(item.text); setEditing(true); }}>✎</button>
                <button type="button" title="Delete" onClick={() => removeItem(channelId, item.id)}>✕</button>
            </span>
        </div>
    );
}

function ListView({ channelId }: { channelId: string; }) {
    useTodos();
    const list = getList(channelId);
    const [draft, setDraft] = useState("");
    const [dragging, setDragging] = useState<string | null>(null);
    const open = list.items.filter(i => !i.done).length, done = list.items.length - open;

    const add = () => {
        if (draft.includes("\n")) addLines(channelId, draft);
        else addItem(channelId, draft);
        setDraft("");
    };

    return (
        <>
            <div className={td("add")}>
                <input className={cl("input")} autoFocus placeholder="Add something… (paste a list to add every line)" value={draft}
                    onChange={e => setDraft(e.currentTarget.value)}
                    onPaste={e => {
                        const t = e.clipboardData.getData("text");
                        if (t.includes("\n")) { e.preventDefault(); addLines(channelId, t); }
                    }}
                    onKeyDown={e => { if (e.key === "Enter") add(); }} />
                <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={!draft.trim()} onClick={add}>Add</button>
            </div>

            {list.items.length ? (
                <div className={td("items")}>
                    {list.items.map((it, i) => <ItemRow key={it.id} channelId={channelId} item={it} index={i} dragging={dragging} setDragging={setDragging} />)}
                </div>
            ) : (
                <div className={classes(cl("hint"), td("empty"))}>Nothing here yet. Add things above, or right-click a message → Add to to-do list.</div>
            )}

            <div className={cl("footer")}>
                <span className={cl("hint")}>{list.items.length ? `${open} to do${done ? ` · ${done} done` : ""}` : ""}</span>
                <span className={cl("spacer")} />
                {done > 0 && <button type="button" className={cl("btn")} onClick={() => clearDone(channelId)}>Clear done</button>}
                {list.items.length > 0 && (
                    <button type="button" className={cl("btn")} title="Put the list in your message box, as a checklist" onClick={() => {
                        insertTextIntoChatInputBox(asText(list, `To-do · ${channelTitle(channelId)}`));
                        showToast("Added to your message", "success");
                    }}>Share in chat</button>
                )}
            </div>
        </>
    );
}

function AllLists({ onPick }: { onPick(channelId: string): void; }) {
    const lists = Object.values(useTodos()).filter(l => l.items.length);
    if (!lists.length) return <div className={cl("empty")}><span className={cl("empty-icon")}>📝</span>No lists anywhere yet. Open any chat and add things — each chat has its own list.</div>;
    return (
        <div className={td("all")}>
            {lists.sort((a, b) => b.items.filter(i => !i.done).length - a.items.filter(i => !i.done).length).map(l => {
                const open = l.items.filter(i => !i.done).length;
                const pct = Math.round((l.items.length - open) / l.items.length * 100);
                return (
                    <button key={l.channelId} type="button" className={classes(td("list"), !open && td("list-done"))} onClick={() => onPick(l.channelId)}>
                        <span className={td("list-name")}>{channelTitle(l.channelId)}</span>
                        <span className={td("list-count")}>{open ? `${open} to do` : "All done ✓"}</span>
                        <span className={td("list-peek")}>{open ? l.items.filter(i => !i.done).slice(0, 3).map(i => i.text).join(" · ") : `${l.items.length} things ticked off`}</span>
                        <span className={td("list-bar")}><i style={{ width: `${pct}%` }} /></span>
                    </button>
                );
            })}
        </div>
    );
}

function TodoModal({ modalProps, channelId }: { modalProps: RenderModalProps; channelId: string | null; }) {
    const accent = windowAccent("todoLists");
    const [tab, setTab] = useState<"here" | "all">(channelId ? "here" : "all");
    const [picked, setPicked] = useState<string | null>(channelId);
    const showing = tab === "here" ? picked : null;
    const all = Object.values(useTodos());
    const items = showing ? getList(showing).items : all.flatMap(l => l.items);
    const open = items.filter(i => !i.done).length, done = items.length - open;
    const pct = items.length ? Math.round(done / items.length * 100) : 0;

    return (
        <Window {...modalProps} size="lg" title="To-do" subtitle={showing ? channelTitle(showing) : "Every list you have"}
            tabs={[...(picked ? [["here", picked !== channelId ? channelTitle(picked) : "This chat"] as const] : []), ["all", "All lists"] as const]} tab={tab} onTab={id => setTab(id as typeof tab)}
            status={[items.length ? `${open} to do · ${done} done` : "nothing on this list", "right-click a message → Add to to-do list"]}>
            <div className={cl("wrap")} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="✅" kicker={showing ? channelTitle(showing) : `${all.filter(l => l.items.length).length} lists`}
                    title={!items.length ? "Nothing on your list" : open ? `${open} thing${open === 1 ? "" : "s"} to do` : "All done! 🎉"}
                    sub={items.length ? <span className={td("hero-bar")}><i style={{ width: `${pct}%` }} /></span> : "Add things below, or right-click a message → Add to to-do list."}
                    numbers={items.length ? [{ value: `${pct}%`, label: "done" }, { value: done, label: "ticked off" }] : []} />
                {showing ? <ListView key={showing} channelId={showing} /> : <AllLists onPick={id => { setPicked(id); setTab("here"); }} />}
            </div>
        </Window>
    );
}

export function openTodo(channelId: string | null) { openSection("planner", "todoLists", props => renderTodo(props, channelId)); }

export function renderTodo(props: RenderModalProps, ...[channelId]: Parameters<typeof openTodo>) {
    return (<TodoModal modalProps={props} channelId={channelId} />);
}
