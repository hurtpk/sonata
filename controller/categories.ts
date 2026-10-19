/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Category {
    id: string;
    label: string;
    /** Tile monogram / rail chip color. */
    color: string;
}

export const CATEGORIES: Category[] = [
    { id: "chat", label: "Chat & Messages", color: "#60a5fa" },
    { id: "media", label: "Media & Files", color: "#f472b6" },
    { id: "voice", label: "Voice & Music", color: "#34d399" },
    { id: "servers", label: "Servers & Roles", color: "#a78bfa" },
    { id: "social", label: "DMs & Friends", color: "#fb923c" },
    { id: "system", label: "System & Interface", color: "#94a3b8" },
    { id: "other", label: "Other", color: "#cbd5e1" },
];

/** Feature key -> category id. Features added later without an entry land in "Other". */
const FEATURE_CATEGORY: Record<string, string> = {
    messageLogger: "chat",
    messageLoggerEnhanced: "chat",
    translate: "chat",
    silentTyping: "chat",
    onePingPerDM: "chat",
    readAllNotificationsButton: "chat",
    noUnblockToJump: "chat",
    splitLargeMessages: "chat",

    anonymiseFileNames: "media",
    imageFilename: "media",
    imageLink: "media",
    imageZoom: "media",
    reverseImageSearch: "media",
    viewIcons: "media",
    voiceDownload: "media",
    voiceMessages: "media",
    gifMaker: "media",
    zipPreview: "media",

    callTimer: "voice",
    disableCallIdle: "voice",
    spotifyCrack: "voice",
    spotifyControls: "voice",
    streamQuality: "voice",
    liveRpcEditor: "social",
    expressionStealer: "servers",

    forceOwnerCrown: "servers",
    permissionsViewer: "servers",
    roleColorEverywhere: "servers",
    serverInfo: "servers",
    showHiddenChannels: "servers",
    showTimeoutDuration: "servers",
    betterInvites: "servers",
    inviteManager: "servers",
    antimod: "servers",
    categoryChannelGreeter: "servers",
    exploiterReport: "servers",
    autoReact: "chat",
    embedSender: "chat",
    fakeDms: "social",
    messageTimer: "chat",
    fakedeafen: "voice",
    voiceTimeline: "voice",
    statusAvatar: "social",
    stealth: "social",

    pinDms: "social",
    relationshipTracker: "social",
    birthdayReminders: "social",
    messagePreview: "social",
    multiQuote: "chat",
    calculator: "system",
    calendar: "system",
    filePreviewer: "media",
    imageToText: "media",
    qrCodes: "media",
    screenshotStyler: "media",
    scheduledMessages: "chat",
    linkEmbedFixer: "chat",
    longMessageCollapser: "chat",
    fancyText: "chat",
    encoderTools: "chat",
    coloredText: "chat",
    charactersPicker: "chat",
    stealProfile: "social",
    gameActivityToggle: "social",
    platformSpoofer: "social",
    showRolesInChat: "chat",
    soundStudio: "media",
    miniGames: "social",
    streaks: "social",
    typingSounds: "chat",
    autoVolume: "voice",
    videoSpeed: "media",
    waveformPlayer: "media",
    linkCleaner: "chat",
    asciiArt: "chat",
    autoCorrect: "chat",
    commandShortcuts: "chat",
    sonataBadge: "social",
    shareSetup: "social",
    smoothChat: "chat",
    currencyConverter: "chat",
    reminders: "system",
    tiktokTracker: "social",
    robloxTools: "social",
    scamShield: "chat",
    personTags: "social",
    readAloud: "chat",
    wallet: "social",
    steamWatcher: "social",
    quickText: "chat",
    channelNotes: "chat",
    themeStudio: "system",
    todoLists: "chat",
    fontSwapper: "system",
    fileConverter: "media",
    videoEditor: "media",
    giftWrap: "social",
    whisper: "chat",
    mediaDownloader: "media",
    stickyMessage: "chat",
    modelPreview: "media",
    splitView: "system",
    chatEffects: "chat",
    embedCopier: "chat",
    onThisDay: "chat",
    mutualGroupDMs: "social",

    crashHandler: "system",
    brokenPatchFinder: "system",
    messageCleanerUtil: "chat",
    declutter: "system",
    platformIndicators: "system",
};

export function categoryOf(featureKey: string): Category {
    const id = FEATURE_CATEGORY[featureKey] ?? "other";
    return CATEGORIES.find(c => c.id === id)!;
}
