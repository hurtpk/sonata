# Sonata voice companion

This optional Node service plays music for the Cloudflare bot. Cloudflare keeps the bot token, Gateway connection and moderation commands. This service receives only music jobs and temporary Discord voice connection events through a separate authenticated bridge. It has no access to the bot token or owner control endpoints. It uses the current `@discordjs/voice` DAVE implementation and FFmpeg's Opus encoder.

## Run on an Ubuntu server

1. Install Docker and Compose. Copy the files in this directory, excluding `.ssh`, `.env` and `node_modules`, to the server.
2. Copy `.env.example` to `.env`. Use the bot Worker's HTTPS URL and a new random `MUSIC_BRIDGE_SECRET` of at least 32 characters. Save that same key as the bot Worker's `MUSIC_BRIDGE_SECRET` secret. Never use the bot token or owner control key here.
3. Run `sudo docker compose up -d --build`. The container restarts after a crash or server restart. It needs outbound HTTPS, Discord voice WebSockets and UDP; it exposes no public listening port.
4. Confirm the bot's private status endpoint says `musicOnline: true`.
5. Join a normal voice channel, then run `,play SONG NAME` or `/play query:SONG NAME`. The bot needs View Channel, Connect and Speak. Existing server installations may need to authorize the updated invite permissions.

Commands: `play`, `pause`, `resume`, `skip`, `stop` (`leave`), `queue`, `nowplaying` (`np`), `volume`, `shuffle`, `remove`, `loop`, `seek`, `filter` and `voteskip`. All controls require the caller to be in the bot's voice channel. Playback controls follow the server’s open or DJ policy; listeners can always queue tracks, browse and vote to skip. The queue is kept in memory, has at most 50 upcoming tracks, and is cleared when the service restarts. An empty queue disconnects after two minutes. Song-name searches use SoundCloud. Public SoundCloud track links and YouTube video links are supported, with a two-hour limit per track. Volume and effect changes restart the stream at its current source position and preserve pauses. Effects are off, bassboost, nightcore and vaporwave; presets persist through the queue until the voice session ends. Nightcore runs at 1.25 times the source speed and vaporwave at 0.8. Fixed filter expressions and a limiter keep user input out of the encoder arguments. Queue shows the first eight upcoming tracks.

The default allows one concurrent server to play music, suitable for starting on a small free VM. `MAX_MUSIC_SESSIONS` accepts 1 to 3 after checking resource usage. Music jobs expire if the companion fails to confirm them. A request timeout can happen after a track started, so inspect the queue before repeating it. Music processing does not block the bot's moderation queue.

YouTube currently requires sign-in from this Oracle address, so use SoundCloud links or song-name searches on this deployment. Providers can restrict individual tracks or hosting addresses. No account cookies, DRM bypass or login-restricted content are supported. Rebuild periodically to update yt-dlp: `sudo docker compose build --no-cache && sudo docker compose up -d`. Check status with `sudo docker compose ps` and logs with `sudo docker compose logs --tail 30`. Logs exclude tokens, voice credentials, user commands and signed audio links.

Keep the private `.env` readable only by the server administrator. Keep the SSH private key on your own computer; this container never needs it. No paid Oracle upgrade is required by this service. Free VM availability and capacity remain controlled by the hosting provider.
