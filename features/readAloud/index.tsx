/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Read Aloud: right-click a message (or use the speaker on its hover bar) to
// hear it in the voice you pick — or "Read from here" to hear the chat go by.
// It uses your computer's own voices and only plays for you; nothing is sent
// anywhere, and your mic is never touched.

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, GuildMemberStore, GuildRoleStore, Menu, MessageStore, RelationshipStore, showToast, useEffect, UserStore, useState } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { attachmentsText, Names, speakable } from "./speech";

const synth = () => (typeof speechSynthesis === "undefined" ? null : speechSynthesis);

function useVoices() {
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synth()?.getVoices() ?? []);
    useEffect(() => {
        const s = synth();
        if (!s) return;
        const update = () => setVoices(s.getVoices());
        s.addEventListener("voiceschanged", update);
        update();
        return () => s.removeEventListener("voiceschanged", update);
    }, []);
    return voices;
}

function VoicePicker() {
    const voices = useVoices();
    const [name, setName] = useState(settings.store.voiceName ?? "");
    if (!synth()) return <span className="vc-tool-hint">Your Discord can't speak — this computer has no text-to-speech.</span>;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <b style={{ color: "var(--header-primary)", fontSize: 14 }}>Voice</b>
            <div style={{ display: "flex", gap: 8 }}>
                <select className="vc-tool-input" style={{ flex: 1 }} value={name} onChange={e => { setName(e.currentTarget.value); settings.store.voiceName = e.currentTarget.value; }}>
                    <option value="">Your computer's default voice</option>
                    {voices.map(v => <option key={v.voiceURI} value={v.name}>{v.name}{v.lang ? ` (${v.lang})` : ""}</option>)}
                </select>
                <button type="button" className="vc-tool-btn" onClick={() => say(["Hi! This is how messages will sound."])}>Try it</button>
            </div>
            {!voices.length && <span className="vc-tool-hint">Loading your computer's voices…</span>}
        </div>
    );
}

const settings = defineFeatureSettings("readAloud", {
    voicePicker: { type: OptionType.COMPONENT, description: "", component: () => <VoicePicker /> },
    voiceName: { type: OptionType.STRING, description: "Internal: the voice you picked.", default: "", hidden: true },
    speed: { type: OptionType.SLIDER, description: "Speed", markers: [0.5, 0.75, 1, 1.25, 1.5, 2], default: 1, stickToMarkers: false },
    pitch: { type: OptionType.SLIDER, description: "Pitch", markers: [0.5, 1, 1.5, 2], default: 1, stickToMarkers: false },
    volume: { type: OptionType.SLIDER, description: "Volume", markers: [0, 25, 50, 75, 100], default: 100, stickToMarkers: false },
    sayName: { type: OptionType.BOOLEAN, description: "Say who sent it first (“Sam says…”)", default: true },
    popover: { type: OptionType.BOOLEAN, description: "Show a speaker on the message hover bar", default: true },
});

/* ── Speaking ── */

let reading: string | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(l => l());

function names(guildId?: string | null): Names {
    return {
        user: id => {
            const u: any = UserStore.getUser(id);
            if (!u) return null;
            return (guildId && GuildMemberStore.getNick(guildId, id)) || RelationshipStore.getNickname?.(id) || u.globalName || u.username;
        },
        channel: id => ChannelStore.getChannel(id)?.name ?? null,
        role: id => (guildId && GuildRoleStore.getRole(guildId, id)?.name) || null,
    };
}

function authorName(m: Message, guildId?: string | null) {
    const u: any = m.author;
    return (guildId && GuildMemberStore.getNick(guildId, u.id)) || u.globalName || u.global_name || u.username || "Someone";
}

/** What to say for one message. */
function lineFor(m: Message): string {
    const guildId = ChannelStore.getChannel(m.channel_id)?.guild_id;
    const text = speakable(m.content ?? "", names(guildId));
    const extra = attachmentsText(m.attachments as any, (m as any).stickerItems?.length ?? 0);
    const body = [text, extra && (text ? `and ${extra}` : `sent ${extra}`)].filter(Boolean).join(", ");
    if (!body) return "";
    return settings.store.sayName !== false ? `${authorName(m, guildId)}${text ? " says" : ""}: ${body}` : body;
}

function stop() {
    synth()?.cancel();
    reading = null;
    changed();
}

function say(lines: string[], id: string | null = null) {
    const s = synth();
    if (!s) return showToast("This computer has no text-to-speech voices.", "failure");
    s.cancel();
    const voice = s.getVoices().find(v => v.name === settings.store.voiceName);
    reading = id;
    changed();
    lines.filter(Boolean).forEach((line, i, all) => {
        const u = new SpeechSynthesisUtterance(line);
        if (voice) u.voice = voice;
        u.rate = Number(settings.store.speed) || 1;
        u.pitch = Number(settings.store.pitch) || 1;
        u.volume = Math.max(0, Math.min(1, Number(settings.store.volume ?? 100) / 100));
        if (i === all.length - 1) u.onend = u.onerror = () => { if (reading === id) { reading = null; changed(); } };
        s.speak(u);
    });
}

function readOne(m: Message) {
    if (reading === m.id) return stop();
    const line = lineFor(m);
    if (!line) return showToast("Nothing to read in that message.", "message");
    say([line], m.id);
}

/** This message and the ones after it that Discord has loaded (up to 50). */
function readFrom(m: Message) {
    const all: Message[] = (MessageStore.getMessages(m.channel_id) as any)?.toArray?.() ?? [];
    const at = all.findIndex(x => x.id === m.id);
    const list = (at < 0 ? [m] : all.slice(at, at + 50)).map(lineFor).filter(Boolean);
    say(list, m.id);
}

/* ── Buttons ── */

function SpeakerIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 5h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-4 3.5V14H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
            <path d="M18.5 7.5a3.5 3.5 0 0 1 0 5M21 5a7 7 0 0 1 0 10" />
        </svg>
    );
}

const messageMenu: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    if (!message?.id) return;
    children.push(reading
        ? <Menu.MenuItem id="vc-tts-stop" label="Stop reading" icon={SpeakerIcon} action={stop} />
        : (
            <Menu.MenuGroup>
                <Menu.MenuItem id="vc-tts" label="Read aloud" icon={SpeakerIcon} action={() => readOne(message)} />
                <Menu.MenuItem id="vc-tts-from" label="Read from here" subtext="This message and the ones after it" action={() => readFrom(message)} />
            </Menu.MenuGroup>
        ));
};

export default definePlugin({
    name: "ReadAloud",
    description: "Hear a message read out loud in the voice you pick — right-click it, or use the speaker on its hover bar. “Read from here” reads the chat from that message on. Only you hear it; your mic is never used.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    contextMenus: { "message": messageMenu },

    messagePopoverButton: {
        icon: SpeakerIcon,
        render(message: Message) {
            if (settings.store.popover === false || !message?.id || !(message.content || message.attachments?.length)) return null;
            return {
                label: reading === message.id ? "Stop reading" : "Read aloud",
                icon: SpeakerIcon,
                message,
                channel: ChannelStore.getChannel(message.channel_id),
                onClick: () => readOne(message),
            };
        },
    },

    stop() {
        stop();
    },
});
