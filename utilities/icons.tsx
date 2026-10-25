/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The dock's icons: one consistent line style (24 × 24, 1.8 px rounded
// strokes, the same margins), grouped for the picker. Each icon is a stroked
// path, plus optional filled bits, dots and rings. The keys are what's saved
// for each dock button, so existing keys never change — only the drawings.

export interface DockIconProps {
    width?: number;
    height?: number;
}

export interface DockIconDef {
    key: string;
    label: string;
    group: string;
    Icon: (props: DockIconProps) => React.JSX.Element;
}

type Dot = [number, number, number];

interface Art {
    /** Stroked lines. */
    d: string;
    /** Filled shapes. */
    fill?: string;
    /** Filled dots (x, y, r). */
    dots?: Dot[];
    /** Stroked circles (x, y, r). */
    rings?: Dot[];
}

const STROKE = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;

function draw({ d, fill, dots = [], rings = [] }: Art) {
    return function DockIcon({ width = 20, height = 20 }: DockIconProps) {
        return (
            <svg width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden>
                {d && <path d={d} {...STROKE} />}
                {rings.map(([cx, cy, r], i) => <circle key={`r${i}`} cx={cx} cy={cy} r={r} {...STROKE} />)}
                {fill && <path d={fill} fill="currentColor" />}
                {dots.map(([cx, cy, r], i) => <circle key={`d${i}`} cx={cx} cy={cy} r={r} fill="currentColor" />)}
            </svg>
        );
    };
}

// Shared pieces.
const CIRCLE = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z";
const BUBBLE = "M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z";
const SPEAKER = "M4 9.5v5a1 1 0 0 0 1 1h3l5 4.5v-15L8 8.5H5a1 1 0 0 0-1 1z";
const MIC = "M9 5.5a3 3 0 0 1 6 0V11a3 3 0 0 1-6 0zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6";
const PHONES = "M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2z";
const SCREEN = "M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM8 21h8M12 17v4";
const CLOUD = "M7 17.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8z";
const CLOUD_TOP = "M7 14a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 6a4 4 0 0 1-.5 8";
const CALENDAR = "M5 5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 5 5zM3.5 10h17M8 3v4M16 3v4";
const PERSON = "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2.5 21a6.5 6.5 0 0 1 13 0";
const LOCK_BODY = "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM12 15v2";
const SPARK = (x: number, y: number, s: number) => `M${x} ${y - s}l${s * 0.3} ${s * 0.7} ${s * 0.7} ${s * 0.3}-${s * 0.7} ${s * 0.3}-${s * 0.3} ${s * 0.7}-${s * 0.3}-${s * 0.7}-${s * 0.7}-${s * 0.3} ${s * 0.7}-${s * 0.3}z`;
const STAR = (cx: number, cy: number, r: number) => {
    const pts: string[] = [];
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
        pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`);
    }
    return `M${pts.join("L")}z`;
};

// [key, label, group, art]
type Entry = [string, string, string, Art];

const CHAT = "Chat & messages";
const VOICE = "Voice & video";
const SERVER = "Servers & moderation";
const PEOPLE = "People & status";
const SONATA = "Sonata features";
const MUSIC = "Music";
const MEDIA = "Media & files";
const TECH = "Tools & tech";
const NATURE = "Nature & weather";
const FUN = "Fun & things";
const SYMBOLS = "Symbols";

const ICONS: Entry[] = [
    // ─── Chat & messages ───
    ["hashtag", "Text Channel", CHAT, { d: "M10 3 8 21M16 3l-2 18M4 9h16M3 15h16" }],
    ["message", "Direct Message", CHAT, { d: "M20.5 12a8.5 8.5 0 0 1-12.4 7.6L3.5 21l1.4-4.4A8.5 8.5 0 1 1 20.5 12z" }],
    ["chatBubble", "Chat", CHAT, { d: `${BUBBLE}M7.5 8.5h9M7.5 12h5.5` }],
    ["reply", "Reply", CHAT, { d: "M10 6 4 12l6 6M4 12h9a7 7 0 0 1 7 7v1" }],
    ["thread", "Thread", CHAT, { d: `${BUBBLE}M10.5 7.5l-1 6M14.5 7.5l-1 6M8.5 9.5h7M8 11.5h7` }],
    ["forum", "Forum Channel", CHAT, { d: "M14 9a5 5 0 1 0-9.2 2.7L4 15l3.3-.9A5 5 0 0 0 14 9zM10.3 17.6a5 5 0 0 0 6.4 1.5L20 20l-.8-3.3A5 5 0 0 0 17 9.7" }],
    ["at", "Mention", CHAT, { d: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1" }],
    ["pin", "Pinned Message", CHAT, { d: "M14.5 3.5l6 6-2.5 1-3.5 3.5-.5 4-8-8 4-.5L13.5 6zM9.5 14.5 4 20" }],
    ["pushpin", "Pin Message", CHAT, { d: "M9 3h6M10 3l-.5 6L7 12v2h10v-2l-2.5-3L14 3M12 14v7" }],
    ["megaphone", "Announcement", CHAT, { d: "M4 10v4a1 1 0 0 0 1 1h2l9.5 4V5L7 9H5a1 1 0 0 0-1 1zM7.5 15l1 5h2.5l-1-4.5M19.5 9.5a3 3 0 0 1 0 5" }],
    ["poll", "Poll", CHAT, { d: "M9 6h11M9 12h11M9 18h6", rings: [[5, 6, 1.6], [5, 12, 1.6], [5, 18, 1.6]] }],
    ["smile", "Emoji", CHAT, { d: `${CIRCLE}M8.5 14.5a4.5 4.5 0 0 0 7 0`, dots: [[9, 9.8, 1.2], [15, 9.8, 1.2]] }],
    ["smileOutline", "Wink", CHAT, { d: `${CIRCLE}M8.5 14.5a4.5 4.5 0 0 0 7 0M13.8 9.8h2.4`, dots: [[9, 9.8, 1.2]] }],
    ["addReaction", "Add Reaction", CHAT, { d: "M20.5 12A8.5 8.5 0 1 1 12 3.5M8.5 14a4.5 4.5 0 0 0 7 0M19 2.5v6M16 5.5h6", dots: [[9, 10, 1.1], [15, 10, 1.1]] }],
    ["sticker", "Sticker", CHAT, { d: "M14 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h8l7-7V6a3 3 0 0 0-3-3h-4zM14 21v-4a3 3 0 0 1 3-3h4" }],
    ["gif", "GIF", CHAT, { d: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM10 10H8.5A1.5 1.5 0 0 0 7 11.5v1A1.5 1.5 0 0 0 8.5 14H10v-2H9M13 10v4M16 14v-4h2.5M16 12h2" }],
    ["spoiler", "Spoiler", CHAT, { d: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 15l4-6M11 15l4-6M15 15l2.5-3.5" }],
    ["code", "Code Block", CHAT, { d: "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" }],
    ["pencil", "Edit Message", CHAT, { d: "M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3zM14.5 7.5l3 3" }],
    ["trash", "Delete Message", CHAT, { d: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" }],
    ["copy", "Copy", CHAT, { d: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM16 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" }],
    ["copyId", "Copy ID", CHAT, { d: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7.5 9v6M11 9v6h1.5a3 3 0 0 0 0-6z" }],
    ["send", "Send", CHAT, { d: "M21 3 10 14M21 3l-6.5 18-4.5-7-7-4.5z" }],
    ["mail", "Mail", CHAT, { d: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6" }],
    ["inbox", "Inbox", CHAT, { d: "M3 13h5l1.5 3h5l1.5-3h5M5.5 5h13L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z" }],
    ["translate", "Translate", CHAT, { d: "M3 5h9M7.5 3v2M5 5c.5 3 3 6 6 7M10 5c-.5 3-3 6-6.5 7.5M13 21l4-9 4 9M14.3 18h5.4" }],
    ["undo", "Undo", CHAT, { d: "M4 9h10.5a5.5 5.5 0 0 1 0 11H10M8 5 4 9l4 4" }],
    ["slash", "Slash Command", CHAT, { d: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM15 7l-6 10" }],

    // ─── Voice & video ───
    ["speaker", "Voice Channel", VOICE, { d: `${SPEAKER}M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11` }],
    ["volumeMute", "Muted User", VOICE, { d: `${SPEAKER}M16 9.5l5 5M21 9.5l-5 5` }],
    ["mic", "Microphone", VOICE, { d: MIC }],
    ["micMute", "Mic Muted", VOICE, { d: `${MIC}M4 4l16 16` }],
    ["headphones", "Headphones", VOICE, { d: PHONES }],
    ["deafen", "Deafened", VOICE, { d: `${PHONES}M3 3l18 18` }],
    ["headphonesOff", "Headset", VOICE, { d: `${PHONES}M20 18.5c0 1.5-1.3 2.5-3.5 2.5H14`, dots: [[13, 21, 1.1]] }],
    ["camera", "Video Call", VOICE, { d: "M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM16 10.5l5-3v9l-5-3" }],
    ["screenShare", "Screen Share", VOICE, { d: `${SCREEN}M12 13.5V8M9.5 10.5 12 8l2.5 2.5` }],
    ["live", "Go Live", VOICE, { d: "M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7", dots: [[12, 12, 2]] }],
    ["phone", "Voice Call", VOICE, { d: "M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" }],
    ["hangUp", "Disconnect", VOICE, { d: "M3 14.5v-2a2 2 0 0 1 1.3-1.9 21 21 0 0 1 15.4 0 2 2 0 0 1 1.3 1.9v2a1 1 0 0 1-1.2 1l-3.3-.7a1 1 0 0 1-.8-1V12a14 14 0 0 0-7.4 0v1.8a1 1 0 0 1-.8 1l-3.3.7A1 1 0 0 1 3 14.5z" }],
    ["stage", "Stage Channel", VOICE, { d: "M7.5 14a4.5 4.5 0 0 1 9 0M3 17h18M5 17v4M19 17v4", rings: [[12, 6, 2.6]] }],
    ["soundboard", "Soundboard", VOICE, { d: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM18 19v-5.5l2.5 1", rings: [[16.3, 19, 1.8]] }],
    ["signal", "Voice Connection", VOICE, { d: "M5 20v-3M10 20v-7M15 20V9M20 20V4" }],
    ["waveform", "Noise Suppression", VOICE, { d: "M3 12h1.5M7 8.5v7M10.5 5v14M14 8v8M17.5 10v4M20.5 12H21" }],
    ["streamerMode", "Streamer Mode", VOICE, { d: "M2.5 9.5c0-1.6 1.5-2.7 3.2-2.7 2.2 0 4.2 1.6 6.3 1.6s4.1-1.6 6.3-1.6c1.7 0 3.2 1.1 3.2 2.7 0 4.1-2.6 7.2-5.3 7.2-2.1 0-3-2.1-4.2-2.1s-2.1 2.1-4.2 2.1c-2.7 0-5.3-3.1-5.3-7.2z", dots: [[8, 11.2, 1.4], [16, 11.2, 1.4]] }],
    ["monitor", "Desktop", VOICE, { d: SCREEN }],
    ["mobile", "Mobile", VOICE, { d: "M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2" }],
    ["radio", "Radio", VOICE, { d: "M4 9h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM6 9l11-5M6 13h4M6 16h4", rings: [[15.5, 14.5, 2.3]] }],
    ["tv", "TV", VOICE, { d: "M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM8 3l4 4 4-4" }],
    ["satellite", "Satellite Dish", VOICE, { d: "M4 10a10 10 0 0 0 10 10zM9 15l4.5-4.5M14 4a6 6 0 0 1 6 6M14 7.5a2.5 2.5 0 0 1 2.5 2.5" }],

    // ─── Servers & moderation ───
    ["gift", "Nitro Gift", SERVER, { d: "M4 8h16a1 1 0 0 1 1 1v3H3V9a1 1 0 0 1 1-1zM5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M12 8v13M12 8C11 5 7 4 7 6.5S10 8 12 8zM12 8c1-3 5-4 5-1.5S14 8 12 8z" }],
    ["gem", "Server Boost", SERVER, { d: "M6.5 4h11L21 9l-9 11L3 9zM3 9h18M12 20 8.5 9 12 4l3.5 5z" }],
    ["crown", "Server Owner", SERVER, { d: "M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5zM5 21h14" }],
    ["verified", "Verified Badge", SERVER, { d: "M12 2.8l2.3 1.7 2.9-.2.9 2.8 2.4 1.6-.9 2.8.9 2.8-2.4 1.6-.9 2.8-2.9-.2L12 21.2l-2.3-1.7-2.9.2-.9-2.8-2.4-1.6.9-2.8-.9-2.8 2.4-1.6.9-2.8 2.9.2zM8.7 12l2.3 2.3 4.3-4.6" }],
    ["shield", "Moderation", SERVER, { d: "M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6zM9 12l2 2 4-4" }],
    ["shieldAlert", "Scam Shield", SERVER, { d: "M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6zM12 8v5", dots: [[12, 16.3, 1.1]] }],
    ["block", "Block", SERVER, { d: `${CIRCLE}M5.6 5.6l12.8 12.8` }],
    ["flag", "Report", SERVER, { d: "M5 21V4M5 4h12l-2.5 4.5L17 13H5" }],
    ["hammer", "Ban", SERVER, { d: "M14 5l5 5M13 4l3-1 5 5-1 3zM15.5 8.5 4.5 19.5a1.4 1.4 0 0 0 2 2l11-11" }],
    ["leave", "Leave Server", SERVER, { d: "M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h9" }],
    ["clock", "Timeout", SERVER, { d: `${CIRCLE}M12 7v5l3.5 2` }],
    ["hourglass", "Slowmode", SERVER, { d: "M6 3h12M6 21h12M7.5 3v2.5c0 2.5 4.5 4.3 4.5 6.5s-4.5 4-4.5 6.5V21M16.5 3v2.5c0 2.5-4.5 4.3-4.5 6.5s4.5 4 4.5 6.5V21" }],
    ["tag", "Roles", SERVER, { d: "M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z", dots: [[8, 8, 1.5]] }],
    ["clipboard", "Audit Log", SERVER, { d: "M9 3.5h6v3H9zM9 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3M8.5 11h7M8.5 14.5h7M8.5 18h4" }],
    ["rules", "Rules", SERVER, { d: "M8 3h10a2 2 0 0 1 2 2v12M8 3a2 2 0 0 0-2 2v14a2 2 0 0 1-2 2h11a2 2 0 0 0 2-2v-2M10 8h6M10 12h6" }],
    ["webhook", "Webhook", SERVER, { d: "M9.5 13 6.6 18M14 8.6l2.9 5M9 16.5h7.5", rings: [[12, 6.5, 2.7], [5.5, 18.5, 2.3], [18.5, 16.5, 2.3]] }],
    ["bot", "Bot", SERVER, { d: "M5 9h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM12 5.5V9M9 15.5h6", dots: [[12, 4.2, 1.3], [9, 12.5, 1.2], [15, 12.5, 1.2]] }],
    ["link", "Invite Link", SERVER, { d: "M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" }],
    ["globe", "Community", SERVER, { d: `${CIRCLE}M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z` }],
    ["folder", "Category", SERVER, { d: "M5 5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" }],
    ["lock", "Private Channel", SERVER, { d: `${LOCK_BODY}M8 11V8a4 4 0 0 1 8 0v3` }],
    ["unlock", "Unlocked", SERVER, { d: `${LOCK_BODY}M8 11V8a4 4 0 0 1 7.6-1.7` }],
    ["key", "Permissions", SERVER, { d: "M12.3 11.7 3 21M6 18l3 3M8.5 15.5l2 2", rings: [[15.5, 8.5, 4.5]] }],
    ["event", "Scheduled Event", SERVER, { d: `${CALENDAR}${STAR(12, 15, 3.2)}` }],
    ["home", "Home", SERVER, { d: "M3 11l9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5" }],
    ["plusCircle", "Add Server", SERVER, { d: `${CIRCLE}M12 8v8M8 12h8` }],
    ["compass", "Discover", SERVER, { d: `${CIRCLE}M15.5 8.5l-2 5-5 2 2-5z` }],
    ["shop", "Shop", SERVER, { d: "M4 9l1.5-5h13L20 9M4 9h16M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5 11.5V20h14v-8.5M10 20v-5h4v5" }],
    ["trophy", "Quests", SERVER, { d: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9.5 17h5" }],
    ["rocket", "Activities", SERVER, { d: "M12 15l-3-3c1.5-4.5 5-8 10-9-1 5-4.5 8.5-9 10zM9 12H5l2-3.5h4M12 15v4l3.5-2v-4M7 17c-1.5.5-2.5 2-3 4 2-.5 3.5-1.5 4-3" }],
    ["creditCard", "Billing", SERVER, { d: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 10h18M7 15h4" }],
    ["qrCode", "QR Login", SERVER, { d: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM18.5 14H20M14 18.5V20M18.5 18.5H20V20", dots: [[7, 7, 1], [17, 7, 1], [7, 17, 1]] }],
    ["bell", "Notifications", SERVER, { d: "M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" }],
    ["bellOff", "Muted", SERVER, { d: "M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0M3 3l18 18" }],
    ["search", "Search", SERVER, { d: "M16 16l5 5", rings: [[11, 11, 7]] }],
    ["puzzle", "Plugin", SERVER, { d: "M9 4.5a2 2 0 0 1 4 0V6h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 0 0 0 4H18v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 0 0-4 0V20H5a1 1 0 0 1-1-1v-4h1.5a2 2 0 0 0 0-4H4V7a1 1 0 0 1 1-1h4z" }],
    ["gear", "User Settings", SERVER, { d: "M10.3 3h3.4l.5 2.4 1.7 1 2.3-.8 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.8-1.7 1-.5 2.4h-3.4l-.5-2.4-1.7-1-2.3.8-1.7-2.9 1.8-1.6v-2L3.6 9.5l1.7-2.9 2.3.8 1.7-1z", rings: [[12, 12, 2.8]] }],
    ["gearSync", "Settings Sync", SERVER, { d: "M19.5 12A7.5 7.5 0 0 0 6 7.5M4.5 12A7.5 7.5 0 0 0 18 16.5M6 4v3.5h3.5M18 20v-3.5h-3.5", rings: [[12, 12, 2.5]] }],
    ["refresh", "Reload", SERVER, { d: "M20 11a8 8 0 0 0-14.6-4.5M4 3.5v3.5h3.5M4 13a8 8 0 0 0 14.6 4.5M20 20.5V17h-3.5" }],
    ["sliders", "Tweaks", SERVER, { d: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1", rings: [[15, 6, 2], [9, 12, 2], [17, 18, 2]] }],
    ["palette", "Appearance", SERVER, { d: "M12 21a9 9 0 1 1 9-9c0 2-1.5 3.2-3.5 3.2H16a2 2 0 0 0-1.5 3.3c.6.8.1 2.5-2.5 2.5z", dots: [[7.5, 11.5, 1.3], [10, 7.5, 1.3], [14.5, 7.5, 1.3], [17, 11, 1.3]] }],
    ["keyboard", "Keybinds", SERVER, { d: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM8 14.5h8", dots: [[7, 10, 1], [10.3, 10, 1], [13.7, 10, 1], [17, 10, 1]] }],
    ["wrench", "Developer Mode", SERVER, { d: "M14.7 6.3a4 4 0 0 0 5 5l1.3-1.3a5.5 5.5 0 0 1-7.2 6.2L7 23l-3.5-3.5 6.8-6.8A5.5 5.5 0 0 1 16.5 5.5z" }],
    ["whistle", "Whistle", SERVER, { d: "M8 17a5 5 0 1 1 0-10h13v4h-8a5 5 0 0 1-5 6zM14 7V4", dots: [[8, 12, 1.4]] }],

    // ─── People & status ───
    ["personAdd", "Add Friend", PEOPLE, { d: `${PERSON}M19 8v6M16 11h6` }],
    ["people", "Members", PEOPLE, { d: `${PERSON}M16 3.5a4 4 0 0 1 0 7.5M18.5 14a6 6 0 0 1 3.5 6` }],
    ["profile", "Profile", PEOPLE, { d: `${CIRCLE}M6.5 18.5a6.5 6.5 0 0 1 11 0`, rings: [[12, 10, 3]] }],
    ["statusOnline", "Online", PEOPLE, { d: "", dots: [[12, 12, 7]] }],
    ["moon", "Idle", PEOPLE, { d: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" }],
    ["statusDnd", "Do Not Disturb", PEOPLE, { d: "M8.5 12h7", rings: [[12, 12, 7]] }],
    ["statusInvisible", "Invisible", PEOPLE, { d: "", rings: [[12, 12, 7], [12, 12, 3]] }],
    ["personTag", "Person Tags", PEOPLE, { d: "M2.5 11V4.5a1 1 0 0 1 1-1H10l8 8-7.5 7.5zM13.5 3.5l8 8-7 7", dots: [[6.8, 7.8, 1.4]] }],
    ["readAloud", "Read Aloud", PEOPLE, { d: "M4 5h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-4 3.5V14H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM18.5 7.5a3.5 3.5 0 0 1 0 5M21 5a7 7 0 0 1 0 10" }],
    ["wallet", "Wallet", PEOPLE, { d: "M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 18.5 8H5.5A2.5 2.5 0 0 1 3 6.5", dots: [[16, 14, 1.4]] }],
    ["eye", "Watching", PEOPLE, { d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", rings: [[12, 12, 3]] }],
    ["eyeOff", "Hidden", PEOPLE, { d: "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.7 3.6M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" }],
    ["heart", "React", PEOPLE, { d: "M12 20s-8-4.6-8-10.5A4.5 4.5 0 0 1 12 6.5a4.5 4.5 0 0 1 8 3C20 15.4 12 20 12 20z" }],
    ["star", "Favorite", PEOPLE, { d: STAR(12, 12.4, 9) }],
    ["thumbsUp", "Thumbs Up", PEOPLE, { d: "M7 10v11M7 10l4-7a2 2 0 0 1 3 1.7V9h5.2a2 2 0 0 1 2 2.4l-1.5 7.5a2 2 0 0 1-2 1.6H7M3 10h4v11H3z" }],
    ["thumbsDown", "Thumbs Down", PEOPLE, { d: "M7 14V3M7 14l4 7a2 2 0 0 0 3-1.7V15h5.2a2 2 0 0 0 2-2.4l-1.5-7.5a2 2 0 0 0-2-1.6H7M3 3h4v11H3z" }],
    ["handWave", "Wave Hello", PEOPLE, { d: "M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V6a1.5 1.5 0 0 1 3 0v7c0 4.5-3 8-7 8-2.5 0-4-1.5-5.5-3.5L3 14.5a1.5 1.5 0 0 1 2.5-1.7L8 15.5M19.5 3.5c.9.6 1.5 1.5 1.8 2.6" }],
    ["glasses", "Glasses", PEOPLE, { d: "M9.5 13a2.5 2.5 0 0 1 5 0M2.8 13 2 9M21.2 13 22 9", rings: [[6.2, 13.5, 3.4], [17.8, 13.5, 3.4]] }],

    // ─── Sonata's features ───
    ["sonata", "Sonata (notes)", SONATA, { d: "M9 17.5V6.2a1 1 0 0 1 .76-.97l9-2.25A1 1 0 0 1 20 3.95V15.5M9 9.5 20 6.75", fill: "M6.5 15.5c1.44 0 2.6.94 2.6 2.1s-1.16 2.1-2.6 2.1-2.6-.94-2.6-2.1 1.16-2.1 2.6-2.1zM17.5 13.5c1.44 0 2.6.94 2.6 2.1s-1.16 2.1-2.6 2.1-2.6-.94-2.6-2.1 1.16-2.1 2.6-2.1z" }],
    ["messageLogger", "Message Logger", SONATA, { d: `${BUBBLE}M8 12.5 16 7.5` }],
    ["messageTimer", "Message Timer", SONATA, { d: "M12 20H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M17.5 14v2.5l1.5 1", rings: [[17.5, 17, 4.2]] }],
    ["scheduled", "Scheduled Message", SONATA, { d: "M20.5 12A8.5 8.5 0 1 0 12 20.5M12 7v5l3 2M15.5 19h6M19 16l2.5 3-2.5 3" }],
    ["silentTyping", "Silent Typing", SONATA, { d: `${BUBBLE}M3 3l18 18`, dots: [[8.5, 10.5, 1.2], [12, 10.5, 1.2], [15.5, 10.5, 1.2]] }],
    ["typingSounds", "Typing Sounds", SONATA, { d: "M4 9h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM7 15.5h5M19.5 3v7.5l2-1", dots: [[6.5, 12, 0.9], [9.5, 12, 0.9], [12.5, 12, 0.9], [18.2, 10.8, 1.6]] }],
    ["characters", "Characters", SONATA, { d: "M5 20h4v-2.2A7 7 0 1 1 15 17.8V20h4" }],
    ["coloredText", "Colored Text", SONATA, { d: "M6 16 12 3l6 13M8.3 11h7.4", fill: "M4 18.5h16V21H4z" }],
    ["encoder", "Encoder", SONATA, { d: "M7 11h10a1 1 0 0 1 1 1v8H6v-8a1 1 0 0 1 1-1zM9 11V8a3 3 0 0 1 6 0v3M10.5 14.5l-1.5 1.5 1.5 1.5M13.5 14.5l1.5 1.5-1.5 1.5" }],
    ["embed", "Embed", SONATA, { d: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 4v16M11 8h6M11 12h6M11 16h3.5" }],
    ["greeter", "Channel Greeter", SONATA, { d: `${BUBBLE}M8.5 7.5v5M8.5 10h3M11.5 7.5v5M15 7.5v5` }],
    ["voiceMessage", "Voice Message", SONATA, { d: `${BUBBLE}M12 6.5a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-3 0V8A1.5 1.5 0 0 1 12 6.5zM9.5 10.5a2.5 2.5 0 0 0 5 0` }],
    ["autoVolume", "Auto Volume", SONATA, { d: "M3 9.5v5a1 1 0 0 0 1 1h2.5l4.5 4v-15l-4.5 4H4a1 1 0 0 0-1 1zM15 9v6M18 6v12M21 10v4" }],
    ["soundStudio", "Sound Studio", SONATA, { d: "M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M8.5 15v-2M11 17.5v-7M13.5 16v-4M16 15v-2" }],
    ["streaks", "Streaks", SONATA, { d: `${CALENDAR}M12 18.5c-1.6 0-2.4-1-2.4-2.3 0-1.5 1.4-2.1 1.7-3.4.9.6 3.1 1.9 3.1 3.7 0 1.2-.9 2-2.4 2z` }],
    ["miniGames", "Mini Games", SONATA, { d: "M9 4v16M15 4v16M4 9h16M4 15h16M5.2 5.2l2.1 2.1M7.3 5.2 5.2 7.3M16.7 16.7l2.1 2.1M18.8 16.7l-2.1 2.1", rings: [[12, 12, 1.5]] }],
    ["chatEffects", "Chat Effects", SONATA, { d: "M4 20l4.5-12 7.5 7.5zM14 4c0 2 1 3 3 3M19 10.5c1.3-.4 2.5 0 2.5 0M10.5 3.5c.4 1.4 0 2.8 0 2.8", dots: [[19, 4, 1], [17, 13.5, 1], [21, 7, 0.9]] }],
    ["screenshot", "Screenshot Styler", SONATA, { d: "M6 2v16h16M2 6h16v16" }],
    ["imageZoom", "Image Zoom", SONATA, { d: "M16 16l5 5M11 8v6M8 11h6", rings: [[11, 11, 7]] }],
    ["imageSearch", "Reverse Image Search", SONATA, { d: "M11 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6M4 15l4.5-4.5 3.5 3.5M19.5 19.5 22 22", rings: [[17, 17, 3]], dots: [[14.5, 8, 1.4]] }],
    ["stealProfile", "Steal Profile", SONATA, { d: "M2.5 20a6 6 0 0 1 12 0M15 4h6M15 8h6M17.5 12H21", rings: [[8.5, 8.5, 3.5]] }],
    ["platformSpoofer", "Platform Spoofer", SONATA, { d: "M3 5h13v9H3zM6.5 18h6M9.5 14v4M18 9h3.5v11H18z" }],
    ["friendTracker", "Friend Tracker", SONATA, { d: "M2 20a6 6 0 0 1 9.5-4.9M22 20a6 6 0 0 0-9.5-4.9M10 18h4", rings: [[8, 8.5, 3], [16, 8.5, 3]] }],
    ["exploitReport", "Exploiter Report", SONATA, { d: "M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6zM12 8v5", dots: [[12, 16.2, 1.2]] }],
    ["favoriteDm", "Pinned DMs", SONATA, { d: `${BUBBLE}${STAR(12, 10.6, 4)}` }],
    ["cleanCache", "Cache Cleaner", SONATA, { d: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3", fill: SPARK(20, 3.5, 2.5) }],

    // ─── Music ───
    ["music", "Now Playing", MUSIC, { d: "M10 18V5l6 2M17 11a4 4 0 0 1 0 6M19.5 8.5a7.5 7.5 0 0 1 0 11", rings: [[7, 18, 3]] }],
    ["spotify", "Spotify", MUSIC, { d: `${CIRCLE}M7 9.5c3.5-1 7.5-.6 10.5 1M7.5 12.8c3-.8 6-.4 8.5.9M8 15.8c2.4-.6 4.6-.3 6.5.7` }],
    ["vinyl", "Vinyl", MUSIC, { d: `${CIRCLE}M7 12a5 5 0 0 1 5-5`, rings: [[12, 12, 3]], dots: [[12, 12, 0.9]] }],
    ["playlist", "Playlist", MUSIC, { d: "M3 6h12M3 11h12M3 16h7M18 5v11M18 5l3 1", rings: [[16, 16.5, 2]] }],
    ["play", "Play", MUSIC, { d: "M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" }],
    ["pause", "Pause", MUSIC, { d: "M7 4h3v16H7zM14 4h3v16h-3z" }],
    ["nextTrack", "Next Track", MUSIC, { d: "M5 5v14l10-7zM19 5v14" }],
    ["shuffle", "Shuffle", MUSIC, { d: "M3 7h3.5a5 5 0 0 1 4 2l3 4a5 5 0 0 0 4 2H21M3 17h3.5a5 5 0 0 0 4-2M14 9a5 5 0 0 1 3.5-2H21M18 4l3 3-3 3M18 12l3 3-3 3" }],
    ["repeat", "Repeat", MUSIC, { d: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" }],
    ["equalizer", "Equalizer", MUSIC, { d: "M6 3v6M6 13v8M12 3v10M12 17v4M18 3v3M18 10v11", rings: [[6, 11, 2], [12, 15, 2], [18, 8, 2]] }],
    ["guitar", "Guitar", MUSIC, { d: "M19 2.5l2.5 2.5-2 2-2.5-2.5zM17.5 6.5l-6 6M11.6 11.4a4.2 4.2 0 0 0-5.4-.6 2.6 2.6 0 0 1-2.1 3 3.4 3.4 0 0 0 5.8 5.8 2.6 2.6 0 0 1 3-2.1 4.2 4.2 0 0 0-.6-5.4z", dots: [[9.5, 14.5, 1.1]] }],
    ["piano", "Piano", MUSIC, { d: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 13v6M12 13v6M16 13v6", fill: "M6.8 5h2.4v8H6.8zM10.8 5h2.4v8h-2.4zM14.8 5h2.4v8h-2.4z" }],
    ["drum", "Drums", MUSIC, { d: "M4 10c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 10v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7M8 12.6v6.8M16 12.6v6.8M9 2l2.5 5M15 2l-2.5 5" }],
    ["metronome", "Metronome", MUSIC, { d: "M8.5 3h7L20 21H4zM12 15l5-9M6.5 15h11" }],

    // ─── Media & files ───
    ["image", "Media", MEDIA, { d: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM3 16l5-5 5 5 3-3 5 5", dots: [[15.5, 8.5, 1.6]] }],
    ["film", "Clips", MEDIA, { d: "M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v18M16 3v18M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" }],
    ["download", "Download", MEDIA, { d: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" }],
    ["upload", "Upload", MEDIA, { d: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 20h14" }],
    ["cloudDownload", "Cloud Download", MEDIA, { d: "M7 16.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 8.5a4 4 0 0 1 .5 8M12 12v9M9 18l3 3 3-3" }],
    ["paperclip", "Attachment", MEDIA, { d: "M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L10.2 17.7a1.7 1.7 0 0 1-2.4-2.4L15.5 7.5" }],
    ["bookmark", "Saved", MEDIA, { d: "M6 3h12v18l-6-4.5L6 21z" }],
    ["archive", "Archive", MEDIA, { d: "M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" }],
    ["fileText", "Document", MEDIA, { d: "M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M8.5 13h7M8.5 16.5h7" }],
    ["scissors", "Cut", MEDIA, { d: "M8.5 7.8 20 18M8.5 16.2 20 6", rings: [[6, 6, 2.8], [6, 18, 2.8]] }],
    ["layers", "Layers", MEDIA, { d: "M12 3l9 4.5-9 4.5-9-4.5zM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5" }],
    ["printer", "Printer", MEDIA, { d: "M7 8V3h10v5M6 17H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z" }],

    // ─── Tools & tech ───
    ["terminal", "Terminal", TECH, { d: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM7 9l3 3-3 3M12 15h5" }],
    ["database", "Database", TECH, { d: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" }],
    ["server", "Server Rack", TECH, { d: "M4 4h16v7H4zM4 13h16v7H4zM11 7.5h6M11 16.5h6", dots: [[7.5, 7.5, 1.1], [7.5, 16.5, 1.1]] }],
    ["cpu", "Performance", TECH, { d: "M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4" }],
    ["hardDrive", "Storage", TECH, { d: "M3 13l3-8h12l3 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 13h18", dots: [[17, 16, 1], [14, 16, 1]] }],
    ["battery", "Battery", TECH, { d: "M4 7h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM22 10.5v3M6.5 10v4M10 10v4" }],
    ["wifi", "Wi-Fi", TECH, { d: "M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a5 5 0 0 1 6.4 0", dots: [[12, 19.5, 1.3]] }],
    ["power", "Power", TECH, { d: "M12 3v9M6.5 6.5a8 8 0 1 0 11 0" }],
    ["plug", "Plug", TECH, { d: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" }],
    ["mouse", "Mouse", TECH, { d: "M12 3a6 6 0 0 1 6 6v6a6 6 0 0 1-12 0V9a6 6 0 0 1 6-6zM12 7v3" }],
    ["robot", "Robot", TECH, { d: "M6 10h12v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM7 10a5 5 0 0 1 10 0M8.5 5.5 7 3.5M15.5 5.5 17 3.5M3.5 13v3M20.5 13v3", dots: [[9.5, 14, 1.2], [14.5, 14, 1.2]] }],
    ["bug", "Bug", TECH, { d: "M9 7a3 3 0 0 1 6 0M8 9h8a1 1 0 0 1 1 1v4a5 5 0 0 1-10 0v-4a1 1 0 0 1 1-1zM12 9v10M4 10l3 1.5M20 10l-3 1.5M3.5 15H7M20.5 15H17M5 20l2.5-2M19 20l-2.5-2" }],
    ["branch", "Branch", TECH, { d: "M6 3.5v12M18 8.5a9 9 0 0 1-9 9", rings: [[6, 18, 2.5], [18, 6, 2.5]] }],
    ["calculator", "Calculator", TECH, { d: "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 6.5h8v3H8z", dots: [[8.5, 13, 1], [12, 13, 1], [15.5, 13, 1], [8.5, 16.5, 1], [12, 16.5, 1], [15.5, 16.5, 1]] }],
    ["filter", "Filter", TECH, { d: "M3 5h18l-7 8.5V19l-4 2v-7.5z" }],
    ["list", "List", TECH, { d: "M9 6h12M9 12h12M9 18h12", dots: [[4.5, 6, 1.3], [4.5, 12, 1.3], [4.5, 18, 1.3]] }],
    ["grid", "Grid", TECH, { d: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" }],
    ["chart", "Stats", TECH, { d: "M4 4v16h16M8 16v-4M12 16V8M16 16v-6" }],
    ["history", "History", TECH, { d: "M3.5 12a8.5 8.5 0 1 0 2.5-6M3 3.5V8h4.5M12 8v4.5l3 1.8" }],
    ["stopwatch", "Timer", TECH, { d: "M12 9v4l2 1.5M10 2h4M18.5 6l1.5-1.5", rings: [[12, 13, 8]] }],
    ["location", "Location", TECH, { d: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z", rings: [[12, 9.5, 2.5]] }],
    ["map", "Map", TECH, { d: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" }],
    ["target", "Target", TECH, { d: CIRCLE, rings: [[12, 12, 5]], dots: [[12, 12, 1.5]] }],
    ["lightbulb", "Idea", TECH, { d: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" }],
    ["flask", "Experiments", TECH, { d: "M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10" }],
    ["atom", "Atom", TECH, { d: "M2.5 12c0-2.5 4.3-4.5 9.5-4.5s9.5 2 9.5 4.5-4.3 4.5-9.5 4.5-9.5-2-9.5-4.5zM7.3 3.8c2.1-1.2 6.2 1.6 9 6.3s3.5 9.6 1.4 10.9-6.3-1.4-9-6.1-3.6-9.8-1.4-11.1zM16.7 3.8c2.2 1.3 1.4 6.4-1.4 11.1s-6.9 7.4-9 6.1-1.4-6.2 1.4-10.9 6.9-7.6 9-6.3z", dots: [[12, 12, 1.4]] }],
    ["magnet", "Magnet", TECH, { d: "M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3zM6 7h4M14 7h4" }],

    // ─── Nature & weather ───
    ["sun", "Light Theme", NATURE, { d: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4", rings: [[12, 12, 4]] }],
    ["cloud", "Cloud", NATURE, { d: CLOUD }],
    ["rain", "Rain", NATURE, { d: `${CLOUD_TOP}zM8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3` }],
    ["storm", "Storm", NATURE, { d: `${CLOUD_TOP}M13 11l-3 5h4l-3 5` }],
    ["snowflake", "Snow", NATURE, { d: "M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5" }],
    ["umbrella", "Weather", NATURE, { d: "M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 12v7a2 2 0 0 1-4 0" }],
    ["rainbow", "Rainbow", NATURE, { d: "M3 18a9 9 0 0 1 18 0M6.5 18a5.5 5.5 0 0 1 11 0M10 18a2 2 0 0 1 4 0" }],
    ["water", "Water", NATURE, { d: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11zM9.5 15a2.5 2.5 0 0 0 2.5 2.5" }],
    ["mountain", "Mountains", NATURE, { d: "M2 20 9 7l4 7 2-3 7 9zM7.5 10l1.5 1.5L10.5 10" }],
    ["tree", "Tree", NATURE, { d: "M12 2 5 11h3l-4 6h16l-4-6h3zM12 17v5" }],
    ["leaf", "Nature", NATURE, { d: "M4 20c0-9 5-15 16-16 0 11-6 16-15 16zM4 20l9-9" }],
    ["flower", "Flower", NATURE, { d: "M12 14v8M12 14c-4 0-6-3-6-7l3 2 3-5 3 5 3-2c0 4-2 7-6 7zM12 19c-2-2-5-2-6-1M12 19c2-2 5-2 6-1" }],
    ["flame", "Trending", NATURE, { d: "M12 21c-4 0-7-2.7-7-6.5 0-3.5 2.5-5.5 3.5-8.5 1 1.5 2 2.5 3.5 3 0-3 1-5 3-6 .5 3 4 5.5 4 10.5 0 4.5-3 7.5-7 7.5z" }],
    ["paw", "Pets", NATURE, { d: "M8.5 14.5c1.5-2 5.5-2 7 0s2 5-1.5 5c-1.5 0-1.5-.8-2.5-.8s-1 .8-2.5.8c-3.5 0-2-3-.5-5z", rings: [[6, 10, 1.8], [9.5, 6.5, 1.8], [14.5, 6.5, 1.8], [18, 10, 1.8]] }],
    ["planet", "Planet", NATURE, { d: "M6.8 13.9C3.5 15.6 1.6 17.4 2.3 18.4c1.2 1.7 7.7-.2 13.4-4.4s9.2-8.6 8-10.3c-.7-1-3.2-.6-6.5.9", rings: [[12, 12, 5.5]] }],

    // ─── Fun & things ───
    ["coffee", "Coffee Break", FUN, { d: "M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M7 2.5V5M11 2.5V5M3 21h14" }],
    ["pizza", "Pizza", FUN, { d: "M12 3 3 19c6 3 12 3 18 0zM5 15.5c4.5 2 9.5 2 14 0", dots: [[10.5, 10, 1.2], [13.8, 13, 1.2], [10, 15, 1]] }],
    ["apple", "Apple", FUN, { d: "M12 7c-2-1.5-7-1-7 5 0 4 2.5 8 4.5 8 1.2 0 1.6-.6 2.5-.6s1.3.6 2.5.6c2 0 4.5-4 4.5-8 0-6-5-6.5-7-5zM12 7c0-2 1-3.5 3-4" }],
    ["cake", "Birthdays", FUN, { d: "M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7M5 16c1.2 1 2.3 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0M12 12V8.5", fill: "M12 6.5c-.8-.9-.8-1.9 0-3 .8 1.1.8 2.1 0 3z" }],
    ["popcorn", "Movie Night", FUN, { d: "M6 9l1.5 12h9L18 9zM10 9l.5 12M14 9l-.5 12M6 9a2.5 2.5 0 0 1 2-4 2.5 2.5 0 0 1 4-1.5A2.5 2.5 0 0 1 16 5a2.5 2.5 0 0 1 2 4" }],
    ["steam", "Steam", FUN, { d: "M12 21a9 9 0 1 0-8.6-11.7M3.4 13.6l4 1.7M10.4 14.6l2.6-3.2", rings: [[15.3, 9, 3], [8.6, 15.9, 2]], dots: [[15.3, 9, 1.2]] }],
    ["saleTag", "Game Sale", FUN, { d: "M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM14.5 9.5l-5 5", dots: [[9.6, 9.8, 1.1], [14.4, 14.2, 1.1]] }],
    ["controller", "Game Activity", FUN, { d: "M7 7h10a5 5 0 0 1 4.8 6.4l-1 3.4a2.5 2.5 0 0 1-4.3.9L14.5 15h-5l-2 2.7a2.5 2.5 0 0 1-4.3-.9l-1-3.4A5 5 0 0 1 7 7zM8 10v3M6.5 11.5h3", dots: [[15.5, 10.5, 1.1], [17.5, 12.5, 1.1]] }],
    ["dice", "Dice", FUN, { d: "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z", dots: [[8, 8, 1.3], [16, 8, 1.3], [12, 12, 1.3], [8, 16, 1.3], [16, 16, 1.3]] }],
    ["ticket", "Ticket", FUN, { d: "M5 5h14a2 2 0 0 1 2 2v2.5a2.5 2.5 0 0 0 0 5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2.5a2.5 2.5 0 0 0 0-5V7a2 2 0 0 1 2-2zM14 5v2M14 11v2M14 17v2" }],
    ["medal", "Medal", FUN, { d: "M7.5 2 10 9M16.5 2 14 9", rings: [[12, 15, 6]], fill: STAR(12, 15.2, 3) }],
    ["book", "Book", FUN, { d: "M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 0 2 2h13v-4M8 7h7" }],
    ["graduation", "School", FUN, { d: "M2 9l10-5 10 5-10 5zM6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6" }],
    ["briefcase", "Work", FUN, { d: "M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M3 13h18" }],
    ["cart", "Cart", FUN, { d: "M3 4h2.5l2.2 10.5a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L20 7H6.2", dots: [[9.5, 19.5, 1.4], [17, 19.5, 1.4]] }],
    ["package", "Package", FUN, { d: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9M8 5.25l8 4.5" }],
    ["anchor", "Anchor", FUN, { d: "M12 8v13M5 13a7 7 0 0 0 14 0M3 13h3M18 13h3M9 11h6", rings: [[12, 5.5, 2.5]] }],
    ["ghost", "Ghost", FUN, { d: "M5 21V10a7 7 0 0 1 14 0v11l-2.3-1.6-2.3 1.6-2.4-1.6-2.4 1.6-2.3-1.6z", dots: [[9.5, 10.5, 1.3], [14.5, 10.5, 1.3]] }],
    ["skull", "Skull", FUN, { d: "M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3zM10 20v-2M14 20v-2", dots: [[9, 11.5, 1.7], [15, 11.5, 1.7]] }],
    ["sword", "Sword", FUN, { d: "M20 3v4L9.5 17.5l-3-3L17 4zM5 13l6 6M7 17l-3.5 3.5" }],
    ["wand", "Magic", FUN, { d: "M4 20 15 9M13 7l4 4", fill: `${SPARK(18.5, 5.5, 3)}${SPARK(9, 4.5, 2)}` }],
    ["broom", "Clean Up", FUN, { d: "M14 3 10 11.5M7 11.5h7l2.5 9.5H4.5zM9 16l-.8 5M12.5 16l.5 5" }],
    ["sparkles", "Perks", FUN, { d: `${SPARK(10, 9, 6)}${SPARK(18, 17, 3)}` }],
    ["bolt", "Boost Perk", FUN, { d: "M13 2 4 14h7l-1 8 9-12h-7z" }],
    ["party", "Party", FUN, { d: "M4 20l4.5-12 7.5 7.5zM6.3 14l3.7 3.7M8 10l6 6", fill: SPARK(18, 5, 2.5), dots: [[14, 4, 1], [20, 10, 1]] }],
    ["notes", "Notes", FUN, { d: "M6 3h12a1 1 0 0 1 1 1v11l-5 6H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 21v-5a1 1 0 0 1 1-1h4M8.5 8h7M8.5 11.5h5" }],

    // ─── Symbols ───
    ["checkCircle", "Done", SYMBOLS, { d: `${CIRCLE}M8 12.5l2.7 2.7L16 9.5` }],
    ["xCircle", "Cancel", SYMBOLS, { d: `${CIRCLE}M9 9l6 6M15 9l-6 6` }],
    ["info", "Info", SYMBOLS, { d: `${CIRCLE}M12 11v6`, dots: [[12, 7.8, 1.2]] }],
    ["help", "Help", SYMBOLS, { d: `${CIRCLE}M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6`, dots: [[12, 17, 1.2]] }],
    ["warning", "Warning", SYMBOLS, { d: "M12 3.5 2.5 20h19zM12 10v4.5", dots: [[12, 17.2, 1.2]] }],
    ["infinity", "Infinity", SYMBOLS, { d: "M12 12c-2-2.7-4-4-6-4a4 4 0 0 0 0 8c2 0 4-1.3 6-4zm0 0c2 2.7 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.3-6 4z" }],
    ["percent", "Discount", SYMBOLS, { d: "M19 5 5 19", rings: [[7, 7, 2.5], [17, 17, 2.5]] }],

    // ─── Added later: more of everything ───
    ["quote", "Quote", CHAT, { d: "M4 11h5v6H4zM4 11c0-3 1.5-5 5-6M14 11h5v6h-5zM14 11c0-3 1.5-5 5-6" }],
    ["checklist", "Checklist", CHAT, { d: "M10 6h10M10 12h10M10 18h10M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5" }],
    ["chatQuestion", "Ask", CHAT, { d: `${BUBBLE}M9.8 8.3a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.4`, dots: [[12, 14.3, 1]] }],

    ["videoSpeed", "Playback Speed", VOICE, { d: "M4.5 17a8.5 8.5 0 1 1 15 0M12 13l4-4.5M12 5.5v1.5M6.8 7.8l1 1M17.2 7.8l-1 1M5 12.5h1.5M19 12.5h-1.5", dots: [[12, 13, 1.6]] }],
    ["playCircle", "Video", VOICE, { d: `${CIRCLE}M10 8.5v7l5.5-3.5z` }],
    ["podcast", "Podcast", VOICE, { d: "M8.5 15.5a6 6 0 1 1 7 0M6 18.5a9.5 9.5 0 1 1 12 0M12 12.5V21", rings: [[12, 10, 2.2]] }],
    ["clapper", "Clapperboard", VOICE, { d: "M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10 3.3 6.6a1 1 0 0 1 .8-1.2L17 3l.8 3.9zM8 4.3l2 4.5M13 3.5l2 4.5" }],
    ["photoCamera", "Photo Camera", VOICE, { d: "M4 7h3l1.5-2.5h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z", rings: [[12, 12.5, 3.5]] }],

    ["album", "Album", MUSIC, { d: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", rings: [[12, 12, 4.5]], dots: [[12, 12, 1.2]] }],

    ["folderOpen", "Open Folder", MEDIA, { d: "M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1M3 7v11a1 1 0 0 0 1 1h13.5a1 1 0 0 0 1-.7L21 11H6.5a1 1 0 0 0-1 .7L3 18" }],
    ["fileZip", "Zip File", MEDIA, { d: "M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M10 3v2M10 7v2M10 11v2M9 15h2v3H9z" }],
    ["cloudUpload", "Cloud Upload", MEDIA, { d: "M7 16.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 8.5a4 4 0 0 1 .5 8M12 21v-9M9 15l3-3 3 3" }],
    ["aperture", "Aperture", MEDIA, { d: `${CIRCLE}M14.3 3.3 8.5 13.3M20.6 9.2H9M17.9 18.7 12 8.6M9.7 20.7l5.8-10M3.4 14.8H15M6.1 5.3 12 15.4` }],
    ["brush", "Paint Brush", MEDIA, { d: "M18.5 3.5a2.1 2.1 0 0 1 3 3L12 16l-3-3zM9 13c-2.5 0-4 1.5-4 4 0 1.5-1 2.5-2 3 4 1 9 0 9-4" }],
    ["penNib", "Pen", MEDIA, { d: "M12 21.5 6.4 13.2 8.4 7h7.2l2 6.2zM9.2 7V3.5h5.6V7M12 21.5v-7.4", rings: [[12, 12.4, 1.7]] }],
    ["pipette", "Colour Picker", MEDIA, { d: "M15 3.5a2.1 2.1 0 0 1 3 0l2.5 2.5a2.1 2.1 0 0 1 0 3l-2.5 2.5-5.5-5.5zM12.5 6.5l-8 8V19h4.5l8-8M7 17l-3 3" }],
    ["ruler", "Ruler", MEDIA, { d: "M3 16 16 3l5 5L8 21zM7 12l2 2M10 9l1.5 1.5M13 6l2 2M5.5 14.5 7 16M8.5 11.5 10 13M11.5 8.5 13 10" }],

    ["bluetooth", "Bluetooth", TECH, { d: "M7 7l10 10-5 4V3l5 4L7 17" }],
    ["radioTower", "Broadcast", TECH, { d: "M12 11.5V21M8.5 21 12 11.5 15.5 21M8.2 6.2a5.5 5.5 0 0 0 0 7.6M15.8 6.2a5.5 5.5 0 0 1 0 7.6M5.3 3.5a9.5 9.5 0 0 0 0 13M18.7 3.5a9.5 9.5 0 0 1 0 13", dots: [[12, 10, 1.6]] }],
    ["braces", "Braces", TECH, { d: "M9 3H8a2 2 0 0 0-2 2v4a2 2 0 0 1-2 3 2 2 0 0 1 2 3v4a2 2 0 0 0 2 2h1M15 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 3 2 2 0 0 0-2 3v4a2 2 0 0 1-2 2h-1" }],
    ["fingerprint", "Fingerprint", TECH, { d: "M12 11v3c0 2.5-.5 4.5-2 6.5M8.5 9.5a3.5 3.5 0 0 1 7 0V13c0 2.5-.5 5-1.5 7M5.5 15c.3-1.5.5-3 .5-5.5a6 6 0 0 1 9-5.2M18 8.5c.5 1 .5 2 .5 3.5 0 2 0 4-.7 6M7.5 20c.8-1.5 1.3-3.3 1.5-5" }],
    ["toggle", "Toggle", TECH, { d: "M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7z", dots: [[16, 12, 2.8]] }],
    ["command", "Command Key", TECH, { d: "M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zM15 9h2.5A2.5 2.5 0 1 0 15 6.5V9zM9 15H6.5A2.5 2.5 0 1 0 9 17.5V15zM15 15v2.5a2.5 2.5 0 1 0 2.5-2.5H15zM9 9h6v6H9z" }],
    ["binoculars", "Binoculars", TECH, { d: "M3 16V8a2 2 0 0 1 2-2h2l1 4M21 16V8a2 2 0 0 0-2-2h-2l-1 4M10 15.5h4M10 10.5h4", rings: [[6.5, 16, 3.5], [17.5, 16, 3.5]] }],
    ["siren", "Siren", TECH, { d: "M7 18v-5a5 5 0 0 1 10 0v5M5 18h14v3H5zM12 3v2M4.5 6l1.4 1.4M19.5 6l-1.4 1.4M2 12h2M20 12h2" }],
    ["pieChart", "Pie Chart", TECH, { d: "M11 4v9h9a9 9 0 1 1-9-9zM14.5 2.5A8 8 0 0 1 21.5 9.5h-7z" }],
    ["trendingUp", "Trending Up", TECH, { d: "M3 17l6-6 4 4 8-8M15 7h6v6" }],
    ["calendarCheck", "Planned", TECH, { d: `${CALENDAR}M9 15l2 2 4-4` }],
    ["alarm", "Alarm Clock", TECH, { d: "M12 9.5V13l2.5 1.5M4 4.5 6.5 2.5M20 4.5l-2.5-2M6.5 19.5 5 21M17.5 19.5 19 21", rings: [[12, 13, 7.5]] }],
    ["bellRing", "Ringing Bell", TECH, { d: "M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0M2.5 7a8 8 0 0 1 2.5-4.5M21.5 7A8 8 0 0 0 19 2.5" }],

    ["sunrise", "Sunrise", NATURE, { d: "M12 3v4M9 5.5 12 3l3 2.5M5.6 11.6l1.4 1.4M18.4 11.6 17 13M2 18h2M20 18h2M3 21h18M7 18a5 5 0 0 1 10 0" }],
    ["cloudSun", "Partly Cloudy", NATURE, { d: "M7.5 9.5a4 4 0 0 1 7.3-2.2M4.5 3.5l1 1.5M11 1.5V3M2 9h1.5M8 20a4 4 0 0 1-.5-8 5 5 0 0 1 9.6 1.5A3.3 3.3 0 0 1 16.7 20z" }],
    ["wind", "Wind", NATURE, { d: "M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7" }],
    ["thermometer", "Temperature", NATURE, { d: "M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0zM12 9v8" }],
    ["cactus", "Cactus", NATURE, { d: "M10 21V5a2 2 0 0 1 4 0v16M10 14H8a2 2 0 0 1-2-2V9M14 11h2a2 2 0 0 0 2-2V7M6 21h12" }],
    ["mushroom", "Mushroom", NATURE, { d: "M4 12a8 8 0 0 1 16 0zM9.5 12v6a2.5 2.5 0 0 0 5 0v-6", dots: [[9, 8.5, 1.2], [14.5, 7.5, 1.2]] }],
    ["fish", "Fish", NATURE, { d: "M3 12c3-5 9-6 13-3l5-3v12l-5-3c-4 3-10 2-13-3z", dots: [[7.5, 11, 1.1]] }],
    ["feather", "Feather", NATURE, { d: "M20 4c-6 0-11 4-12 11l-4 5M8 15h6c3 0 6-3 6-11M10 10h7" }],
    ["cat", "Cat", NATURE, { d: "M5 20V9.5L4 4l4.5 3h7L20 4l-1 5.5V20zM10.5 16h3M12 16v1.5", dots: [[9, 12.5, 1.1], [15, 12.5, 1.1]] }],
    ["butterfly", "Butterfly", NATURE, { d: "M12 7v12M12 9C9 4 3 3 3 8c0 3 3 4.5 6 4-3 1-5 3-3.5 5.5 1.5 2.5 5 1 6.5-3.5zM12 9c3-5 9-6 9-1 0 3-3 4.5-6 4 3 1 5 3 3.5 5.5-1.5 2.5-5 1-6.5-3.5zM10.5 4l1.5 3 1.5-3" }],
    ["stars", "Starry Night", NATURE, { d: `${STAR(9, 13.5, 6.5)}${SPARK(18.5, 6, 3)}` }],

    ["joystick", "Joystick", FUN, { d: "M8 15h8a3 3 0 0 1 3 3v2H5v-2a3 3 0 0 1 3-3zM12 15V8", rings: [[12, 5.5, 2.6]] }],
    ["award", "Award", FUN, { d: "M8.5 14 7 22l5-3 5 3-1.5-8", rings: [[12, 9, 6]] }],
    ["balloon", "Balloon", FUN, { d: "M12 16c-3.5 0-6-3-6-6.5a6 6 0 0 1 12 0c0 3.5-2.5 6.5-6 6.5zM11 16l-.5 1.5h3L13 16M12 17.5c0 2-1.5 2.5-1.5 4" }],
    ["fireworks", "Fireworks", FUN, { d: "M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8", dots: [[12, 12, 1.5]] }],
    ["cookie", "Cookie", FUN, { d: "M21 12.5A9 9 0 1 1 11.5 3a3 3 0 0 0 3.5 3.5 3 3 0 0 0 3.5 3.5 3 3 0 0 0 2.5 2.5z", dots: [[8, 9, 1.1], [9, 15, 1.1], [14, 14, 1.1], [15.5, 18, 0.9]] }],
    ["iceCream", "Ice Cream", FUN, { d: "M7.5 11 12 21.5 16.5 11M6 11h12M7 11a5 5 0 0 1 10 0" }],
    ["burger", "Burger", FUN, { d: "M4.5 10a7.5 5.5 0 0 1 15 0zM3 13.5c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0M5 17h14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z", dots: [[9, 7, 0.7], [12.5, 6.3, 0.7], [15, 7.5, 0.7]] }],
    ["boba", "Bubble Tea", FUN, { d: "M6 8h12l-1.5 13h-9zM5 8h14M10.5 8 13 2.5h2.5", dots: [[9.5, 17.5, 1], [12, 18.5, 1], [14.5, 17.5, 1], [11, 15.5, 1], [13.5, 15.5, 1]] }],
    ["cocktail", "Cocktail", FUN, { d: "M4 4h16l-8 9zM12 13v8M8 21h8M15 4l2-2" }],
    ["heartPulse", "Health", FUN, { d: "M12 20s-8-4.6-8-10.5A4.5 4.5 0 0 1 12 6.5a4.5 4.5 0 0 1 8 3C20 15.4 12 20 12 20zM3.5 12h4l2-3 3 6 2-3h6" }],
    ["pill", "Pill", FUN, { d: "M10.5 3.5a5 5 0 0 1 7.1 7.1l-7 7a5 5 0 0 1-7.1-7.1zM7 7l7 7" }],
    ["dumbbell", "Workout", FUN, { d: "M6.5 6.5v11M17.5 6.5v11M6.5 12h11M4 9v6M20 9v6M2.5 12H4M20 12h1.5" }],
    ["piggyBank", "Savings", FUN, { d: "M19 10.5c0-3-3-5.5-7-5.5S5 7.5 5 10.5c0 1.8 1 3.4 2.5 4.5V18h2.5v-1.5h4V18h2.5v-3c.8-.6 1.4-1.3 1.8-2H20v-3h-1.2a5.3 5.3 0 0 0-.8-1.5zM10 5V3.5h4V5M3 9.5c1 0 2 .5 2 1.5", dots: [[15, 9.5, 0.9]] }],
    ["coin", "Coin", FUN, { d: `${CIRCLE}M14.5 9.5c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.5.8-2.5 1.8s1 1.4 2.5 1.7 2.5.8 2.5 1.9-1 1.8-2.5 1.8c-1.2 0-2.1-.5-2.6-1.3M12 6.8v1.5M12 15.8v1.5` }],
    ["car", "Car", FUN, { d: "M5 16H3v-4l2-5h14l2 5v4h-2M5 12h14M9 16h6", rings: [[7, 16.5, 2], [17, 16.5, 2]] }],
    ["plane", "Plane", FUN, { d: "M10.5 3.5a1.5 1.5 0 0 1 3 0V9l8 5v2l-8-2.5v4.5l2.5 2V21L12 20l-4 1v-1l2.5-2v-4.5L2.5 16v-2l8-5z" }],
    ["bike", "Bicycle", FUN, { d: "M6 16l4-8h5l3 8M10 8l2 8H6M14 5h2.5", rings: [[6, 16, 3.5], [18, 16, 3.5]] }],
    ["tent", "Camping", FUN, { d: "M3 20 12 4l9 16zM12 4v16M9 20l3-6 3 6M2 20h20" }],
    ["castle", "Castle", FUN, { d: "M4 21V7h3v2h2.5V7h5v2H17V7h3v14zM10 21v-4a2 2 0 0 1 4 0v4M4 7V4.5M20 7V4.5M11.5 7V4.5h3" }],
    ["ufo", "UFO", FUN, { d: "M8 10a4 4 0 0 1 8 0M2.5 13c0-1.7 4.3-3 9.5-3s9.5 1.3 9.5 3-4.3 3-9.5 3-9.5-1.3-9.5-3zM8 18l-1 3M16 18l1 3M12 18.5V21", dots: [[7, 13, 0.8], [12, 13.6, 0.8], [17, 13, 0.8]] }],
    ["chessPawn", "Chess", FUN, { d: "M7.5 21h9l-1-3h-7zM10 18l.5-6h3l.5 6M9 12h6", rings: [[12, 7.5, 2.6]] }],
    ["cards", "Playing Cards", FUN, { d: "M5 6.5 13 4a1.5 1.5 0 0 1 1.8 1l3.2 11a1.5 1.5 0 0 1-1 1.8l-8 2.5a1.5 1.5 0 0 1-1.9-1L4 8.3a1.5 1.5 0 0 1 1-1.8zM16.5 4.6l2.7.7a1.5 1.5 0 0 1 1 1.8L18.4 14", fill: "M10.6 15.4c-.9-.6-2.3-1.6-2.4-2.6-.1-1.2 1.3-1.6 2.1-.8.4-1.1 1.9-1 2 .2.1 1-1 2.3-1.7 3.2z" }],
];

/** Sonata's own mark: two beamed eighth notes. */
export const SonataIcon = draw(ICONS.find(i => i[0] === "sonata")![3]);

export const CalendarDockIcon = draw({ d: CALENDAR, dots: [[8.5, 14, 1.1], [12, 14, 1.1], [15.5, 14, 1.1], [8.5, 17.2, 1.1]] });

// Added with feature icons.
ICONS.push(
    ["fontType", "Font", SYMBOLS, { d: "M4 19 8.5 6h1L14 19M5.6 15h6.8M15.5 11.2a2.8 2.8 0 0 1 5 1.7V19M20.5 14.8c-1-.4-2-.5-3-.3-1.3.3-2 1-2 2.1 0 1.3 1 2.1 2.3 2.1 1.4 0 2.4-.8 2.7-2" }],
    ["fileConvert", "Convert File", TECH, { d: "M13 3H7a2 2 0 0 0-2 2v6M13 3l5 5v2M13 3v5h5M5 15v4a2 2 0 0 0 2 2h4M19 14v5a2 2 0 0 1-2 2h-1M8.5 14.5 5 18l3.5 3.5M15.5 10.5 19 14l-3.5 3.5" }],
    ["videoEdit", "Video Editor", MEDIA, { d: "M3 6.5A1.5 1.5 0 0 1 4.5 5h11A1.5 1.5 0 0 1 17 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13.5zM17 8.5l4-2v7l-4-2M6 5v10M14 15l3.5 5M10 15l-3.5 5", rings: [[18, 20.2, 1.4], [6, 20.2, 1.4]] }],
    ["spellCheck", "Spell Check", CHAT, { d: "M3 16 7.5 4h1L13 16M4.8 12h6.4M12.5 16.5l3 3 6-7" }],
    ["blockTile", "Blocks", FUN, { d: "M6.2 2.6 21.4 6.2 17.8 21.4 2.6 17.8z", fill: "M10.7 9.2 14.8 10.7 13.3 14.8 9.2 13.3z" }],
);

ICONS.push(["calendar", "Calendar", FUN, { d: CALENDAR, dots: [[8.5, 14, 1.1], [12, 14, 1.1], [15.5, 14, 1.1], [8.5, 17.2, 1.1]] }]);

/** The order of the groups in the picker. */
export const DOCK_ICON_GROUPS = [SONATA, CHAT, VOICE, SERVER, PEOPLE, MUSIC, MEDIA, TECH, NATURE, FUN, SYMBOLS];

export const DOCK_ICON_LIBRARY: DockIconDef[] = ICONS.map(([key, label, group, art]) => ({ key, label, group, Icon: draw(art) }));

export const DOCK_ICON_MAP: Record<string, DockIconDef> = Object.fromEntries(
    DOCK_ICON_LIBRARY.map(def => [def.key, def]),
);

export const DEFAULT_DOCK_ICON_KEY = "puzzle";
