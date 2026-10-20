/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * QOL — a single plugin that bundles many quality-of-life plugins.
 *
 * Each bundled feature is the original plugin, unchanged in behavior, living
 * in ./features/<key>. QOL hosts them:
 *
 * - Patches: every feature's patches are registered under QOL, each gated by
 *   a predicate so a switched-off feature's patches are never applied.
 *   "$self" in a feature's patches is re-pointed to that feature
 *   ($self.f.<key>), so it keeps calling its own code.
 * - Everything else a plugin can declare (start/stop, commands, context
 *   menus, managed styles, chat bar / popover buttons, message accessories)
 *   is started through Equicord's own startPlugin/stopPlugin, so it behaves
 *   exactly as it did standalone. Flux listeners are subscribed by QOL.
 * - Settings: each feature's settings are stored on QOL under a prefix
 *   (see featureSettings.ts) and shown on QOL's settings page under that
 *   feature's header, which also has its on/off switch.
 * - First run: existing settings are copied over from the standalone
 *   built-in plugins, and those built-ins are switched off so the same code
 *   isn't patched in twice. A built-in that's switched back on later wins:
 *   QOL leaves that feature off until the built-in is disabled again.
 */

// The shared window kit first, so every feature's own styles can build on it.
import "./features/_shared/tool.css";

import type { ChatBarButtonData } from "@api/ChatButtons";
import { showNotice } from "@api/Notices";
import { isPluginEnabled, startPlugin, stopPlugin } from "@api/PluginManager";
import { definePluginSettings, PlainSettings, Settings } from "@api/Settings";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginSettingDef, SettingsDefinition } from "@utils/types";
import { FluxDispatcher, Menu, showToast } from "@webpack/common";
import type { ReactNode } from "react";

import { FeatureStatus, openOptions, QolApi } from "./controller/ControlCenter";
import anonymiseFileNames from "./features/anonymiseFileNames";
import antimod from "./features/antimod";
import antiquest from "./features/antiquest";
import asciiArt from "./features/asciiArt";
import autoCorrect from "./features/autoCorrect";
import autoReact from "./features/autoReact";
import autoVolume from "./features/autoVolume";
import betterInvites from "./features/betterInvites";
import birthdayReminders from "./features/birthdayReminders";
import brokenPatchFinder from "./features/brokenPatchFinder";
import calculator from "./features/calculator";
import calendar from "./features/calendar";
import callTimer from "./features/callTimer";
import categoryChannelGreeter from "./features/categoryChannelGreeter";
import channelNotes from "./features/channelNotes";
import themeStudio from "./features/themeStudio";
import botManager from "./features/botManager";
import charactersPicker from "./features/charactersPicker";
import chatEffects from "./features/chatEffects";
import coloredText from "./features/coloredText";
import commandShortcuts from "./features/commandShortcuts";
import crashHandler from "./features/crashHandler";
import currencyConverter from "./features/currencyConverter";
import customBadges from "./features/customBadges";
import declutter from "./features/declutter";
import disableCallIdle from "./features/disableCallIdle";
import embedCopier from "./features/embedCopier";
import embedSender from "./features/embedSender";
import encoderTools from "./features/encoderTools";
import exploiterReport from "./features/exploiterReport";
import expressionStealer from "./features/expressionStealer";
import fakedeafen from "./features/fakedeafen";
import fakeDms from "./features/fakeDms";
import fancyText from "./features/fancyText";
import fileConverter from "./features/fileConverter";
import filePreviewer from "./features/filePreviewer";
import fontSwapper from "./features/fontSwapper";
import forceOwnerCrown from "./features/forceOwnerCrown";
import gameActivityToggle from "./features/gameActivityToggle";
import games from "./features/games";
import packageTracker from "./features/packageTracker";
import gifMaker from "./features/gifMaker";
import giftWrap from "./features/giftWrap";
import imageFilename from "./features/imageFilename";
import imageLink from "./features/imageLink";
import imageToText from "./features/imageToText";
import imageZoom from "./features/imageZoom";
import inviteManager from "./features/inviteManager";
import linkCleaner from "./features/linkCleaner";
import linkEmbedFixer from "./features/linkEmbedFixer";
import liveRpcEditor from "./features/liveRpcEditor";
import localNames from "./features/localNames";
import longMessageCollapser from "./features/longMessageCollapser";
import mediaDownloader from "./features/mediaDownloader";
import messageCleanerUtil from "./features/messageCleanerUtil";
import messageLogger from "./features/messageLogger";
import messageLoggerEnhanced from "./features/messageLoggerEnhanced";
import messagePreview from "./features/messagePreview";
import messageTimer from "./features/messageTimer";
import miniGames from "./features/miniGames";
import modelPreview from "./features/modelPreview";
import multiQuote from "./features/multiQuote";
import mutualGroupDMs from "./features/mutualGroupDMs";
import noUnblockToJump from "./features/noUnblockToJump";
import onePingPerDM from "./features/onePingPerDM";
import onThisDay from "./features/onThisDay";
import permissionsViewer from "./features/permissionsViewer";
import personTags from "./features/personTags";
import pinDms from "./features/pinDms";
import platformIndicators from "./features/platformIndicators";
import platformSpoofer from "./features/platformSpoofer";
import qrCodes from "./features/qrCodes";
import quickText from "./features/quickText";
import readAllNotificationsButton from "./features/readAllNotificationsButton";
import readAloud from "./features/readAloud";
import relationshipTracker from "./features/relationshipTracker";
import reminders from "./features/reminders";
import reverseImageSearch from "./features/reverseImageSearch";
import robloxTools from "./features/robloxTools";
import roleColorEverywhere from "./features/roleColorEverywhere";
import scamShield from "./features/scamShield";
import scheduledMessages from "./features/scheduledMessages";
import screenshotStyler from "./features/screenshotStyler";
import serverInfo from "./features/serverInfo";
import shareSetup from "./features/shareSetup";
import showHiddenChannels from "./features/showHiddenChannels";
import showRolesInChat from "./features/showRolesInChat";
import showTimeoutDuration from "./features/showTimeoutDuration";
import silentTyping from "./features/silentTyping";
import smoothChat from "./features/smoothChat";
import sonataBadge from "./features/sonataBadge";
import soundStudio from "./features/soundStudio";
import splitLargeMessages from "./features/splitLargeMessages";
import splitView from "./features/splitView";
import spotifyControls from "./features/spotifyControls";
import spotifyCrack from "./features/spotifyCrack";
import statusAvatar from "./features/statusAvatar";
import stealProfile from "./features/stealProfile";
import stealth from "./features/stealth";
import steamWatcher from "./features/steamWatcher";
import stickyMessage from "./features/stickyMessage";
import streaks from "./features/streaks";
import streamQuality from "./features/streamQuality";
import tiktokTracker from "./features/tiktokTracker";
import todoLists from "./features/todoLists";
import translate from "./features/translate";
import typingSounds from "./features/typingSounds";
import videoEditor from "./features/videoEditor";
import videoSpeed from "./features/videoSpeed";
import viewIcons from "./features/viewIcons";
import voiceDownload from "./features/voiceDownload";
import voiceMessages from "./features/voiceMessages";
import voiceTimeline from "./features/voiceTimeline";
import wallet from "./features/wallet";
import waveformPlayer from "./features/waveformPlayer";
import whisper from "./features/whisper";
import zipPreview from "./features/zipPreview";
import { featureSettings, prefixKey, QOL_NAME, runningFeatures } from "./featureSettings";
import { startAlbumWatch, stopAlbumWatch } from "./sonata/accent";
import { startCacheAuto, stopCacheAuto } from "./sonata/cache";
import { addTrayButton, removeTrayButton, startChatTray, stopChatTray } from "./sonata/chatTray";
import { setDoctorProvider, startErrors, startTimes } from "./sonata/doctorBridge";
import { startFeatureAccent, stopFeatureAccent } from "./sonata/featureAccent";
import { startMemoryWatch, stopMemoryWatch } from "./sonata/memoryWatch";
import { openSonata } from "./sonata/open";
import { cancelStartLater, canStartLater, startLater, startLaterOn, startPerformance, stopPerformance } from "./sonata/performance";
import { sameVoicePatches, sameVoiceText, useSameVoiceLabel } from "./sonata/sameVoice";
import { startUpdateNotice, stopUpdateNotice } from "./sonata/updateNotice";
import { loadUsage, noteUse } from "./sonata/usage";
import { addDockButton, dockContextMenus, dockPatch, PINNED_DOCK_ID, removeDockButton, renderDock } from "./utilities/dock";
import { startDockColor, stopDockColor } from "./utilities/dockColor";
import { SonataIcon } from "./utilities/icons";
import { startUtilities, stopUtilities } from "./utilities/runtime";
import { setFeatureDockProvider } from "./utilities/shared";
import { addOwnedMenuPatch, captureMenuPatches, installSonataMenus, releaseMenuPatches, uninstallSonataMenus } from "./utilities/sonataMenu";

const logger = new Logger(QOL_NAME, "#a6e3a1");

// ─── Moving over from QOL + ChannelSettings ───
// Runs while plugins are still loading — before Discord decides which to
// start — so the old QOL / ChannelSettings plugins (if their folders are
// still installed) are switched off before they can run alongside Sonata,
// and everything is copied over once: which features are on, every feature
// option, dock layout, custom dock buttons, keybinds and the accent color.
// Only while Sonata itself is enabled, so you can never end up with none.

const OLD_NAMES = ["QOL", "ChannelSettings"];
const renamePluginRef = (name: string) => OLD_NAMES.includes(name) ? QOL_NAME : name;

function importLegacySettings() {
    const all = Settings.plugins as any;
    if (all[QOL_NAME]?.enabled === false) return;
    const target = all[QOL_NAME] ?? (all[QOL_NAME] = {});

    // Equicord fills in "on by default" only after every plugin has loaded,
    // and only for plugins with no settings entry yet. This runs earlier and
    // creates the entry, so set it here — otherwise Sonata would start out
    // switched off (with QOL and ChannelSettings already switched off below).
    if (target.enabled === undefined) target.enabled = true;

    for (const old of OLD_NAMES) {
        if (all[old]?.enabled) {
            all[old].enabled = false;
            logger.info(`Switched off ${old} — Sonata replaces it`);
        }
    }
    if (target.importedLegacy) return;

    const qol = all.QOL ?? {};
    const cs = all.ChannelSettings ?? {};

    // Every QOL setting: feature switches (on_*), options (<feature>_*), migration flags.
    for (const [k, v] of Object.entries(qol)) {
        if (k !== "enabled" && k !== "controlChannelId") target[k] = v;
    }

    if (cs.aboutAmbientColor != null) target.aboutAmbientColor = cs.aboutAmbientColor;

    // Keybinds are saved as "PluginName.setting".
    const keybinds = parseJson<Record<string, string>>(cs.keybindMap, {});
    target.keybindMap = JSON.stringify(Object.fromEntries(Object.entries(keybinds).map(([id, kb]) => {
        const dot = id.indexOf(".");
        return [dot < 0 ? id : renamePluginRef(id.slice(0, dot)) + id.slice(dot), kb];
    })));

    // Custom dock buttons are saved by plugin name.
    const custom = parseJson<Record<string, string>>(cs.customDock, {});
    const renamed: Record<string, string> = {};
    for (const [name, icon] of Object.entries(custom)) renamed[renamePluginRef(name)] ??= icon;
    target.customDock = JSON.stringify(renamed);
    const renameId = (id: string) => id.startsWith("custom-plugin:") ? `custom-plugin:${renamePluginRef(id.slice(14))}` : id;
    for (const key of ["dockOrder", "dockHidden"]) {
        target[key] = JSON.stringify([...new Set(parseJson<string[]>(cs[key], []).map(renameId))]);
    }

    target.importedLegacy = true;
    logger.info("Imported QOL and ChannelSettings settings");
}

function parseJson<T>(raw: unknown, fallback: T): T {
    if (typeof raw !== "string" || !raw) return fallback;
    try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
}

/**
 * Opticord was renamed Sonata. Everything it saved moves over once — feature
 * switches, every option, dock layout, keybinds, accent — and the old entry
 * is switched off. Runs before anything else reads the settings.
 */
function moveFromOpticord() {
    const all = Settings.plugins as any;
    const old = (PlainSettings.plugins as any).Opticord;
    if (!old || all[QOL_NAME]?.movedFromOpticord) return;
    const target = all[QOL_NAME] ?? (all[QOL_NAME] = {});
    for (const [k, v] of Object.entries(old)) {
        if (k === "enabled" || v === undefined) continue;
        try { target[k] = JSON.parse(JSON.stringify(v)); } catch { }
    }
    target.enabled = old.enabled !== false;

    // Keybinds ("Plugin.setting") and custom dock buttons are saved by plugin name.
    const rename = (name: string) => name === "Opticord" ? QOL_NAME : name;
    const keybinds = parseJson<Record<string, string>>(target.keybindMap, {});
    target.keybindMap = JSON.stringify(Object.fromEntries(Object.entries(keybinds).map(([id, kb]) => {
        const dot = id.indexOf(".");
        return [dot < 0 ? id : rename(id.slice(0, dot)) + id.slice(dot), kb];
    })));
    const custom = parseJson<Record<string, string>>(target.customDock, {});
    target.customDock = JSON.stringify(Object.fromEntries(Object.entries(custom).map(([n, icon]) => [rename(n), icon])));
    const renameId = (id: string) => id === "custom-plugin:Opticord" ? `custom-plugin:${QOL_NAME}` : id;
    for (const key of ["dockOrder", "dockHidden"]) target[key] = JSON.stringify(parseJson<string[]>(target[key], []).map(renameId));

    target.movedFromOpticord = true;
    if (all.Opticord) all.Opticord.enabled = false;
    logger.info("Moved settings over from Opticord");
}

/** Sonata Doctor became Sonata Insights: keybinds and dock buttons saved under the old plugin name follow it. */
function renameDoctor() {
    const target = (Settings.plugins as any)[QOL_NAME];
    if (!target || target.renamedDoctor) return;
    const from = "SonataDoctor", to = "SonataInsights";
    const keybinds = parseJson<Record<string, string>>(target.keybindMap, {});
    target.keybindMap = JSON.stringify(Object.fromEntries(Object.entries(keybinds).map(([id, kb]) => [id.startsWith(`${from}.`) ? to + id.slice(from.length) : id, kb])));
    const custom = parseJson<Record<string, string>>(target.customDock, {});
    target.customDock = JSON.stringify(Object.fromEntries(Object.entries(custom).map(([n, icon]) => [n === from ? to : n, icon])));
    for (const key of ["dockOrder", "dockHidden"]) target[key] = JSON.stringify(parseJson<string[]>(target[key], []).map(id => id === `custom-plugin:${from}` ? `custom-plugin:${to}` : id));
    target.renamedDoctor = true;
}

moveFromOpticord();
importLegacySettings();
renameDoctor();

type Feature = Record<string, any> & { name: string; description: string; patches?: any[]; };

/** Feature key (its folder name) -> the original plugin object. */
const FEATURES: Record<string, Feature> = {
    anonymiseFileNames, callTimer, crashHandler, disableCallIdle, forceOwnerCrown,
    imageFilename, imageLink, imageZoom, messageLogger, messageLoggerEnhanced, mutualGroupDMs,
    noUnblockToJump, onePingPerDM, permissionsViewer, pinDms, readAllNotificationsButton,
    reverseImageSearch, roleColorEverywhere, serverInfo, showHiddenChannels, showTimeoutDuration,
    silentTyping, spotifyCrack, translate, viewIcons, voiceDownload, voiceMessages,
    betterInvites, declutter, gifMaker, splitLargeMessages, zipPreview,
    messageCleanerUtil, platformIndicators, relationshipTracker,
    birthdayReminders, multiQuote, messagePreview,
    filePreviewer, imageToText, qrCodes, calculator, scheduledMessages,
    expressionStealer, spotifyControls,
    linkEmbedFixer, longMessageCollapser, fancyText, chatEffects, embedCopier,
    screenshotStyler, onThisDay, brokenPatchFinder, calendar,
    streamQuality, liveRpcEditor, inviteManager,
    encoderTools, coloredText, charactersPicker, stealProfile,
    gameActivityToggle, platformSpoofer, showRolesInChat, soundStudio, miniGames,
    typingSounds, autoVolume, streaks, videoSpeed, waveformPlayer, sonataBadge, shareSetup, linkCleaner, asciiArt, autoCorrect, commandShortcuts, scamShield, personTags, readAloud, wallet,
    smoothChat, currencyConverter, giftWrap, whisper, mediaDownloader, stickyMessage, modelPreview, splitView,
    reminders, todoLists, fontSwapper, fileConverter, videoEditor, tiktokTracker, robloxTools, steamWatcher, quickText, channelNotes, themeStudio, botManager, antiquest, customBadges, localNames, games, packageTracker,
    antimod, autoReact, categoryChannelGreeter, embedSender, exploiterReport, fakeDms, fakedeafen, messageTimer, statusAvatar, stealth, voiceTimeline,
};

/**
 * Features that only work on top of another feature. Standalone, these were
 * plugin dependencies (e.g. MessageLoggerEnhanced depended on the
 * MessageLogger plugin); inside QOL the required feature has to be running.
 */
const REQUIRES: Record<string, string[]> = {
    messageLoggerEnhanced: ["messageLogger"],
};

/** The first batch of features — already migrated by the original "migrated" flag. */
const FIRST_BATCH = new Set([
    "anonymiseFileNames", "callTimer", "crashHandler", "disableCallIdle", "forceOwnerCrown",
    "imageFilename", "imageLink", "imageZoom", "messageLogger", "mutualGroupDMs",
    "noUnblockToJump", "onePingPerDM", "pinDms", "readAllNotificationsButton", "relationshipNotifier",
    "reverseImageSearch", "roleColorEverywhere", "serverInfo", "showHiddenChannels", "showTimeoutDuration",
    "silentTyping", "spotifyCrack", "translate", "viewIcons", "voiceDownload", "voiceMessages",
]);

/** Features taken out of Sonata; their leftover settings are cleared once. */
const REMOVED_FEATURES = ["stereo", "voiceChanger"];

function clearRemovedFeatures() {
    const target = (Settings.plugins as any)[QOL_NAME];
    if (!target) return;
    for (const key of REMOVED_FEATURES) {
        for (const k of Object.keys(target)) {
            if (k.startsWith(`${key}_`) || k === `on_${key}` || k === `migrated_${key}`) delete target[k];
        }
    }
}

clearRemovedFeatures();

/** New features that change what you send start switched off — you turn them on yourself. */
const STARTS_OFF = new Set(["autoCorrect"]);

/**
 * A plugin moved into Sonata stays off if you had it off. Runs while
 * Sonata loads — before its patches are registered — so a switched-off
 * plugin's patches never apply, not even for one session. Only for features
 * not yet taken over (the takeover below copies their settings on start).
 */
function keepSwitchedOffPluginsOff() {
    const target = (Settings.plugins as any)[QOL_NAME];
    if (!target || target.enabled === false) return;
    for (const [key, f] of Object.entries(FEATURES)) {
        if (STARTS_OFF.has(key) && target[`on_${key}`] === undefined) { target[`on_${key}`] = false; continue; }
        if (target[`migrated_${key}`] || (target.migrated && FIRST_BATCH.has(key))) continue;
        if (target[`on_${key}`] !== undefined) continue;
        if ((PlainSettings.plugins as any)[f.name]?.enabled === false) target[`on_${key}`] = false;
    }
}

keepSwitchedOffPluginsOff();

// Equicord does two things for every plugin it registers that QOL has to do
// itself for bundled features (they aren't registered plugins):
//  1. bind certain callbacks to their plugin, so `this` works inside them;
//  2. switch on the helper API plugins a plugin needs, detected from what it
//     declares (a chat bar button needs ChatInputButtonAPI, etc.). Without
//     this, a feature that doesn't list those APIs explicitly (Message Purger's
//     chat bar button) would only work if some other plugin needed them too.
// Both lists mirror src/api/PluginManager.ts.
const KEYS_TO_BIND = [
    "onBeforeMessageEdit", "onBeforeMessageSend", "onMessageClick",
    "renderMemberListDecorator", "renderMessageAccessory", "renderMessageDecoration",
    "renderNicknameIcon",
] as const;

const API_FOR_FIELD: Record<string, string> = {
    commands: "CommandsAPI",
    onBeforeMessageEdit: "MessageEventsAPI",
    onBeforeMessageSend: "MessageEventsAPI",
    onMessageClick: "MessageEventsAPI",
    chatBarButton: "ChatInputButtonAPI",
    chatBarButtonWrapper: "ChatInputButtonAPI",
    renderMemberListDecorator: "MemberListDecoratorsAPI",
    renderMessageAccessory: "MessageAccessoriesAPI",
    renderMessageDecoration: "MessageDecorationsAPI",
    messagePopoverButton: "MessagePopoverAPI",
    userProfileBadge: "BadgeAPI",
    renderNicknameIcon: "NicknameIconsAPI",
    headerBarButton: "HeaderBarAPI",
    audioProcessor: "AudioPlayerAPI",
    userAreaButton: "UserAreaAPI",
    renderProfileCollection: "ProfileCollectionsAPI",
    renderProfileSection: "ProfileSectionsAPI",
};

for (const f of Object.values(FEATURES)) {
    for (const key of KEYS_TO_BIND) {
        if (typeof f[key] === "function") f[key] = f[key].bind(f);
    }
}

function neededApis(f: Feature): string[] {
    return Object.entries(API_FOR_FIELD)
        .filter(([field]) => field === "commands" ? !!f.commands?.length : !!f[field])
        .map(([, api]) => api);
}

/** "ShowHiddenChannels" -> "Show Hidden Channels", "PinDMs" -> "Pin DMs". */
const displayName = (key: string) => FEATURES[key].name.replace(/([a-z])([A-Z])/g, "$1 $2");

/** Settings page / display order: alphabetical by the name you'd recognise. */
const ORDER = Object.keys(FEATURES).sort((a, b) => displayName(a).localeCompare(displayName(b)));

// Note when each feature's window is opened — from the Features page, the dock, its plugin card or
// anywhere else — so Insights can tell which heavy features you don't use.
for (const key of Object.keys(FEATURES)) {
    const f = FEATURES[key] as any;
    if (typeof f.openSettingsModal !== "function" || f.openSettingsModal.__sonataUse) continue;
    const open = f.openSettingsModal;
    f.openSettingsModal = function (this: unknown, ...args: unknown[]) { noteUse(key); return open.apply(this, args); };
    f.openSettingsModal.__sonataUse = true;
}

const onKey = (key: string) => `on_${key}`;
const hasPatches = (key: string) => !!FEATURES[key].patches?.length;

// QOL subscribes Flux listeners itself (instead of leaving them on the
// feature for startPlugin), because Equicord only auto-subscribes plugins it
// has registered — pulled off here, before anything can start.
const fluxOf: Record<string, Record<string, (e: any) => any>> = {};
for (const key of ORDER) {
    const f = FEATURES[key];
    if (f.flux) {
        fluxOf[key] = f.flux;
        delete f.flux;
    }
}

// Chat bar buttons too: instead of each feature adding its own, they all go in
// the ♫ tray (sonata/chatTray), so the chat bar holds one button, not ten.
const chatButtonOf: Record<string, ChatBarButtonData> = {};
for (const key of ORDER) {
    const f = FEATURES[key];
    if (f.chatBarButton) {
        chatButtonOf[key] = f.chatBarButton;
        delete f.chatBarButton;
    }
}

// ─── State ───

function isOn(key: string): boolean {
    return Settings.plugins[QOL_NAME]?.[onKey(key)] !== false;
}

/** The standalone built-in version of this feature is running. */
// Features that pause (but never take over or switch anything off) while
// another plugin doing the same job is on — e.g. Equicord's Music Controls,
// which also has Tidal and lyrics, so turning it off isn't Sonata's call.
const STEPS_ASIDE_FOR: Record<string, string[]> = {
    spotifyControls: ["MusicControls"],
    // Equicord's ClearURLs cleans links too; one is enough.
    linkCleaner: ["ClearURLs"],
    // Equicord's CustomSounds swaps the same sounds; only one should.
    soundStudio: ["CustomSounds"],
};

/** The enabled plugin this feature is pausing for, if any. */
function blockingPlugin(key: string): string | undefined {
    return [FEATURES[key].name, ...(STEPS_ASIDE_FOR[key] ?? [])].find(n => isPluginEnabled(n));
}

function builtinOn(key: string): boolean {
    return blockingPlugin(key) != null;
}

function wantsToRun(key: string): boolean {
    return isOn(key) && !builtinOn(key) && (REQUIRES[key] ?? []).every(wantsToRun);
}

/** A feature this one needs is switched off or paused. */
function missingRequirement(key: string): string | undefined {
    return (REQUIRES[key] ?? []).find(r => !wantsToRun(r));
}

// Whether each feature was active when Discord loaded. Patches can only be
// applied at load, so for features with patches this is what's actually
// running this session; flipping their switch takes effect after a reload
// (Ctrl+R / "Apply" — a window reload, not a full client restart).
const bootActive = new Map<string, boolean>();
function activeAtBoot(key: string): boolean {
    if (!bootActive.has(key)) bootActive.set(key, wantsToRun(key));
    return bootActive.get(key)!;
}

// ─── Patches ───

function scopeReplace(replace: string | ((...args: any[]) => string), key: string) {
    const self = `$self.f.${key}`;
    return typeof replace === "function"
        ? (...args: any[]) => replace(...args).replaceAll("$self", self)
        : replace.replaceAll("$self", self);
}

function scopePatch(key: string, patch: any) {
    const scopeOne = (rep: any) => {
        const copy = Object.create(Object.getPrototypeOf(rep), Object.getOwnPropertyDescriptors(rep));
        const desc = Object.getOwnPropertyDescriptor(rep, "replace");
        if (desc?.get) {
            Object.defineProperty(copy, "replace", {
                get: () => scopeReplace(desc.get!.call(rep), key),
                configurable: true,
                enumerable: true,
            });
        } else {
            copy.replace = scopeReplace(rep.replace, key);
        }
        return copy;
    };

    const originalPredicate = patch.predicate;
    return {
        ...patch,
        replacement: Array.isArray(patch.replacement)
            ? patch.replacement.map(scopeOne)
            : scopeOne(patch.replacement),
        predicate: () => activeAtBoot(key) && (originalPredicate ? originalPredicate.call(patch) : true),
    };
}

// ─── Starting / stopping features ───

const running = runningFeatures;
const fluxSubscriptions = new Map<string, [string, (e: any) => any][]>();
let qolRunning = false;

function startFeature(key: string) {
    if (running.has(key)) return;
    const f = FEATURES[key];
    // Timed, and any failure kept, for Sonata Insights.
    const t0 = performance.now();
    try {
        // Its message-menu items are gathered into the "Sonata" submenu.
        if (!captureMenuPatches(key, () => startPlugin(f as any))) {
            logger.error(`Failed to start ${f.name}`);
            startErrors.set(key, "It didn't start (see the console for details).");
            return;
        }
    } catch (e) {
        logger.error(`Failed to start ${f.name}\n`, e);
        startErrors.set(key, e instanceof Error ? e.message : String(e));
        return;
    }
    startTimes.set(key, performance.now() - t0);
    startErrors.delete(key);

    const subs: [string, (e: any) => any][] = [];
    for (const [event, handler] of Object.entries(fluxOf[key] ?? {})) {
        const wrapped = function (this: any, ...args: any[]) {
            try {
                const res = handler.apply(f, args as [any]);
                return res instanceof Promise
                    ? res.catch(e => logger.error(`${f.name}: Error while handling ${event}\n`, e))
                    : res;
            } catch (e) {
                logger.error(`${f.name}: Error while handling ${event}\n`, e);
            }
        };
        FluxDispatcher.subscribe(event as any, wrapped);
        subs.push([event, wrapped]);
    }
    fluxSubscriptions.set(key, subs);
    running.add(key);
    if (chatButtonOf[key]) addTrayButton(key, displayName(key), chatButtonOf[key]);
}

function stopFeature(key: string) {
    if (!running.has(key)) return;
    const f = FEATURES[key];
    try {
        stopPlugin(f as any);
    } catch (e) {
        logger.error(`Failed to stop ${f.name}\n`, e);
    }
    releaseMenuPatches(key);
    removeTrayButton(key);
    for (const [event, wrapped] of fluxSubscriptions.get(key) ?? []) {
        FluxDispatcher.unsubscribe(event as any, wrapped);
    }
    fluxSubscriptions.delete(key);
    running.delete(key);
}

/** Can this feature run right now, given what was patched at load? */
function canRunNow(key: string) {
    return hasPatches(key) ? activeAtBoot(key) : wantsToRun(key);
}

function setFeatureOn(key: string, on: boolean) {
    settings.store[onKey(key)] = on;

    if (!hasPatches(key)) {
        // No patches, so it can switch on/off immediately.
        if (qolRunning) {
            if (on && wantsToRun(key)) startFeature(key);
            else stopFeature(key);
        }
        return;
    }

    if (settings.store.autoApply) scheduleAutoApply();
    else showToast(`${displayName(key)} will be ${on ? "on" : "off"} after a reload (Ctrl+R, or Apply on the QOL page)`, "message");
}

/** Switch many features at once: one reload (or one message), not one per feature. */
function setManyFeaturesOn(keys: string[], on: boolean) {
    let needsReload = 0;
    for (const key of keys) {
        if (isOn(key) === on) continue;
        settings.store[onKey(key)] = on;
        if (!hasPatches(key)) {
            if (qolRunning) {
                if (on && wantsToRun(key)) startFeature(key);
                else stopFeature(key);
            }
        } else needsReload++;
    }
    if (!needsReload) return;
    if (settings.store.autoApply) scheduleAutoApply();
    else showToast(`${needsReload} feature${needsReload === 1 ? "" : "s"} will switch ${on ? "on" : "off"} after a reload (Ctrl+R, or Apply)`, "message");
}

// ─── First-run migration from the standalone built-ins ───

const migratedKey = (key: string) => `migrated_${key}`;
const isMigrated = (key: string) =>
    !!settings.store[migratedKey(key)] || (!!settings.store.migrated && FIRST_BATCH.has(key));

function migrateFromBuiltins() {
    const takenOver: string[] = [];
    for (const key of ORDER) {
        if (isMigrated(key)) continue;
        const original = FEATURES[key].name;

        // Copy every stored value (including private ones not in the
        // settings definition), so nothing resets.
        const raw = PlainSettings.plugins[original];
        if (raw) {
            for (const [k, v] of Object.entries(raw)) {
                if (k === "enabled" || v === undefined) continue;
                try {
                    settings.store[prefixKey(key, k)] = JSON.parse(JSON.stringify(v));
                } catch { }
            }
        }

        // Switch the built-in off so its patches and QOL's don't both apply.
        // Plugins the built-in depended on (MessageLoggerEnhanced turned the
        // built-in MessageLogger on) get switched off too when QOL has them.
        for (const name of [original, ...(REQUIRES[key] ?? []).map(r => FEATURES[r].name)]) {
            if (Settings.plugins[name]?.enabled) {
                Settings.plugins[name].enabled = false;
                if (!takenOver.includes(name)) takenOver.push(name);
            }
        }

        settings.store[migratedKey(key)] = true;
    }

    if (takenOver.length) {
        logger.info("Took over from built-in plugins:", takenOver.join(", "));
        showNotice(
            `QOL took over ${takenOver.length} plugin${takenOver.length === 1 ? "" : "s"} (settings copied). Reload Discord to finish switching over.`,
            "Reload",
            reloadNow,
        );
    }
}

// ─── Settings page ───

function FeatureHeader({ featureKey: key }: { featureKey: string; }) {
    const s = settings.use([onKey(key)]);
    const on = s[onKey(key)] !== false;
    const builtin = builtinOn(key);
    const restartPending = hasPatches(key) && qolRunning && (on && !builtin) !== activeAtBoot(key);

    return (
        <Card style={{ marginTop: 16, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                    <Heading tag="h3" style={{ margin: 0 }}>{displayName(key)}</Heading>
                    <Paragraph style={{ marginTop: 4, color: "var(--text-muted)" }}>{FEATURES[key].description}</Paragraph>
                    {!builtin && on && missingRequirement(key) && (
                        <Paragraph style={{ marginTop: 6, color: "var(--text-feedback-warning, var(--status-warning))" }}>
                            Needs {displayName(missingRequirement(key)!)} to be on.
                        </Paragraph>
                    )}
                    {builtin && (
                        <Paragraph style={{ marginTop: 6, color: "var(--text-feedback-warning, var(--status-warning))" }}>
                            Paused: the built-in {FEATURES[key].name} plugin is enabled. Turn it off to use this one.
                        </Paragraph>
                    )}
                    {restartPending && (
                        <Paragraph style={{ marginTop: 6, color: "var(--text-feedback-warning, var(--status-warning))" }}>
                            Reload Discord (Ctrl+R) to apply.
                        </Paragraph>
                    )}
                </div>
                <Switch checked={on} onChange={v => setFeatureOn(key, v)} />
            </div>
        </Card>
    );
}

function Overview() {
    settings.use(ORDER.map(onKey));
    const onCount = ORDER.filter(isOn).length;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Paragraph style={{ color: "var(--text-muted)" }}>
                {onCount} of {ORDER.length} features on. Features that change Discord's code apply after a quick reload (Ctrl+R), not a full restart.
            </Paragraph>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Button size="small" onClick={() => openPage()}>Open Sonata</Button>
                <Paragraph style={{ color: "var(--text-muted)", margin: 0 }}>
                    Every feature, plugin, dock button and keybind on one screen — also on the ♫ button at the start of your dock.
                </Paragraph>
            </div>
        </div>
    );
}

/**
 * Put a feature option under QOL: hide it while the feature is off, and keep
 * its own hidden()/disabled() checks working — they expect `this` to be the
 * feature's settings object, not QOL's.
 */
function scopeOptionDef(key: string, def: PluginSettingDef, ownSettings: any): PluginSettingDef {
    const copy = Object.create(Object.getPrototypeOf(def), Object.getOwnPropertyDescriptors(def));
    // A feature may give "hidden"/"disabled" as a value, a function, or a getter (GameActivityToggle
    // does). A getter-only property can't be assigned to — that throws and stops Sonata (and
    // Equicord) loading — so they're redefined instead, reading the original fresh each time.
    const read = (prop: "hidden" | "disabled") => {
        const desc = Object.getOwnPropertyDescriptor(def, prop);
        const v = desc?.get ? desc.get.call(def) : (def as any)[prop];
        return typeof v === "function" ? v.call(ownSettings) : !!v;
    };
    const set = (prop: "hidden" | "disabled", value: () => boolean) =>
        Object.defineProperty(copy, prop, { value, writable: true, configurable: true, enumerable: true });
    set("hidden", () => !isOn(key) || read("hidden"));
    if ((def as any).disabled != null) set("disabled", () => read("disabled"));
    return copy;
}

const qolDef: SettingsDefinition = {
    overview: {
        type: OptionType.COMPONENT,
        component: () => <Overview />,
    },
    // Plugin Utilities (formerly ChannelSettings) — managed from its tabs.
    dockOrder: { type: OptionType.STRING, description: "Dock button order (JSON).", default: "[]", hidden: true },
    dockIcons: { type: OptionType.STRING, description: "Icons chosen for built-in dock buttons (JSON).", default: "{}", hidden: true },
    dockHidden: { type: OptionType.STRING, description: "Hidden dock buttons (JSON).", default: "[]", hidden: true },
    dockColor: { type: OptionType.STRING, description: "Dock buttons' colour: empty for Discord's, \"accent\", or a hex code.", default: "", hidden: true },
    dockLayout: { type: OptionType.STRING, description: "Dock layout: stack (rows) or line (one line).", default: "stack", hidden: true },
    dockSize: { type: OptionType.STRING, description: "Dock button size: small, normal or large.", default: "normal", hidden: true },
    keybindMap: { type: OptionType.STRING, description: "Keybinds for on/off settings (JSON).", default: "{}", hidden: true },
    customDock: { type: OptionType.STRING, description: "Plugins added to the dock (JSON).", default: "{}", hidden: true },
    aboutAmbientColor: { type: OptionType.STRING, description: "Accent color (hex) — set in Plugin Utilities → About.", default: "", hidden: true },
    sonataPreset: { type: OptionType.STRING, description: "Sonata's design (just minimal for now).", default: "minimal", hidden: true },
    sonataLayers: { type: OptionType.STRING, description: "Which layers of each design are switched on (JSON).", default: "{}", hidden: true },
    sonataAccentMode: { type: OptionType.STRING, description: "Accent style: solid, gradient, seasonal or album.", default: "solid", hidden: true },
    sonataGradient: { type: OptionType.STRING, description: "Gradient accent preset, or custom.", default: "aurora", hidden: true },
    sonataGradientA: { type: OptionType.STRING, description: "Custom gradient: first colour.", default: "#22d3ee", hidden: true },
    sonataGradientB: { type: OptionType.STRING, description: "Custom gradient: second colour.", default: "#8b5cf6", hidden: true },
    sonataHolidays: { type: OptionType.BOOLEAN, description: "Seasons accent: use holiday colours on holidays.", default: true, hidden: true },
    sonataFeatureIcons: { type: OptionType.BOOLEAN, description: "Show an icon on each feature's card.", default: true, hidden: true },
    sonataWinRound: { type: OptionType.NUMBER, description: "Window style: how round the corners of Sonata's windows are (0.4 to 1.6).", default: 1, hidden: true },
    sonataWinDark: { type: OptionType.STRING, description: "Window style: dark, darker or black.", default: "dark", hidden: true },
    sonataWinBorders: { type: OptionType.STRING, description: "Window style: subtle or clear borders.", default: "subtle", hidden: true },
    sonataWinFooter: { type: OptionType.BOOLEAN, description: "Window style: show the status line along the bottom of each window.", default: true, hidden: true },
    sonataPinned: { type: OptionType.STRING, description: "Features pinned to the top of Sonata's Features tab (JSON list).", default: "[]", hidden: true },
    sonataFeatureIconMap: { type: OptionType.STRING, description: "Icons you picked for features (JSON: feature → icon).", default: "{}", hidden: true },
    sonataSouthern: { type: OptionType.BOOLEAN, description: "Seasons accent: southern hemisphere seasons.", default: false, hidden: true },
    sonataOccasion: { type: OptionType.STRING, description: "Seasons accent: a season or holiday to always use, or current.", default: "current", hidden: true },
    sonataAnimate: { type: OptionType.BOOLEAN, description: "Sonata's page: the drifting colour wash, turning note and ripples.", default: true, hidden: true },
    sonataInverted: { type: OptionType.BOOLEAN, description: "Invert the background (dark becomes light).", default: false, hidden: true },
    sonataWelcomed: { type: OptionType.BOOLEAN, description: "The welcome tour has been shown.", default: false, hidden: true },
    sonataSeenVersion: { type: OptionType.STRING, description: "The newest What's new entry you've seen.", default: "", hidden: true },
    sonataUpdateNotice: { type: OptionType.BOOLEAN, description: "Show a bar at the top of Discord when there's a newer Sonata on GitHub.", default: true, hidden: true },
    sonataProfiles: { type: OptionType.STRING, description: "Your saved feature profiles (School, Gaming…).", default: "", hidden: true },
    sonataInvertHues: { type: OptionType.BOOLEAN, description: "Inverted background: flip the colours too (a true negative).", default: false, hidden: true },
    perfLazyChat: { type: OptionType.BOOLEAN, description: "Performance: only draw messages near the screen.", default: false, hidden: true },
    perfNoBlur: { type: OptionType.BOOLEAN, description: "Performance: turn off blur effects.", default: false, hidden: true },
    perfNoProfileEffects: { type: OptionType.BOOLEAN, description: "Performance: hide profile effects.", default: false, hidden: true },
    perfNoDecorations: { type: OptionType.BOOLEAN, description: "Performance: hide avatar decorations.", default: false, hidden: true },
    perfNoNameplates: { type: OptionType.BOOLEAN, description: "Performance: hide animated nameplates.", default: false, hidden: true },
    perfNoShadows: { type: OptionType.BOOLEAN, description: "Performance: flatter look (no shadows).", default: false, hidden: true },
    perfPause: { type: OptionType.STRING, description: "Performance: pause animations when Discord is in the background (off/hidden/unfocused).", default: "off", hidden: true },
    perfBigServer: { type: OptionType.NUMBER, description: "Performance: hide the member list in servers with at least this many members (0 = off).", default: 0, hidden: true },
    perfGaming: { type: OptionType.BOOLEAN, description: "Performance: Gaming mode is on.", default: false, hidden: true },
    perfGamingKey: { type: OptionType.STRING, description: "Performance: Gaming mode hotkey.", default: "ctrl+shift+g", hidden: true },
    perfDeferStart: { type: OptionType.BOOLEAN, description: "Performance: start features that can wait after Discord has loaded.", default: false, hidden: true },
    cacheAuto: { type: OptionType.STRING, description: "Clean disk space automatically: off, weekly or limit.", default: "off", hidden: true },
    cacheLimitMB: { type: OptionType.NUMBER, description: "Size (MB) that triggers automatic cleaning.", default: 1024, hidden: true },
    cacheLastCleaned: { type: OptionType.NUMBER, description: "When disk space was last cleaned.", default: 0, hidden: true },
    cacheFreedTotal: { type: OptionType.NUMBER, description: "Disk space freed in total (bytes).", default: 0, hidden: true },
    cacheHistory: { type: OptionType.STRING, description: "Past clean-ups (JSON).", default: "[]", hidden: true },
    perfBackup: { type: OptionType.STRING, description: "Performance: your settings from before \"Speed everything up\".", default: "", hidden: true },
    chatTrayOpen: { type: OptionType.BOOLEAN, description: "Whether the chat bar ♫ tray is open.", default: false, hidden: true },
    chatTrayPinned: { type: OptionType.STRING, description: "Chat bar buttons kept next to the ♫ (JSON).", default: "[]", hidden: true },
    chatTrayHidden: { type: OptionType.STRING, description: "Chat bar buttons not shown at all (JSON).", default: "[]", hidden: true },
    chatTrayFirst: { type: OptionType.STRING, description: "Chat bar buttons put at the start of the tray (JSON, in order).", default: "[]", hidden: true },
    chatTrayLayoutApplied: { type: OptionType.BOOLEAN, description: "The chat bar layout asked for on 2026-10-11 has been applied.", default: false, hidden: true },
    chatTrayLast: { type: OptionType.STRING, description: "Chat bar buttons put at the end of the tray (JSON, in order).", default: "[]", hidden: true },
    importedLegacy: { type: OptionType.BOOLEAN, description: "Internal: QOL / ChannelSettings settings imported.", default: false, hidden: true },
    movedFromOpticord: { type: OptionType.BOOLEAN, description: "Internal: settings moved over from Opticord (Sonata's old name).", default: false, hidden: true },
    autoApply: {
        type: OptionType.BOOLEAN,
        description: "Reload Discord automatically right after switching a feature that needs it.",
        default: false,
        hidden: true,
    },
    migrated: {
        type: OptionType.BOOLEAN,
        description: "Internal: whether settings were already copied from the built-in plugins.",
        default: false,
        hidden: true,
    },
};

/** Feature key -> its (prefixed) option keys on QOL, in definition order. */
const optionKeysByFeature: Record<string, string[]> = {};

for (const key of ORDER) {
    qolDef[`__${key}`] = {
        type: OptionType.COMPONENT,
        component: () => <FeatureHeader featureKey={key} />,
    };
    qolDef[migratedKey(key)] = {
        type: OptionType.BOOLEAN,
        description: `Internal: whether ${displayName(key)}'s settings were copied from the built-in plugin.`,
        default: false,
        hidden: true,
    };
    qolDef[onKey(key)] = {
        type: OptionType.BOOLEAN,
        description: `Enable ${displayName(key)}`,
        default: true,
        hidden: true,
    };

    const own = featureSettings.get(key);
    optionKeysByFeature[key] = [];
    if (!own) continue;
    for (const [opt, def] of Object.entries(own.def)) {
        qolDef[prefixKey(key, opt)] = scopeOptionDef(key, def as PluginSettingDef, own);
        optionKeysByFeature[key].push(prefixKey(key, opt));
    }
}

const settings = definePluginSettings(qolDef);

// ─── Sonata's screen ───

function openPage() {
    openSonata(api);
}

/** Features whose options marked "restart needed" were changed this session. */
const pendingOptions = new Set<string>();

/**
 * Applying = reloading Discord's window (what Ctrl+R does). Patches are
 * baked into Discord's code as it loads, so that's the least it takes;
 * the app itself keeps running, so it's a couple of seconds, not a restart.
 * Settings are written to disk as they change, so nothing is lost.
 */
function reloadNow() {
    location.reload();
}

function pendingCount() {
    const switched = ORDER.filter(k => { const s = statusOf(k); return s === "apply-on" || s === "apply-off"; });
    return new Set([...switched, ...pendingOptions]).size;
}

// Auto-apply waits a moment so bulk changes ("All on") cause one reload,
// not one per feature.
let autoApplyTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleAutoApply() {
    clearTimeout(autoApplyTimer);
    autoApplyTimer = setTimeout(() => {
        if (pendingCount() > 0) reloadNow();
    }, 900);
}

function statusOf(key: string): FeatureStatus {
    if (builtinOn(key)) return "paused";
    if (isOn(key) && missingRequirement(key)) return "needs";
    if (hasPatches(key) && qolRunning && wantsToRun(key) !== activeAtBoot(key))
        return wantsToRun(key) ? "apply-on" : "apply-off";
    if (running.has(key) || (!qolRunning && wantsToRun(key))) return "active";
    return "off";
}

const api: QolApi = {
    keys: ORDER,
    pausedBy: key => blockingPlugin(key),
    name: displayName,
    description: key => FEATURES[key].description,
    originalName: key => FEATURES[key].name,
    status: statusOf,
    isOn,
    setOn: setFeatureOn,
    setManyOn: setManyFeaturesOn,
    missingRequirement: key => {
        const r = missingRequirement(key);
        return r && displayName(r);
    },
    optionKeys: key => optionKeysByFeature[key] ?? [],
    // Features with their own window (e.g. Relationship Tracker's log). Only
    // while running, since the window shows data the feature collects.
    hasWindow: key => typeof (FEATURES[key] as any).openSettingsModal === "function" && running.has(key),
    openWindow: key => (FEATURES[key] as any).openSettingsModal?.(),
    settings,
    isInstant: key => !hasPatches(key),
    markOptionPending: key => {
        pendingOptions.add(key);
        if (settings.store.autoApply) scheduleAutoApply();
    },
    pendingCount,
    apply: reloadNow,
    autoApply: () => !!settings.store.autoApply,
    setAutoApply: on => {
        settings.store.autoApply = on;
        if (on && pendingCount() > 0) scheduleAutoApply();
    },
};

// Sonata's features in the dock (Plugin Utilities → Dock → Add).
const hasOptions = (key: string) => (optionKeysByFeature[key] ?? []).some(k => (settings.def as any)[k]?.type !== OptionType.CUSTOM);
const hasWindow = (key: string) => typeof (FEATURES[key] as any).openSettingsModal === "function";

setDoctorProvider({
    features: () => ORDER.map(key => ({
        key,
        name: displayName(key),
        status: statusOf(key),
        on: isOn(key),
        patches: (FEATURES[key].patches ?? []).length,
        startMs: startTimes.get(key),
        error: startErrors.get(key),
        pausedBy: blockingPlugin(key),
        needs: missingRequirement(key) ? displayName(missingRequirement(key)!) : undefined,
    })),
    // Getters: settings.store throws if read before the plugin is initialized.
    get store() { return settings.store as any; },
    defs: settings.def as any,
    setOn: setFeatureOn,
    reload: reloadNow,
    hasWindow,
});

setFeatureDockProvider({
    list: () => ORDER.map(key => ({
        key,
        name: displayName(key),
        running: running.has(key),
        opens: hasWindow(key) ? "window" : hasOptions(key) ? "options" : "page",
    })),
    open(key, e) {
        if (!running.has(key)) {
            showToast(`${displayName(key)} isn't running — switch it on in Sonata`, "message");
            openPage();
            return;
        }
        if (hasWindow(key)) (FEATURES[key] as any).openSettingsModal(e);
        else if (hasOptions(key)) openOptions(api, key);
        else openPage();
    },
    openOptions(key) {
        if (hasOptions(key)) openOptions(api, key);
        else openPage();
    },
});

// ─── Plugin ───

const plugin = definePlugin({
    name: "Sonata",
    description: "Every Quality of Life feature (Message Logger, Translate, Calendar, Chat Effects and many more), your plugins, the dock and keybinds — on one screen of its own, opened from the ♫ button on your dock.",
    enabledByDefault: true,
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    tags: ["Utility"],
    searchTerms: ORDER.flatMap(key => [FEATURES[key].name, displayName(key)]),
    settings,

    // API plugins the features need. Names of bundled features are left out:
    // those are satisfied inside QOL (see REQUIRES), and listing them would
    // switch the separate built-in back on.
    dependencies: [...new Set(["ChatInputButtonAPI", ...ORDER.flatMap(key => [...(FEATURES[key].dependencies ?? []), ...neededApis(FEATURES[key])])])]
        .filter(dep => !ORDER.some(key => FEATURES[key].name === dep)),

    patches: [
        ...ORDER.flatMap(key => (FEATURES[key].patches ?? []).map(p => scopePatch(key, p))),
        // The dock under your user panel (Plugin Utilities → Dock).
        dockPatch,
        // "In same voice" instead of "In voice" for people in your call.
        ...sameVoicePatches,
    ],

    useSameVoiceLabel,
    sameVoiceText,

    renderDock,

    // Sonata's own interface: a dock button for Sonata (or its "open"
    // button in Plugin Utilities) opens the page.
    openSettingsModal: () => openPage(),

    /** The bundled features, reachable from patches as $self.f.<key>. */
    f: FEATURES,

    // The Toolbox only asks registered plugins for actions, so Sonata
    // collects the running features' actions and shows them under its name.
    toolboxActions() {
        const items: ReactNode[] = [];
        for (const key of ORDER) {
            const actions = running.has(key) ? FEATURES[key].toolboxActions : null;
            if (!actions) continue;
            if (typeof actions === "function") {
                const node = actions.call(FEATURES[key]);
                if (Array.isArray(node)) items.push(...node);
                else if (node) items.push(node);
                continue;
            }
            for (const [label, action] of Object.entries(actions as Record<string, () => void>)) {
                items.push(<Menu.MenuItem id={`qol-${key}-${label}`} key={`qol-${key}-${label}`} label={label} action={action} />);
            }
        }
        return items;
    },

    start() {
        // Rainbow was replaced by Seasons & holidays.
        if ((settings.store.sonataAccentMode as string) === "rainbow") settings.store.sonataAccentMode = "seasonal";
        // Sonata's own dock button: always there, always first.
        addDockButton(PINNED_DOCK_ID, { icon: SonataIcon, tooltipText: "Sonata", onClick: () => openSonata(api), priority: -1000 });
        // Every right-click menu gets one "Sonata" submenu holding everything Sonata adds to it.
        installSonataMenus(() => openPage());
        startAlbumWatch();
        // Feature windows use Sonata's accent instead of Discord's blue.
        startFeatureAccent();
        startDockColor();
        // A blue bar at the top of Discord when GitHub has a newer Sonata.
        startUpdateNotice(() => settings.store.sonataUpdateNotice !== false);
        // Performance settings (style rules that skip expensive drawing).
        startPerformance();
        // Disk space: automatic cleaning, decided a minute after start.
        startCacheAuto();
        // A memory reading a minute, for the growth line in Performance → Disk space & memory.
        startMemoryWatch();
        // People who used Sonata before the welcome tour existed don't need it — they get What's new instead.
        if (!settings.store.sonataWelcomed && Object.keys(PlainSettings.plugins[QOL_NAME] ?? {}).some(k => k.startsWith("on_"))) settings.store.sonataWelcomed = true;
        // The chat bar ♫ that holds every feature's chat bar button.
        // Asked for on 2026-10-11: hide Roblox Tools, File Converter and TikTok Tracker from the chat bar,
        // and keep Message Purger at the far right. Applied once; the ♫ right-click menu changes it after.
        if (!settings.store.chatTrayLayoutApplied) {
            const read = (v: string) => { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
            settings.store.chatTrayHidden = JSON.stringify([...new Set([...read(settings.store.chatTrayHidden), "robloxTools", "fileConverter", "tiktokTracker"])]);
            settings.store.chatTrayLast = JSON.stringify([...read(settings.store.chatTrayLast).filter((k: string) => k !== "messageCleanerUtil"), "messageCleanerUtil"]);
            settings.store.chatTrayLayoutApplied = true;
        }
        void loadUsage();
        startChatTray(settings as any);
        for (const [navId, patch] of Object.entries(dockContextMenus)) addOwnedMenuPatch(navId, patch, "sonata");
        captureMenuPatches("sonata", () => startUtilities(settings.store as any));
        qolRunning = true;
        migrateFromBuiltins();
        // "Start features after Discord loads": ones that don't change Discord's code wait until it's idle.
        const later: string[] = [];
        for (const key of ORDER) {
            if (!canRunNow(key)) continue;
            if (startLaterOn() && canStartLater(FEATURES[key])) later.push(key);
            else startFeature(key);
        }
        if (later.length) startLater(later, key => { if (qolRunning && !running.has(key) && canRunNow(key)) startFeature(key); });
        logger.info(`Started ${running.size} of ${ORDER.length} features`);
    },

    stop() {
        removeDockButton(PINNED_DOCK_ID);
        stopUtilities();
        for (const key of [...running]) stopFeature(key);
        uninstallSonataMenus();
        stopAlbumWatch();
        stopFeatureAccent();
        stopDockColor();
        stopUpdateNotice();
        stopPerformance();
        stopCacheAuto();
        stopMemoryWatch();
        cancelStartLater();
        stopChatTray();
        qolRunning = false;
    },
});

export default plugin;
