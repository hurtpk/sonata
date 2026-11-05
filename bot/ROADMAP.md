# Sonata Bot roadmap

## Deferred: music scaling

Requested November 4, 2026. Revisit after choosing a larger music host.

- Integrate Lavalink for audio playback, keeping independent server queues, existing music controls, uploaded audio support and DJ permissions. Keep the social video downloader available separately.
- Test playback, seeking, filters, uploads and concurrent sessions before replacing the current voice companion. Measure capacity instead of promising a server count from RAM alone.
- Add multiple audio nodes and assign each server's player to a node as demand grows.
- Add Discord Gateway sharding when the server count or event load warrants it. Route commands and voice events to the correct shard and preserve shared moderation history, configuration and scheduled jobs. Sharding does not itself add audio capacity.

These are future tasks, not implemented features. The existing companion remains the current playback backend.
