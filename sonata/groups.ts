/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Features merged into one: on the Features page each group is a single card
// with one switch, one options page (with a section, and a switch, for each
// part) and one window. Underneath, the parts still run as before, each with
// its own settings and saved data, so merging them changed nothing you'd set.
// Each group's parts live together in one folder: features/<folder>/<part>.

export interface Group {
    name: string;
    description: string;
    /** The features it's made of, in the order they show. */
    members: string[];
    /** Its parts share one window (features/_shared/Hub.tsx). */
    window?: boolean;
}

export const GROUPS: Record<string, Group> = {
    musicAudio: {
        name: "Music & Audio",
        description: "Radio stations, your SoundCloud likes and your own music, the Spotify player above your profile, a better player for audio files in chat, and your own Discord sounds.",
        members: ["radio", "spotifyControls", "waveformPlayer", "soundStudio"],
        window: true,
    },
    messageLogs: {
        name: "Message Logger",
        description: "Keeps deleted and edited messages, with each message's edit history, ghost pings and a log you can search.",
        members: ["messageLogger", "messageLoggerEnhanced"],
    },
    mediaTools: {
        name: "Media Tools",
        description: "Download videos and music from links, edit videos, make GIFs, convert files and style screenshots in one window — or straight from a picture or video you add to a message.",
        members: ["videoEditor", "gifMaker", "fileConverter", "screenshotStyler", "mediaDownloader"],
        window: true,
    },
    filePreviews: {
        name: "File Previews",
        description: "See inside files sent in chat before you open them: PDFs, documents, code, ZIPs, 3D models and fonts.",
        members: ["filePreviewer", "zipPreview", "modelPreview"],
    },
    textStyles: {
        name: "Text Styles",
        description: "Fancy fonts, coloured text, big ASCII lettering and special characters for your messages.",
        members: ["fancyText", "coloredText", "asciiArt", "charactersPicker"],
        window: true,
    },
    safety: {
        name: "Safety",
        description: "Warnings about scam links, fake gifts and risky files, a sound when a moderator is in your voice channel, and where QR codes in chat lead.",
        members: ["scamShield", "antimod", "qrCodes"],
        window: true,
    },
    profileTools: {
        name: "Profile Tools",
        description: "Badges only you can see, copy someone's profile look into your own, and a different avatar for each status.",
        members: ["customBadges", "stealProfile", "statusAvatar"],
        window: true,
    },
    images: {
        name: "Images",
        description: "Zoom into pictures, see avatars and icons full size, file names and image links, search the web for a picture, and copy the text out of one.",
        members: ["imageZoom", "viewIcons", "imageFilename", "imageLink", "reverseImageSearch", "imageToText"],
    },
    voiceMessaging: {
        name: "Voice Messages",
        description: "Send voice messages from your computer like on your phone, and download the ones you get.",
        members: ["voiceMessages", "voiceDownload"],
    },
    invites: {
        name: "Invites",
        description: "See when an invite runs out and who made it, preview a server before joining, and every invite you've made in one list.",
        members: ["betterInvites", "inviteManager"],
    },
    serverInsights: {
        name: "Server Insights",
        description: "One Server Insights window for any server (its details, every role with what it can do and who has it, and a member look-up), plus channels you can't open, how long a timeout lasts, and the owner's crown in big servers.",
        members: ["serverInfo", "permissionsViewer", "showHiddenChannels", "showTimeoutDuration", "forceOwnerCrown"],
    },
    sonataInsights: {
        name: "Sonata Insights",
        description: "Is it Discord or is it Sonata? Discord's own outages next to what's broken or slow in Sonata after a Discord update, and Discord back on its feet after a crash without restarting.",
        members: ["brokenPatchFinder", "crashHandler", "discordStatus"],
    },
    embeds: {
        name: "Embeds",
        description: "Make and send embeds through your webhooks, and copy any embed in chat to edit and send again.",
        members: ["embedSender", "embedCopier"],
    },
    appearance: {
        name: "Appearance",
        description: "Make Discord look your way in one window: your own theme (colours, background, motion, message bubbles), the font and text size, and how new messages come in.",
        members: ["themeStudio", "fontSwapper", "smoothChat"],
    },
};

export const GROUP_OF: Record<string, string> = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, d]) => d.members.map(m => [m, g])));
