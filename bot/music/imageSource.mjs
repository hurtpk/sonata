/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const IMAGE_INPUT_LIMIT = 8 * 1024 * 1024;
export const IMAGE_OUTPUT_LIMIT = 6 * 1024 * 1024;
export const STICKER_LIMIT = 512 * 1024;
export const IMAGE_EFFECTS = {
    effect: { none: "Original", blur: "Blur", pixelate: "Pixelate" },
    fit: { contain: "Fit inside square", cover: "Fill square" },
};
export const CAPTION_STYLES = {
    font: { bold: "Bold", serif: "Serif", mono: "Mono" },
    size: { small: "Small", medium: "Medium", large: "Large" },
    theme: { paper: "Paper", dark: "Dark", rose: "Rose" },
};
export function imageUrl(raw) {
    let url;
    try { url = new URL(raw); } catch { throw new Error("Upload an image or use a direct Discord image URL."); }
    if (!["https://cdn.discordapp.com", "https://media.discordapp.net"].includes(url.origin) || url.username || url.password || !/^\/(?:attachments|avatars|icons|emojis|banners)\//.test(url.pathname) || url.href.length > 2000) throw new Error("Use a direct HTTPS Discord image URL.");
    return url.href;
}
export function imageFormat(bytes) {
    if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) return "png";
    if (bytes.length >= 14 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56 && [55,57].includes(bytes[4]) && bytes[5] === 97) return "gif";
    if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
    if (bytes.length >= 12 && [82,73,70,70].every((value,i) => bytes[i] === value) && [87,69,66,80].every((value,i) => bytes[i + 8] === value)) return "webp";
}
export function captionOptions(value = {}) {
    const { top = "", bottom = "", font = "bold", size = "medium", theme = "paper", format = "png", crop = null, width = 0, height = 0, effect = "none", watermark = "", key = "", fit = "contain", sticker = false } = value;
    if (![top, bottom].every(text => typeof text === "string" && text.length <= 160) || !Object.hasOwn(CAPTION_STYLES.font, font) || !Object.hasOwn(CAPTION_STYLES.size, size) || !Object.hasOwn(CAPTION_STYLES.theme, theme) || !["png", "gif"].includes(format)) throw new Error("Choose a supported caption style and text of up to 160 characters per caption.");
    if (crop !== null && (!Array.isArray(crop) || crop.length !== 4 || !crop.every(Number.isInteger) || crop[0] < 0 || crop[1] < 0 || crop[2] < 1 || crop[3] < 1 || crop[0] + crop[2] > 100 || crop[1] + crop[3] > 100)) throw new Error("Use four crop percentages: left, top, width and height. Keep the rectangle inside the image.");
    if (![width, height].every(value => Number.isInteger(value) && value >= 0 && value <= 1600)) throw new Error("Enter a width or height from 1 to 1600 pixels, or leave it blank.");
    if (!Object.hasOwn(IMAGE_EFFECTS.effect, effect) || !Object.hasOwn(IMAGE_EFFECTS.fit, fit) || typeof sticker !== "boolean" || typeof watermark !== "string" || watermark.length > 60 || typeof key !== "string" || (key && !/^[a-f\d]{6}$/i.test(key))) throw new Error("Choose a supported effect, a six-digit background color, or a watermark up to 60 characters.");
    return { top: top.trim(), bottom: bottom.trim(), font, size, theme, format, crop, width, height, effect, watermark: watermark.trim().replace(/\s+/g, " "), key, fit, sticker };
}
