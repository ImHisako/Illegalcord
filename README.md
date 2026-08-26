# [<img src="./browser/Illegalcord.png" width="40" align="left" alt="Equicord">](https://github.com/Equicord/Equicord) Illegalcord

🌐 **Languages / Lingue:** [English](README.md) | [Italiano](README_IT.md)

Illegalcord is an open-source fork of [Equicord](https://github.com/Equicord) and [Vencord](https://github.com/Vendicated/Vencord), featuring more than 300 plugins. It is designed for users who value complete freedom in development, transparency, privacy, and customization.

Originally created as a personal project, Illegalcord gradually gained popularity as more people discovered and appreciated its ideas and features. The client aims to provide more private communication through the SecurecordOpossum plugin and allows users to overcome Discord's upload limits by using external services such as [anon.li](https://anon.li/).

If you are looking for a Discord client that offers greater privacy and more freedom in how you use it, Illegalcord may be the right choice for you. It also includes stereo audio support and provides better audio quality than Lightcord, with no hidden fees or closed-source components. The project is completely open source.

> [!WARNING]
> Illegalcord is sometimes labeled as malware simply because it does not enforce the same restrictions as other modified clients. Do not rely on assumptions: the project is fully open source, so you can inspect and verify the code yourself. If, after reviewing it, you consider it safe and suitable for your needs, you are free to install and use it.

Telegram and news: https://t.me/Illegalcord

Illegalcord website: https://illegalcord.netlify.app/

### Included Plugins

Our included plugins can be found [here](https://equicord.org/plugins).

### Added Plugins on Illegalcord
<details>
<summary>Click to see the plugins added to Illegalcord</summary>

- **Surveillance**: Experimental PoC dashboard for analyzing Discord events already visible to the user's client. Intended only for research, education, and authorized testing.
- **Kamidere Mutual Scanner**
- **kamidere PresenceLab**
- **Kamidere SendTrail**
- **DiscordHardened** True privacy experience on discord.
- **FloeP2PService** | Based on Floe.one service the best P2P file sharing service.
- **WebCord Hardened**
- **StereoInstaller** More Methods!
- **FakeMuteAndDeafen**
- **BetterMic**
- **BetterScreenshare**
- **StaffDetector**
- **Anon.li Drop** | Bypass Discord limits for sharing files + Security & Privacy minded https://anon.li/
- **BigFileUpload**
- **Stalker**
- **FastGifPicker**
- **MassMention**
- **WebRTCLeakPrevent**
- **MultiInstance**
- **IllegalcordAnnouncements**
- **ConsoleCleaner**
- **VoiceServerInfo**
- **Client Diagnostics**
- **AutoModBypass**
- **Securecord** | (AES 256 on messages)
- **Securecord Opossum Blazing Edition** | BlazingOpossum, block size + IV + MAC Tag 128 bits, key 256 bits. Based on AVX2 instructions, highly-performant, post-quantum symmetric cryptographic algorithm. Advanced, and modern.  | https://github.com/ZygoteCode/BlazingOpossum )
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
- **LarpCord**
- **Hisako's Optimizations**
- **ScreenshareAlert**
- **CrashHandlerEnhanched**
- **SilentDelete**
- **VoiceBoard** | ( https://github.com/aleeeh07/vc-voiceBoard )
- **SilentEdit** | ( https://github.com/aurickk/SilentEdit-Vencord )
- **BoosterCount** | ( https://github.com/Reathe/BoosterCount/tree/main )
- **Nitro Sniper**: | ( https://github.com/neoarz/NitroSniper/tree/main )
- **BadgeSelector** | ( https://github.com/002-sans/VencordPlugins/tree/b8c7c98a50c0700f7389b0484e5659fe5ec0f99e/BadgesSelector )
- **CustomStream** | ( https://github.com/MrTopQ/customStream-Vencord )
- **TypingFriends** | ( https://github.com/debxylen/Vencord/tree/main/src/plugins/typingFriends )
- **embeddedURLs** | ( https://github.com/ddadiani/Vencord-EmbeddedLinks/blob/main/src/plugins/embeddedURLs/index.ts )
- **GPU Binder** | ( https://github.com/UnClide/vencord-gpubinder )
- **stereoScreenshareAudio** | ( https://github.com/nerdwave-nick/Vencord-Stereo-Fix/blob/main/src/plugins/stereoScreenshareAudio/index.ts )
- **DiscordLock** | ( https://github.com/vejcowski/DiscordLock/tree/main )
- **Opsec Plugin** | ( https://github.com/ItzSolace/OpSec-Vencord/tree/main ) | ( We have a different version with italian support )
- **PluginStars** | ( https://github.com/Nightwielder23/discord-plugin-stars )
- **ServerBadges** | ( https://github.com/TomFront/ServerBadges )
- **SilentCall** | ( https://github.com/yahyepanna/Silent-call )
- **SpatialAudio** ( https://github.com/onewhobridges/vc-spatial-audio/tree/main )

</details>

Illegalcord has his personal badges btw

## Installing Illegalcord

- [X64 GUI](https://github.com/Equicord/Equilotl/releases/latest/download/Equilotl-darwin-x64.zip)
- [ARM64 GUI](https://github.com/Equicord/Equilotl/releases/latest/download/Equilotl-darwin-arm64.zip)

Linux

- [GUI](https://github.com/Equicord/Equilotl/releases/latest/download/Equilotl-x11)
- [CLI](https://github.com/Equicord/Equilotl/releases/latest/download/EquilotlCli-Linux)
- [AUR](https://aur.archlinux.org/packages?O=0&K=equicord)

```shell
bash -c "$(curl -sS https://raw.githubusercontent.com/Equicord/Equilotl/refs/heads/main/install.sh)"
```

## Installing Illegalcord Devbuild

### Dependencies

Installer : https://github.com/ImHisako/IllegalcordInstaller

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

- [thororen1234](https://github.com/thororen1234) For Creating [Equicord](https://github.com/Equicord)
- [Vendicated](https://github.com/Vendicated) for creating [Vencord](https://github.com/Vendicated/Vencord)
- [verticalsync](https://github.com/verticalsync) for creating [Suncord](https://github.com/verticalsync/Suncord)
- [clrxxo ](https://github.com/clrxxo) for creating [Kamidere](https://github.com/clrxxo/Kamidere)
- [Nightcord](https://nightcord.ru/) For the ideas and the foundation of some plugins.

## Special Thanks

We are proudly partnered with [Nightcord](https://nightcord.st/).
Their ideas, design choices, and pieces of their code have been directly integrated into the development philosophy of Illegalcord, influencing several plugins and features.
This partnership has been more than a name: it has been a concrete contribution to the direction and quality of this client.

## Disclaimer

Discord is a trademark of Discord Inc. and is mentioned solely for descriptive purposes.
Its mention does not imply any affiliation with or endorsement by Discord Inc.
Vencord is not affiliated with Equicord or Illegalcord.

### Legal Status, Project-Wide PoC, and Responsible Use

> [!IMPORTANT]
> **Illegalcord as a whole, including every bundled plugin and not only OSINTToolkit, Surveillance, and Stalker, is published as an experimental proof of concept (PoC).** Its intended purposes are research, education, interoperability, privacy, customization, and authorized security testing. The PoC label describes the project's intended scope; it is not a legal exemption and does not make every possible use lawful.

Illegalcord is not presented as malware or as software intended to facilitate crime. The project name and the presence of advanced or dual-use features do not, by themselves, determine the software's legal status. However, no maintainer can guarantee that the client, every plugin, or every use is lawful in every jurisdiction. Legality depends on the feature used, the user's conduct, authorization or consent, the data involved, local law, and platform rules. This section is general information, not legal advice.

Use Illegalcord only with accounts, systems, servers, communications, and data that you own or are explicitly authorized to access and analyze. Public availability of information does not automatically remove privacy or data-protection obligations. Illegalcord must not be used for unauthorized access or interception, credential or token acquisition or sharing, evasion of safety or age controls, spam, harassment, doxxing, stalking, unauthorized profiling or data collection, fraud, copyright infringement, or any other illegal or abusive activity.

#### Privacy, local storage, and third-party services

Illegalcord is client software, but it is not accurate to assume that every operation remains solely inside Discord or that no personal data is processed. Depending on the plugins and settings enabled, the client may read data already available to the Discord client, store settings, identifiers, logs, and optional message previews locally, or transmit identifiers, search terms, files, request metadata, webhook content, or other user-selected data to independent services. See the project [Privacy Policy](PRIVACY_POLICY.md) before enabling plugins that process or transmit data.

**OSINTToolkit interacts with independent third-party services, including CordCat and Breach.vip.** Requests can disclose the searched Discord identifier or other search term and technical request metadata such as the user's IP address. CordCat states that it retains lookup and request information under its own policy and may query a private breach-data aggregator. Other optional plugins may contact upload providers, webhook endpoints, CAPTCHA services, content databases, or other APIs. These providers operate under their own terms, privacy notices, security measures, and retention periods; Illegalcord does not control their processing and cannot delete data held by them.

Before sending personal data to any service, the user must identify a lawful and specific purpose, determine an appropriate legal basis, disclose the processing to affected people where required, minimize the submitted data, set a proportionate retention period, protect locally stored files, and respect rights of access, objection, rectification, and erasure. Do not submit data about minors, special-category data, credentials, private communications, or breach records unless the processing is strictly necessary, legally permitted, and appropriately protected. Public availability, an OSINT label, or a third party's privacy policy is not by itself proof that reuse is lawful. Do not make decisions that significantly affect a person solely from unverified OSINT or breach results. Review the [CordCat Privacy Policy](https://cord.cat/privacy/), [CordCat Terms](https://cord.cat/terms/), and the policies of every other service before use. Illegalcord does not certify their GDPR compliance or the accuracy, lawfulness, currency, or provenance of their data.

#### Sensitive plugins and criminal-use boundaries

Some bundled features are particularly sensitive, including OSINTToolkit, Surveillance, Stalker, GhostSelfbot, MassMention, AutoModBypass, NsfwGateBypass, message loggers, token-related tools, snipers, account automation, and similar plugins. Token-related cases include **GhostSelfbot** (optionally reads the current Discord account token and writes it to Ghost configuration and token files so the launched external selfbot can authenticate), **ClanSwitcher** (reads the current Discord token in memory to authorize direct Discord API requests that change the active clan), **BoosterCount/showBoostCounts** (reads the token in memory to request guild booster data directly from Discord), and **NoDevtoolsWarning** (does not itself retrieve or transmit the token, but disables Discord's console protection that hides it, making accidental exposure through developer tools more likely). They remain part of the project-wide experimental PoC, but that label does not authorize their use against other people or outside platform rules. They must remain disabled unless the user understands their operation and has the required authorization and lawful basis.

- Use monitoring and logging only on your own account or in an expressly authorized moderation, research, or security context. Collect only necessary events, avoid message previews unless essential, restrict access, define a short retention period, and securely delete exported logs when no longer needed. Never use them to follow, intimidate, profile, dox, or harass a person.
- Never obtain, import, use, export, publish, or transmit another person's token, password, session, API key, or webhook credential. Even your own Discord token is a high-risk secret: do not share it and do not enable a feature that writes it to a file unless you fully accept the security and account risks.
- Do not use selfbots or automation to spam, mass mention, scrape, evade rate limits, claim benefits unfairly, impersonate users, or bypass moderation, safety, age, access, or content controls. Authorization to test must come from the owner of the affected account or system and does not override Discord's rules.
- Do not treat data returned by OSINT or breach services as verified fact. Do not use it for stalking, credential attacks, discrimination, public accusations, or decisions affecting employment, access, reputation, safety, or legal rights.

Here, “token” does not always mean the Discord account token. FileUpload uses credentials for user-configured upload providers such as Zipline or Nest; Anon.li Drop uses an Anon.li API key; YMusicSync uses a Yandex Music OAuth token; and plugins such as NitroSniper, ReviewDB, Decor, SongSpotlight, Streaks, ThemeLibrary, or TriviaAI can use service-specific API, OAuth, or session tokens for their respective integrations. Those credentials do not provide access to the Discord account unless a service or plugin explicitly uses the Discord account token, but they must still be protected and may be transmitted to the named provider for authentication. This list describes the integrations present at the time of writing and must be rechecked when plugins change.

Criminal liability depends on the concrete conduct, intent, authorization, and surrounding facts; merely naming or including a dual-use feature does not by itself establish a crime. However, unauthorized entry into a protected system or remaining there against the right holder's will may fall under Article 615-ter of the Italian Criminal Code; unlawful procurement, possession, production, or distribution of access credentials for an illicit purpose may fall under Article 615-quater; fraudulent interception, prevention, or interruption of electronic communications may fall under Article 617-quater; and repeated threats or harassment producing the statutory consequences may fall under Article 612-bis. Use of one's own account or receipt of events normally delivered to one's own client is not automatically equivalent to these offences, but it may still breach contracts, privacy law, or other rules. Only the competent authorities and courts can determine whether a specific case satisfies an offence. The current consolidated text is available on [Normattiva](https://www.normattiva.it/eli/id/1930/10/26/030U1398/CONSOLIDATED).

Relevant official sources include:

- The [GNU GPL-3.0-or-later license](LICENSE), which governs copying, modification, and distribution of this project but does not authorize unlawful conduct.
- The [EU General Data Protection Regulation](https://eur-lex.europa.eu/eli/reg/2016/679/oj), especially Articles 4, 5, 6, 12-14, 25, and 32 on personal data, lawful processing, transparency, data minimization, privacy by design, and security.
- The Italian [Personal Data Protection Authority's guide to lawful processing](https://www.garanteprivacy.it/home/principi-fondamentali-del-trattamento).
- The Italian [Criminal Code on Normattiva](https://www.normattiva.it/eli/id/1930/10/26/030U1398/CONSOLIDATED), including, where applicable to the actual conduct, Articles 612-bis, 615-ter, 615-quater, and 617-quater concerning stalking, unauthorized system access, access credentials, and unlawful interception of electronic communications.
- [Discord's Terms of Service](https://discord.com/terms), [Platform Manipulation Policy](https://discord.com/safety/platform-manipulation-policy-explainer-oct-2023), and [official self-bot policy](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots).

Discord prohibits client modifications and automation of normal user accounts outside its bot API. This platform or contractual restriction is distinct from a criminal-law determination, but violations may still result in account suspension or termination. The maintainers and contributors do not endorse illegal use and cannot accept responsibility for misuse by third parties.

> [!WARNING]
> **The name Illegalcord does not make the client illegal by itself.** The word **"Illegal"** is only part of the project's name and does not determine the software's legal status.
> The name refers to the idea of a Discord client without the limitations and rules typically imposed by other modded clients, similar to the customization philosophy of Equicord and Vencord.
> However, using modified clients can still violate Discord's Terms of Service, so they should be used with caution.
> Illegal use falls outside the project's intended scope. Responsibility is determined by applicable law and cannot be excluded merely by this disclaimer.

<details>
<summary>Using Illegalcord violates Discord's terms of service</summary>

Client modifications are against Discord’s Terms of Service.

Discord expressly prohibits client modifications and self-bots. In practice, enforcement against ordinary, non-abusive client-mod use is generally considered uncommon, so most users regard the ban risk as low. It is not zero, however, and this project cannot guarantee that an account will remain unaffected. Plugins that automate accounts, spam, bypass safeguards, or otherwise enable abusive behavior carry a substantially higher risk.

Regardless, if your account is essential to you and getting disabled would be a disaster for you, you should probably not use any client mods (not exclusive to Equicord / Illegalcord), just to be safe.

Additionally, make sure not to post screenshots with Illegalcord in a server where you might get banned for it.

</details>
