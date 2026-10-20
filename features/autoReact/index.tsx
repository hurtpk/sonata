/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./style.css";

import { classNameFactory } from "@utils/css";
import { classes, sleep } from "@utils/misc";
import { ModalProps, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, GuildMemberStore, IconUtils, MessageStore, ReactDOM, RestAPI, SearchableSelect, SelectedChannelStore, showToast, useEffect, useMemo, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { defineFeatureSettings } from "../../featureSettings";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";

const cl = classNameFactory("vc-autoreact-");
const tl = classNameFactory("vc-tool-");

const EmojiPickerComponent = findComponentByCodeLazy("shouldHidePickerActions");
const EmojiIntention = findByPropsLazy("REACTION", "STATUS", "CHAT");
const UnicodeEmojis = findByPropsLazy("getByCategory", "getByName");

// The panel is the only visible option — everything below is edited from
// inside it, so the raw fields are hidden to avoid a duplicate, unstyled
// copy of the same settings underneath. (Hidden options still exist and
// still show up in ChannelSettings' Keybinds tab, e.g. keybind and toggle.)
const settings = defineFeatureSettings("autoReact", {
    panel: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <AutoReactPanel />,
    },
    emoji: {
        type: OptionType.STRING,
        description: "Emoji to react with.",
        default: "👍",
        hidden: true,
    },
    emojiList: {
        type: OptionType.STRING,
        description: "Multiple emojis separated by comma for cycle mode.",
        default: "",
        hidden: true,
    },
    mode: {
        type: OptionType.SELECT,
        description: "Reaction mode.",
        options: [
            { label: "Single", value: "single", default: true },
            { label: "Cycle", value: "cycle" },
            { label: "Random", value: "random" },
        ],
        hidden: true,
    },
    toggle: {
        type: OptionType.BOOLEAN,
        description: "Auto react on/off.",
        default: false,
        hidden: true,
    },
    customUser: {
        type: OptionType.STRING,
        description: "User IDs to react to.",
        default: "",
        hidden: true,
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Delay in seconds before reacting.",
        default: 0.25,
        hidden: true,
    },
    currentChannelOnly: {
        type: OptionType.BOOLEAN,
        description: "Only react in the currently viewed channel.",
        default: false,
        hidden: true,
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Skip messages from bots.",
        default: true,
        hidden: true,
    },
    keybind: {
        type: OptionType.STRING,
        description: "Keybind to open the Auto React window.",
        default: "",
        hidden: true,
    },
});

function matchKb(e: KeyboardEvent, str: string): boolean {
    if (!str) return false;
    let ctrl = false, alt = false, shift = false, meta = false, key = "";
    for (const p of str.split("+").map(s => s.trim().toLowerCase()).filter(Boolean)) {
        if (p === "ctrl" || p === "control") ctrl = true;
        else if (p === "alt") alt = true;
        else if (p === "shift") shift = true;
        else if (p === "meta" || p === "cmd" || p === "super") meta = true;
        else key = p;
    }
    return !!key && ctrl === e.ctrlKey && alt === e.altKey && shift === e.shiftKey && meta === e.metaKey && e.key.toLowerCase() === key;
}

function parseEmojiInput(input: string): { id: string | null; name: string } {
    const trimmed = input.replace(/\s/g, "").replace(/[<>]/g, "");
    const match = trimmed.match(/^:?([^:]+):(\d+)$/);
    if (match) return { name: match[1], id: match[2] };
    return { id: null, name: trimmed || "👍" };
}

function splitList(s: string): string[] {
    return s.split(",").map(e => e.trim()).filter(Boolean);
}

function getRandomUnicodeEmoji(): { id: null; name: string } {
    const categories = ["people", "nature", "food", "activity", "travel", "objects", "symbols"];
    const cat = categories[Math.floor(Math.random() * categories.length)];
    const emojis = UnicodeEmojis.getByCategory(cat);
    if (!emojis?.length) return { id: null, name: "👍" };
    const pick = emojis[Math.floor(Math.random() * emojis.length)];
    return { id: null, name: pick.surrogates };
}

let cycleIndex = 0;
let lastReactedMessage = "";

async function tryReact(channelId: string, messageId: string, emoji: { id: string | null; name: string }) {
    try {
        const str = emoji.id ? `${emoji.name}:${emoji.id}` : encodeURIComponent(emoji.name);
        await RestAPI.put({ url: `/channels/${channelId}/messages/${messageId}/reactions/${str}/@me` });
    } catch { }
}

const MESSAGE_CREATE_HANDLER = async (e: { message: { id: string; author: { id: string; bot?: boolean } }; channelId: string }) => {
    if (!settings.store.toggle) return;

    const { id: messageId, author } = e.message;
    const { channelId } = e;

    if (!author?.id) return;
    if (messageId === lastReactedMessage) return;
    if (settings.store.ignoreBots && author.bot) return;

    const targets = splitList(settings.store.customUser);
    if (!targets.includes(author.id)) return;

    if (settings.store.currentChannelOnly && channelId !== SelectedChannelStore.getChannelId()) return;

    lastReactedMessage = messageId;

    await sleep(Math.max(0, (settings.store.delay ?? 0.25) * 1000));

    const mode = settings.store.mode ?? "single";
    if (mode === "random") {
        await tryReact(channelId, messageId, getRandomUnicodeEmoji());
    } else if (mode === "cycle") {
        const list = splitList(settings.store.emojiList);
        if (!list.length) return;
        await tryReact(channelId, messageId, parseEmojiInput(list[cycleIndex++ % list.length]));
    } else {
        if (!settings.store.emoji?.trim()) return;
        await tryReact(channelId, messageId, parseEmojiInput(settings.store.emoji));
    }
};

async function purgeSelfReactionsInCurrentChannel() {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) {
        showToast("No channel selected", "failure");
        return;
    }
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return;

    const list: any = MessageStore.getMessages(channelId);
    const messages = list?.toArray?.() ?? list?._array ?? [];
    const jobs: { messageId: string; emoji: { id: string | null; name: string; }; str: string; burst: boolean; }[] = [];

    for (const msg of messages) {
        for (const r of (msg.reactions ?? []) as any[]) {
            if (!r.me && !r.me_burst) continue;
            const e = r.emoji;
            const str = e.id ? `${e.name}:${e.id}` : encodeURIComponent(e.name);
            jobs.push({ messageId: msg.id, emoji: { id: e.id, name: e.name }, str, burst: !!r.me_burst });
        }
    }

    if (!jobs.length) {
        showToast("No reactions to remove in this channel", "message");
        return;
    }

    showToast(`Removing ${jobs.length} reaction${jobs.length === 1 ? "" : "s"}...`, "message");

    let ok = 0;
    let failed = 0;
    for (const j of jobs) {
        let attempts = 0;
        let waitMs = 0;
        while (attempts < 5) {
            attempts++;
            try {
                const res: any = await RestAPI.del({ url: `/channels/${channelId}/messages/${j.messageId}/reactions/${j.str}/@me` });
                ok++;
                FluxDispatcher.dispatch({
                    type: "MESSAGE_REACTION_REMOVE",
                    channelId,
                    messageId: j.messageId,
                    userId,
                    emoji: j.emoji,
                    burst: j.burst,
                });

                const h = res?.headers ?? {};
                const remaining = Number(h["x-ratelimit-remaining"] ?? h["X-RateLimit-Remaining"] ?? "1");
                const resetAfter = Number(h["x-ratelimit-reset-after"] ?? h["X-RateLimit-Reset-After"] ?? "0");
                if (remaining <= 0 && resetAfter > 0) waitMs = Math.ceil(resetAfter * 1000) + 20;
                break;
            } catch (err: any) {
                if (err?.status === 429) {
                    const retrySec = err.body?.retry_after ?? Number(err.headers?.["retry-after"] ?? 0.5);
                    waitMs = Math.max(0, Math.ceil(retrySec * 1000) + 50);
                    await sleep(waitMs);
                    waitMs = 0;
                    continue;
                }
                failed++;
                console.error("[AutoReact] purge failed", j, err?.body ?? err);
                break;
            }
        }
        if (waitMs > 0) await sleep(waitMs);
    }

    showToast(
        failed ? `Removed ${ok}, ${failed} failed (see console)` : `Removed ${ok} reaction${ok === 1 ? "" : "s"}`,
        failed ? "failure" : "success"
    );
}

function AutoReactIcon({ width, height }: { width?: number; height?: number }) {
    return (
        <svg width={width ?? 18} height={height ?? 18} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
        </svg>
    );
}

const MODES = [
    { id: "single", label: "Single", desc: "One emoji" },
    { id: "cycle", label: "Cycle", desc: "Rotate through list" },
    { id: "random", label: "Random", desc: "Surprise me" },
] as const;

// Auto React's own window, like before. Exposed as openSettingsModal so
// ChannelSettings treats it as this plugin's custom interface: a dock button
// added from its Dock tab opens this, and the Plugins tab shows an "open"
// button for it. The keybind opens it too.
function openAutoReactModal() {
    openModal(modalProps => <AutoReactPanel modalProps={modalProps} />);
}

function KeybindHint() {
    const parts = (settings.store.keybind ?? "").split("+").map(p => p.trim()).filter(Boolean);
    if (!parts.length) return <span />;
    return (
        <div className={cl("keys")}>
            {parts.map((p, i) => (
                <span key={i} style={{ display: "contents" }}>
                    {i > 0 && <span>+</span>}
                    <kbd className={cl("kbd")}>{p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1).toLowerCase()}</kbd>
                </span>
            ))}
            <span className={tl("hint")}>opens this</span>
        </div>
    );
}

// One UI, two places:
// - With modalProps: Auto React's own window (header close button, Save
//   Changes saves and closes) — the interface from before.
// - Without: the same UI on the plugin's settings page (no close button,
//   the settings window has its own; Save Changes saves in place and
//   confirms instead of closing).
// Either way the emoji picker is portaled to <body> so nothing clips it.
function AutoReactPanel({ modalProps }: { modalProps?: ModalProps; }) {
    const channelId = SelectedChannelStore.getChannelId();
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
    const currentUser = UserStore.getCurrentUser();
    const guildId = channel?.guild_id;

    const [active, setActive] = useState(!!settings.store.toggle);
    const [emoji, setEmoji] = useState(settings.store.emoji || "👍");
    const [emojiList, setEmojiList] = useState(settings.store.emojiList || "");
    const [mode, setMode] = useState<string>(settings.store.mode ?? "single");
    const [delay, setDelay] = useState(settings.store.delay ?? 0.25);
    const [userIds, setUserIds] = useState<string[]>(() => splitList(settings.store.customUser));
    const [currentChannelOnly, setCurrentChannelOnly] = useState(settings.store.currentChannelOnly ?? false);
    const [ignoreBots, setIgnoreBots] = useState(settings.store.ignoreBots ?? true);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [justSaved, setJustSaved] = useState(false);

    // Escape should close just the picker, not the whole settings window.
    useEffect(() => {
        if (!pickerOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            setPickerOpen(false);
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
    }, [pickerOpen]);

    useEffect(() => {
        if (!justSaved) return;
        const t = setTimeout(() => setJustSaved(false), 1600);
        return () => clearTimeout(t);
    }, [justSaved]);

    const userOptions = useMemo(() => {
        const opts: { label: string; value: string }[] = [];
        const seen = new Set<string>();

        if (currentUser?.id) {
            seen.add(currentUser.id);
            const name = currentUser.globalName ?? currentUser.username ?? "Me";
            opts.push({ label: `${name} (you)`, value: currentUser.id });
        }

        if (guildId) {
            try {
                for (const member of GuildMemberStore.getMembers(guildId) ?? []) {
                    const uid = (member as { userId?: string }).userId;
                    if (!uid || seen.has(uid)) continue;
                    seen.add(uid);
                    const user = UserStore.getUser(uid);
                    const { nick } = (member as { nick?: string | null });
                    const display = nick ?? user?.globalName ?? user?.username ?? uid;
                    const username = user?.username ?? uid;
                    opts.push({ label: display !== username ? `${display} (@${username})` : display, value: uid });
                }
            } catch { }
        } else if (channel) {
            for (const id of (channel.recipients ?? []) as string[]) {
                if (seen.has(id)) continue;
                seen.add(id);
                const user = UserStore.getUser(id);
                const display = user?.globalName ?? user?.username ?? id;
                const username = user?.username ?? id;
                opts.push({ label: display !== username ? `${display} (@${username})` : display, value: id });
            }
        }

        return opts;
    }, [guildId, channel?.recipients, currentUser?.id]);

    const toggleActive = () => {
        const next = !settings.store.toggle;
        settings.store.toggle = next;
        if (next) cycleIndex = 0;
        setActive(next);
    };

    const openPicker = () => {
        // The picker needs a channel to know which server emojis you can use.
        if (!channel) {
            showToast("Open a channel first to pick an emoji", "failure");
            return;
        }
        setPickerOpen(true);
    };

    const handleEmojiSelect = (e: { emoji: { id?: string; name: string; optionallyDiverseSequence?: string } }) => {
        const em = e.emoji;
        const val = em.id ? `:${em.name}:${em.id}` : (em.optionallyDiverseSequence ?? em.name);

        if (mode === "cycle") {
            const list = splitList(emojiList);
            list.push(val);
            setEmojiList(list.join(", "));
        } else {
            setEmoji(val);
        }
        setPickerOpen(false);
    };

    const handleSave = () => {
        settings.store.emoji = emoji.trim() || "👍";
        settings.store.emojiList = emojiList;
        settings.store.mode = mode;
        settings.store.delay = Math.max(0, delay);
        settings.store.customUser = userIds.join(",");
        settings.store.currentChannelOnly = currentChannelOnly;
        settings.store.ignoreBots = ignoreBots;
        cycleIndex = 0;
        if (modalProps) modalProps.onClose();
        else setJustSaved(true);
    };

    const accent = windowAccent("autoReact");
    const firstEmoji = (mode === "cycle" ? splitList(emojiList)[0] : emoji) ?? "";
    const heroIcon = mode === "random" ? "🎲" : firstEmoji && !firstEmoji.startsWith(":") ? firstEmoji : "✨";
    const removeEmoji = (i: number) => { const list = splitList(emojiList); list.splice(i, 1); setEmojiList(list.join(", ")); };

    const content = (
        <div className={classes(tl("wrap"), cl("panel"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
            <ToolHero icon={heroIcon} kicker={active ? "Reacting" : "Paused"}
                title={userIds.length ? `${userIds.length === 1 ? "1 person" : `${userIds.length} people`}${mode === "cycle" ? ` · ${splitList(emojiList).length} emojis in turn` : mode === "random" ? " · random emoji" : ""}` : "Nobody picked yet"}
                sub={active ? `Waits ${delay.toFixed(2)} s, then reacts${currentChannelOnly ? " — only in the channel you're looking at" : ""}.` : "Turn it on to start reacting."}>
                <button type="button" className={classes(cl("status"), active && cl("status-active"))} onClick={toggleActive} title={active ? "Click to pause" : "Click to turn on"}>
                    <span className={cl("status-dot")} />{active ? "Reacting" : "Paused"}
                </button>
            </ToolHero>

            <section className={tl("section")}>
                <h3 className={tl("section-title")}>👥 Whose messages</h3>
                {userIds.length > 0 ? (
                    <div className={tl("chips")}>
                        {userIds.map(uid => {
                            const user = UserStore.getUser(uid);
                            const member = guildId ? GuildMemberStore.getMember(guildId, uid) : null;
                            const name = (member as { nick?: string | null; })?.nick ?? user?.globalName ?? user?.username ?? uid;
                            const src = user?.getAvatarURL?.(undefined, 32) ?? IconUtils.getDefaultAvatarURL(uid);
                            return (
                                <span key={uid} className={classes(tl("chip"), cl("user"))}>
                                    <img className={cl("user-avatar")} src={src} alt="" />
                                    {name}
                                    <button type="button" className={tl("icon")} aria-label={`Remove ${name}`} onClick={() => setUserIds(userIds.filter(u => u !== uid))}>✕</button>
                                </span>
                            );
                        })}
                    </div>
                ) : <span className={tl("hint")}>Nobody yet — add someone below.</span>}
                <SearchableSelect
                    options={userOptions.filter(o => !userIds.includes(o.value))}
                    value={undefined}
                    placeholder="Add someone…"
                    maxVisibleItems={6}
                    closeOnSelect
                    onChange={v => {
                        const id = typeof v === "string" ? v : (v as { value?: string; })?.value;
                        if (id && !userIds.includes(id)) setUserIds([...userIds, id]);
                    }}
                    renderOptionPrefix={o => {
                        if (!o?.value) return null;
                        const user = UserStore.getUser(o.value);
                        const src = user?.getAvatarURL?.(undefined, 24) ?? IconUtils.getDefaultAvatarURL(o.value);
                        return <img src={src} style={{ width: 24, height: 24, borderRadius: "50%" }} alt="" />;
                    }}
                />
            </section>

            <section className={tl("section")}>
                <h3 className={tl("section-title")}>😀 Which reaction</h3>
                <div className={tl("tiles")}>
                    {MODES.map(m => (
                        <button key={m.id} type="button" className={classes(tl("tile"), mode === m.id && tl("tile-on"))} onClick={() => setMode(m.id)}>
                            <b>{m.label}</b><span>{m.desc}</span>
                        </button>
                    ))}
                </div>
                {mode === "single" && (
                    <button type="button" className={cl("emoji-card")} onClick={openPicker}>
                        <span className={cl("emoji-big")}>{emoji}</span>
                        <span className={tl("hint")}>Click to pick another</span>
                    </button>
                )}
                {mode === "cycle" && (
                    <div className={tl("chips")}>
                        {splitList(emojiList).map((e, i) => (
                            <span key={i} className={classes(tl("chip"), cl("emoji-chip"))}>
                                {e}
                                <button type="button" className={tl("icon")} aria-label="Remove" onClick={() => removeEmoji(i)}>✕</button>
                            </span>
                        ))}
                        <button type="button" className={classes(tl("chip"), cl("emoji-add"))} onClick={openPicker}>＋ Add</button>
                    </div>
                )}
                {mode === "random" && <span className={tl("hint")}>A random emoji for every message. Ones you'd need Nitro for are skipped.</span>}
            </section>

            <section className={tl("section")}>
                <div className={tl("head")}>
                    <h3 className={tl("section-title")} style={{ flex: 1 }}>⏱️ Wait before reacting</h3>
                    <b className={cl("value")}>{delay.toFixed(2)} s</b>
                </div>
                <input type="range" className={tl("range")} min={0} max={5} step={0.05} value={delay} onChange={e => setDelay(Number(e.currentTarget.value))} />
                <span className={tl("hint")}>A short wait looks more natural than reacting instantly.</span>
            </section>

            <section className={tl("section")}>
                <h3 className={tl("section-title")}>⚙️ Options</h3>
                <label className={tl("check")}><input type="checkbox" checked={currentChannelOnly} onChange={e => setCurrentChannelOnly(e.currentTarget.checked)} /> Only in the channel I'm looking at</label>
                <label className={tl("check")}><input type="checkbox" checked={ignoreBots} onChange={e => setIgnoreBots(e.currentTarget.checked)} /> Skip messages from bots</label>
                <div className={tl("footer")}>
                    <span className={tl("hint")}>Remove every reaction you've made in this channel.</span>
                    <span className={tl("spacer")} />
                    <button type="button" className={classes(tl("btn"), tl("danger"))} onClick={purgeSelfReactionsInCurrentChannel}>Remove my reactions here</button>
                </div>
            </section>

            <div className={tl("footer")}>
                <KeybindHint />
                <span className={tl("spacer")} />
                {modalProps && <button type="button" className={tl("btn")} onClick={modalProps.onClose}>Cancel</button>}
                <button type="button" className={classes(tl("btn"), tl("primary"))} onClick={handleSave}>{justSaved ? "Saved ✓" : "Save"}</button>
            </div>

            {pickerOpen && ReactDOM.createPortal(
                <>
                    <div className={cl("picker-backdrop")} onClick={() => setPickerOpen(false)} />
                    <div className={cl("picker-container")}>
                        <EmojiPickerComponent
                            containerWidth={418}
                            pickerIntention={EmojiIntention.REACTION}
                            channel={channel}
                            closePopout={() => setPickerOpen(false)}
                            onSelectEmoji={handleEmojiSelect}
                        />
                    </div>
                </>,
                document.body,
            )}
        </div>
    );

    return modalProps
        ? <Window {...modalProps} size="lg" title="Auto React" subtitle="React to someone's messages automatically">{content}</Window>
        : content;
}

let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

const plugin = definePlugin({
    name: "Auto React",
    openSettingsModal: openAutoReactModal,
    description: "Automatically react to messages from specific users with customizable emoji and timing.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,
    start() {
        if (!settings.store.customUser) settings.store.customUser = UserStore.getCurrentUser()?.id ?? "";
        cycleIndex = 0;
        FluxDispatcher.subscribe("MESSAGE_CREATE", MESSAGE_CREATE_HANDLER);
        keydownHandler = (e: KeyboardEvent) => {
            if (matchKb(e, settings.store.keybind)) {
                e.preventDefault();
                openAutoReactModal();
            }
        };
        document.addEventListener("keydown", keydownHandler, true);
    },
    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", MESSAGE_CREATE_HANDLER);
        if (keydownHandler) {
            document.removeEventListener("keydown", keydownHandler, true);
            keydownHandler = null;
        }
    },
});

export default plugin;
