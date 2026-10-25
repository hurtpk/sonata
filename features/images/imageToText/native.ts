/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Text recognition (OCR) using what's already on your computer — nothing to
// install, nothing uploaded anywhere:
//   Windows 10/11: the built-in Windows OCR engine (Windows.Media.Ocr), via
//                  Windows PowerShell 5.1 (PowerShell 7 can't reach it).
//   Linux:         the `tesseract` command, if it's installed.
//   macOS:         not supported (no built-in engine reachable from here).

import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { app, IpcMainInvokeEvent } from "electron";
import { unlink, writeFile } from "fs/promises";
import { join } from "path";

import { downloadDiscordFile } from "../../filePreviews/filePreviewer/native";

const TIMEOUT_MS = 30_000;

/** Windows OCR. Reads the image path from $env:OPTICORD_OCR_PATH (never put into the script text). */
export const WINDOWS_OCR_SCRIPT = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    // Report the real reason on one plain stderr line (an async failure otherwise just says "One or more errors occurred").
    "trap { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; [Console]::Error.WriteLine($e.Message); exit 1 }",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
    "$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]",
    "$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]",
    "$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]",
    "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {",
    "    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'",
    "})[0]",
    "function Await($op, [Type]$type) {",
    "    $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))",
    "    $task.Wait(-1) | Out-Null",
    "    $task.Result",
    "}",
    "$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()",
    "if ($null -eq $engine) { [Console]::Error.WriteLine('NO_OCR_LANGUAGE'); exit 3 }",
    "$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:OPTICORD_OCR_PATH)) ([Windows.Storage.StorageFile])",
    "$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])",
    "$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])",
    // Windows OCR misses small text (like a chat screenshot), so enlarge small images; also shrink anything over its size limit.
    "$max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension",
    "$longest = [Math]::Max($decoder.PixelWidth, $decoder.PixelHeight)",
    "$scale = [Math]::Min($(if ($longest -lt 1600) { 2.0 } else { 1.0 }), $max / $longest)",
    "$transform = New-Object Windows.Graphics.Imaging.BitmapTransform",
    "$transform.ScaledWidth = [uint32][Math]::Floor($decoder.PixelWidth * $scale)",
    "$transform.ScaledHeight = [uint32][Math]::Floor($decoder.PixelHeight * $scale)",
    "$transform.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Fant",
    "$bitmap = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])",
    "$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])",
    "$result.Lines | ForEach-Object { $_.Text }",
    "",
].join("\n");

interface Run { code: number | null; stdout: string; stderr: string; }

export function runProcess(cmd: string, args: string[], opts: { input?: string; env?: Record<string, string>; timeoutMs?: number; } = {}): Promise<Run> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { env: { ...process.env, ...opts.env }, windowsHide: true });
        let stdout = "", stderr = "";
        const timer = setTimeout(() => { child.kill(); reject(new Error("Text recognition took too long")); }, opts.timeoutMs ?? TIMEOUT_MS);
        child.stdout.on("data", d => { stdout += d; });
        child.stderr.on("data", d => { stderr += d; });
        child.on("error", e => { clearTimeout(timer); reject(e); });
        child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
        child.stdin.on("error", () => { });
        child.stdin.end(opts.input ?? "");
    });
}

/**
 * Ask Discord's media proxy for a full-size PNG, which every OCR engine can read (WebP isn't always supported).
 * The menu usually hands us the chat thumbnail (?width=…&height=…), which is too small to read text from.
 */
export function asPngUrl(url: string) {
    try {
        const u = new URL(url);
        if (u.hostname === "cdn.discordapp.com" && u.pathname.startsWith("/attachments/")) u.hostname = "media.discordapp.net";
        if (u.hostname === "media.discordapp.net" || /^images-ext-\d+\.discordapp\.net$/.test(u.hostname)) {
            for (const p of ["width", "height", "quality"]) u.searchParams.delete(p);
            u.searchParams.set("format", "png");
        }
        return u.toString();
    } catch {
        return url;
    }
}

export async function recognize(path: string, platform: string = process.platform): Promise<string> {
    if (platform === "win32") {
        // Not "-Command -": PowerShell reads stdin one line at a time, skips the multi-line blocks and exits 0 with no output.
        const run = await runProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(WINDOWS_OCR_SCRIPT, "utf16le").toString("base64")], {
            env: { OPTICORD_OCR_PATH: path },
        });
        if (run.stderr.includes("NO_OCR_LANGUAGE"))
            throw new Error("Windows has no text-recognition language installed. Add one in Settings → Time & language → Language & region (with \"Optical character recognition\").");
        // -EncodedCommand wraps PowerShell's own stderr output in CLIXML; keep only the plain lines.
        const error = run.stderr.replace(/#< CLIXML|<Objs[\s\S]*?<\/Objs>/g, "").trim().split("\n").pop()?.trim();
        if (run.code !== 0) throw new Error(error || "Windows text recognition failed");
        return run.stdout;
    }
    if (platform === "darwin") {
        throw new Error("Image to Text isn't supported on macOS yet.");
    }
    try {
        const run = await runProcess("tesseract", [path, "-"]);
        if (run.code !== 0) throw new Error(run.stderr.trim().split("\n").pop() || "tesseract failed");
        return run.stdout;
    } catch (e: any) {
        if (e?.code === "ENOENT") throw new Error("Install the \"tesseract\" package to use Image to Text on Linux.");
        throw e;
    }
}

export async function recognizeText(_: IpcMainInvokeEvent, url: string): Promise<{ ok: true; text: string; } | { ok: false; error: string; }> {
    const path = join(app.getPath("temp"), `opticord-ocr-${randomUUID()}.png`);
    try {
        await writeFile(path, await downloadDiscordFile(asPngUrl(url), 25 * 1048576));
        const text = (await recognize(path)).replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
        return { ok: true, text };
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
    } finally {
        unlink(path).catch(() => { });
    }
}
