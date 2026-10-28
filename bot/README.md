# Sonata Bot

An independent Discord moderation bot with the same commands available as slash commands and prefix commands. The default prefix is `,`. It uses a separate Discord application from Sonata Control Room. Bot credentials never belong in the client plugin or GitHub.

## Commands

| Group | Commands |
| --- | --- |
| Punishments | `ban`, `tempban`, `softban`, `banlist`, `unban`, `kick`, `timeout`, `untimeout`, `nickname` |
| Warnings and records | `warn`, `warnings`, `warnremove`, `warnclear`, `case list`, `case view`, `case history`, `case reason`, `case note`, `case evidence` |
| Channel controls | `purge`, `slowmode`, `lock`, `unlock`, `hide`, `unhide`, `pin`, `unpin`, `pins`, `channel name`, `channel topic`, `channel nsfw`, `channel userlimit` |
| Roles | `role add`, `role remove`, `role create`, `role rename`, `role color`, `role hoist`, `role mentionable` |
| Voice moderation | `voice move`, `voice disconnect`, `voice mute`, `voice unmute`, `voice deafen`, `voice undeafen` |
| Information | `userinfo`, `serverinfo`, `membercount`, `roleinfo`, `roles`, `channelinfo`, `avatar`, `banner` |
| Jail | `jailsetup`, `jail`, `unjail` |
| Server configuration | `settings view`, `settings prefix`, `settings modlog`, `settings dm`, `settings message` |
| Native Discord AutoMod | `automod wordsadd`, `automod wordsremove`, `automod mentions`, `automod spam`, `automod list` |
| Help | `help`, `ping` |

Examples: `,tempban @member 7d repeated spam`, `/timeout member:@member duration:30m reason:spam`, `,case history @member`, `,case note 12 Appeal reviewed`, `,settings prefix !`.

The [complete command reference](COMMANDS.md) lists all syntax and permissions. `help` is paginated (`help 2`) and accepts command names (`help role add`). The bot has its own implementation inspired by the moderation, server and information categories in [Bleed's command catalogue](https://bleed.bot/commands).

More examples: `,softban @member 1 spam`, `,nickname @member New name`, `,role add @member @role`, `,role color @role #a78bfa`, `,voice move @member #voice`, `,purge 25 bots`, `,pin MESSAGE_ID`, `,warnremove 12 appeal accepted`. Cleanup can select all, bots, humans, links, files, embeds or pinned messages. Pinned messages are kept unless the pinned filter is selected. At most 100 recent messages are inspected, so fewer matches may be deleted than requested. Case and ban browsing supports cursors, and role browsing supports pages. Information commands fetch current Discord data and do not build member or message archives.

Role assignment requires the selected role to be below both the moderator and bot, and its permissions must be held by both. Managed roles, the everyone role and the jail role cannot be edited through these commands. Jailed members cannot receive role changes or voice moves until released. Voice commands check permissions in the member's source channel and, for moves, the destination too. Warning removal marks warnings cleared and records who cleared them; existing cases, notes and evidence remain. Softban deletes up to the chosen number of days of messages, removes the member, then unbans them; an incomplete release is marked for staff review.

The invite now also requests Manage Nicknames, Connect, Move Members, Mute Members, Deafen Members and Pin Messages. Existing installations may need the owner to use the invite again to approve these permissions. Administrator is still not requested. Leave slash command permissions for the voice group open to staff who need it; each voice subcommand checks its own real Discord permission at runtime.

Prefix aliases include `b`, `tban`, `mute`, `unmute`, `warns` and `clear`. Quoted arguments are supported. Duration values include `30m`, `2h`, `7d` and `1h30m`. Timeouts and timed jails support up to 28 days; temporary bans support up to 365 days. Timed actions are checked each minute, so releases may happen after the exact expiry time. Service outages or Discord permission errors can delay them. Failed releases are recorded for staff review.

## Hosting

The Worker uses one SQLite-backed Durable Object for the Gateway connection, server settings, cases and scheduled releases. It receives prefix and slash commands through Discord's authenticated Gateway. Leave the application's Interactions Endpoint URL empty; an HTTP interaction endpoint is not required for this design. The existing Control Room OAuth redirect belongs to its separate application and does not change.

The design targets Workers Free. One always-active 128 MiB object uses about 11,060 GB-seconds per day, within the currently documented 13,000 GB-second daily allowance. Requests, SQL operations and storage have separate limits. An outgoing Gateway WebSocket cannot hibernate. This design supports one Gateway connection and must be redesigned for Discord sharding requirements or traffic above the free limits. Free limits stop operations instead of automatically upgrading the plan. See [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [WebSocket behavior](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

## First setup

1. Create a separate Discord application named **Sonata Bot**. This workspace uses application `1564909992383877122`.
2. On its Bot page, enable **Server Members Intent** and **Message Content Intent**. Enable **Public Bot** if other server administrators should be able to invite it. Discord requires review for privileged intents as a bot grows.
3. Copy `.env.example` to `.env` only if `.env` does not exist. Fill `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, and a random `BOT_CONTROL_SECRET` of at least 32 characters. The private file in this workspace already contains the application ID and a generated control secret. Keep the token and control secret private.
4. Run `npm install` in this folder, then `npm run setup -- --check`. This checks that the bot token belongs to the expected application.
5. Run `npm run check` and `npm test`. Then run `npm run deploy`. The first deployment stays unconfigured until secrets are saved.
6. Run `npm run setup -- --upload` to send the three private configuration values into this Worker's Cloudflare secret storage. Values use the tool's standard input and are not printed. This requires authorization to your own Cloudflare account using Wrangler.
7. Run `npm run setup -- --register` to register the slash commands. Leave `TEST_GUILD_ID` empty for global commands, or use an already-installed test server for guild-only registration.
8. Open `https://sonata-bot.pkispure.workers.dev/invite`, choose your server and approve the required permissions. The invite does not request Administrator. Move the bot's role above the members it should moderate.
9. Run `npm run setup -- --start`, then `npm run setup -- --status` to check the connection. If Discord reports missing privileged intents, enable them in the portal and run `--start` again.
10. In your server, use `/settings modlog` to select a staff log channel, `/jailsetup` if you want jail, and `/settings dm` if you want punishment DMs. Test with `/ping` and `,ping` before using moderation actions.

For updates, run `npm run check`, `npm test` and `npm run deploy`. Run `--register` when command definitions change. Deployments keep the Durable Object's saved data. Use `--stop` to pause the Gateway until `--start` is called again. The one-minute scheduled trigger reconnects after temporary failures and processes timed releases while running.

## Moderation behavior and stored data

The server's real Discord permissions and role hierarchy are checked for every moderation command. The bot also needs the permissions and hierarchy required to perform it. Staff settings cannot grant permissions that bypass these checks. Server owners cannot be targeted, and a moderator cannot target themselves or Sonata Bot. Prefix and slash commands share validation and cases. Replayed Gateway commands cannot repeat an accepted action.

Cases record the server, target, moderator, reason, duration, status and staff notes. An ambiguous or failed action is marked for review. Case access requires moderation permissions in that server. This bot does not use the Control Room activation registry or collect general chat history. Gateway message content is processed to recognize commands and is not saved as a message archive. Accepted command IDs are retained for seven days to prevent duplicate actions. Cases and server settings remain until the operator removes them.

`case evidence` accepts image/video attachments up to 8 MiB. The bot copies the actual file into the configured Discord staff log channel and saves that message's link with the case. Keep the Discord log message to retain its file. Case reasons, notes and evidence links are stored in the bot's SQLite data; files remain on Discord. Copying can fail if Discord refuses the attachment or bot upload permissions are missing.

Lock and hide modify the everyone overwrite; explicit role/member allows and administrators can still bypass that overwrite. Unlock/unhide restore only the permission bits Sonata changed, preserving unrelated edits. Jail setup creates a role and private channel, supports up to 100 existing channels, and saves the member's original roles for release. Jail does not grant new roles during restoration; role hierarchy is checked against the saved roles too. Keep the bot's role and permissions in place so scheduled releases can complete.

Punishment DMs are off by default. If enabled, the bot reports DM failures separately from successful moderation actions. A later ban with a different reason is kept when an older temporary ban expires. Actions performed by other bots or manually in Discord do not automatically become Sonata cases.
