# Cloudflare free hosting

This deploys the same Sonata Control Room dashboard and sign-in flow on Cloudflare Workers with a D1 database. Keep the account on Workers Free. A paid domain is not required; use the provided `workers.dev` address. Free usage has limits, so check the [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) as your installation grows. D1 stops accepting queries when its free daily limits are reached.

This workspace is configured for [Sonata Control Room](https://sonata.hurts.workers.dev/admin). Its database has been created and the initial migration applied. Private configuration is stored in Cloudflare secrets. Discord must allow `https://sonata.hurts.workers.dev/auth/callback` as an OAuth2 redirect before sign-in can complete. Follow the first-deployment steps below when preparing a separate installation.

## First deployment

Run commands from this directory. Do not upload the private `service/.env` file to GitHub or paste its values into chat.

1. Create a Cloudflare account on its free plan. You may create a Hello World Worker named `sonata` from Workers & Pages first to obtain your public address. Deploying this project replaces that placeholder.
2. Run `npm ci`, then `npm run login`. Approve Cloudflare's authorization in your own browser.
3. Run `npx wrangler d1 create sonata-control-room`. Copy the returned database UUID into `d1_databases[0].database_id` in `wrangler.jsonc`, replacing the all-zero placeholder. If the Worker name chosen in the dashboard differs, update `name` in that file too. Do not create another database on subsequent deployments.
4. Run `npm run migrate`, then `npm run deploy`. Copy the resulting HTTPS `workers.dev` origin. This initial deployment deliberately prevents sign-in until the configuration is complete.
5. In the existing private `../.env`, set `PUBLIC_URL` to that origin, without a trailing slash or `/admin`. Keep `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `ADMIN_USER_IDS` configured there. The requested owner ID is `779172192461783110`.
6. In the Discord Developer Portal, open that application's OAuth2 settings. Add `PUBLIC_URL/auth/callback` as a redirect using the actual address, for example `https://sonata.YOUR-SUBDOMAIN.workers.dev/auth/callback`. Save the change.
7. Run `node upload-secrets.mjs`. It reads only those four configuration fields from the private local `.env` and sends them through Wrangler's standard input. Their values are not printed or placed in command arguments. No Node-only host, port, or file paths are uploaded.
8. Open `PUBLIC_URL/admin` using the actual address. Sign in as the configured owner. Test activation with your own account before connecting a managed Sonata build as described in the [service README](../README.md).

The database is separate from Worker deployments, so access records survive redeployment. Existing local SQLite records are not imported automatically. Cloudflare's daily scheduled trigger performs the same expiry and 90-day retention cleanup as the Node service. Application request logging is disabled in the supplied Worker configuration; Cloudflare still operates its own infrastructure.

For updates, run `npm run migrate` if there are new migrations, then `npm run deploy`. Existing secrets stay on Cloudflare. Change them with `node upload-secrets.mjs` after updating the private local configuration. Never put them in `wrangler.jsonc`.

## Local checks

Run `npm test`. It builds without deploying, runs the shared authorization and activation checks against a temporary D1 database, and checks the bundled Worker with real dashboard assets, request bodies, cookies and access restrictions. Tests use fake identities and mocked Discord responses.

For an interactive local Worker, run `npm run migrate:local`, then `npm run dev`. Local development does not load the parent `.env`; use a private `.dev.vars` in this directory if you need local OAuth. Its `PUBLIC_URL` and Discord redirect must both use the same local origin. Do not use production credentials for automated tests.

## Bot dashboard extension

The owner dashboard has a Discord bot tab, and /bot provides server management for accounts with current Manage Server permission. Deploy Sonata Bot first, keep the BOT_SERVICE binding pointed at that Worker, and configure a separate matching BOT_DASHBOARD_SECRET in both private .env files. Upload it with the bot setup tool using --upload-dashboard and this folder's upload-secrets.mjs. The owner IDs in DASHBOARD_OWNER_IDS on the bot must match the intended Control Room administrators. Migration 0002_bot_dashboard.sql creates separate OAuth flow markers and twelve-hour sessions without changing existing activation records. No extra Discord scopes or redirects are needed. The browser and Control Room never receive the bot token.
