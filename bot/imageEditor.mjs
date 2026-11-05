/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { option, sub } from "./commandOptions.mjs";
import { channelPermissions, embed, fail, isId, PERMS, requirePermission } from "./discord.mjs";
import { actorId, button, rows } from "./interactionUI.mjs";
import { createGuildSticker, readDiscordFile, requireStickerCreator } from "./media.mjs";
import { CAPTION_STYLES, IMAGE_EFFECTS, IMAGE_INPUT_LIMIT, STICKER_LIMIT, captionOptions, imageUrl } from "./music/imageSource.mjs";

const caption = (name, description, required = false) => option(name, 3, description, required, { max_length: 160 });
const sourceFields = () => [option("url", 3, "Direct HTTPS Discord image URL", false, { max_length: 1000 }), option("image", 11, "Uploaded PNG, JPEG, WebP or GIF", false)];
export const IMAGE_OPTIONS = [
    sub("caption", "Caption an image and open an interactive editor", [caption("caption", "Top caption", true), caption("bottom", "Optional bottom caption"), option("togif", 5, "Return a looping GIF instead of a PNG", false), ...sourceFields()]),
    sub("gif", "Convert an image or animated GIF to a downloadable GIF", sourceFields()),
    sub("edit", "Open Media Studio for a Discord image or GIF", sourceFields()),
];
export const STICKER_MAKER = sub("make", "Preview and edit an image before creating a server sticker", [
    option("name", 3, "Sticker name", true, { min_length: 2, max_length: 30 }), ...sourceFields(),
]);
export const isImageCommand = command => command?.name === "download" && IMAGE_OPTIONS.some(option => option.name === command.sub)
    || command?.name === "sticker" && command.sub === "make";

async function inputImage(context) {
    const { command, actor, bot, roles, guild, channel, api } = context, o = command.options;
    if (o.image && o.url) fail("Choose an upload or an image URL.");
    if (o.image?.size > IMAGE_INPUT_LIMIT) fail("Use an image no larger than 8 MiB.");
    if (o.image || o.url) return imageUrl(o.image?.url || o.url);
    const reference = command.reply;
    if (!reference || !isId(reference.message_id) || (reference.guild_id && reference.guild_id !== guild.id) || (reference.channel_id && reference.channel_id !== channel.id)) fail("Upload an image, reply to one in this channel, or use a direct Discord image URL.");
    for (const member of [actor, bot]) requirePermission(channelPermissions(member, roles, guild, channel), PERMS.VIEW | PERMS.HISTORY);
    const message = await api("/channels/" + channel.id + "/messages/" + reference.message_id, { optional: true });
    const file = message?.attachments?.find(file => /^image\//.test(file.content_type || "") || /\.(png|jpe?g|webp|gif)$/i.test(file.filename));
    if (!file) fail("The replied-to message does not contain an uploaded image.");
    if (file.size > IMAGE_INPUT_LIMIT) fail("Use an image no larger than 8 MiB.");
    return imageUrl(file.url);
}

function imageSession(data, store, id) {
    const row = store.get("SELECT * FROM image_edits WHERE id=? AND guild=? AND channel=? AND actor=? AND expires>?", id, data.guild_id, data.channel_id, actorId(data), Date.now());
    if (!row) fail("This editor expired or belongs to the person who opened it.");
    return row;
}

const forms = {
    edit: { action: "text", title: "Edit image captions", fields: style => [["top", "Top caption", style.top, 160], ["bottom", "Bottom caption", style.bottom, 160]] },
    crop: { action: "croptext", title: "Crop image", fields: style => [["crop", "Left, top, width, height (%)", style.crop?.join(", ") || "", 20, "Example: 10, 15, 80, 70. Blank clears the crop."]] },
    resize: { action: "sizetext", title: "Resize image", fields: style => [["width", "Maximum width in pixels", String(style.width || ""), 4, "1 to 1600, or blank"], ["height", "Maximum height in pixels", String(style.height || ""), 4, "1 to 1600, or blank"]] },
    watermark: { action: "marktext", title: "Text watermark", fields: style => [["watermark", "Watermark text", style.watermark || "", 60, "Leave blank to remove the watermark"]] },
    background: { action: "keytext", title: "Remove a solid background", fields: style => [["key", "Background color in hex", style.key || "", 7, "Example: #ffffff (white). Blank restores it."]] },
};

export function imageForm(data, store) {
    const match = /^sncaption:([\da-f-]{36}):(edit|crop|resize|watermark|background)$/.exec(data.data.custom_id);
    if (!match) return;
    const [, id, action] = match, style = JSON.parse(imageSession(data, store, id).data);
    if (style.sticker && ["edit", "resize"].includes(action)) fail("Use crop to adjust the sticker's framing.");
    const form = forms[action];
    return { type: 9, data: {
        custom_id: `sncaption:${id}:${form.action}:${style.revision ?? 0}`,
        title: form.title,
        components: form.fields(style).map(([custom_id, label, value, max_length, placeholder]) => ({
            type: 18, label, component: { type: 4, custom_id, ...(value ? { value } : {}), ...(placeholder ? { placeholder } : {}), style: action === "edit" ? 2 : 1, required: false, max_length },
        })),
    } };
}

export function imageControlInvocation(data, store, id) {
    const state = JSON.parse(imageSession(data, store, id).data);
    if (state.mode === "make") return ["sticker", "make", { name: state.name }];
    if (state.mode === "edit") return ["download", "edit", {}];
    return ["download", "caption", { caption: "Editing an image" }];
}

function editorControls(id, style) {
    const key = "sncaption:" + id + ":";
    const styles = style.sticker ? IMAGE_EFFECTS : { ...CAPTION_STYLES, effect: IMAGE_EFFECTS.effect };
    const options = Object.entries(styles).flatMap(([group, choices]) => Object.entries(choices).map(([value, label]) => ({
        label: group[0].toUpperCase() + group.slice(1) + " · " + label,
        value: group + ":" + value,
        ...(style[group] === value ? { description: "Current" } : {}),
    })));
    const placeholder = style.sticker ? `Framing · ${IMAGE_EFFECTS.fit[style.fit]}` : `Style & effects · ${IMAGE_EFFECTS.effect[style.effect]}`;
    const format = button(key + "format", style.format === "gif" ? "Make PNG" : "Make GIF");
    const exportButton = button(key + "done", "Export", 3);
    const crop = button(key + "crop", style.crop ? "Edit crop" : "Crop");
    const undo = { ...button(key + "undo", "Undo"), disabled: !style.history?.length };
    const background = button(key + "background", style.key ? "Edit background" : "Remove background");
    const watermark = button(key + "watermark", style.watermark ? "Edit watermark" : "Watermark");
    return [
        { type: 1, components: [{ type: 3, custom_id: key + "style", placeholder, options }] },
        ...rows(style.sticker ? [crop, background, format, button(key + "publish", "Add to server", 1), exportButton]
            : [button(key + "edit", "Captions"), crop, button(key + "resize", "Resize"), format, exportButton]),
        ...rows(style.sticker ? [watermark, undo] : [background, watermark, undo]),
    ];
}

async function render(context, music, source, style, editor) {
    context.botPermission(PERMS.ATTACH, true);
    if (!music?.online()) fail("Image editing is offline. Try again when the media service reconnects.");
    const { command } = context;
    const result = await music.submit({ id: command.id, guild: command.guild, channel: command.channel, actor: command.actor, kind: "caption", source, style });
    if (!result.image) fail(result.description || "The image could not be rendered.");
    const label = style.sticker ? "sticker" : style.mode === "edit" ? "studio" : editor ? "caption" : "image";
    const output = { files: [{ name: `sonata-${label}.${result.format}`, type: "image/" + result.format, bytes: result.image }], allowed_mentions: { parse: [] } };
    if (editor) {
        output.content = style.sticker
            ? `**Sticker preview** · 320 × 320 · ${result.format.toUpperCase()} · ${Math.ceil(result.image.length / 1024)} KiB\nUse Add to server to publish this preview, or Export to keep the file.`
            : `**Media Studio** · ${result.format.toUpperCase()} preview`;
        output.components = editorControls(editor, style);
    }
    return output;
}

export async function imageCommand(context, store, music) {
    const { command } = context, o = command.options, editor = command.sub === "gif" ? null : crypto.randomUUID();
    const sticker = command.sub === "make", name = sticker ? o.name.trim() : "";
    if (sticker && name.length < 2) fail("Use a sticker name of two to 30 characters.");
    if (editor && store.get("SELECT COUNT(*) AS n FROM image_edits WHERE actor=? AND expires>?", command.actor, Date.now()).n >= 5) fail("Finish an open image editor before starting another.");
    const source = await inputImage(context);
    const style = { ...captionOptions({ top: o.caption, bottom: o.bottom, format: command.sub === "gif" || o.togif ? "gif" : "png", sticker }), mode: command.sub, name };
    const reply = await render(context, music, source, style, editor);
    if (editor) store.run("INSERT INTO image_edits VALUES (?,?,?,?,?,?,?)", editor, command.guild, command.channel, command.actor, source, JSON.stringify(style), Date.now() + 30 * 60_000);
    return reply;
}

export async function imageEdit(context, data, store, music, id, action, revision) {
    const row = imageSession(data, store, id);
    const state = JSON.parse(row.data);
    const close = () => store.run("DELETE FROM image_edits WHERE id=?", id);
    if (action === "done") return { content: `**${state.sticker ? "Sticker" : "Image"} exported** · ${state.format.toUpperCase()}`, components: [], onDelivered: close };
    if (action === "publish") {
        if (!state.sticker) fail("Open the sticker maker first.");
        requireStickerCreator(context);
        if (state.publishPending) fail("Check the server's sticker list before trying to add this sticker again.");
        const preview = data.message.attachments?.find(file => file.filename === `sonata-sticker.${state.format}`);
        if (!preview?.url || !preview.size || preview.size > STICKER_LIMIT || preview.width !== 320 || preview.height !== 320) fail("The sticker preview is unavailable. Render it again before publishing.");
        const file = await readDiscordFile(imageUrl(preview.url), STICKER_LIMIT);
        if (file.mime !== `image/${state.format}`) fail("The sticker preview has an unexpected format.");
        const claim = store.get("UPDATE image_edits SET data=? WHERE id=? AND data=? RETURNING id", JSON.stringify({ ...state, publishPending: true }), id, row.data);
        if (!claim) fail("The sticker preview changed. Use the latest controls.");
        let saved;
        try {
            saved = await createGuildSticker(context, state.name, file, "Made with Sonata");
        } catch (error) {
            if (error.status >= 400 && error.status < 500) store.run("UPDATE image_edits SET data=? WHERE id=?", row.data, id);
            throw error;
        }
        close();
        return { content: `**Sticker added** · ID ${saved.id}`, components: [], allowed_mentions: { parse: [] } };
    }
    const style = captionOptions(state), history = state.history ?? [];
    if (action === "format") style.format = style.format === "gif" ? "png" : "gif";
    if (action === "style") {
        const [group, value] = (data.data.values?.[0] || "").split(":");
        const choices = state.sticker ? IMAGE_EFFECTS : { ...CAPTION_STYLES, effect: IMAGE_EFFECTS.effect };
        if (data.data.component_type !== 3 || data.data.values?.length !== 1 || !Object.hasOwn(choices, group) || !Object.hasOwn(choices[group], value)) fail("Choose a supported image setting.");
        style[group] = value;
    }
    if (action.endsWith("text")) {
        if (data.type !== 5 || !data.message || Number(revision ?? 0) !== (state.revision ?? 0)) fail("Open the editor again to update the latest preview.");
        const fields = Object.fromEntries(data.data.components.flatMap(row => row.component ? [row.component] : row.components ?? []).map(field => [field.custom_id, field.value?.trim() ?? ""]));
        if (action === "text" && !state.sticker) { style.top = fields.top ?? ""; style.bottom = fields.bottom ?? ""; }
        if (action === "croptext") {
            if (fields.crop && !/^\d{1,3}(?:\s*,\s*\d{1,3}){3}$/.test(fields.crop)) fail("Enter four comma-separated crop percentages.");
            style.crop = fields.crop ? fields.crop.split(",").map(Number) : null;
        }
        if (action === "sizetext" && !state.sticker) {
            for (const key of ["width", "height"]) {
                if (fields[key] && !/^[1-9]\d{0,3}$/.test(fields[key])) fail("Enter a whole number from 1 to 1600, or leave it blank.");
                style[key] = Number(fields[key] || 0);
            }
        }
        if (action === "marktext") style.watermark = fields.watermark ?? "";
        if (action === "keytext") style.key = (fields.key ?? "").replace(/^#/, "");
    }
    if (action === "undo" && !history.length) fail("There is no edit to undo.");
    const previous = captionOptions(state), updated = action === "undo" ? captionOptions(history.at(-1)) : captionOptions(style);
    const nextHistory = action === "undo" ? history.slice(0, -1) : JSON.stringify(updated) === JSON.stringify(previous) ? history : [...history, previous].slice(-12);
    const next = { ...updated, mode: state.mode, name: state.name, publishPending: state.publishPending, history: nextHistory, revision: (state.revision ?? 0) + 1 };
    const reply = await render(context, music, row.source, next, id);
    return { ...reply, onDelivered: () => store.run("UPDATE image_edits SET data=? WHERE id=?", JSON.stringify(next), id) };
}
