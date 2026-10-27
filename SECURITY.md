# Security and abuse reporting

Use the private contacts below to report vulnerabilities, suspected malicious code or downloads, exposed credentials, privacy violations, or abusive uses of Illegalcord. Reports in English or Italian are welcome.

## Private contacts

- Email: [illegalcord@secria.me](mailto:illegalcord@secria.me).
- Telegram: [@benedicence](https://t.me/benedicence).

Send sensitive reports directly to these contacts. Do not publish them in public issues, pull requests, Telegram groups, or support channels. Never send live tokens, passwords, API keys, webhook credentials, private message archives, or unredacted personal data. If a credential has been exposed, revoke or rotate it through the relevant provider.

## What to include

- The affected Illegalcord version or commit, operating system, client type, plugin, and relevant settings.
- A description of the vulnerability or abuse, its impact, and the affected code or download URL.
- Minimal reproduction steps using accounts, systems, and data you own or are authorized to test. Do not attack other users or services to demonstrate a problem.
- Redacted logs, screenshots, or a minimal example containing synthetic data where possible.
- For a suspicious download, its origin, version, download date, and file hash if available. Do not run a suspected malicious file to prepare a report.

For abuse reports, provide the minimum evidence needed to identify the affected content or conduct. Avoid forwarding another person's private information or an executable as an initial attachment; describe the evidence first so a suitable way to share it can be agreed.

## Assessment and mitigation

Maintainers assess reports and may request clarification. Depending on the findings, mitigation can include fixing code, disabling affected features or downloads, correcting documentation, or removing harmful hosted content. Response and resolution times depend on maintainer availability and the scope of the problem; no fixed deadline is guaranteed.

Please coordinate public disclosure while a vulnerability is being assessed and addressed. Published fixes or advisories should omit credentials and unnecessary personal data. Reporting here does not prevent you from reporting abuse directly to GitHub, another affected provider, or the appropriate authorities.

## Scope and external components

Include issues affecting the current source, distributed builds, and integrations that download or launch external software. Reports about older versions are also useful when the problem may remain in current versions; including them does not imply that every older release is supported.

Some plugins include compiled native modules or obtain programs from independent projects. Their behavior and source correspondence require separate review. Report a suspected problem with the Illegalcord integration here and, where appropriate, notify the upstream provider through its own security contact. Do not assume an external executable is safe because the integration source is public.

## Responsible use

Illegalcord is intended for customization, interoperability, privacy experimentation, education, and authorized research. The project does not endorse malware distribution, unlawful attacks, credential theft, spam, harassment, doxxing, or unauthorized monitoring. The experimental PoC designation and disclaimers do not authorize abuse, replace technical safeguards, or guarantee compliance with a hosting provider's policies.

See the [README](README.md#disclaimer), [Italian README](README_IT.md#dichiarazione-di-non-responsabilità), and [Privacy Policy](PRIVACY_POLICY.md) for feature-specific risks and data handling. GitHub's [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) and [Active Malware or Exploits policy](https://docs.github.com/en/site-policy/acceptable-use-policies/github-active-malware-or-exploits) apply to content hosted on GitHub.
