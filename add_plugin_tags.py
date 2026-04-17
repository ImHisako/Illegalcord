import os
import re

# Tags mapping per ogni plugin basato sul nome e funzionalità
PLUGIN_TAGS = {
    "2FA HIder": ["Appearance", "Utility"],
    "BadgesSelector": ["Appearance", "Customisation", "Friends"],
    "betterMicrophone.desktop": ["Voice", "Customisation"],
    "betterScreenshare.desktop": ["Voice", "Customisation"],
    "bigFileUpload": ["Chat", "Utility"],
    "BoosterCount-main": ["Servers", "Appearance"],
    "CustomDNS": ["Privacy", "Utility"],
    "customStream": ["Voice", "Media"],
    "DecibelLimiter": ["Voice", "Utility"],
    "DiscordServerCloner": ["Servers", "Utility"],
    "dontLimitMe": ["Utility", "Chat"],
    "expandedWidgets": ["Chat", "Appearance"],
    "FakeMuteAndDeafen": ["Voice", "Privacy"],
    "FollowUser": ["Friends", "Utility"],
    "gatewayLogger": ["Developers", "Utility"],
    "IGP": ["Privacy", "Utility"],
    "inviteDefaults": ["Servers", "Utility"],
    "MullvadDNS": ["Privacy", "Utility"],
    "NitroSniper": ["Utility", "Chat"],
    "noMirroredCamera": ["Voice"],
    "NsfwGateBypass": ["Privacy", "Servers"],
    "OSINTToolkit": ["Utility", "Developers"],
    "philsPluginLibrary": ["Utility", "Voice"],
    "RipCord_Stereo": ["Voice", "Media"],
    "scamLinkDetector": ["Privacy", "Chat"],
    "Securecord": ["Privacy", "Chat"],
    "SecurecordOpossum": ["Privacy", "Chat"],
    "SilentDelete": ["Chat", "Privacy"],
    "StaffDetector": ["Servers", "Utility"],
    "stalker": ["Friends", "Utility"],
    "StereoCord": ["Voice", "Media"],
    "typingFriends": ["Friends", "Notifications"],
    "webRtcLeakPrevent": ["Privacy", "Voice"],
}


def add_tags_to_plugin(filepath, plugin_name):
    """Add tags array to plugin definition"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Check if tags already exist
    if re.search(r'tags:\s*\[', content):
        return False

    tags = PLUGIN_TAGS.get(plugin_name)
    if not tags:
        print(f"  ⚠ No tags mapping for {plugin_name}")
        return False

    tags_str = ', '.join(f'"{tag}"' for tag in tags)
    tags_line = f'    tags: [{tags_str}],'

    # Find the line with "authors:" and add tags after description or before authors
    # Pattern 1: After description
    pattern1 = r'(description:\s*"[^"]+",\n)'
    match1 = re.search(pattern1, content)

    if match1:
        # Insert after description
        insert_pos = match1.end()
        content = content[:insert_pos] + \
            tags_line + '\n' + content[insert_pos:]
    else:
        # Pattern 2: Before authors
        pattern2 = r'(\n)(\s*)(authors:)'
        match2 = re.search(pattern2, content)
        if match2:
            insert_pos = match2.start(1)
            content = content[:insert_pos] + '\n' + \
                tags_line + content[insert_pos:]
        else:
            print(f"  ⚠ Could not find insertion point for {plugin_name}")
            return False

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    return True


def main():
    base_dir = r'c:\Users\Hisako\Documents\Illegalcord\src\userplugins'

    fixed_count = 0
    for plugin_name in os.listdir(base_dir):
        plugin_dir = os.path.join(base_dir, plugin_name)
        if not os.path.isdir(plugin_dir):
            continue

        index_file = os.path.join(plugin_dir, 'index.tsx')
        if not os.path.exists(index_file):
            continue

        if add_tags_to_plugin(index_file, plugin_name):
            print(f"✓ Added tags to {plugin_name}")
            fixed_count += 1

    print(f"\nTotal plugins updated: {fixed_count}")


if __name__ == '__main__':
    main()
