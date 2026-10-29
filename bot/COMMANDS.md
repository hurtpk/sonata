# Sonata Bot commands

278 command forms under 98 top-level slash commands. Use slash commands or your server/personal prefix (default: comma). <Required> [Optional].

| Command | Description | Base permission |
| --- | --- | --- |
| `prefix view` | Show server and personal prefixes. | Runtime checks |
| `prefix set <prefix>` | Set this server's prefix. | Runtime checks |
| `prefix remove` | Reset this server's prefix to a comma. | Runtime checks |
| `prefix self <prefix>` | Set your own prefix across Sonata servers. | Runtime checks |
| `prefix selfclear` | Remove your personal prefix. | Runtime checks |
| `honeypot add <channel> <action>` | Enable a trap in an existing channel. | ADMIN |
| `honeypot remove <channel>` | Disable a honeypot channel. | ADMIN |
| `honeypot list` | List honeypot channels and actions. | ADMIN |
| `honeypot exempt <role> <enabled>` | Exempt or unexempt a role. | ADMIN |
| `honeypot exemptions` | List honeypot exemptions. | ADMIN |
| `download message <message> [index]` | Download an attachment, or reply with download to detect media. | Runtime checks |
| `download url <url>` | Download a direct Discord CDN file link. | Runtime checks |
| `download attachment <file>` | Download a file attached to this command. | Runtime checks |
| `download emoji <emoji>` | Download a Unicode or custom emoji image. | Runtime checks |
| `download sticker <id>` | Download a sticker file. | Runtime checks |
| `emoji steal <emoji> [name]` | Copy an emoji, or reply with emoji steal. | Runtime checks |
| `emoji add <file> <name>` | Create an emoji from an uploaded image. | Runtime checks |
| `emoji rename <id> <name>` | Rename a server emoji. | Runtime checks |
| `emoji remove <id>` | Delete a server emoji. | Runtime checks |
| `emoji info <emoji>` | Show a custom emoji's image and ID. | Runtime checks |
| `emoji list [page]` | Browse server emojis. | Runtime checks |
| `sticker steal <id> [name]` | Copy a PNG, APNG or GIF sticker, or reply with sticker steal. | Runtime checks |
| `sticker add <file> <name>` | Create a sticker from an uploaded image. | Runtime checks |
| `sticker rename <id> <name>` | Rename a server sticker. | Runtime checks |
| `sticker remove <id>` | Delete a server sticker. | Runtime checks |
| `sticker info <id>` | Show sticker details and download link. | Runtime checks |
| `sticker list [page]` | Browse server stickers. | Runtime checks |
| `voicemaster setup <channel> <category>` | Choose a join-to-create lobby and category. | Runtime checks |
| `voicemaster disable` | Stop creating rooms, keeping existing rooms. | Runtime checks |
| `voicemaster config` | Show the voice room configuration. | Runtime checks |
| `voicemaster room` | Open your current voice room control panel. | Runtime checks |
| `voicemaster name <name>` | Rename your voice room. | Runtime checks |
| `voicemaster limit <limit>` | Set your room's member limit. | Runtime checks |
| `voicemaster bitrate <kbps>` | Set your room's bitrate in kbps. | Runtime checks |
| `voicemaster lock` | Lock your voice room. | Runtime checks |
| `voicemaster unlock` | Unlock your voice room. | Runtime checks |
| `voicemaster hide` | Hide your voice room. | Runtime checks |
| `voicemaster unhide` | Unhide your voice room. | Runtime checks |
| `voicemaster claim` | Claim your voice room. | Runtime checks |
| `voicemaster transfer <member>` | Transfer room ownership to a member in it. | Runtime checks |
| `voicemaster permit <member>` | Allow a member to view and connect. | Runtime checks |
| `voicemaster reject <member> [reason]` | Block a member and disconnect them from your room. | Runtime checks |
| `voicemaster reset` | Restore the room's original privacy permissions. | Runtime checks |
| `play <query>` | Play or queue a track in your voice channel. | Runtime checks |
| `pause` | Pause music in your voice channel. | Runtime checks |
| `resume` | Resume paused music. | Runtime checks |
| `skip` | Skip the current track. | Runtime checks |
| `stop` | Clear the queue and disconnect Sonata. | Runtime checks |
| `queue` | Show this server's music queue. | Runtime checks |
| `nowplaying` | Show the current track and playback position. | Runtime checks |
| `volume <percent>` | Set music volume from zero to one hundred. | Runtime checks |
| `shuffle` | Shuffle upcoming tracks. | Runtime checks |
| `remove <position>` | Remove an upcoming track from the queue. | Runtime checks |
| `loop <mode>` | Set track or queue looping. | Runtime checks |
| `seek <seconds>` | Seek to a position in the current track. | Runtime checks |
| `filter <preset>` | Set an audio effect while keeping the current position. | Runtime checks |
| `voteskip` | Vote to skip the current track. | Runtime checks |
| `musicsettings view` | Show music control settings. | GUILD |
| `musicsettings djrole <role>` | Choose the DJ role. | GUILD |
| `musicsettings cleardj` | Remove the DJ role. | GUILD |
| `musicsettings mode <mode>` | Choose who can control playback. | GUILD |
| `musicsettings votes <percent>` | Set the percentage of listeners needed to skip. | GUILD |
| `antiraid setup <channel> <joins> <seconds> <age> <action>` | Configure and enable join protection. | ADMIN |
| `antiraid off` | Disable join protection. | ADMIN |
| `antiraid view` | Show join protection settings. | ADMIN |
| `antiraid clear` | End the current raid protection window. | ADMIN |
| `antinuke setup <channel> <limit> <seconds> <action>` | Configure audit-event protection. | Runtime checks |
| `antinuke off` | Disable destructive-action protection. | Runtime checks |
| `antinuke view` | Show protection settings. | Runtime checks |
| `antinuke trust <member> <enabled>` | Trust or untrust an account. | Runtime checks |
| `antinuke restore <member>` | Restore unchanged roles saved by protection. | Runtime checks |
| `eventlog set <type> <channel>` | Enable one kind of event log. | GUILD |
| `eventlog off <type>` | Disable one kind of event log. | GUILD |
| `eventlog view` | Show configured event logs. | GUILD |
| `escalation set <warnings> <action> [duration]` | Set an action at an active warning count. | ADMIN |
| `escalation remove <warnings>` | Remove a warning threshold. | ADMIN |
| `escalation expiry <days>` | Expire active warnings after this many days. | ADMIN |
| `escalation exempt <role> <enabled>` | Exempt or unexempt a role. | ADMIN |
| `escalation view` | Show warning rules and exemptions. | ADMIN |
| `appeals setup <channel>` | Enable ban DM appeal forms. | BAN |
| `appeals off` | Disable new appeals. | BAN |
| `appeals view` | Show appeal configuration. | BAN |
| `appeals list` | Browse recent ban appeals. | BAN |
| `appeals case <case>` | View a case and its appeal. | BAN |
| `ticket setup <category> <role> <channel>` | Choose ticket category, staff role and transcript channel. | Runtime checks |
| `ticket panel <channel>` | Post an open-ticket button. | Runtime checks |
| `ticket open <topic>` | Open your private support ticket. | Runtime checks |
| `ticket claim` | Claim this ticket as staff. | Runtime checks |
| `ticket close` | Save a transcript and close this ticket. | Runtime checks |
| `ticket reopen` | Reopen this closed ticket. | Runtime checks |
| `ticket transcript` | Export the latest messages from this ticket. | Runtime checks |
| `ticket view` | Show ticket configuration. | Runtime checks |
| `ticket off` | Disable new tickets. | Runtime checks |
| `ticket archive` | Archive a closed ticket record, keeping its channel. | Runtime checks |
| `ticket categoryadd <name> <category> <role>` | Add a ticket type with its own category and staff role. | Runtime checks |
| `ticket categoryremove <name>` | Remove a ticket type. | Runtime checks |
| `ticket openin <category> <topic>` | Open a ticket in a specific support queue. | Runtime checks |
| `ticket priority <priority>` | Set this ticket's priority. | Runtime checks |
| `ticket assign <member>` | Assign this ticket to support staff. | Runtime checks |
| `ticket idle <hours> [channel]` | Configure staff reminders for inactive tickets. | Runtime checks |
| `giveaway start <duration> <winners> <prize> [role] [age]` | Create a timed giveaway in this channel. | Runtime checks |
| `giveaway end <message>` | Draw winners now. | Runtime checks |
| `giveaway reroll <message>` | Draw replacements excluding previous winners. | Runtime checks |
| `giveaway cancel <message>` | Cancel without drawing winners. | Runtime checks |
| `giveaway list` | Browse recent giveaways. | Runtime checks |
| `dashboard` | Open Sonata's server management dashboard. | Runtime checks |
| `fakepermissions grant <role> <permission>` | Grant bot-only role access. | ADMIN |
| `fakepermissions revoke <role> <permission>` | Revoke bot-only role access. | ADMIN |
| `fakepermissions view [role]` | List bot-only role permissions. | ADMIN |
| `commandsettings disable <command>` | Disable a command or subcommand. | GUILD |
| `commandsettings enable <command>` | Enable a command or subcommand. | GUILD |
| `commandsettings view` | List disabled commands. | GUILD |
| `commandstats summary [days]` | Show command result totals. | GUILD |
| `commandstats commands [days]` | Show the most used commands. | GUILD |
| `commandstats failures [days]` | Show commands with the most issues. | GUILD |
| `nicknamepolicy setup [symbols] [fallback]` | Enable the nickname policy. | GUILD + NICKNAMES |
| `nicknamepolicy block <phrase>` | Block a literal nickname phrase. | GUILD + NICKNAMES |
| `nicknamepolicy unblock <phrase>` | Remove a blocked phrase. | GUILD + NICKNAMES |
| `nicknamepolicy exempt <role> <enabled>` | Add or remove a role exemption. | GUILD + NICKNAMES |
| `nicknamepolicy check <member>` | Preview the policy for one member. | GUILD + NICKNAMES |
| `nicknamepolicy off` | Disable nickname enforcement. | GUILD + NICKNAMES |
| `nicknamepolicy view` | View nickname rules and exemptions. | GUILD + NICKNAMES |
| `verification setup <role> <age>` | Enable verification with an approved basic role. | Runtime checks |
| `verification panel <channel>` | Post a verification button. | Runtime checks |
| `verification approve <member>` | Approve a member with a staff override. | Runtime checks |
| `verification off` | Disable verification. | Runtime checks |
| `verification view` | View verification settings. | Runtime checks |
| `levels enable [channel]` | Enable XP with an optional announcement channel. | Runtime checks |
| `levels disable` | Pause XP gains while keeping ranks. | Runtime checks |
| `levels rank [member]` | Show a member's rank card. | Runtime checks |
| `levels leaderboard [page]` | Browse XP leaders. | Runtime checks |
| `levels reward <level> <role>` | Set a cumulative role reward. | Runtime checks |
| `levels unreward <level>` | Remove a role reward. | Runtime checks |
| `levels reset <member>` | Reset one member's XP, keeping granted roles. | Runtime checks |
| `levels view` | View XP settings and rewards. | Runtime checks |
| `afk set [message]` | Set your away message. | Runtime checks |
| `afk clear` | Clear your away status. | Runtime checks |
| `afk view <member>` | View a member's away status. | Runtime checks |
| `alias set <name> <target>` | Create or replace a command alias. | GUILD |
| `alias remove <name>` | Remove a custom alias. | GUILD |
| `alias list` | List this server's custom aliases. | GUILD |
| `modstats summary [days]` | Show case totals. | TIMEOUT |
| `modstats staff <member> [days]` | Show one moderator's activity. | TIMEOUT |
| `modstats actions [days]` | Count moderation actions by type. | TIMEOUT |
| `modstats appeals [days]` | Show appeal outcomes. | TIMEOUT |
| `lockdown start <channels> [reason]` | Lock channels selected by ID, or all text channels. | CHANNELS + GUILD |
| `lockdown restore` | Restore only unchanged lockdown permission bits. | CHANNELS + GUILD |
| `lockdown view` | Show the active lockdown and saved channels. | CHANNELS + GUILD |
| `tag create <name> <text>` | Create a server tag. | Runtime checks |
| `tag edit <name> <text>` | Edit a server tag. | Runtime checks |
| `tag delete <name>` | Delete a server tag. | Runtime checks |
| `tag show <name>` | Read a server tag. | Runtime checks |
| `tag info <name>` | Show a tag's author and last edit. | Runtime checks |
| `tag list [page]` | Browse server tags. | Runtime checks |
| `autoresponder add <trigger> <reply>` | Add an automatic reply. | GUILD |
| `autoresponder update <trigger> <reply>` | Update an automatic reply. | GUILD |
| `autoresponder remove <trigger>` | Remove an automatic reply. | GUILD |
| `autoresponder view <trigger>` | View an automatic reply. | GUILD |
| `autoresponder list` | List automatic reply triggers. | GUILD |
| `welcome add <channel> <message>` | Set a channel's message. | GUILD |
| `welcome remove <channel>` | Remove a channel's message. | GUILD |
| `welcome view <channel>` | View a channel's configured message. | GUILD |
| `welcome list` | List configured channels. | GUILD |
| `welcome variables` | List available message variables. | GUILD |
| `welcome test <channel>` | Post a preview using your own account. | GUILD |
| `goodbye add <channel> <message>` | Set a channel's message. | GUILD |
| `goodbye remove <channel>` | Remove a channel's message. | GUILD |
| `goodbye view <channel>` | View a channel's configured message. | GUILD |
| `goodbye list` | List configured channels. | GUILD |
| `goodbye variables` | List available message variables. | GUILD |
| `goodbye test <channel>` | Post a preview using your own account. | GUILD |
| `autorole add <role> <audience>` | Add a role for new members. | GUILD + ROLES |
| `autorole remove <role>` | Remove a configured role. | GUILD + ROLES |
| `autorole list` | Show configured roles. | GUILD + ROLES |
| `autorole enable` | Enable configured autoroles. | GUILD + ROLES |
| `autorole disable` | Pause autoroles without deleting their configuration. | GUILD + ROLES |
| `joinlogs set <channel>` | Choose a log channel. | GUILD |
| `joinlogs off` | Disable member logs. | GUILD |
| `joinlogs view` | View member log configuration. | GUILD |
| `autonick set <template>` | Set a nickname template. | GUILD + NICKNAMES |
| `autonick off` | Disable automatic nicknames. | GUILD + NICKNAMES |
| `autonick view` | View the nickname template. | GUILD + NICKNAMES |
| `poll create <question> <answers>` | Create a native Discord poll. | Runtime checks |
| `poll results <message>` | Show results for a poll in this channel. | Runtime checks |
| `choose <options>` | Choose randomly from options separated by \|. | Runtime checks |
| `roll <dice>` | Roll dice such as 2d6. | Runtime checks |
| `coinflip` | Flip a coin. | Runtime checks |
| `8ball <question>` | Ask the magic eight ball. | Runtime checks |
| `timestamp <seconds>` | Format a Unix timestamp for Discord. | Runtime checks |
| `snowflake <id>` | Show when a Discord ID was created. | Runtime checks |
| `firstmessage` | Link the first available message in this channel. | Runtime checks |
| `servericon` | Show this server's icon. | Runtime checks |
| `serverbanner` | Show this server's banner. | Runtime checks |
| `boosts` | Show this server's boost level and count. | Runtime checks |
| `help [command]` | See commands, a help page, or help for a specific command. | Runtime checks |
| `ping` | Check whether Sonata is responding. | Runtime checks |
| `ban <member> [reason]` | Ban a member or user ID. | BAN |
| `tempban <member> <duration> [reason]` | Ban a member until a chosen time. | BAN |
| `softban <member> <days> [reason]` | Remove a member and delete their recent messages, then unban. | BAN |
| `banlist [after]` | Browse this server's bans. | BAN |
| `nickname <member> [name]` | Change a member's nickname, or omit the name to reset it. | NICKNAMES |
| `unban <user> [reason]` | Remove a user's ban. | BAN |
| `kick <member> [reason]` | Remove a member from the server. | KICK |
| `timeout <member> <duration> [reason]` | Temporarily prevent a member from participating. | TIMEOUT |
| `untimeout <member> [reason]` | Remove a member's timeout. | TIMEOUT |
| `warn <member> [reason]` | Record a warning for a member. | TIMEOUT |
| `warnings <member>` | List a member's warnings. | TIMEOUT |
| `warnremove <case> [reason]` | Clear one warning while keeping its case history. | TIMEOUT |
| `warnclear <member> [reason]` | Clear a member's warnings while keeping their case history. | TIMEOUT |
| `purge <count> [member] [filter]` | Delete matching messages from up to 100 recent messages. | MESSAGES |
| `slowmode <seconds>` | Set this channel's slowmode delay. | CHANNELS |
| `lock [reason]` | Lock this channel. | CHANNELS + ROLES |
| `unlock [reason]` | Unlock this channel. | CHANNELS + ROLES |
| `hide [reason]` | Hide this channel. | CHANNELS + ROLES |
| `unhide [reason]` | Unhide this channel. | CHANNELS + ROLES |
| `pin <message> [reason]` | Pin a message in this channel. | PINS |
| `unpin <message> [reason]` | Unpin a message in this channel. | PINS |
| `pins [before]` | Browse this channel's pinned messages. | Runtime checks |
| `role restore <member>` | Restore basic roles within three hours of departure. | ROLES |
| `role recovery <enabled>` | Enable or disable future role recovery snapshots. | ROLES |
| `role add <member> <role> [reason]` | Give a member a role. | ROLES |
| `role remove <member> <role> [reason]` | Remove a member's role. | ROLES |
| `role create <name>` | Create a role without extra permissions. | ROLES |
| `role rename <role> <name>` | Rename a role. | ROLES |
| `role color <role> <color>` | Change a role's colour. | ROLES |
| `role hoist <role> <enabled>` | Show a role separately in the member list. | ROLES |
| `role mentionable <role> <enabled>` | Allow anyone to mention a role. | ROLES |
| `voice move <member> <channel> [reason]` | Move a member to another voice channel. | Runtime checks |
| `voice disconnect <member> [reason]` | Disconnect a member in voice. | Runtime checks |
| `voice mute <member> [reason]` | Mute a member in voice. | Runtime checks |
| `voice unmute <member> [reason]` | Unmute a member in voice. | Runtime checks |
| `voice deafen <member> [reason]` | Deafen a member in voice. | Runtime checks |
| `voice undeafen <member> [reason]` | Undeafen a member in voice. | Runtime checks |
| `channel name <name>` | Rename this channel. | CHANNELS |
| `channel topic [topic]` | Change this channel's topic, or omit to clear. | CHANNELS |
| `channel nsfw <enabled>` | Set this channel's age restriction. | CHANNELS |
| `channel userlimit <channel> <limit>` | Set a voice channel's user limit. | CHANNELS |
| `userinfo [member]` | Show a member's account and server details. | Runtime checks |
| `avatar [member]` | Show a member's avatar. | Runtime checks |
| `banner [member]` | Show a member's banner. | Runtime checks |
| `serverinfo` | Show this server's details. | Runtime checks |
| `membercount` | Show this server's member count. | Runtime checks |
| `roleinfo <role>` | Show a role's details and permissions. | Runtime checks |
| `roles [page]` | Browse this server's roles. | Runtime checks |
| `channelinfo [channel]` | Show a channel's details. | Runtime checks |
| `jailsetup` | Create and configure a jail role and channel. | CHANNELS + GUILD + ROLES |
| `jail <member> [duration] [reason]` | Restrict a member to the jail channel. | ROLES + TIMEOUT |
| `unjail <member> [reason]` | Release a member and restore their saved roles. | ROLES + TIMEOUT |
| `case export <member> [format] [before]` | Download up to one hundred member cases and their notes. | TIMEOUT |
| `case list [before]` | Browse this server's recent cases. | TIMEOUT |
| `case view <case>` | View one case. | TIMEOUT |
| `case history <member> [before]` | See a member's recent cases. | TIMEOUT |
| `case reason <case> <reason>` | Update a case's reason. | TIMEOUT |
| `case note <case> <note>` | Add a staff note to a case. | TIMEOUT |
| `case evidence <case> <file>` | Attach an evidence file to a case. | TIMEOUT |
| `settings view` | See this server's Sonata settings. | GUILD |
| `settings prefix <prefix>` | Set the prefix used for message commands. | GUILD |
| `settings modlog <channel>` | Choose the moderation log channel. | GUILD |
| `settings dm <enabled>` | Choose whether punishments send a DM. | GUILD |
| `settings message <action> <text>` | Customize a punishment DM. | GUILD |
| `automod regexadd <pattern>` | Add a native Discord regex filter. | GUILD |
| `automod regexremove <pattern>` | Remove one regex filter. | GUILD |
| `automod regexlist` | List Sonata's regex filters. | GUILD |
| `automod profileadd <word>` | Block interactions for matching member profiles. | GUILD |
| `automod profileremove <word>` | Remove a member profile filter. | GUILD |
| `automod profilelist` | List Sonata's member profile filters. | GUILD |
| `automod preview <pattern> <sample>` | Test a regex sample without enabling a rule. | GUILD |
| `automod allowadd <word>` | Allow a word in Sonata's word filter. | GUILD |
| `automod allowremove <word>` | Remove an allowed word. | GUILD |
| `automod exemptrole <rule> <role> <enabled>` | Exempt a role from a Sonata rule. | GUILD |
| `automod exemptchannel <rule> <channel> <enabled>` | Exempt a channel from a Sonata rule. | GUILD |
| `automod words` | View Sonata's blocked and allowed words. | GUILD |
| `automod config` | View Sonata's rules and their exemptions. | GUILD |
| `automod wordsadd <word>` | Add a blocked word or wildcard. | GUILD |
| `automod wordsremove <word>` | Remove a blocked word or wildcard. | GUILD |
| `automod mentions <limit>` | Set the blocked mention threshold. | GUILD |
| `automod spam <enabled>` | Enable or disable Discord's spam filtering. | GUILD |
| `automod list` | See AutoMod rules managed by Sonata. | GUILD |


### Sticky messages and video embeds

- `,stick <text>` / `,stickmessage <text>` or reply to a text message with `,stick`. A message link from the same channel can also be copied. Requires Manage Messages. One persistent sticky per channel; reposts below new human messages without pinging. `/stick set` is the slash equivalent.
- `,unstick [message link]` / `,unstickmessage [message link]` or `/stick remove` stops the channel sticky. Current sticky links and original source links are accepted.
- `sonata <video URL>`, `,sonata <video URL>` or `/sonata url:<URL>` uploads a supported public video and credits the sender. TikTok, Instagram, X and YouTube posts are supported when the provider allows retrieval. Recorded MP4 clips are limited to three minutes and 8 MB; private or restricted posts are not bypassed. When direct retrieval is unavailable, Sonata posts a corrected embed link (the same public embed providers used by the plugin) with sender credit.
- `,settings videoembeds true #channel` enables automatic video embedding in that channel; `false` disables it. Automatic mode is off by default, handles at most one video per message, and uses the normal command cooldown. The existing Oracle companion handles retrieval separately from moderation.

### Website tools

Settings includes a message designer with local previews, a server-checked preview, welcome/goodbye automation saves, and explicit posting for custom, verification and ticket panels. Verification and tickets must be configured before posting their buttons. Only the Discord server owner can manage the dashboard whitelist and disable administrator / Manage Server dashboard access. Whitelisted members must remain in the server and retain the real permissions required by each action.

Sonata's owner can grant separate permissions for account viewing, account restrictions, server viewing, server departures/blacklists and service health. Grants do not authorize delegation or change owner access. Revocations apply immediately. Service health shows deployments, database response time, Gateway and music/video availability, and aggregate command issues.
