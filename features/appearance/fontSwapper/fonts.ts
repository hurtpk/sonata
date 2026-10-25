/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The fonts Font Swapper offers. "Installed" ones come with Windows (or most
// computers); "web" ones are downloaded once from Fontsource on jsDelivr (one
// of the few font sources Discord lets through), pinned to an exact version.

export interface FontChoice {
    id: string;
    name: string;
    /** The CSS font-family stack. */
    stack: string;
    kind: "discord" | "installed" | "web" | "code";
    /** For web fonts: the Fontsource package and the weights it has. */
    pkg?: string;
    weights?: number[];
    blurb?: string;
}

const FONTSOURCE_VERSION = "5.3.0";
const SANS = "\"gg sans\", \"Noto Sans\", sans-serif";

export const FONTS: FontChoice[] = [
    { id: "discord", name: "Discord's own (gg sans)", stack: "", kind: "discord" },

    { id: "inter", name: "Inter", stack: `"Inter", ${SANS}`, kind: "web", pkg: "inter", weights: [400, 500, 600, 700], blurb: "Clean and very readable — made for screens." },
    { id: "atkinson", name: "Atkinson Hyperlegible", stack: `"Atkinson Hyperlegible", ${SANS}`, kind: "web", pkg: "atkinson-hyperlegible", weights: [400, 700], blurb: "Designed so every letter is easy to tell apart (low vision friendly)." },
    { id: "lexend", name: "Lexend", stack: `"Lexend", ${SANS}`, kind: "web", pkg: "lexend", weights: [400, 500, 600, 700], blurb: "Wide and calm; made to help reading speed." },
    { id: "opendyslexic", name: "OpenDyslexic", stack: `"OpenDyslexic", ${SANS}`, kind: "web", pkg: "opendyslexic", weights: [400, 700], blurb: "Heavier letter bottoms that help some people with dyslexia." },
    { id: "nunito", name: "Nunito", stack: `"Nunito", ${SANS}`, kind: "web", pkg: "nunito", weights: [400, 500, 600, 700], blurb: "Soft and rounded." },
    { id: "quicksand", name: "Quicksand", stack: `"Quicksand", ${SANS}`, kind: "web", pkg: "quicksand", weights: [400, 500, 600, 700], blurb: "Light and rounded." },
    { id: "poppins", name: "Poppins", stack: `"Poppins", ${SANS}`, kind: "web", pkg: "poppins", weights: [400, 500, 600, 700], blurb: "Geometric and bold." },
    { id: "outfit", name: "Outfit", stack: `"Outfit", ${SANS}`, kind: "web", pkg: "outfit", weights: [400, 500, 600, 700], blurb: "Modern and tidy." },
    { id: "roboto", name: "Roboto", stack: `"Roboto", ${SANS}`, kind: "web", pkg: "roboto", weights: [400, 500, 700], blurb: "Android's font." },
    { id: "comicneue", name: "Comic Neue", stack: `"Comic Neue", ${SANS}`, kind: "web", pkg: "comic-neue", weights: [400, 700], blurb: "Comic Sans, grown up." },
    { id: "merriweather", name: "Merriweather", stack: "\"Merriweather\", Georgia, serif", kind: "web", pkg: "merriweather", weights: [400, 700], blurb: "A serif made for reading on screens." },
    { id: "lora", name: "Lora", stack: "\"Lora\", Georgia, serif", kind: "web", pkg: "lora", weights: [400, 500, 600, 700], blurb: "An elegant book serif." },
    { id: "sourceserif", name: "Source Serif", stack: "\"Source Serif 4\", Georgia, serif", kind: "web", pkg: "source-serif-4", weights: [400, 600, 700], blurb: "A sharp, modern serif." },

    { id: "segoe", name: "Segoe UI", stack: `"Segoe UI", ${SANS}`, kind: "installed", blurb: "Windows' own font." },
    { id: "system", name: "Your system's font", stack: `system-ui, -apple-system, "Segoe UI", ${SANS}`, kind: "installed" },
    { id: "arial", name: "Arial", stack: `Arial, Helvetica, ${SANS}`, kind: "installed" },
    { id: "verdana", name: "Verdana", stack: `Verdana, ${SANS}`, kind: "installed", blurb: "Wide and very clear at small sizes." },
    { id: "tahoma", name: "Tahoma", stack: `Tahoma, ${SANS}`, kind: "installed" },
    { id: "trebuchet", name: "Trebuchet MS", stack: `"Trebuchet MS", ${SANS}`, kind: "installed" },
    { id: "calibri", name: "Calibri", stack: `Calibri, ${SANS}`, kind: "installed" },
    { id: "georgia", name: "Georgia", stack: "Georgia, serif", kind: "installed" },
    { id: "times", name: "Times New Roman", stack: "\"Times New Roman\", Times, serif", kind: "installed" },
    { id: "comicsans", name: "Comic Sans MS", stack: `"Comic Sans MS", "Comic Neue", ${SANS}`, kind: "installed" },

    { id: "custom", name: "Another font on my computer…", stack: "", kind: "installed" },
];

export const CODE_FONTS: FontChoice[] = [
    { id: "discord", name: "Discord's own", stack: "", kind: "discord" },
    { id: "jetbrains", name: "JetBrains Mono", stack: "\"JetBrains Mono\", Consolas, monospace", kind: "web", pkg: "jetbrains-mono", weights: [400, 700] },
    { id: "firacode", name: "Fira Code", stack: "\"Fira Code\", Consolas, monospace", kind: "web", pkg: "fira-code", weights: [400, 700] },
    { id: "cascadia", name: "Cascadia Code", stack: "\"Cascadia Code\", \"Cascadia Mono\", Consolas, monospace", kind: "installed" },
    { id: "consolas", name: "Consolas", stack: "Consolas, monospace", kind: "installed" },
    { id: "courier", name: "Courier New", stack: "\"Courier New\", monospace", kind: "installed" },
];

/** The Fontsource stylesheets a web font needs. */
export const fontCss = (f: FontChoice) => (f.weights ?? [400]).map(w => `https://cdn.jsdelivr.net/npm/@fontsource/${f.pkg}@${FONTSOURCE_VERSION}/${w}.css`);

export interface FontLook {
    font: string;
    customFont: string;
    codeFont: string;
    scope: "all" | "messages";
    /** % of Discord's message size. */
    size: number;
    /** % of Discord's line height. */
    lineHeight: number;
    /** Hundredths of an em. */
    letterSpacing: number;
}

export const DEFAULT_LOOK: FontLook = { font: "discord", customFont: "", codeFont: "discord", scope: "all", size: 100, lineHeight: 100, letterSpacing: 0 };

export const PRESETS: { id: string; name: string; blurb: string; look: Partial<FontLook>; }[] = [
    { id: "default", name: "Discord", blurb: "Everything as Discord has it.", look: DEFAULT_LOOK },
    { id: "readable", name: "Easy reading", blurb: "Atkinson Hyperlegible, a little bigger, more space between lines.", look: { font: "atkinson", size: 106, lineHeight: 118, letterSpacing: 1 } },
    { id: "dyslexia", name: "Dyslexia-friendly", blurb: "OpenDyslexic with roomy lines and letter spacing.", look: { font: "opendyslexic", size: 100, lineHeight: 130, letterSpacing: 3 } },
    { id: "compact", name: "Compact", blurb: "Inter, slightly smaller and tighter — more messages on screen.", look: { font: "inter", size: 94, lineHeight: 92, letterSpacing: 0 } },
    { id: "cozy", name: "Cozy", blurb: "Nunito, rounded and relaxed.", look: { font: "nunito", size: 104, lineHeight: 112, letterSpacing: 1 } },
    { id: "book", name: "Bookish", blurb: "Merriweather for messages, like reading a book.", look: { font: "merriweather", scope: "messages", size: 100, lineHeight: 120, letterSpacing: 0 } },
];

export const fontById = (id: string) => FONTS.find(f => f.id === id) ?? FONTS[0];
export const codeFontById = (id: string) => CODE_FONTS.find(f => f.id === id) ?? CODE_FONTS[0];

/** A font name typed by the user, made safe for CSS. */
export const safeFontName = (name: string) => name.replace(/["\\;{}<>]/g, "").trim().slice(0, 60);
