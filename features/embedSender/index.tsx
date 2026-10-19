/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType } from "@api/Commands";
import { ModalCloseButton as LegacyModalCloseButton, ModalContent as LegacyModalContent, ModalFooter as LegacyModalFooter, ModalHeader as LegacyModalHeader, ModalRoot as LegacyModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { findCssClassesLazy } from "@webpack";
import { ChannelStore, Parser, React, ReactDOM, SelectedChannelStore, showToast as discordToast, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";

type BtnProps = { children: React.ReactNode; onClick?(): void; disabled?: boolean; color?: string; size?: string; style?: React.CSSProperties; };
const Button = Object.assign(({ children, onClick, disabled, color, style }: BtnProps) => (
    <button type="button" disabled={disabled} onClick={onClick} style={style}
        className={`vc-tool-btn${color === "brand" ? " vc-tool-primary" : color === "red" ? " vc-tool-danger" : ""}`}>
        {children}
    </button>
), {
    Sizes: { SMALL: "small", MEDIUM: "medium" },
    Colors: { BRAND: "brand", PRIMARY: "primary", TRANSPARENT: "transparent", RED: "red", GREEN: "brand" },
    Looks: { FILLED: "filled", OUTLINED: "outlined", LINK: "link" },
});

import { defineFeatureSettings } from "../../featureSettings";
import { pickCharacters } from "../charactersPicker";
import { AvatarPicker, PictureInput } from "./avatar";
import { addToHistory, BannerMaker, ColorFromImage, LINE_MARK, NavHubBuilder, RobloxGameBuilder, RulesBuilder, SentHistory, SentItem } from "./builders";
import { fill, fillAll, fillContext, HookInfo, hookInfo, loadScheduled, nextTime, Palette, paletteSources, rememberHook, SavedWebhooks, ScheduleBox, Scheduled, summaryLabel, useHookInfo } from "./extras";
import { EmojiPanel, emojiUrl, RichText } from "./inserts";
import { fillReplyTexts, PRIVATE_STYLES, privateConfig, PrivateRepliesSetup, syncReplies } from "./private";
import { TemplateData, TemplatesSection } from "./templates";
import { showOnlyMe, TestButton, TestChannel, testWebhookFor } from "./test";
import { openWebhookPicker } from "./webhookPicker";

// The editor is the only visible option. The three defaults below are
// hidden because the editor already has its own Webhook URL / Username /
// Avatar fields and writes back into these — showing both would give two
// out-of-sync copies of the same inputs on one page.
// This Equicord types the legacy modal pieces as `never` (deprecated) and no
// longer exports ModalProps; they still work at runtime, which is what this
// window has always used.
type ModalProps = RenderModalProps;
const ModalCloseButton = LegacyModalCloseButton as unknown as React.ComponentType<any>;
const ModalContent = LegacyModalContent as unknown as React.ComponentType<any>;
const ModalFooter = LegacyModalFooter as unknown as React.ComponentType<any>;
const ModalHeader = LegacyModalHeader as unknown as React.ComponentType<any>;
const ModalRoot = LegacyModalRoot as unknown as React.ComponentType<any>;

const settings = defineFeatureSettings("embedSender", {
    editor: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <EmbedEditorPanel />,
    },
    webhookUrl: {
        type: OptionType.STRING,
        description: "Default webhook URL to send embeds through (Server Settings > Integrations > Webhooks)",
        default: "",
        hidden: true,
    },
    username: {
        type: OptionType.STRING,
        description: "Default override name shown on embed messages (new messages only)",
        default: "",
        hidden: true,
    },
    avatarUrl: {
        type: OptionType.STRING,
        description: "Default override avatar shown on embed messages (new messages only)",
        default: "",
        hidden: true,
    },
    sentDraftsJson: {
        type: OptionType.STRING,
        description: "Internal: editor drafts of recently sent messages, so loading one back for editing restores it exactly.",
        default: "",
        hidden: true,
    },
    webhooksJson: {
        type: OptionType.STRING,
        description: "Internal: saved webhooks.",
        default: "",
        hidden: true,
    },
    scheduledJson: {
        type: OptionType.STRING,
        description: "Internal: embeds waiting to be sent later.",
        default: "",
        hidden: true,
    },
    templatesJson: {
        type: OptionType.STRING,
        description: "Internal: saved embed templates.",
        default: "",
        hidden: true,
    },
    privateWorkerUrl: {
        type: OptionType.STRING,
        description: "Internal: your private-replies Worker's address.",
        default: "",
        hidden: true,
    },
    privateSecret: {
        type: OptionType.STRING,
        description: "Internal: your private-replies Worker's secret (stays on this computer).",
        default: "",
        hidden: true,
    },
    testChannelJson: {
        type: OptionType.STRING,
        description: "Internal: the channel test posts go to, and its test webhook.",
        default: "",
        hidden: true,
    },
    testAutoDelete: {
        type: OptionType.BOOLEAN,
        description: "Internal: delete test posts after 2 minutes.",
        default: false,
        hidden: true,
    },
    sentHistoryJson: {
        type: OptionType.STRING,
        description: "Internal: messages you've sent from the editor.",
        default: "",
        hidden: true,
    },
    draftJson: {
        type: OptionType.STRING,
        description: "Internal: last saved embed draft from the editor UI. Not meant to be hand-edited.",
        default: "",
        hidden: true,
    },
});

privateConfig.read = () => ({ url: settings.store.privateWorkerUrl ?? "", secret: settings.store.privateSecret ?? "" });
privateConfig.write = c => { settings.store.privateWorkerUrl = c.url; settings.store.privateSecret = c.secret; };

interface EmbedField {
    name: string;
    value: string;
    inline: boolean;
}

interface EmbedDraft {
    title: string;
    description: string;
    url: string;
    color: string;
    authorName: string;
    authorUrl: string;
    authorIcon: string;
    imageUrl: string;
    thumbnailUrl: string;
    footerText: string;
    footerIcon: string;
    fields: EmbedField[];
}

type ButtonPlacement = "inside" | "below";

interface MessageButton {
    label: string;
    url: string;
    /** A link (opens a website), or a private reply (a message only the presser sees — needs your bot). */
    kind?: "link" | "private";
    /** Private reply: the message, its ID on your Worker, and the button's colour. */
    reply?: string;
    replyId?: string;
    style?: 1 | 2 | 3 | 4;
    /** An emoji before the label: a normal one (😀) or a custom one (<:name:id>). */
    emoji?: string;
    /**
     * Container layout only: inside the last card, or in its own row under
     * it. Missing on buttons saved before this existed — treated as "inside",
     * which is where they always went.
     */
    placement?: ButtonPlacement;
}

const placementOf = (b: MessageButton): ButtonPlacement => b.placement ?? "inside";

type Layout = "container" | "classic";
/** Colours that always show in the colour drawer. */
const PRESET_COLOURS: [string, string][] = [["5865F2", "Blurple"], ["57F287", "Green"], ["FEE75C", "Yellow"], ["EB459E", "Fuchsia"], ["ED4245", "Red"], ["F47B67", "Salmon"], ["9B59B6", "Purple"], ["3498DB", "Blue"], ["1ABC9C", "Teal"], ["E67E22", "Orange"], ["FFFFFF", "White"], ["2B2D31", "Dark"]];
type EditorTab = "compose" | "templates" | "sent" | "schedule" | "builders" | "private";

interface Draft {
    content: string;
    webhookUrl: string;
    embeds: EmbedDraft[];
    buttons: MessageButton[];
    /** Missing on drafts saved before layouts existed — treated as "container". */
    layout?: Layout;
}

function blankButton(): MessageButton {
    return { label: "", url: "", placement: "inside" };
}

function blankEmbed(): EmbedDraft {
    return {
        title: "",
        description: "",
        url: "",
        color: "5865F2",
        authorName: "",
        authorUrl: "",
        authorIcon: "",
        imageUrl: "",
        thumbnailUrl: "",
        footerText: "",
        footerIcon: "",
        fields: [],
    };
}

function loadDraft(): Draft {
    try {
        const raw = settings.store.draftJson;
        // Spread onto a default so drafts saved before "buttons" existed still load fine.
        if (raw) return { content: "", webhookUrl: settings.store.webhookUrl, embeds: [blankEmbed()], buttons: [], ...JSON.parse(raw) };
    } catch { /* ignore malformed draft */ }
    return { content: "", webhookUrl: settings.store.webhookUrl, embeds: [blankEmbed()], buttons: [] };
}

function saveDraft(draft: Draft) {
    settings.store.draftJson = JSON.stringify(draft);
}

// Editor drafts of recently sent messages, keyed by message ID. A Components
// V2 message can't be turned back into editor fields losslessly (it's just
// markdown text blocks), so when you load a message this plugin sent, the
// exact draft is restored from here instead. Capped so it can't grow forever.
const MAX_SENT_DRAFTS = 30;

function loadSentDrafts(): Record<string, Draft> {
    try {
        const parsed = JSON.parse(settings.store.sentDraftsJson || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function rememberSentDraft(messageId: string, draft: Draft) {
    const all = loadSentDrafts();
    // Delete first so re-sending moves it to the newest end. Snowflakes are
    // too large to count as array indices, so object keys keep insertion order.
    delete all[messageId];
    all[messageId] = draft;
    const keys = Object.keys(all);
    while (keys.length > MAX_SENT_DRAFTS) delete all[keys.shift()!];
    settings.store.sentDraftsJson = JSON.stringify(all);
}

// Only link-style buttons (style 5) work here: they just open a URL client-side
// and never fire an interaction, so they need no bot/interaction handler behind
// them — unlike every other button style, which does. That's also the only kind
// a plain (non application-owned) incoming webhook is allowed to send at all;
// see the with_components note where this is used in handleSend.
/** "<:name:id>", "<a:name:id>" or a plain emoji → what Discord wants on a button. */
function buttonEmoji(token?: string) {
    const t = (token ?? "").trim();
    if (!t) return undefined;
    const m = /^<(a?):(\w+):(\d+)>$/.exec(t);
    return m ? { id: m[3], name: m[2], animated: !!m[1] } : { name: t };
}
const emojiFromApi = (e: any): string | undefined => e?.id ? `<${e.animated ? "a" : ""}:${e.name}:${e.id}>` : e?.name || undefined;

function buttonsToComponents(buttons: MessageButton[]) {
    const valid = buttons.filter(b => b.label.trim() && (b.kind === "private" ? !!b.replyId : b.url.trim()));
    if (!valid.length) return undefined;
    return [{
        type: 1, // Action Row
        components: valid.map(b => b.kind === "private"
            // A clickable button: your bot (the Worker) answers it with a private message.
            ? { type: 2, style: b.style ?? 1, label: b.label.slice(0, 80), custom_id: `sonata:r:${b.replyId}`, ...(b.emoji?.trim() && { emoji: buttonEmoji(b.emoji) }) }
            : { type: 2, style: 5, label: b.label.slice(0, 80), url: b.url.trim(), ...(b.emoji?.trim() && { emoji: buttonEmoji(b.emoji) }) }),
    }];
}

/** A button read back from a sent message (links, and Sonata's private reply buttons). */
function buttonFromApi(c: any, placement?: ButtonPlacement): MessageButton | null {
    const emoji = emojiFromApi(c?.emoji);
    if (c?.style === 5 && c.url) return { label: c.label || "", url: c.url, placement, emoji };
    const id = typeof c?.custom_id === "string" && c.custom_id.startsWith("sonata:r:") ? c.custom_id.slice(9) : null;
    return id ? { label: c.label || "", url: "", kind: "private", replyId: id, reply: "", style: (c.style ?? 1) as 1 | 2 | 3 | 4, placement, emoji } : null;
}

function embedDraftToPayload(e: EmbedDraft) {
    const payload: Record<string, any> = {};
    if (e.title) payload.title = e.title;
    if (e.description) payload.description = e.description;
    if (e.url) payload.url = e.url;
    if (e.color) {
        const n = parseInt(e.color.replace("#", ""), 16);
        if (!isNaN(n)) payload.color = n;
    }
    if (e.authorName) payload.author = { name: e.authorName, url: e.authorUrl || undefined, icon_url: e.authorIcon || undefined };
    if (e.imageUrl) payload.image = { url: e.imageUrl };
    if (e.thumbnailUrl) payload.thumbnail = { url: e.thumbnailUrl };
    if (e.footerText) payload.footer = { text: e.footerText, icon_url: e.footerIcon || undefined };
    if (e.fields.length) {
        payload.fields = e.fields
            .filter(f => f.name || f.value)
            .map(f => ({ name: f.name || "\u200b", value: f.value || "\u200b", inline: f.inline }));
    }
    return payload;
}

/** An embed as Discord's API (or Discohook) writes it, turned into an editor draft. */
function apiEmbedToDraft(em: any): EmbedDraft {
    const color = typeof em.color === "number" ? em.color.toString(16).padStart(6, "0")
        : typeof em.color === "string" && em.color ? em.color.replace(/^#/, "") : "5865F2";
    return {
        title: em.title || "",
        description: em.description || "",
        url: em.url || "",
        color,
        authorName: em.author?.name || "",
        authorUrl: em.author?.url || "",
        authorIcon: em.author?.icon_url || "",
        imageUrl: em.image?.url || "",
        thumbnailUrl: em.thumbnail?.url || "",
        footerText: em.footer?.text || "",
        footerIcon: em.footer?.icon_url || "",
        fields: (em.fields || []).map((f: any) => ({ name: f.name ?? "", value: f.value ?? "", inline: !!f.inline })),
    };
}

function isEmbedEmpty(e: EmbedDraft): boolean {
    return !e.title && !e.description && !e.authorName && !e.footerText &&
        !e.imageUrl && !e.thumbnailUrl && !e.fields.some(f => f.name || f.value);
}

// ─── Components V2 ("container") layout ───
// This is what makes files render INSIDE the card: the whole message is
// built from components instead of embeds. Each embed becomes a Container
// (type 17, the colored card), and attachments are placed into it by
// referencing them as attachment://<filename>. With the IS_COMPONENTS_V2
// flag set, Discord doesn't allow `content` or `embeds` on the message, so
// the message content becomes a text block above the cards.
// https://discord.com/developers/docs/components/reference

const IS_COMPONENTS_V2 = 1 << 15;

const C = {
    ACTION_ROW: 1,
    SECTION: 9,
    TEXT: 10,
    THUMBNAIL: 11,
    MEDIA_GALLERY: 12,
    FILE: 13,
    SEPARATOR: 14,
    CONTAINER: 17,
} as const;

const separator = () => ({ type: C.SEPARATOR, divider: true, spacing: 1 });
const text = (content: string) => ({ type: C.TEXT, content });

const LINE_RE = /^[ \t]*-{3,}[ \t]*$/m;
/** Text split at its --- lines: the pieces, with null where a line goes. */
function splitAtLines(s: string): (string | null)[] {
    const out: (string | null)[] = [];
    for (const piece of s.split(/^[ \t]*-{3,}[ \t]*$/m)) {
        if (out.length) out.push(null);
        const t = piece.replace(/^\n+|\n+$/g, "");
        if (t.trim()) out.push(t);
    }
    // Two lines in a row are one line.
    return out.filter((p, i) => !(p === null && out[i - 1] === null));
}
/** Text components, with a real separator wherever the text has a --- line. */
const textWithLines = (s: string) => splitAtLines(s).map(p => p === null ? separator() : text(p));
const mdLink = (label: string, url: string) => (url.trim() ? `[${label}](${url.trim()})` : label);

function isMediaType(contentType: string): boolean {
    return /^(image|video)\//.test(contentType);
}

interface AttachmentRef {
    filename: string;
    contentType: string;
}

// Discord matches attachment://<name> against the uploaded file name, and
// rewrites names with spaces/special characters on upload — so a raw name
// like "my file (1).zip" would silently stop matching. Names are sanitized
// up front and de-duplicated against anything already on the message.
function assignAttachmentNames(names: string[], taken: Set<string>): string[] {
    return names.map(original => {
        const base = original.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "") || "file";
        const dot = base.lastIndexOf(".");
        let name = base;
        for (let n = 2; taken.has(name.toLowerCase()); n++) {
            name = dot > 0 ? `${base.slice(0, dot)}_${n}${base.slice(dot)}` : `${base}_${n}`;
        }
        taken.add(name.toLowerCase());
        return name;
    });
}

/** The embed parts that can show a picture. */
const PIC_KEYS = ["imageUrl", "thumbnailUrl", "authorIcon", "footerIcon"] as const;
type PicKey = typeof PIC_KEYS[number];
const attachedName = (v: string) => /^attachment:\/\/(.+)$/.exec(v ?? "")?.[1];

/** Files the embeds show as pictures (attachment://name) — they aren't listed again as plain files. */
function picturedNames(embeds: EmbedDraft[]): Set<string> {
    const names = new Set<string>();
    for (const e of embeds) for (const k of PIC_KEYS) { const n = attachedName(e[k]); if (n) names.add(n); }
    return names;
}

/** Points attachment:// pictures at the names their files are uploaded under. */
function renamePictures(embeds: EmbedDraft[], names: Map<string, string>): EmbedDraft[] {
    return embeds.map(e => {
        const out = { ...e };
        for (const k of PIC_KEYS) { const n = attachedName(e[k]); if (n && names.has(n)) out[k] = `attachment://${names.get(n)}`; }
        return out;
    });
}

/** Files + link buttons, appended to whichever component list they belong in. */
function pushAttachmentsAndButtons(target: any[], attachments: AttachmentRef[], buttons: MessageButton[]) {
    const media = attachments.filter(a => isMediaType(a.contentType));
    const other = attachments.filter(a => !isMediaType(a.contentType));

    if (attachments.length && target.length) target.push(separator());
    // A media gallery holds at most 10 items.
    for (let i = 0; i < media.length; i += 10) {
        target.push({
            type: C.MEDIA_GALLERY,
            items: media.slice(i, i + 10).map(a => ({ media: { url: `attachment://${a.filename}` } })),
        });
    }
    for (const a of other) {
        target.push({ type: C.FILE, file: { url: `attachment://${a.filename}` } });
    }

    const row = buttonsToComponents(buttons);
    if (row) target.push(...row);
}

function embedToContainer(e: EmbedDraft, extras: ((c: any[]) => void) | null) {
    const c: any[] = [];

    // Header: author (small) + title (heading), with the thumbnail beside it.
    const header: string[] = [];
    if (e.authorName) header.push(`-# ${mdLink(e.authorName, e.authorUrl)}`);
    if (e.title) header.push(`## ${mdLink(e.title, e.url)}`);

    let descriptionUsed = false;
    if (e.thumbnailUrl) {
        // A Section needs 1-3 text blocks next to its thumbnail. If there's
        // no header, the description sits beside the thumbnail instead.
        // A description with lines in it can't sit beside the thumbnail (only text can).
        const beside = header.length ? header : (e.description && !LINE_RE.test(e.description) ? [e.description] : []);
        if (beside.length && !header.length) descriptionUsed = true;
        if (beside.length) {
            c.push({
                type: C.SECTION,
                components: beside.map(text),
                accessory: { type: C.THUMBNAIL, media: { url: e.thumbnailUrl } },
            });
        } else {
            c.push({ type: C.MEDIA_GALLERY, items: [{ media: { url: e.thumbnailUrl } }] });
        }
    } else {
        header.forEach(h => c.push(text(h)));
    }

    const hasBody = (e.description && !descriptionUsed) || e.fields.some(f => f.name || f.value);
    if (header.length && hasBody) c.push(separator());

    if (e.description && !descriptionUsed) c.push(...textWithLines(e.description));

    // Components V2 has no side-by-side fields, so they stack as bold
    // name + value blocks in a single text component.
    const fields = e.fields.filter(f => f.name || f.value);
    if (fields.length) {
        c.push(text(fields.map(f => `**${f.name || "\u200b"}**\n${f.value || "\u200b"}`).join("\n\n")));
    }

    if (e.imageUrl) c.push({ type: C.MEDIA_GALLERY, items: [{ media: { url: e.imageUrl } }] });

    extras?.(c);

    if (e.footerText) c.push(text(`-# ${e.footerText}`));

    // Two lines in a row (say, the one under the title and one at the start of the text) are one.
    const container: Record<string, any> = { type: C.CONTAINER, components: c.filter((x, i) => !(x.type === C.SEPARATOR && c[i - 1]?.type === C.SEPARATOR)) };
    const color = parseInt(e.color.replace("#", ""), 16);
    if (/^[0-9a-fA-F]{6}$/.test(e.color.replace("#", "")) && !isNaN(color)) container.accent_color = color;
    return container;
}

function buildContainerComponents(content: string, embeds: EmbedDraft[], buttons: MessageButton[], attachments: AttachmentRef[]) {
    const top: any[] = [];
    if (content.trim()) top.push(...textWithLines(content));

    const cards = embeds.filter(e => !isEmbedEmpty(e));

    if (!cards.length) {
        // Nothing to put a card around — files/buttons go on the message itself.
        pushAttachmentsAndButtons(top, attachments, buttons);
        return top;
    }

    // Files and "inside" buttons go into the LAST card; "below" buttons get
    // their own row under it, outside the card.
    const inside = buttons.filter(b => placementOf(b) === "inside");
    const below = buttons.filter(b => placementOf(b) === "below");
    const extras = (c: any[]) => pushAttachmentsAndButtons(c, attachments, inside);
    cards.forEach((e, i) => top.push(embedToContainer(e, i === cards.length - 1 ? extras : null)));

    const belowRow = buttonsToComponents(below);
    if (belowRow) top.push(...belowRow);
    return top;
}

// Best-effort reverse of the above, for Components V2 messages that weren't
// sent by this plugin (or were sent before sentDraftsJson existed).
function containersToEmbeds(components: any[]): { content: string; embeds: EmbedDraft[]; buttons: MessageButton[]; } {
    let content = "";
    const embeds: EmbedDraft[] = [];
    const buttons: MessageButton[] = [];

    const collectButtons = (row: any, placement: ButtonPlacement) => {
        for (const b of row.components || []) {
            const btn = buttonFromApi(b, placement);
            if (btn) buttons.push(btn);
        }
    };
    const unlink = (s: string) => {
        const m = s.match(/^\[(.*)\]\((.*)\)$/);
        return m ? { label: m[1], url: m[2] } : { label: s, url: "" };
    };

    for (const comp of components || []) {
        if (comp.type === C.TEXT && !embeds.length) { content += (content ? "\n" : "") + comp.content; continue; }
        if (comp.type === C.SEPARATOR && !embeds.length && content) { content += `\n${LINE_MARK}`; continue; }
        if (comp.type === C.ACTION_ROW) { collectButtons(comp, "below"); continue; }
        if (comp.type !== C.CONTAINER) continue;

        const e = blankEmbed();
        if (comp.accent_color != null) e.color = comp.accent_color.toString(16).padStart(6, "0");
        const texts: string[] = [];
        for (const child of comp.components || []) {
            if (child.type === C.TEXT) texts.push(child.content);
            else if (child.type === C.SEPARATOR && child.divider !== false) texts.push(LINE_MARK);
            else if (child.type === C.SECTION) {
                (child.components || []).forEach((t: any) => t.type === C.TEXT && texts.push(t.content));
                if (child.accessory?.type === C.THUMBNAIL) e.thumbnailUrl = child.accessory.media?.url || "";
            } else if (child.type === C.MEDIA_GALLERY && !e.imageUrl) {
                const url = child.items?.[0]?.media?.url || "";
                // Gallery items that are the message's own attachments are
                // handled as kept files, not as the embed image.
                if (url && !/\/attachments\//.test(url)) e.imageUrl = url;
            } else if (child.type === C.ACTION_ROW) collectButtons(child, "inside");
        }

        const body: string[] = [];
        texts.forEach((t, i) => {
            if (t.startsWith("## ") && !e.title) {
                const { label, url } = unlink(t.slice(3));
                e.title = label; e.url = url;
            } else if (t.startsWith("-# ") && !e.title && !e.authorName && i === 0) {
                const { label, url } = unlink(t.slice(3));
                e.authorName = label; e.authorUrl = url;
            } else if (t.startsWith("-# ") && i === texts.length - 1) {
                e.footerText = t.slice(3);
            } else {
                body.push(t);
            }
        });
        // The line Sonata puts between the title and the text isn't part of the text.
        while (body[0] === LINE_MARK) body.shift();
        while (body.at(-1) === LINE_MARK) body.pop();
        e.description = body.reduce((acc, t, i) => i === 0 ? t : acc + (t === LINE_MARK || body[i - 1] === LINE_MARK ? "\n" : "\n\n") + t, "");
        embeds.push(e);
    }

    return { content, embeds, buttons };
}

function extractMessageId(link: string): string | null {
    const match = link.trim().match(/(\d+)\/?$/);
    return match ? match[1] : null;
}

// Files are kept as component state only (see EmbedEditorPanel) rather than in
// the persisted Draft — base64 attachment bytes would bloat draftJson fast,
// and unlike embeds/buttons there's nothing sensible to "resume" for a picked
// file after the editor's closed anyway.
interface PendingFile {
    name: string;
    contentType: string;
    /** base64, no "data:" prefix — same shape native.ts's sendWebhook expects */
    dataBase64: string;
    size: number;
    /** Object URL for image previews; revoked when the file is removed. */
    previewUrl?: string;
}

/** An attachment that's already on a loaded Components V2 message. */
interface KeptFile {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    url: string;
}

function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            const comma = result.indexOf(",");
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

// The editor renders inside Vencord's plugin settings modal. It used to
// force that modal wider with !important overrides, but Discord positions
// the dialog assuming its normal width, so the wider box ended up shifted
// off-center. Now the modal keeps its own size and the panel adapts to it
// with a container query: side by side when there's room, otherwise the
// preview pins to the top (sticky, capped height) while the form scrolls
// underneath — so the live preview stays visible either way.
const editorCss = `
.vc-embedsender-fill { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.vc-embedsender-fill .vc-tool-link { align-self: flex-start; }
.vc-embedsender-fill .vc-tool-chip { padding: 2px 9px; font-size: 12px; font-family: var(--font-code, monospace); }
.vc-embedsender-hooks { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.vc-embedsender-hook { display: inline-flex; align-items: center; gap: 2px; padding: 0 4px 0 10px; }
.vc-embedsender-hook button { all: unset; cursor: pointer; padding: 4px 0; font-size: 12.5px; }
.vc-embedsender-hook .vc-embedsender-hook-x { padding: 2px 5px; border-radius: 99px; font-size: 10px; opacity: 0.5; }
.vc-embedsender-hook .vc-embedsender-hook-x:hover { opacity: 1; background: hsl(0 0% 100% / 0.1); }
.vc-embedsender-hook-name { display: flex; gap: 6px; flex: 1; min-width: 260px; }
.vc-embedsender-hook-name .vc-tool-input { flex: 1; padding: 6px 10px; }
.vc-embedsender-palette { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.vc-embedsender-palette-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.vc-embedsender-palette-row .vc-tool-hint { min-width: 70px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-embedsender-swatch { all: unset; width: 20px; height: 20px; border-radius: 6px; cursor: pointer; box-shadow: inset 0 0 0 1px hsl(0 0% 100% / 0.15); }
.vc-embedsender-swatch:hover { transform: scale(1.15); }
.vc-embedsender-sched { display: flex; flex-direction: column; gap: 8px; }
.vc-embedsender-sched-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.vc-embedsender-sched-row .vc-tool-input { width: auto; flex: 1; min-width: 190px; }
.vc-embedsender-sched-icon { font-size: 18px; }
.vc-embedsender-tpl { display: flex; flex-direction: column; gap: 8px; }
.vc-embedsender-tpl-save { display: flex; gap: 8px; }
.vc-embedsender-tpl-save .vc-tool-input { flex: 1; min-width: 0; }
.vc-embedsender-tpl-list { max-height: 260px; }
.vc-embedsender-tpl-list .vc-tool-item { padding: 6px 8px; }
.vc-embedsender-tpl-list .vc-tool-btn { padding: 6px 12px; }
.vc-embedsender-tpl-dot { flex: none; width: 10px; height: 34px; border-radius: 4px; }
.vc-embedsender-tpl-starters { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.vc-embedsender-tpl-starters .vc-tool-chip { padding: 3px 10px; font-size: 12.5px; }
.vc-embedsender-tpl-undo { display: flex; align-items: center; gap: 10px; padding: 7px 8px 7px 12px; border-radius: 10px; background: hsl(from var(--tl-accent) h s l / 0.14); border: 1px solid hsl(from var(--tl-accent) h s l / 0.35); font-size: 13px; }
.vc-embedsender-tpl-undo span { flex: 1; }
.vc-embedsender-title { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.vc-embedsender-title b { font-size: 20px; color: var(--text-default, #fff); }
.vc-embedsender-title span { font-size: 13px; color: var(--text-muted); }
.vc-embedsender-panel .vc-tool-input { font-size: 14px; }
.vc-embedsender-modal {
    width: min(1560px, 96vw) !important;
    max-width: min(1560px, 96vw) !important;
    max-height: 94vh !important;
}
.vc-embedsender-panel {
    container-type: inline-size;
    color: #fff;
    box-sizing: border-box;
    min-width: 0;
}
.vc-embedsender-panel *, .vc-embedsender-panel *::before, .vc-embedsender-panel *::after { box-sizing: border-box; }

/* ── Two columns that each scroll on their own ── */
.vc-es2 {
    --es2-surface: rgb(255 255 255 / 0.028);
    --es2-surface-2: rgb(255 255 255 / 0.05);
    --es2-line: rgb(255 255 255 / 0.07);
    --es2-muted: var(--text-muted, #949ba4);
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(360px, 0.82fr);
    gap: 20px;
    height: min(78vh, 980px);
    min-height: 420px;
}
.vc-embedsender-modal .vc-es2 { height: calc(94vh - 170px); }
.vc-es2-form, .vc-es2-preview { min-width: 0; min-height: 0; display: flex; flex-direction: column; }

/* Tabs */
.vc-es2-tabs { flex: none; display: flex; gap: 2px; padding: 4px; margin-bottom: 14px; border-radius: 12px; background: var(--es2-surface); border: 1px solid var(--es2-line); overflow-x: auto; scrollbar-width: none; }
.vc-es2-tab { all: unset; cursor: pointer; flex: 1 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; border-radius: 9px; font-size: 13px; font-weight: 600; white-space: nowrap; color: var(--es2-muted); transition: background 0.12s, color 0.12s; }
.vc-es2-tab:hover { color: #fff; background: var(--es2-surface-2); }
.vc-es2-tab-on, .vc-es2-tab-on:hover { color: #fff; background: rgb(255 255 255 / 0.09); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.06); }
.vc-es2-tab:focus-visible { outline: 2px solid var(--vc-tool-accent, #5865f2); }
.vc-es2-tab-n { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 99px; display: grid; place-items: center; font-size: 11px; background: var(--vc-tool-accent, #5865f2); color: #fff; }

.vc-es2-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 14px; padding: 0 8px 24px 0; }

/* Cards */
.vc-es2-card { flex: none; border-radius: 14px; background: var(--es2-surface); border: 1px solid var(--es2-line); }
.vc-es2-card-head { display: flex; align-items: baseline; gap: 10px; width: 100%; padding: 14px 18px 0; }
.vc-es2-card-head b { font-size: 14px; font-weight: 700; color: #fff; }
.vc-es2-card-head span { font-size: 12.5px; color: var(--es2-muted); }
.vc-es2-card-head-fold { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; width: 100%; padding: 14px 18px; border-radius: 14px; }
.vc-es2-card-head-fold:hover { background: rgb(255 255 255 / 0.02); }
.vc-es2-card-head-fold + .vc-es2-card-body { padding-top: 0; }
.vc-es2-card-body { display: flex; flex-direction: column; gap: 12px; padding: 12px 18px 18px; min-width: 0; }

/* Rows and fields */
.vc-es2-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.vc-es2-grow { flex: 1 1 0; min-width: 0; }
.vc-es2-grow2 { flex: 2 1 0; min-width: 0; }
.vc-es2-split { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; min-width: 0; }
.vc-es2-split-wide { grid-template-columns: minmax(0, 1.4fr) minmax(220px, 1fr); }
.vc-es2-sub { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.vc-es2-label { font-size: 12px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: var(--es2-muted); }
.vc-es2-label i { font-style: normal; font-weight: 500; text-transform: none; letter-spacing: 0; opacity: 0.7; margin-left: 4px; }
.vc-es2-fieldwrap { min-width: 0; }
.vc-es2 .vc-tool-input { width: 100%; min-width: 0; }
.vc-es2-text { display: block; resize: vertical; line-height: 1.45; font-size: 14px; overflow-y: auto; }
.vc-es2-title-input { font-size: 15px !important; font-weight: 600; }
.vc-es2-mono { font-family: var(--font-code, monospace); text-transform: uppercase; }
.vc-es2-select { flex: 0 0 100px; width: 100px !important; }
.vc-es2-swatch { flex: none; width: 38px; height: 38px; padding: 0; border: 0; border-radius: 10px; background: none; cursor: pointer; }
.vc-es2-swatch::-webkit-color-swatch-wrapper { padding: 0; }
.vc-es2-swatch::-webkit-color-swatch { border: 1px solid rgb(255 255 255 / 0.15); border-radius: 10px; }
.vc-es2-btn-on { background: rgb(255 255 255 / 0.12) !important; }
.vc-es2-colours { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 10px; background: rgb(0 0 0 / 0.18); }
.vc-es2-inserts { display: flex; flex-direction: column; gap: 4px; }
.vc-es2-inserts .vc-embedsender-fill, .vc-es2-inserts .vc-es-chips { margin-top: 4px; }
.vc-es2-note { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 12px; border-radius: 10px; font-size: 13px; background: hsl(40 90% 55% / 0.1); color: #f0c35a; }
.vc-es2-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; white-space: nowrap; color: var(--es2-muted); cursor: pointer; }

/* Embeds */
.vc-es2-embed { flex: none; border-radius: 14px; background: var(--es2-surface); border: 1px solid var(--es2-line); border-left: 4px solid var(--es2-embed); }
.vc-es2-embed-head { display: flex; align-items: center; gap: 2px; padding: 8px 10px 8px 6px; }
.vc-es2-embed-toggle { all: unset; cursor: pointer; flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 9px; }
.vc-es2-embed-toggle:hover { background: rgb(255 255 255 / 0.03); }
.vc-es2-embed-toggle b { flex: none; font-size: 14px; color: #fff; }
.vc-es2-embed-toggle span { overflow: hidden; font-size: 13px; color: var(--es2-muted); text-overflow: ellipsis; white-space: nowrap; }
.vc-es2-dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--es2-embed); box-shadow: 0 0 10px var(--es2-embed); }
.vc-es2-embed-body { display: flex; flex-direction: column; gap: 14px; padding: 4px 18px 18px; min-width: 0; }

/* Optional parts of an embed */
.vc-es2-fold { border-radius: 10px; border: 1px solid var(--es2-line); }
.vc-es2-fold-open { background: rgb(0 0 0 / 0.12); }
.vc-es2-fold-head { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border-radius: 10px; }
.vc-es2-fold-head:hover { background: rgb(255 255 255 / 0.03); }
.vc-es2-fold-head b { font-size: 13px; font-weight: 600; color: #fff; }
.vc-es2-fold-head span { margin-left: auto; overflow: hidden; max-width: 60%; font-size: 12.5px; color: var(--es2-muted); text-overflow: ellipsis; white-space: nowrap; }
.vc-es2-fold-body { display: flex; flex-direction: column; gap: 12px; padding: 2px 12px 14px; min-width: 0; }
.vc-es2-field-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) auto auto; align-items: center; gap: 8px; }

/* Buttons and files */
.vc-es2-button { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 10px; background: rgb(0 0 0 / 0.12); }
.vc-es2-file { display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 12px; border-radius: 10px; background: rgb(0 0 0 / 0.12); font-size: 13px; }
.vc-es2-file > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-es2-file small { flex: none; color: var(--es2-muted); }

.vc-es2-add { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px dashed rgb(255 255 255 / 0.16); font-size: 13px; font-weight: 600; color: var(--es2-muted); transition: border-color 0.12s, color 0.12s, background 0.12s; }
.vc-es2-add:hover { color: #fff; border-color: var(--vc-tool-accent, #5865f2); background: rgb(255 255 255 / 0.02); }
.vc-es2-add:disabled { opacity: 0.4; cursor: not-allowed; }
.vc-es2-add-big { flex: none; padding: 14px; border-radius: 14px; }

/* Builders */
.vc-es2-builder-pick { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.vc-es2-builder-opt { all: unset; cursor: pointer; display: flex; flex-direction: column; gap: 4px; padding: 16px; border-radius: 12px; background: rgb(0 0 0 / 0.15); border: 1px solid var(--es2-line); transition: border-color 0.12s; }
.vc-es2-builder-opt:hover { border-color: var(--vc-tool-accent, #5865f2); }
.vc-es2-builder-opt span { font-size: 24px; }
.vc-es2-builder-opt b { font-size: 14px; color: #fff; }
.vc-es2-builder-opt small { font-size: 12.5px; color: var(--es2-muted); }

/* Preview */
.vc-es2-preview { border-radius: 16px; overflow: hidden; background: #313338; border: 1px solid rgb(255 255 255 / 0.08); }
.vc-es2-preview-head { flex: none; display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 12px 18px; background: #2b2d31; border-bottom: 1px solid rgb(0 0 0 / 0.25); }
.vc-es2-preview-head span { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--es2-muted); }
.vc-es2-preview-head small { font-size: 12px; color: var(--es2-muted); opacity: 0.8; }
.vc-es2-preview-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 18px 24px; }

.vc-es2-avatar { position: relative; display: flex; align-items: center; gap: 16px; padding: 14px; border-radius: 12px; border: 1px dashed rgb(255 255 255 / 0.14); background: rgb(0 0 0 / 0.14); transition: border-color 0.12s, background 0.12s; }
.vc-es2-avatar-over { border-color: var(--vc-tool-accent, #5865f2); background: color-mix(in srgb, var(--vc-tool-accent, #5865f2) 10%, transparent); }
.vc-es2-avatar-pic { all: unset; position: relative; flex: none; width: 72px; height: 72px; border-radius: 50%; overflow: hidden; cursor: pointer; box-shadow: 0 0 0 2px rgb(255 255 255 / 0.08); }
.vc-es2-avatar-pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
.vc-es2-avatar-pic span { position: absolute; inset: 0; display: grid; place-items: center; font-size: 11.5px; font-weight: 700; color: #fff; background: rgb(0 0 0 / 0.55); opacity: 0; transition: opacity 0.12s; }
.vc-es2-avatar-pic:hover span, .vc-es2-avatar-pic:focus-visible span { opacity: 1; }
.vc-es2-avatar-pic:focus-visible { box-shadow: 0 0 0 2px var(--vc-tool-accent, #5865f2); }
.vc-es2-avatar-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.vc-es2-avatar-main b { font-size: 14px; color: #fff; }
.vc-es2-avatar-main .vc-tool-link { all: unset; cursor: pointer; color: var(--text-link, #00a8fc); }
.vc-es2-avatar-main .vc-tool-link:hover { text-decoration: underline; }
.vc-es2-avatar-drop { position: absolute; inset: 0; display: grid; place-items: center; border-radius: 12px; font-size: 14px; font-weight: 700; color: #fff; background: rgb(0 0 0 / 0.55); pointer-events: none; }
.vc-es2-input-bad { border-color: #f23f43 !important; }
.vc-es2-bad { color: #f57376 !important; }

.vc-es2-pic { position: relative; display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px; border-radius: 12px; border: 1px dashed rgb(255 255 255 / 0.12); transition: border-color 0.12s, background 0.12s; }
.vc-es2-pic-over { border-color: var(--vc-tool-accent, #5865f2); background: color-mix(in srgb, var(--vc-tool-accent, #5865f2) 10%, transparent); }
.vc-es2-pic-thumb { all: unset; flex: none; width: 40px; height: 40px; border-radius: 8px; overflow: hidden; cursor: pointer; display: grid; place-items: center; background: rgb(0 0 0 / 0.25); font-size: 18px; }
.vc-es2-pic-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.vc-es2-pic-thumb:focus-visible { outline: 2px solid var(--vc-tool-accent, #5865f2); }
.vc-es2-pic-file { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; padding: 0 6px; font-size: 13.5px; color: #fff; }
.vc-es2-pic-file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-es2-pic-file small { flex: none; font-size: 12px; color: var(--text-muted, #949ba4); }
.vc-es2-file-tag { padding: 1px 7px; border-radius: 99px; background: color-mix(in srgb, var(--vc-tool-accent, #5865f2) 22%, transparent); color: #fff !important; }

.vc-es2-rich { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.vc-es2-fmt { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 4px; border-radius: 10px; background: rgb(0 0 0 / 0.18); }
.vc-es2-fmt-btn { all: unset; cursor: pointer; min-width: 28px; height: 28px; padding: 0 6px; box-sizing: border-box; display: grid; place-items: center; border-radius: 7px; font-size: 13px; font-weight: 600; color: var(--text-muted, #b5bac1); transition: background 0.1s, color 0.1s; }
.vc-es2-fmt-btn:hover { background: rgb(255 255 255 / 0.08); color: #fff; }
.vc-es2-fmt-btn:focus-visible { outline: 2px solid var(--vc-tool-accent, #5865f2); }
.vc-es2-fmt-b { font-weight: 900; }
.vc-es2-fmt-i { font-style: italic; font-family: Georgia, serif; }
.vc-es2-fmt-u { text-decoration: underline; }
.vc-es2-fmt-s { text-decoration: line-through; }
.vc-es2-fmt-gap { width: 1px; height: 18px; margin: 0 4px; background: rgb(255 255 255 / 0.12); }
.vc-es2-insert-tabs { display: flex; flex-wrap: wrap; gap: 4px; }
.vc-es2-insert-tab { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 99px; font-size: 12.5px; font-weight: 600; color: var(--text-muted, #b5bac1); background: rgb(255 255 255 / 0.04); border: 1px solid rgb(255 255 255 / 0.07); transition: background 0.1s, color 0.1s, border-color 0.1s; }
.vc-es2-insert-tab:hover { color: #fff; border-color: rgb(255 255 255 / 0.18); }
.vc-es2-insert-tab-on, .vc-es2-insert-tab-on:hover { color: #fff; background: color-mix(in srgb, var(--vc-tool-accent, #5865f2) 30%, transparent); border-color: var(--vc-tool-accent, #5865f2); }
.vc-es2-insert-panel { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 10px; background: rgb(0 0 0 / 0.2); border: 1px solid rgb(255 255 255 / 0.06); }
.vc-es2-insert-search { padding: 7px 10px !important; }
.vc-es2-insert-list { display: flex; flex-direction: column; gap: 10px; max-height: 240px; overflow-y: auto; padding-right: 4px; }
.vc-es2-insert-list.vc-es2-insert-chips { flex-direction: row; flex-wrap: wrap; gap: 6px; align-content: flex-start; }
.vc-es2-insert-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.vc-es2-insert-group { display: flex; flex-direction: column; gap: 6px; }
.vc-es2-insert-group > b { font-size: 11px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; color: var(--text-muted, #949ba4); }
.vc-es2-insert-date { width: auto !important; color-scheme: dark; }
.vc-es2-role, .vc-es2-chan, .vc-es2-person { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 99px; font-size: 13px; font-weight: 500; color: #fff; background: rgb(255 255 255 / 0.05); border: 1px solid rgb(255 255 255 / 0.08); transition: border-color 0.1s, background 0.1s; }
.vc-es2-role:hover, .vc-es2-chan:hover, .vc-es2-person:hover { border-color: var(--vc-tool-accent, #5865f2); background: rgb(255 255 255 / 0.08); }
.vc-es2-role { color: var(--es2-role, #fff); }
.vc-es2-role i { width: 10px; height: 10px; border-radius: 50%; background: var(--es2-role, #99aab5); }
.vc-es2-person img { width: 18px; height: 18px; border-radius: 50%; }
.vc-es2-time-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px; }
.vc-es2-time { all: unset; cursor: pointer; display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 9px; background: rgb(255 255 255 / 0.04); border: 1px solid rgb(255 255 255 / 0.07); }
.vc-es2-time:hover { border-color: var(--vc-tool-accent, #5865f2); }
.vc-es2-time b { font-size: 13px; font-weight: 600; color: #fff; }
.vc-es2-time span { font-size: 11.5px; color: var(--text-muted, #949ba4); }
.vc-es2-emoji-grid { display: grid; grid-template-columns: repeat(auto-fill, 36px); gap: 4px; }
.vc-es2-emoji { all: unset; cursor: pointer; width: 36px; height: 36px; display: grid; place-items: center; border-radius: 8px; }
.vc-es2-emoji:hover { background: rgb(255 255 255 / 0.1); }
.vc-es2-emoji img { width: 26px; height: 26px; object-fit: contain; }
.vc-es2-btn-emoji { all: unset; cursor: pointer; flex: none; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 9px; background: rgb(255 255 255 / 0.05); border: 1px solid rgb(255 255 255 / 0.08); }
.vc-es2-btn-emoji:hover, .vc-es2-btn-emoji-on { border-color: var(--vc-tool-accent, #5865f2); }
.vc-es2-btn-emoji-empty { font-size: 17px; opacity: 0.5; }

.vc-es2-fmt-on { background: color-mix(in srgb, var(--vc-tool-accent, #5865f2) 30%, transparent) !important; color: #fff !important; }
.vc-es2-bullets { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 6px 8px; border-radius: 10px; background: rgb(0 0 0 / 0.18); }
.vc-es2-bullet { all: unset; cursor: pointer; padding: 3px 9px; border-radius: 7px; font-size: 13.5px; color: #fff; background: rgb(255 255 255 / 0.05); border: 1px solid rgb(255 255 255 / 0.08); }
.vc-es2-bullet:hover { border-color: var(--vc-tool-accent, #5865f2); }

.vc-es-hub-row { display: grid; grid-template-columns: 52px minmax(0, 1fr) minmax(0, 1.3fr) auto; gap: 6px; align-items: center; padding: 8px; border-radius: 10px; background: rgb(255 255 255 / 0.03); }
.vc-es-hub-emoji { text-align: center; padding-left: 4px !important; padding-right: 4px !important; }
.vc-es-hub-link, .vc-es-hub-note { grid-column: 2 / -1; }

.vc-es-test { position: relative; }
.vc-es-test-on { background: rgb(255 255 255 / 0.12) !important; }
.vc-es-test-pop { position: absolute; bottom: calc(100% + 8px); right: 0; z-index: 10; width: 340px; display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 14px; background: var(--background-floating, #111214); border: 1px solid rgb(255 255 255 / 0.08); box-shadow: 0 12px 36px rgb(0 0 0 / 0.5); }
.vc-es-test-pop > b { font-size: 14px; color: #fff; }
.vc-es-test-opt { all: unset; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: rgb(255 255 255 / 0.04); border: 1px solid rgb(255 255 255 / 0.06); }
.vc-es-test-opt:hover:not(:disabled) { border-color: var(--vc-tool-accent, #5865f2); }
.vc-es-test-opt:disabled { opacity: 0.45; cursor: default; }
.vc-es-test-opt > span { font-size: 20px; }
.vc-es-test-opt b { display: block; font-size: 13.5px; color: #fff; }
.vc-es-test-opt small { font-size: 12px; color: var(--text-muted, #949ba4); }
.vc-es-test-choose { display: flex; flex-direction: column; gap: 6px; }

.vc-embedsender-panel { position: relative; }
.vc-es-test-host { position: absolute; right: 0; bottom: 0; width: 0; height: 0; z-index: 20; }
.vc-es-test-host .vc-es-test-pop { bottom: 6px; right: 4px; }

.vc-es2-chars-tabs { display: flex; flex-wrap: wrap; gap: 4px; }
.vc-es2-chars-tab { all: unset; cursor: pointer; padding: 3px 9px; border-radius: 99px; font-size: 12px; font-weight: 600; color: var(--text-muted, #b5bac1); background: rgb(255 255 255 / 0.04); border: 1px solid rgb(255 255 255 / 0.07); }
.vc-es2-chars-tab:hover { color: #fff; }
.vc-es2-chars-tab-on, .vc-es2-chars-tab-on:hover { color: #fff; background: color-mix(in srgb, var(--vc-tool-accent, #5865f2) 30%, transparent); border-color: var(--vc-tool-accent, #5865f2); }
.vc-es2-chars-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(36px, 1fr)); gap: 4px; }
.vc-es2-char { all: unset; cursor: pointer; height: 36px; display: grid; place-items: center; border-radius: 8px; font-size: 19px; color: #fff; background: rgb(255 255 255 / 0.03); transition: background 0.1s, transform 0.1s; }
.vc-es2-char:hover { background: color-mix(in srgb, var(--vc-tool-accent, #5865f2) 28%, transparent); transform: translateY(-1px); }
.vc-es2-char-wide { grid-column: span 3; padding: 0 8px; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Narrow: preview on top, a fixed slice of the height */
@container (max-width: 860px) {
    .vc-es2 { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(160px, 38%) minmax(0, 1fr); }
    .vc-es2-preview { order: -1; }
}
.vc-embedsender-layout-toggle {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 8px;
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--tl-line);
}
.vc-embedsender-layout-option {
    all: unset;
    flex: 1;
    text-align: center;
    cursor: pointer;
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    color: rgba(255,255,255,0.6);
    transition: background 0.15s ease, color 0.15s ease;
}
.vc-embedsender-layout-option:hover {
    color: #fff;
    background: rgba(255,255,255,0.05);
}
.vc-embedsender-layout-option-active,
.vc-embedsender-layout-option-active:hover {
    color: #fff;
    background: var(--brand-500, #5865f2);
}
.vc-embedsender-layout-option[aria-disabled="true"] {
    cursor: not-allowed;
    opacity: 0.5;
}
.vc-embedsender-placement {
    display: flex;
    flex-shrink: 0;
    padding: 2px;
    border-radius: 7px;
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--tl-line);
}
.vc-embedsender-placement-opt {
    all: unset;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 5px;
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
    color: rgba(255,255,255,0.55);
    transition: background 0.12s, color 0.12s;
}
.vc-embedsender-placement-opt:hover {
    color: #fff;
}
.vc-embedsender-placement-opt-active,
.vc-embedsender-placement-opt-active:hover {
    color: #fff;
    background: var(--brand-500, #5865f2);
}
.vc-embedsender-placement-opt:focus-visible {
    outline: 2px solid var(--brand-500, #5865f2);
    outline-offset: 1px;
}
.vc-embedsender-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--tl-line);
}
.vc-embedsender-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.18) transparent;
}
.vc-embedsender-scroll::-webkit-scrollbar {
    width: 6px;
}
.vc-embedsender-scroll::-webkit-scrollbar-track {
    background: transparent;
}
.vc-embedsender-scroll::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.18);
    border-radius: 999px;
}
.vc-embedsender-scroll::-webkit-scrollbar-thumb:hover {
    background: rgba(255,255,255,0.32);
}
@keyframes vc-embedsender-toast-in {
    from { opacity: 0; transform: translate(-50%, -16px); }
    to { opacity: 1; transform: translate(-50%, 0); }
}
.vc-es-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 6px; }
.vc-es-chips-label { font-size: 11.5px; color: var(--text-muted); margin-right: 2px; }
.vc-es-chip { all: unset; cursor: pointer; padding: 2px 8px; border-radius: 99px; border: 1px solid rgba(255,255,255,0.12); font-size: 11.5px; color: var(--text-default, #dbdee1); }
.vc-es-chip:hover { border-color: var(--vc-tool-accent, #5865f2); }
.vc-es-chip:disabled { opacity: 0.5; cursor: default; }
.vc-es-chip-line { display: inline-flex; align-items: center; gap: 6px; }
.vc-es-chip-line i { width: 18px; height: 1px; background: rgb(255 255 255 / 0.45); }
.vc-es-builder { display: flex; flex-direction: column; gap: 8px; }
.vc-es-builder-head, .vc-es-builder-foot { display: flex; align-items: center; gap: 8px; }
.vc-es-game { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 12px; background: rgb(0 0 0 / 0.2); }
.vc-es-game img { width: 56px; height: 56px; border-radius: 12px; object-fit: cover; flex: none; }
.vc-es-game div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.vc-es-game b { font-size: 15px; color: #fff; }
.vc-es-game span { font-size: 12.5px; color: var(--text-muted); }
.vc-es-builder-head b { font-size: 14px; }
.vc-es-builder-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: center; }
.vc-es-banner-canvas { width: 100%; height: auto; border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,0.35); }
.vc-es-color { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-muted); }
.vc-es-color input { width: 36px; height: 28px; padding: 0; border: 0; background: none; cursor: pointer; }
.vc-es-rules-preview { margin: 0; max-height: 200px; overflow: auto; padding: 10px 12px; border-radius: 8px; background: rgba(0,0,0,0.25); font: 12.5px/1.5 var(--font-primary, sans-serif); white-space: pre-wrap; color: var(--text-default, #dbdee1); }
.vc-es-history { display: flex; flex-direction: column; gap: 6px; }
.vc-es-history-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; background: rgba(255,255,255,0.03); }
.vc-es-history-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.vc-es-history-main b { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.vc-es-history-main span { font-size: 11.5px; color: var(--text-muted); }
.vc-es-history-row .vc-tool-btn { text-decoration: none; }
.vc-es-private { display: flex; flex-direction: column; gap: 10px; }
.vc-es-private-status { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 10px; font-size: 13px; }
.vc-es-ok { background: hsl(145 60% 45% / 0.12); color: #3ddc84; }
.vc-es-warn { background: hsl(40 90% 55% / 0.1); color: #f0b232; }
.vc-es-steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.vc-es-step { display: flex; gap: 10px; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.03); font-size: 13px; line-height: 1.5; color: var(--text-default, #dbdee1); }
.vc-es-step-body > b { display: block; margin-bottom: 2px; }
.vc-es-step code { padding: 0 5px; border-radius: 4px; background: rgba(0,0,0,0.35); font-size: 12px; }
.vc-es-step a { color: var(--text-link, #00a8fc); }
.vc-es-step-n { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--vc-tool-accent, #5865f2); color: #fff; font-size: 12px; font-weight: 800; }
.vc-es-step-done .vc-es-step-n { background: #248046; }
.vc-es-step-body { flex: 1; min-width: 0; }
.vc-es-step-actions { margin-top: 6px; display: flex; gap: 6px; }
.vc-es-private-fields { display: flex; flex-direction: column; gap: 8px; }
.vc-es-private-note { font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.vc-es-private-note code { padding: 0 4px; border-radius: 4px; background: rgba(0,0,0,0.3); }

`;

function formatApiError(body: any, status?: number): string {
    if (body && typeof body === "object" && body.message) {
        const firstErrorKey = body.errors ? Object.keys(body.errors)[0] : null;
        return firstErrorKey ? `${body.message} (${firstErrorKey})` : body.message;
    }
    if (typeof body === "string" && body) return body;
    return status ? `HTTP ${status}` : "Unknown error";
}

// Accepts whatever the user pastes — with or without a version segment,
// on discord.com/canary/ptb — just enough to sanity-check it before we
// hand the full URL off to the native side.
function looksLikeWebhookUrl(url: string): boolean {
    return /\/webhooks\/\d+\/[^/?#\s]+/.test(url.trim());
}

type ToastState = { type: "success" | "error"; message: string } | null;

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
    if (!toast) return null;
    const isSuccess = toast.type === "success";
    return ReactDOM.createPortal(
        <div
            style={{
                position: "fixed",
                top: 20,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 99999,
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 16px",
                borderRadius: 8,
                background: isSuccess ? "#248046" : "#7c2b31",
                border: `1px solid ${isSuccess ? "#2d9d57" : "#a13440"}`,
                color: "#fff",
                fontSize: 14,
                fontWeight: 500,
                maxWidth: "min(520px, 90vw)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                animation: "vc-embedsender-toast-in 0.2s ease",
            }}
        >
            <span style={{ flexShrink: 0 }}>{isSuccess ? "✅" : "⚠️"}</span>
            <span style={{ flex: 1, wordBreak: "break-word" }}>{toast.message}</span>
            <button
                type="button"
                onClick={onClose}
                title="Dismiss"
                style={{
                    background: "transparent", border: "none", color: "rgba(255,255,255,0.8)",
                    cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0,
                }}
            >×</button>
        </div>,
        document.body,
    );
}

function Field({ label, children, style, counter, hint }: {
    label: string; children: React.ReactNode; style?: React.CSSProperties;
    counter?: { value: string; max: number }; hint?: string;
}) {
    return (
        <div className="vc-es2-fieldwrap" style={style}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                <span className="vc-tool-label">{label}</span>
                {counter && <span className="vc-tool-hint">{counter.value.length}/{counter.max}</span>}
            </div>
            {children}
            {hint && (
                <div className="vc-tool-hint" style={{ marginTop: 6 }}>{hint}</div>
            )}
        </div>
    );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
    return (
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" style={{
            transition: "transform 0.15s ease", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", flexShrink: 0,
        }}>
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function DuplicateIcon() {
    return (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M4 16V6a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    );
}

function LinkIcon() {
    return (
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none">
            <path d="M10 14a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.5 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 10a5 5 0 0 0-7.07 0L4.1 12.83a5 5 0 0 0 7.07 7.07l1.5-1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function PaperclipIcon() {
    return (
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none">
            <path d="M17.5 8.5 9.3 16.7a3 3 0 1 1-4.24-4.24l8.49-8.49a5 5 0 0 1 7.07 7.07l-8.49 8.49a2 2 0 0 1-2.83-2.83l7.07-7.07" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function IconButton({ onClick, title, children, danger }: {
    onClick: () => void; title?: string; children: React.ReactNode; danger?: boolean;
}) {
    const base: React.CSSProperties = {
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent",
        color: danger ? "#f23f42" : "#fff", opacity: 0.65, cursor: "pointer", padding: 0,
        transition: "opacity 0.1s ease, background 0.1s ease",
    };
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            style={base}
            onMouseEnter={e => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            }}
            onMouseLeave={e => {
                e.currentTarget.style.opacity = "0.65";
                e.currentTarget.style.background = "transparent";
            }}
        >
            {children}
        </button>
    );
}

/** A group in the editor; folds away when given onToggle. */
function Card({ title, hint, folded, onToggle, children }: {
    title: string; hint?: string; folded?: boolean; onToggle?(): void; children: React.ReactNode;
}) {
    return (
        <section className="vc-es2-card">
            {onToggle ? (
                <button type="button" className="vc-es2-card-head vc-es2-card-head-fold" onClick={onToggle} aria-expanded={!folded}>
                    <ChevronIcon collapsed={!!folded} /><b>{title}</b>{hint && <span>{hint}</span>}
                </button>
            ) : (
                <div className="vc-es2-card-head"><b>{title}</b>{hint && <span>{hint}</span>}</div>
            )}
            {!folded && <div className="vc-es2-card-body">{children}</div>}
        </section>
    );
}

/** An optional part of an embed (author, fields…) — one tidy line until opened. */
function Fold({ title, summary, folded, onToggle, children }: {
    title: string; summary?: string; folded: boolean; onToggle(): void; children: React.ReactNode;
}) {
    return (
        <div className={"vc-es2-fold" + (folded ? "" : " vc-es2-fold-open")}>
            <button type="button" className="vc-es2-fold-head" onClick={onToggle} aria-expanded={!folded}>
                <ChevronIcon collapsed={folded} /><b>{title}</b>{folded && summary && <span>{summary}</span>}
            </button>
            {!folded && <div className="vc-es2-fold-body">{children}</div>}
        </div>
    );
}

/** A text box that grows with what's in it (up to a point, then it scrolls). */
function GrowText({ value, onChange, minRows = 3, maxLength, placeholder }: {
    value: string; onChange(v: string): void; minRows?: number; maxLength?: number; placeholder?: string;
}) {
    const ref = React.useRef<HTMLTextAreaElement>(null);
    React.useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight + 2, 560)}px`;
    }, [value]);
    return (
        <textarea ref={ref} className="vc-tool-input vc-es2-text" rows={minRows} maxLength={maxLength} placeholder={placeholder}
            value={value} onChange={e => onChange(e.target.value)} />
    );
}

const MarkupClasses = findCssClassesLazy("markup", "codeContainer");

/** The channel the message goes to, so the preview shows role, channel and people mentions properly. */
let previewChannelId: string | undefined;

/** Container text as Discord shows it, with a real line wherever it has a --- line. */
function mdLines(s: string): React.ReactNode {
    if (!s || !LINE_RE.test(s)) return md(s);
    return splitAtLines(s).map((p, i) => p === null ? <PreviewDivider key={i} /> : <React.Fragment key={i}>{md(p)}</React.Fragment>);
}

/** Text as Discord shows it — **bold**, # headings, -# small text, lists, links. */
function md(text: string): React.ReactNode {
    if (!text) return text;
    try {
        return <div className={MarkupClasses.markup}>{Parser.parse(text, true, { channelId: previewChannelId, allowLinks: true, allowHeading: true, allowList: true, allowEmojiLinks: true })}</div>;
    } catch {
        return text;
    }
}

function EmbedPreviewCard({ embed }: { embed: EmbedDraft }) {
    const colorHex = /^[0-9a-fA-F]{6}$/.test(embed.color) ? `#${embed.color}` : "#5865F2";
    const visibleFields = embed.fields.filter(f => f.name || f.value);
    const isEmpty =
        !embed.title && !embed.description && !embed.authorName && !embed.footerText &&
        !embed.imageUrl && !embed.thumbnailUrl && visibleFields.length === 0;

    if (isEmpty) return null;

    return (
        <div style={{ display: "flex", marginTop: 8, maxWidth: 432 }}>
            <div style={{ width: 4, flexShrink: 0, background: colorHex, borderRadius: "6px 0 0 6px" }} />
            <div style={{
                flex: 1,
                minWidth: 0,
                background: "#2b2d31",
                borderRadius: "0 6px 6px 0",
                padding: "8px 12px 12px 12px",
                color: "#fff",
                fontSize: 14,
                lineHeight: "1.375em",
            }}>
                <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        {embed.authorName && (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontWeight: 600 }}>
                                {embed.authorIcon && (
                                    <img src={embed.authorIcon} style={{ width: 24, height: 24, borderRadius: "50%" }} />
                                )}
                                <span>{embed.authorName}</span>
                            </div>
                        )}
                        {embed.title && (
                            <div style={{
                                fontWeight: 600, fontSize: 16, marginTop: 8,
                                color: embed.url ? "#00a8fc" : "#fff",
                            }}>
                                {embed.title}
                            </div>
                        )}
                        {embed.description && (
                            <div style={{ marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {md(embed.description)}
                            </div>
                        )}
                        {visibleFields.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                                {visibleFields.map((f, i) => (
                                    <div key={i} style={{
                                        flex: f.inline ? "1 1 30%" : "1 1 100%",
                                        minWidth: f.inline ? 90 : "100%",
                                    }}>
                                        <div style={{ fontWeight: 600 }}>{f.name || "\u200b"}</div>
                                        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{md(f.value) || "\u200b"}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {embed.imageUrl && (
                            <img src={embed.imageUrl} style={{ marginTop: 8, maxWidth: "100%", borderRadius: 4 }} />
                        )}
                        {embed.footerText && (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                                {embed.footerIcon && (
                                    <img src={embed.footerIcon} style={{ width: 20, height: 20, borderRadius: "50%" }} />
                                )}
                                <span>{embed.footerText}</span>
                            </div>
                        )}
                    </div>
                    {embed.thumbnailUrl && (
                        <img src={embed.thumbnailUrl} style={{
                            width: 80, height: 80, objectFit: "cover", borderRadius: 4, marginTop: 8, flexShrink: 0,
                        }} />
                    )}
                </div>
            </div>
        </div>
    );
}

interface PreviewAttachment {
    name: string;
    contentType: string;
    size: number;
    src?: string;
}

function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(2)} KB`;
}

function FileGlyph() {
    return (
        <svg width="28" height="36" viewBox="0 0 28 36" fill="none" style={{ flexShrink: 0 }}>
            <path d="M2 4a3 3 0 0 1 3-3h13l8 8v23a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V4z" fill="#c9cdfb" />
            <path d="M18 1v6a2 2 0 0 0 2 2h6" fill="#a4aaf5" />
        </svg>
    );
}

/** A button's emoji, as Discord shows it. */
function ButtonEmoji({ token, size = 18 }: { token?: string; size?: number; }) {
    const t = (token ?? "").trim();
    if (!t) return null;
    const m = /^<(a?):(\w+):(\d+)>$/.exec(t);
    return m ? <img src={emojiUrl(m[3], !!m[1])} alt={m[2]} style={{ width: size, height: size, objectFit: "contain" }} /> : <span style={{ fontSize: size - 2, lineHeight: 1 }}>{t}</span>;
}

function PreviewButtons({ buttons }: { buttons: MessageButton[]; }) {
    const visible = buttons.filter(b => b.label.trim());
    if (!visible.length) return null;
    return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {visible.map((b, i) => (
                <div key={i} title={b.kind === "private" ? `Shows only the presser: ${b.reply ?? ""}` : b.url} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: b.kind === "private" ? PRIVATE_STYLES.find(x => x.id === (b.style ?? 1))!.color : "#4e5058", borderRadius: 6, padding: "6px 12px",
                    fontSize: 14, fontWeight: 500, color: "#fff",
                }}>
                    <ButtonEmoji token={b.emoji} />{b.label || "\u200b"} {b.kind === "private" ? "🔒" : <LinkIcon />}
                </div>
            ))}
        </div>
    );
}

function PreviewAttachments({ attachments }: { attachments: PreviewAttachment[]; }) {
    const media = attachments.filter(a => isMediaType(a.contentType));
    const other = attachments.filter(a => !isMediaType(a.contentType));
    return (
        <>
            {media.length > 0 && (
                <div style={{
                    display: "grid", gap: 4, marginTop: 8,
                    gridTemplateColumns: media.length > 1 ? "1fr 1fr" : "1fr",
                }}>
                    {media.map((a, i) => a.src && a.contentType.startsWith("image/")
                        ? <img key={i} src={a.src} style={{ width: "100%", maxHeight: 260, objectFit: "cover", borderRadius: 8, display: "block" }} />
                        : (
                            <div key={i} style={{
                                display: "flex", alignItems: "center", justifyContent: "center", minHeight: 90,
                                borderRadius: 8, background: "rgba(0,0,0,0.3)", fontSize: 12, opacity: 0.8, padding: 8,
                                textAlign: "center", wordBreak: "break-all",
                            }}>
                                ▶ {a.name}
                            </div>
                        ))}
                </div>
            )}
            {other.map((a, i) => (
                <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 10, marginTop: 8,
                    border: "1px solid var(--tl-line)", borderRadius: 8,
                    background: "rgba(0,0,0,0.15)", padding: "12px 14px",
                }}>
                    <FileGlyph />
                    <div style={{ minWidth: 0 }}>
                        <div style={{ color: "#00a8fc", fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {a.name}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.55 }}>{formatSize(a.size)}</div>
                    </div>
                </div>
            ))}
        </>
    );
}

// Must stay a component, not a `const x = <div />` — top-level JSX runs when
// Vencord first loads the plugin, before Discord's React exists, and the
// resulting crash takes down every plugin (and Vencord itself) with it.
function PreviewDivider() {
    return <div style={{ height: 1, background: "var(--tl-line)", margin: "10px 0" }} />;
}

// Mirrors embedToContainer(): same pieces, same order.
function ContainerPreviewCard({ embed, attachments, buttons }: {
    embed: EmbedDraft; attachments: PreviewAttachment[] | null; buttons: MessageButton[] | null;
}) {
    const colorHex = /^[0-9a-fA-F]{6}$/.test(embed.color) ? `#${embed.color}` : "#5865F2";
    const fields = embed.fields.filter(f => f.name || f.value);
    const hasHeader = !!(embed.authorName || embed.title);
    const hasBody = !!embed.description || fields.length > 0;

    return (
        <div style={{
            marginTop: 8, maxWidth: 480, background: "#2b2d31",
            border: "1px solid rgba(255,255,255,0.06)", borderLeft: `4px solid ${colorHex}`,
            borderRadius: 8, padding: "14px 16px", fontSize: 14, lineHeight: "1.375em", color: "#fff",
        }}>
            {(hasHeader || embed.thumbnailUrl) && (
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        {embed.authorName && (
                            <div style={{ fontSize: 12, opacity: 0.65, color: embed.authorUrl ? "#00a8fc" : undefined }}>{embed.authorName}</div>
                        )}
                        {embed.title && (
                            <div style={{ fontSize: 20, fontWeight: 700, lineHeight: "1.3em", color: embed.url ? "#00a8fc" : "#fff" }}>
                                {embed.title}
                            </div>
                        )}
                        {!hasHeader && embed.description && !LINE_RE.test(embed.description) && (
                            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{md(embed.description)}</div>
                        )}
                    </div>
                    {embed.thumbnailUrl && (
                        <img src={embed.thumbnailUrl} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
                    )}
                </div>
            )}
            {hasHeader && hasBody && <PreviewDivider />}
            {embed.description && (hasHeader || !embed.thumbnailUrl || LINE_RE.test(embed.description)) && (
                <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{mdLines(embed.description)}</div>
            )}
            {fields.map((f, i) => (
                <div key={i} style={{ marginTop: embed.description || i > 0 ? 10 : 0 }}>
                    <div style={{ fontWeight: 700 }}>{f.name || "\u200b"}</div>
                    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{md(f.value) || "\u200b"}</div>
                </div>
            ))}
            {embed.imageUrl && (
                <img src={embed.imageUrl} style={{ marginTop: 8, maxWidth: "100%", borderRadius: 8, display: "block" }} />
            )}
            {attachments && attachments.length > 0 && (
                <>
                    <PreviewDivider />
                    <PreviewAttachments attachments={attachments} />
                </>
            )}
            {buttons && <PreviewButtons buttons={buttons} />}
            {embed.footerText && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>{embed.footerText}</div>
            )}
        </div>
    );
}

function MessagePreview({ content, username, avatarUrl, embeds, buttons, files, keptFiles, layout }: {
    content: string; username: string; avatarUrl: string; embeds: EmbedDraft[];
    buttons: MessageButton[]; files: PendingFile[]; keptFiles: KeptFile[]; layout: Layout;
}) {
    const visibleButtons = buttons.filter(b => b.label.trim());
    const cards = embeds.filter(e => !isEmbedEmpty(e));
    const attachments: PreviewAttachment[] = [
        ...keptFiles.map(k => ({ name: k.filename, contentType: k.contentType, size: k.size, src: k.url })),
        ...files.map(f => ({ name: f.name, contentType: f.contentType, size: f.size, src: f.previewUrl })),
    ];
    return (
        <div style={{ color: "#fff" }}>
            <div style={{ display: "flex", gap: 12 }}>
                <img
                    src={avatarUrl || "https://cdn.discordapp.com/embed/avatars/0.png"}
                    style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontWeight: 600, color: "#fff" }}>{username || "Webhook"}</span>
                        <span style={{
                            fontSize: 10, fontWeight: 600, background: "#5865F2",
                            borderRadius: 3, padding: "1px 4px", lineHeight: "13px",
                        }}>BOT</span>
                    </div>
                    {content && (
                        <div style={{ marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{layout === "container" ? mdLines(content) : md(content)}</div>
                    )}
                    {layout === "container" ? (
                        cards.length ? (
                            <>
                                {cards.map((e, i) => {
                                    const last = i === cards.length - 1;
                                    return (
                                        <ContainerPreviewCard key={i} embed={e}
                                            attachments={last ? attachments : null}
                                            buttons={last ? buttons.filter(b => placementOf(b) === "inside") : null} />
                                    );
                                })}
                                <PreviewButtons buttons={buttons.filter(b => placementOf(b) === "below")} />
                            </>
                        ) : (
                            <>
                                <PreviewAttachments attachments={attachments} />
                                <PreviewButtons buttons={buttons} />
                            </>
                        )
                    ) : embeds.map((e, i) => <EmbedPreviewCard key={i} embed={e} />)}
                    {layout === "classic" && visibleButtons.length > 0 && <PreviewButtons buttons={visibleButtons} />}
                    {layout === "classic" && files.length > 0 && (
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                            {files.map((f, i) => (
                                <div key={i} style={{
                                    display: "inline-flex", alignItems: "center", gap: 6, width: "fit-content",
                                    background: "rgba(255,255,255,0.06)", borderRadius: 6, padding: "6px 10px", fontSize: 12, opacity: 0.85,
                                }}>
                                    <PaperclipIcon /> {f.name}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// One editor, two places:
// - With modalProps: the original Embed Editor window (header + close
//   button, Save & Close / Send footer).
// - Without: inline on the plugin's settings page.
// The draft autosaves either way, so closing the window keeps your work.
function EmbedEditorPanel({ modalProps }: { modalProps?: ModalProps; } = {}) {
    const initial = loadDraft();
    const [webhookUrl, setWebhookUrl] = useState(initial.webhookUrl || settings.store.webhookUrl || "");
    const [content, setContent] = useState(initial.content || "");
    const [username, setUsername] = useState(settings.store.username || "");
    const [avatarUrl, setAvatarUrl] = useState(settings.store.avatarUrl || "");
    const [embeds, setEmbeds] = useState<EmbedDraft[]>(initial.embeds?.length ? initial.embeds : [blankEmbed()]);
    const [buttons, setButtons] = useState<MessageButton[]>(initial.buttons || []);
    const [files, setFiles] = useState<PendingFile[]>([]);
    const [keptFiles, setKeptFiles] = useState<KeptFile[]>([]);
    const [layout, setLayout] = useState<Layout>(initial.layout ?? "container");
    const [messageLink, setMessageLink] = useState("");
    const [loadedMessageId, setLoadedMessageId] = useState<string | null>(null);
    const [toast, setToast] = useState<ToastState>(null);
    const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const showToast = (type: "success" | "error", message: string) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ type, message });
        toastTimer.current = setTimeout(() => setToast(null), 4500);
    };
    const dismissToast = () => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast(null);
    };

    const updateEmbed = (idx: number, patch: Partial<EmbedDraft>) =>
        setEmbeds(prev => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

    const addField = (idx: number) =>
        updateEmbed(idx, { fields: [...embeds[idx].fields, { name: "", value: "", inline: false }] });

    const updateField = (eIdx: number, fIdx: number, patch: Partial<EmbedField>) => {
        const fields = embeds[eIdx].fields.map((f, i) => (i === fIdx ? { ...f, ...patch } : f));
        updateEmbed(eIdx, { fields });
    };

    const removeField = (eIdx: number, fIdx: number) =>
        updateEmbed(eIdx, { fields: embeds[eIdx].fields.filter((_, i) => i !== fIdx) });

    const updateButton = (idx: number, patch: Partial<MessageButton>) =>
        setButtons(prev => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
    const addButton = () => { if (buttons.length < 5) setButtons([...buttons, blankButton()]); };
    const removeButton = (idx: number) => setButtons(buttons.filter((_, i) => i !== idx));

    const addFiles = async (fileList: FileList | null) => {
        if (!fileList || !fileList.length) return;
        const picked = Array.from(fileList);
        const read = await Promise.all(picked.map(async f => ({
            name: f.name,
            contentType: f.type || "application/octet-stream",
            dataBase64: await readFileAsBase64(f),
            size: f.size,
            previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
        })));
        setFiles(prev => [...prev, ...read]);
    };
    const revokePreviews = (list: PendingFile[]) => list.forEach(f => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    const removeFile = (idx: number) => {
        const name = files[idx]?.name;
        revokePreviews([files[idx]]);
        setFiles(files.filter((_, i) => i !== idx));
        // A picture an embed was showing goes from the embed too.
        if (name) setEmbeds(prev => prev.map(e => PIC_KEYS.some(k => attachedName(e[k]) === name)
            ? { ...e, ...Object.fromEntries(PIC_KEYS.filter(k => attachedName(e[k]) === name).map(k => [k, ""])) }
            : e));
    };
    /** Attaches a picture for an embed; gives back what the embed should point at. */
    const attachPicture = async (file: File) => {
        const taken = new Set([...files.map(f => f.name.toLowerCase()), ...keptFiles.map(k => k.filename.toLowerCase())]);
        const [name] = assignAttachmentNames([file.name || "picture.png"], taken);
        const pf: PendingFile = { name, contentType: file.type || "image/png", dataBase64: await readFileAsBase64(file), size: file.size, previewUrl: URL.createObjectURL(file) };
        setFiles(prev => [...prev, pf]);
        return `attachment://${name}`;
    };
    /** Sets an embed picture; a file it replaces is dropped unless something else still shows it. */
    const setPicture = (idx: number, key: PicKey, value: string) => {
        const old = embeds[idx]?.[key] ?? "";
        updateEmbed(idx, { [key]: value } as Partial<EmbedDraft>);
        const oldName = attachedName(old);
        if (!oldName || old === value) return;
        const stillUsed = embeds.some((e, i) => PIC_KEYS.some(k => (i === idx && k === key ? value : e[k]) === old));
        if (!stillUsed) setFiles(prev => { revokePreviews(prev.filter(f => f.name === oldName)); return prev.filter(f => f.name !== oldName); });
    };
    /** attachment:// pictures, as something the preview can show. */
    const picturePreview = (v: string) => {
        const n = attachedName(v);
        return n ? files.find(f => f.name === n)?.previewUrl ?? keptFiles.find(k => k.filename === n)?.url : undefined;
    };
    const removeKeptFile = (idx: number) => setKeptFiles(keptFiles.filter((_, i) => i !== idx));
    const filesRef = React.useRef(files);
    filesRef.current = files;

    const addEmbed = () => { if (embeds.length < 10) setEmbeds([...embeds, blankEmbed()]); };
    const removeEmbed = (idx: number) => setEmbeds(embeds.filter((_, i) => i !== idx));
    const duplicateEmbed = (idx: number) => {
        if (embeds.length >= 10) return;
        const clone: EmbedDraft = JSON.parse(JSON.stringify(embeds[idx]));
        setEmbeds(prev => {
            const next = [...prev];
            next.splice(idx + 1, 0, clone);
            return next;
        });
    };

    const [collapsedEmbeds, setCollapsedEmbeds] = useState<Record<number, boolean>>({});
    const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
    const toggleEmbedCollapsed = (idx: number) =>
        setCollapsedEmbeds(prev => ({ ...prev, [idx]: !prev[idx] }));

    // Autosave. There's no modal close/"Save & Close" any more — the editor is
    // just part of the settings page — so the draft and the username/avatar
    // defaults are written back on a short debounce while typing, plus once
    // more on unmount (closing the settings page) so the last keystrokes
    // aren't lost. The webhook URL default is still only updated after a
    // successful send, so a half-pasted URL never replaces a working one.
    const latest = React.useRef({ content, webhookUrl, embeds, buttons, username, avatarUrl, layout });
    latest.current = { content, webhookUrl, embeds, buttons, username, avatarUrl, layout };

    const persist = () => {
        const { content, webhookUrl, embeds, buttons, username, avatarUrl, layout } = latest.current;
        saveDraft({ content, webhookUrl, embeds, buttons, layout });
        if (settings.store.username !== username) settings.store.username = username;
        if (settings.store.avatarUrl !== avatarUrl) settings.store.avatarUrl = avatarUrl;
    };

    React.useEffect(() => {
        const t = setTimeout(persist, 500);
        return () => clearTimeout(t);
    }, [content, webhookUrl, embeds, buttons, username, avatarUrl, layout]);

    React.useEffect(() => () => {
        persist();
        revokePreviews(filesRef.current);
        if (toastTimer.current) clearTimeout(toastTimer.current);
    }, []);

    const handleLoad = async (linkArg?: string, hookArg?: string) => {
        const link = linkArg ?? messageLink, hookUrl = hookArg ?? webhookUrl;
        const id = extractMessageId(link);
        if (!id || !looksLikeWebhookUrl(hookUrl)) { showToast("error", "Need a valid webhook URL and message link."); return; }
        try {
            const res = await VencordNative.pluginHelpers.Sonata.getWebhookMessage(
                `${hookUrl.trim()}/messages/${id}`,
            );
            if (!res.ok) { showToast("error", `Failed to load message: ${formatApiError(res.body, res.status)}`); return; }
            const data = res.body;
            const isV2 = ((data.flags ?? 0) & IS_COMPONENTS_V2) !== 0;
            const loadedLayout: Layout = isV2 ? "container" : "classic";

            // Existing attachments only need tracking for container messages:
            // there, every file must be referenced by a component, so they
            // have to be re-sent in the layout on edit. Classic edits leave
            // existing attachments alone.
            setKeptFiles(isV2
                ? (data.attachments || []).map((a: any) => ({
                    id: a.id, filename: a.filename, contentType: a.content_type || "application/octet-stream",
                    size: a.size || 0, url: a.url || "",
                }))
                : []);
            setLayout(loadedLayout);

            const stored = loadSentDrafts()[id];
            if (stored) {
                setContent(stored.content || "");
                setEmbeds(stored.embeds?.length ? stored.embeds : [blankEmbed()]);
                setButtons(stored.buttons || []);
                setLoadedMessageId(id);
                showToast("success", "Loaded — Send will now update this message.");
                return;
            }

            if (isV2) {
                const parsed = containersToEmbeds(data.components || []);
                setContent(parsed.content);
                setEmbeds(parsed.embeds.length ? parsed.embeds : [blankEmbed()]);
                setButtons(await fillReplyTexts(parsed.buttons));
                setLoadedMessageId(id);
                showToast("success", "Loaded (best effort — this message wasn't sent from this editor). Send will update it.");
                return;
            }

            setContent(data.content || "");
            const loaded: EmbedDraft[] = (data.embeds || []).map(apiEmbedToDraft);
            setEmbeds(loaded.length ? loaded : [blankEmbed()]);
            // Link buttons and Sonata's own private reply buttons round-trip here;
            // other bots' interactive buttons can't be re-sent through a webhook.
            const loadedButtons: MessageButton[] = (data.components || [])
                .flatMap((row: any) => row.components || [])
                .map((c: any) => buttonFromApi(c))
                .filter(Boolean) as MessageButton[];
            setButtons(await fillReplyTexts(loadedButtons));
            setLoadedMessageId(id);
            showToast("success", "Loaded — Send will now update this message.");
        } catch (e: any) {
            showToast("error", `Failed to load message: ${e?.message ?? e}`);
        }
    };

    /** The webhook request for what's in the editor (null if there's nothing to send). */
    const buildPayload = (info: HookInfo | null, sendButtons: MessageButton[], isEdit: boolean): { body: Record<string, any>; uploadNames: string[]; needsComponentsParam: boolean; } | null => {
        const ctx = fillContext(info);
        const filled = { content: fill(content, ctx), embeds: fillAll(embeds, ctx), buttons: fillAll(sendButtons, ctx) };
        const body: Record<string, any> = {};
        let needsComponentsParam = false;
        // Sanitized, collision-free names so attachment://<name> resolves — and embed pictures follow any rename.
        const uploadNames = assignAttachmentNames(files.map(f => f.name), new Set(keptFiles.map(k => k.filename.toLowerCase())));
        filled.embeds = renamePictures(filled.embeds, new Map(files.map((f, i) => [f.name, uploadNames[i]])));
        const pictured = picturedNames(filled.embeds);

        if (layout === "container") {
            const refs: AttachmentRef[] = [
                ...keptFiles.map(k => ({ filename: k.filename, contentType: k.contentType })),
                ...files.map((f, i) => ({ filename: uploadNames[i], contentType: f.contentType })),
            ].filter(r => !pictured.has(r.filename));
            const components = buildContainerComponents(filled.content, filled.embeds, filled.buttons, refs);
            if (!components.length) { showToast("error", "Nothing to send — add some content, an embed, or a file."); return null; }

            body.flags = IS_COMPONENTS_V2;
            body.components = components;
            // New uploads are listed by their files[n] index; existing ones by
            // their snowflake ID. On an edit, anything left out of this list
            // is removed from the message, which is what "remove" in the
            // Files section relies on.
            body.attachments = [
                ...keptFiles.map(k => ({ id: k.id })),
                ...files.map((_, i) => ({ id: i, filename: uploadNames[i] })),
            ];
            needsComponentsParam = true;
        } else {
            const components = buttonsToComponents(filled.buttons);
            body.content = filled.content || undefined;
            body.embeds = filled.embeds.map(embedDraftToPayload).filter(e => Object.keys(e).length > 0);
            if (components) { body.components = components; needsComponentsParam = true; }
        }

        if (!isEdit) {
            body.username = username || undefined;
            body.avatar_url = avatarUrl || undefined;
        }
        return { body, uploadNames, needsComponentsParam };
    };

    const handleSend = async () => {
        if (!looksLikeWebhookUrl(webhookUrl)) { showToast("error", "That doesn't look like a valid webhook URL."); return; }
        const info = await hookInfo(webhookUrl);
        const hasPrivate = buttons.some(b => b.kind === "private" && b.label.trim());
        if (hasPrivate && info && !info.applicationId) { showToast("error", "Private reply buttons only work through a webhook your bot made — open “Private reply buttons” and press “Make a bot webhook here”."); return; }
        const synced = await syncReplies(buttons);
        if ("error" in synced) { showToast("error", synced.error); return; }
        const sendButtons = synced.buttons;
        if (sendButtons !== buttons) setButtons(sendButtons);
        const isEdit = !!loadedMessageId;
        const payload = buildPayload(info, sendButtons, isEdit);
        if (!payload) return;
        const { body, uploadNames, needsComponentsParam } = payload;

        try {
            let url = isEdit ? `${webhookUrl.trim()}/messages/${loadedMessageId}` : webhookUrl.trim();
            const params: string[] = [];
            // A plain incoming webhook drops components unless the request
            // opts in — see the Execute/Edit Webhook docs' with_components note.
            if (needsComponentsParam) params.push("with_components=true");
            // wait=true makes a new send return the message, so its ID can be
            // remembered for loading it back into the editor later.
            if (!isEdit) params.push("wait=true");
            if (params.length) url += (url.includes("?") ? "&" : "?") + params.join("&");

            const res = await VencordNative.pluginHelpers.Sonata.sendWebhook(
                url, isEdit ? "PATCH" : "POST", body,
                files.length ? files.map((f, i) => ({ name: uploadNames[i], contentType: f.contentType, dataBase64: f.dataBase64 })) : undefined,
            );
            if (!res.ok) { showToast("error", `Error: ${formatApiError(res.body, res.status)}`); return; }

            settings.store.webhookUrl = webhookUrl;
            persist();

            const messageId = isEdit ? loadedMessageId : res.body?.id;
            if (messageId) {
                rememberSentDraft(messageId, { content, webhookUrl, embeds, buttons: sendButtons, layout });
                const item: SentItem = { id: messageId, webhookUrl: webhookUrl.trim(), channelId: res.body?.channel_id ?? info?.channelId ?? undefined, guildId: info?.guildId ?? undefined, label: summaryLabel({ content, embeds } as any), at: Date.now() };
                settings.store.sentHistoryJson = addToHistory(settings.store.sentHistoryJson, item);
                setHistoryRaw(settings.store.sentHistoryJson);
            }

            // After editing a container message, the uploads are now part of
            // it — show them as existing attachments instead of pending ones.
            if (isEdit && layout === "container" && Array.isArray(res.body?.attachments)) {
                setKeptFiles(res.body.attachments.map((a: any) => ({
                    id: a.id, filename: a.filename, contentType: a.content_type || "application/octet-stream",
                    size: a.size || 0, url: a.url || "",
                })));
            }
            // Pictures the embeds still show stay attached, so the draft keeps working —
            // unless they're on the message itself now (an edited container message).
            const stillShown = picturedNames(embeds);
            const onMessage = new Set<string>(isEdit && layout === "container" && Array.isArray(res.body?.attachments) ? res.body.attachments.map((a: any) => a.filename) : []);
            const stay = files.filter(f => stillShown.has(f.name) && !onMessage.has(f.name));
            revokePreviews(files.filter(f => !stay.includes(f)));
            setFiles(stay);
            showToast("success", isEdit ? "Message updated." : "Embed sent.");
        } catch (e: any) {
            showToast("error", `Failed to send: ${e?.message ?? e}`);
        }
    };

    const [testRaw, setTestRaw] = useState(settings.store.testChannelJson);
    const [testHost, setTestHost] = useState<HTMLDivElement | null>(null);
    const [testAutoDelete, setTestAutoDelete] = useState(!!settings.store.testAutoDelete);
    /** Private buttons can't go through a test webhook (they need your bot), so tests leave them out — or show them, for "only me". */
    const testButtons = (forLocal: boolean) => forLocal
        ? buttons.map(b => b.kind === "private" && b.label.trim() && !b.replyId ? { ...b, replyId: "preview" } : b)
        : buttons.filter(b => b.kind !== "private");

    const testOnlyMe = async (channelId: string) => {
        const info = looksLikeWebhookUrl(webhookUrl) ? await hookInfo(webhookUrl) : null;
        const payload = buildPayload(info, testButtons(true), false);
        if (!payload) return;
        let avatar: string | null = null, id: string | undefined;
        if (looksLikeWebhookUrl(webhookUrl)) {
            const r: any = await VencordNative.pluginHelpers.Sonata.getWebhookMessage(webhookUrl.trim().split("?")[0]).catch(() => null);
            if (r?.ok) { avatar = r.body?.avatar ?? null; id = r.body?.id; }
        }
        try {
            await showOnlyMe(channelId, payload.body, files.map((f, i) => ({ name: payload.uploadNames[i], contentType: f.contentType, size: f.size, url: f.previewUrl })),
                { id, name: username || info?.name || "Webhook", avatar });
            showToast("success", "Shown in the chat behind this window — only you can see it.");
        } catch (e: any) {
            showToast("error", `Couldn't show the preview: ${e?.message ?? e}`);
        }
    };

    const testPost = async (target: TestChannel) => {
        const info = looksLikeWebhookUrl(webhookUrl) ? await hookInfo(webhookUrl) : null;
        const left = buttons.some(b => b.kind === "private" && b.label.trim());
        const payload = buildPayload(info, testButtons(false), false);
        if (!payload) return;
        const { body, uploadNames, needsComponentsParam } = payload;
        const post = (url: string) => VencordNative.pluginHelpers.Sonata.sendWebhook(
            url + (needsComponentsParam ? "?with_components=true&wait=true" : "?wait=true"), "POST", body,
            files.length ? files.map((f, i) => ({ name: uploadNames[i], contentType: f.contentType, dataBase64: f.dataBase64 })) : undefined,
        );
        let { url } = target;
        let res = await post(url);
        // Someone deleted the test webhook: make a new one and try once more.
        if (!res.ok && (res.status === 404 || res.status === 401)) {
            const again = await testWebhookFor(target.channelId);
            if (again.url) { url = again.url; settings.store.testChannelJson = JSON.stringify({ channelId: target.channelId, url }); setTestRaw(settings.store.testChannelJson); res = await post(url); }
        }
        if (!res.ok) { showToast("error", `Test didn't post: ${formatApiError(res.body, res.status)}`); return; }
        const channel: any = ChannelStore.getChannel(target.channelId);
        showToast("success", `Test posted in #${channel?.name ?? "your test channel"}${left ? " (private buttons left out — they need your bot)" : ""}${settings.store.testAutoDelete ? " — it deletes itself in 2 minutes" : ""}.`);
        const id = res.body?.id;
        if (settings.store.testAutoDelete && id) setTimeout(() => void VencordNative.pluginHelpers.Sonata.deleteWebhookMessage?.(`${url.split("?")[0]}/messages/${id}`), 120_000);
    };
    const testButton = (
        <TestButton raw={testRaw} write={json => { settings.store.testChannelJson = json; setTestRaw(json); }}
            autoDelete={testAutoDelete} setAutoDelete={v => { settings.store.testAutoDelete = v; setTestAutoDelete(v); }}
            onOnlyMe={id => void testOnlyMe(id)} onPost={t => void testPost(t)} host={testHost} />
    );

    const layoutLocked = !!loadedMessageId;
    const hook = useHookInfo(webhookUrl);
    // The pickers (roles, channels, people, emoji) use the webhook's server, or the one you're looking at.
    const openChannel: any = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    const serverId: string | null = hook?.guildId ?? openChannel?.guild_id ?? null;
    previewChannelId = hook?.channelId ?? openChannel?.id;
    const [emojiFor, setEmojiFor] = useState<number | null>(null);
    const previewCtx = React.useMemo(() => fillContext(hook), [hook, Math.floor(Date.now() / 60000)]);
    const [hooksRaw, setHooksRaw] = useState(settings.store.webhooksJson);
    const [historyRaw, setHistoryRaw] = useState(settings.store.sentHistoryJson);
    const [builder, setBuilder] = useState<"rules" | "banner" | "hub" | "roblox" | null>(null);
    const [tab, setTab] = useState<EditorTab>("compose");
    const [openColour, setOpenColour] = useState<number | null>(null);
    const openFromHistory = (item: SentItem) => {
        const link = `https://discord.com/channels/${item.guildId ?? "@me"}/${item.channelId ?? "0"}/${item.id}`;
        setWebhookUrl(item.webhookUrl); setMessageLink(link);
        void handleLoad(link, item.webhookUrl);
    };
    const writeHooks = (json: string) => { settings.store.webhooksJson = json; setHooksRaw(json); };

    // Templates: load one into the editor (keeping the layout while editing a sent message, which can't change it).
    const applyTemplate = (d: TemplateData) => {
        setContent(d.content ?? "");
        setEmbeds(d.embeds?.length ? d.embeds.map(e => ({ ...blankEmbed(), ...e, fields: e.fields ?? [] })) : [blankEmbed()]);
        setButtons(d.buttons ?? []);
        if (d.layout && !layoutLocked) setLayout(d.layout);
        if (d.username !== undefined) setUsername(d.username);
        if (d.avatarUrl !== undefined) setAvatarUrl(d.avatarUrl);
        if (d.webhookUrl) setWebhookUrl(d.webhookUrl);
        if (d.layout && layoutLocked && d.layout !== layout) showToast("error", "Loaded — but kept this message's layout, since a sent message can't switch layouts.");
    };
    const templateFromApi = (j: any): TemplateData | null => {
        const embedsIn = Array.isArray(j?.embeds) ? j.embeds : j?.title || j?.description ? [j] : null;
        if (!embedsIn && typeof j?.content !== "string") return null;
        return { content: j.content ?? "", embeds: (embedsIn ?? []).map(apiEmbedToDraft), buttons: [], layout: "classic", username: j.username, avatarUrl: j.avatar_url };
    };

    const count = (raw: string | undefined) => { try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v.length : 0; } catch { return 0; } };
    const tabs: [EditorTab, string, number][] = [
        ["compose", "✏️ Compose", 0],
        ["templates", "📋 Templates", count(settings.store.templatesJson)],
        ["sent", "📜 Sent", count(historyRaw)],
        ["schedule", "⏰ Send later", loadScheduled(settings.store.scheduledJson).length],
        ["builders", "🧰 Builders", 0],
        ["private", "🔒 Private buttons", 0],
    ];
    // A part of an embed starts folded unless something's in it.
    const folded = (key: string, filled: boolean) => collapsedSections[key] ?? !filled;
    const fold = (key: string, filled: boolean) => setCollapsedSections(c => ({ ...c, [key]: !(c[key] ?? !filled) }));

    const editorBody = (
        <div className="vc-es2">
            <div className="vc-es2-form">
                <nav className="vc-es2-tabs" role="tablist">
                    {tabs.map(([id, label, n]) => (
                        <button key={id} type="button" role="tab" aria-selected={tab === id} className={"vc-es2-tab" + (tab === id ? " vc-es2-tab-on" : "")} onClick={() => setTab(id)}>
                            {label}{n > 0 && <span className="vc-es2-tab-n">{n}</span>}
                        </button>
                    ))}
                </nav>

                <div className="vc-es2-scroll vc-embedsender-scroll">
                    {tab === "templates" && (
                        <Card title="Templates" hint="Save a message to reuse it, or start from one.">
                            <TemplatesSection
                                read={() => settings.store.templatesJson}
                                write={json => { settings.store.templatesJson = json; }}
                                current={() => ({ ...latest.current })}
                                apply={d => { applyTemplate(d); setTab("compose"); }}
                                blankEmbed={blankEmbed}
                                fromApi={templateFromApi}
                                toast={showToast}
                            />
                        </Card>
                    )}

                    {tab === "sent" && (
                        <Card title="Sent" hint="Everything you've posted from here. Edit again loads it back into Compose.">
                            <SentHistory raw={historyRaw} write={json => { settings.store.sentHistoryJson = json; setHistoryRaw(json); }} onEdit={item => { setTab("compose"); openFromHistory(item); }} toast={showToast} />
                        </Card>
                    )}

                    {tab === "schedule" && (
                        <Card title="Send later" hint="Posts the message in Compose at a time you pick — Discord needs to be open then.">
                            <ScheduleBox
                                raw={settings.store.scheduledJson}
                                write={json => { settings.store.scheduledJson = json; }}
                                toast={showToast}
                                sendNow={async item => { const r = await sendScheduled(item, true); showToast(r ? "success" : "error", r ? "Sent." : "Couldn't send it — check the webhook."); return r; }}
                                makeItem={() => {
                                    if (!looksLikeWebhookUrl(webhookUrl)) { showToast("error", "Add a webhook first (in Compose)."); return null; }
                                    if (loadedMessageId) { showToast("error", "Scheduling is for new messages — clear the loaded message first."); return null; }
                                    if (files.length) showToast("error", "Scheduled, but files can't be sent later — only the text and embeds.");
                                    const draft = JSON.parse(JSON.stringify({ content, embeds, buttons, layout, username, avatarUrl }));
                                    return { webhookUrl: webhookUrl.trim(), label: summaryLabel(draft), draft };
                                }}
                            />
                        </Card>
                    )}

                    {tab === "builders" && (
                        <Card title="Builders" hint="Make something, then it drops into Compose.">
                            {!builder && (
                                <div className="vc-es2-builder-pick">
                                    <button type="button" className="vc-es2-builder-opt" onClick={() => setBuilder("rules")}><span>📜</span><b>Rules</b><small>Numbered rules with an “I agree” button</small></button>
                                    <button type="button" className="vc-es2-builder-opt" onClick={() => setBuilder("banner")}><span>🖼️</span><b>Banner</b><small>A header picture with your title and colours</small></button>
                                    <button type="button" className="vc-es2-builder-opt" onClick={() => setBuilder("hub")}><span>🧭</span><b>Navigation hub</b><small>A “start here” post linking to your channels</small></button>
                                    <button type="button" className="vc-es2-builder-opt" onClick={() => setBuilder("roblox")}><span>🎮</span><b>Roblox game</b><small>Paste a game link — its picture, players and a Play button</small></button>
                                </div>
                            )}
                            {builder === "rules" && (
                                <RulesBuilder onClose={() => setBuilder(null)} onUse={r => {
                                    setEmbeds(prev => [{ ...blankEmbed(), ...(prev[0] ?? {}), title: r.title, description: r.description, color: r.color, footerText: r.footer }, ...prev.slice(1)]);
                                    if (r.button) setButtons(prev => [...prev.filter(b => b.label !== r.button!.label), { ...blankButton(), label: r.button!.label, url: r.button!.url }].slice(0, 5));
                                    setBuilder(null);
                                    setTab("compose");
                                    showToast("success", "Rules added to the first embed.");
                                }} />
                            )}
                            {builder === "hub" && (
                                <NavHubBuilder guildId={serverId} onClose={() => setBuilder(null)} onUse={r => {
                                    setEmbeds(prev => [{ ...blankEmbed(), ...(prev[0] ?? {}), title: r.title, description: r.description, color: r.color }, ...prev.slice(1)]);
                                    if (r.buttons.length) setButtons(r.buttons.map(b => ({ ...blankButton(), label: b.label, url: b.url, emoji: b.emoji })));
                                    setBuilder(null);
                                    setTab("compose");
                                    showToast("success", "Hub added to the first embed.");
                                }} />
                            )}
                            {builder === "roblox" && (
                                <RobloxGameBuilder onClose={() => setBuilder(null)} onUse={r => {
                                    setEmbeds(prev => [{ ...blankEmbed(), title: r.title, url: r.url, description: r.description, color: r.color, imageUrl: r.imageUrl, thumbnailUrl: r.thumbnailUrl, footerText: r.footerText, fields: r.fields }, ...prev.slice(1)]);
                                    if (r.button) setButtons(prev => [...prev.filter(x => x.url !== r.button!.url), { ...blankButton(), label: r.button!.label, url: r.button!.url }].slice(0, 5));
                                    setBuilder(null);
                                    setTab("compose");
                                    showToast("success", "Game added to the first embed.");
                                }} />
                            )}
                            {builder === "banner" && (
                                <BannerMaker initial={{ title: embeds[0]?.title || "Announcement", from: `#${/^[0-9a-f]{6}$/i.test(embeds[0]?.color ?? "") ? embeds[0].color : "5865F2"}` }} onClose={() => setBuilder(null)} onUse={f => {
                                    const bin = atob(f.dataBase64), bytes = new Uint8Array(bin.length);
                                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                                    setFiles(prev => [...prev, { ...f, previewUrl: URL.createObjectURL(new Blob([bytes], { type: "image/png" })) }]);
                                    // Classic embeds show it as their main picture; container cards show every file inside the card anyway.
                                    if (layout === "classic") updateEmbed(0, { imageUrl: `attachment://${f.name}` });
                                    setBuilder(null);
                                    setTab("compose");
                                    showToast("success", layout === "classic" ? "Banner attached as the embed's picture." : "Banner attached — it shows inside the card.");
                                }} />
                            )}
                        </Card>
                    )}

                    {tab === "private" && (
                        <Card title="Private reply buttons" hint="Buttons that show the presser a message only they can see.">
                            <PrivateRepliesSetup toast={showToast} onWebhook={(url, name) => { setWebhookUrl(url); writeHooks(rememberHook(settings.store.webhooksJson, url, name)); }} />
                        </Card>
                    )}

                    {tab === "compose" && (
                        <>
                            <Card title="Send to">
                                <div className="vc-es2-row">
                                    <input className="vc-tool-input vc-es2-grow" placeholder="Webhook URL — https://discord.com/api/webhooks/…"
                                        value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} />
                                    <button type="button" className="vc-tool-btn" onClick={() => openWebhookPicker((url, name) => {
                                        setWebhookUrl(url);
                                        writeHooks(rememberHook(settings.store.webhooksJson, url, name));
                                        showToast("success", `Using webhook “${name}” — saved for next time.`);
                                    })}>Pick / create…</button>
                                </div>
                                <SavedWebhooks raw={hooksRaw} write={writeHooks} current={webhookUrl} onPick={(url, name) => { setWebhookUrl(url); showToast("success", `Using “${name}”.`); }} />

                                <div className="vc-es2-split">
                                    <div className="vc-es2-sub">
                                        <span className="vc-es2-label">Layout</span>
                                        <div className="vc-embedsender-layout-toggle" role="radiogroup">
                                            {([["container", "Container"], ["classic", "Classic embed"]] as const).map(([value, label]) => (
                                                <button key={value} type="button" role="radio" aria-checked={layout === value} aria-disabled={layoutLocked}
                                                    title={value === "container" ? "Files, images and buttons sit inside the card" : "Standard embeds with icons and inline fields"}
                                                    className={"vc-embedsender-layout-option" + (layout === value ? " vc-embedsender-layout-option-active" : "")}
                                                    onClick={() => { if (!layoutLocked) setLayout(value); }}>
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="vc-es2-sub">
                                        <span className="vc-es2-label">Edit a sent message <i>optional</i></span>
                                        <div className="vc-es2-row">
                                            <input className="vc-tool-input vc-es2-grow" placeholder="Message link"
                                                value={messageLink} onChange={e => setMessageLink(e.target.value)} />
                                            <button type="button" className="vc-tool-btn" onClick={() => handleLoad()}>Load</button>
                                        </div>
                                    </div>
                                </div>
                                {loadedMessageId && (
                                    <div className="vc-es2-note">
                                        ✏️ Editing message {loadedMessageId} — Send will update it.
                                        <button type="button" className="vc-tool-link" onClick={() => { setLoadedMessageId(null); setKeptFiles([]); }}>Send as new instead</button>
                                    </div>
                                )}
                                {layoutLocked && <div className="vc-tool-hint">The layout is locked while editing — Discord can't switch a sent message between layouts.</div>}

                                <Fold title="Name & picture" summary={username || avatarUrl ? [username, avatarUrl && "custom picture"].filter(Boolean).join(" · ") : "the webhook's own"}
                                    folded={folded("identity", !!(username || avatarUrl))} onToggle={() => fold("identity", !!(username || avatarUrl))}>
                                    <Field label="Name"><input className="vc-tool-input" placeholder="Leave empty for the webhook's name" value={username} onChange={e => setUsername(e.target.value)} /></Field>
                                    <Field label="Picture">
                                        <AvatarPicker webhookUrl={webhookUrl} link={avatarUrl} onLink={setAvatarUrl} toast={showToast} />
                                    </Field>
                                </Fold>
                            </Card>

                            <Card title="Message" hint={content ? `${content.length}/2000` : "Text above the embeds — optional"}>
                                <RichText value={content} onChange={setContent} maxLength={2000} minRows={3} guildId={serverId} line={layout === "container"}
                                    placeholder="Say something… select text and use the bar above to format it" />
                            </Card>

                            {embeds.map((embed, idx) => {
                                const colorHex = /^[0-9a-fA-F]{6}$/.test(embed.color) ? `#${embed.color}` : "#5865F2";
                                const embedCollapsed = !!collapsedEmbeds[idx];
                                const sec = (name: string) => `${idx}-${name}`;
                                const hasAuthor = !!(embed.authorName || embed.authorUrl || embed.authorIcon);
                                const hasImages = !!(embed.imageUrl || embed.thumbnailUrl);
                                const hasFooter = !!(embed.footerText || embed.footerIcon);
                                return (
                                    <section key={idx} className="vc-es2-embed" style={{ "--es2-embed": colorHex } as React.CSSProperties}>
                                        <header className="vc-es2-embed-head">
                                            <button type="button" className="vc-es2-embed-toggle" onClick={() => toggleEmbedCollapsed(idx)} aria-expanded={!embedCollapsed}>
                                                <ChevronIcon collapsed={embedCollapsed} />
                                                <i className="vc-es2-dot" />
                                                <b>Embed {idx + 1}</b>
                                                {embed.title && <span>{embed.title}</span>}
                                            </button>
                                            <IconButton title="Duplicate embed" onClick={() => duplicateEmbed(idx)}><DuplicateIcon /></IconButton>
                                            <IconButton title="Remove embed" danger onClick={() => removeEmbed(idx)}><CloseIcon /></IconButton>
                                        </header>

                                        {!embedCollapsed && (
                                            <div className="vc-es2-embed-body">
                                                <Field label="Title" counter={{ value: embed.title, max: 256 }}>
                                                    <div className="vc-es2-row">
                                                        <input className="vc-tool-input vc-es2-title-input vc-es2-grow" maxLength={256} placeholder="A title" value={embed.title} onChange={e => updateEmbed(idx, { title: e.target.value })} />
                                                        <button type="button" className="vc-tool-btn" title="Add symbols from Characters" onClick={() => pickCharacters(ch => setEmbeds(prev => prev.map((x, i) => i === idx ? { ...x, title: (x.title + ch).slice(0, 256) } : x)), "the title")}>✦</button>
                                                    </div>
                                                </Field>
                                                <Field label="Description" counter={{ value: embed.description, max: 4096 }}>
                                                    <RichText value={embed.description} onChange={v => updateEmbed(idx, { description: v })} maxLength={4096} minRows={6} guildId={serverId} line={layout === "container"}
                                                        placeholder="The main text — select text and use the bar above to format it" />
                                                </Field>
                                                <div className="vc-es2-split vc-es2-split-wide">
                                                    <Field label="Title link"><input className="vc-tool-input" placeholder="https://… (makes the title clickable)" value={embed.url} onChange={e => updateEmbed(idx, { url: e.target.value })} /></Field>
                                                    <Field label="Colour">
                                                        <div className="vc-es2-row">
                                                            <input type="color" className="vc-es2-swatch" value={colorHex} onChange={e => updateEmbed(idx, { color: e.target.value.replace("#", "").toUpperCase() })} />
                                                            <input className="vc-tool-input vc-es2-grow vc-es2-mono" value={embed.color} maxLength={7} onChange={e => updateEmbed(idx, { color: e.target.value.replace("#", "") })} />
                                                            <button type="button" className={"vc-tool-btn" + (openColour === idx ? " vc-es2-btn-on" : "")} title="Colours from the server, your picture, and more" onClick={() => setOpenColour(openColour === idx ? null : idx)}>🎨</button>
                                                        </div>
                                                    </Field>
                                                </div>
                                                {openColour === idx && (
                                                    <div className="vc-es2-colours">
                                                        <div className="vc-embedsender-palette-row">
                                                            <span className="vc-tool-hint">Popular</span>
                                                            {PRESET_COLOURS.map(([hex, name]) => <button key={hex} type="button" className="vc-embedsender-swatch" title={name} style={{ background: `#${hex}` }} onClick={() => updateEmbed(idx, { color: hex })} />)}
                                                        </div>
                                                        <Palette sources={paletteSources(hook, embed)} onPick={hex => updateEmbed(idx, { color: hex })} />
                                                        <ColorFromImage toast={showToast} onPick={hex => updateEmbed(idx, { color: hex })} sources={[
                                                            { label: "Thumbnail", url: embed.thumbnailUrl },
                                                            { label: "Image", url: embed.imageUrl.startsWith("attachment://") ? undefined : embed.imageUrl },
                                                            ...files.filter(f => f.contentType.startsWith("image/")).slice(0, 3).map(f => ({ label: f.name.length > 18 ? f.name.slice(0, 16) + "…" : f.name, bytes: Uint8Array.from(atob(f.dataBase64), ch => ch.charCodeAt(0)) })),
                                                        ]} />
                                                    </div>
                                                )}

                                                <Fold title="Author" summary={embed.authorName || "none"} folded={folded(sec("author"), hasAuthor)} onToggle={() => fold(sec("author"), hasAuthor)}>
                                                    <Field label="Name" counter={{ value: embed.authorName, max: 256 }}>
                                                        <input className="vc-tool-input" maxLength={256} value={embed.authorName} onChange={e => updateEmbed(idx, { authorName: e.target.value })} />
                                                    </Field>
                                                    <Field label="Link"><input className="vc-tool-input" placeholder="https://… (makes the name clickable)" value={embed.authorUrl} onChange={e => updateEmbed(idx, { authorUrl: e.target.value })} /></Field>
                                                    {layout === "classic" && <Field label="Icon"><PictureInput value={embed.authorIcon} onChange={v => setPicture(idx, "authorIcon", v)} onFile={attachPicture} previewOf={picturePreview} toast={showToast} /></Field>}
                                                </Fold>

                                                <Fold title="Fields" summary={embed.fields.length ? `${embed.fields.length}` : "none"} folded={folded(sec("fields"), embed.fields.length > 0)} onToggle={() => fold(sec("fields"), embed.fields.length > 0)}>
                                                    {embed.fields.map((f, fIdx) => (
                                                        <div key={fIdx} className="vc-es2-field-row">
                                                            <input className="vc-tool-input" placeholder="Name" maxLength={256} value={f.name} onChange={e => updateField(idx, fIdx, { name: e.target.value })} />
                                                            <input className="vc-tool-input" placeholder="Value" maxLength={1024} value={f.value} onChange={e => updateField(idx, fIdx, { value: e.target.value })} />
                                                            {layout === "classic" && (
                                                                <label className="vc-es2-check" title="Sit side by side with other inline fields">
                                                                    <input type="checkbox" checked={f.inline} onChange={e => updateField(idx, fIdx, { inline: e.target.checked })} /> Inline
                                                                </label>
                                                            )}
                                                            <IconButton title="Remove field" danger onClick={() => removeField(idx, fIdx)}><CloseIcon /></IconButton>
                                                        </div>
                                                    ))}
                                                    <button type="button" className="vc-es2-add" disabled={embed.fields.length >= 25} onClick={() => addField(idx)}>＋ Add field</button>
                                                </Fold>

                                                <Fold title="Pictures" summary={[embed.imageUrl && "image", embed.thumbnailUrl && "thumbnail"].filter(Boolean).join(" · ") || "none"} folded={folded(sec("images"), hasImages)} onToggle={() => fold(sec("images"), hasImages)}>
                                                    <Field label="Big image"><PictureInput value={embed.imageUrl} onChange={v => setPicture(idx, "imageUrl", v)} onFile={attachPicture} previewOf={picturePreview} toast={showToast} /></Field>
                                                    <Field label="Thumbnail (small, top right)"><PictureInput value={embed.thumbnailUrl} onChange={v => setPicture(idx, "thumbnailUrl", v)} onFile={attachPicture} previewOf={picturePreview} toast={showToast} /></Field>
                                                </Fold>

                                                <Fold title="Footer" summary={embed.footerText ? (embed.footerText.length > 40 ? embed.footerText.slice(0, 38) + "…" : embed.footerText) : "none"} folded={folded(sec("footer"), hasFooter)} onToggle={() => fold(sec("footer"), hasFooter)}>
                                                    <Field label="Text" counter={{ value: embed.footerText, max: 2048 }}>
                                                        <GrowText value={embed.footerText} onChange={v => updateEmbed(idx, { footerText: v })} maxLength={2048} minRows={1} />
                                                    </Field>
                                                    {layout === "classic" && <Field label="Icon"><PictureInput value={embed.footerIcon} onChange={v => setPicture(idx, "footerIcon", v)} onFile={attachPicture} previewOf={picturePreview} toast={showToast} /></Field>}
                                                </Fold>
                                            </div>
                                        )}
                                    </section>
                                );
                            })}
                            <button type="button" className="vc-es2-add vc-es2-add-big" disabled={embeds.length >= 10} onClick={addEmbed}>＋ Add another embed</button>

                            <Card title="Buttons" hint={`${buttons.length}/5`} folded={folded("msg-buttons", buttons.length > 0)} onToggle={() => fold("msg-buttons", buttons.length > 0)}>
                                <div className="vc-tool-hint">
                                    🔗 Link buttons open a website. 🔒 Private buttons show the presser a message only they can see (set up in the Private buttons tab).
                                    {layout === "classic" ? " With classic embeds, buttons sit below the embed." : " Each one can sit inside the card or in a row below it."}
                                </div>
                                {buttons.map((b, i) => (
                                    <div key={i} className="vc-es2-button">
                                        <div className="vc-es2-row">
                                            <div className="vc-embedsender-placement" role="radiogroup" aria-label="Button kind">
                                                {([["link", "🔗"], ["private", "🔒"]] as const).map(([k, icon]) => (
                                                    <button key={k} type="button" role="radio" aria-checked={(b.kind ?? "link") === k}
                                                        className={"vc-embedsender-placement-opt" + ((b.kind ?? "link") === k ? " vc-embedsender-placement-opt-active" : "")}
                                                        title={k === "link" ? "Opens a website" : "Shows a message only the presser can see"}
                                                        onClick={() => updateButton(i, { kind: k })}>{icon}</button>
                                                ))}
                                            </div>
                                            <button type="button" className={"vc-es2-btn-emoji" + (emojiFor === i ? " vc-es2-btn-emoji-on" : "")} title={b.emoji ? "Change the emoji" : "Add an emoji"} onClick={() => setEmojiFor(emojiFor === i ? null : i)}>
                                                {b.emoji ? <ButtonEmoji token={b.emoji} size={20} /> : <span className="vc-es2-btn-emoji-empty">☺</span>}
                                            </button>
                                            <input className="vc-tool-input vc-es2-grow" placeholder="Label" maxLength={80} value={b.label} onChange={e => updateButton(i, { label: e.target.value })} />
                                            {b.kind === "private" ? (
                                                <select className="vc-tool-input vc-es2-select" value={b.style ?? 1} onChange={e => updateButton(i, { style: Number(e.target.value) as 1 | 2 | 3 | 4 })}>
                                                    {PRIVATE_STYLES.map(st => <option key={st.id} value={st.id}>{st.label}</option>)}
                                                </select>
                                            ) : (
                                                <input className="vc-tool-input vc-es2-grow2" placeholder="https://…" value={b.url} onChange={e => updateButton(i, { url: e.target.value })} />
                                            )}
                                            {layout === "container" && (
                                                <div className="vc-embedsender-placement" role="radiogroup" aria-label="Button position">
                                                    {(["inside", "below"] as const).map(pl => (
                                                        <button key={pl} type="button" role="radio" aria-checked={placementOf(b) === pl}
                                                            className={"vc-embedsender-placement-opt" + (placementOf(b) === pl ? " vc-embedsender-placement-opt-active" : "")}
                                                            title={pl === "inside" ? "Inside the card" : "In a row under the card"}
                                                            onClick={() => updateButton(i, { placement: pl })}>
                                                            {pl === "inside" ? "In card" : "Below"}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            <IconButton title="Remove button" danger onClick={() => removeButton(i)}><CloseIcon /></IconButton>
                                        </div>
                                        {emojiFor === i && (
                                            <div className="vc-es2-insert-panel">
                                                <div className="vc-es2-row">
                                                    <input className="vc-tool-input vc-es2-grow" maxLength={8} placeholder="Type a normal emoji (😀), or pick one of your server's below"
                                                        value={b.emoji && !b.emoji.startsWith("<") ? b.emoji : ""} onChange={e => updateButton(i, { emoji: e.target.value })} />
                                                    {b.emoji && <button type="button" className="vc-tool-btn" onClick={() => { updateButton(i, { emoji: "" }); setEmojiFor(null); }}>No emoji</button>}
                                                </div>
                                                <EmojiPanel guildId={serverId} onPick={t => { updateButton(i, { emoji: t }); setEmojiFor(null); }} />
                                            </div>
                                        )}
                                        {b.kind === "private" && (
                                            <GrowText value={b.reply ?? ""} onChange={v => updateButton(i, { reply: v })} maxLength={2000} minRows={2}
                                                placeholder={"What the presser sees (only them). {user} mentions them, {name} is their name.\ne.g. Hey {user}, the code is SUMMER26 🎉"} />
                                        )}
                                    </div>
                                ))}
                                <button type="button" className="vc-es2-add" disabled={buttons.length >= 5} onClick={addButton}>＋ Add button</button>
                            </Card>

                            <Card title="Files" hint={files.length + keptFiles.length ? `${files.length + keptFiles.length}` : "none"} folded={folded("msg-files", files.length + keptFiles.length > 0)} onToggle={() => fold("msg-files", files.length + keptFiles.length > 0)}>
                                <div className="vc-tool-hint">
                                    {layout === "container"
                                        ? "Shown inside the last card — pictures and videos as a gallery, other files as downloads. "
                                        : "Shown under the embed. Editing a message only adds these; its old attachments stay. "}
                                    Files aren't saved with the draft.
                                </div>
                                {keptFiles.map((f, i) => (
                                    <div key={`kept-${f.id}`} className="vc-es2-file">
                                        <PaperclipIcon /><span>{f.filename}</span><small>already on the message</small>
                                        <IconButton title="Remove from the message when you update" danger onClick={() => removeKeptFile(i)}><CloseIcon /></IconButton>
                                    </div>
                                ))}
                                {files.map((f, i) => (
                                    <div key={i} className="vc-es2-file">
                                        <PaperclipIcon /><span>{f.name}</span>{picturedNames(embeds).has(f.name) && <small className="vc-es2-file-tag">picture in an embed</small>}<small>{f.size > 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${(f.size / 1024).toFixed(1)} KB`}</small>
                                        <IconButton title="Remove file" danger onClick={() => removeFile(i)}><CloseIcon /></IconButton>
                                    </div>
                                ))}
                                <label className="vc-es2-add">
                                    ＋ Attach files
                                    <input type="file" multiple style={{ display: "none" }} onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
                                </label>
                            </Card>
                        </>
                    )}
                </div>
            </div>

            <aside className="vc-es2-preview">
                <div className="vc-es2-preview-head">
                    <span>Live preview</span>
                    <small>{layout === "container" ? "Container" : "Classic embed"}{loadedMessageId ? " · editing" : ""}</small>
                </div>
                <div className="vc-es2-preview-body vc-embedsender-scroll">
                    <MessagePreview content={fill(content, previewCtx)} username={username} avatarUrl={avatarUrl} embeds={fillAll(embeds, previewCtx).map(e => ({ ...e, ...Object.fromEntries(PIC_KEYS.map(k => [k, picturePreview(e[k]) ?? e[k]])) }))} buttons={fillAll(buttons, previewCtx)} files={files.filter(f => !picturedNames(embeds).has(f.name))} keptFiles={keptFiles.filter(k => !picturedNames(embeds).has(k.filename))} layout={layout} />
                </div>
            </aside>
        </div>
    );

    const sendLabel = loadedMessageId ? "Update message" : "Send";
    const accent = windowAccent("embedSender");

    if (modalProps) {
        return (
            <ModalRoot {...modalProps} size={ModalSize.LARGE} className="vc-embedsender-modal">
                <style>{editorCss}</style>
                <Toast toast={toast} onClose={dismissToast} />
                <ModalHeader>
                    <div className="vc-embedsender-title">
                        <b>Embed Editor</b>
                        <span>Build a rich embed with a live preview, then send it through a webhook</span>
                    </div>
                    <ModalCloseButton onClick={modalProps.onClose} />
                </ModalHeader>
                <ModalContent>
                    <div className="vc-tool-wrap vc-embedsender-panel" style={{ padding: "4px 0 0", ...(accent ? { "--vc-tool-accent": accent } : {}) } as React.CSSProperties}>
                        {editorBody}
                        <div ref={setTestHost} className="vc-es-test-host" />
                    </div>
                </ModalContent>
                <ModalFooter>
                    <div className="vc-tool-footer" style={{ width: "100%" }}>
                        <span className="vc-tool-spacer" />
                        {testButton}
                        <Button onClick={() => setTab("schedule")}>⏰ Send later</Button>
                        <Button onClick={() => { persist(); modalProps.onClose(); }}>Save &amp; close</Button>
                        <Button color={Button.Colors.BRAND} onClick={handleSend}>{sendLabel}</Button>
                    </div>
                </ModalFooter>
            </ModalRoot>
        );
    }

    return (
        <div className="vc-tool-wrap vc-embedsender-panel" style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
            <style>{editorCss}</style>
            <Toast toast={toast} onClose={dismissToast} />
            {editorBody}
            <div ref={setTestHost} className="vc-es-test-host" />
            <div className="vc-embedsender-actions">
                <span className="vc-tool-hint" style={{ marginRight: "auto" }}>Draft saves automatically.</span>
                {testButton}
                <Button color={Button.Colors.BRAND} onClick={handleSend}>{sendLabel}</Button>
            </div>
        </div>
    );
}

/* ── Sending scheduled embeds ── */

/** Sends one scheduled embed. Returns whether it went. Updates the list (removes it, or moves a repeat to its next time). */
async function sendScheduled(item: Scheduled, manual = false): Promise<boolean> {
    const d = item.draft;
    const ctx = fillContext(await hookInfo(item.webhookUrl));
    const content = fill(d.content ?? "", ctx), embeds: EmbedDraft[] = fillAll(d.embeds ?? [], ctx), buttons: MessageButton[] = fillAll(d.buttons ?? [], ctx);
    const body: Record<string, any> = { username: d.username || undefined, avatar_url: d.avatarUrl || undefined };
    let withComponents = false;
    if ((d.layout ?? "container") === "container") {
        body.flags = IS_COMPONENTS_V2;
        body.components = buildContainerComponents(content, embeds, buttons, []);
        withComponents = true;
    } else {
        body.content = content || undefined;
        body.embeds = embeds.map(embedDraftToPayload).filter(e => Object.keys(e).length > 0);
        const components = buttonsToComponents(buttons);
        if (components) { body.components = components; withComponents = true; }
    }
    const url = item.webhookUrl + (withComponents ? "?with_components=true" : "");
    let ok = false, error = "";
    try {
        const res = await VencordNative.pluginHelpers.Sonata.sendWebhook(url, "POST", body);
        ok = res.ok;
        if (!ok) error = formatApiError(res.body, res.status);
    } catch (e: any) { error = String(e?.message ?? e); }

    const list = loadScheduled(settings.store.scheduledJson);
    const i = list.findIndex(x => x.id === item.id);
    if (i >= 0) {
        if (ok) {
            const next = manual && item.repeat !== "once" ? nextTime(item) : nextTime(item);
            if (next) list[i] = { ...list[i], at: next, lastError: undefined }; else list.splice(i, 1);
        } else list[i] = { ...list[i], lastError: error || "failed", at: Date.now() + 10 * 60_000 };
        settings.store.scheduledJson = JSON.stringify(list.sort((a, b) => a.at - b.at));
    }
    if (!manual) discordToast(ok ? `Embed Sender: sent “${item.label}”` : `Embed Sender couldn't send “${item.label}”: ${error}`, ok ? "success" : "failure");
    return ok;
}

let schedTimer: ReturnType<typeof setInterval> | undefined;
let schedBusy = false;
async function schedTick() {
    if (schedBusy) return;
    schedBusy = true;
    try {
        const now = Date.now();
        for (const item of loadScheduled(settings.store.scheduledJson)) {
            if (item.at > now) continue;
            // A repeat missed by more than an hour (Discord was closed) skips to its next time instead of firing late.
            if (item.repeat !== "once" && now - item.at > 3600_000) {
                const list = loadScheduled(settings.store.scheduledJson).map(x => x.id === item.id ? { ...x, at: nextTime(x, now)! } : x);
                settings.store.scheduledJson = JSON.stringify(list);
                continue;
            }
            await sendScheduled(item);
        }
    } finally { schedBusy = false; }
}

// EmbedSender's custom interface. Exposed as openSettingsModal — the hook
// ChannelSettings looks for — so a dock button added from its Dock tab (and
// the Plugins tab's "open" button) opens this window instead of the
// settings page.
function openEmbedEditor() {
    openModal(modalProps => <EmbedEditorPanel modalProps={modalProps} />);
}

/**
 * Open the editor filled with a message's text and embeds (API / Discohook
 * format), ready to edit and send through your webhook. Used by Sonata's
 * Embed Copier. Replaces the current draft but keeps your webhook URL.
 */
function openWithMessage({ content, embeds }: { content?: string | null; embeds: any[]; }) {
    const draft = loadDraft();
    saveDraft({
        ...draft,
        content: content ?? "",
        embeds: embeds.length ? embeds.slice(0, 10).map(apiEmbedToDraft) : [blankEmbed()],
        buttons: [],
        layout: "classic",
    });
    openEmbedEditor();
}

const plugin = definePlugin({
    name: "EmbedSender",
    description: "Build and send rich, bot-style embeds through a webhook, with a Discohook-style editor and live preview — link buttons and file attachments included. Open it with /embed, from the dock, or right here.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,
    openSettingsModal: openEmbedEditor,
    openWithMessage,

    start() {
        schedTimer = setInterval(schedTick, 20_000);
        setTimeout(schedTick, 5000);
    },
    stop() {
        clearInterval(schedTimer);
    },

    commands: [
        {
            name: "embed",
            description: "Open the embed editor",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute: () => {
                openEmbedEditor();
            },
        },
    ],
});

export default plugin;
