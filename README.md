# [<img src="./browser/icon.png" width="40" align="left" alt="Equicord">](https://github.com/Equicord/Equicord) Illegalcord

Illegalcord is a fork of [Equicord](https://github.com/Equicord) & [Vencord](https://github.com/Vendicated/Vencord), with over 300+ plugins.
An open‑source client built for those who believe in absolute freedom of development.
No restrictions, no censorship — every plugin is welcome, every idea can take shape.
Illegalcord doesn’t enforce arbitrary rules; it puts the community and experimentation at the center.
If you’re here, it means you want to create without limits — and this is the right place to do it.

Telegram x News: https://t.me/Illegalcord

### Included Plugins

Our included plugins can be found [here](https://equicord.org/plugins).

### Added Plugins on Illegalcord
<details>
<summary>Click to see the plugins added to Illegalcord</summary>

- **Nitro Sniper**: | (https://github.com/neoarz/NitroSniper/tree/main)
- **FakeMuteAndDeafen**
- **BetterMic**
- **BetterScreenshare**
- **BigFileUpload**
- **Stalker**: | (https://github.com/Reycko/EquicordPlugins/tree/main/stalker) With a modded version by me
- **BadgeSelector** | (https://github.com/002-sans/VencordPlugins/tree/b8c7c98a50c0700f7389b0484e5659fe5ec0f99e/BadgesSelector)
- **Securecord** | (AES 256 on messages)
- **Securecord Opossum Blazing Edition** | BlazingOpossum, block size + IV + MAC Tag 128 bits, key 256 bits. Based on AVX2 instructions, highly-performant, post-quantum symmetric cryptographic algorithm. Advanced, and modern.  | https://github.com/ZygoteCode/BlazingOpossum)
- **IGP** ( pgp plugin )
- **Mullvad DNS Over Discord** (Privacy & Security)
- **DisableAnimations**
- **BoosterCount**
- **NoMirroredCam**
- **OpenOptimizer**
- **Vcjumkoptimizer**
- **2FA Hider**
- **Follow User** (Without friends check)
- **DontLimitMe**
- **GateawayLogger**
- **InviteDefaults**
- **CustomStream** (https://github.com/MrTopQ/customStream-Vencord)
- **TypingFriends** (https://github.com/debxylen/Vencord/tree/main/src/plugins/typingFriends)
- SilentDelete (https://github.com/aurickk/SilentDelete-Vencord) 
- **VencordPerf**
- **Hisako's Optimizations** (Currently glitchy)
- **StereoSound** (Testing)
- **RipcordStereo** (Testing)
- **ShowPing** (https://github.com/nicola02nb/showPing)
- **FakeProfile** (https://github.com/gujarathisampath/fakeProfile)

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

Thank you to [thororen1234](https://github.com/thororen1234) For Creating [Equicord](https://github.com/Equicord) & [Vendicated](https://github.com/Vendicated) for creating [Vencord](https://github.com/Vendicated/Vencord) & [Suncord](https://github.com/verticalsync/Suncord) by [verticalsync](https://github.com/verticalsync) 

## Disclaimer

Discord is trademark of Discord Inc., and solely mentioned for the sake of descriptivity.
Mentioning it does not imply any affiliation with or endorsement by Discord Inc.
Vencord is not connected to Equicord and as such, all donation links go to Vendicated's donation link.

<details>
<summary>Using Illegalcord violates Discord's terms of service</summary>

Client modifications are against Discord’s Terms of Service.

However, Discord is pretty indifferent about them and there are no known cases of users getting banned for using client mods! So you should generally be fine if you don’t use plugins that implement abusive behaviour. But no worries, all inbuilt plugins are safe to use!

Regardless, if your account is essential to you and getting disabled would be a disaster for you, you should probably not use any client mods (not exclusive to Equicord), just to be safe.

Additionally, make sure not to post screenshots with Equicord in a server where you might get banned for it.

</details>
