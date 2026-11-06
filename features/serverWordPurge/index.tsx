/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";

import { Button } from "@components/Button";
import { Devs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildStore, React, RestAPI, TextInput, useState } from "@webpack/common";

import { Window } from "../_shared/Window";
import { canPurgeChannel, openPurgeChannelPicker } from "../exploiterReport/ChannelPicker";
import { headerSpacing, retryAfterMs } from "../messageCleanerUtil";
import { openModeration, registerModerationPart } from "../serverTools/Moderation";

type Message = { id: string; channel_id: string; content: string; hit?: boolean; };
type SearchPage = { messages?: Message[][]; retry_after?: number; };
type Response<T> = { status: number; body: T; headers?: unknown; };
type Phase = "idle" | "searching" | "preview" | "deleting" | "done" | "stopped" | "error";
type Result = "Deleted" | "Skipped" | "Failed";
const listeners = new Set<() => void>();
let state = { phase: "idle" as Phase, status: "", found: 0, deleted: 0, skipped: 0, failed: 0, rows: [] as { message: Message; result?: Result; }[] };
let job: { controller: AbortController; words: string[]; terms: RegExp[]; channels: string[]; matches: Map<string, Message>; } | undefined;
let nextRequest = 0;
let coolingUntil = 0;

function update(patch: Partial<typeof state>) {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function checkChannel(id: string) {
    const channel = ChannelStore.getChannel(id);
    if (!channel?.guild_id || ![0, 5].includes(channel.type) || !canPurgeChannel(channel))
        throw new Error("You no longer have access to manage messages in a selected channel.");
    return channel;
}

async function waitUntil(time: number, signal: AbortSignal) {
    while (Date.now() < time) {
        signal.throwIfAborted();
        await sleep(Math.min(250, time - Date.now()));
    }
    signal.throwIfAborted();
}

async function request<T>(send: () => Promise<Response<T>>, gap: number, signal: AbortSignal) {
    for (;;) {
        await waitUntil(Math.max(nextRequest, coolingUntil), signal);
        try {
            const response = await send();
            nextRequest = Date.now() + Math.max(gap, headerSpacing(response.headers));
            return response;
        } catch (error) {
            if ((error as { status?: number; })?.status !== 429) throw error;
            const delay = retryAfterMs(error) + 1000;
            coolingUntil = Date.now() + delay;
            update({ status: `Discord rate limited the request. Retrying in ${Math.ceil(delay / 1000)} seconds.` });
        }
    }
}

const matcher = (term: string) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{M}\\p{N}_])`, "iu");
const label = (id: string) => {
    const channel = ChannelStore.getChannel(id);
    return channel ? `${GuildStore.getGuild(channel.guild_id)?.name ?? "Server"} / #${channel.name}` : id;
};

async function preview(words: string[], channels: string[]) {
    const current = { controller: new AbortController(), words, terms: words.map(matcher), channels, matches: new Map<string, Message>() };
    job = current;
    const { signal } = current.controller;
    const rows: typeof state.rows = [];
    update({ phase: "searching", status: "Searching selected channels…", found: 0, deleted: 0, skipped: 0, failed: 0, rows: [] });
    try {
        for (const id of channels) {
            for (const [index, word] of words.entries()) {
                let cursor: string | undefined;
                let indexingRetries = 0;
                for (;;) {
                    const channel = checkChannel(id);
                    const params = new URLSearchParams({ content: word, channel_id: id, sort_by: "timestamp", sort_order: "desc", include_nsfw: "true" });
                    if (cursor) params.set("max_id", cursor);
                    const response = await request<SearchPage>(() => {
                        checkChannel(id);
                        return RestAPI.get({ url: `/guilds/${channel.guild_id}/messages/search?${params}` });
                    }, 2000, signal);
                    signal.throwIfAborted();
                    if (response.status === 202 || response.body.retry_after != null && !response.body.messages) {
                        if (++indexingRetries > 5) throw new Error("Discord is still indexing a selected channel. Try the preview again later.");
                        const delay = Math.max(2, response.body.retry_after ?? 2) * 1000;
                        update({ status: `Waiting for Discord to index ${label(id)}…` });
                        await waitUntil(Date.now() + delay, signal);
                        continue;
                    }
                    indexingRetries = 0;
                    if (!Array.isArray(response.body.messages)) throw new Error("Discord returned an incomplete search response.");
                    if (!response.body.messages.length) break;
                    const hits = response.body.messages.map(group => group.find(message => message.hit) ?? (group.length === 1 ? group[0] : undefined))
                        .filter((message): message is Message => !!message && message.channel_id === id && /^\d{17,20}$/.test(message.id));
                    let oldest = cursor;
                    for (const message of hits) {
                        if (!oldest || BigInt(message.id) < BigInt(oldest)) oldest = message.id;
                        if (!current.matches.has(message.id) && current.terms[index].test(message.content)) {
                            current.matches.set(message.id, message);
                            if (rows.length < 100) rows.push({ message });
                        }
                    }
                    if (!oldest || oldest === cursor) throw new Error(`Discord search stopped advancing in ${label(id)}. Run a new preview before deleting.`);
                    cursor = oldest;
                    update({ found: current.matches.size, status: `Searching ${label(id)} · term ${index + 1} of ${words.length}`,
                        rows: [...rows] });
                }
            }
        }
        update({ phase: "preview", status: current.matches.size ? "Review the matches before deleting." : "Discord search found no matching messages." });
    } catch (error) {
        update({ phase: signal.aborted ? "stopped" : "error", status: signal.aborted ? "Preview stopped." : error instanceof Error ? error.message : "Discord search failed." });
    }
}

async function deleteMatches() {
    const current = job;
    if (!current || state.phase !== "preview" || !current.matches.size) return;
    const { signal } = current.controller;
    update({ phase: "deleting", status: "Deleting previewed matches…" });
    const rows: typeof state.rows = [];
    let deleted = 0, skipped = 0, failed = 0;
    try {
        for (const message of current.matches.values()) {
            signal.throwIfAborted();
            const url = `/channels/${message.channel_id}/messages/${message.id}`;
            let result: Result = "Skipped";
            try {
                const fresh = await request<Message>(() => { checkChannel(message.channel_id); return RestAPI.get({ url }); }, 700, signal);
                if (fresh.body.id === message.id && fresh.body.channel_id === message.channel_id && current.terms.some(term => term.test(fresh.body.content))) {
                    await request(() => { checkChannel(message.channel_id); return RestAPI.del({ url }); }, 1100, signal);
                    result = "Deleted";
                }
            } catch (error) {
                if (signal.aborted) throw error;
                const status = (error as { status?: number; })?.status;
                result = status === 404 ? "Skipped" : "Failed";
            }
            if (result === "Deleted") deleted++;
            else if (result === "Skipped") skipped++;
            else failed++;
            rows.unshift({ message, result });
            if (rows.length > 100) rows.pop();
            update({ deleted, skipped, failed, rows: [...rows], status: `Processed ${deleted + skipped + failed} of ${current.matches.size} matches.` });
        }
        update({ phase: "done", status: "Deletion finished." });
    } catch {
        update({ phase: signal.aborted ? "stopped" : "error", status: signal.aborted ? "Deletion stopped." : "Deletion could not finish." });
    }
}

function WordPurgeWindow({ modalProps }: { modalProps: RenderModalProps; }) {
    const run = React.useSyncExternalStore(subscribe, () => state);
    const [input, setInput] = useState("");
    const [words, setWords] = useState<string[]>(job?.words ?? []);
    const [channels, setChannels] = useState<string[]>(job?.channels ?? []);
    const [confirm, setConfirm] = useState(false);
    const busy = run.phase === "searching" || run.phase === "deleting";
    const invalidate = () => {
        setConfirm(false);
        if (state.phase === "preview") update({ phase: "idle", status: "Run a new preview for the updated queue.", found: 0, rows: [] });
    };
    const add = () => {
        const word = input.trim();
        if (word && !words.some(value => value.toLowerCase() === word.toLowerCase())) {
            setWords([...words, word]);
            invalidate();
        }
        setInput("");
    };
    return <Window {...modalProps} title="Word Purge" size="xl" subtitle="Find and review matching messages in channels you moderate">
        <div className="vc-tool-wrap">
            <div className="vc-tool-row">
                <TextInput value={input} onChange={setInput} maxLength={100} disabled={busy} placeholder="Word or phrase" aria-label="Word or phrase" onKeyDown={event => { if (event.key === "Enter") add(); }} />
                <Button disabled={busy || !input.trim()} onClick={add}>Add term</Button>
                <Button variant="secondary" disabled={busy} onClick={() => openPurgeChannelPicker(channels, ids => { setChannels(ids); invalidate(); })}>Choose channels</Button>
            </div>
            <div className="vc-tool-row">{words.map(word => <Button key={word} size="small" variant="secondary" disabled={busy} aria-label={`Remove ${word}`} onClick={() => { setWords(words.filter(value => value !== word)); invalidate(); }}>{word} ×</Button>)}</div>
            <p className="vc-tool-hint">{channels.length ? channels.map(label).join(", ") : "Choose one or more channels to search."}</p>
            <p className="vc-tool-hint">Search matches whole words or phrases regardless of case. Preview uses Discord's search index. Jobs continue while this window is closed and Discord stays open.</p>
            <div className="vc-tool-row">
                <Button disabled={busy || !words.length || !channels.length} onClick={() => { setConfirm(false); void preview(words, channels); }}>Preview matches</Button>
                {run.phase === "preview" && run.found > 0 && <Button variant="dangerPrimary" onClick={() => {
                    if (confirm) { setConfirm(false); void deleteMatches(); }
                    else setConfirm(true);
                }}>{confirm ? `Confirm deletion of ${run.found} messages` : `Delete ${run.found} previewed messages`}</Button>}
                {busy && <Button variant="secondary" onClick={() => job?.controller.abort()}>Stop</Button>}
            </div>
            <p role="status">{run.status} {run.found > 0 && `${run.found} found · ${run.deleted} deleted · ${run.skipped} skipped · ${run.failed} failed`}</p>
            {run.found > 100 && <p className="vc-tool-hint">Showing up to 100 entries. Deletion applies to the full preview.</p>}
            {run.rows.map(({ message, result }) => <div className="vc-tool-section" key={message.id}>
                <b>{label(message.channel_id)}</b> {result && <span className="vc-tool-hint">{result}</span>}
                <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.content}</div>
            </div>)}
        </div>
    </Window>;
}

registerModerationPart("serverWordPurge", props => <WordPurgeWindow modalProps={props} />);
export default definePlugin({
    name: "ServerWordPurge",
    description: "Preview and delete messages matching queued terms in channels you moderate.",
    authors: [Devs.Ven],
    openSettingsModal: () => openModeration("serverWordPurge"),
    stop: () => {
        job?.controller.abort();
        job = undefined;
        if (state.phase === "preview") update({ phase: "stopped", status: "Preview cleared.", found: 0, rows: [] });
    },
});
