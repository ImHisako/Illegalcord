# Illegalcord Privacy Notice

Illegalcord is open-source client software rather than a single hosted service. This notice explains the data handling that can occur in the client and its bundled plugins. It does not replace the privacy notices of Discord or any independent service contacted by a plugin.

## Data collection by the Illegalcord project

The repository code reviewed for this notice does not implement a mandatory Illegalcord-operated account system, installation registry, or analytics service that reports who has installed or is using the client. Merely installing, opening, or using the local client does not give the Illegalcord maintainers a list of its users, their Discord accounts, or their activity, and the project does not receive the Discord token through an Illegalcord-controlled server.

This does not mean that every network interaction is anonymous or local. Discord, GitHub, websites, update or download hosts, and services contacted by optional plugins can receive ordinary connection information such as an IP address and request metadata under their own policies. The maintainers can also become aware of a person when that person voluntarily contacts support, posts in a project community, submits a report, contributes code, or uses a separately identified service controlled by a maintainer. Illegalcord therefore does not claim that it is technically impossible to infer that a particular person uses the client in every circumstance; it states that the client code does not maintain or transmit a mandatory user roster or project analytics identifier.

## Data the client may process

Depending on the enabled plugins and settings, Illegalcord may process:

- Discord account, user, server, channel, message, presence, voice, relationship, and other data already available to the Discord client;
- plugin settings, Discord identifiers, local activity or message logs, crash reports, and optional message previews stored on the user's device;
- files, search terms, Discord identifiers, request metadata, webhook payloads, and other content deliberately submitted to third-party services;
- sensitive secrets supplied by the user or exposed to a feature, such as Discord tokens, API keys, webhook URLs, or service credentials.

Not every plugin performs every operation. Processing depends on which features the user enables and invokes. Disabling or uninstalling a plugin may not automatically delete files or settings that it previously stored locally.

## Discord and independent third parties

The client necessarily interacts with Discord, whose processing is governed by the [Discord Privacy Policy](https://discord.com/privacy) and applicable terms.

Optional plugins can also contact independent services. For example, OSINTToolkit sends queries to CordCat and Breach.vip. A query may reveal the searched Discord ID or other search term, the user's IP address, timestamps, endpoint information, and other technical metadata. CordCat states that it retains lookup data and search history and queries sources that include a private breach-data aggregator; consult the current [CordCat Privacy Policy](https://cord.cat/privacy/) and [CordCat Terms](https://cord.cat/terms/) before use.

Other plugins may use file-hosting or upload providers, webhooks, CAPTCHA services, content or reputation databases, update servers, or other APIs selected by the plugin or user. Each provider independently determines what it receives, why it processes the data, how long it keeps it, and how data-protection rights can be exercised. Illegalcord does not control these providers, certify their legal compliance or data provenance, or have the ability to access or erase data held by them.

## User responsibilities and lawful use

Users must review a plugin and every relevant third-party notice before enabling it. When using Illegalcord to process another person's personal data, the user is responsible for determining their role and obligations under applicable law, including whether a lawful basis, notice, consent, authorization, data-protection impact assessment, contract, or other safeguard is required.

Users must limit processing to a specific lawful purpose, minimize the data collected or transmitted, verify accuracy, restrict access, use proportionate retention periods, and securely delete data when no longer needed. Publicly accessible information and OSINT or breach results remain capable of being personal data. Do not process data about minors, special-category data, credentials, private communications, or breach records unless doing so is strictly necessary, legally permitted, and appropriately protected. Do not use unverified results as the sole basis for decisions that significantly affect a person.

Illegalcord and third-party services must not be used for unauthorized access or interception, credential theft or sharing, stalking, harassment, doxxing, unlawful profiling, discrimination, fraud, spam, safety or age-control evasion, or any other illegal or abusive activity.

## Local storage, retention, and deletion

Local settings, logs, message previews, downloaded files, exported reports, and credentials remain on the user's device until removed through the relevant plugin controls or deleted from the applicable data directory. Users should disable unnecessary logging, avoid message previews unless required, protect local files from unauthorized access, define a short retention period, and securely delete data when its purpose ends.

Data sent to Discord or another provider is retained under that provider's policy. Requests to access, rectify, object to, restrict, or erase such data must normally be directed to the provider that holds it. Removing Illegalcord does not cause an independent provider to erase its records.

## Credentials and security

Discord tokens, API keys, webhook URLs, and similar values are high-risk secrets. Never enter another person's credentials, publish them, include them in bug reports, or share configuration and log files that contain them. A feature that stores or transmits the user's own credentials still creates account and security risk and may violate a provider's terms.

The following bundled plugins currently interact with, or can affect the exposure of, the Discord account token:

- **GhostSelfbot** (only when its token auto-fill option is enabled) reads the current token and writes it to Ghost configuration and token files so the separately launched selfbot can authenticate;
- **ClanSwitcher** reads the current token in memory and places it in the authorization header of direct Discord API requests used to change the active clan;
- **BoosterCount/showBoostCounts** reads the current token in memory and places it in a direct Discord request used to retrieve guild booster information;
- **NoDevtoolsWarning** does not retrieve or transmit the token itself, but prevents Discord from applying a developer-console callback that hides the token, which can increase accidental exposure risk.

For **GhostSelfbot specifically**, token extraction, the renderer-to-native handoff, and configuration-file writing are performed locally on the user's computer. Auto-fill is disabled by default. When enabled and the Ghost configuration exists, the Illegalcord integration writes the token to `%APPDATA%\Ghost\config.json`; if `%APPDATA%\Ghost\data\sensitive\tokens.json` also exists, it updates the matching local entry there. The integration code contains no request that uploads the token to an Illegalcord-controlled server or to an unrelated analytics service. Illegalcord's maintainers do not receive the token through this feature.

The token cannot accurately be described as never leaving the computer under all circumstances. After launch, the separately downloaded Ghost program reads the local configuration and necessarily uses the credential to authenticate the account with Discord over the network. Ghost can also be configured with webhook URLs, and its executable or source code is obtained from the independent [`ghostselfbot/ghost` GitHub project](https://github.com/ghostselfbot/ghost). Those network operations and the behavior of the downloaded Ghost version are outside the Illegalcord integration's local file-writing step and must be reviewed separately. Illegalcord does not warrant that current or future third-party Ghost releases never transmit information beyond what is necessary for Discord authentication. Users who do not accept that risk must leave token auto-fill disabled and must not launch Ghost.

Other plugins use credentials belonging to independent services rather than the Discord account token. Examples include upload-provider tokens used by FileUpload, an Anon.li API key used by Anon.li Drop, a Yandex Music OAuth token used by YMusicSync, and service-specific credentials used by integrations such as NitroSniper, ReviewDB, Decor, SongSpotlight, Streaks, ThemeLibrary, and TriviaAI. These values may be stored locally and transmitted to their respective providers for authentication. The distinction does not make them harmless: compromise can expose the associated service account, data, quota, or paid resources. This list reflects the code at the time of writing and should be reviewed whenever integrations change.

No software or transmission method can guarantee absolute security. Users should inspect the source, enable only features they trust, keep the client and operating system updated, and promptly revoke any credential that may have been exposed.

## Accuracy and changes

Third-party OSINT, breach, reputation, and profile data may be incomplete, outdated, incorrectly attributed, or unlawfully sourced. Illegalcord makes no representation that such data or a provider's processing complies with the GDPR or any other law.

This notice may be updated as plugins and external integrations change. Legal or privacy questions about a third-party service should be addressed directly to that service. Do not post personal data, credentials, or private communications in a public issue or support channel.
