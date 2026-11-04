 # Sonata Control Room

A separate service and private admin dashboard for Sonata account activation. The local Node.js version needs no dependencies. Use Node.js 24 or newer. For free hosting with a persistent database, use the [Cloudflare setup](cloudflare/README.md).

## Preview locally

From this directory, run `npm run demo`, then open **http://127.0.0.1:4173/demo**. This uses sample accounts and an in-memory database. Demo changes disappear when the server stops. Demo mode binds only to loopback and refuses to run with `NODE_ENV=production`.

## Configure the real service

1. Copy `.env.example` to `.env` if it does not already exist. The local `.env` prepared in this workspace already contains the requested owner ID.
2. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications). Set its OAuth2 redirect to `https://YOUR-DOMAIN/auth/callback`.
3. Set `PUBLIC_URL` to that HTTPS origin, without a trailing slash. Put the application's ID and secret in `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`. Keep the secret in `.env` on the server, never in Sonata, source control, or chat.
4. Set `ADMIN_USER_IDS` to the owner Discord user ID. Multiple administrator IDs can be separated by commas. Administrator authorization is enforced on the server after Discord sign-in; hiding the dashboard URL is not the access control.
5. Run `npm start` on a persistent Node.js host. Keep `service/data/` on durable storage and back up the SQLite database. Bind to `127.0.0.1` behind an HTTPS reverse proxy that preserves the original Host header. For a container network, explicitly configure `HOST=0.0.0.0` and restrict direct backend access.

For example, a Caddy reverse proxy can use:

```caddy
sonata.your-domain.example {
    reverse_proxy 127.0.0.1:4173
}
```

Open `PUBLIC_URL/admin`, sign in as the configured owner, and use **Block a user ID** or the controls beside an activated account. The private note stays in the dashboard. The audit trail records the administrator, affected ID, time, and action. IDs can be blocked before registration.

For local OAuth development, `http://127.0.0.1:4173/auth/callback` is supported if that exact redirect is configured in Discord. Real deployments require HTTPS.

This is a server application with a persistent database. GitHub Pages alone cannot run it. The Cloudflare version runs the same application with D1 storage instead of a local SQLite file. Deploying the service is separate from building the plugin.

## Connect a managed Sonata build

After the real service is configured and reachable, set `ACCESS_SERVICE_URL` in `sonata/access/config.ts` to the exact HTTPS origin and rebuild Equicord. Fully restart Discord to load the native helpers. The URL is public configuration; application secrets and administrator credentials never belong in the plugin.

This workspace's desktop build is configured for `https://sonatabot.info`. The owner dashboard and its Discord sign-in have been verified. People using this build appear after completing activation; earlier builds do not register themselves automatically. Signing into the owner dashboard alone does not activate the desktop plugin.

An empty service URL keeps the existing public build working without activation or check-ins. Managed activation currently requires the desktop app. Do not ship a build pointed at localhost or the demo service.

In a managed build, the user presses **Activate** inside Sonata. Registration stays in the app, and the activation window includes a placeholder for the future Terms of Service. Sonata reloads once to apply its code patches. New plugin registrations report the account ID and profile supplied by the client; they do not verify Discord account ownership or grant website administrator access. Website Dashboard and Admin sections share a verified Discord sign-in, with current administrator permissions checked on every request.

The service receives the client-reported Discord ID, profile name and avatar, Sonata version, first activation, and last successful check-in. It does not collect messages, evidence files, server lists, friends, hardware fingerprints or IP addresses in the registry. Normal infrastructure may have its own HTTP logs; configure those separately. Check-ins occur about every five minutes while Sonata runs. “Seen recently” means a successful check-in within ten minutes, not guaranteed real-time presence.

Allowed accounts are removed after 90 days without a check-in. Temporary sign-in requests expire after ten minutes. Administrator sessions expire after twelve hours. Device credentials expire after 180 days and are stored as hashes on the service. Sonata stores device credentials through Electron's OS encryption where available; if it is unavailable, credentials stay in memory for that session. OAuth access tokens are used to obtain identity and are not persisted.

An explicit block stops the client at its next successful access check and reloads to remove applied patches. It does not delete local settings, saved evidence or other Discord plugins. A previously approved device gets up to 24 hours of offline grace during a service outage. A known blocked device does not get that grace. Disconnecting clears the local device credential and revokes it on the service when reachable; the access record follows the retention rules. Blocked IDs are retained until an administrator removes the restriction.

Sonata is open-source client code. Someone can modify their copy, use an older build, or remove its local access gate. This service governs cooperating managed builds and any future server-backed services; it is not tamper-proof DRM and cannot identify every fork or offline copy.

## Checks

Run `npm test` for isolated HTTP, SQLite, authorization, OAuth state, activation-proof, block/unblock, account-binding, replay, CSRF, filtering, disconnect and retention checks. Discord responses in these tests are mocked; no real user accounts are changed.

## Owner console and website setup

The owner-only console adds session revocation, account lookup, server health checks, command maintenance and staged rollouts, private server notes, measured resource counters with optional thresholds, and configuration history. These routes require a configured Sonata owner; delegated administrator scopes do not grant access. Session responses never return token hashes or CSRF credentials. Configuration history retains 50 revisions per server and restores only supported local settings after checking that they have not changed again. Discord role, channel and native AutoMod changes require their setup actions.

Migration `0006_session_details.sql` adds session details and has been applied to the hosted service. The approved website is live at https://sonatabot.info; its dashboard and administration views use the existing authenticated handlers rather than demo data. The dashboard Command setup screen shares the real command schema and full reference descriptions with the local preview. File evidence still needs an attached Discord command. Guides and Status are public pages; status exposes only service availability. Resource counters measure Sonata activity and binary media received, not provider billing or total Oracle disk usage.

The public command catalog is generated from the real schema by `node service/build-site.mjs`; the Cloudflare check and deploy scripts run it automatically. The site serves its DM Sans font locally under the included SIL Open Font License. Dashboard and Admin views can be hosted inside the same-origin site shell; external framing remains blocked.

The administration sidebar uses Plugin for activation records. Bot-user blocks are separate from plugin access and server blacklists. They stop commands, component actions, automatic video embeds and web-issued bot mutations, and can be removed from Bot servers. Only the configured Sonata owner can manage them.

Owner tools → Send message posts up to 2,000 characters as Sonata into a selected installed server's sendable text or announcement channel. Mentions do not notify. The last 500 message receipts retain owner, server, channel, message ID and time, without copying message content. Only the configured owner can send; delegated administrators cannot.

The dashboard switches between My servers and All bot servers without reloading. The latter is available to the owner and administrators explicitly granted View all bot servers; server-side checks apply on every request. Switching list scope does not grant server configuration access.
