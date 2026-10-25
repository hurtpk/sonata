/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Turning the project into a finished MP4 — with the same ffmpeg File
// Converter uses, on this computer. One run does everything; looping is a
// second, instant run that copies the result a few times without re-encoding.

import { shutdown, Status, withFfmpeg } from "../fileConverter/media";
import { captionPng } from "./captions";
import { allCaptions, buildPlan, ClipInfo, encoding, outputSize, parseProbe, Project, totalLength } from "./project";

export interface Exported { blob: Blob; name: string; seconds: number; note?: string; gif?: boolean; }

/** GIF settings: how wide, how smooth, and whether to shrink it to fit Discord's 10 MB. */
export interface GifOptions { width: number; fps: number; fit10: boolean; }

const extOf = (name: string) => /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase() ?? "mp4";

export function stopExport() { shutdown(); }

export function exportVideo(p: Project, status: Status, gif?: GifOptions): Promise<Exported> {
    // A GIF is made from the best-quality video, so it isn't squeezed twice.
    if (gif) p = { ...p, size: "best" };
    if (!p.clips.length || totalLength(p) < 0.1) return Promise.reject(new Error("There's nothing left to export."));
    return withFfmpeg(async (f, why, takeLog) => {
        const written: string[] = [];
        const write = async (name: string, data: Blob | Uint8Array) => {
            await f.writeFile(name, data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer()));
            written.push(name);
            return name;
        };
        try {
            // The clips (and what's in them: size, frame rate, sound).
            status("Reading your clips…");
            const names: string[] = [];
            const infos: ClipInfo[] = [];
            for (const [i, c] of p.clips.entries()) {
                const name = await write(`ve_c${i}.${extOf(c.name)}`, c.file);
                names.push(name);
                takeLog();
                await f.exec(["-hide_banner", "-i", name]).catch(() => { });
                const info = parseProbe(takeLog());
                infos.push({ width: info.width || c.width, height: info.height || c.height, fps: info.fps, hasAudio: info.hasAudio });
            }
            const out = outputSize(p, infos);
            const inputs = names.flatMap(n => ["-i", n]);
            if (p.music) inputs.push("-i", await write(`ve_m.${extOf(p.music.name)}`, p.music.file));
            // Pictures and videos laid over it (GIFs keep looping; videos are checked for sound).
            const overlayAudio: boolean[] = [];
            for (const [i, o] of p.overlays.entries()) {
                const name = await write(`ve_o${i}.${extOf(o.name)}`, o.file);
                if (o.kind === "video") {
                    takeLog();
                    await f.exec(["-hide_banner", "-i", name]).catch(() => { });
                    overlayAudio.push(parseProbe(takeLog()).hasAudio);
                } else overlayAudio.push(false);
                inputs.push(...(o.kind === "gif" ? ["-ignore_loop", "0"] : []), "-i", name);
            }
            for (const [i, t] of allCaptions(p).entries()) {
                status("Drawing captions…");
                inputs.push("-i", await write(`ve_t${i}.png`, await captionPng(t, out.width, out.height)));
            }

            const plan = buildPlan(p, infos, out, overlayAudio);
            const enc = encoding(p, plan.seconds * p.loops, plan.hasAudio);
            const onProgress = ({ time }: { time: number; }) => {
                const done = time / 1e6 / plan.seconds;
                if (done >= 0 && done <= 1) status(`Making your video… ${Math.round(done * 100)}%`, done);
            };
            f.on("progress", onProgress);
            status("Making your video…", 0);
            takeLog();
            written.push("ve_out.mp4");
            let code: number;
            try {
                code = await f.exec(["-hide_banner", ...inputs, "-filter_complex", plan.filter, ...plan.maps, ...enc.video, ...enc.audio, "-movflags", "+faststart", "ve_out.mp4"]);
            } finally {
                f.off("progress", onProgress);
            }
            if (code !== 0) throw new Error(why());

            let final = "ve_out.mp4";
            if (p.loops > 1) {
                status("Looping it…");
                written.push("ve_loop.mp4");
                const c2 = await f.exec(["-hide_banner", "-stream_loop", String(p.loops - 1), "-i", "ve_out.mp4", "-c", "copy", "-movflags", "+faststart", "ve_loop.mp4"]);
                if (c2 !== 0) throw new Error(why());
                final = "ve_loop.mp4";
            }

            if (gif) {
                // Two passes in one: pick the best 256 colours for this clip, then draw it with them.
                const tries: [number, number][] = gif.fit10
                    ? [[gif.width, gif.fps], [Math.round(gif.width * 0.8), gif.fps], [Math.round(gif.width * 0.65), Math.max(8, Math.round(gif.fps * 0.75))], [Math.round(gif.width * 0.5), Math.max(8, Math.round(gif.fps * 0.6))]]
                    : [[gif.width, gif.fps]];
                let made: Uint8Array | null = null, used = tries[0];
                for (const [i, [w, fps]] of tries.entries()) {
                    status(i ? `Making it smaller to fit 10 MB… (try ${i + 1})` : "Turning it into a GIF…");
                    written.push("ve_out.gif");
                    const scale = w > 0 ? `scale='min(${w},iw)':-2:flags=lanczos,` : "";
                    const c3 = await f.exec(["-hide_banner", "-i", final, "-vf", `fps=${fps},${scale}split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, "-loop", "0", "-y", "ve_out.gif"]);
                    if (c3 !== 0) throw new Error(why());
                    const out = await f.readFile("ve_out.gif");
                    if (!(out instanceof Uint8Array) || !out.byteLength) throw new Error("The GIF came out empty");
                    made = out; used = [w, fps];
                    if (!gif.fit10 || out.byteLength <= 10 * 1048576) break;
                }
                const blob = new Blob([made as BlobPart], { type: "image/gif" });
                const over = gif.fit10 && blob.size > 10 * 1048576;
                const base = p.clips[0].name.replace(/.[^.]+$/, "") || "video";
                return {
                    blob, name: `${base}.gif`, seconds: plan.seconds * p.loops, gif: true,
                    note: over ? `It's still ${(blob.size / 1048576).toFixed(1)} MB — try a shorter clip.` : used[0] !== gif.width || used[1] !== gif.fps ? `Made at ${used[0]}px wide and ${used[1]} fps so it fits under 10 MB.` : undefined,
                };
            }

            const data = await f.readFile(final);
            if (!(data instanceof Uint8Array) || !data.byteLength) throw new Error("The video came out empty");
            const blob = new Blob([data as BlobPart], { type: "video/mp4" });
            let { note } = enc;
            if (typeof p.size === "number" && blob.size > p.size * 1048576) note = `It came out at ${(blob.size / 1048576).toFixed(1)} MB — a little over ${p.size} MB. Try a smaller size or a shorter clip.`;
            const base = p.clips[0].name.replace(/\.[^.]+$/, "") || "video";
            return { blob, name: `${base}-edited.mp4`, seconds: plan.seconds * p.loops, note };
        } finally {
            for (const name of written) await f.deleteFile(name).catch(() => { });
        }
    }, status);
}
