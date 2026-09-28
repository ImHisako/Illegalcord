# Contributing to Illegalcord

Illegalcord welcomes contributions from anyone: plugins, bug fixes, performance improvements, documentation, translations, and ideas. Start with the [Illegalcord documentation](https://illegalcord.mintlify.site/) and the [setup instructions](./README.md#installing-illegalcord-devbuild).

## Our philosophy

As explained on the [Illegalcord website](https://illegalcord.netlify.app/), this project is built around user freedom, experimentation, transparency, and control. Better audio, screen sharing, privacy tools, and diagnostics are all part of that direction.

We do not impose arbitrary rules about which ideas contributors are allowed to explore. A feature does not need mass appeal, acceptance by another client, or a place in an upstream roadmap to deserve consideration. Niche plugins and experimental features are welcome. Rejection by Vencord or Equicord is not, by itself, a reason for rejection here.

Vencord, Equicord, and their contributors deserve credit for the foundation. Illegalcord makes its own decisions about what to build on it. You are free to name other clients, compare features, question decisions, and discuss alternatives respectfully.

## AI is a development tool

AI assistance is welcome for code, debugging, tests, documentation, translations, pull request descriptions, and communication. There is no requirement that a contribution be majority human written, and using AI is not grounds for rejection or a ban.

We review the submitted work on its merits. What matters is whether you understand it, review it, verify its behavior, and can address feedback. Check generated code and factual claims, describe the testing you actually performed, and explain any limitations. The same expectations apply regardless of the tools used.

## Submitting a contribution

1. Check existing issues and pull requests for related work.
2. Fork [Illegalcord](https://github.com/ImHisako/Illegalcord), create a branch, and keep your change focused on the problem you want to solve.
3. Build and check the affected functionality. Include reproduction steps for fixes and explain how to try new features.
4. Open a pull request against Illegalcord's default branch. Describe the problem, the resulting behavior, and the checks you ran.
5. Respond to review feedback and update your contribution as needed.

For a large change, opening an issue first can help agree on the approach and avoid duplicate work. Prior approval or membership in a Discord server is not required to submit an idea or pull request.

## Plugins and technical quality

We generally prefer to leave plugins inherited from Equicord and Vencord unchanged. Local modifications can conflict with future upstream updates or introduce incompatibilities, creating extra work to merge, test, and maintain them. This is a preference, not a blanket ban: when a change is necessary, keep it small and explain why it is needed.

Explain what your plugin does, who it helps, and how its settings affect behavior. Document any external services, credentials, data storage, or information it sends outside the client so users can make informed choices.

Follow the repository's coding conventions and reuse existing APIs and components. Keep changes focused, clean up resources when a plugin stops, and justify new dependencies. These expectations help keep contributions understandable and maintainable.

For code changes, run the checks relevant to your work. Common checks include:

```sh
pnpm testTsc
pnpm lint
pnpm build
```

Use `pnpm buildWeb` when your change affects the web build. Test the actual feature in the supported client environment and state clearly if a platform or behavior could not be tested. Documentation changes do not require a client build.

Reviews should identify concrete concerns such as broken behavior, performance regressions, unclear data handling, or maintenance costs. Experimental status and a small audience are not automatic disqualifications. Openness to an idea does not guarantee that every implementation will be merged.

## Transparency and responsible use

The website emphasizes inspectable source code, clear risks, and informed user choice. Describe experimental behavior honestly and avoid unsupported promises about privacy, security, or stability. Follow the project's [disclaimer](./README.md#disclaimer) and [Privacy Policy](./PRIVACY_POLICY.md) when documenting sensitive features.

Illegalcord does not endorse malware, credential theft, harassment, or abuse. Research and proof of concept features should have a clear purpose and make their data handling and limitations understandable.

Keep existing attribution and license notices, credit reused work, and ensure you have permission to contribute it under the project's [license](./LICENSE).

## Community

Constructive criticism and comparisons with other clients are welcome. Treat contributors and users with respect, in line with the [Code of Conduct](./CODE_OF_CONDUCT.md).

Use this repository's issues and pull requests for development discussions. Follow [Illegalcord on Telegram](https://t.me/Illegalcord) for project news and updates.
