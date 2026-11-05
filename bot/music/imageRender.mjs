/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { captionOptions, imageFormat, imageUrl, IMAGE_INPUT_LIMIT, IMAGE_OUTPUT_LIMIT, STICKER_LIMIT } from "./imageSource.mjs";

const run = promisify(execFile);
const fonts = { bold: "DejaVuSans-Bold.ttf", serif: "DejaVuSerif-Bold.ttf", mono: "DejaVuSansMono-Bold.ttf" };
const colors = { paper: ["0xf6f2ed", "0x211e21"], dark: ["0x222125", "0xfaf6f4"], rose: ["0xeacdd0", "0x2d2026"] };
const ratios = { small: 0.042, medium: 0.056, large: 0.073 };
function wrap(text, columns) {
    const lines = []; let line = "";
    const width = value => [...value].reduce((n, char) => n + (char.codePointAt(0) >= 0x2e80 ? 1.6 : /[MW@%]/.test(char) ? 1.45 : 1), 0);
    for (const paragraph of text.split(/\r?\n/)) {
        for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
            if (line && width(line + " " + word) > columns) { lines.push(line); line = ""; }
            if (line) line += " ";
            for (const char of word) { if (width(line + char) > columns) { lines.push(line); line = ""; } line += char; }
        }
        if (line) { lines.push(line); line = ""; }
    }
    return lines;
}

export async function renderImage(source, options, transport = fetch, fontRoot = process.env.SONATA_FONT_DIR || "/usr/share/fonts/truetype/dejavu") {
    const style = captionOptions(options), url = imageUrl(source);
    const response = await transport(url, { redirect: "manual", signal: AbortSignal.timeout(12_000) });
    if (!response.ok || !response.body) throw new Error("That image is unavailable. Upload it again or use a fresh Discord image link.");
    if (Number(response.headers.get("content-length")) > IMAGE_INPUT_LIMIT) { await response.body.cancel(); throw new Error("Use an image no larger than 8 MiB."); }
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > IMAGE_INPUT_LIMIT) throw new Error("Use an image no larger than 8 MiB."); chunks.push(chunk); }
    const input = Buffer.concat(chunks), format = imageFormat(input);
    if (!format) throw new Error("Use a PNG, JPEG, WebP or GIF image.");
    const dir = await mkdtemp(join(tmpdir(), "sonata-image-")), file = "input." + format, output = "output." + style.format;
    try {
        await writeFile(join(dir, file), input);
        const opts = { cwd: dir, windowsHide: true, timeout: 8000, maxBuffer: 32_768 };
        let stream;
        try {
            const meta = await run("ffprobe", ["-v", "error", "-protocol_whitelist", "file", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", file], opts);
            [stream] = JSON.parse(meta.stdout).streams;
        } catch { throw new Error("This image could not be read."); }
        const w = stream?.width, h = stream?.height;
        if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 4096 || h > 4096) throw new Error("Choose an image up to 4096 by 4096 pixels.");
        const animated = style.format === "gif" && format === "gif";
        const limit = style.sticker ? STICKER_LIMIT : IMAGE_OUTPUT_LIMIT;
        const duration = style.sticker ? "4.8" : "8";
        const filters = ["format=rgba"];
        let sourceWidth = w, sourceHeight = h;
        if (style.crop) {
            const [left, top, spanWidth, spanHeight] = style.crop;
            const x = Math.floor(w * left / 100), y = Math.floor(h * top / 100);
            sourceWidth = Math.max(1, Math.floor(w * (left + spanWidth) / 100) - x);
            sourceHeight = Math.max(1, Math.floor(h * (top + spanHeight) / 100) - y);
            filters.push(`crop=${sourceWidth}:${sourceHeight}:${x}:${y}:exact=1`);
        }
        if (style.sticker && style.fit === "cover") {
            const side = Math.min(sourceWidth, sourceHeight);
            filters.push(`crop=${side}:${side}:exact=1`);
            sourceWidth = sourceHeight = side;
        }
        if (style.key) filters.push(`colorkey=0x${style.key}:0.19:0.06`);
        const maximum = style.format === "gif" ? 560 : 960;
        const resize = style.width || style.height;
        const scale = style.sticker ? 320 / Math.max(sourceWidth, sourceHeight)
            : resize ? Math.min((style.width || 1600) / sourceWidth, (style.height || 1600) / sourceHeight)
            : Math.min(maximum / Math.max(sourceWidth, sourceHeight), Math.max(1, 360 / sourceWidth));
        const width = Math.max(1, Math.round(sourceWidth * scale)), height = Math.max(1, Math.round(sourceHeight * scale));
        const hasCaption = !style.sticker && !!(style.top || style.bottom);
        filters.push(`scale=${width}:${height}:flags=lanczos`, "setsar=1");
        if (style.effect === "blur") filters.push("gblur=sigma=7:planes=7");
        if (style.effect === "pixelate") {
            const reducedWidth = Math.max(1, Math.round(width / 10)), reducedHeight = Math.max(1, Math.round(height / 10));
            filters.push(`scale=${reducedWidth}:${reducedHeight}:flags=area`, `scale=${width}:${height}:flags=neighbor`);
        }
        if (style.sticker) filters.push("pad=320:320:(ow-iw)/2:(oh-ih)/2:color=black@0");
        const canvas = hasCaption ? Math.max(360, width) : width, size = Math.max(16, Math.floor(canvas * ratios[style.size])), margin = Math.max(14, Math.round(size * 0.55));
        const columns = Math.max(8, Math.floor((canvas - 2 * margin) / (size * 0.66))), top = wrap(style.top, columns), bottom = wrap(style.bottom, columns);
        const bar = lines => lines.length ? Math.ceil(lines.length * size * 1.22 + margin * 2) : 0, above = bar(top), below = bar(bottom), [background, ink] = colors[style.theme];
        if (hasCaption || style.watermark) await writeFile(join(dir, "font.ttf"), await readFile(join(fontRoot, fonts[style.font])));
        if (hasCaption) {
            filters.push("pad=" + canvas + ":" + (height + above + below) + ":(ow-iw)/2:" + above + ":" + background);
            for (const [name, lines, y, area] of [["top", top, 0, above], ["bottom", bottom, height + above, below]]) if (lines.length) {
                await writeFile(join(dir, name + ".txt"), lines.join("\n"));
                filters.push("drawtext=fontfile=font.ttf:textfile=" + name + ".txt:expansion=none:fontsize=" + size + ":fontcolor=" + ink + ":line_spacing=" + Math.round(size * 0.19) + ":x=(w-tw)/2:y=" + y + "+(" + area + "-th)/2");
            }
        }
        if (style.watermark) {
            const markWidth = style.sticker ? 320 : canvas;
            const markSize = Math.max(1, Math.min(36, Math.floor(markWidth * 0.045), Math.floor((markWidth - 8) / Math.max(1, [...style.watermark].length))));
            await writeFile(join(dir, "watermark.txt"), style.watermark);
            filters.push(`drawtext=fontfile=font.ttf:textfile=watermark.txt:expansion=none:fontsize=${markSize}:fontcolor=white@0.9:box=1:boxcolor=black@0.6:boxborderw=3:x=max(3\\,w-tw-8):y=max(3\\,h-th-8)`);
        }
        const qualities = style.sticker && animated ? [[10, 256], [5, 64], [4, 24]] : [[12, 256]];
        const deadline = Date.now() + 24_000;
        for (const [fps, colors] of qualities) {
            const filter = [...(animated ? [`fps=${fps}`] : []), ...filters].join(",")
                + (style.format === "gif" ? `,split[a][b];[a]palettegen=max_colors=${colors}[p];[b][p]paletteuse=dither=bayer` : "");
            try {
                const timing = animated ? ["-t", duration] : ["-frames:v", "1"];
                const gifOptions = style.format === "gif" ? ["-loop", "0", ...(style.sticker ? ["-final_delay", String(Math.floor(100 / fps))] : [])] : [];
                await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "file", "-threads", "1", ...(animated ? timing : []), "-i", file, "-filter_complex_threads", "1", "-filter_complex", filter, ...timing, ...gifOptions, "-fs", String(limit + 1), "-threads", "1", output], { ...opts, timeout: Math.max(1, deadline - Date.now()) });
            } catch { throw new Error("Sonata could not render this image. Try a smaller image or another format."); }
            if ((await stat(join(dir, output))).size > limit) continue;
            const image = await readFile(join(dir, output));
            if (imageFormat(image) === style.format && (style.format !== "gif" || image.at(-1) === 59)) return { title: "Image ready", description: "", image, format: style.format };
        }
        throw new Error(style.sticker ? "The sticker exceeds 512 KiB. Use PNG or a simpler GIF." : "The image exceeds the 6 MiB output limit. Try a smaller image.");
    } finally {
        for (const name of await readdir(dir)) await unlink(join(dir, name));
        await rmdir(dir);
    }
}
