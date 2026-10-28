# Sonata Bot commands

Use / for slash commands or your server prefix (a comma by default). <Required> and [Optional].

| Command | Description | Required permission |
| --- | --- | --- |
| `help [command]` | See commands, a help page, or help for a specific command. | None |
| `ping` | Check whether Sonata is responding. | None |
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
| `lock [reason]` | Lock this channel. | CHANNELS, ROLES |
| `unlock [reason]` | Unlock this channel. | CHANNELS, ROLES |
| `hide [reason]` | Hide this channel. | CHANNELS, ROLES |
| `unhide [reason]` | Unhide this channel. | CHANNELS, ROLES |
| `pin <message> [reason]` | Pin a message in this channel. | PINS |
| `unpin <message> [reason]` | Unpin a message in this channel. | PINS |
| `pins [before]` | Browse this channel's pinned messages. | None |
| `role add <member> <role> [reason]` | Give a member a role. | ROLES |
| `role remove <member> <role> [reason]` | Remove a member's role. | ROLES |
| `role create <name>` | Create a role without extra permissions. | ROLES |
| `role rename <role> <name>` | Rename a role. | ROLES |
| `role color <role> <color>` | Change a role's colour. | ROLES |
| `role hoist <role> <enabled>` | Show a role separately in the member list. | ROLES |
| `role mentionable <role> <enabled>` | Allow anyone to mention a role. | ROLES |
| `voice move <member> <channel> [reason]` | Move a member to another voice channel. | MOVE |
| `voice disconnect <member> [reason]` | Disconnect a member in voice. | MOVE |
| `voice mute <member> [reason]` | Mute a member in voice. | VOICE_MUTE |
| `voice unmute <member> [reason]` | Unmute a member in voice. | VOICE_MUTE |
| `voice deafen <member> [reason]` | Deafen a member in voice. | VOICE_DEAFEN |
| `voice undeafen <member> [reason]` | Undeafen a member in voice. | VOICE_DEAFEN |
| `channel name <name>` | Rename this channel. | CHANNELS |
| `channel topic [topic]` | Change this channel's topic, or omit to clear. | CHANNELS |
| `channel nsfw <enabled>` | Set this channel's age restriction. | CHANNELS |
| `channel userlimit <channel> <limit>` | Set a voice channel's user limit. | CHANNELS |
| `userinfo [member]` | Show a member's account and server details. | None |
| `avatar [member]` | Show a member's avatar. | None |
| `banner [member]` | Show a member's banner. | None |
| `serverinfo` | Show this server's details. | None |
| `membercount` | Show this server's member count. | None |
| `roleinfo <role>` | Show a role's details and permissions. | None |
| `roles [page]` | Browse this server's roles. | None |
| `channelinfo [channel]` | Show a channel's details. | None |
| `jailsetup` | Create and configure a jail role and channel. | CHANNELS, GUILD, ROLES |
| `jail <member> [duration] [reason]` | Restrict a member to the jail channel. | ROLES, TIMEOUT |
| `unjail <member> [reason]` | Release a member and restore their saved roles. | ROLES, TIMEOUT |
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
| `automod wordsadd <word>` | Add a blocked word or wildcard. | GUILD |
| `automod wordsremove <word>` | Remove a blocked word or wildcard. | GUILD |
| `automod mentions <limit>` | Set the blocked mention threshold. | GUILD |
| `automod spam <enabled>` | Enable or disable Discord's spam filtering. | GUILD |
| `automod list` | See AutoMod rules managed by Sonata. | GUILD |

Bot permissions and role positions are checked separately. Voice commands check the source channel and move destination. Channel commands also require channel access. Jail and role assignment enforce additional checks.

Durations: 30m, 2h, 7d, 1h30m. Timeouts and timed jails allow up to 28 days; tempbans allow up to 365 days.

Prefix aliases: b → ban; tban → tempban; bans → banlist; nick → nickname; mute → timeout; unmute → untimeout; warns → warnings; clear → purge.

Purge filters: all, bots, humans, links, files, embeds, pinned. Pinned messages are kept unless explicitly selected.

Warning clearing keeps case history and evidence. Case evidence files must be images or videos no larger than 8 MiB.
