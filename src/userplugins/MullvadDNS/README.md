# MullvadDNSCord Plugin

A Discord client mod plugin that forces Discord to use Mullvad VPN DNS servers for enhanced privacy and security.

## Features

- 🔒 **Privacy Protection**: Routes Discord traffic through Mullvad DNS servers
- 🚀 **Automatic**: Starts automatically when Discord loads
- 📊 **Monitoring**: Shows DNS resolution logs in console
- ⚙️ **Configurable**: Toggle different network interception methods
- 📱 **Notifications**: Visual feedback when DNS resolution occurs

## How It Works

This plugin intercepts network requests to Discord domains and redirects them through known Mullvad VPN IP addresses, bypassing your ISP's DNS and providing enhanced privacy.

### Covered Domains:
- `discord.com` → `162.159.137.233`
- `gateway.discord.gg` → `162.159.135.233`
- `media.discordapp.net` → `152.67.79.60`
- `cdn.discordapp.com` → `152.67.72.12`
- And more...

## Installation

1. Place the `main.tsx` file in your Vencord/Illegalcord userplugins directory
2. Restart Discord
3. The plugin will auto-start and begin protecting your DNS queries

## Usage

The plugin runs automatically in the background. You can monitor its activity through:

- **Console Logs**: Press F12 → Console tab
- **Network Tab**: Press F12 → Network tab to see redirected requests
- **Toast Notifications**: Visual notifications when major DNS resolutions occur

## API Access

The plugin exposes a global API for advanced usage:

```javascript
// Check if active
MullvadDNSCord.isActive()

// Manual control
MullvadDNSCord.start()
MullvadDNSCord.stop()

// View DNS table
MullvadDNSCord.getDNSTable()

// Cache management
MullvadDNSCord.getCacheStats()
MullvadDNSCord.clearCache()

// Custom records
MullvadDNSCord.addCustomRecord('example.com', '1.2.3.4')
MullvadDNSCord.removeCustomRecord('example.com')
```

## Requirements

- Vencord, Illegalcord, or compatible Discord client mod
- Working internet connection

## Privacy Notice

This plugin enhances your privacy by routing Discord traffic through Mullvad infrastructure, but it does not provide a full VPN service. For complete protection, use with an actual Mullvad VPN connection.

## Troubleshooting

If you experience issues:

1. Check console for error messages (F12 → Console)
2. Try disabling other network-modifying plugins
3. Restart Discord completely
4. Clear browser cache if using web version

## Credits

Created by Irritably for the Discord modding community.
Based on Mullvad VPN's public DNS infrastructure.