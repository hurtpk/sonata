# Sonata design preview

Run `node server.mjs` from this directory, then visit http://127.0.0.1:4175.

Separate from the production site. Includes a landing page, the current bot command catalog, and a sample server dashboard. Settings stay in isolated in-memory databases and reset when the preview server restarts. No Discord authentication, server mutations, production credentials, or analytics are used.

Use the two color swatches to compare the visual treatment. No production files are replaced by this preview.

The reference expands all current command forms with behavior, source/format restrictions, permissions, runtime limits, arguments and prefix/slash examples. Data comes from the real command schema plus `bot/commandReference.mjs`, which records runtime restrictions that do not fit Discord's short command descriptions. Run `node --test service/design-preview/reference.test.mjs` from the Sonata root to check coverage and parse every example without executing any Discord action.

The Guides, Status, Command setup and Owner screens use the production UI modules. Owner tools and command forms call the real local service/bot handlers with a mock Discord API, not live servers. The local session identity endpoint is served only on 127.0.0.1:4175 and never included in production. A browser reload restores the local sample owner session if you revoked it. All owner-only additions stay out of the public plugin changelog.
