# GPU Binder for Vencord

> Automatically binds Discord to your selected GPU preference and re-applies it after updates.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 📌 Overview

**GPU Binder** is a Vencord plugin that forces Discord to use a specific GPU preference:

- 🚀 High Performance (Discrete GPU)
- 🔋 Power Saving (Integrated GPU)
- ⚙️ System Default (Let Windows decide)

Discord updates change the installation folder path (e.g., app-1.0.x), causing Windows to treat it as a new application and lose your previously assigned GPU preferences. This plugin automatically detects the new path and re-links your settings.

> ⚠️ **Warning**
>
> This plugin modifies the Windows Registry (`HKCU`).
> It overrides any GPU preference set manually via:
>
> `Windows → System → Display → Graphics → Discord`

---

## 🖥 Requirements

- Windows 10 or Windows 11
- Vencord installed **from source** (locally built)
- `pnpm` installed

> Installer builds of Vencord are not supported.

---

## 📦 Installation

### 1️⃣ Navigate to your Vencord source directory

```bash
cd path/to/Vencord/src
```

### 2️⃣ Open the `illegalcordplugins` folder

```bash
mkdir -p illegalcordplugins
```

### 3️⃣ Clone this repository

```bash
cd illegalcordplugins
git clone https://github.com/UnClide/vencord-gpubinder gpuBinder
```

### 4️⃣ Build Vencord

```bash
cd ../..
pnpm build
```

### 5️⃣ Restart Vencord

- Press `Ctrl + R`
- Or use: **Vencord → Restart Client**

---

## ⚙️ Usage

1. Open **User Settings**
2. Navigate to **Vencord → Plugins**
3. Find **GpuBinder**
4. Select your preferred GPU mode
5. Restart Discord to ensure changes take effect

That’s it. Your preference will now persist even after updates.

---

## 🔧 How It Works

The plugin:
- Detects the current `Discord.exe` path automatically on every startup.
- Edits the registry key: `HKEY_CURRENT_USER\Software\Microsoft\DirectX\UserGpuPreferences`.
- **Automatic Cleanup:** Scans for and removes stale registry entries from previous Discord versions (e.g., old `app-1.0.xxxx` folders) to keep your registry clean.
- Re-applies your preferred setting if a Discord update changes the executable path.

No background services.  
No telemetry.  
No scheduled tasks.

## 🛠 Troubleshooting

- **Settings not applying?** Make sure to **fully quit** Discord (from the system tray) and restart it. A simple `Ctrl + R` is not enough for native registry changes to take effect.

---

## ❗ Important Notes

- ✅ Works only on Windows
- ❌ Not compatible with non-source Vencord installs
- 🔄 Overrides Windows Graphics Settings for Discord
- 🛠 Registry access is limited to `HKCU` (current user only)

---

## 🛡 License

This project is licensed under the **MIT License**.

See the [LICENSE](LICENSE) file for details.
