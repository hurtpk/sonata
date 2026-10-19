/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The corrector itself, with no Discord in it, so it can be tested on its own.
// Leaves alone anything that isn't plain writing: code, links, mentions,
// channels, custom emoji, :emoji:, timestamps and spoiler/quote markers stay
// exactly as typed.

/** Common slips — only ones that are never a real word on their own. */
export const TYPOS: Record<string, string> = {
    teh: "the", hte: "the", taht: "that", thta: "that", adn: "and", nad: "and", jsut: "just", juts: "just",
    waht: "what", wnat: "want", whta: "what", becuase: "because", becasue: "because", beacuse: "because",
    recieve: "receive", recieved: "received", beleive: "believe", belive: "believe", freind: "friend", freinds: "friends",
    wierd: "weird", definately: "definitely", definatly: "definitely", defintely: "definitely", seperate: "separate",
    occured: "occurred", untill: "until", tommorow: "tomorrow", tomorow: "tomorrow", tommorrow: "tomorrow",
    alot: "a lot", realy: "really", reallly: "really", probaly: "probably", probly: "probably",
    knwo: "know", konw: "know", nkow: "know", thier: "their", ehr: "her", yuo: "you", yoru: "your", yuor: "your",
    shoudl: "should", woudl: "would", coudl: "could", shoud: "should", woud: "would", coud: "could",
    goign: "going", oging: "going", doign: "doing", amke: "make", mkae: "make", soem: "some", smoe: "some",
    thnaks: "thanks", thansk: "thanks", tahnks: "thanks", plase: "please",
    accomodate: "accommodate", acheive: "achieve", arguement: "argument", calender: "calendar", commited: "committed",
    embarass: "embarrass", enviroment: "environment", existance: "existence", goverment: "government", gaurd: "guard",
    happend: "happened", immediatly: "immediately", independant: "independent", libary: "library", neccessary: "necessary",
    necesary: "necessary", noticable: "noticeable", posession: "possession", publically: "publicly", rember: "remember",
    remeber: "remember", rythm: "rhythm", sentance: "sentence", succesful: "successful", suprise: "surprise",
    truely: "truly", wich: "which", whcih: "which", wiht: "with", iwth: "with", wihtout: "without", abotu: "about",
    baout: "about", agian: "again", agin: "again", ahve: "have", hvae: "have", liek: "like",
    peopel: "people", poeple: "people", tiem: "time", tihs: "this", htis: "this", tihnk: "think", thikn: "think",
    whihc: "which", wont: "won't", dont: "don't", doesnt: "doesn't", didnt: "didn't", cant: "can't", isnt: "isn't",
    wasnt: "wasn't", arent: "aren't", werent: "weren't", havent: "haven't", hasnt: "hasn't", couldnt: "couldn't",
    shouldnt: "shouldn't", wouldnt: "wouldn't", thats: "that's", whats: "what's", theres: "there's", youre: "you're",
    theyre: "they're", ive: "I've", im: "I'm",
};

/** Words that only need an apostrophe — switched off on their own with "Add missing apostrophes". */
const APOSTROPHE = new Set(["wont", "dont", "doesnt", "didnt", "cant", "isnt", "wasnt", "arent", "werent", "havent", "hasnt", "couldnt", "shouldnt", "wouldnt", "thats", "whats", "theres", "youre", "theyre", "ive", "im"]);

export interface CorrectOptions {
    typos: boolean;
    /** i → I, i'm → I'm … */
    capitalI: boolean;
    apostrophes: boolean;
    /** Capital letter at the start of each sentence. */
    sentenceCase: boolean;
    /** Your own list, already parsed (lowercase wrong → right). */
    custom: Record<string, string>;
}

/** "teh = the, recieve=receive" or one per line → { teh: "the", … }. Arrows (→, ->) work too. */
export function parseCustom(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of String(raw ?? "").split(/[\n,;]+/)) {
        const m = part.match(/^\s*([^=→>]+?)\s*(?:=|→|->)\s*(.+?)\s*$/);
        if (m && m[1] && m[2] && !/\s/.test(m[1])) out[m[1].toLowerCase()] = m[2];
    }
    return out;
}

/** Keeps the shape of what you typed: Teh → The, TEH → THE. */
function matchCase(typed: string, fix: string) {
    if (typed.length > 1 && typed === typed.toUpperCase() && typed !== typed.toLowerCase()) return fix.toUpperCase();
    if (typed[0] === typed[0].toUpperCase() && typed[0] !== typed[0].toLowerCase()) return fix[0].toUpperCase() + fix.slice(1);
    return fix;
}

// Things that are never touched: ```code```, `code`, links, <@mentions>, <#channels>, <:emoji:1>, <t:123>, :emoji:, @everyone.
const PROTECTED = /```[\s\S]*?(?:```|$)|`[^`\n]*`|<[@#:a!&t/][^>\s]*>|https?:\/\/\S+|\bwww\.\S+|:[a-z0-9_+-]{2,}:|@\w+/gi;
const WORD = /[A-Za-z]+(?:'[A-Za-z]+)?/g;

export function correctText(text: string, opt: CorrectOptions): { text: string; changes: number; } {
    if (!text || text.startsWith("/")) return { text, changes: 0 };
    let changes = 0;
    const fixWords = (chunk: string) => chunk.replace(WORD, (word, at: number) => {
        // Not part of a longer token like file.txt, a_b, or 5am.
        const before = chunk[at - 1] ?? "", after = chunk[at + word.length] ?? "";
        if (/[\w./\\]/.test(before) || /[\w/\\]/.test(after) || (after === "." && /\w/.test(chunk[at + word.length + 1] ?? ""))) return word;
        const low = word.toLowerCase();
        let fix: string | undefined = opt.custom[low];
        if (fix === undefined && opt.typos && TYPOS[low] && (opt.apostrophes || !APOSTROPHE.has(low))) fix = TYPOS[low];
        if (fix === undefined && opt.capitalI && /^i(?:'(?:m|ve|ll|d))?$/.test(low) && word[0] === "i") fix = "I" + word.slice(1);
        if (fix === undefined) return word;
        // Your own list keeps exactly what you wrote; the built-in one follows your capitals.
        const out = low in opt.custom ? fix : /^I\b/.test(fix) ? fix : matchCase(word, fix);
        if (out !== word) changes++;
        return out;
    });

    let out = "", last = 0;
    for (const m of text.matchAll(PROTECTED)) {
        out += fixWords(text.slice(last, m.index)) + m[0];
        last = m.index! + m[0].length;
    }
    out += fixWords(text.slice(last));

    if (opt.sentenceCase) {
        // Start of the message, or after . ! ? followed by a space — but not inside protected bits.
        const guard: [number, number][] = [...out.matchAll(PROTECTED)].map(m => [m.index!, m.index! + m[0].length]);
        out = out.replace(/(^|[.!?]\s+|\n\s*)([a-z])/g, (all, lead: string, ch: string, at: number) => {
            const pos = at + lead.length;
            if (guard.some(([a, b]) => pos >= a && pos < b)) return all;
            changes++;
            return lead + ch.toUpperCase();
        });
    }
    return { text: out, changes };
}
