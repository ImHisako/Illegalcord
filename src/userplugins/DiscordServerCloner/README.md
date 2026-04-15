# Server Cloner

A powerful Vencord plugin that allows you to clone Discord servers with all their channels, roles, permissions, and community features.

![Version](https://img.shields.io/badge/version-2.0.1-5865F2?style=for-the-badge)
![License](https://img.shields.io/badge/license-GPL--3.0-43b581?style=for-the-badge)
![Downloads](https://img.shields.io/github/downloads/BlockTol/Discord-Server-Cloner/total?style=for-the-badge&color=orange)
[![Discord](https://img.shields.io/badge/Discord-Join_Server-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/VyQQKxhuTC)

---

## Features

| Feature | Description |
|---------|-------------|
|  **Channel Cloning** | Clones all channels including categories, text, voice, and stage channels |
|  **Role Cloning** | Copies all roles with their colors, permissions, and hierarchy |
|  **Permission Sync** | Preserves channel permission overwrites for roles |
|  **Community Features** | Automatically enables community features if the source server has them |
|  **Live Progress** | Real-time progress bar and notifications during cloning |
|  **Update Checker** | Automatic update notifications when new versions are available |

---
### Included
- Server name, icon, banner, and splash
- All roles with colors, icons, and permissions
- All channel categories
- Text channels with topics, slowmode, and NSFW settings
- Voice channels with bitrate and user limits
- Stage channels
- Forum channels with tags, layouts, and default reactions
- Channel permission overwrites
- Community features (rules channel, updates channel)
- Server description
- **Onboarding Settings** (prompts, options, roles, default channels)
- **Smart Emoji Extractor**: Automatically detects, downloads, and maps any custom emojis used in the Server Description, Roles, Channels, and Onboarding settings.
- Clone to existing server (with overwrite confirmation, or "Resume" mode)

### Not Included
- Messages and message history
- Members and their individual assigned roles
- Threads
- Unused Emojis (To save rate limits, emojis not used in the server's configuration are ignored)
- Stickers & Soundboard sounds
- Webhooks
- Integrations / Bots
- Bans

---

## Important Notes

1. **Rate limits** may slow down the process for large servers

---

##  Update System

The plugin automatically checks for updates on startup. When a new version is available:

1. A modal appears showing the new version and release notes
2. Click **"Update Now"** to open the download page
3. Click **"Later"** to dismiss (won't show again for this version)

You can also manually check for updates in the plugin settings.

---

##  Author

**Block**
- GitHub: [@BlockTol](https://github.com/BlockTol)
---

##  License

This project is licensed under the **GPL-3.0 License** - see the [LICENSE](LICENSE) file for details.
