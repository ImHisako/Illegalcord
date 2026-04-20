# RamCleaner

Monitor and automatically clean Discord's memory to reduce RAM usage.

## Features

- **Real-time Memory Monitoring**: Track Discord's RAM usage in real-time
- **Automatic Cleaning**: Clean memory when it exceeds your set limit
- **Customizable Limits**: Set maximum memory threshold (in MB)
- **Smart Cache Management**: Clean old messages, unused emojis, inactive guilds
- **Channel Switch Cleaning**: Auto-clean when switching channels
- **Memory Indicator**: Visual indicator showing current RAM usage (click to manually clean)
- **Aggressive Mode**: Deep cleaning for maximum memory reduction
- **Statistics**: Track how much memory has been cleaned

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Max Memory MB** | Maximum memory limit in MB. Auto-clean triggers when exceeded (0 = disabled) | 1024 |
| **Clean Interval** | How often to check and clean memory (seconds) | 60 |
| **Auto Clean on Channel Switch** | Clean memory when switching channels | true |
| **Aggressive Mode** | Deeper cleaning (may cause slight performance impact) | false |
| **Show Memory Indicator** | Display RAM usage in top-right corner | true |
| **Enable Notifications** | Show toast notification when memory is cleaned | false |
| **Clean Message Cache** | Remove old messages from cache | true |
| **Clean Emoji Cache** | Remove unused emoji cache | true |
| **Clean Image Cache** | Clear CDN image cache | true |
| **Clean Guild Cache** | Remove inactive server data | true |
| **Message Cache Age** | Remove messages older than X minutes | 30 |

## How It Works

1. **Monitoring**: Checks memory usage every X seconds (configurable)
2. **Threshold**: If memory exceeds your limit, triggers automatic cleanup
3. **Cleaning**: Purges old caches, unused data, and forces garbage collection
4. **Indicator**: Shows real-time memory usage (green/yellow/red based on usage)
5. **Manual Clean**: Click the indicator to manually trigger cleanup

## Memory Indicator Colors

- 🟢 **Green**: < 60% of heap limit (normal)
- 🟡 **Yellow**: 60-80% of heap limit (warning)
- 🔴 **Red**: > 80% of heap limit (critical)

## Tips

- Set `Max Memory MB` to 1024 for balanced performance
- Use `Aggressive Mode` if you need maximum memory reduction
- Enable `Auto Clean on Channel Switch` for continuous optimization
- The memory indicator is clickable - use it for manual cleanup
- Lower `Message Cache Age` if you want more aggressive message cleanup

## Note

This plugin cleans JavaScript heap memory managed by V8 engine. It cannot reduce:
- Electron/Chromium base memory (~400-600MB)
- GPU memory for rendering
- Native module memory
- Voice/WebRTC buffers

Expected reduction: 200-500MB depending on usage patterns.
