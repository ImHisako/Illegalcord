/*
 * ServerBadges, a Vencord userplugin
 * Copyright (c) 2026 tomfront
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * ServerBadges — a Vencord userplugin
 *
 * Makes a server you OWN read as Verified and/or a Discord Partner, using
 * Discord's OWN native rendering — not a fake overlay icon.
 *
 * How it works:
 *   - It injects the "VERIFIED" / "PARTNERED" strings into the guild's client
 *     -side `features` set (GuildStore) AND into GuildProfileStore's separate
 *     per-guild `features` array. Discord's own code then draws the real badge in
 *     the header, the server-icon hover tooltip, the server-profile card and the
 *     invite embed — correct position, tooltip and styling.
 *   - For Partnered servers it injects the real "Partnered Server Owner" badge
 *     object into your profile's `badges` array, positioned right after Nitro to
 *     match Discord's native badge order.
 *
 * Everything is client-side and cosmetic — it only changes what YOU see on YOUR
 * client, and nothing is ever sent to Discord's servers.
 *
 * Because these are the real native badges, there are deliberately NO size /
 * icon / position options — it looks exactly like Discord's own.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { GuildStore, React, UserStore } from "@webpack/common";

// UserProfileStore.getUserProfile(id).badges  -> the profile badge row
// GuildProfileStore.getGuildProfile(id)       -> the "server profile" card
// InviteStore invites[code].guild/profile     -> the invite embed
const UserProfileStore = findStoreLazy("UserProfileStore");
const GuildProfileStore = findStoreLazy("GuildProfileStore");
const InviteStore = findStoreLazy("InviteStore");

type Override = "none" | "verified" | "partner" | "both";

const FEATURES_FOR: Record<Exclude<Override, "none">, string[]> = {
    verified: ["VERIFIED"],
    partner: ["PARTNERED"],
    both: ["VERIFIED", "PARTNERED"]
};

// The real Discord "Partnered Server Owner" profile badge object. Discord builds
// the icon URL from the `icon` hash, so this is the genuine badge; injecting it
// into the profile's own `badges` array lets us place it in its exact native slot.
const PARTNER_BADGE = {
    id: "partner",
    description: "Partnered Server Owner",
    icon: "3f9748e53446a137a052f3454e2de41e",
    link: "https://discord.com/partners"
} as const;

const OUR_MARK = "__vcServerBadges";

// ─── Owned-servers settings panel ────────────────────────────────────────────

const OVERRIDE_OPTIONS: { value: Override; label: string; }[] = [
    { value: "none", label: "None" },
    { value: "verified", label: "Verified" },
    { value: "partner", label: "Discord Partner" },
    { value: "both", label: "Verified & Partnered" }
];

function OwnedServersSetting() {
    const me = UserStore.getCurrentUser();
    const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

    const guilds = Object.values(GuildStore.getGuilds() as Record<string, any>)
        .filter(g => g?.ownerId === me?.id);

    function setOverride(id: string, value: Override) {
        const next: Record<string, Override> = { ...(settings.store.overrides ?? {}) };
        if (value === "none") delete next[id];
        else next[id] = value;
        settings.store.overrides = next;
        forceUpdate();
        sync(); // apply immediately (re-render happens when you next view the server)
    }

    if (!guilds.length)
        return <div style={{ color: "var(--text-muted)", padding: "8px 0" }}>You don't own any servers.</div>;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            <div style={{ color: "var(--header-secondary)", fontWeight: 600, fontSize: 12, textTransform: "uppercase" }}>
                Your servers
            </div>
            {guilds.map(g => {
                const current: Override = (settings.store.overrides ?? {})[g.id] ?? "none";
                return (
                    <div
                        key={g.id}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                            padding: "6px 8px",
                            background: "var(--background-secondary)",
                            borderRadius: 6
                        }}
                    >
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: "var(--text-normal)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {g.name}
                            </div>
                            <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{g.id}</div>
                        </div>
                        <select
                            value={current}
                            onChange={e => setOverride(g.id, e.currentTarget.value as Override)}
                            style={{
                                background: "var(--input-background)",
                                color: "var(--text-normal)",
                                border: "1px solid var(--border-subtle, transparent)",
                                borderRadius: 4,
                                padding: "4px 6px",
                                flex: "0 0 auto"
                            }}
                        >
                            {OVERRIDE_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    overrides: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, Override>
    },
    manageServers: {
        type: OptionType.COMPONENT,
        description: "Per-server badge (only servers you own are listed)",
        component: OwnedServersSetting
    },
    profileBadge: {
        type: OptionType.BOOLEAN,
        description: "Also give your profile the native 'Partnered Server Owner' badge when you own a Partnered server",
        default: true
    }
});

// ─── Native-data injection ────────────────────────────────────────────────────

// Track exactly which feature strings WE added to each guild, so we never
// remove a server's genuine features.
const injectedFeatures = new Map<string, Set<string>>();

function ownedOverriddenGuilds() {
    const me = UserStore.getCurrentUser();
    const guilds = GuildStore.getGuilds() as Record<string, any>;
    const overrides = settings.store.overrides ?? {};

    const result: { guild: any; features: string[]; }[] = [];
    for (const [id, ov] of Object.entries(overrides)) {
        if (ov === "none") continue;
        const guild = guilds[id];
        if (!guild || guild.ownerId !== me?.id) continue;
        result.push({ guild, features: FEATURES_FOR[ov] });
    }
    return result;
}

function ownsPartneredServer() {
    return ownedOverriddenGuilds().some(({ features }) => features.includes("PARTNERED"));
}

function syncGuildFeatures() {
    const wanted = new Map<string, { guild: any; features: Set<string>; }>();
    for (const { guild, features } of ownedOverriddenGuilds())
        wanted.set(guild.id, { guild, features: new Set(features) });

    // Remove features we previously injected that are no longer wanted.
    for (const [id, mine] of [...injectedFeatures]) {
        const want = wanted.get(id)?.features ?? new Set<string>();
        const guild = GuildStore.getGuild(id);
        for (const f of [...mine]) {
            if (!want.has(f)) {
                guild?.features?.delete?.(f);
                mine.delete(f);
            }
        }
        if (mine.size === 0) injectedFeatures.delete(id);
    }

    // Add wanted features, recording only the ones that weren't already there.
    for (const [id, { guild, features }] of wanted) {
        if (!guild?.features?.add) continue;
        let mine = injectedFeatures.get(id);
        for (const f of features) {
            if (!guild.features.has(f)) {
                guild.features.add(f);
                if (!mine) injectedFeatures.set(id, (mine = new Set()));
                mine.add(f);
            }
        }
    }
}

// Add feature strings to an object's plain-array `features`, replacing the array
// (rather than mutating) in case it's frozen.
function addArrayFeatures(obj: any, features: string[]) {
    if (!obj || !Array.isArray(obj.features)) return;
    const missing = features.filter(f => !obj.features.includes(f));
    if (missing.length) {
        try { obj.features = [...obj.features, ...missing]; } catch { /* not writable */ }
    }
}

// The "server profile" card (server-settings preview) reads GuildProfileStore,
// which has its OWN plain-array `features` — separate from the GuildStore record.
function syncGuildProfiles() {
    if (!GuildProfileStore?.getProfile) return;
    for (const { guild, features } of ownedOverriddenGuilds())
        addArrayFeatures(GuildProfileStore.getProfile(guild.id), features);
}

// The invite embed renders from resolved invites in InviteStore. Each invite has
// its own `guild` object (plain-array features) and a nested `profile` object.
function syncInvites() {
    if (!InviteStore) return;
    const owned = ownedOverriddenGuilds();
    if (!owned.length) return;

    const patch = (inv: any, features: string[]) => {
        addArrayFeatures(inv?.guild, features);
        addArrayFeatures(inv?.profile, features);
    };

    // Resolved invites (what the embed renders) are keyed by code — look up the
    // code for each owned guild.
    for (const { guild, features } of owned) {
        const code = InviteStore.getInviteKeyForGuildId?.(guild.id);
        if (code) patch(InviteStore.getInvite?.(code), features);
    }

    // Also sweep any other cached invites, just in case.
    const all = InviteStore.getInvites?.();
    if (all) {
        for (const inv of (Array.isArray(all) ? all : Object.values(all)) as any[]) {
            const match = owned.find(o => o.guild.id === inv?.guild?.id);
            if (match) patch(inv, match.features);
        }
    }
}

// The profile badge row is rendered from UserProfileStore.getUserProfile(id).badges.
// Discord freezes that array, so we REPLACE it (assign a new array) rather than
// mutate it, inserting the partner badge right after the Nitro/premium badges to
// match Discord's native order (Nitro → Partnered Server Owner → HypeSquad …).
function syncProfileBadge() {
    const me = UserStore.getCurrentUser();
    const profile = me && UserProfileStore?.getUserProfile?.(me.id);
    if (!profile || !Array.isArray(profile.badges)) return;

    const badges: any[] = profile.badges;
    const hasReal = badges.some(b => b?.id === PARTNER_BADGE.id && !b?.[OUR_MARK]);
    const hasOurs = badges.some(b => b?.[OUR_MARK]);
    const want = settings.store.profileBadge && ownsPartneredServer() && !hasReal;

    if (want && hasOurs) return;      // already added
    if (!want && !hasOurs) return;    // nothing to remove

    const cleaned = badges.filter(b => !b?.[OUR_MARK]);

    let next = cleaned;
    if (want) {
        // Insert after any leading Nitro/premium badges.
        let idx = 0;
        while (idx < cleaned.length && String(cleaned[idx]?.id).startsWith("premium")) idx++;
        next = [...cleaned.slice(0, idx), { ...PARTNER_BADGE, [OUR_MARK]: true }, ...cleaned.slice(idx)];
    }

    try { profile.badges = next; } catch { /* badges not writable in this build */ }
}

function sync() {
    syncGuildFeatures();
    syncGuildProfiles();
    syncInvites();
    syncProfileBadge();
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "ServerBadges",
    description: "Make servers you own read as natively Verified/Partnered (real header + tooltip badges), plus the real Partnered Server Owner badge on your profile.",
    authors: [{ name: "tomfront", id: 175656408459640832n }],
    settings,

    start() {
        sync();
        // Re-apply whenever any of the relevant data is (re)loaded or updated, so
        // late-loading guilds/profiles still get patched. We mutate/replace objects
        // directly (no dispatch), so this can't loop back into these listeners.
        GuildStore.addChangeListener(sync);
        UserStore.addChangeListener(sync);
        UserProfileStore?.addChangeListener?.(sync);
        GuildProfileStore?.addChangeListener?.(sync);
        InviteStore?.addChangeListener?.(sync);
    },

    stop() {
        GuildStore.removeChangeListener(sync);
        UserStore.removeChangeListener(sync);
        UserProfileStore?.removeChangeListener?.(sync);
        GuildProfileStore?.removeChangeListener?.(sync);
        InviteStore?.removeChangeListener?.(sync);

        // Remove the guild features we injected.
        for (const [id, mine] of injectedFeatures) {
            const guild = GuildStore.getGuild(id);
            for (const f of mine) guild?.features?.delete?.(f);
        }
        injectedFeatures.clear();

        // Remove the profile badge we injected.
        const me = UserStore.getCurrentUser();
        const profile = me && UserProfileStore?.getUserProfile?.(me.id);
        if (profile && Array.isArray(profile.badges) && profile.badges.some((b: any) => b?.[OUR_MARK])) {
            try { profile.badges = profile.badges.filter((b: any) => !b?.[OUR_MARK]); } catch { /* ignore */ }
        }
    }
});
