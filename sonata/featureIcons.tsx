/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// An icon for every Sonata feature, shown on its card in Sonata's Features
// page (and the Quality of Life page). Only shown there — never added to the
// feature itself. Turn them off in Appearance, or pick a different one per
// feature. Drawn from the dock's icon library, so they all share one style.
//
// Every new feature gets an entry here.

import { DOCK_ICON_MAP } from "../utilities/icons";

export const FEATURE_ICONS: Record<string, string> = {
    anonymiseFileNames: "ghost",
    antimod: "shield",
    asciiArt: "terminal",
    autoCorrect: "spellCheck",
    autoModRegex: "filter",
    commandShortcuts: "slash",
    autoReact: "addReaction",
    autoVolume: "autoVolume",
    betterInvites: "ticket",
    birthdayReminders: "cake",
    brokenPatchFinder: "bug",
    calculator: "calculator",
    calendar: "calendar",
    callTimer: "stopwatch",
    categoryChannelGreeter: "greeter",
    charactersPicker: "characters",
    chatEffects: "chatEffects",
    coloredText: "coloredText",
    crashHandler: "heartPulse",
    currencyConverter: "coin",
    declutter: "broom",
    disableCallIdle: "phone",
    embedCopier: "copy",
    embedSender: "embed",
    encoderTools: "encoder",
    exploiterReport: "exploitReport",
    expressionStealer: "sticker",
    fakeDms: "message",
    fakedeafen: "deafen",
    fancyText: "penNib",
    filePreviewer: "folderOpen",
    fileConverter: "fileConvert",
    videoEditor: "videoEdit",
    fontSwapper: "fontType",
    forceOwnerCrown: "crown",
    gameActivityToggle: "controller",
    gifMaker: "gif",
    giftWrap: "gift",
    whisper: "lock",
    mediaDownloader: "download",
    imageFilename: "paperclip",
    imageLink: "link",
    imageToText: "fileText",
    imageZoom: "imageZoom",
    inviteManager: "personAdd",
    linkCleaner: "filter",
    linkEmbedFixer: "wrench",
    liveRpcEditor: "radioTower",
    longMessageCollapser: "list",
    messageCleanerUtil: "trash",
    messageLogger: "messageLogger",
    messageLoggerEnhanced: "archive",
    messagePreview: "binoculars",
    messageTimer: "messageTimer",
    miniGames: "miniGames",
    modelPreview: "atom",
    multiQuote: "quote",
    mutualGroupDMs: "people",
    noUnblockToJump: "block",
    onePingPerDM: "bellOff",
    onThisDay: "history",
    permissionsViewer: "key",
    pinDms: "favoriteDm",
    platformIndicators: "mobile",
    platformSpoofer: "platformSpoofer",
    qrCodes: "qrCode",
    readAllNotificationsButton: "checkCircle",
    relationshipTracker: "friendTracker",
    reminders: "alarm",
    reverseImageSearch: "imageSearch",
    scamShield: "shieldAlert",
    personTags: "personTag",
    readAloud: "readAloud",
    wallet: "wallet",
    quickText: "keyboard",
    channelNotes: "notes",
    themeStudio: "brush",
    botManager: "robot",
    antiquest: "xCircle",
    customBadges: "medal",
    localNames: "tag",
    games: "controller",
    packageTracker: "package",
    // Merged features (sonata/groups.ts).
    musicAudio: "headphones",
    messageLogs: "messageLogger",
    mediaTools: "wand",
    filePreviews: "folderOpen",
    textStyles: "penNib",
    safety: "shieldAlert",
    profileTools: "profile",
    images: "image",
    voiceMessaging: "voiceMessage",
    invites: "link",
    serverInsights: "key",
    sonataInsights: "chart",
    embeds: "embed",
    appearance: "palette",
    people: "people",
    planner: "calendar",
    voiceCalls: "headphones",
    writingAssistant: "keyboard",
    serverTools: "shieldAlert",
    timezones: "clock",
    memberLogs: "notes",
    activeTimeouts: "clock",
    weather: "cloudSun",
    showTracker: "tv",
    radio: "radio",
    discordStatus: "signal",
    roleColorEverywhere: "palette",
    scheduledMessages: "scheduled",
    screenshotStyler: "screenshot",
    serverInfo: "info",
    shareSetup: "gearSync",
    showHiddenChannels: "lock",
    showRolesInChat: "tag",
    showTimeoutDuration: "clock",
    silentTyping: "silentTyping",
    smoothChat: "wind",
    sonataBadge: "award",
    soundStudio: "soundStudio",
    splitLargeMessages: "scissors",
    splitView: "grid",
    spotifyControls: "music",
    spotifyCrack: "spotify",
    statusAvatar: "statusOnline",
    stealProfile: "stealProfile",
    stealth: "eyeOff",
    stickyMessage: "pushpin",
    streaks: "streaks",
    streamQuality: "live",
    tiktokTracker: "trendingUp",
    todoLists: "checklist",
    translate: "translate",
    typingSounds: "typingSounds",
    videoSpeed: "videoSpeed",
    viewIcons: "eye",
    voiceDownload: "download",
    voiceMessages: "voiceMessage",
    voiceTimeline: "headphones",
    waveformPlayer: "waveform",
    zipPreview: "fileZip",
};

const parse = (json: unknown): Record<string, string> => {
    try { const o = JSON.parse(String(json || "{}")); return o && typeof o === "object" ? o : {}; } catch { return {}; }
};

/** The icon a feature shows: the one you picked, else its own, else a puzzle piece. */
export function featureIconKey(store: any, key: string) {
    const picked = parse(store?.sonataFeatureIconMap)[key];
    if (picked && DOCK_ICON_MAP[picked]) return picked;
    return DOCK_ICON_MAP[FEATURE_ICONS[key]] ? FEATURE_ICONS[key] : "puzzle";
}

export const hasPickedIcon = (store: any, key: string) => !!parse(store?.sonataFeatureIconMap)[key];

export function setFeatureIcon(store: any, key: string, icon: string | null) {
    const map = parse(store.sonataFeatureIconMap);
    if (!icon || icon === FEATURE_ICONS[key]) delete map[key]; else map[key] = icon;
    store.sonataFeatureIconMap = JSON.stringify(map);
}

export const featureIconsOn = (store: any) => store?.sonataFeatureIcons !== false;

export function FeatureIcon({ store, featureKey, size = 20 }: { store: any; featureKey: string; size?: number; }) {
    const { Icon } = DOCK_ICON_MAP[featureIconKey(store, featureKey)];
    return <Icon width={size} height={size} />;
}
