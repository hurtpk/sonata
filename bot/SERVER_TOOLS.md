# Sonata server tools

These commands use slash commands or the server/personal prefix. Examples below use the default comma. New protections, event logs, warning rules, appeals and tickets remain off until configured. The bot needs the corresponding Discord permissions and a high enough role. Use the Add Sonata Bot button again if an existing installation needs the newly requested **View Audit Log** permission. No Administrator permission is requested.

| Requested feature | First setup or control |
| --- | --- |
| #1 Anti-raid | `,antiraid setup #staff-alerts 5 30 24 alert` |
| #2 Anti-nuke | Server owner: `,antinuke setup #staff-alerts 3 30 alert` |
| #3 Event logs | `,eventlog set roles #server-logs` |
| #4 Warning escalation | `,escalation set 3 timeout 1h` |
| #5 Ban appeals | `,appeals setup #ban-appeals` |
| #6 Tickets | `,ticket setup #ticket-category @Support #ticket-transcripts`, then `,ticket panel #support` |
| #9 VoiceMaster buttons | `,voicemaster room` while connected to a managed room |
| #10 Music buttons | `,play SONG NAME` or `,nowplaying` |
| #11 Giveaways | `,giveaway start 1d 1 "One month of Nitro"` |

Use `,help COMMAND` to see every subcommand and option. For prefix commands, quote prizes containing multiple words because optional role and account-age arguments follow the prize. Channel IDs and mentions are both accepted. For a category, use its ID with the prefix command or select it in the slash command.

## Join protection

Anti-raid setup requires Administrator. The example detects five human joins within thirty seconds, or an arriving account younger than twenty-four hours, and alerts staff. Set account age to zero to disable the age check. Bots are excluded. A join spike activates protection for subsequent arrivals for ten minutes. The initial arrivals before the threshold are not retroactively punished. Repeated spikes extend the window. Alerts are limited to one per fifteen seconds per server.

For quarantine, first run `,jailsetup`, then choose `quarantine` instead of `alert`. Flagged eligible arrivals are placed in the existing jail for fifteen minutes with a case and scheduled release. The server owner and members holding administrative or moderation permissions are excluded. Discord role hierarchy still applies. `antiraid clear` ends the current raid window; `off` disables checks; `view` shows configuration and delivery issues. Timed releases run about once a minute and may be delayed by outages or permission failures.

## Anti-nuke

Only the server owner can configure anti-nuke, trust accounts or restore saved roles. It counts confirmed audit entries for bans, channel deletions and role deletions by the same account within the configured window. The owner, Sonata itself and explicitly trusted accounts are exempt. Old audit entries and duplicate deliveries do not trigger actions. The bot needs View Audit Log; `strip` additionally needs Manage Roles and a role above the responsible member.

Choose `alert` to notify staff or `strip` to remove the member's removable dangerous roles. Dangerous permissions include Administrator, Manage Server, Manage Channels, Manage Roles, Manage Webhooks, Ban Members, Kick Members and Moderate Members. Managed and unrelated roles are kept. Saved role IDs and permission snapshots allow the owner to use `antinuke restore @member`; restoration refuses deleted, changed, managed or inaccessible roles. Cases record completed actions and failures needing review. This is reactive protection: it cannot prevent the first actions, recover deleted content or control members above the bot. Audit events and command processing can be delayed or skipped under extreme load.

## Event logs

Configure any of `channels`, `roles`, `members`, `voice` and `bans` separately. Audit-based logs show the acting account, target, reason and available old/new changes. Voice logs record channel joins, moves and leaves, not microphone toggles or voice audio. Audit-based categories require View Audit Log; voice logs do not. No ordinary message archive is created by these logs. `eventlog off TYPE` disables a category; disabling voice logging also clears its saved current-channel records.

## Warning rules

Administrators can configure an action at an exact active-warning count, with `timeout`, `kick` or `ban`. Timeout defaults to one hour and supports up to twenty-eight days. Actions apply when a future warning reaches the configured count, rather than immediately punishing existing records during setup. Rules run once per warning event and create a linked case. Owners, administrators, bots and configured exempt roles do not receive automatic escalation.

`escalation expiry 30` expires warnings after thirty days; zero keeps warnings active indefinitely. `escalation exempt @role on` adds an exemption, `remove COUNT` removes a threshold, and `view` shows the rules. Expired and cleared warnings retain their cases, evidence and notes. Expiry is checked during warning commands and scheduled maintenance.

## Ban appeals

Setup requires Manage Server and Ban Members. Choose a staff review channel. Future Sonata bans send a notice with an appeal button before the ban is attempted, then update that notice when the action completes. Failed actions disable the form. Closed DMs can prevent delivery; existing bans are not automatically sent new notices.

The form is available in the bot DM, without server membership, and is bound to the original banned account and case. One appeal per case can be submitted. Staff receive the appeal with **Approve & unban**, **Deny** and **Case & evidence** controls. Reviews require current Ban Members permission and access to the review channel. Approval removes only the matching Sonata ban, preserving a newer or different ban. Decisions and review failures are recorded with the original case; the member receives a decision DM when delivery is possible. An approved member still needs a server invite to rejoin.

`appeals list` and `appeals case NUMBER` expose saved reviews to authorized staff. Evidence is prioritized when displaying up to five evidence links and recent notes. If the review channel message cannot be delivered, the submitted appeal remains saved. `appeals off` disables new submissions.

## Tickets

Setup requires Manage Server and Manage Channels, with a support role and a transcript channel. New ticket channels explicitly grant access to their owner, the support role and Sonata; Discord administrators can also access them. There is one open ticket per member, up to twenty-five open tickets and one hundred unarchived records per server. Configuration changes do not rewrite existing ticket channels' permission overwrites.

The panel opens a topic form. Staff can claim tickets. The owner or staff can close one; closing first uploads a real JSON transcript, then makes the channel read-only for its owner. If upload fails, the ticket stays open. Transcripts include the latest five hundred messages and attachment links, with an 8 MiB file limit. They do not archive attachment bytes; use case evidence uploads when an actual image/video copy must be retained. Transcript channel access determines who can read exported files.

Only staff can reopen a ticket, and its owner cannot already have another open one. `ticket transcript` exports another snapshot. `ticket archive` marks a closed, transcribed ticket archived while keeping its private channel and transcript. It no longer counts toward the unarchived limit. Channels are not automatically deleted. `ticket off` stops new tickets while existing controls remain available. Forms expire after ten minutes and cannot be replayed or submitted as another user.

## Voice and music controls

New VoiceMaster rooms get a control panel in the room's text chat when the bot can send there. `voicemaster room` also opens one. Buttons control locking, visibility, claiming, limits, bitrate, naming, member access, ownership transfer and resetting permissions. Rename, numeric settings and member selection use forms accepting IDs or mentions. Every action rechecks current room membership and ownership or staff permissions; submitting an old form does not bypass an ownership change.

Music results include pause, resume, skip, stop, queue and refresh buttons. Authorized clicks update the player card; users outside its voice channel receive a private rejection. Buttons use the same music service and live permission checks as text/slash commands. SoundCloud searches and links work on the current host; YouTube currently requests sign-in from its Oracle address. The optional [voice service](music/README.md) keeps its existing limits and separate credentials.

## Giveaways

Manage Server is required to start, end, cancel or reroll giveaways. Setup supports a duration of up to thirty days, one to ten winners, an optional required role and a minimum account age. Members enter or leave through buttons; bots cannot enter. Entries survive bot restarts. Limits are ten active giveaways per server and one thousand entrants per giveaway.

Draws sample entries with cryptographic randomness and recheck current membership, role and account-age eligibility. Up to fifty candidates are checked per draw; winner slots may remain empty if enough eligible candidates are not found. Rerolls exclude all previous winners, with a one-hundred-winner history limit. Results are saved before announcement updates, and failed updates are retried without drawing again. Timed draws run about once a minute and can be delayed by service or Discord outages. `giveaway end MESSAGE_ID` draws early, `reroll` draws replacements, `cancel` ends without winners and `list` browses recent records. Prize delivery is handled by the server's staff.

## Dashboard and community tools

`dashboard` opens the server dashboard. Its sign-in uses the existing Control Room Discord application with identify only. Server managers see only the bot installations where they currently have Manage Server, with fresh permission checks for every action. The owner Control Room bot tab lists all bot installations and server metadata; viewing another server as bot owner does not grant configuration, case or ticket access.

`verification setup @Member 24` enables an account-age check and approved basic role, then `verification panel #rules` posts its button. Members must finish Discord rules screening first and cannot verify while jailed. Staff can use `verification approve @member` to override age only. Place the member role below Sonata and staff, without moderation or management permissions. Server owners must configure channel access with that role themselves. This is role verification, not CAPTCHA or proof that an account is human. `verification off` disables granting roles without removing existing ones.

`levels enable [#rank-updates]` awards 15–25 XP per human message, with a persistent one-minute cooldown. Commands, bots, webhooks, honeypots, jailed members and messages shorter than three characters do not earn XP. `levels rank [@member]` shows a progress card; `levels leaderboard [page]` browses ranks. `levels reward 5 @Regular` adds a cumulative basic-role reward, up to ten rewards; role permissions and hierarchy are checked again at award time. Roles must be below the bot and moderator and cannot contain management permissions. `levels disable` pauses gains. `levels reset @member` clears XP while keeping already granted roles. Leveling processes messages without saving their contents and is not an anti-spam guarantee.

`afk Gone for lunch` sets a server-specific public away message; the next non-AFK message clears it. Mentions show at most three away messages per notice, with a thirty-second per-author/channel cooldown. `afk clear` clears manually. `alias set rules tag show rules` creates a prefix shortcut. Up to fifty shortcuts can target native commands with fixed arguments; they cannot replace built-in names, call each other or bypass the original permissions.

`modstats`, `modstats staff @member`, `modstats actions` and `modstats appeals` show scoped counts for up to ninety days. They require Moderate Members. These are Sonata records, rather than a complete record of manual actions or other bots. Daily command counters begin when this version starts and keep no command arguments.

## Ticket routing and reminders

`ticket categoryadd appeals CATEGORY_ID @AppealStaff` adds one of up to five named ticket types with its own Discord category and staff role. `ticket panel #support` then includes a type picker, while `ticket openin appeals My topic` opens directly. The general ticket route remains available. Category changes affect future tickets; existing channels keep their staff role and access. `ticket categoryremove appeals` removes future routing only.

Inside a ticket, staff can use `ticket priority urgent` (low, normal, high or urgent) and `ticket assign @staff`. `ticket idle 24 [#staff-alerts]` enables inactivity reminders after up to 168 hours; zero disables them. One reminder is sent for each inactivity period, and human activity resets the timer. Reminders never close or delete tickets.

## Advanced AutoMod and incident response

`automod regexadd "PATTERN"` creates a Sonata-owned native Discord message filter. `automod profileadd "WORD"` creates a native member-profile filter with Discord's block-member-interactions action. Matching and supported profile fields are controlled by Discord. List and remove commands are available for both. Existing third-party rules and unrelated Sonata filter settings are preserved; native Discord limits apply. `automod preview "PATTERN" "sample text"` tests without enabling any rule, using a linear-time RE2 engine. This preview can differ from Discord's Rust regex engine, which validates the actual saved rule.

`lockdown start all Incident reason` locks everyone sending messages and thread messages in up to fifty text/announcement channels, or supply comma-separated channel IDs instead of all. It requires Manage Server and Manage Channels, plus Sonata's Manage Roles and Send Messages in Threads permissions. Existing installations may need to approve the updated invite. Administrators and explicit role/member allows can still bypass the everyone deny. Sonata keeps a send allowance for itself and saves the original permission bits before each change. `lockdown restore` restores only its unchanged bits, keeping unrelated and subsequent manual changes. Interrupted operations retain snapshots for recovery. Neither command deletes channels or messages.
