# AlwaysPush

A Vencord plugin for desktop Discord clients that **forces mobile push notifications** to trigger **regardless of your online status**.

This is especially useful for:
- Linux users on **Wayland**, where Discord doesn't detect AFK status properly.
- Anyone who wants **instant push notifications** instead of waiting for Discord's lowest 1-minute idle timeout, regardless of platform.


## 🔧 What Problem Does It Solve?

Discord’s Linux client under Wayland does not correctly detect idle or AFK states. This causes push notifications **not to trigger on mobile**, even when you're away from your computer.

AlwaysPush fixes this by making Discord believe you're always eligible for mobile push notifications no matter what your status is on desktop.


## 📦 Installation

1. **Build Vencord from source**  
   Follow the official instructions:  
   [https://docs.vencord.dev/installing](https://docs.vencord.dev/installing)

2. **Add custom plugins**  
   Follow Vencord’s guide here:  
   [https://docs.vencord.dev/installing/custom-plugins/](https://docs.vencord.dev/installing/custom-plugins/)

3. **Install AlwaysPush**
   - Place the `AlwaysPush` plugin file into your `userplugins` folder as described in the docs.

4. **Inject Vencord into the official Discord client**
   - This step is required for the plugin to work properly on Wayland.
   - It should also work on **Vesktop** or **Discord's web version** if you always want mobile push notifications when using those too.

> [!NOTE]
> You may have to reinstall or reapply these steps if a Discord update removes Vencord.


## ❓ What About Vesktop?

Vesktop thankfully includes proper AFK tracking under Wayland, but:

- Vesktop relies on the web version of Discord, which has lower mic and audio quality
- Vesktop has no working tray icon indicator unlike the official Discord client
- Discord's (and so Vesktop's) lowest push notification timeout setting is 1 minuite and some users may want instant push notifications


## ⚠️ Disclaimer

By using this plugin, you agree to the following:

- While there is no reason to believe this plugin specifically will lead to a ban, and I’ve experienced no issues personally, I am **not responsible** for any disciplinary action taken against your Discord account, including bans or suspensions.
- Use this plugin at your own risk. At the end of the day Vencord and all plugins are technically against Discord's TOS, even if it has not resulted in any bans yet.
- Do not discuss Vencord or Vencord plugins in public Discord servers.
- This plugin is not officially supported by the Vencord developers. Do not bother them about it.


## License

This project is licensed under the [MIT License](LICENSE).
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
