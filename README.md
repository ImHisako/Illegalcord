# [<img src="./browser/icon.png" width="40" align="left" alt="Equicord">](https://github.com/Equicord/Equicord) Illegalcord

🌐 **Languages / Lingue:** [English](README.md) | [Italiano](README_IT.md)

Illegalcord is a fork of [Equicord](https://github.com/Equicord) & [Vencord](https://github.com/Vendicated/Vencord), with over 300+ plugins.
An open‑source client built for those who believe in absolute freedom of development.
We can consider this client a reliable alternative to Lightcord, since Illegalcord is a free, open-source project that supports stereo.
Don't u trust Lightcord? You are in the right place.
Do u want abuse Discord API's ? Want a Discord client with no rules? You're in the right place.
Want to chat privately on Discord? The "Securecord Opossum" plugin is ready for you.
Want to get Nitro codes to get free Nitro? We have a built-in plugin to get free Nitro: stop paying for Nitro starting now.

Telegram x News: https://t.me/Illegalcord

### Stereo Method
Download : https://github.com/ProdHallow/Discord-Stereo-Installer/blob/main/Stereo%20Installer.bat

### Included Plugins

Our included plugins can be found [here](https://equicord.org/plugins).

### Added Plugins on Illegalcord
<details>
<summary>Click to see the plugins added to Illegalcord</summary>

- **Surveillance**: Illegalcord's new top-rated plugin that lets you perform OSINT and conduct MASS SURVEILLANCE on people and Discord servers.
- **Kamidere Mutual Scanner**
- **kamidere PresenceLab**
- **Kamidere SendTrail**
- **WebCord Hardened**
- **StereoInstaller** More Methods!
- **Nitro Sniper**: | (https://github.com/neoarz/NitroSniper/tree/main)
- **FakeMuteAndDeafen**
- **BetterMic**
- **BetterScreenshare**
- **StaffDetector**
- **BigFileUpload**
- **Stalker**
- **FastGifPicker**
- **MassMention**
- **WebRTCLeakPrevent**
- **AutoModBypass**
- **Securecord** | (AES 256 on messages)
- **Securecord Opossum Blazing Edition** | BlazingOpossum, block size + IV + MAC Tag 128 bits, key 256 bits. Based on AVX2 instructions, highly-performant, post-quantum symmetric cryptographic algorithm. Advanced, and modern.  | https://github.com/ZygoteCode/BlazingOpossum)
- **GhostSelfbot** | Launch Ghost Selfbot (exe or source) with auto-setup, Python requirements installer, and token management | https://ghostt.cc/
- **IGP** ( pgp plugin )
- **Mullvad DNS Over Discord** (Privacy & Security)
- **CustomDNS**
- **DisableAnimations**
- **NoMirroredCam**
- **ServerCloner**
- **OpenOptimizer**
- **Vcjumkoptimizer**
- **2FA Hider**
- **Follow User** (Without friends check, Follow everyone without limits)
- **DontLimitMe**
- **GateawayLogger**
- **InviteDefaults**
- **OsintToolKit**
- **Hisako's Optimizations** (Currently glitchy)
- **BoosterCount** (https://github.com/Reathe/BoosterCount/tree/main)
- **BadgeSelector** | (https://github.com/002-sans/VencordPlugins/tree/b8c7c98a50c0700f7389b0484e5659fe5ec0f99e/BadgesSelector)
- **CustomStream** | (https://github.com/MrTopQ/customStream-Vencord)
- **TypingFriends** | (https://github.com/debxylen/Vencord/tree/main/src/plugins/typingFriends)
- **SilentDelete** | (https://github.com/aurickk/SilentDelete-Vencord)
- **embeddedURLs** | (https://github.com/ddadiani/Vencord-EmbeddedLinks/blob/main/src/plugins/embeddedURLs/index.ts)
- **GPU Binder** | (https://github.com/UnClide/vencord-gpubinder)
- **stereoScreenshareAudio** | (https://github.com/nerdwave-nick/Vencord-Stereo-Fix/blob/main/src/plugins/stereoScreenshareAudio/index.ts)
- **DiscordLock** | (https://github.com/vejcowski/DiscordLock/tree/main)
- **Opsec Plugin** | (https://github.com/ItzSolace/OpSec-Vencord/tree/main) | (We have a different version with italian support)
- **CrashHandlerEnhanched** | (https://github.com/Mifu999/Equicord-Userplugins/tree/main/userplugins/crashHandlerEnhanced)

</details>

Illegalcord has his personal badges btw

## Installing Illegalcord

### Dependencies

[Git](https://git-scm.com/download) and [Node.JS LTS](https://nodejs.dev/en/) are required.

Install `pnpm`:

> :exclamation: This next command may need to be run as admin/root depending on your system, and you may need to close and reopen your terminal for pnpm to be in your PATH.

```shell
npm i -g pnpm
```

> :exclamation: **IMPORTANT** Make sure you aren't using an admin/root terminal from here onwards. It **will** mess up your Discord/Illegalcord instance and you **will** most likely have to reinstall.

If you're using *BAT* to install the client and you're getting an error saying that script execution is disabled on your system, run the following command in PowerShell as an administrator :
```shell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
```

Clone Illegalcord:

```shell
git clone https://github.com/ImHisako/Illegalcord
cd Illegalcord
```

Install dependencies:

```shell
pnpm install --frozen-lockfile
```

Build Illegalcord:

```shell
pnpm build
```

Inject Illegalcord into your desktop client:

```shell
pnpm inject
```

Build Illegalcord for web:

```shell
pnpm buildWeb
```

After building Illegalcord's web extension, locate the appropriate ZIP file in the `dist` directory and follow your browser’s guide for installing custom extensions, if supported.

Note: Firefox extension zip requires Firefox for developers

## Credits

- [thororen1234](https://github.com/thororen1234) For Creating [Equicord](https://github.com/Equicord)
- [Vendicated](https://github.com/Vendicated) for creating [Vencord](https://github.com/Vendicated/Vencord)
- [verticalsync](https://github.com/verticalsync) for creating [Suncord](https://github.com/verticalsync/Suncord)
- [clrxxo ](https://github.com/clrxxo) for creating [Kamidere](https://github.com/clrxxo/Kamidere)

## Disclaimer

Discord is trademark of Discord Inc., and solely mentioned for the sake of descriptivity.
Mentioning it does not imply any affiliation with or endorsement by Discord Inc.
Vencord is not connected to Equicord & Illegalcord and as such.

<details>
<summary>Using Illegalcord violates Discord's terms of service</summary>

Client modifications are against Discord’s Terms of Service.

However, Discord is pretty indifferent about them and there are no known cases of users getting banned for using client mods! So you should generally be fine if you don’t use plugins that implement abusive behaviour.

Regardless, if your account is essential to you and getting disabled would be a disaster for you, you should probably not use any client mods (not exclusive to Equicord / Illegalcord), just to be safe.

Additionally, make sure not to post screenshots with Illegalcord in a server where you might get banned for it.

</details>
