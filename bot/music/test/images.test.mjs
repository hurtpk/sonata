/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderImage } from "../imageRender.mjs";
import { captionOptions, imageFormat, imageUrl } from "../imageSource.mjs";

const source = "https://cdn.discordapp.com/attachments/111111111111111111/222222222222222222/test.png";
test("Image jobs accept Discord assets and only declared styles", () => {
    assert.equal(imageUrl(source), source);
    for (const url of ["file:///etc/passwd", "http://127.0.0.1/test.png", "https://cdn.discordapp.com.evil.test/attachments/x", "https://user:pass@cdn.discordapp.com/attachments/x"]) assert.throws(() => imageUrl(url));
    for (const options of [{ font: "../font" }, { theme: "red:drawtext" }, { top: "x".repeat(161) }]) assert.throws(() => captionOptions(options));
});

test("Animated sticker output fits Discord's duration, dimensions and byte limits", async t => {
    if (spawnSync("ffmpeg", ["-version"]).error?.code === "ENOENT") { t.skip("FFmpeg verified on the media host."); return; }
    const gif = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=180x160:rate=12", "-frames:v", "84", "-threads", "1", "-c:v", "gif", "-f", "gif", "pipe:1"]);
    const { image } = await renderImage(source, { sticker: true, format: "gif", fit: "cover" }, async () => new Response(gif));
    assert.ok(image.length <= 512 * 1024);
    const dir = await mkdtemp(join(tmpdir(), "sonata-sticker-test-")), file = join(dir, "sticker.gif");
    await writeFile(file, image);
    t.after(async () => { await unlink(file); await rmdir(dir); });
    const probe = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=width,height,duration,nb_read_frames", "-of", "json", file]);
    const [stream] = JSON.parse(probe).streams;
    assert.deepEqual([stream.width, stream.height], [320, 320]);
    assert.ok(Number(stream.duration) <= 5);
    assert.ok(Number(stream.nb_read_frames) > 1);
});

test("Image renderer produces captioned PNG and a valid GIF from real image bytes", async t => {
    if (spawnSync("ffmpeg", ["-version"]).error?.code === "ENOENT") { t.skip("FFmpeg verified on the media host."); return; }
    const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
    let fontRoot;
    if (!existsSync(font) && existsSync("C:/Windows/Fonts/arialbd.ttf")) {
        fontRoot = await mkdtemp(join(tmpdir(), "sonata-font-test-"));
        const file = join(fontRoot, "DejaVuSans-Bold.ttf");
        await copyFile("C:/Windows/Fonts/arialbd.ttf", file);
        t.after(async () => { await unlink(file); await rmdir(fontRoot); });
    } else if (!existsSync(font)) { t.skip("Caption fonts verified on the media host."); return; }
    const png = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=480x240:rate=1", "-frames:v", "1", "-threads", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"]);
    const fetchImage = async () => new Response(png);
    const caption = await renderImage(source, { top: "Weekend mood", bottom: "100% ready · %{localtime}", theme: "rose" }, fetchImage, fontRoot);
    assert.equal(imageFormat(caption.image), "png");
    assert.equal(caption.image.readUInt32BE(16), 480);
    assert.ok(caption.image.readUInt32BE(20) > 300);
    const gif = await renderImage(source, { format: "gif" }, fetchImage, fontRoot);
    assert.equal(imageFormat(gif.image), "gif"); assert.equal(gif.image.at(-1), 59);
    const edited = await renderImage(source, { crop: [25, 0, 50, 50], width: 120, effect: "pixelate", watermark: "100% Sonata" }, fetchImage, fontRoot);
    assert.equal(edited.image.readUInt32BE(16), 120);
    assert.equal(edited.image.readUInt32BE(20), 60);
    const green = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=0x00ff00:size=128x64,drawbox=x=48:y=16:w=32:h=32:color=red:t=fill", "-frames:v", "1", "-threads", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1"]);
    const sticker = await renderImage(source, { sticker: true, key: "00ff00" }, async () => new Response(green), fontRoot);
    assert.equal(sticker.image.readUInt32BE(16), 320);
    assert.equal(sticker.image.readUInt32BE(20), 320);
    assert.ok(sticker.image.length <= 512 * 1024);
    const pixels = execFileSync("ffmpeg", ["-v", "error", "-f", "image2pipe", "-i", "pipe:0", "-frames:v", "1", "-threads", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"], { input: sticker.image });
    assert.equal(pixels[(160 * 320 + 20) * 4 + 3], 0);
    assert.equal(pixels[(160 * 320 + 160) * 4 + 3], 255);
    await assert.rejects(renderImage(source, {}, async () => new Response("Not an image")), /PNG, JPEG, WebP or GIF/);
});
