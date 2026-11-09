/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const TRIGGERS = [
    { value: 1, label: "Custom words", limit: 6 },
    { value: 3, label: "Spam", limit: 1 },
    { value: 4, label: "Discord word lists", limit: 1 },
    { value: 5, label: "Mention spam", limit: 1 },
    { value: 6, label: "Member profiles", limit: 1 }
] as const;

export interface RuleAction { type: number; metadata?: { channel_id?: string; duration_seconds?: number; custom_message?: string; [key: string]: unknown; }; }
export interface AutoModRule {
    id: string; guild_id: string; creator_id: string; name: string; event_type: number; trigger_type: number; enabled: boolean;
    trigger_metadata: { keyword_filter?: string[]; regex_patterns?: string[]; presets?: number[]; allow_list?: string[]; mention_total_limit?: number; mention_raid_protection_enabled?: boolean; [key: string]: unknown; };
    actions: RuleAction[]; exempt_roles: string[]; exempt_channels: string[];
}
export interface RuleDraft {
    name: string; trigger: number; enabled: boolean; keywords: string; regex: string; allow: string; presets: number[];
    mentions: string; raid: boolean; block: boolean; alert: boolean; alertChannel: string; timeout: boolean; seconds: string;
    explanation: string; roles: string[]; channels: string[];
}

export function draftRule(rule?: AutoModRule): RuleDraft {
    const metadata = rule?.trigger_metadata;
    return {
        name: rule?.name ?? "", trigger: rule?.trigger_type ?? 1, enabled: rule?.enabled ?? false,
        keywords: metadata?.keyword_filter?.join("\n") ?? "", regex: metadata?.regex_patterns?.join("\n") ?? "", allow: metadata?.allow_list?.join("\n") ?? "",
        presets: metadata?.presets ?? [1, 2, 3], mentions: String(metadata?.mention_total_limit ?? 5), raid: metadata?.mention_raid_protection_enabled ?? false,
        block: rule ? rule.actions.some(action => action.type === 1 || action.type === 4) : true,
        alert: rule?.actions.some(action => action.type === 2) ?? false, alertChannel: rule?.actions.find(action => action.type === 2)?.metadata?.channel_id ?? "",
        timeout: rule?.actions.some(action => action.type === 3) ?? false, seconds: String(rule?.actions.find(action => action.type === 3)?.metadata?.duration_seconds ?? 60),
        explanation: rule?.actions.find(action => action.type === 1)?.metadata?.custom_message ?? "", roles: rule?.exempt_roles ?? [], channels: rule?.exempt_channels ?? []
    };
}

const lines = (text: string) => [...new Set(text.split(/\r?\n/).map(value => value.trim()).filter(Boolean))];

export function rulePayload(draft: RuleDraft, original?: AutoModRule, canTimeout = false) {
    const trigger = TRIGGERS.find(type => type.value === draft.trigger);
    if (!trigger || (original && original.trigger_type !== draft.trigger)) throw new Error("An existing rule's trigger type cannot be changed.");
    if (!draft.name.trim() || draft.name.trim().length > 100) throw new Error("Give the rule a name between 1 and 100 characters.");
    const metadata = { ...original?.trigger_metadata };
    if (draft.trigger === 1 || draft.trigger === 6) {
        metadata.keyword_filter = lines(draft.keywords);
        metadata.regex_patterns = [...new Set(draft.regex.split(/\r?\n/).filter(value => value.length > 0))];
        if (!metadata.keyword_filter.length && !metadata.regex_patterns.length) throw new Error("Add at least one keyword or regex pattern.");
        if (metadata.keyword_filter.length > 1000 || metadata.keyword_filter.some(value => value.length > 60)) throw new Error("Use up to 1,000 keywords, each 60 characters or fewer.");
        if (metadata.regex_patterns.length > 10 || metadata.regex_patterns.some(value => value.length > 260)) throw new Error("Use up to 10 regex patterns, each 260 characters or fewer.");
    }
    if ([1, 4, 6].includes(draft.trigger)) {
        metadata.allow_list = lines(draft.allow);
        if (metadata.allow_list.length > (draft.trigger === 4 ? 1000 : 100) || metadata.allow_list.some(value => value.length > 60)) throw new Error(`Use up to ${draft.trigger === 4 ? "1,000" : "100"} allowed phrases, each 60 characters or fewer.`);
    }
    if (draft.trigger === 4) {
        if (!draft.presets.length || draft.presets.some(value => ![1, 2, 3].includes(value))) throw new Error("Choose at least one Discord word list.");
        metadata.presets = draft.presets;
    }
    if (draft.trigger === 5) {
        if (!/^\d+$/.test(draft.mentions) || Number(draft.mentions) < 1 || Number(draft.mentions) > 50) throw new Error("The mention limit must be a whole number between 1 and 50.");
        metadata.mention_total_limit = Number(draft.mentions);
        metadata.mention_raid_protection_enabled = draft.raid;
    }
    const actions: RuleAction[] = original?.actions.filter(action => ![1, 2, 3, 4].includes(action.type)) ?? [];
    if (draft.block) {
        if (draft.explanation.length > 150) throw new Error("The blocked-message explanation must be 150 characters or fewer.");
        actions.push(draft.trigger === 6 ? { type: 4 } : { type: 1, metadata: { ...original?.actions.find(action => action.type === 1)?.metadata, custom_message: draft.explanation } });
    }
    if (draft.alert) {
        if (!/^\d{15,21}$/.test(draft.alertChannel)) throw new Error("Choose a channel for AutoMod alerts.");
        actions.push({ type: 2, metadata: { ...original?.actions.find(action => action.type === 2)?.metadata, channel_id: draft.alertChannel } });
    }
    if (draft.timeout) {
        if (![1, 5].includes(draft.trigger)) throw new Error("Timeouts are available for custom-word and mention-spam rules.");
        const old = original?.actions.find(action => action.type === 3)?.metadata?.duration_seconds;
        if (!canTimeout && old !== Number(draft.seconds)) throw new Error("Timeout Members is required to add or change a timeout action.");
        if (!/^\d+$/.test(draft.seconds) || Number(draft.seconds) < 1 || Number(draft.seconds) > 2_419_200) throw new Error("Timeouts must be 1 to 2,419,200 seconds (28 days).");
        actions.push({ type: 3, metadata: { ...original?.actions.find(action => action.type === 3)?.metadata, duration_seconds: Number(draft.seconds) } });
    }
    if (!actions.length) throw new Error("Choose at least one action for this rule.");
    if (draft.roles.length > 20 || draft.channels.length > 50 || [...draft.roles, ...draft.channels].some(id => !/^\d{15,21}$/.test(id))) throw new Error("Choose up to 20 exempt roles and 50 exempt channels.");
    return { name: draft.name.trim(), event_type: original?.event_type ?? (draft.trigger === 6 ? 2 : 1), trigger_metadata: metadata, actions, enabled: draft.enabled, exempt_roles: draft.roles, exempt_channels: draft.channels, ...(!original ? { trigger_type: draft.trigger } : {}) };
}
