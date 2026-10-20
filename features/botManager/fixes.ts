/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "Why isn't my bot working?" — the problems people hit most, what usually
// causes each, and what to do, in order.

export interface Fix {
    id: string;
    icon: string;
    problem: string;
    /** Error text people see, so a search finds the right one. */
    errors?: string[];
    why: string;
    steps: string[];
    /** Which page of the Developer Portal helps. */
    portal?: "bot" | "oauth2" | "general";
}

export const FIXES: Fix[] = [
    {
        id: "offline", icon: "⚫", problem: "My bot shows as offline",
        why: "A bot is only online while its code is running somewhere, and logged in with the right token.",
        steps: [
            "Make sure the bot's program is running (its window or log should say it logged in).",
            "If it says the token is invalid: in the Developer Portal → Bot, press Reset Token, and paste the new one into your .env file.",
            "If you closed the window or turned your PC off, the bot goes offline too — it needs to run somewhere that stays on.",
            "Still nothing? Find the first red error in its log and type it into the search box above.",
        ],
        portal: "bot",
    },
    {
        id: "token", icon: "🔑", problem: "\"An invalid token was provided\" / my token stopped working",
        errors: ["TokenInvalid", "Improper token", "401", "invalid token"],
        why: "The token was mistyped, or Discord reset it — which happens automatically if it was ever posted publicly (like on GitHub).",
        steps: [
            "In the Developer Portal → Bot, press Reset Token and copy the new one straight away (it's only shown once).",
            "Paste it into the .env file as TOKEN=… with no spaces or quotes around it.",
            "Never put the token in your code or upload the .env file — keep .env in .gitignore (the starter project already does).",
        ],
        portal: "bot",
    },
    {
        id: "intents", icon: "🚪", problem: "\"Used disallowed intents\"",
        errors: ["Disallowed intents", "4014", "PrivilegedIntentsRequired"],
        why: "Your code asks for a privileged intent (Message Content, Server Members or Presence) that isn't switched on for the bot.",
        steps: [
            "Developer Portal → Bot → Privileged Gateway Intents.",
            "Turn on the ones your code uses: Message Content (reading messages), Server Members (welcomes, member lists), Presence (who's online).",
            "Press Save Changes, then restart the bot.",
        ],
        portal: "bot",
    },
    {
        id: "content", icon: "🙈", problem: "It can't read messages (message content is empty)",
        errors: ["message.content is empty", "content is empty"],
        why: "Without the Message Content intent, bots only see the text of messages that mention them.",
        steps: [
            "Developer Portal → Bot → turn on Message Content Intent, and Save.",
            "In your code, ask for it too: GatewayIntentBits.MessageContent (JavaScript) or intents.message_content = True (Python).",
            "Restart the bot. (Or switch to slash commands — they don't need this intent.)",
        ],
        portal: "bot",
    },
    {
        id: "slash", icon: "⌨️", problem: "My slash commands don't show up",
        why: "Commands have to be registered, and the bot has to be invited with the commands scope.",
        steps: [
            "Re-invite the bot with \"bot\" and \"applications.commands\" ticked (the Invite builder does both) — you don't need to kick it first.",
            "Make sure your code registers the commands when it starts (the starter project does) and that it ran without errors.",
            "Press Ctrl+R in Discord to refresh the list of commands.",
            "Changed a command's name or options? It can take a minute to update everywhere.",
        ],
        portal: "oauth2",
    },
    {
        id: "failed", icon: "⏱", problem: "\"This interaction failed\" / \"The application did not respond\"",
        errors: ["This interaction failed", "did not respond", "Unknown interaction", "10062"],
        why: "A command has to be answered within 3 seconds, or Discord gives up on it.",
        steps: [
            "Reply straight away. For slow work, first call deferReply() (JavaScript) or interaction.response.defer() (Python), then send the answer when it's ready.",
            "Check the bot's log for an error inside the command — a crash there means it never replies.",
            "Make sure only one copy of the bot is running (two copies can fight over the same command).",
        ],
    },
    {
        id: "perms", icon: "⛔", problem: "\"Missing Permissions\" (50013)",
        errors: ["Missing Permissions", "50013"],
        why: "The bot's role doesn't allow what it's trying to do — or the person it's acting on has a higher role.",
        steps: [
            "Server Settings → Roles: give the bot's role the permission it needs (or re-invite with it).",
            "Drag the bot's role above the roles it needs to manage — bots can't change anyone with a higher role.",
            "Check the channel's own permissions too: Edit Channel → Permissions can block the bot in just that channel.",
        ],
    },
    {
        id: "access", icon: "🔒", problem: "\"Missing Access\" (50001)",
        errors: ["Missing Access", "50001"],
        why: "The bot can't see that channel (or isn't in that server).",
        steps: [
            "Make sure the bot is in the server.",
            "Give its role View Channel (and Read Message History) on that channel: Edit Channel → Permissions.",
            "For threads, it also needs to be able to see the channel the thread is in.",
        ],
    },
    {
        id: "members", icon: "👋", problem: "Welcome messages / member events don't work",
        why: "Join and leave events need the Server Members intent.",
        steps: [
            "Developer Portal → Bot → turn on Server Members Intent, and Save.",
            "Ask for it in your code: GatewayIntentBits.GuildMembers (JavaScript) or intents.members = True (Python).",
            "Make sure the server has a channel the bot can post in (the starter project uses the server's system channel).",
        ],
        portal: "bot",
    },
    {
        id: "voice", icon: "🔊", problem: "It can't join voice or play music",
        why: "Voice needs extra parts installed, and the right permissions.",
        steps: [
            "Give it Connect and Speak (the Music bot preset in the Invite builder has them).",
            "JavaScript: install @discordjs/voice and an encoder (npm install @discordjs/voice @discordjs/opus) plus FFmpeg. Python: pip install \"discord.py[voice]\" and FFmpeg.",
            "Check the voice channel isn't full or limited to certain roles.",
        ],
    },
    {
        id: "ratelimit", icon: "🐢", problem: "\"You are being rate limited\" (429)",
        errors: ["rate limited", "429"],
        why: "The bot is sending too much, too fast — Discord slows it down.",
        steps: [
            "Don't send messages or edits in a tight loop — wait between them.",
            "Edit one message instead of sending many, and batch work where you can.",
            "If it happens on startup, you may be re-registering commands every time in a loop — do it once.",
        ],
    },
    {
        id: "cantadd", icon: "➕", problem: "I can't add my bot to a server",
        why: "You need Manage Server in that server, and a private bot can only be added by its owner.",
        steps: [
            "Make sure you have Manage Server (or are the owner) in the server you're picking.",
            "If someone else is adding it: Developer Portal → Bot → turn on Public Bot, so others can invite it.",
            "Bots in 100 or more servers have to be verified by Discord before they can join more.",
        ],
        portal: "bot",
    },
];
