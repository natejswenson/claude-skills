# apps

`appletv apps` lists what is actually installed on the TV, with bundle ids —
that list is the authority. This table is for turning what a person says into
a launch target before asking the TV, and for verifying a deep link: the
`DEEP_LINK_APPS` map in `scripts/lib/verify.mjs` mirrors the host column.

## Bundle ids

| App | Bundle id | Source |
|---|---|---|
| TV (Apple TV+) | `com.apple.TVWatchList` | Apple |
| Music | `com.apple.TVMusic` | Apple |
| Photos | `com.apple.TVPhotos` | Apple |
| Podcasts | `com.apple.podcasts` | Apple |
| Settings | `com.apple.TVSettings` | Apple |
| App Store | `com.apple.TVAppStore` | Apple |
| Search | `com.apple.TVSearch` | Apple |
| Arcade | `com.apple.Arcade` | Apple |
| Fitness | `com.apple.Fitness` | Apple |
| FaceTime | `com.apple.facetime` | Apple |
| Netflix | `com.netflix.Netflix` | pyatv docs |
| YouTube | `com.google.ios.youtube` | Roomie / HA community |
| Disney+ | `com.disney.disneyplus` | Roomie |
| Prime Video | `com.amazon.aiv.AIVApp` | Roomie / HA community |
| Hulu | `com.hulu.plus` | Roomie |
| Max (2023+ app) | `com.wbd.stream` | store analysis — confirm with `appletv apps` |
| HBO Max (legacy app) | `com.hbo.hbonow` | Roomie |
| Paramount+ | `com.cbsvideo.app` | Roomie |
| Peacock | `com.peacocktv.peacock` | Roomie |
| Plex | `com.plexapp.plex` | Roomie / HA community |
| Spotify | `com.spotify.client` | Roomie |
| VLC | `org.videolan.vlc-ios` | Roomie |

Apple's own list: support.apple.com › deployment › "Bundle IDs for native Apple TV apps".

## Deep links — open a title, not just the app

`send launch_app=<url>` needs Companion. Copy the link from the iOS app's
Share sheet; if it fails, strip the country code from the path.

**Netflix does not honour deep links on tvOS — none of `https://…/title/`,
`/watch/`, `nflx://` — since Sept 2025 (Home Assistant's maintained list marks
every form dead; eight attempts in this skill's first run were ignored, one
produced an "Open in Netflix?" dialog whose default button is Cancel).**
`play <netflix url>` refuses with `deep_link_unsupported`; use `open netflix`
and navigate with `screen`.

| Service | Link shape | Verified by |
|---|---|---|
| Netflix | — (see above) | — |
| Disney+ | `https://www.disneyplus.com/series/<slug>/<id>` | `com.disney.disneyplus` |
| Apple TV+ | `https://tv.apple.com/show/<slug>/umc.cmc.<id>` | `com.apple.TVWatchList` |
| Max | `https://play.max.com/...` / `https://play.hbomax.com/page/urn:hbo:page:...` | `com.wbd.stream` |
| YouTube | `https://www.youtube.com/watch?v=<id>` | `com.google.ios.youtube` |
| Spotify | `https://open.spotify.com/...` | `com.spotify.client` |

A deep link is **verifiable** (the foreground app is readable); a navigation
sequence to the same title is not. Always prefer the link.

## "Put on X"

1. `appletv apps <name>` — is it installed, and what is the id.
2. If the user named a title, ask for (or find) the link; else `launch_app=<id>`.
3. `send launch_app=…` → verdict on the app; then `state` for what is playing.
4. If the TV lands on the app's home rather than the title, say so — do not
   navigate blind through a keypress sequence and call it done.
