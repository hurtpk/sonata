/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RE2JS } from "re2js";
import { option, sub, text } from "./commandOptions.mjs";
import { embed, fail, PERMS } from "./discord.mjs";

export const AUTOMOD_OPTIONS = [
    sub("regexadd", "Add a native Discord regex filter", [option("pattern", 3, "Rust-compatible regular expression", true, { max_length: 260 })]), sub("regexremove", "Remove one regex filter", [option("pattern", 3, "Existing pattern", true, { max_length: 260 })]), sub("regexlist", "List Sonata's regex filters"),
    sub("profileadd", "Block interactions for matching member profiles", [option("word", 3, "Word or wildcard", true, { max_length: 60 })]), sub("profileremove", "Remove a member profile filter", [option("word", 3, "Existing word", true, { max_length: 60 })]), sub("profilelist", "List Sonata's member profile filters"),
    sub("preview", "Test a regex sample without enabling a rule", [option("pattern", 3, "Pattern to preview", true, { max_length: 260 }), text("sample", "Sample text")]),
];
export async function advancedAutomod(context, store) {
    const { command, api, guild } = context, o = command.options;
    if (command.sub === "preview") {
        let match;
        try { match = RE2JS.compile(o.pattern).test(o.sample); } catch { fail("The safe preview engine could not compile that pattern. Use RE2-compatible syntax; Discord validates Rust regex syntax when saving."); }
        return embed("AutoMod preview", `${match ? "Match found." : "No match found."}\n\nNo rule was enabled or changed. This linear-time RE2 preview can differ from Discord's Rust regex engine.`);
    }
    context.botPermission(PERMS.GUILD);
    const profile = command.sub.startsWith("profile"), key = profile ? "profile" : "regex", field = profile ? "keyword_filter" : "regex_patterns", settings = store.settings(guild.id), rules = await api(`/guilds/${guild.id}/auto-moderation/rules`), existing = rules.find(rule => rule.id === settings.automod[key] && rule.creator_id === context.bot.user.id);
    if (command.sub.endsWith("list")) return embed(profile ? "Member profile filters" : "Regex filters", existing?.trigger_metadata[field]?.join("\n") || "No filters configured.");
    const value = profile ? o.word.trim() : o.pattern;
    const previous = existing?.trigger_metadata[field] ?? [], next = command.sub.endsWith("add") ? [...new Set([...previous, value])] : previous.filter(item => item !== value);
    if (!value || next.length > (profile ? 100 : 10)) fail(profile ? "Use one to one hundred profile words or wildcards." : "Use at most ten regular expressions.");
    const metadata = { ...existing?.trigger_metadata, [field]: next };
    if (!next.length && !(profile ? metadata.regex_patterns?.length : metadata.keyword_filter?.length)) {
        if (existing) await api(`/guilds/${guild.id}/auto-moderation/rules/${existing.id}`, { method: "DELETE" });
        delete settings.automod[key];
    } else {
        const body = existing ? { trigger_metadata: metadata } : { name: `Sonata | ${key}`, event_type: profile ? 2 : 1, trigger_type: profile ? 6 : 1, trigger_metadata: metadata, enabled: true, actions: [{ type: profile ? 4 : 1, ...(!profile ? { metadata: { custom_message: "This message matched the server's Sonata regex filter." } } : {}) }] };
        const saved = await api(`/guilds/${guild.id}/auto-moderation/rules${existing ? `/${existing.id}` : ""}`, { method: existing ? "PATCH" : "POST", body }); settings.automod[key] = saved.id;
    }
    store.saveSettings(guild.id, settings);
    return embed("AutoMod updated", profile ? "Discord applies the configured member-profile interaction restrictions. Other bots' rules were kept." : "Discord applies the configured regex message filters. Unrelated words, exemptions and rule settings were kept.");
}
