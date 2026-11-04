# Last.fm setup

Last.fm command support is implemented locally. Deployment requires the private `LASTFM_API_KEY` host secret. Supported public listening lookups: current/recent track, top artists and top tracks. Users can save their Last.fm username against their Discord account and remove that link later.

1. Sign in to Last.fm and open [Create an API account](https://www.last.fm/api/account/create).
2. Use **Sonata** as the application name, describe it as a Discord bot showing listening activity and music statistics, and use **https://sonatabot.info** as the application homepage.
3. Keep the resulting API key in private bot configuration as `LASTFM_API_KEY`. Do not paste it into chat, commit it, or include it in browser JavaScript. The bot reads this setting on startup; keep it in Cloudflare secret storage for the hosted build.

Public [recent/current track lookups](https://www.last.fm/api/show/user.getRecentTracks), [top artists](https://www.last.fm/api/show/user.getTopArtists) and [top tracks](https://www.last.fm/api/show/user.getTopTracks) use an application API key and a Last.fm username. They do not require a user authorization callback. We do not have a Last.fm callback route configured, so do not invent one for this first phase.

The implementation includes account linking/unlinking, current/recent-track lookup and period-based top artists/tracks, with bounded result pages, timeouts, caching and rate-limit handling. Results link to Last.fm and include attribution. Send live verification results only to the Sonata owner's DMs.

Writing scrobbles, loving tracks or changing a user's Last.fm data is a separate phase requiring [Last.fm user authentication](https://www.last.fm/api/authentication) and signed requests. A public username lookup must not be presented as proof that the Discord user owns that Last.fm account.
