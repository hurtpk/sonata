/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { classNameFactory } from "@utils/css";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { classes, sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, RenderModalProps } from "@vencord/discord-types";
import { findComponentByCodeLazy, findStoreLazy } from "@webpack";
import { ChannelActionCreators, ChannelStore, GuildChannelStore, IconUtils, openModal, RestAPI, SelectedChannelStore, SnowflakeUtils, Timestamp, useCallback, useEffect, useRef, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { defineFeatureSettings } from "../../featureSettings";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";

const cl = classNameFactory("vc-purger-");

const logger = new Logger("MessagePurger");

const ManaSelect = findComponentByCodeLazy('"data-mana-component":"select"');
const PrivateChannelSortStore = findStoreLazy("PrivateChannelSortStore");

const settings = defineFeatureSettings("messageCleanerUtil", {
    autoRateLimit: {
        type: OptionType.BOOLEAN,
        description: "Pace requests using Discord's rate-limit headers, spread evenly across each window with a safety floor (never bursts). When off, your delays below are used as the minimum spacing.",
        default: true,
    },
    deleteDelay: {
        type: OptionType.SLIDER,
        description: "Default milliseconds between each delete (manual mode). Minimum 500ms.",
        default: 1250,
        markers: [500, 750, 1000, 1250, 1500, 2000, 3000],
    },
    searchDelay: {
        type: OptionType.SLIDER,
        description: "Default milliseconds between search pages (manual mode). Minimum 750ms; 1000ms+ recommended.",
        default: 1000,
        markers: [500, 750, 1000, 1500, 2000, 3000],
    },
    keybind: {
        description: "Keybind to open the purge modal.",
        type: OptionType.STRING,
        default: "",
    },
});

function matchesPurgerKeybind(e: KeyboardEvent) {
    const parts = settings.store.keybind.split("+").map(p => p.trim().toLowerCase());
    for (const part of parts) {
        if (part === "alt" && !e.altKey) return false;
        if (part === "ctrl" && !e.ctrlKey) return false;
        if (part === "shift" && !e.shiftKey) return false;
        if (part === "meta" && !e.metaKey) return false;
        if (!["alt", "ctrl", "shift", "meta"].includes(part) && e.key.toLowerCase() !== part) return false;
    }
    return true;
}

// #region Types

interface SearchMessage {
    id: string;
    channel_id: string;
    author: { id: string; username: string; avatar: string; };
    content: string;
    timestamp: string;
    type: number;
    pinned: boolean;
    attachments: { filename: string; }[];
    embeds: { type?: string; }[];
    hit?: boolean;
    reactions?: { emoji: { id: string | null; name: string; }; count: number; me: boolean; }[];
    message_reference?: { type?: number; };
    activity?: { type?: number; };
}

interface SearchChannel {
    id: string;
    recipients?: { id: string; username: string; global_name: string | null; }[];
    name?: string;
}

interface SearchCursor {
    timestamp: string;
    type: string;
}

interface SearchResponse {
    total_results: number;
    messages: SearchMessage[][];
    channels?: SearchChannel[];
    cursor?: SearchCursor | null;
}

type PreviewStatus = "pending" | "deleting" | "deleted" | "failed" | "skipped";

interface PreviewEntry {
    msg: SearchMessage;
    status: PreviewStatus;
    reactEmojis?: { id: string | null; name: string; }[];
}

// fetching = phase 1 (collect all), running = phase 2 (delete)
type EngineState = "idle" | "fetching" | "running" | "done" | "stopped";

// #endregion

// #region Purge Engine (persists across modal open/close)

type EngineListener = () => void;

interface PurgeEngineData {
    state: EngineState;
    deleted: number;
    failed: number;
    skipped: number;
    totalFound: number;
    fetched: number;
    toDelete: number;
    fetchedByChannel: Record<string, number>;
    channelNames: Record<string, string>;
    status: string;
    preview: PreviewEntry[];
    channelId: string;
    channelLabel: string;
    startTime: number | null;
    paused: boolean;
    /** Current spacing the pacer is using, e.g. "1.1s between deletes". */
    pacing: string;
    /** How many times Discord answered 429 this run (should stay 0). */
    rateLimitHits: number;
    /** Set while waiting out a 429, so the UI can show it. */
    coolingDown: boolean;
}

const engineListeners = new Set<EngineListener>();
let engineCancel = false;
let engineData: PurgeEngineData = createFreshEngine();

function createFreshEngine(): PurgeEngineData {
    return {
        state: "idle",
        deleted: 0,
        failed: 0,
        skipped: 0,
        totalFound: 0,
        fetched: 0,
        toDelete: 0,
        fetchedByChannel: {},
        channelNames: {},
        status: "",
        preview: [],
        channelId: "",
        channelLabel: "",
        startTime: null,
        paused: false,
        pacing: "",
        rateLimitHits: 0,
        coolingDown: false,
    };
}

function notifyListeners() {
    for (const l of engineListeners) l();
}

function updateEngine(partial: Partial<PurgeEngineData>) {
    Object.assign(engineData, partial);
    notifyListeners();
}

function updatePreviewStatus(id: string, status: PreviewStatus) {
    const idx = engineData.preview.findIndex(e => e.msg.id === id);
    if (idx >= 0) {
        engineData.preview[idx] = { ...engineData.preview[idx], status };
        engineData.preview = [...engineData.preview];
        notifyListeners();
    }
}

function addToPreview(msgs: SearchMessage[], status: PreviewStatus = "pending") {
    engineData.preview = [...engineData.preview, ...msgs.map(msg => ({ msg, status }))];
    notifyListeners();
}

function useEngine(): PurgeEngineData {
    const [, setTick] = useState(0);
    useEffect(() => {
        const listener = () => setTick(t => t + 1);
        engineListeners.add(listener);
        return () => { engineListeners.delete(listener); };
    }, []);
    return engineData;
}

// #endregion

// #region API

const SEARCH_PAGE_SIZE = 25;

// Persists across engine resets within the session so re-running a purge doesn't
// re-fetch messages that were deleted but not yet evicted from Discord's search index.
const recentlyDeleted = new Set<string>();

async function searchMessages(
    channelId: string,
    guildId: string | null,
    authorId: string | null,
    content: string,
    hasLink: boolean,
    hasFile: boolean,
    hasEmbed: boolean,
    minId: string | null,
    maxId: string | null,
    channelIds: string[] | null,
    sortOrder: "asc" | "desc",
): Promise<SearchResponse> {
    const params = new URLSearchParams();
    if (authorId) params.set("author_id", authorId);
    params.set("sort_by", "timestamp");
    params.set("sort_order", sortOrder);
    params.set("offset", "0");
    params.set("include_nsfw", "true");

    if (content) params.set("content", content);
    if (hasLink) params.append("has", "link");
    if (hasFile) params.append("has", "file");
    if (hasEmbed) params.append("has", "embed");
    if (minId) params.set("min_id", minId);
    if (maxId) params.set("max_id", maxId);

    let baseUrl: string;
    if (guildId && channelIds?.length) {
        baseUrl = `/guilds/${guildId}/messages/search`;
        for (const cid of channelIds) params.append("channel_id", cid);
    } else {
        baseUrl = `/channels/${channelId}/messages/search`;
    }

    const res = await RestAPI.get({ url: `${baseUrl}?${params}` });
    (res.body as any).__headers = res.headers;
    return res.body;
}

async function searchMessagesGlobal(
    authorId: string | null,
    content: string,
    hasLink: boolean,
    hasFile: boolean,
    hasEmbed: boolean,
    minId: string | null,
    maxId: string | null,
    sortOrder: "asc" | "desc",
    cursor: SearchCursor | null,
): Promise<SearchResponse> {
    const tab: Record<string, unknown> = {
        sort_by: "timestamp",
        sort_order: sortOrder,
        limit: SEARCH_PAGE_SIZE,
    };

    if (cursor) tab.cursor = cursor;

    if (authorId) tab.author_id = [authorId];
    if (content) tab.content = content;

    const has: string[] = [];
    if (hasLink) has.push("link");
    if (hasFile) has.push("file");
    if (hasEmbed) has.push("embed");
    if (has.length) tab.has = has;

    if (minId) tab.min_id = minId;
    if (maxId) tab.max_id = maxId;

    const res = await RestAPI.post({
        url: "/users/@me/messages/search/tabs",
        body: { tabs: { messages: tab }, track_exact_total_hits: true },
    });

    const out = res.body.tabs.messages;
    (out as any).__headers = res.headers;
    return out;
}

async function doSearchGlobal(opts: PurgeOptions, cursor: SearchCursor | null, sortOrder: "asc" | "desc", searchDelayRef: { v: number }): Promise<SearchResponse | null> {
    const dateMinId = opts.afterDate ? dateToSnowflake(new Date(opts.afterDate)) : null;
    const dateMaxId = opts.beforeDate ? dateToSnowflake(new Date(opts.beforeDate)) : null;
    let retries = 0;

    while (true) {
        if (engineCancel) return null;
        try {
            return await paced(pacers.search, () => searchMessagesGlobal(
                opts.authorId, opts.content, opts.hasLink, opts.hasFile, opts.hasEmbed,
                dateMinId, dateMaxId, sortOrder, cursor,
            ));
        } catch (err: unknown) {
            if (err instanceof PurgeCancelled) return null;
            const st = (err as { status?: number; }).status;
            const { body } = (err as { body?: { retry_after?: number; message?: string; }; });

            if (st === 202) {
                const wait = (body?.retry_after ?? 3) * 1000;
                updateEngine({ status: `Discord is indexing messages, waiting ${(wait / 1000).toFixed(0)}s...` });
                await sleepUntil(Date.now() + wait);
                continue;
            }
            retries++;
            if (retries >= 5) {
                const detail = body?.message ?? st ?? "unknown error";
                throw new Error(`Search failed after ${retries} retries: ${detail}`);
            }
            const wait = Math.min(2000 * retries, 10000);
            logger.warn(`Search error (attempt ${retries}/5, status ${st}), retrying in ${wait}ms`, err);
            updateEngine({ status: `Search error, retrying (${retries}/5)...` });
            await sleep(wait);
        }
    }
}

async function deleteMsg(channelId: string, messageId: string): Promise<any> {
    return paced(pacers.delete, () => RestAPI.del({ url: `/channels/${channelId}/messages/${messageId}` }));
}

// #region Rate limiting
//
// Every request the purger makes (search, history fetch, delete, reaction
// removal, block/unfriend) goes through a Pacer so Discord's rate limits are
// stayed under, not ridden:
//
// - Requests are spread evenly across Discord's current rate-limit window
//   (X-RateLimit-Remaining / -Reset-After) instead of bursting until the
//   window is empty.
// - There is always a minimum gap. In auto mode that's a safe floor per kind
//   of request; in manual mode it's your delay setting (clamped to a safe
//   minimum). Headers can only ever make the gap longer, never shorter, and
//   missing headers fall back to the floor instead of "no wait".
// - If Discord still answers 429, its retry_after is honoured with a margin,
//   the pacer backs off further (and eases back slowly after clean
//   requests), and a global 429 pauses every kind of request.
// - A rate-limited request is retried until it goes through; it's never
//   dropped as "failed". Stop/Cancel interrupts any wait immediately.

class PurgeCancelled extends Error {
    constructor() { super("Purge cancelled"); }
}

interface PacingConfig { auto: boolean; deleteDelay: number; searchDelay: number; }
let pacingConfig: PacingConfig = { auto: true, deleteDelay: 1250, searchDelay: 1000 };

type PaceKind = "search" | "fetch" | "delete" | "reaction" | "misc";

/** Auto-mode minimum gap per kind of request (ms). */
const SAFE_FLOOR: Record<PaceKind, number> = { search: 2000, fetch: 700, delete: 1100, reaction: 500, misc: 1000 };
/** Manual delays are never allowed below these (ms). */
const MANUAL_MIN = { delete: 500, search: 750 };

function floorFor(kind: PaceKind): number {
    if (pacingConfig.auto) return SAFE_FLOOR[kind];
    switch (kind) {
        case "delete": return Math.max(pacingConfig.deleteDelay, MANUAL_MIN.delete);
        case "reaction": return Math.max(Math.floor(pacingConfig.deleteDelay / 2), SAFE_FLOOR.reaction);
        case "search": return Math.max(pacingConfig.searchDelay, MANUAL_MIN.search);
        case "fetch": return Math.max(Math.floor(pacingConfig.searchDelay * 0.7), SAFE_FLOOR.fetch);
        default: return SAFE_FLOOR[kind];
    }
}

function readHeader(headers: any, name: string): string | undefined {
    if (!headers) return undefined;
    if (typeof headers.get === "function") return headers.get(name) ?? undefined;
    return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.replace(/(^|-)([a-z])/g, (_: string, d: string, c: string) => d + c.toUpperCase())];
}

/** Gap that spreads the requests left in Discord's current window evenly across it (0 if unknown). */
function headerSpacing(headers: any): number {
    const remaining = Number(readHeader(headers, "x-ratelimit-remaining"));
    const resetAfter = Number(readHeader(headers, "x-ratelimit-reset-after"));
    if (!Number.isFinite(remaining) || !Number.isFinite(resetAfter) || resetAfter <= 0) return 0;
    if (remaining <= 0) return Math.ceil(resetAfter * 1000) + 250;
    return Math.ceil((resetAfter * 1000) / remaining * 1.05);
}

function retryAfterMs(err: any): number {
    const fromBody = Number(err?.body?.retry_after);
    const fromHeader = Number(readHeader(err?.headers, "retry-after"));
    const secs = Math.max(Number.isFinite(fromBody) ? fromBody : 0, Number.isFinite(fromHeader) ? fromHeader : 0);
    return Math.ceil((secs > 0 ? secs : 3) * 1000);
}

const jitter = (ms: number) => Math.round(ms * (0.94 + Math.random() * 0.12));

/** Sleep until a timestamp, in small steps so Stop takes effect right away. */
async function sleepUntil(time: number) {
    while (Date.now() < time) {
        if (engineCancel) throw new PurgeCancelled();
        await sleep(Math.min(250, time - Date.now()));
    }
}

class Pacer {
    private nextAt = 0;
    private penalty = 0;

    constructor(readonly kind: PaceKind, readonly label: string) { }

    reset() {
        this.nextAt = 0;
        this.penalty = 0;
    }

    wait() {
        return sleepUntil(this.nextAt);
    }

    /** After a successful request: schedule the next one. Returns the gap used. */
    succeeded(headers: any): number {
        const fromHeaders = headerSpacing(headers);
        // A manual delay below the safe floor is only trusted while Discord's
        // headers confirm there's room; without them, the safe floor applies.
        const floor = fromHeaders > 0 ? floorFor(this.kind) : Math.max(floorFor(this.kind), SAFE_FLOOR[this.kind]);
        const gap = Math.max(floor, fromHeaders) + this.penalty;
        this.penalty = Math.max(0, this.penalty - 150);
        this.nextAt = Date.now() + jitter(gap);
        return gap;
    }

    /** After a 429: wait Discord's retry_after plus a margin, and slow down for a while. */
    rateLimited(retryAfter: number) {
        this.penalty = Math.min(this.penalty + 750, 6000);
        this.nextAt = Math.max(this.nextAt, Date.now() + retryAfter + 1000);
    }
}

const pacers = {
    search: new Pacer("search", "searches"),
    fetch: new Pacer("fetch", "page loads"),
    delete: new Pacer("delete", "deletes"),
    reaction: new Pacer("reaction", "reaction removals"),
    misc: new Pacer("misc", "actions"),
};

function resetPacing(opts: { autoRateLimit: boolean; deleteDelay: number; searchDelay: number; }) {
    pacingConfig = { auto: opts.autoRateLimit, deleteDelay: opts.deleteDelay, searchDelay: opts.searchDelay };
    for (const p of Object.values(pacers)) p.reset();
}

function headersOf(res: any) {
    return res?.headers ?? res?.__headers;
}

/**
 * Run one request under a pacer. 429s are waited out and retried here, so
 * callers only ever see real errors (or PurgeCancelled when stopped).
 */
async function paced<T>(pacer: Pacer, request: () => Promise<T>): Promise<T> {
    while (true) {
        await pacer.wait();
        if (engineCancel) throw new PurgeCancelled();
        try {
            const res = await request();
            const gap = pacer.succeeded(headersOf(res));
            if (engineData.coolingDown || pacer.kind !== "misc")
                updateEngine({ pacing: `${(gap / 1000).toFixed(1)}s between ${pacer.label}`, coolingDown: false });
            return res;
        } catch (err: any) {
            if (err?.status !== 429) throw err;
            const wait = retryAfterMs(err);
            const global = !!err?.body?.global;
            for (const p of global ? Object.values(pacers) : [pacer]) p.rateLimited(wait);
            logger.warn(`429 on ${pacer.label}${global ? " (global)" : ""}; waiting ${wait + 1000}ms`, err?.body);
            updateEngine({
                rateLimitHits: engineData.rateLimitHits + 1,
                coolingDown: true,
                status: `Discord asked to slow down${global ? " (global limit)" : ""} — waiting ${((wait + 1000) / 1000).toFixed(1)}s, then continuing more slowly...`,
            });
        }
    }
}

// #endregion

async function fetchChannelMessages(channelId: string, before?: string): Promise<SearchMessage[]> {
    const params = new URLSearchParams({ limit: "100" });
    if (before) params.set("before", before);
    const res = await paced(pacers.fetch, () => RestAPI.get({ url: `/channels/${channelId}/messages?${params}` }));
    return res.body;
}

async function removeReaction(channelId: string, messageId: string, emoji: { id: string | null; name: string; }): Promise<any> {
    const encoded = emoji.id ? `${encodeURIComponent(emoji.name)}:${emoji.id}` : encodeURIComponent(emoji.name);
    return paced(pacers.reaction, () => RestAPI.del({ url: `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me` }));
}

const PURGER_SIGNATURE = "\u200B\u200C\u200D\u2060";

async function blockUser(userId: string): Promise<void> {
    await paced(pacers.misc, () => RestAPI.put({ url: `/users/@me/relationships/${userId}`, body: { type: 2 } }));
}

async function unaddUser(userId: string): Promise<void> {
    await paced(pacers.misc, () => RestAPI.del({ url: `/users/@me/relationships/${userId}` }));
}

function getRecipientId(channelId: string): string | null {
    const ch = ChannelStore.getChannel(channelId);
    if (!ch) return null;
    return (ch as { recipients?: string[]; }).recipients?.[0] ?? null;
}

function dateToSnowflake(date: Date): string {
    return SnowflakeUtils.fromTimestamp(date.getTime());
}

function parseDate(input: string): Date | null {
    if (!input.trim()) return null;
    const ymd = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    const d = new Date(input.trim());
    return isNaN(d.getTime()) ? null : d;
}

function getDmLabel(channelId: string): string {
    // Use names cached from search responses first (most reliable for global search)
    const cached = engineData.channelNames[channelId];
    if (cached) return cached;
    const ch = ChannelStore.getChannel(channelId);
    if (!ch) return `DM …${channelId.slice(-4)}`;
    if (ch.name) return ch.name;
    const recipientId = (ch as { recipients?: string[]; }).recipients?.[0];
    if (recipientId) {
        const user = UserStore.getUser(recipientId);
        if (user) return `@${user.username}`;
    }
    return `DM …${channelId.slice(-4)}`;
}

// #endregion

// #region Engine Runner

type DeleteOrder = "newest_first" | "oldest_first";

interface PurgeOptions {
    channelId: string;
    guildId: string | null;
    channelLabel: string;
    authorId: string | null;
    content: string;
    hasLink: boolean;
    hasFile: boolean;
    hasEmbed: boolean;
    includePinned: boolean;
    afterDate: string | null;
    beforeDate: string | null;
    channelIds: string[] | null;
    deleteDelay: number;
    searchDelay: number;
    autoRateLimit: boolean;
    deleteOrder: DeleteOrder;
    global: boolean;
    blacklistedChannels: string[];
    removeReactions: boolean;
    scanActivities: boolean;
    postBlock: boolean;
    postUnadd: boolean;
    postClose: boolean;
    leaveMessage: string;
    globalPostBlock: string[];
    globalPostUnadd: string[];
    globalPostClose: string[];
    globalLeaveMessages: Record<string, string>;
}

// cursorId: ID of the last message seen. Becomes max_id (desc) or min_id (asc) for the next request,
// giving us offset-free cursor pagination that avoids Discord's offset limit.
async function doSearch(opts: PurgeOptions, cursorId: string | null, sortOrder: "asc" | "desc", searchDelayRef: { v: number }): Promise<SearchResponse | null> {
    const dateMinId = opts.afterDate ? dateToSnowflake(new Date(opts.afterDate)) : null;
    const dateMaxId = opts.beforeDate ? dateToSnowflake(new Date(opts.beforeDate)) : null;

    const minId = sortOrder === "asc" ? (cursorId ?? dateMinId) : dateMinId;
    const maxId = sortOrder === "desc" ? (cursorId ?? dateMaxId) : dateMaxId;
    let retries = 0;

    while (true) {
        if (engineCancel) return null;
        try {
            return await paced(pacers.search, () => searchMessages(
                opts.channelId, opts.guildId, opts.authorId,
                opts.content, opts.hasLink, opts.hasFile, opts.hasEmbed,
                minId, maxId, opts.channelIds, sortOrder,
            ));
        } catch (err: unknown) {
            if (err instanceof PurgeCancelled) return null;
            const st = (err as { status?: number; }).status;
            const { body } = (err as { body?: { retry_after?: number; message?: string; }; });

            if (st === 202) {
                const wait = (body?.retry_after ?? 3) * 1000;
                updateEngine({ status: `Discord is indexing messages, waiting ${(wait / 1000).toFixed(0)}s...` });
                await sleepUntil(Date.now() + wait);
                continue;
            }
            retries++;
            if (retries >= 5) {
                const detail = body?.message ?? st ?? "unknown error";
                throw new Error(`Search failed after ${retries} retries: ${detail}`);
            }
            const wait = Math.min(2000 * retries, 10000);
            logger.warn(`Search error (attempt ${retries}/5, status ${st}), retrying in ${wait}ms`, err);
            updateEngine({ status: `Search error, retrying (${retries}/5)...` });
            await sleep(wait);
        }
    }
}

async function runPurge(opts: PurgeOptions) {
    if (engineData.state !== "idle") return;

    engineCancel = false;
    const searchDelayRef = { v: opts.searchDelay };
    resetPacing(opts);
    const sortOrder: "asc" | "desc" = opts.deleteOrder === "oldest_first" ? "asc" : "desc";

    updateEngine({
        ...createFreshEngine(),
        state: "fetching",
        status: "Contacting Discord search...",
        channelId: opts.channelId,
        channelLabel: opts.channelLabel,
        startTime: Date.now(),
    });

    // --- Phase 1: fetch all pages before deleting anything ---
    const seenIds = new Set<string>();
    let errorMsg: string | null = null;

    function processHits(hits: SearchMessage[]) {
        const meaningful = hits.filter(m => {
            if (m.type === 3) return false;
            if (m.content?.includes(PURGER_SIGNATURE)) return false;
            if (!(m.content || m.attachments?.length || m.embeds?.length || m.message_reference || m.activity)) return false;
            return true;
        });
        if (!meaningful.length) return;
        const deletable: SearchMessage[] = [];
        const skipped: SearchMessage[] = [];
        for (const msg of meaningful) {
            if (msg.pinned && !opts.includePinned) {
                skipped.push(msg);
            } else {
                deletable.push(msg);
            }
        }
        if (skipped.length) addToPreview(skipped, "skipped");
        if (deletable.length) addToPreview(deletable, "pending");
        const byChannel = { ...engineData.fetchedByChannel };
        for (const msg of meaningful) byChannel[msg.channel_id] = (byChannel[msg.channel_id] ?? 0) + 1;
        updateEngine({ fetchedByChannel: byChannel });
    }

    try {
        if (opts.global) {
            // Global DM search using the cross-DM endpoint (finds messages in closed DMs too).
            // Discord uses cursor-based pagination: the first request returns a cursor but no
            // messages, subsequent requests pass the cursor to receive actual results.
            let pageCursor: SearchCursor | null = null;
            let isFirstPage = true;

            while (!engineCancel) {
                while (engineData.paused && !engineCancel) {
                    updateEngine({ status: "Paused." });
                    await sleep(500);
                }
                if (engineCancel) break;

                const globalOpts = opts.authorId ? opts : { ...opts, authorId: UserStore.getCurrentUser()?.id ?? null };
                const searchData = await doSearchGlobal(globalOpts, pageCursor, sortOrder, searchDelayRef);
                if (!searchData) break;

                if (isFirstPage) {
                    isFirstPage = false;
                    if (searchData.total_results === 0) {
                        updateEngine({ status: "No messages found." });
                        break;
                    }
                    updateEngine({ totalFound: searchData.total_results });
                }

                pageCursor = searchData.cursor ?? null;

                const pageGroups = searchData.messages ?? [];

                // First response may return a cursor but no messages; use the cursor to continue
                if (!pageGroups.length) {
                    if (pageCursor) {
                        // (spacing enforced by the pacers)
                        continue;
                    }
                    break;
                }

                // Cache channel names from the response (needed for closed DMs not in ChannelStore)
                if (searchData.channels) {
                    const channelNames = { ...engineData.channelNames };
                    for (const ch of searchData.channels) {
                        if (!channelNames[ch.id]) {
                            const recipient = ch.recipients?.[0];
                            channelNames[ch.id] = recipient
                                ? `@${recipient.global_name ?? recipient.username}`
                                : (ch.name ?? `DM …${ch.id.slice(-4)}`);
                        }
                    }
                    updateEngine({ channelNames });
                }

                const allHits = pageGroups
                    .map(g => g.find(m => m.hit))
                    .filter((m): m is SearchMessage => m != null && !seenIds.has(m.id));

                for (const m of allHits) seenIds.add(m.id);

                const hits = allHits.filter(m =>
                    !opts.blacklistedChannels.includes(m.channel_id) &&
                    !recentlyDeleted.has(m.id)
                );

                processHits(hits);
                updateEngine({
                    fetched: engineData.preview.length,
                    status: `Fetched ${engineData.preview.length} / ${engineData.totalFound} messages...`,
                });

                if (!pageCursor) break;
                // (spacing enforced by the pacers)
            }
        } else {
            let cursorId: string | null = null;
            let isFirstPage = true;
            let useDirectFetch = false;

            while (!engineCancel) {
                while (engineData.paused && !engineCancel) {
                    updateEngine({ status: "Paused." });
                    await sleep(500);
                }
                if (engineCancel) break;

                const searchData = await doSearch(opts, cursorId, sortOrder, searchDelayRef);
                if (!searchData) break;

                if (isFirstPage) {
                    isFirstPage = false;
                    if (searchData.total_results === 0) {
                        if (!opts.guildId) {
                            useDirectFetch = true;
                            break;
                        }
                        updateEngine({ totalFound: 0, status: "No messages found." });
                        break;
                    }
                    updateEngine({ totalFound: searchData.total_results });
                }

                const pageGroups = searchData.messages ?? [];
                if (!pageGroups.length) {
                    if (!opts.guildId) {
                        useDirectFetch = true;
                    }
                    break;
                }

                const allHits = pageGroups
                    .map(g => g.find(m => m.hit))
                    .filter((m): m is SearchMessage => m != null && !seenIds.has(m.id));

                if (!allHits.length) break;

                for (const m of allHits) seenIds.add(m.id);
                cursorId = allHits[allHits.length - 1].id;

                const hits = allHits.filter(m =>
                    (!opts.authorId || m.author.id === opts.authorId) &&
                    !recentlyDeleted.has(m.id)
                );

                processHits(hits);
                updateEngine({
                    fetched: seenIds.size,
                    status: `Fetched ${seenIds.size} / ${searchData.total_results} messages...`,
                });

                if (pageGroups.length < SEARCH_PAGE_SIZE) break;
                // (spacing enforced by the pacers)
            }

            if (useDirectFetch && !engineCancel) {
                updateEngine({ status: "Search index unavailable, fetching messages directly..." });
                let before: string | undefined;
                const dateMinId = opts.afterDate ? dateToSnowflake(new Date(opts.afterDate)) : null;
                const dateMaxId = opts.beforeDate ? dateToSnowflake(new Date(opts.beforeDate)) : null;

                while (!engineCancel) {
                    while (engineData.paused && !engineCancel) {
                        updateEngine({ status: "Paused." });
                        await sleep(500);
                    }
                    if (engineCancel) break;

                    const msgs = await fetchChannelMessages(opts.channelId, before);
                    if (!msgs.length) break;

                    const filtered = msgs.filter(m => {
                        if (seenIds.has(m.id) || recentlyDeleted.has(m.id)) return false;
                        if (opts.authorId && m.author.id !== opts.authorId) return false;
                        if (dateMinId && m.id < dateMinId) return false;
                        if (dateMaxId && m.id > dateMaxId) return false;
                        return true;
                    });

                    for (const m of filtered) seenIds.add(m.id);
                    processHits(filtered);
                    updateEngine({
                        fetched: seenIds.size,
                        status: `Fetched ${engineData.preview.length} messages...`,
                    });

                    before = msgs[msgs.length - 1].id;
                    if (dateMinId && msgs[msgs.length - 1].id < dateMinId) break;
                    if (msgs.length < 100) break;
                    // (spacing enforced by the pacers)
                }
            }
        }
    } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
        logger.error("Fetch phase error", err);
        updateEngine({ status: `Error: ${errorMsg}` });
    }

    if (engineCancel) {
        updateEngine({ state: "stopped", paused: false, status: "Stopped." });
        return;
    }

    if (errorMsg) {
        updateEngine({ state: "stopped", status: `Fetch failed: ${errorMsg}` });
        return;
    }

    // --- Phase 1b: scan for reactions (requires full channel read) ---
    if (opts.removeReactions && !engineCancel) {
        if (!opts.global) {
            updateEngine({ status: "Scanning for reactions..." });
            let before: string | undefined;
            try {
                while (!engineCancel) {
                    while (engineData.paused && !engineCancel) {
                        updateEngine({ status: "Paused." });
                        await sleep(500);
                    }
                    if (engineCancel) break;

                    const msgs = await fetchChannelMessages(opts.channelId, before);
                    if (!msgs.length) break;

                    const reactEntries: PreviewEntry[] = [];
                    for (const msg of msgs) {
                        if (seenIds.has(msg.id)) continue;
                        const myReactions = msg.reactions?.filter(r => r.me);
                        if (myReactions?.length) {
                            seenIds.add(msg.id);
                            reactEntries.push({
                                msg,
                                status: "pending",
                                reactEmojis: myReactions.map(r => r.emoji),
                            });
                        }
                    }

                    if (reactEntries.length) {
                        engineData.preview = [...engineData.preview, ...reactEntries];
                        notifyListeners();
                    }

                    before = msgs[msgs.length - 1].id;
                    const reactCount = engineData.preview.filter(e => e.reactEmojis).length;
                    updateEngine({ status: `Scanning for reactions... ${reactCount} messages found` });

                    if (msgs.length < 100) break;
                    // (spacing enforced by the pacers)
                }
            } catch (err) {
                logger.error("Reaction scan error", err);
            }
        } else {
            const dmIds: string[] = PrivateChannelSortStore.getPrivateChannelIds?.() ?? [];
            const channelIds = dmIds.filter(id => !opts.blacklistedChannels.includes(id));
            let scanned = 0;

            for (const chId of channelIds) {
                if (engineCancel) break;
                scanned++;
                updateEngine({ status: `Scanning DM ${scanned}/${channelIds.length} for reactions...` });

                let before: string | undefined;
                try {
                    while (!engineCancel) {
                        while (engineData.paused && !engineCancel) {
                            updateEngine({ status: "Paused." });
                            await sleep(500);
                        }
                        if (engineCancel) break;

                        const msgs = await fetchChannelMessages(chId, before);
                        if (!msgs.length) break;

                        const reactEntries: PreviewEntry[] = [];
                        for (const msg of msgs) {
                            if (seenIds.has(msg.id)) continue;
                            const myReactions = msg.reactions?.filter(r => r.me);
                            if (myReactions?.length) {
                                seenIds.add(msg.id);
                                reactEntries.push({
                                    msg: { ...msg, channel_id: chId },
                                    status: "pending",
                                    reactEmojis: myReactions.map(r => r.emoji),
                                });
                            }
                        }

                        if (reactEntries.length) {
                            engineData.preview = [...engineData.preview, ...reactEntries];
                            notifyListeners();
                        }

                        before = msgs[msgs.length - 1].id;
                        if (msgs.length < 100) break;
                        // (spacing enforced by the pacers)
                    }
                } catch {
                    logger.warn(`Reaction scan failed for channel ${chId}, skipping`);
                }
            }

            const reactCount = engineData.preview.filter(e => e.reactEmojis).length;
            if (reactCount) updateEngine({ status: `Found ${reactCount} messages with reactions across ${scanned} DMs` });
        }
    }

    if (engineCancel) {
        updateEngine({ state: "stopped", paused: false, status: "Stopped." });
        return;
    }

    // --- Phase 1c: scan for activity/system messages not indexed by search ---
    if (opts.scanActivities && !engineCancel) {
        const currentUserId = UserStore.getCurrentUser()?.id;

        async function scanChannelForActivities(chId: string) {
            let before: string | undefined;
            try {
                while (!engineCancel) {
                    while (engineData.paused && !engineCancel) {
                        updateEngine({ status: "Paused." });
                        await sleep(500);
                    }
                    if (engineCancel) break;

                    const msgs = await fetchChannelMessages(chId, before);
                    if (!msgs.length) break;

                    const activityMsgs: SearchMessage[] = [];
                    for (const msg of msgs) {
                        if (seenIds.has(msg.id) || recentlyDeleted.has(msg.id)) continue;
                        if (msg.type === 3) continue;
                        if (msg.content?.includes(PURGER_SIGNATURE)) continue;
                        if (msg.type === 20 || msg.activity) {
                            seenIds.add(msg.id);
                            activityMsgs.push({ ...msg, channel_id: chId });
                        }
                    }

                    if (activityMsgs.length) addToPreview(activityMsgs, "pending");

                    before = msgs[msgs.length - 1].id;
                    if (msgs.length < 100) break;
                    // (spacing enforced by the pacers)
                }
            } catch (err) {
                logger.warn(`Activity scan failed for channel ${chId}`, err);
            }
        }

        if (opts.global) {
            const dmIds: string[] = PrivateChannelSortStore.getPrivateChannelIds?.() ?? [];
            const channelIds = dmIds.filter(id => !opts.blacklistedChannels.includes(id));
            let scanned = 0;

            for (const chId of channelIds) {
                if (engineCancel) break;
                scanned++;
                updateEngine({ status: `Scanning DM ${scanned}/${channelIds.length} for activities...` });
                await scanChannelForActivities(chId);
            }
        } else if (!opts.guildId) {
            updateEngine({ status: "Scanning for activity messages..." });
            await scanChannelForActivities(opts.channelId);
        }

        const activityCount = engineData.preview.filter(e => !e.reactEmojis && e.msg.type === 20).length;
        if (activityCount) updateEngine({ status: `Found ${activityCount} activity messages` });
    }

    if (engineCancel) {
        updateEngine({ state: "stopped", paused: false, status: "Stopped." });
        return;
    }

    // --- Phase 2: delete messages and remove reactions ---
    const pending = engineData.preview.filter(e => e.status === "pending");
    const skippedCount = engineData.preview.filter(e => e.status === "skipped").length;

    if (!pending.length) {
        updateEngine({
            state: "done",
            skipped: skippedCount,
            status: skippedCount > 0
                ? `Nothing to delete. ${skippedCount} pinned or non-deletable messages were skipped.`
                : "No messages found.",
        });
        return;
    }

    let totalDeleted = 0;
    let totalFailed = 0;

    updateEngine({
        state: "running",
        skipped: skippedCount,
        toDelete: pending.length,
        status: `Starting deletion of ${pending.length} messages...`,
        startTime: Date.now(),
    });

    for (const entry of pending) {
        if (engineCancel) break;

        while (engineData.paused && !engineCancel) {
            updateEngine({ status: "Paused." });
            await sleep(500);
        }
        if (engineCancel) break;

        const { msg } = entry;
        const isReaction = !!entry.reactEmojis?.length;

        updatePreviewStatus(msg.id, "deleting");
        updateEngine({
            status: isReaction
                ? `Removing reactions from message by @${msg.author.username}...`
                : `Deleting message from @${msg.author.username}...`,
        });

        let success = false;

        try {
            if (isReaction) {
                success = true;
                for (const emoji of entry.reactEmojis!) {
                    try {
                        await removeReaction(msg.channel_id, msg.id, emoji);
                    } catch (err: unknown) {
                        if (err instanceof PurgeCancelled) throw err;
                        if ((err as { status?: number; }).status === 404) continue;
                        success = false;
                        break;
                    }
                }
            } else {
                await deleteMsg(msg.channel_id, msg.id);
                success = true;
            }
        } catch (err: unknown) {
            if (err instanceof PurgeCancelled) break;
            const errSt = (err as { status?: number; }).status;
            if (errSt !== 403 && errSt !== 404) logger.error("Delete failed", err);
        }

        if (success) {
            totalDeleted++;
            recentlyDeleted.add(msg.id);
            updateEngine({ deleted: totalDeleted });
            updatePreviewStatus(msg.id, "deleted");
        } else {
            totalFailed++;
            updateEngine({ failed: totalFailed });
            updatePreviewStatus(msg.id, "failed");
        }
    }

    // --- Phase 3: post-purge actions ---
    if (!engineCancel) {
        const processedChannels = new Set(engineData.preview.map(e => e.msg.channel_id));

        if (opts.global) {
            for (const chId of processedChannels) {
                const recipientId = getRecipientId(chId);
                const leaveMsg = opts.globalLeaveMessages[chId];
                if (leaveMsg) {
                    try {
                        updateEngine({ status: `Sending message in ${getDmLabel(chId)}...` });
                        await sendMessage(chId, { content: leaveMsg + PURGER_SIGNATURE });
                        await sleep(500);
                    } catch (err) {
                        logger.warn(`Failed to send leave message in ${chId}`, err);
                    }
                }
                if (recipientId && opts.globalPostBlock.includes(chId)) {
                    try {
                        updateEngine({ status: `Blocking ${getDmLabel(chId)}...` });
                        await blockUser(recipientId);
                        await sleep(500);
                    } catch (err) {
                        logger.warn(`Failed to block user in ${chId}`, err);
                    }
                }
                if (recipientId && opts.globalPostUnadd.includes(chId)) {
                    try {
                        updateEngine({ status: `Removing ${getDmLabel(chId)}...` });
                        await unaddUser(recipientId);
                        await sleep(500);
                    } catch (err) {
                        logger.warn(`Failed to unadd user in ${chId}`, err);
                    }
                }
                if (opts.globalPostClose.includes(chId)) {
                    try {
                        updateEngine({ status: `Closing ${getDmLabel(chId)}...` });
                        await ChannelActionCreators.closePrivateChannel(chId);
                        await sleep(300);
                    } catch (err) {
                        logger.warn(`Failed to close DM ${chId}`, err);
                    }
                }
            }
        } else if (!opts.guildId) {
            const recipientId = getRecipientId(opts.channelId);
            if (opts.leaveMessage) {
                try {
                    updateEngine({ status: "Sending leave-behind message..." });
                    await sendMessage(opts.channelId, { content: opts.leaveMessage + PURGER_SIGNATURE });
                    await sleep(500);
                } catch (err) {
                    logger.warn("Failed to send leave message", err);
                }
            }
            if (recipientId && opts.postBlock) {
                try {
                    updateEngine({ status: "Blocking user..." });
                    await blockUser(recipientId);
                    await sleep(500);
                } catch (err) {
                    logger.warn("Failed to block user", err);
                }
            }
            if (recipientId && opts.postUnadd) {
                try {
                    updateEngine({ status: "Removing friend..." });
                    await unaddUser(recipientId);
                    await sleep(500);
                } catch (err) {
                    logger.warn("Failed to unadd user", err);
                }
            }
            if (opts.postClose) {
                try {
                    updateEngine({ status: "Closing DM..." });
                    await ChannelActionCreators.closePrivateChannel(opts.channelId);
                    await sleep(300);
                } catch (err) {
                    logger.warn("Failed to close DM", err);
                }
            }
        }
    }

    const finalState = engineCancel ? "stopped" : "done";
    updateEngine({
        state: finalState,
        paused: false,
        status: finalState === "done"
            ? `Done. Processed ${totalDeleted} messages.`
            : `Stopped. Processed ${totalDeleted} messages.`,
    });
}

function stopPurge() {
    engineCancel = true;
    updateEngine({ status: "Stopping...", paused: false });
}

function pausePurge() {
    updateEngine({ paused: true });
}

function resumePurge() {
    updateEngine({ paused: false });
}

function resetEngine() {
    engineCancel = true;
    engineData = createFreshEngine();
    notifyListeners();
}

// #endregion

// #region Chatbar Icon

function TrashIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M6 7h12l-1.2 12.6a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 7Z" fill="var(--status-danger)" opacity="0.85" />
            <path d="M4 7h16M10 11v6M14 11v6M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="var(--status-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function TrashIconSettings() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24">
            <path d="M6 7h12l-1.2 12.6a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 7Z" fill="currentColor" opacity="0.85" />
            <path d="M4 7h16M10 11v6M14 11v6M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
    );
}

const PurgerChatBarButton: ChatBarButtonFactory = ({ channel, isMainChat }) => {
    if (!isMainChat) return null;
    return (
        <ChatBarButton tooltip="Purge Messages" onClick={() => openPurgeModal(channel)}>
            <TrashIcon />
        </ChatBarButton>
    );
};

export function openPurgeModal(channel: Channel) {
    openModal(modalProps => <PurgeModal modalProps={modalProps} channel={channel} />);
}

// #endregion

// #region Preview Row

function MessagePreviewRow({ entry }: { entry: PreviewEntry; }) {
    const { msg, status, reactEmojis } = entry;
    const isReaction = !!reactEmojis?.length;
    const avatarUrl = IconUtils.getUserAvatarURL(msg.author as never) ?? IconUtils.getDefaultAvatarURL(msg.author.id);

    const contentText = isReaction
        ? `[${reactEmojis.map(e => e.name).join(", ")}] on: ${msg.content || "[message]"}`
        : (msg.content || (msg.attachments?.length ? `[${msg.attachments.length} attachment${msg.attachments.length > 1 ? "s" : ""}]` : (msg.embeds?.length ? "[embed]" : (msg.message_reference ? "[forwarded message]" : "[activity/system message]"))));

    const statusLabel = isReaction
        ? (status === "deleted" ? "Unreacted"
            : status === "failed" ? "Failed"
                : status === "deleting" ? "Removing…"
                    : "Reaction")
        : (status === "deleted" ? "Deleted"
            : status === "failed" ? "Failed"
                : status === "deleting" ? "Deleting…"
                    : status === "skipped" ? "Skipped"
                        : null);

    return (
        <div className={classes(cl("msg"), cl(`msg-${status}`))}>
            <img className={cl("msg-avatar")} src={avatarUrl} alt="" />
            <div className={cl("msg-body")}>
                <div className={cl("msg-head")}>
                    <b>{msg.author.username}</b>
                    <span className={cl("msg-time")}><Timestamp timestamp={new Date(msg.timestamp)} /></span>
                </div>
                <div className={cl("msg-text")}>{contentText}</div>
            </div>
            {statusLabel && <span className={classes(cl("msg-status"), cl(`msg-status-${status}`))}>{statusLabel}</span>}
        </div>
    );
}

// #endregion

// #region Building blocks

function Card({ icon, title, hint, aside, children }: { icon: string; title: string; hint?: React.ReactNode; aside?: React.ReactNode; children?: React.ReactNode; }) {
    return (
        <section className={cl("card")}>
            <div className={cl("card-head")}>
                <span className={cl("card-icon")} aria-hidden>{icon}</span>
                <h3 className={cl("card-title")}>{title}</h3>
                {aside}
            </div>
            {hint && <span className="vc-tool-hint">{hint}</span>}
            {children}
        </section>
    );
}

function Toggle({ icon, title, sub, on, set, danger }: { icon: string; title: string; sub?: string; on: boolean; set(v: boolean): void; danger?: boolean; }) {
    return (
        <button type="button" role="switch" aria-checked={on} className={classes(cl("toggle"), on && cl("toggle-on"), danger && cl("toggle-danger"))} onClick={() => set(!on)}>
            <span className={cl("toggle-icon")} aria-hidden>{icon}</span>
            <span className={cl("toggle-text")}>
                <b>{title}</b>
                {sub && <small>{sub}</small>}
            </span>
            <span className={cl("switch")} aria-hidden><i /></span>
        </button>
    );
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const asInput = (raw: string) => /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : (parseDate(raw) ? ymd(parseDate(raw)!) : "");
const niceDate = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const WHEN: { id: string; label: string; after(): string; }[] = [
    { id: "any", label: "Any time", after: () => "" },
    { id: "day", label: "Last 24 hours", after: () => new Date(Date.now() - 86_400_000).toISOString() },
    { id: "week", label: "Last 7 days", after: () => new Date(Date.now() - 7 * 86_400_000).toISOString() },
    { id: "month", label: "Last 30 days", after: () => new Date(Date.now() - 30 * 86_400_000).toISOString() },
    { id: "year", label: "This year", after: () => `${new Date().getFullYear()}-01-01` },
];

// #endregion

// #region Controls Panel

interface GlobalState {
    blacklistedChannels: string[];
    setBlacklistedChannels: (v: string[]) => void;
    globalPostBlock: string[];
    setGlobalPostBlock: (v: string[]) => void;
    globalPostUnadd: string[];
    setGlobalPostUnadd: (v: string[]) => void;
    globalPostClose: string[];
    setGlobalPostClose: (v: string[]) => void;
    globalLeaveMessages: Record<string, string>;
    setGlobalLeaveMessages: (v: Record<string, string>) => void;
}

interface ControlsPanelProps {
    channel: Channel;
    globalMode: boolean;
    optsRef: React.MutableRefObject<PurgeOptions | null>;
    globalState: GlobalState;
    extraRight?: React.ReactNode;
}

function ControlsPanel({ channel, globalMode, optsRef, globalState, extraRight }: ControlsPanelProps) {
    const [onlyOwn, setOnlyOwn] = useState(true);
    const [includePinned, setIncludePinned] = useState(false);
    const [contentFilter, setContentFilter] = useState("");
    const [hasLink, setHasLink] = useState(false);
    const [hasFile, setHasFile] = useState(false);
    const [hasEmbed, setHasEmbed] = useState(false);
    const [afterDate, setAfterDate] = useState("");
    const [beforeDate, setBeforeDate] = useState("");
    const [preset, setPreset] = useState("any");
    const [deleteDelay, setDeleteDelay] = useState(Math.max(settings.store.deleteDelay, 500));
    const [searchDelay, setSearchDelay] = useState(Math.max(settings.store.searchDelay, 750));
    const [autoRateLimit, setAutoRateLimit] = useState(settings.store.autoRateLimit);
    const [deleteOrder, setDeleteOrder] = useState<DeleteOrder>("newest_first");
    const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
    const [removeReactions, setRemoveReactions] = useState(false);
    const [scanActivities, setScanActivities] = useState(false);
    const [postBlock, setPostBlock] = useState(false);
    const [postUnadd, setPostUnadd] = useState(false);
    const [postClose, setPostClose] = useState(false);
    const [leaveMessage, setLeaveMessage] = useState("");

    const { blacklistedChannels, globalPostBlock, globalPostUnadd, globalPostClose, globalLeaveMessages } = globalState;

    const currentUserId = UserStore.getCurrentUser()?.id;
    const isGuild = !globalMode && !!channel.guild_id;
    const isDm = !isGuild && !globalMode;
    const channelLabel = globalMode ? "All DMs" : (channel.name ? `#${channel.name}` : `DM ${channel.id}`);
    const channelOptions = useGuildChannels(isGuild ? channel.guild_id : null);

    const afterParsed = parseDate(afterDate);
    const beforeParsed = parseDate(beforeDate);

    optsRef.current = {
        channelId: globalMode ? "" : channel.id,
        guildId: globalMode ? null : (channel.guild_id ?? null),
        channelLabel,
        authorId: onlyOwn ? (currentUserId ?? null) : null,
        content: contentFilter.trim(),
        hasLink,
        hasFile,
        hasEmbed,
        includePinned,
        afterDate: afterParsed?.toISOString() ?? null,
        beforeDate: beforeParsed?.toISOString() ?? null,
        channelIds: isGuild && selectedChannels.length ? selectedChannels : null,
        deleteDelay,
        searchDelay,
        autoRateLimit,
        deleteOrder,
        global: globalMode,
        blacklistedChannels,
        removeReactions: !isGuild && removeReactions,
        scanActivities: !isGuild && scanActivities,
        postBlock: isDm && postBlock,
        postUnadd: isDm && postUnadd,
        postClose: isDm && postClose,
        leaveMessage: isDm ? leaveMessage.trim() : "",
        globalPostBlock: globalMode ? globalPostBlock : [],
        globalPostUnadd: globalMode ? globalPostUnadd : [],
        globalPostClose: globalMode ? globalPostClose : [],
        globalLeaveMessages: globalMode ? globalLeaveMessages : {},
    };

    // One plain sentence of what pressing Start will do.
    const kinds = [hasLink && "links", hasFile && "files", hasEmbed && "embeds"].filter(Boolean) as string[];
    const summary = [
        `${onlyOwn ? "your" : "anyone's"} messages${kinds.length ? ` with ${kinds.join(" or ")}` : ""}`,
        contentFilter.trim() && `containing “${contentFilter.trim()}”`,
        globalMode ? `in every DM${blacklistedChannels.length ? ` except ${blacklistedChannels.length}` : ""}` : isGuild && selectedChannels.length ? `in ${selectedChannels.length} channel${selectedChannels.length === 1 ? "" : "s"}` : `in ${channelLabel}`,
        afterParsed && beforeParsed ? `from ${niceDate(afterParsed)} to before ${niceDate(beforeParsed)}` : afterParsed ? `since ${niceDate(afterParsed)}` : beforeParsed ? `before ${niceDate(beforeParsed)}` : "from any time",
        includePinned ? "pinned ones included" : "pinned ones kept",
    ].filter(Boolean).join(" · ");

    const what = (
        <Card icon="🎯" title="What to delete">
            <div className={cl("toggles")}>
                <Toggle icon="🙋" title="Only my messages" sub={onlyOwn ? "Messages you sent" : "Anyone's — needs Manage Messages"} on={onlyOwn} set={setOnlyOwn} />
                <Toggle icon="📌" title="Pinned ones too" sub="Kept unless this is on" on={includePinned} set={setIncludePinned} danger />
                <Toggle icon="🔗" title="Only with links" on={hasLink} set={setHasLink} />
                <Toggle icon="📎" title="Only with files" sub="Pictures, videos, anything attached" on={hasFile} set={setHasFile} />
                <Toggle icon="🧩" title="Only with embeds" sub="Embeds or activities" on={hasEmbed} set={setHasEmbed} />
                {!isGuild && <Toggle icon="😀" title="My reactions too" sub="Removes them as well" on={removeReactions} set={setRemoveReactions} />}
                {!isGuild && <Toggle icon="⚡" title="Find activities" sub="Command replies search misses" on={scanActivities} set={setScanActivities} />}
            </div>
            <label className="vc-tool-field">
                <span className="vc-tool-label">Containing text</span>
                <input className="vc-tool-input" placeholder="Only messages with these words (optional)" value={contentFilter} onChange={e => setContentFilter(e.currentTarget.value)} />
            </label>
        </Card>
    );

    const when = (
        <Card icon="📅" title="When">
            <div className="vc-tool-chips">
                {WHEN.map(w => (
                    <button key={w.id} type="button" className={classes("vc-tool-chip", preset === w.id && "vc-tool-chip-on")}
                        onClick={() => { setPreset(w.id); setAfterDate(w.after()); setBeforeDate(""); }}>{w.label}</button>
                ))}
            </div>
            <div className={cl("dates")}>
                <label className="vc-tool-field">
                    <span className="vc-tool-label">From</span>
                    <input type="date" className={classes("vc-tool-input", cl("date"))} value={asInput(afterDate)} max={ymd(new Date())}
                        onChange={e => { setPreset(""); setAfterDate(e.currentTarget.value); }} />
                </label>
                <label className="vc-tool-field">
                    <span className="vc-tool-label">Before</span>
                    <input type="date" className={classes("vc-tool-input", cl("date"))} value={asInput(beforeDate)}
                        onChange={e => { setPreset(""); setBeforeDate(e.currentTarget.value); }} />
                </label>
            </div>
            {afterParsed && beforeParsed && afterParsed >= beforeParsed && <span className={cl("warn")}>⚠ “From” is after “Before” — nothing will match.</span>}
        </Card>
    );

    const channels = isGuild && (
        <Card icon="#️⃣" title="Channels" hint="Leave empty to only do this channel."
            aside={(
                <span className={cl("card-actions")}>
                    <button type="button" className="vc-tool-link" onClick={() => setSelectedChannels(channelOptions.map(c => c.id))}>All</button>
                    {selectedChannels.length > 0 && <button type="button" className="vc-tool-link" onClick={() => setSelectedChannels([])}>Clear</button>}
                </span>
            )}>
            <ManaSelect
                options={channelOptions}
                value={selectedChannels}
                onSelectionChange={(v: string | string[] | null) => setSelectedChannels(Array.isArray(v) ? v : v ? [v] : [])}
                selectionMode="multiple"
                placeholder="Just this channel"
                clearable
                fullWidth
                wrapTags
                maxOptionsVisible={8}
            />
        </Card>
    );

    const afterwards = isDm && (
        <Card icon="👋" title="When it's done">
            <div className={cl("toggles")}>
                <Toggle icon="🚫" title="Block them" on={postBlock} set={setPostBlock} danger />
                <Toggle icon="💔" title="Remove friend" on={postUnadd} set={setPostUnadd} danger />
                <Toggle icon="📪" title="Close the DM" on={postClose} set={setPostClose} />
            </div>
            <label className="vc-tool-field">
                <span className="vc-tool-label">Leave a message behind</span>
                <input className="vc-tool-input" placeholder="Optional — this one stays, even in later purges" value={leaveMessage} onChange={e => setLeaveMessage(e.currentTarget.value)} />
            </label>
        </Card>
    );

    const speed = (
        <Card icon="⚙️" title="Order & speed">
            <div className="vc-tool-seg">
                {([["newest_first", "Newest first"], ["oldest_first", "Oldest first"]] as const).map(([v, label]) => (
                    <button key={v} type="button" className={classes("vc-tool-seg-btn", deleteOrder === v && "vc-tool-seg-on")} onClick={() => setDeleteOrder(v)}>{label}</button>
                ))}
            </div>
            <Toggle icon="🛡️" title="Safe speed" sub={autoRateLimit ? "Follows Discord's limits, with room to spare" : "Using your own delays below"} on={autoRateLimit}
                set={v => { setAutoRateLimit(v); settings.store.autoRateLimit = v; }} />
            {!autoRateLimit && (
                <>
                    <label className={cl("range")}>
                        <span>Between deletes <b>{deleteDelay} ms</b></span>
                        <input type="range" className="vc-tool-range" min={500} max={3000} step={50} value={deleteDelay} onChange={e => setDeleteDelay(Number(e.currentTarget.value))} />
                    </label>
                    <label className={cl("range")}>
                        <span>Between searches <b>{searchDelay} ms</b></span>
                        <input type="range" className="vc-tool-range" min={750} max={3000} step={50} value={searchDelay} onChange={e => setSearchDelay(Number(e.currentTarget.value))} />
                    </label>
                </>
            )}
        </Card>
    );

    return (
        <>
            <div className={cl("summary")}>
                <span className={cl("summary-icon")} aria-hidden>🗑️</span>
                <span><b>Deletes</b> {summary}</span>
            </div>
            <div className={cl("cols")}>
                <div className={cl("col")}>
                    {what}
                    {globalMode && when}
                    {globalMode && speed}
                </div>
                <div className={cl("col")}>
                    {globalMode ? extraRight : (
                        <>
                            {when}
                            {channels}
                            {afterwards}
                            {speed}
                        </>
                    )}
                </div>
            </div>
        </>
    );
}

interface DmChannelEntry {
    id: string;
    displayName: string;
    username: string;
    avatarUrl: string;
}

function useAllDmChannels(): DmChannelEntry[] {
    return useCallback(() => {
        try {
            const ids: string[] = PrivateChannelSortStore.getPrivateChannelIds?.() ?? [];
            return ids.map(id => {
                const ch = ChannelStore.getChannel(id);
                if (!ch) return null;
                const recipientId = (ch as { recipients?: string[]; }).recipients?.[0];
                if (recipientId) {
                    const user = UserStore.getUser(recipientId);
                    const avatarUrl = user
                        ? (IconUtils.getUserAvatarURL(user as never) ?? IconUtils.getDefaultAvatarURL(recipientId))
                        : IconUtils.getDefaultAvatarURL(recipientId);
                    return {
                        id,
                        displayName: user?.globalName ?? user?.username ?? `DM …${id.slice(-4)}`,
                        username: user?.username ?? "",
                        avatarUrl,
                    };
                }
                if (ch.name) return { id, displayName: ch.name, username: "", avatarUrl: IconUtils.getDefaultAvatarURL(id) };
                return null;
            }).filter((x): x is DmChannelEntry => x != null);
        } catch {
            return [];
        }
    }, [])();
}

const matches = (ch: DmChannelEntry, q: string) => !q || ch.displayName.toLowerCase().includes(q) || ch.username.toLowerCase().includes(q);

function Person({ ch, children, onClick, className }: { ch: DmChannelEntry; children?: React.ReactNode; onClick?(): void; className?: string; }) {
    return (
        <div className={classes(cl("person"), onClick && cl("person-click"), className)} onClick={onClick} role={onClick ? "button" : undefined}>
            <img className={cl("person-avatar")} src={ch.avatarUrl} alt="" />
            <span className={cl("person-name")}>
                <b>{ch.displayName}</b>
                {ch.username && ch.username !== ch.displayName && <small>@{ch.username}</small>}
            </span>
            {children}
        </div>
    );
}

function DmChannelPicker({ blacklisted, onChange }: { blacklisted: string[]; onChange: (ids: string[]) => void; }) {
    const channels = useAllDmChannels();
    const [search, setSearch] = useState("");
    const q = search.trim().toLowerCase();
    const filtered = channels.filter(ch => matches(ch, q));
    const toggle = (id: string) => onChange(blacklisted.includes(id) ? blacklisted.filter(x => x !== id) : [...blacklisted, id]);

    if (!channels.length) return <div className="vc-tool-empty"><span className="vc-tool-empty-icon">📭</span>No DMs found.</div>;

    return (
        <div className={cl("people")}>
            <input className="vc-tool-input" placeholder={`Search ${channels.length} DMs…`} value={search} onChange={e => setSearch(e.currentTarget.value)} />
            <div className={cl("people-list")}>
                {filtered.length === 0 ? <span className="vc-tool-hint">Nobody matches.</span> : filtered.map(ch => {
                    const skipped = blacklisted.includes(ch.id);
                    return (
                        <Person key={ch.id} ch={ch} onClick={() => toggle(ch.id)} className={skipped ? cl("person-skipped") : undefined}>
                            <span className={classes(cl("pill"), skipped && cl("pill-keep"))}>{skipped ? "🛡️ Kept" : "Purge"}</span>
                        </Person>
                    );
                })}
            </div>
        </div>
    );
}

interface DmActionPickerProps {
    blockIds: string[];
    onBlockChange: (ids: string[]) => void;
    unaddIds: string[];
    onUnaddChange: (ids: string[]) => void;
    closeIds: string[];
    onCloseChange: (ids: string[]) => void;
    leaveMessages: Record<string, string>;
    onLeaveMessagesChange: (msgs: Record<string, string>) => void;
}

function DmActionPicker({ blockIds, onBlockChange, unaddIds, onUnaddChange, closeIds, onCloseChange, leaveMessages, onLeaveMessagesChange }: DmActionPickerProps) {
    const channels = useAllDmChannels();
    const [search, setSearch] = useState("");
    const [expandedMsg, setExpandedMsg] = useState<string | null>(null);
    const [showGlobalMsg, setShowGlobalMsg] = useState(false);
    const [globalMsgText, setGlobalMsgText] = useState("");
    const q = search.trim().toLowerCase();
    const filtered = channels.filter(ch => matches(ch, q));

    const toggleList = (id: string, list: string[], onChange: (ids: string[]) => void) => onChange(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
    const allIn = (list: string[]) => channels.length > 0 && channels.every(ch => list.includes(ch.id));
    const toggleAll = (list: string[], onChange: (ids: string[]) => void) => onChange(allIn(list) ? [] : channels.map(ch => ch.id));
    const msgCount = Object.keys(leaveMessages).length;

    if (!channels.length) return <div className="vc-tool-empty"><span className="vc-tool-empty-icon">📭</span>No DMs found.</div>;

    const ACTIONS = [
        { icon: "🚫", label: "Block", list: blockIds, set: onBlockChange },
        { icon: "💔", label: "Unfriend", list: unaddIds, set: onUnaddChange },
        { icon: "📪", label: "Close", list: closeIds, set: onCloseChange },
    ];

    return (
        <div className={cl("people")}>
            <div className="vc-tool-chips">
                {ACTIONS.map(a => (
                    <button key={a.label} type="button" className={classes("vc-tool-chip", allIn(a.list) && "vc-tool-chip-on")} onClick={() => toggleAll(a.list, a.set)}>
                        {a.icon} {allIn(a.list) ? `Undo ${a.label.toLowerCase()} all` : `${a.label} all`}
                    </button>
                ))}
                <button type="button" className={classes("vc-tool-chip", (showGlobalMsg || msgCount > 0) && "vc-tool-chip-on")} onClick={() => setShowGlobalMsg(!showGlobalMsg)}>💬 Message all</button>
            </div>

            {showGlobalMsg && (
                <div className="vc-tool-row">
                    <input className={classes("vc-tool-input", "vc-tool-grow")} placeholder="One message left in every DM…" value={globalMsgText} onChange={e => setGlobalMsgText(e.currentTarget.value)} />
                    <button type="button" className={classes("vc-tool-btn", "vc-tool-primary")} disabled={!globalMsgText.trim()}
                        onClick={() => { const next: Record<string, string> = {}; for (const ch of channels) next[ch.id] = globalMsgText; onLeaveMessagesChange(next); }}>Apply</button>
                    {msgCount > 0 && <button type="button" className={classes("vc-tool-btn", "vc-tool-danger")} onClick={() => onLeaveMessagesChange({})}>Clear</button>}
                </div>
            )}

            <input className="vc-tool-input" placeholder={`Search ${channels.length} DMs…`} value={search} onChange={e => setSearch(e.currentTarget.value)} />
            <div className={cl("people-list")}>
                {filtered.length === 0 ? <span className="vc-tool-hint">Nobody matches.</span> : filtered.map(ch => {
                    const hasMsg = !!leaveMessages[ch.id];
                    const open = expandedMsg === ch.id;
                    return (
                        <div key={ch.id} className={cl("person-wrap")}>
                            <Person ch={ch}>
                                <span className={cl("acts")}>
                                    {ACTIONS.map(a => (
                                        <button key={a.label} type="button" title={a.label} aria-label={a.label} aria-pressed={a.list.includes(ch.id)}
                                            className={classes(cl("act"), a.list.includes(ch.id) && cl("act-on"))} onClick={() => toggleList(ch.id, a.list, a.set)}>{a.icon}</button>
                                    ))}
                                    <button type="button" title="Leave a message" aria-label="Leave a message" aria-pressed={hasMsg}
                                        className={classes(cl("act"), (hasMsg || open) && cl("act-msg"))} onClick={() => setExpandedMsg(open ? null : ch.id)}>💬</button>
                                </span>
                            </Person>
                            {open && (
                                <input className={classes("vc-tool-input", cl("person-msg"))} autoFocus placeholder={`A message left for ${ch.displayName}…`} value={leaveMessages[ch.id] ?? ""}
                                    onChange={e => {
                                        const v = e.currentTarget.value;
                                        const next = { ...leaveMessages };
                                        if (v.trim()) next[ch.id] = v;
                                        else delete next[ch.id];
                                        onLeaveMessagesChange(next);
                                    }} />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function GlobalRightPanel({ globalState }: { globalState: GlobalState; }) {
    const { blacklistedChannels, setBlacklistedChannels, globalPostBlock, setGlobalPostBlock, globalPostUnadd, setGlobalPostUnadd, globalPostClose, setGlobalPostClose, globalLeaveMessages, setGlobalLeaveMessages } = globalState;
    return (
        <>
            <Card icon="🛡️" title="Keep these DMs" hint="Tap someone to leave your messages with them alone."
                aside={blacklistedChannels.length > 0 && (
                    <span className={cl("card-actions")}>
                        <span className="vc-tool-badge vc-tool-badge-accent">{blacklistedChannels.length} kept</span>
                        <button type="button" className="vc-tool-link" onClick={() => setBlacklistedChannels([])}>Clear</button>
                    </span>
                )}>
                <DmChannelPicker blacklisted={blacklistedChannels} onChange={setBlacklistedChannels} />
            </Card>
            <Card icon="👋" title="When it's done" hint="Pick what happens with each person afterwards.">
                <DmActionPicker
                    blockIds={globalPostBlock}
                    onBlockChange={setGlobalPostBlock}
                    unaddIds={globalPostUnadd}
                    onUnaddChange={setGlobalPostUnadd}
                    closeIds={globalPostClose}
                    onCloseChange={setGlobalPostClose}
                    leaveMessages={globalLeaveMessages}
                    onLeaveMessagesChange={setGlobalLeaveMessages}
                />
            </Card>
        </>
    );
}

function useGuildChannels(guildId: string | null) {
    return useCallback(() => {
        if (!guildId) return [];
        try {
            const collection = GuildChannelStore.getChannels(guildId);
            const channels: { id: string; value: string; label: string; }[] = [];
            const seen = new Set<string>();
            if (collection?.SELECTABLE) {
                for (const entry of collection.SELECTABLE) {
                    const ch = entry?.channel;
                    if (ch?.name && !seen.has(ch.id)) {
                        seen.add(ch.id);
                        channels.push({ id: ch.id, value: ch.id, label: `#${ch.name}` });
                    }
                }
            }
            const vocal = collection?.VOCAL;
            if (vocal) {
                const list = Array.isArray(vocal) ? vocal : Object.values(vocal);
                for (const entry of list) {
                    const ch = (entry as { channel?: { id: string; name: string; }; })?.channel;
                    if (ch?.name && !seen.has(ch.id)) {
                        seen.add(ch.id);
                        channels.push({ id: ch.id, value: ch.id, label: `🔊 ${ch.name}` });
                    }
                }
            }
            return channels;
        } catch {
            return [];
        }
    }, [guildId])();
}

// #endregion

// #region Running Panel

function formatEta(sec: number): string {
    if (sec < 60) return `~${Math.round(sec)}s`;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return s > 0 ? `~${m}m ${s}s` : `~${m}m`;
}

function useEta(engine: PurgeEngineData) {
    const isDeleting = engine.state === "running";
    const [eta, setEta] = useState<string | null>(null);
    useEffect(() => {
        if (!isDeleting || !engine.startTime) { setEta(null); return; }
        const tick = () => {
            const processed = engine.deleted + engine.failed;
            const remaining = engine.toDelete - processed;
            if (remaining <= 0 || processed <= 0) { setEta(null); return; }
            const elapsed = (Date.now() - (engine.startTime ?? 0)) / 1000;
            if (elapsed < 1) { setEta("Working it out…"); return; }
            setEta(formatEta(remaining / (processed / elapsed)));
        };
        tick();
        const id = setInterval(tick, 2000);
        return () => clearInterval(id);
    }, [isDeleting, engine.startTime, engine.deleted, engine.failed, engine.toDelete]);
    return eta;
}

function RunningPanel({ eta }: { eta: string | null; }) {
    const engine = useEngine();
    const isFetching = engine.state === "fetching";
    const isDeleting = engine.state === "running";
    const processed = engine.deleted + engine.failed;

    const progress = isFetching
        ? (engine.totalFound > 0 ? Math.min((engine.fetched / engine.totalFound) * 100, 100) : 0)
        : engine.toDelete > 0 ? Math.min((processed / engine.toDelete) * 100, 100) : engine.state === "done" ? 100 : 0;
    const pct = Math.round(progress);
    const byChannel = Object.entries(engine.fetchedByChannel).sort(([, a], [, b]) => b - a);

    return (
        <Card icon="📊" title="Progress">
            <div className={cl("progress-meta")}>
                <span>{isFetching ? "Finding messages" : isDeleting ? "Deleting" : engine.state === "done" ? "Finished" : "Stopped"}</span>
                <b>{pct}%{eta ? ` · ${eta} left` : ""}</b>
            </div>
            <div className={cl("progress")}>
                <div className={classes(cl("progress-bar"), (isFetching || isDeleting) && !engine.paused && cl("progress-live"))} style={{ width: `${Math.max(progress, 2)}%` }} />
            </div>

            <div className={cl("tiles")}>
                {isFetching ? (
                    <>
                        <div className={cl("tile")}><b>{engine.fetched.toLocaleString()}</b><span>Collected</span></div>
                        <div className={cl("tile")}><b>{engine.totalFound ? engine.totalFound.toLocaleString() : "—"}</b><span>Found</span></div>
                    </>
                ) : (
                    <>
                        <div className={classes(cl("tile"), cl("tile-good"))}><b>{engine.deleted.toLocaleString()}</b><span>Deleted</span></div>
                        <div className={classes(cl("tile"), engine.failed > 0 && cl("tile-bad"))}><b>{engine.failed.toLocaleString()}</b><span>Failed</span></div>
                        <div className={cl("tile")}><b>{Math.max(engine.toDelete - processed, 0).toLocaleString()}</b><span>Left</span></div>
                        <div className={cl("tile")}><b>{engine.skipped.toLocaleString()}</b><span>Skipped</span></div>
                    </>
                )}
            </div>

            <div className={classes(cl("pacing"), engine.coolingDown && cl("pacing-cooling"))}>
                <span className={cl("pacing-icon")} aria-hidden>{engine.coolingDown ? "⏳" : "🛡️"}</span>
                <span className={cl("pacing-text")}>
                    <b>{engine.coolingDown ? "Cooling down" : "Going at a safe speed"}</b>
                    <small>{engine.pacing || "Starting…"} · {engine.rateLimitHits === 0 ? "Discord hasn't asked to slow down" : `Discord asked to slow down ${engine.rateLimitHits}×`}</small>
                </span>
            </div>

            {isFetching && byChannel.length > 0 && (
                <div className={cl("breakdown")}>
                    <span className="vc-tool-label">Found in each DM</span>
                    <div className={cl("breakdown-list")}>
                        {byChannel.map(([cid, count]) => (
                            <div key={cid} className={cl("breakdown-row")}><span>{getDmLabel(cid)}</span><b>{count}</b></div>
                        ))}
                    </div>
                </div>
            )}
        </Card>
    );
}

// #endregion

// #region Preview Panel

function PreviewPanel() {
    const engine = useEngine();
    const scrollRef = useRef<HTMLDivElement>(null);
    const prevLenRef = useRef(0);

    useEffect(() => {
        if (engine.preview.length > prevLenRef.current && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
        prevLenRef.current = engine.preview.length;
    }, [engine.preview.length]);

    return (
        <Card icon="👀" title="Live preview" aside={<span className="vc-tool-badge">{engine.preview.length.toLocaleString()}</span>}>
            {!engine.preview.length ? (
                <div className="vc-tool-empty"><span className="vc-tool-empty-icon">{engine.state === "fetching" ? "🔍" : "📭"}</span>{engine.state === "fetching" ? "Looking for messages…" : "Messages show up here as they're found."}</div>
            ) : (
                <div ref={scrollRef} className={cl("feed")}>
                    {engine.preview.map(entry => <MessagePreviewRow key={entry.msg.id} entry={entry} />)}
                </div>
            )}
        </Card>
    );
}

// #endregion

// #region Modal

type ActiveTab = "channel" | "global";

function PurgeModal({ modalProps, channel }: { modalProps: RenderModalProps; channel: Channel; }) {
    const engine = useEngine();
    const eta = useEta(engine);
    const accent = windowAccent("messageCleanerUtil");
    const isActive = engine.state !== "idle";
    const working = engine.state === "fetching" || engine.state === "running";
    const channelLabel = channel.name ? `#${channel.name}` : getDmLabel(channel.id);
    const optsRef = useRef<PurgeOptions | null>(null);
    const [activeTab, setActiveTab] = useState<ActiveTab>("channel");
    const [sure, setSure] = useState(false);

    const [blacklistedChannels, setBlacklistedChannels] = useState<string[]>([]);
    const [globalPostBlock, setGlobalPostBlock] = useState<string[]>([]);
    const [globalPostUnadd, setGlobalPostUnadd] = useState<string[]>([]);
    const [globalPostClose, setGlobalPostClose] = useState<string[]>([]);
    const [globalLeaveMessages, setGlobalLeaveMessages] = useState<Record<string, string>>({});

    const globalState: GlobalState = {
        blacklistedChannels, setBlacklistedChannels,
        globalPostBlock, setGlobalPostBlock,
        globalPostUnadd, setGlobalPostUnadd,
        globalPostClose, setGlobalPostClose,
        globalLeaveMessages, setGlobalLeaveMessages,
    };

    // "All DMs" asks once more before it starts.
    useEffect(() => { setSure(false); }, [activeTab]);
    useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 4000); return () => clearTimeout(t); }, [sure]);
    const start = () => {
        if (!optsRef.current) return;
        if (activeTab === "global" && !sure) { setSure(true); return; }
        setSure(false);
        runPurge(optsRef.current);
    };

    const stateLabel = engine.paused ? "Paused" : engine.state === "fetching" ? "Finding messages" : engine.state === "running" ? "Deleting" : engine.state === "done" ? "All done" : "Stopped";
    const left = Math.max(engine.toDelete - engine.deleted - engine.failed, 0);

    return (
        <Window {...modalProps} size="xl" title="Message Purger" subtitle={working ? `${stateLabel} — you can close this window, it keeps going` : isActive ? stateLabel : "Delete your messages in bulk — you can pause or stop any time"}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                {isActive ? (
                    <ToolHero icon={engine.state === "done" ? "✅" : engine.state === "stopped" ? "⏹️" : engine.paused ? "⏸️" : "🗑️"}
                        kicker={stateLabel}
                        title={engine.state === "done" ? `${engine.deleted.toLocaleString()} message${engine.deleted === 1 ? "" : "s"} deleted` : `Purging ${engine.channelLabel || channelLabel}`}
                        sub={engine.status || (eta ? `About ${eta.replace("~", "")} left` : engine.channelLabel || channelLabel)}
                        numbers={engine.state === "fetching"
                            ? [{ value: engine.fetched.toLocaleString(), label: "found so far" }]
                            : [{ value: engine.deleted.toLocaleString(), label: "deleted" }, { value: left.toLocaleString(), label: "left" }]}>
                        {working && <button type="button" className="vc-tool-btn" onClick={engine.paused ? resumePurge : pausePurge}>{engine.paused ? "▶ Resume" : "⏸ Pause"}</button>}
                    </ToolHero>
                ) : (
                    <ToolHero icon="🗑️" kicker={activeTab === "global" ? "Every DM" : channel.guild_id ? channelLabel : `DM · ${channelLabel}`}
                        title={activeTab === "global" ? "Purge all your DMs" : "Purge messages"}
                        sub="Pick what to delete below, then start. It keeps going even if you close this window." />
                )}

                {!isActive && (
                    <div className="vc-tool-seg">
                        <button type="button" className={classes("vc-tool-seg-btn", activeTab === "channel" && "vc-tool-seg-on")} onClick={() => setActiveTab("channel")}>
                            {channel.guild_id ? "💬 This channel" : "💬 This DM"}
                        </button>
                        <button type="button" className={classes("vc-tool-seg-btn", activeTab === "global" && "vc-tool-seg-on")} onClick={() => setActiveTab("global")}>🌐 All DMs</button>
                    </div>
                )}

                {isActive ? (
                    <div className={cl("cols")}>
                        <div className={cl("col")}><RunningPanel eta={eta} /></div>
                        <div className={cl("col")}><PreviewPanel /></div>
                    </div>
                ) : (
                    <ControlsPanel key={activeTab} channel={channel} globalMode={activeTab === "global"} optsRef={optsRef} globalState={globalState}
                        extraRight={activeTab === "global" ? <GlobalRightPanel globalState={globalState} /> : undefined} />
                )}

                <div className={classes("vc-tool-footer", cl("footer"))}>
                    {settings.store.keybind && !isActive && <span className="vc-tool-hint">Shortcut: <kbd className={cl("kbd")}>{settings.store.keybind}</kbd></span>}
                    <span className="vc-tool-spacer" />
                    {engine.state === "idle" && (
                        <>
                            <button type="button" className="vc-tool-btn" onClick={modalProps.onClose}>Cancel</button>
                            <button type="button" className={classes("vc-tool-btn", cl("go"), sure && cl("go-sure"))} onClick={start}>
                                {sure ? "Sure? Click again to purge every DM" : activeTab === "global" ? "🗑️ Purge all DMs" : "🗑️ Start purging"}
                            </button>
                        </>
                    )}
                    {working && (
                        <>
                            <button type="button" className={classes("vc-tool-btn", "vc-tool-danger")} onClick={stopPurge}>⏹ Stop</button>
                            <button type="button" className={classes("vc-tool-btn", "vc-tool-primary")} onClick={modalProps.onClose}>Close</button>
                        </>
                    )}
                    {(engine.state === "done" || engine.state === "stopped") && (
                        <>
                            <button type="button" className="vc-tool-btn" onClick={resetEngine}>New purge</button>
                            <button type="button" className={classes("vc-tool-btn", "vc-tool-primary")} onClick={modalProps.onClose}>Close</button>
                        </>
                    )}
                </div>
            </div>
        </Window>
    );
}

// #endregion

function onPurgerKeydown(e: KeyboardEvent) {
    if (!matchesPurgerKeybind(e)) return;
    if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
    e.preventDefault();
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) return;
    const channel = ChannelStore.getChannel(channelId);
    if (channel) openPurgeModal(channel);
}

export default definePlugin({
    name: "Message Purger",
    description: "Bulk delete your messages from any channel or across all DMs using Discord's search API.",
    authors: [{ name: "eco", id: 666n }],
    settings,
    chatBarButton: {
        icon: TrashIconSettings,
        render: PurgerChatBarButton,
    },

    start() {
        document.addEventListener("keydown", onPurgerKeydown);
    },

    stop() {
        document.removeEventListener("keydown", onPurgerKeydown);
    },
});
