/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What's new in Sonata, newest first. "What's new" shows everything newer
// than the last version you saw. Add an entry whenever something visible
// changes; `version` only needs to sort correctly (a date works).

export interface ChangeEntry {
    version: string;
    date: string;
    title: string;
    items: { icon: string; text: string; }[];
}

export const CHANGELOG: ChangeEntry[] = [
    {
        version: "2026.10.25c",
        date: "October 25, 2026",
        title: "Server Insights in one window, Twitch Drops, and more free games",
        items: [
            { icon: "📺", text: "Game Hub: Twitch Drops. Every game with drops on Twitch right now — the rewards, how long you need to watch, and when they end, soonest first — with a search and a Watch on Twitch button that opens the game's Twitch page. Press Tell me on a game to get a notification when it starts new drops (switch notifications off in Game Hub's options). The list comes from twitchdrops.app." },
            { icon: "🔎", text: "A server's right-click menu has one Server Insights item instead of Server Info, View Permissions and Look Up a Member. It opens one window with three tabs: Overview (the server's details), Roles & permissions (every role, what it can do, and now who has it — with a search), and Members (look anyone up). Clicking someone in a role looks them up in the same window." },
            { icon: "👑", text: "Force Owner Crown is part of Server Insights now." },
            { icon: "🏷️", text: "Local Names: a server's right-click menu has one \"Just for me…\" item instead of three. It opens one window with Name, Icon and Roles tabs, and the menu shows what you've changed (renamed · new icon · 2 roles). The Sonata submenu also lost a doubled divider line above Message Logger, and on a channel it now sits right under Mark As Read." },
            { icon: "🔊", text: "Sound Studio's list of sounds no longer squashes its rows together (names and \"Discord's sound\" were cut off) — each row keeps its size and the list scrolls." },
            { icon: "📐", text: "The Read All button above your servers is centred again and no longer cut off at the edge of the server list." },
            { icon: "🔨", text: "Exploit Reporter can use your game bot's slash commands (/ban username reason clip) instead of text commands. Run the bot's command once in Discord, then pick it for an action in Channels & prefix and choose what fills each option — the username box, the reason, the days, a fixed value, or the uploaded video for a file option like clip. Pressing Ban runs it through Discord's own command sender, the same as filling it in yourself, and still posts the log." },
            { icon: "🎵", text: "Radio shows covers: SoundCloud songs' artwork, the picture inside your own music files (MP3, FLAC and M4A), and station logos, in the lists and on what's playing. Songs now have a time bar — in the window and in the small player in the corner — so you can see how far along you are and drag to any part of the song (stations are live, so they don't)." },
            { icon: "📶", text: "Discord Status is part of Sonata Insights: its Overview starts with whether Discord itself is working, so you can tell straight away if a problem is Discord's or Sonata's." },
            { icon: "🗓️", text: "Calendar shows the weather (each day's forecast for the next week, from Weather) and new episodes of the shows you follow in Show Tracker on the day they come out. Both can be hidden from the list under the month." },
            { icon: "⬇️", text: "Media Downloader is part of Media Tools: download a video from a link, then press Edit to trim it, add captions or make a GIF without leaving the window." },
            { icon: "🎁", text: "Game Hub: a new \"Free on GOG & more\" tab next to Epic's free games, with GOG giveaways and free games on Steam, itch.io and other stores, and a notification when GOG gives a game away." },
            { icon: "🛵", text: "Package Tracker tracks Grubhub (and Seamless) and Instacart orders too, the same way as DoorDash, Uber Eats and Postmates." },
        ],
    },
    {
        version: "2026.10.25b",
        date: "October 25, 2026",
        title: "Appearance: themes, fonts and new messages in one window",
        items: [
            { icon: "🎨", text: "Theme Studio, Font Swapper and Smooth Chat are one feature now, Appearance, with one window: your themes (Colours, Background, Motion, Chat, Share), then Text for the font, text size, spacing and code font, and New messages for how messages come into the chat, with a little preview that plays it. Everything you'd set is kept, and their parts live in one folder." },
        ],
    },
    {
        version: "2026.10.25",
        date: "October 25, 2026",
        title: "Weather, Radio, and fewer, bigger features",
        items: [
            { icon: "🌤️", text: "New: Weather. Your city's forecast — now, the next 24 hours and the week — and a weather card under messages like \"weather in Tokyo\". °C or °F, no account needed." },
            { icon: "📺", text: "New: Show Tracker. Follow anime and TV shows, see when each next episode is out (Coming up), and get a pop-up when it is." },
            { icon: "📻", text: "New: Radio. Thousands of internet radio stations (search, or pick a genre like lofi or jazz), your public SoundCloud likes (with yt-dlp; some songs are copy-protected and only play on SoundCloud), and music files from your computer. A small player in the corner keeps the controls when the window is closed." },
            { icon: "📶", text: "New: Discord Status. A bar at the top of Discord when Discord itself is having problems, so you know it's not your internet — with what's affected, Discord's latest update, voice regions and planned maintenance." },
            { icon: "🧩", text: "Features that belong together are one feature now, each with one card, one switch and one window: Music & Audio (Radio, Spotify Controls, the audio file player, Sound Studio), Message Logger (both loggers), Media Tools (Video Editor, GIF Maker, File Converter, Screenshot Styler), File Previews (files, ZIPs and 3D models), Text Styles (Fancy Text, Colored Text, ASCII Art, Characters), Safety (Scam Shield, AntiMod, QR Codes) and Profile Tools (Custom Badges, Steal Profile, Status Avatar). Their options page has a section and a switch for each part, and everything you'd set is kept." },
            { icon: "🧩", text: "Six more merged features: Images (Image Zoom, View Icons, Image Filename, Image Link, Reverse Image Search, Image to Text), Voice Messages (sending and downloading them), Invites (Better Invites, Invite Manager), Server Insights (hidden channels, permissions, server info, timeout lengths), Sonata Insights (Broken Patch Finder, Crash Handler) and Embeds (Embed Sender, Embed Copier). Each merged feature's parts now also live in one folder inside Sonata, so there are fewer folders with all the same features." },
            { icon: "🌈", text: "Embed Sender's formatting bar has a coloured text button: make coloured text in Colored Text and it goes straight into the description (or the message). Colours show in embed descriptions, not titles." },
            { icon: "💬", text: "The chat bar's Sonata buttons follow the merges: one Text Styles button instead of ASCII Art, Characters, Colored Text and Fancy Text, and one Media Tools button instead of GIF Maker, File Converter and Screenshot Styler. Each opens its window where you were last." },
            { icon: "✒️", text: "The Pen icon (Text Styles) is a proper fountain-pen nib now, and options on the Sonata screen have readable names (\"Show a button for it in the chat bar\", not \"Colored Text_chat Bar Button\")." },
            { icon: "🖱️", text: "Right-clicking a message: the Sonata submenu now sits right above Reply and Forward, and Message Logger's items (open logs, watch someone, block or allow lists) are inside it instead of in a menu of their own." },
            { icon: "📝", text: "In merged features' windows, the list down the left no longer cuts names and descriptions off; they wrap onto a second line." },
            { icon: "🪄", text: "A picture or video you add to a message has an Edit in Media Tools button: style it, make it a GIF, edit the video or convert it, and the edited copy replaces the one in your message." },
            { icon: "🔤", text: "File Previews: fonts sent in chat show their name and a line written in them, without opening anything." },
            { icon: "🌈", text: "Colored Text uses everything Discord's coloured code blocks can show now: 16 colours instead of 8, any colour you like for text or background, italic, strikethrough and overline, plus a rainbow or a fade between two colours. The preview uses Discord's own colours, and long colourful messages switch to close shades so they fit." },
            { icon: "🎮", text: "Steam and Roblox are part of Game Hub now, not features of their own. Their options are in Game Hub's options, the chat bar has one Game Hub button instead of two, and your watched games, groups, people and settings are all kept." },
            { icon: "🛵", text: "Package Tracker tracks Postmates orders too, just like DoorDash and Uber Eats: the store, your food, how far along it is and when it arrives, never the address or anyone's name. Postmates links are blurred in chat and you're asked before sending one." },
            { icon: "🔧", text: "Fixed after Discord's update: Declutter hides nameplates on your account panel again, and Silent Typing hides typing in the member list again (on both kinds of avatar)." },
            { icon: "🏷️", text: "Local Names: give a server a different icon, and rename a server's roles, just for you. Right-click a server for both. They show their real versions while you're in that server's settings." },
            { icon: "🛍️", text: "Game Hub: Fortnite shop history. Each item in the shop shows when it was last there and how many times, and the new Shop history tab looks any item up. It's kept by Game Hub from today on, since nothing public lists older shops." },
            { icon: "⚡", text: "Sonata updates by itself: when a new version is out, it installs in the background and the bar just asks you to restart. Switch it off in What's new → \"Install it by itself\"." },
        ],
    },
    {
        version: "2026.10.20h",
        date: "October 20, 2026",
        title: "The installer works without winget",
        items: [
            { icon: "🛠️", text: "Install Sonata.bat no longer stops with \"This needs winget\". It only looks for winget when something is missing, sets it up if Windows hasn't yet, and otherwise downloads Git and Node.js from their official sites. It also finds them straight after installing, so you don't have to open it again." },
        ],
    },
    {
        version: "2026.10.20g",
        date: "October 20, 2026",
        title: "Clearer update problems",
        items: [
            { icon: "🔧", text: "If an update stops partway, the steps that did finish keep their ticks, and Copy details copies what went wrong so you can send it to whoever helps you." },
            { icon: "⬇️", text: "Install Sonata.bat now offers to install yt-dlp (for Media Downloader) whenever it's missing: when updating, repairing or switching to the GitHub version too, not only on the first install." },
        ],
    },
    {
        version: "2026.10.20f",
        date: "October 20, 2026",
        title: "Rounder gradient colours",
        items: [
            { icon: "🎨", text: "In your own gradient, the From and To colours are round now, like the gradients above them." },
        ],
    },
    {
        version: "2026.10.20e",
        date: "October 20, 2026",
        title: "Send the original video",
        items: [
            { icon: "🎬", text: "Video Editor has a Send original button at the top: it puts the video in your message just as it was, with no edits and no waiting for an export. With several clips, it sends each one." },
        ],
    },
    {
        version: "2026.10.20d",
        date: "October 20, 2026",
        title: "Game Hub and Local Names",
        items: [
            { icon: "🕹️", text: "New: Game Hub. One window for Epic's free games (this week and next) and Fortnite's item shop, Xbox Game Pass (recently added, coming soon, leaving soon), Minecraft servers (online, players, version) and players (skin and UUID), and a game's price at every store at once. Get told about new free games, Fortnite items you're waiting for, games hitting your price, Game Pass changes and Minecraft servers going down. No sign-in needed." },
            { icon: "🎮", text: "Steam Watcher and Roblox Tools now live in Game Hub too: pick Steam or Roblox in the list down the left. Switching never redraws the window, every button and menu that opened them opens Game Hub there, and turning either off in Sonata hides it from the list." },
            { icon: "🎵", text: "The audio file player has a fresh look: proper icons instead of symbols, the file type next to its size, a line showing where it's up to, a speaker button that mutes, and the play button always readable on your accent (gradients too). The pop-out player matches." },
            { icon: "🧩", text: "Adding a button to the dock: the list now shows only Sonata's features (each with its icon) and your own plugins, with a search, instead of every one of Equicord's built-in pieces. Picking a feature jumps the icon picker to that feature's icon." },
            { icon: "📦", text: "New: Package Tracker. Paste a tracking number (UPS, USPS, FedEx, DHL, Amazon, Royal Mail, Canada Post, OnTrac) or a DoorDash or Uber Eats tracking link, or press Track under a message that has one. Food shows the store, when you ordered, what you ordered and how far along it is (being made, on the way, delivered) with the arrival time; parcels show their status and arrival day, and can go on your Calendar, moving by themselves if they're delayed. It never reads the address or anyone's name, blurs delivery links in chat, and asks before you send one." },
            { icon: "🏷️", text: "New: Local Names. Rename servers, channels and group chats just for you: right-click one and pick \"Rename just for me\". The new name shows everywhere, but nobody else sees it, and the real name comes back while you're editing it in its settings so saving there never renames it for everyone." },
        ],
    },
    {
        version: "2026.10.20c",
        date: "October 20, 2026",
        title: "A shorter update bar",
        items: [
            { icon: "🔔", text: "The update bar just says \"Sonata update ready.\" now. Hover it to see the version number." },
        ],
    },
    {
        version: "2026.10.20b",
        date: "October 20, 2026",
        title: "Antiquest, Custom Badges and gradients everywhere",
        items: [
            { icon: "🚫", text: "New: Antiquest. Discord's Quests are gone: the promo card above your profile (quests, \"watch the video to win Orbs\" and sponsored ads), the Quests tab above your DMs and in Discovery, quest icons in member lists and the Active Now quest promos. Discord doesn't even load them. It only hides things; it never does quests for you." },
            { icon: "🏅", text: "New: Custom Badges. Put badges on your own profile that only you can see: any of Discord's badge pictures, your own picture (GIFs move) or an emoji, with your own hover text and an optional link. Put all your badges in any order and hide any of them, your real ones too, under Arrange all badges. It includes every Nitro badge: Bronze, Silver, Gold, Platinum, Diamond, Emerald, Ruby and Opal. Nothing changes for anyone else." },
            { icon: "🌈", text: "Buttons that use your accent follow your accent style too: with Gradient, Seasons & holidays or Album art, filled buttons, on-switches, picked tabs, chips and choices in every Sonata window fade between both colours, and so do accent icons (Spotify Controls' shuffle, repeat and lyrics, the dock in Accent, feature card icons) and accent links. Album art updates with every new song." },
            { icon: "🎙", text: "Fixed: Voice Messages (send and preview recordings) broke after a Discord update. It finds Discord's voice player again." },
            { icon: "🗑", text: "Install Sonata.bat can uninstall too: press U on its menu to remove just Sonata, or everything (Equicord is disconnected from Discord first, so Discord goes back to normal). It asks before deleting anything." },
            { icon: "🪟", text: "Fake DMs' window now matches every other Sonata window: \"sonata — fake dms\" along the top, its message types as tabs, and Send along the bottom. Everything inside works the same." },
            { icon: "💬", text: "Fake DMs no longer needs something newer Equicords removed (\"Toasts\"), so it builds on any Equicord version." },
        ],
    },
    {
        version: "2026.10.20",
        date: "October 20, 2026",
        title: "Dock layout, sizes and a new icon picker",
        items: [
            { icon: "↔️", text: "Sonata → Dock → Layout: Stack wraps the buttons onto more rows when they don't fit; One line squeezes them all into a single row." },
            { icon: "🔍", text: "Sonata → Dock → Size: Small, Normal or Large buttons and icons." },
            { icon: "🛠", text: "Fixed: installing or updating could fail with \"No matching export … Toasts\" when Equicord had changes of its own (often left by an earlier install). Those changes are now put aside so Equicord can switch to the version Sonata needs." },
            { icon: "🧩", text: "A new icon picker: search and categories (with counts) on the left, the icons on the right, and the one you picked shown along the bottom, so there's no long scrolling." },
        ],
    },
    {
        version: "2026.10.19i",
        date: "October 19, 2026",
        title: "One new look for every window",
        items: [
            { icon: "🪟", text: "Every Sonata window has a new, darker look: \"sonata — name\" along the top, tabs underlined in your accent colour, flat cards with squarer corners, and no glows." },
            { icon: "📍", text: "A status line along the bottom of each window says what's going on, like how many bots you're watching or when Steam was last checked." },
            { icon: "🤖", text: "Bot Manager, Theme Studio and Roblox Tools show your list on the left and the one you picked on the right, so there's less scrolling." },
            { icon: "⚙️", text: "Each feature's options now line up: the name and a line about it on the left, the switch or choice on the right." },
            { icon: "🧹", text: "Thin, clean scroll bars everywhere in Sonata, including the update log, instead of the white bar with arrows. Coloured glows are gone from every window." },
            { icon: "🎨", text: "Theme Studio has its own colour picker: a colour square, a colour strip, an eyedropper and the hex code (like #6e8bff) to type or copy, instead of R, G and B boxes." },
            { icon: "🎛", text: "Pick one colour for all your dock buttons in Sonata → Dock (Discord's, your accent, a swatch or any colour), or in a Theme Studio theme under Chat → Dock buttons. The Dock setting wins when both are set." },
            { icon: "🎵", text: "Spotify Controls' buttons (shuffle, repeat, lyrics and the rest) use your accent colour instead of Spotify green." },
            { icon: "📈", text: "Calculator has one graph now: the Graphs tab, which can also show an exact x range (type \"x from … to …\"). The small duplicate graph in Tools is gone." },
            { icon: "🎚️", text: "Appearance → Windows lets you pick how round the corners are, how dark windows are (Dark, Darker or Black), how clear the borders are, and whether to show the status line, with a live preview." },
        ],
    },
    {
        version: "2026.10.19h",
        date: "October 19, 2026",
        title: "Bot Manager",
        items: [
            { icon: "🤖", text: "New: Bot Manager. All your Discord bots in one place: who's online, how many servers each is in, which ones you share, with buttons to open each one in the Developer Portal, invite it or copy its ID. It never sees your bots' tokens." },
            { icon: "🔔", text: "Online check: tick Watch on a bot to get a notification when it goes offline, and when it's back." },
            { icon: "📘", text: "A step-by-step guide to making your first bot, from creating the app to keeping it running, with your progress saved." },
            { icon: "🔗", text: "Invite builder: tick permissions with a plain-English note on each (presets for chat, music, moderation and welcome bots), warnings for risky ones like Administrator, and a permissions-number converter." },
            { icon: "📦", text: "Starter project: pick JavaScript or Python and what the bot should do, and download a ready-to-run project. Paste your token into .env and double-click Start bot.bat." },
            { icon: "⌨️", text: "Commands: every slash command a bot has registered, everywhere or in a server you share, with each command's options, subcommands and choices, so you can check they all showed up." },
            { icon: "🧩", text: "Command builder: describe a slash command in boxes (options, required or not, allowed choices, what it replies, private replies, managers only) and get ready-to-paste JavaScript or Python, with a plain-English note when something isn't right yet." },
            { icon: "☁️", text: "Hosting guide: four ways to keep a bot online 24/7 (this PC, a spare computer, a small rented server, a hosting service), with the good, the bad and the steps for each." },
            { icon: "🧱", text: "More starter parts: moderation (/kick, /ban, /timeout, /clear), role buttons, a log channel for deleted and edited messages, a \"Playing…\" status, and a music player for songs in the bot's music folder. One click sets up the invite with the right permissions." },
            { icon: "🛠", text: "Fix problems: the issues people hit most, like offline bots, missing slash commands, Missing Permissions (50013), disallowed intents and \"This interaction failed\", each with the fix. You can search by the error you see." },
        ],
    },
    {
        version: "2026.10.19g",
        date: "October 19, 2026",
        title: "Updates right inside Discord",
        items: [
            { icon: "⚡", text: "The update bar's Update button now updates Sonata right inside Discord, with no installer window. It downloads the new version, keeps Equicord on the right version, adds anything new and rebuilds, ticking each step off, then offers Restart Discord. If it can't (for example, when Sonata was copied in by hand), it offers the installer instead." },
        ],
    },
    {
        version: "2026.10.19f",
        date: "October 19, 2026",
        title: "A calmer update bar",
        items: [
            { icon: "🔔", text: "The update bar now looks like Discord's own dark notices: dark blue, with just \"Sonata (version) is out.\" and an Update button. It also checks for a new Sonata every 15 minutes." },
        ],
    },
    {
        version: "2026.10.19e",
        date: "October 19, 2026",
        title: "Theme Studio: pictures, bubbles and sharing",
        items: [
            { icon: "🖼", text: "Make a theme from a picture. Pick a wallpaper or screenshot, and its colours become your background, text and two accents, with the picture behind Discord." },
            { icon: "🌈", text: "A second accent colour. Buttons, accent bars, ping badges and moving colours fade between your two colours." },
            { icon: "💬", text: "Message bubbles, with yours on the right in your accent colour, like on a phone. New messages can fade, slide or pop in, and so does a channel when you open it." },
            { icon: "✅", text: "A readability check. Theme Studio says when text, faded text or button text is hard to read on your colours, and Fix it adjusts them." },
            { icon: "🔗", text: "Share codes. Copy a short code and paste it in a chat; anyone with Sonata gets a Try it button under your message. Themes with a picture or video save as a .sonatatheme file instead." },
            { icon: "🎬", text: "GIFs and videos behind Discord. GIFs keep moving, and MP4/WebM videos play muted on a loop (paused while Discord is minimised), with the same blur and darken sliders." },
            { icon: "🔴", text: "Ping badges in your colours: Discord's red, your accent (or the gradient), or any colour you pick." },
        ],
    },
    {
        version: "2026.10.19d",
        date: "October 19, 2026",
        title: "Theme Studio, World clock and playlists",
        items: [
            { icon: "🎨", text: "New: Theme Studio. Make Discord your own: background, chat, text, faded text and accent colours, corner roundness and a font. Change how solid the backgrounds are, and put a picture (with blur) or slowly moving colours behind Discord. Add hover animations for the chat bar (inner glow, lift, or pulse while typing), channels, DMs, messages and server icons (slide, accent bar, tint, grow, bounce, wiggle) at the speed you like. Buttons can squish when pressed, and scroll bars and @mentions can take the accent colour. There are 9 starting looks, and a live preview." },
            { icon: "👁", text: "Theme Studio: see other apps through Discord. Switch it on, restart Discord, and a video, game or anything else behind Discord shows through while you chat. The See-through slider sets how much shows, and the text stays solid. Popouts, menus and the chat bar can go see-through too, and you can frost what's behind (Windows 11). It also works when a Nitro app theme is on." },
            { icon: "🕐", text: "Converter: a World clock tab. Pin cities, or a friend's name and where they live, and see every time at once, shaded for day and night. Slide the planner to find a time that works for everyone, then put it in your message as a Discord timestamp, which shows each person the time where they are." },
            { icon: "🌐", text: "Translate: hold Alt and point at a message to see its translation in a small bubble. The message itself doesn't change. Each message is translated once, so going back to it is instant. Switch it off in Translate's settings." },
            { icon: "📃", text: "Media Downloader: playlists. Paste a playlist, album, SoundCloud set or channel link, tick the ones you want (or search the list), and they download two at a time, each with its own progress. Waiting ones can be cancelled all at once." },
        ],
    },
    {
        version: "2026.10.19c",
        date: "October 19, 2026",
        title: "Update bar",
        items: [
            { icon: "🔔", text: "When there's a newer Sonata on GitHub, a blue bar shows at the top of Discord — like Discord's own notices — with an Update button that opens the installer (it shows what changed and asks first). It checks a minute after Discord starts and every 15 minutes. Switch it off, or check right away, in Updates." },
        ],
    },
    {
        version: "2026.10.19b",
        date: "October 19, 2026",
        title: "A tidier Roblox Tools",
        items: [
            { icon: "🧱", text: "Roblox Tools has four groups instead of nine tabs: Find (Look up, Names, People), Games (Servers, Compare, Assets), Trading (Trade, Robux) and Groups. Each tool shows a short line about what it does, and each group reopens on the tool you used last." },
        ],
    },
    {
        version: "2026.10.19",
        date: "October 19, 2026",
        title: "Media Downloader",
        items: [
            { icon: "⬇️", text: "New: Media Downloader. Save videos and music from YouTube, SoundCloud, TikTok, Instagram, X, Reddit, Twitch, Vimeo, Bandcamp and many more — video as MP4 in the quality you pick, or audio as MP3 with the title and cover art. Right-click a message with a link → Download video or audio, or use the chat bar button. Then open it, show it in its folder, or send it in chat. Uses yt-dlp, which you install yourself (winget install yt-dlp). Spotify can't be downloaded — its songs are copy-protected." },
        ],
    },
    {
        version: "2026.10.18h",
        date: "October 18, 2026",
        title: "Code colours in File Previewer, music staves in the background",
        items: [
            { icon: "⚡", text: "A tidier Performance tab that fits on one screen: pick Normal, Light or Gaming at the top, every saving is a small switch (hover for what it does), the background options are two menus, and Disk space & memory opens only when you want it." },
            { icon: "🎼", text: "Sonata's background comes alive: music staves wave and drift across it, little notes float up, a soft equalizer bounces along the bottom and the colour wash moves faster. Switch any of them off under Appearance → Background, or all of it with Motion. The page also uses more of a wide window." },
            { icon: "🎨", text: "File Previewer colours code files — JavaScript, TypeScript, Python, JSON, Lua, C#, HTML, CSS, YAML and about 40 more — using the same highlighter Discord uses for code blocks. Code opens unwrapped with line numbers, and a Colours switch turns them off." },
        ],
    },
    {
        version: "2026.10.18g",
        date: "October 18, 2026",
        title: "Whisper: private pairs, two secrets, quick whispers",
        items: [
            { icon: "🤝", text: "Pair with a friend for whispers only the two of you can open — no passwords. Whisper → Keys → Pair in their DM; they press Accept and send the reply. Both sides show the same safety code to compare." },
            { icon: "🎭", text: "Two secrets in one message: one for a password or a paired friend, another for everyone else with Sonata. Each person only sees the one meant for them." },
            { icon: "⌛", text: "Whispers can stop opening after an hour, a day or a week." },
            { icon: "⚡", text: "Quick whispers: type “cover ;; hidden” in the message box and the part after ;; is hidden when you send — locked for your paired friend in their DM, or how you pick under Keys." },
            { icon: "🔑", text: "A password book: name your passwords (Squad, Me & Sam), and every whisper shows which one opened it." },
            { icon: "🖼️", text: "Pictures, YouTube videos and links inside a whisper show a preview once it's open; and ↩ Reply answers with a whisper locked the same way." },
            { icon: "📜", text: "History: every whisper you've opened, with who, where and when, and a jump back to it. Kept only on this computer." },
        ],
    },
    {
        version: "2026.10.18f",
        date: "October 18, 2026",
        title: "Whisper, pinned features, timed stickies and gifts that wait",
        items: [
            { icon: "🤫", text: "New: Whisper. Send a normal-looking message with a hidden one inside — everyone sees the cover, friends with Sonata tap to read what's hidden. Add a password and only people who know it can open it. It goes in your message box; you send it." },
            { icon: "⭐", text: "Pin your favourite features: hover a card and press the star, and it joins a Pinned row at the top of the Features tab." },
            { icon: "✨", text: "Cards come alive: the one under your mouse tilts gently towards it with a soft shine, and its icon wiggles — and hops when you switch it on. Motion off holds them still." },
            { icon: "📌", text: "Sticky Message can stick for a while: right-click → Stick to bottom → for 1 hour, the rest of today or a week, with a countdown, and it unsticks itself." },
            { icon: "🎁", text: "Gift Wrap can wait: pick \"Not until…\" and a date, and the present stays wrapped with a countdown until then. Everyone sees when it opens, in their own time zone." },
        ],
    },
    {
        version: "2026.10.18e",
        date: "October 18, 2026",
        title: "Who owes me, a weekly call recap, and looping part of a song",
        items: [
            { icon: "🧾", text: "Wallet has tabs now — Wallet, Requests and the new Who owes me: add what someone owes you (search your friends and DMs, paste a user ID, pick from a list, or just type a name), tick it off as they pay, all at once or a bit at a time, see what's overdue, and send a friendly reminder that goes in your message box for you to send." },
            { icon: "📊", text: "Voice Timeline has a This week tab: how long you spent in calls each day, who you talked with most and where, next to the week before. Only your own calls, saved on this computer, kept for 10 weeks." },
            { icon: "🔁", text: "Waveform Player can loop just part of a file: press A–B at the start and again at the end, or Shift+drag across the waveform." },
            { icon: "📋", text: "Copied reports from Broken Patch Finder and Sonata Insights keep patterns as code, so pasting them into Discord doesn't turn * and _ into italics." },
        ],
    },
    {
        version: "2026.10.18d",
        date: "October 18, 2026",
        title: "Sonata's page redesigned, and Discord lag fixed",
        items: [
            { icon: "🎨", text: "A new look for Sonata's page: a rounded canvas with a floating pill of tabs, a big headline and roomier cards that show the whole description. Pick Dark or Light under Appearance." },
            { icon: "🎵", text: "A solid music note turns slowly at the top of the Features tab, and the big faint words behind each page's title now fade out smoothly instead of being cut off." },
            { icon: "🌊", text: "The colour wash behind Sonata's page now drifts slowly, and faint rings spread out from the turning note. Turn it all off with Motion under Appearance." },
            { icon: "🔎", text: "Search, categories, the status filter and All on / All off now sit in a bar that stays at the top while you scroll." },
            { icon: "⚡", text: "Fixed Discord feeling laggy: the scroll bar styling for Sonata's windows was making Discord re-check the whole page on every little change." },
            { icon: "🪟", text: "Sonata now opens under Discord's title bar, so the minimise, maximise and close buttons stay visible and clickable." },
        ],
    },
    {
        version: "2026.10.18c",
        date: "October 18, 2026",
        title: "A new, faster Sonata page",
        items: [
            { icon: "🗂️", text: "Sonata's page is now tabs — Features, Plugins, Dock, Keybinds, Appearance and Performance — instead of one long scroll. Features has a sidebar with search, categories, filters and turn all on/off next to a tighter grid of cards." },
            { icon: "⚡", text: "Much lighter to draw: no moving background, no glass blur and no mouse tracking, and cards out of sight aren't drawn at all." },
            { icon: "🎨", text: "The animated designs are gone for now — Minimal is the only one. Its glow, dot grid, grain and vignette can still be switched on and off under Appearance." },
        ],
    },
    {
        version: "2026.10.18b",
        date: "October 18, 2026",
        title: "Quick Text, Channel Notes, Steam game pages, four new Mini Games",
        items: [
            { icon: "⌨️", text: "New: Quick Text. Save text you type a lot and use it by typing ;word. Snippets can fill in {date}, {time}, {day}, {me}, {clipboard} or {random:a|b|c} by themselves, and ask you for blanks like {name} before it goes in your message box." },
            { icon: "📝", text: "New: Channel Notes. A private note on any channel, DM or server — from the 📝 chat bar button (with a dot when there's a note) or by right-clicking a channel or server. All your notes in one list, too." },
            { icon: "🎮", text: "Steam Watcher: click any game for its own page — trailers that play right there, screenshots, details, the review breakdown, system requirements, its DLC, and your achievements (with your Steam profile linked)." },
            { icon: "🏆", text: "Steam Watcher: see your achievement progress for each game — unlocked ones with the date, and what's left." },
            { icon: "💸", text: "Wallet: Request money. Make a card (\"Pay Sam $12.50 for pizza 🍕\") with your QR code and pay links (PayPal, Cash App and Venmo links come with the amount filled in), and tick people off as they pay you back. Remind the ones who haven't with one click." },
            { icon: "⛀", text: "Mini Games: Checkers, Ultimate Tic-tac-toe, Dots and Boxes, and Rock Paper Scissors (first to 3, picks stay hidden until both have picked). Moves are checked, so nobody can cheat." },
            { icon: "✏️", text: "File Converter: batch rename. Name files from a pattern like photo-{n} or {date} {name}, with numbering, find & replace and letter case — see every new name first, then save them as a ZIP or attach them." },
            { icon: "⭐", text: "Fancy Text: star your favourite styles, and mix your own — a letter style plus spacing, underline or strikethrough, and a wrap like ꧁ ꧂." },
        ],
    },
    {
        version: "2026.10.18",
        date: "October 18, 2026",
        title: "Steam friends, one colour everywhere, cleaner scroll bars",
        items: [
            { icon: "👥", text: "Steam Watcher has a Friends tab: who's playing what and who's online, the games popular with your friends right now, and ＋ Watch game on anyone's game. Needs your Steam profile linked, with a public friends list." },
            { icon: "🎮", text: "A Steam icon for the plugin dock (search \"steam\" when adding a plugin) — Steam Watcher's card and chat bar button use it too." },
            { icon: "🎨", text: "Every Sonata window's glows and colour fades follow your Sonata colour again. Windows where you pick colours yourself — like Birthday Reminders, Reminders and Person Tags — still use yours." },
            { icon: "🧹", text: "Every Sonata window and page now has thin, see-through scroll bars that light up in your colour — no more white Windows scroll bar with arrows." },
        ],
    },
    {
        version: "2026.10.16",
        date: "October 16, 2026",
        title: "New: Steam Watcher",
        items: [
            { icon: "🏷️", text: "Watch Steam games and get a pop-up when one goes on sale — with the % off, the old and new price, and when the sale ends." },
            { icon: "🎯", text: "Set your own price on any game: you're told the moment it drops to it or below." },
            { icon: "🛠️", text: "Updates and patch notes: a pop-up when the developer posts one, and you can read the patch notes right in Discord — with their pictures (click to see them bigger), short clips that play by themselves, and YouTube trailers." },
            { icon: "🚀", text: "Release day: a pop-up when a game you're waiting for comes out, or when its release date moves." },
            { icon: "🎁", text: "Free games: a pop-up when a game is free to keep, or free to play for a weekend." },
            { icon: "🎮", text: "A watchlist of game cards (cover, price, discount, reviews, latest update) and an Activity feed of everything that's happened, filtered by sales, updates, releases or free." },
            { icon: "👤", text: "My Steam: link your profile to see it here (level, status, games played lately) and add your whole wishlist in one click. Only public info — no login." },
        ],
    },
    {
        version: "2026.10.15j",
        date: "October 15, 2026",
        title: "Every window, refreshed",
        items: [
            { icon: "✨", text: "Over 40 windows have a new look: roomier, with colour fades, soft glows and a glowing top card that shows what matters at a glance — what's next, how many, what's on." },
            { icon: "🎨", text: "Each window has its own colour now — orange Reminders, green To-do, blue Calendar and so on. Prefer one colour everywhere? In Sonata's settings, set “Colours of Sonata's feature windows” to “Every window uses my Sonata colour”." },
            { icon: "🗂️", text: "Bigger windows where it helps: Calculator, Converter, Translate, Streaks, Fancy Text, Encoder (text and result side by side), Gift Wrap (the present beside its options), Mini Games and more." },
            { icon: "🧹", text: "The floating dust is gone from Birthdays, Message Purger, Scheduled Messages, Calculator, Relationship Log and Voice Timeline." },
            { icon: "🧨", text: "Message Purger is rebuilt from scratch in the new style: a top card, a plain sentence of exactly what will be deleted, switch tiles instead of checkboxes, date pickers with quick picks (last 24 hours, 7 days, 30 days, this year), and a progress view with a live feed. Purging every DM now asks you to click twice." },
            { icon: "🗑️", text: "Deleting things asks first: the red ✕ on reminders, scheduled messages and recent GIFs checks you're sure." },
        ],
    },
    {
        version: "2026.10.15i",
        date: "October 15, 2026",
        title: "A new look for Birthdays",
        items: [
            { icon: "🎂", text: "Birthday Reminders has a whole new window: a glowing card for today's birthdays (or a countdown to the next), a colour for every month, cards grouped into Today / This week / This month / Later, and a month strip to jump around." },
            { icon: "🎨", text: "Pick a colour for each person — their card, ring and glow use it (or their month's colour by default). Change it in Edit, or with 🎨 on their card." },
            { icon: "🖼️", text: "Profile pictures load again — it uses their picture now (not the one from when you saved them), and keeps names and pictures up to date." },
        ],
    },
    {
        version: "2026.10.15h",
        date: "October 15, 2026",
        title: "The Scam Shield window, Roblox username checker",
        items: [
            { icon: "🛡️", text: "Scam Shield has its own window: what it protected you from (links it stopped you opening and what you chose, warnings under messages), the links you checked yourself, and your trusted sites — with stats, filters, search and a jump to each message." },
            { icon: "🏷️", text: "Roblox Tools: a Names tab — see if a username is free, who has it if not, and free names like it. Check a whole list at once, too." },
        ],
    },
    {
        version: "2026.10.15g",
        date: "October 15, 2026",
        title: "Check a link, graphs, QR cards",
        items: [
            { icon: "🔍", text: "Scam Shield: Check a link — paste any link (or a whole message) and see what it really is, where short links lead, and why. Also on a message's right-click menu." },
            { icon: "📈", text: "Calculator has a Graphs tab: draw up to five functions, drag to move, scroll to zoom, hover to read values — with zeros and highest/lowest points marked." },
            { icon: "▦", text: "Wallet: QR pictures can show your name and the coin's logo — “Pay Sam” on a neat card (optional)." },
        ],
    },
    {
        version: "2026.10.15f",
        date: "October 15, 2026",
        title: "GIFs from the Video Editor, birthday countdowns, Roblox game embeds",
        items: [
            { icon: "🖼️", text: "Video Editor can export a GIF — pick its width and smoothness, and it can shrink itself to fit Discord's 10 MB." },
            { icon: "📥", text: "Video Editor: drag a video into Discord and it opens in the editor instead of uploading (switch it on in the settings; hold Shift to upload normally)." },
            { icon: "🎂", text: "Birthday Reminders shows a countdown on the profiles of people whose birthday you've saved — “Birthday in 12 days · turns 16”." },
            { icon: "🎮", text: "Embed Sender: a Roblox game builder — paste a game link and get its picture, players, visits, likes and a Play button." },
            { icon: "⭐", text: "Converter: star the conversions you use a lot, and your recent ones are one click away." },
            { icon: "▦", text: "Wallet: copy a QR code as a picture, or save it." },
        ],
    },
    {
        version: "2026.10.15e",
        date: "October 15, 2026",
        title: "A roomier Wallet, payment alerts",
        items: [
            { icon: "👛", text: "Wallet has a bigger, cleaner window: payment apps and crypto in their own sections, cards in a grid with a copy button right on each address." },
            { icon: "🪙", text: "The converter is now two boxes — pick a coin, then type in either the coin or the dollars and the other one fills in. Quick amounts are one click." },
            { icon: "🔔", text: "Payment alerts (off until you switch them on): every few minutes your crypto addresses are checked, and you get a notification when money arrives — how much, what it's worth, and your new balance." },
        ],
    },
    {
        version: "2026.10.15d",
        date: "October 15, 2026",
        title: "Coin prices, balances, limited price charts",
        items: [
            { icon: "🪙", text: "Converter: crypto amounts in messages (0.01 btc, 2 eth, 100 usdt…) now show what they're worth in your currency." },
            { icon: "👛", text: "Wallet: a what's-it-worth box (0.01 btc → dollars, $50 in eth → coins), today's price on each crypto card, and Check balance — see how much is at your address, from public blockchain explorers." },
            { icon: "📈", text: "Roblox Tools: limiteds now have a price history chart (RAP, cheapest listing, value) with the highest, lowest and how much it's changed." },
            { icon: "🕰️", text: "Roblox Tools: click anywhere on a player's value chart to see their whole inventory that day (from Rolimons' inventory history) — serial numbers, what they've since traded away (faded), and Previous / Next to step through the days. The chart also goes further back now." },
        ],
    },
    {
        version: "2026.10.15c",
        date: "October 15, 2026",
        title: "Wallet",
        items: [
            { icon: "👛", text: "New: Wallet — keep your PayPal, Cash App, Venmo, Zelle, Bitcoin, Ethereum, Solana, Litecoin, USDT, USDC and Roblox in one place. Everything stays hidden until you click Show, with Copy, QR codes, Edit and delete — and it's kept only on this computer." },
            { icon: "✅", text: "Crypto addresses are checked for typos as you add them (every kind has a checksum), and USDT/USDC ask which network they're on." },
            { icon: "💬", text: "Type ;paypal, ;cashapp, ;btc, ;roblox… in a message and it becomes yours when you send — or pick a few and put them in the chat box." },
            { icon: "🚨", text: "Swapped-address guard: warns you before sending an address that looks like yours but isn't, and when what you paste isn't what you copied from your wallet (what clipboard viruses do)." },
            { icon: "💵", text: "A guide to turning crypto into US dollars, with notes for each coin and links to Coinbase, Kraken, Gemini, Cash App and PayPal." },
        ],
    },
    {
        version: "2026.10.15b",
        date: "October 15, 2026",
        title: "Compare roles, who has a permission",
        items: [
            { icon: "⚖️", text: "Permissions Viewer: pick a role, then “Compare with” another — see what each can do that the other can't, side by side (Administrator counts as everything)." },
            { icon: "👥", text: "Permissions Viewer: hover any permission and click 👥 to see who in the server has it, grouped by the role that gives it — from the members Discord has already loaded." },
        ],
    },
    {
        version: "2026.10.15",
        date: "October 15, 2026",
        title: "Person tags, Read aloud, QR-code scams",
        items: [
            { icon: "🛡️", text: "Permissions Viewer: click a role on someone's profile (or right-click any role → Role Info & Permissions) to open that role — now with its ID to copy, its colour codes (gradients and holographic too) and its icon to download." },
            { icon: "🏷️", text: "New: Person Tags — coloured tags only you can see (School, Trading, Be careful…) next to names in chat, the member list and your DMs. Right-click anyone → Tags. You can also show only the DMs with one tag." },
            { icon: "🎨", text: "Tags can be any colour (24 to pick from, or your own) or a gradient — 12 ready-made ones, or make your own with up to 5 colours. 20 tag ideas to start from." },
            { icon: "🔊", text: "New: Read Aloud — right-click a message (or use the speaker on its hover bar) to hear it in the voice you pick, or “Read from here” to hear the chat go by. Only you hear it." },
            { icon: "🔳", text: "Scam Shield now checks pictures for Discord login QR codes — scanning one gives your account away — and QR codes that lead to scam sites." },
            { icon: "🐣", text: "Scam Shield warns when an account made this week sends you a link in DMs. It works out the age from their ID, so nothing is looked up." },
        ],
    },
    {
        version: "2026.10.14e",
        date: "October 14, 2026",
        title: "Scam Shield, learning Auto-Correct, watching people",
        items: [
            { icon: "🛡️", text: "New: Scam Shield — the Roblox scam guard for everything else. Warns about fake Discord and Nitro-gift links, Discord login QR-code links, fake Steam, Epic Games (free V-Bucks) and PayPal sites, IP loggers like Grabify, and programs (.exe, .scr, .bat…) sent as “try my game”. Asks before you open one." },
            { icon: "💬", text: "Scam Shield also warns about messages that sound like a scam with no link at all: fake Discord staff, “I accidentally reported you”, scan-this-QR-code, and anyone asking for your token or a wallet's seed phrase (in DMs by default)." },
            { icon: "✏️", text: "Auto-Correct learns from you: fix the same typo 3 times (by editing, or with a “*word” message) and it offers to fix it for you. Typos you keep fixing are listed in its settings, with Add and Not a typo." },
            { icon: "👁", text: "Message Logs can watch a person: right-click them → Message Logger → Watch User, or 👁 in the logs' People tab. You get a notification with what it said the moment they delete or edit a message, and their messages are always logged." },
        ],
    },
    {
        version: "2026.10.14d",
        date: "October 14, 2026",
        title: "Roblox scam guard",
        items: [
            { icon: "🚨", text: "Roblox Tools now spots fake Roblox links: lookalike websites (roblox.com.ge, rob1ox.com, roblox-gift.com), letters from other alphabets that look like ours, links whose text says roblox.com but go elsewhere, free-Robux sites, and messages asking for your .ROBLOSECURITY or to paste code. A red warning shows under the message, and clicking the link asks first — with why, and where it really goes." },
            { icon: "🔗", text: "Short links (bit.ly and others) in Roblox chats are checked for where they really go. Real Roblox links are never flagged, and you can trust a site if it's wrongly warned about." },
        ],
    },
    {
        version: "2026.10.14c",
        date: "October 14, 2026",
        title: "Command shortcuts, game alerts, translating pictures",
        items: [
            { icon: "⚡", text: "New: Command Shortcuts. Bot commands you use a lot (/daily, /work, /trade with your usual options) one click away from the ⚡ button in the chat bar. Run a command the normal way once, then save it — rename it or change what it fills in any time." },
            { icon: "🎮", text: "Roblox Tools: game alerts for the games you saved — when one updates, or passes a player milestone (100, 1K, 10K…) or a visits milestone (1M, 10M, 100M…). Mute a game with its 🔔 in the Saved sidebar." },
            { icon: "🌐", text: "Image to Text: a bigger window, and a Translate tab that turns the text into any of 130+ languages (and says what language it was)." },
        ],
    },
    {
        version: "2026.10.14b",
        date: "October 14, 2026",
        title: "Test sends, a navigation hub, your own typing sounds",
        items: [
            { icon: "🧪", text: "Embed Sender: 🧪 Test, by Send. “Only me” shows the message in the chat you have open — just for you, nothing is sent. Or pick a test channel once, and test posts go there for real (Sonata sets up its own test webhook, so there’s nothing to set up). Test posts can delete themselves after 2 minutes." },
            { icon: "🧭", text: "Embed Sender: a Navigation hub builder — a “start here” post that links to your channels and Discord pages like Channels & Roles, with buttons for the first five." },
            { icon: "✦", text: "Embed Sender: bullet styles on the formatting bar — turn picked lines into ✅ ➤ 🔹 ⭐ or 1️⃣ 2️⃣ 3️⃣ lists in one click." },
            { icon: "✩", text: "Embed Sender: the Characters picker (symbols, arrows, stars, shapes, fancy letters…) is next to Emoji in the message and description boxes, and a ✦ button by each embed's title opens it too." },
            { icon: "⌨️", text: "Typing Sounds: make your own pack from sound files — several for the keys, plus Space, Enter and Backspace. The quiet start of each sound is cut off so it plays the instant you press." },
            { icon: "🖼️", text: "Message Logs: save logged messages as a picture that looks like the chat — deleted and edited ones marked, earlier versions crossed out. From Export, or on a single message (which can also be saved as a text file)." },
        ],
    },
    {
        version: "2026.10.14",
        date: "October 14, 2026",
        title: "Stream Quality fixed for Discord's update",
        items: [
            { icon: "🔧", text: "Stream Quality: your custom stream preview picture works again after Discord's latest update renamed part of its code." },
        ],
    },
    {
        version: "2026.10.13f",
        date: "October 13, 2026",
        title: "Video Editor: colour, overlays and more",
        items: [
            { icon: "🎨", text: "Colour: brightness, contrast and saturation, plus looks — black & white, vintage, warm, cool, vivid." },
            { icon: "🖼", text: "Pictures: lay a logo, sticker, GIF or video over the video (like a webcam over gameplay) — move, resize, see-through, and a video's own sound if you want it." },
            { icon: "📐", text: "Shape: 16:9, 9:16, 1:1 or 4:5, with black bars or a blurred copy filling the space. Export presets for Discord, Nitro, TikTok / Reels / Shorts, YouTube, Twitter / X and Instagram." },
            { icon: "🏷️", text: "Watermark: your name or tag in a corner, the whole way through." },
            { icon: "📢", text: "Beep over muted parts instead of silence, and sound presets: bass boost, clearer voice, louder, radio, echo, muffled. You hear them — and volume over 100% — in the preview now." },
            { icon: "⏯", text: "Drag the playhead on the timeline to scrub, and the play button is centred." },
        ],
    },
    {
        version: "2026.10.13e",
        date: "October 13, 2026",
        title: "New: Video Editor",
        items: [
            { icon: "🎬", text: "Video Editor: drag across the timeline to pick a part, then cut it out, keep only it, mute it, or put a caption or a blur on it. Join several clips (with an optional fade between them), change the speed (the sound keeps its pitch), play it up to 10 times, fade from and to black." },
            { icon: "🔊", text: "Sound: volume up to 300%, even out loud and quiet parts, fade in and out, and add a song under it with its own volume and start point." },
            { icon: "⬇", text: "Export as MP4 in best quality, smaller, or to fit under 10 / 50 / 500 MB (or any size), at the original size or 1080p / 720p / 480p — then send it in chat or save it. Everything runs on your computer." },
            { icon: "🖱️", text: "Right-click any video in chat → Edit video. Undo and redo with Ctrl+Z / Ctrl+Y, space to play." },
        ],
    },
    {
        version: "2026.10.13d",
        date: "October 13, 2026",
        title: "Writing tools in Embed Sender",
        items: [
            { icon: "✍️", text: "A formatting bar above the message text and every embed description: bold, italic, underline, strikethrough, spoiler, code, links, headings, small text, quotes and lists. It formats what you've selected (press it again to undo), and Ctrl+B / Ctrl+I / Ctrl+U work too." },
            { icon: "@", text: "Next to Fill-ins: pick the server's roles (in their colours, plus @everyone and @here), channels (and Discord pages like Channels & Roles), and people to mention. Only people Discord already has loaded are listed — nothing scans the server." },
            { icon: "🕒", text: "Time: pick a date and get a Discord timestamp in any style — \"in 2 hours\", \"Friday 8:00 PM\" — that everyone sees in their own timezone." },
            { icon: "😀", text: "Emoji: your servers' custom emoji, for the text and on buttons (each button has an emoji slot; a normal emoji works too)." },
            { icon: "📍", text: "Everything you add now goes where your cursor is, instead of at the end." },
        ],
    },
    {
        version: "2026.10.13c",
        date: "October 13, 2026",
        title: "A roomier Embed Sender",
        items: [
            { icon: "🪟", text: "Embed Sender has a new look: it fills almost the whole screen, and the editor and preview each scroll on their own. Templates, Sent, Send later, Builders and Private buttons each have their own tab, so Compose is just your message." },
            { icon: "📝", text: "Text boxes grow with what you type, an embed's optional parts (author, fields, pictures, footer) fold away until you need them, and colours live behind a 🎨 button with popular presets." },
            { icon: "🖼️", text: "Embed Sender: set the picture by dropping one in, pasting it, uploading a file, or a link. Discord only takes links for a single message, so a picture file becomes the webhook's own picture (it asks first)." },
            { icon: "📎", text: "Embed Sender: every picture box (big image, thumbnail, author and footer icons) takes a dropped, pasted or uploaded picture too. The file goes up with the message, and the preview shows it straight away." },
            { icon: "➖", text: "Embed Sender: a Line divider — the thin separator line Discord draws in cards. It shows as --- in the text box and becomes a real line when sent (Container layout only; classic embeds can't show one)." },
            { icon: "👀", text: "The preview now shows markdown the way Discord does: # headings, -# small text, **bold**, __underline__, lists and links." },
            { icon: "🎵", text: "Spotify Controls: Up next is gone again. Spotify answers \"Forbidden\" when asked for your queue through Discord's Spotify login, so it could never work." },
            { icon: "🎙️", text: "Voice Changer and Stereo have been taken out of Sonata, along with their saved settings. Nothing in Sonata touches your microphone now (Voice Messages only uses it while you record one)." },
        ],
    },
    {
        version: "2026.10.13b",
        date: "October 13, 2026",
        title: "Private buttons, profiles, and a video trimmer",
        items: [
            { icon: "🔒", text: "Embed Sender: private reply buttons. Pressing one shows the presser a message only they can see — a code, a link, a \"thanks {user}\". It runs on your own free bot, and the editor walks you through setting it up step by step (about 10 minutes, once). A guide to share with friends is in sonata/guides." },
            { icon: "📜", text: "Embed Sender: a Sent list of everything you've posted from the editor — open it, edit it again, or delete it from the channel." },
            { icon: "🧰", text: "Embed Sender: a rules builder (numbered rules plus an \"I agree\" button), a banner maker, divider and spacing chips, and \"colour from image\" to match an embed's colour to its picture." },
            { icon: "🗂️", text: "Profiles: save which features are on as School, Gaming, Streaming… and switch in one click from the top of the Sonata window. The last switch can be undone." },
            { icon: "✂️", text: "File Converter: a visual trimmer for videos and sounds — a preview, a strip of frames, two handles, and \"Play the cut\" to hear just the part you keep." },
            { icon: "✏️", text: "New: Auto-Correct Lite fixes common typos as you send (teh → the, dont → don't, i → I), plus your own word list. Code, links, mentions and emoji are never touched. It starts switched off." },
        ],
    },
    {
        version: "2026.10.13",
        date: "October 13, 2026",
        title: "Auto Volume uses Discord's slider numbers",
        items: [
            { icon: "🔇", text: "Auto Volume no longer mutes people for talking normally after you've turned them down. It used to add your volume back to how loud they sounded, but Discord measures before your volume — so turning someone down made them look louder, and normal talking at 30% looked like clipping. Now it judges only what Discord measures, and never auto-mutes anyone you turned down yourself." },
            { icon: "🎚️", text: "Auto Volume's volumes now mean what Discord's volume slider shows: a starting volume of 80% puts people at 80% on the slider. Before, Discord's slider turned \"80\" into 92% (it shows volume on a curve) — so everyone looked set to 92%. People it had set that way get your real starting volume once." },
        ],
    },
    {
        version: "2026.10.12g",
        date: "October 12, 2026",
        title: "Smoother Spotify controls",
        items: [
            { icon: "🎵", text: "Spotify Controls: no more stutter when the controls show or hide. On hover they now take the place of the song info, so the player never changes size (any change to its height made Discord re-measure the whole channel list). Prefer them opening underneath? Choose that in Spotify Controls' options." },
        ],
    },
    {
        version: "2026.10.12f",
        date: "October 12, 2026",
        title: "QR codes by themselves, friendship details, speeding up Discord",
        items: [
            { icon: "🔳", text: "QR Codes: QR codes in chat images are now found by themselves — a chip under the message shows where each one leads (with a warning if the link looks risky); click it for the full check. Each image is checked once, only when it's on screen. Turn it off in QR Codes' options." },
            { icon: "💔", text: "Relationship Tracker: when someone removes you, the notification and the log now say how long you'd been friends (and since when) and when you last talked." },
            { icon: "⚡", text: "Sonata Insights → Performance → Speed up Discord: every feature you have on, heaviest first, with the heavy ones you haven't used in two weeks ticked for you — switch them off in one click, and back on just as easily. (Sonata starts noting which features you open from today; suggestions appear after a week.)" },
        ],
    },
    {
        version: "2026.10.12e",
        date: "October 12, 2026",
        title: "Auto Volume fixes",
        items: [
            { icon: "🔊", text: "Auto Volume no longer puts everyone back to the starting volume each time Discord restarts: the starting volume is only for someone it hasn't heard before (or every join, if you choose), and volumes you set yourself are remembered across restarts." },
            { icon: "🔇", text: "Auto-mute is now far stricter: by default it only mutes complete ear-rape — a mic pinned at the very top for 3 seconds that's still blaring after your volume. Loud mics, shouting, and anyone you've turned down are left alone. Muting blasted music is now a separate, optional choice." },
        ],
    },
    {
        version: "2026.10.12d",
        date: "October 12, 2026",
        title: "Newer Roblox items in full",
        items: [
            { icon: "🔑", text: "Roblox Tools → Assets: Roblox only gives newer items' files to accounts, so you can now add a Roblox API key (with step-by-step setup right there). It can only download items — nothing else on your account — stays on this computer, and is only sent to Roblox. Older items still download without it." },
        ],
    },
    {
        version: "2026.10.12c",
        date: "October 12, 2026",
        title: "Every update in one place",
        items: [
            { icon: "🕘", text: "Sonata's window has an Updates button at the top right: every update, newest first, grouped by month — search them all, open or close each one, with the ones you haven't seen marked New (and counted on the button)." },
        ],
    },
    {
        version: "2026.10.12b",
        date: "October 12, 2026",
        title: "Roblox: trade calculator, item compare, texture painter",
        items: [
            { icon: "🤝", text: "Roblox Tools → Trade: put limiteds and Robux on each side and see who comes out ahead, with Rolimons' values, RAP, demand and trend — plus warnings for projected items, low demand, or giving away something rare. Add items by name or short name, or straight from your own inventory (or anyone's)." },
            { icon: "⚖️", text: "Assets → Compare two items: two items side by side in 3D, with how alike their shapes and textures are, which was uploaded first, and a verdict — handy for spotting copied UGC. Resized or lightly edited copies still match." },
            { icon: "🖌", text: "Assets → 🎨 Edit → Paint: draw on a texture, erase parts of it, fill areas or pick colours from it, with the model's layout drawn over the top so you can see where everything lands. Undo with Ctrl+Z; the 3D preview and downloads use your edits." },
        ],
    },
    {
        version: "2026.10.12",
        date: "October 12, 2026",
        title: "My account in Roblox Tools",
        items: [
            { icon: "👤", text: "Roblox Tools → My account: set your own Roblox account (top of the sidebar, or \"This is me\" on your profile) and it's always one click away — with your online status, followers and how many you gained this week — and always watched, so you hear about any change to your name, bio, avatar or account." },
            { icon: "♫", text: "Chat bar tray: right-click the ♫ → Move a button, to put any button first or last instead of A–Z." },
        ],
    },
    {
        version: "2026.10.11i",
        date: "October 11, 2026",
        title: "A cleaner Roblox profile, whole-avatar download, recolouring",
        items: [
            { icon: "👤", text: "Roblox profiles are redone: who they are at the top (online status, when they were last seen, join date), the key numbers in one row, a tidy bio, and old usernames behind a button — each name once, with how many times they used it. The rest is in tabs: Outfit, Value, Groups and Games." },
            { icon: "👥", text: "Profiles → Groups: every group they're in, with their role and rank, which they own and which is their main group." },
            { icon: "⬇️", text: "Profiles → Outfit → Download whole avatar: every item they're wearing — 3D models, textures, clothing, animations — plus a picture of the avatar and a list of it all, in one zip. Emotes now open their catalog pages." },
            { icon: "🎨", text: "Assets: recolour any texture or template (hue, saturation, brightness, contrast, tint, invert) and see it on the 3D model straight away — downloads use the new colours. Sounds now play right there." },
            { icon: "📈", text: "Charts show long stretches with no data as a dashed line instead of a misleading slope." },
        ],
    },
    {
        version: "2026.10.11h",
        date: "October 11, 2026",
        title: "Roblox: assets, player value, Robux rates",
        items: [
            { icon: "📦", text: "Roblox Tools → Assets: paste a catalog or Creator Store link and get the item's files — its 3D model as an .obj (with its texture, ready for Blender), the original .mesh, textures, shirt and pants templates, decal images, sounds and animations — with a 3D preview, or everything in one .zip. Item cards and right-clicking a message with an item link take you there too." },
            { icon: "💎", text: "Profiles now show what Rolimons knows that Roblox doesn't: when they were last seen online, their limiteds' value and RAP, the highest each has ever been (and when), a chart of it over time, and their most valuable items." },
            { icon: "💱", text: "Robux → Rates: add your own rates like \"$5 for every 1,000 Robux\" and see what any amount comes to at each, next to Roblox's buy and DevEx rates — with the best one picked out, and the game pass price if Roblox's 30% has to be covered." },
        ],
    },
    {
        version: "2026.10.11g",
        date: "October 11, 2026",
        title: "Saved games, profiles and groups in Roblox Tools",
        items: [
            { icon: "⭐", text: "Roblox Tools has a Saved list down the left: press ☆ Save on any game, profile, group or item card (in the window or in chat) to keep it there. It shows live players for games, who's online, and group members; click one to open it, or Compare your saved games in one click. Search, sort by newest, A–Z or busiest, fold sections away, or hide the whole list." },
        ],
    },
    {
        version: "2026.10.11f",
        date: "October 11, 2026",
        title: "Roblox game history, from Rolimons",
        items: [
            { icon: "📈", text: "Looking up a Roblox game now shows its average playtime and peak players (all time, 30 days, 7 days, 24 hours), plus charts of players, playtime, visits a day, favourites and rating — from 24 hours back to when tracking began. The history comes from Rolimons; turn it off in Roblox Tools' settings." },
            { icon: "⚖️", text: "Compare adds average playtime and peak players for each game." },
        ],
    },
    {
        version: "2026.10.11e",
        date: "October 11, 2026",
        title: "Roblox: compare games, shops, group games, profile watch",
        items: [
            { icon: "⚖️", text: "Roblox Tools → Compare: up to four games side by side — players now, visits, favourites, likes, how many visitors favourite it, last update — with the best of each row picked out. Game cards have a Compare button." },
            { icon: "🎟️", text: "Game cards show every game pass and developer product with its price and what the creator keeps after Roblox's cut, plus a \"what if it sold…\" calculator (Roblox keeps real sales private)." },
            { icon: "🎮", text: "Group cards list every game the group owns, with live players and the totals across all of them. Profiles show the games they made." },
            { icon: "👤", text: "Roblox Tools → People: watch accounts and get told when they change their username, display name, bio or avatar, or get banned — with a timeline that keeps the old names. Profile cards have a Watch button." },
            { icon: "🛟", text: "Roblox Tools and the Converter's prices no longer crash Discord if it hasn't been fully restarted since an update — they ask you to restart instead." },
        ],
    },
    {
        version: "2026.10.11d",
        date: "October 11, 2026",
        title: "Roblox server finder and outfit prices",
        items: [
            { icon: "🖥️", text: "Roblox Tools → Servers: every public server of a game, fullest or emptiest first. Filter for room for your friends and for low ping, then join in one click — or copy a link that drops anyone into that same server. Game cards in chat get ▶ Play and Servers buttons, and right-clicking a message with a game link offers \"Find a Roblox server\"." },
            { icon: "👕", text: "Roblox profiles now show what they're wearing: every item with its price (cheapest resale for limiteds), bundles and animation packs counted once, and about what the whole outfit is worth in Robux and money. Click any item to open it, or copy the whole list." },
        ],
    },
    {
        version: "2026.10.11c",
        date: "October 11, 2026",
        title: "Roblox Tools",
        items: [
            { icon: "🧱", text: "New: Roblox Tools. Roblox links in chat get a live card — players online, visits, likes and favourites for games; followers, friends, online status and join date for profiles; members and the latest shout for groups; price and sales for items." },
            { icon: "🔎", text: "Look up any Roblox profile, game, group or item by link, ID or username. Profiles show every username they've had, and their full avatar." },
            { icon: "👥", text: "Watch Roblox groups: member growth since you added them, over the last day and week, with a graph — plus a heads-up for new shouts and member milestones." },
            { icon: "💸", text: "Robux ↔ money: what Robux cost to buy, what they're worth cashed out through DevEx, and what you keep after Roblox's 30% cut. Works in the Converter too — try \"50k robux\" or \"$100 to robux\"." },
            { icon: "🖼️", text: "File Converter → Presets: Roblox game icon (512²), thumbnail (1920×1080), decal, shirt/pants template (585×559) and T-shirt sizes, all as see-through PNGs." },
        ],
    },
    {
        version: "2026.10.11b",
        date: "October 11, 2026",
        title: "Profiles in Member Lookup, prices in Converter",
        items: [
            { icon: "🛡️", text: "Member Lookup now shows profile badges, pronouns, Nitro and boosting dates, and every linked account (Steam, Twitch, YouTube, GitHub, X, Reddit, Spotify, Roblox and more) with links to open or copy them." },
            { icon: "🪙", text: "Converter: live crypto and stock prices — try \"1 btc\", \"0.5 eth to eur\", \"$AAPL\", \"tesla stock\" or \"10 nvda shares\", with the 24-hour change and your currency." },
        ],
    },
    {
        version: "2026.10.11",
        date: "October 11, 2026",
        title: "Typing Sounds remade, and finding what breaks Discord",
        items: [
            { icon: "⌨️", text: "Typing Sounds is rebuilt to sound like real keyboards — creamy linear, tactile, clicky blues, box jade, deep thock, marbly, Topre, vintage Model M and Alps, laptop, Magic Keyboard, office, silent, a better typewriter — plus calm kalimba, marimba, chimes and raindrops. Each key has its own sound, with the up-stroke and spacebar rattle, placed left and right by where the key is. Click a pack to hear it." },
            { icon: "🔎", text: "Sonata Insights → Find the culprit: something broken but no idea why? It switches features off half at a time and asks after each reload, then leaves only the culprit off." },
            { icon: "🔊", text: "File Converter: Make it louder (evens out quiet audio and video) and Remove background (white, black, green or blue screens, with a live preview)." },
            { icon: "🗓️", text: "Calendar: import .ics files or calendar links (school, work, Google, Outlook, Apple) with repeats, and export your birthdays, reminders, scheduled messages and events to any calendar app." },
            { icon: "🔗", text: "Link Cleaner: hover a short link (bit.ly, t.co, tinyurl…) to see where it really goes — or right-click → Where does this link go?" },
        ],
    },
    {
        version: "2026.10.09e",
        date: "October 9, 2026",
        title: "TikTok Tracker",
        items: [
            { icon: "📈", text: "New: TikTok Tracker. Watch your creators' TikTok accounts and see how many followers, likes and videos they've gained since you added them, with graphs, a leaderboard and milestone pop-ups." },
            { icon: "❤", text: "See current likes on posts: their latest posts with likes, views, comments, shares, saves, how much each grew, and exactly when it was posted." },
            { icon: "🎮", text: "Link each creator's Roblox account: followers, friends, join date and whether they're online or in a game, side by side with their TikTok." },
            { icon: "🖱️", text: "Right-click a message with a TikTok link → Track this account." },
        ],
    },
    {
        version: "2026.10.09d",
        date: "October 9, 2026",
        title: "Battleship, Word Duel & Sonata Insights",
        items: [
            { icon: "🚢", text: "Mini Games: Battleship (hide your fleet, take turns firing) and Word Duel (you each pick a 5-letter word and race to guess the other's, Wordle-style). Still one message per player, edited as you play." },
            { icon: "★", text: "Message Logs: star a log to keep it forever, add your own notes (and search them), stop logging a person, channel or server right from a log, and a Storage & cleanup panel that deletes logs older than a time you pick." },
            { icon: "⏰", text: "Embed Sender: send later (once, every day or every week), fill-ins like {date}, {server} and {membercount}, saved webhooks with names, and embed colours picked from the server icon or your images." },
            { icon: "🗜️", text: "File Converter: drop, paste or pick a file that's too big to upload and it offers to shrink it to fit. You can also convert a whole folder and save everything as one ZIP." },
            { icon: "🎞️", text: "GIF Maker: right-click a message with videos → Make a GIF from any of them, or from where you paused it." },
            { icon: "🔎", text: "Sonata Doctor is now called Sonata Insights." },
        ],
    },
    {
        version: "2026.10.09c",
        date: "October 9, 2026",
        title: "Message Logs, templates & member lookup",
        items: [
            { icon: "🗂️", text: "Message Logger has a whole new window: every server, category, channel and DM down the side, with Overview (charts, busiest times, top people), Messages, Media (every logged picture, with a full-size viewer) and People views." },
            { icon: "🔎", text: "Message Logs: search with from:, in:, server:, has:, is:, before: and on:, filter by time, pictures, links, replies, mentions or \"gone in a minute\", see every edit with the changed words highlighted, select many to export (text, spreadsheet, JSON) or delete, and get told when new logs come in." },
            { icon: "📋", text: "Embed Sender: save messages as templates and load them in one click — rename, update, share as JSON, import Discohook JSON, undo a load, or start from Announcement, Rules, Giveaway or Welcome." },
            { icon: "🛡️", text: "Member Lookup: paste an ID, @mention or username to see someone's roles, account and server join dates, boosts, timeouts — and exactly what they can do (server-wide or in any channel) and which role or override decides it. It asks Discord about that one person only." },
        ],
    },
    {
        version: "2026.10.09b",
        date: "October 9, 2026",
        title: "One look for every window",
        items: [
            { icon: "🪟", text: "The older windows now use the same design as Calculator and the converters, and follow your accent colour: Auto React, Stream Quality, Server Info, Permissions, Voice Messages, Live RPC Editor, Message Logger, Edit history, Translate, Message Timer, ZIP Preview, Embed Sender, Message Cleaner, QR Codes, ASCII Art and Fancy Text." },
            { icon: "🔎", text: "Message Logger: search with from:, in:, has: and before:, with separate tabs for deleted messages, edits and ghost pings." },
            { icon: "🕓", text: "Edit history: each version is a labelled chip (Original, Edit 1, Now) with its time." },
            { icon: "🔘", text: "The \"Open …\" buttons on settings pages match the new style too." },
            { icon: "🐛", text: "Live RPC Editor: its keyboard shortcut works again." },
        ],
    },
    {
        version: "2026.10.09",
        date: "October 9, 2026",
        title: "Converters, reminders & lists",
        items: [
            { icon: "🗂️", text: "File Converter: pictures (incl. iPhone HEIC), GIFs, videos, music, PDFs and CSV / JSON / YAML / Markdown into other formats — plus Discord-ready stickers, emoji, avatars, banners, \"under 10 MB\" and voice messages. All on your computer." },
            { icon: "↔️", text: "Currency Converter is now the Converter: type any amount — 5 ft 3 in, 72°F, 3pm EST, 0xff — and see it in every unit, time zone or number system. Measurements in messages get converted too." },
            { icon: "🧮", text: "Calculator: 200 + 10%, saved values, fractions and hex, and new Money (fees, tips, tax, deals, loans, pay), Dates & time and Tools (stats, graphs, words) tabs." },
            { icon: "⏰", text: "Reminders: a banner drops down at the top of Discord when one's due, in the colour you picked — right-click any message to be reminded about it." },
            { icon: "✅", text: "To-do Lists for every chat, from the chat bar or right-click a message." },
            { icon: "🔤", text: "Font Swapper: a different font, size and line spacing for Discord, with Easy reading and Dyslexia-friendly presets." },
        ],
    },
    {
        version: "2026.10.08-d",
        date: "October 8, 2026",
        title: "Lighter on memory",
        items: [
            { icon: "🧠", text: "Fixed several things that made Discord's memory keep climbing: Message Logger's cache, Sticky Message and Fake DMs constantly searching the page, and Sonata Doctor's layout check." },
            { icon: "🌌", text: "Nocturne looks the same but uses far less graphics memory: its whole light show is now drawn on one canvas instead of over 400 moving layers." },
            { icon: "🪟", text: "While Sonata is open, Discord behind it isn't drawn any more (you can't see it anyway), which frees its graphics memory too." },
            { icon: "🎮", text: "Mini Games no longer send a message for every move: each player has one message per game that's edited as they play — rematches too." },
            { icon: "🔍", text: "Disk space & memory: a deep memory check that shows what's inside Discord's window, which windows are open (like DevTools), and a graph of memory over time." },
        ],
    },
    {
        version: "2026.10.08-c",
        date: "October 8, 2026",
        title: "Health checks & polish",
        items: [
            { icon: "🩺", text: "Sonata Doctor now checks Discord's layout after updates — if Discord renames something a feature relies on, it tells you instead of the feature quietly stopping." },
            { icon: "⏱", text: "Doctor's Performance tab shows which features are slowest to start, with one-click fixes." },
            { icon: "🖼️", text: "Screenshot Styler: text with fonts, sizes and looks (outline, shadow, label), emoji stickers, and a blur brush to paint over private info." },
            { icon: "🎧", text: "Waveform Player: pop a file out into a corner player that keeps playing while you move around Discord (and shows who sent it), or play every audio file in a channel one after another." },
            { icon: "👋", text: "A welcome tour for new Sonata users, and this What's new page." },
            { icon: "🧹", text: "Cache Cleaner moved into Performance as \"Disk space & memory\" — and now also removes old Discord versions, crash reports & logs and leftovers (file previews, old update downloads, and your clips if you pick them), shows memory use, keeps a history, and lists what Sonata's features have saved." },
        ],
    },
    {
        version: "2026.10.08-b",
        date: "October 8, 2026",
        title: "Faster Discord",
        items: [
            { icon: "⚡", text: "A Performance section at the bottom of Sonata: one click to speed everything up, and Put it back to undo it." },
            { icon: "🎮", text: "Gaming mode (Ctrl+Shift+G): Discord pauses its animations while your game is in front." },
            { icon: "🧊", text: "Pause animations in the background, hide huge member lists, reduced motion, still GIFs and emoji until hovered, and starting features after Discord loads." },
            { icon: "🔊", text: "Stereo: an \"Is it working?\" page that checks every step live, a fix for noise suppression switching itself back on, and everything put back when Stereo is turned off." },
            { icon: "📸", text: "Screenshot Styler: 31 photo filters (including Rio de Janeiro) with live previews, and a Draw tool with pen, highlighter and neon brushes." },
        ],
    },
    {
        version: "2026.10.08-a",
        date: "October 8, 2026",
        title: "New features",
        items: [
            { icon: "🎞️", text: "GIF Maker is now a full editor: trim, speed, boomerang, crop, captions (including the cut-out bubble), animated text, filters, stickers, and GIF / WebP / video output." },
            { icon: "🎵", text: "Audio Waveform Player — audio files in chat show their waveform; click to jump." },
            { icon: "🧹", text: "Link Cleaner removes tracking from links you send." },
            { icon: "🔤", text: "ASCII Art turns text into big letters for chat." },
            { icon: "✨", text: "Also: Smooth Chat, Currency Converter, Gift Wrap, Sticky Message, 3D Model Preview, Split View and Sonata Doctor." },
        ],
    },
];

export const LATEST = CHANGELOG[0].version;

/** Entries newer than the version you last saw (all of them if you've never looked). */
export const newerThan = (seen: string | undefined) => CHANGELOG.filter(e => !seen || e.version > seen);
