/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Command Shortcuts: bot commands you use a lot — /daily, /work, /trade with
// your usual options — as one-click buttons. Run a command the normal way
// once, then save it from the ⚡ menu in the chat bar. A shortcut runs through
// Discord's own command sender, exactly as if you'd typed it and pressed Enter.

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import { ChannelStore, ContextMenuApi, DraftType, FluxDispatcher, GuildStore, Menu, SelectedChannelStore, showToast } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { openShortcuts } from "./Manager";

export const settings = defineFeatureSettings("commandShortcuts", {
    shortcutsJson: { type: OptionType.STRING, description: "Internal: your saved shortcuts.", default: "[]", hidden: true },
    recentJson: { type: OptionType.STRING, description: "Internal: commands you ran lately.", default: "[]", hidden: true },
    knownJson: { type: OptionType.STRING, description: "Internal: bot commands you have run (just the commands).", default: "[]", hidden: true },
});

/** A command as Discord's command sender needs it (only the plain data — no functions). */
export interface SavedCommand {
    id: string; applicationId: string; version?: string; guildId?: string;
    name: string; untranslatedName?: string; displayName?: string; description?: string;
    type: number; inputType?: number; options?: any[]; rootCommand?: any; subCommandPath?: any[];
}
/** One option's value, as the chat box's pieces ({ type: "text", text } and friends). */
export type OptionValues = Record<string, any[]>;
export interface Used { command: SavedCommand; values: OptionValues; guildId: string | null; at: number; }
export interface Shortcut extends Used { id: string; label: string; }

const read = <T,>(raw: string | undefined): T[] => { try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
export const loadShortcuts = () => read<Shortcut>(settings.store.shortcutsJson);
export const saveShortcuts = (list: Shortcut[]) => { settings.store.shortcutsJson = JSON.stringify(list); };
export const loadRecent = () => read<Used>(settings.store.recentJson);

/** "/trade item: Dominus · amount: 2" */
export function describe(c: SavedCommand, values: OptionValues) {
    const name = c.displayName || c.untranslatedName || c.name;
    const parts = Object.entries(values).map(([k, v]) => `${k}: ${v.map(textOf).join("")}`).filter(p => !p.endsWith(": "));
    return `/${name}${parts.length ? " " + parts.join(" · ") : ""}`;
}
export function textOf(node: any): string {
    switch (node?.type) {
        case "text": return node.text ?? "";
        case "userMention": return "@user";
        case "roleMention": return "@role";
        case "channelMention": return "#channel";
        case "emoji": case "customEmoji": return node.name ? `:${String(node.name).replaceAll(":", "")}:` : "🙂";
        default: return node?.text ?? "";
    }
}

/** Only the plain data from Discord's command record (it also carries functions). */
function snapshot(c: any): SavedCommand {
    const plain = (v: any) => v == null ? v : JSON.parse(JSON.stringify(v));
    return {
        id: c.id, applicationId: c.applicationId, version: c.version, guildId: c.guildId ?? undefined,
        name: c.name, untranslatedName: c.untranslatedName, displayName: c.displayName, description: c.description,
        type: c.type, inputType: c.inputType, options: plain(c.options), rootCommand: plain(c.rootCommand), subCommandPath: plain(c.subCommandPath),
    };
}

// Discord's command sender, handed over by the patch below.
let runner: ((e: any) => Promise<void>) | null = null;

/** Runs a saved command in a channel (the one you're looking at, by default). */
export async function runCommand(s: Used, channelId = SelectedChannelStore.getChannelId()) {
    const channel: any = channelId ? ChannelStore.getChannel(channelId) : null;
    if (!channel) { showToast("Open a channel first", "failure"); return false; }
    if (!runner) { showToast("Run any bot command once first (Discord loads its command sender then)", "failure"); return false; }
    try {
        await runner({ command: s.command, optionValues: JSON.parse(JSON.stringify(s.values)), context: { channel, guild: channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null } });
        return true;
    } catch (e) {
        showToast(`Couldn't run it: ${e instanceof Error ? e.message : e}`, "failure");
        return false;
    }
}

/** Whether a bot command can be run from Sonata yet (Discord hands over its command sender the first time you run one). */
export const canRunCommands = () => !!runner;

/**
 * Runs a bot's slash command in a channel — exactly as if you'd filled it in
 * and pressed Enter there. `text` fills its options; `files` fills its file
 * options (by option name), the way dropping a file on that option does.
 */
export async function runSlashCommand(command: SavedCommand, channelId: string, text: Record<string, string>, files: Record<string, File> = {}) {
    const channel: any = ChannelStore.getChannel(channelId);
    if (!channel) throw new Error("That channel can't be found.");
    if (!runner) throw new Error("Run any bot command once first — Discord loads its command sender then.");
    const values: OptionValues = {};
    for (const [name, v] of Object.entries(text)) if (v.trim()) values[name] = [{ type: "text", text: v.trim() }];
    // File options are read from Discord's upload list for slash commands (draft type 5), under the option's name.
    for (const [name, file] of Object.entries(files)) {
        FluxDispatcher.dispatch({ type: "UPLOAD_ATTACHMENT_SET_FILE", channelId, id: name, draftType: DraftType.SlashCommand, allowOptimization: false, file: { id: name, file, platform: 1 } });
        values[name] = [];
    }
    try {
        await runner({ command, optionValues: values, context: { channel, guild: channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null } });
    } finally {
        if (Object.keys(files).length) FluxDispatcher.dispatch({ type: "UPLOAD_ATTACHMENT_CLEAR_ALL_FILES", channelId, draftType: DraftType.SlashCommand });
    }
}

/** Bot commands you've run lately, once each (newest first) — what can be picked for other features. */
export function knownCommands(): SavedCommand[] {
    const seen = new Set<string>();
    return [...read<SavedCommand>(settings.store.knownJson), ...[...loadRecent(), ...loadShortcuts()].map(u => u.command)].filter(c => c?.id && !seen.has(c.id) && seen.add(c.id));
}

/** The chat bar's ⚡ menu: your shortcuts (this server's first), then a link to manage them. */
function ShortcutMenu({ onClose }: { onClose(): void; }) {
    const channel: any = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    const here = channel?.guild_id ?? null;
    const all = loadShortcuts();
    const mine = all.filter(s => s.guildId === here), other = all.filter(s => s.guildId !== here);
    const item = (s: Shortcut) => <Menu.MenuItem key={s.id} id={`vc-cmdsc-${s.id}`} label={s.label} subtext={describe(s.command, s.values)} action={() => void runCommand(s)} />;
    return (
        <Menu.Menu navId="vc-cmdsc-menu" onClose={onClose} aria-label="Command shortcuts">
            {mine.length > 0 && <Menu.MenuGroup label="Shortcuts">{mine.map(item)}</Menu.MenuGroup>}
            {other.length > 0 && (
                <Menu.MenuGroup label={mine.length ? undefined : "Shortcuts"}>
                    <Menu.MenuItem id="vc-cmdsc-other" label={`From other servers (${other.length})`}>{other.map(item)}</Menu.MenuItem>
                </Menu.MenuGroup>
            )}
            {!all.length && <Menu.MenuItem id="vc-cmdsc-none" label="No shortcuts yet" subtext="Run a bot command, then save it here" disabled />}
            <Menu.MenuSeparator />
            <Menu.MenuItem id="vc-cmdsc-manage" label="Save or manage shortcuts…" action={() => openShortcuts()} />
        </Menu.Menu>
    );
}

export function BoltIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />
        </svg>
    );
}

const Button: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;
    return (
        <ChatBarButton tooltip="Command shortcuts" onClick={e => ContextMenuApi.openContextMenu(e as any, () => <ShortcutMenu onClose={ContextMenuApi.closeContextMenu} />)}>
            <BoltIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "CommandShortcuts",
    description: "Bot commands you use a lot (/daily, /work, /trade with your usual options) as one-click shortcuts from the ⚡ button in the chat bar. Run a command once, then save it.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,
    openSettingsModal: () => openShortcuts(),
    chatBarButton: { icon: BoltIcon, render: Button },

    patches: [{
        // Discord's command sender (what runs when you press Enter on a slash command).
        find: "executeCommand.stageAttachments",
        replacement: {
            match: /(async function (\i)\(\i\)\{)(let\{command:\i,optionValues:\i,context:\i,commandTargetId:)/,
            replace: "$self.setRunner($2);$1$self.used(arguments[0]);$3",
        },
    }],

    setRunner(fn: (e: any) => Promise<void>) { runner = fn; },

    /** Notes each bot command you run (with what you filled in), so it can be saved as a shortcut. */
    used(e: any) {
        try {
            const c = e?.command;
            if (!c || e?.context?.autocomplete || typeof c.execute === "function" || !c.applicationId) return;
            // The command itself (any options, files too), for features that run it with their own values (Exploit Reporter).
            const cmd = snapshot(c);
            settings.store.knownJson = JSON.stringify([cmd, ...read<SavedCommand>(settings.store.knownJson).filter(k => k.id !== cmd.id)].slice(0, 30));
            if (Object.values(e.optionValues ?? {}).some((v: any) => !Array.isArray(v))) return;
            const entry: Used = { command: snapshot(c), values: JSON.parse(JSON.stringify(e.optionValues ?? {})), guildId: e.context?.channel?.guild_id ?? null, at: Date.now() };
            const key = (u: Used) => `${u.command.id}|${JSON.stringify(u.values)}`;
            const recent = [entry, ...loadRecent().filter(u => key(u) !== key(entry))].slice(0, 15);
            settings.store.recentJson = JSON.stringify(recent);
        } catch { }
    },
});
