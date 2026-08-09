# VoiceBoard

Force Discord's soundboard through your mic: unlock without permission, play while deafened, boost send volume, optional local monitor, and browse every server's board.

## Features

- **Use soundboard without permission** - unlocks the soundboard button when Force mic playback is on, even if the channel lacks `USE_SOUNDBOARD`
- **Mic playback** - mixes the sound into your WebRTC mic so everyone in voice hears it
- **Works while muted** - still sends through the mic path when Discord would normally block speak
- **Allow while deafened** - open and play the soundboard while self-deafened (requires Force mic playback)
- **Show all servers** - list other guilds' soundboards in the picker, not only the current server / Discord defaults (requires Force mic playback)
- **Play locally** - hear the sound yourself while it goes out on the mic
- **Mic send boost** - raise outgoing loudness from `+0` to `+200` dB

Without **Force mic playback**, VoiceBoard does not bypass Discord. Normal soundboard permissions and behavior apply.

## Settings

Open the soundboard, then click the gear next to volume.

| Setting | Default | Notes |
| --- | --- | --- |
| Force mic playback | Off | Master switch for permission unlock, mic send, deafened use, and show all servers |
| Allow while deafened | On | Needs Force mic playback |
| Play locally | On | Local monitor while using mic playback |
| Show all servers | On | Needs Force mic playback; loads other guilds' boards into the left rail |
| Mic send boost | +0 dB | Extra gain on what others hear (`0`-`200`) |

## Installation

See the [Vencord docs for installing custom plugins](https://docs.vencord.dev/installing/custom-plugins/).

Rebuild with `pnpm build`, then restart Discord.
