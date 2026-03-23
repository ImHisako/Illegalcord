# WayAFKNext

A Vencord plugin that fixes auto AFK functionality on Linux Wayland desktops and adds some optional features:

- Disable AFK detection altogether if you wish. Peace of mind for some.
- Force mobile push notifications regardless of whether you're AFK or not
- Set mobile push notification timeout separately from Idle status timeout
- Set Idle status and mobile push notification timeouts up to 30 minutes

Inspired by [WayAFK](https://github.com/Colonial-Dev/WayAFK)'s goals and limitations.

It should be noted that this circumvents the Push Notification Inactive Time-out setting in Discord's notifications settings. All configuration should be done in Vencord > Plugins > WayAFKNext (Settings gear).

## Platform Support

- x86_64 / AMD64
- aarch64 / ARM64

## Installation

### Arch Linux AUR

A build of Vesktop with WayAFKNext included is available on the AUR under the package name [`vesktop-wayafknext-bin`](https://aur.archlinux.org/packages/vesktop-wayafknext-bin).

Simply use your AUR helper like so: `yay -S vesktop-wayafknext-bin`

Build automations for it are done here:

https://github.com/JamDon2/Vencord-WayAFKNext

Thanks to JamDon2 for doing this!

### Manual

Same as always with Vencord plugins.

https://docs.vencord.dev/installing/custom-plugins/

Use the [latest version from releases](https://github.com/MuffinTastic/WayAFKNext/releases).

File paths should look like `userplugins/WayAFKNext/index.tsx`, etc.

## How it works:

This downloads a pre-built binary (https://github.com/MuffinTastic/wayafknext-monitor) and verifies its authenticity with hashes.

The binary is nothing but a bridge between Discord and `wayland-protocols ext-idle-notify-v1` / `org.gnome.Mutter.IdleMonitor` using a UNIX socket. The plugin issues commands to start/stop watches with different durations. When the bridge informs the plugin the user has gone AFK or came back, the plugin calls Discord's existing AFK functionality.

I did it this way to avoid adding extra dependencies to Vencord, though realistically that wouldn't have hurt anything, and to avoid implementing all that stuff in nodejs to begin with. nodejs is yucky.

If you don't want to use the prebuilt binary, then *before building Vencord*, edit native.ts and change `downloadPrebuilt` to `false`, and compile your own version of wayafknext-monitor and place it where the plugin expects to find it.

Binary: `~/.config/Vencord/wayafknext/wayafknext-monitor.<x86_64/aarch64>`

Socket: `~/.config/Vencord/wayafknext/wayafknext.sock`
