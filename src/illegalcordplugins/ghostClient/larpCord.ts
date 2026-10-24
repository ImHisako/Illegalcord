/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { SettingsStore } from "@api/Settings";
import LarpCord from "@illegalcordplugins/LarpCord";
import { SYM_LAZY_GET } from "@utils/lazy";
import type { User } from "@vencord/discord-types";
import { findByProps } from "@webpack";
import { GuildMemberStore, IconUtils, SnowflakeUtils, UserProfileStore, UserStore } from "@webpack/common";

const KEYS = ["active", "hideInterface", "manualMode", "enabled", "streamerMode", "blacklistedGuilds"] as const;

export function installLarpCordPrivacy(isInterfaceHidden: () => boolean) {
    const iconUtils = (IconUtils as typeof IconUtils & { [SYM_LAZY_GET](): typeof IconUtils; })[SYM_LAZY_GET]();
    const AccountStore = findByProps("getUsers", "getValidUsers", "getHasLoggedInAccounts") as {
        getUsers(): User[];
        getValidUsers(): User[];
        emitChange(): void;
    } | undefined;
    let installed = true;
    const hidden = () => installed && isPluginEnabled("LarpCord") && isInterfaceHidden();
    const restorers: Array<() => void> = [];

    function intercept<Args extends unknown[], Result>(target: object, key: string, native: (...args: Args) => Result) {
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (descriptor?.configurable === false) return;
        let current = Reflect.get(target, key) as (...args: Args) => Result;
        const initial = current;
        const wrap = (method: typeof current) => function (this: unknown, ...args: Args) {
            return (hidden() ? native : method).apply(this, args);
        };
        let wrapped = wrap(current);
        Object.defineProperty(target, key, {
            configurable: true,
            enumerable: descriptor?.enumerable ?? false,
            get: () => wrapped,
            set(method: typeof current) {
                current = method;
                wrapped = wrap(method);
            }
        });
        restorers.push(() => {
            if (descriptor && current === initial) Object.defineProperty(target, key, descriptor);
            else if (!descriptor && current === initial) Reflect.deleteProperty(target, key);
            else Object.defineProperty(target, key, { value: current, configurable: true, writable: true, enumerable: descriptor?.enumerable ?? false });
        });
    }

    const { getUser, getCurrentUser } = UserStore;
    const { fakeCurrentUser } = LarpCord;
    const contactViews = new WeakMap<User, User>();
    function contactsOnly(user: User | null | undefined) {
        if (!user) return user;
        const real = getUser.call(UserStore, user.id) ?? user;
        const modified: User = fakeCurrentUser.call(LarpCord, real);
        if (modified.email === real.email && modified.phone === real.phone) return real;
        let clone = contactViews.get(real);
        if (!clone) {
            clone = new Proxy(real, {
                get(target, key, receiver) {
                    if (key === "email" || key === "phone") {
                        const modified: User = fakeCurrentUser.call(LarpCord, target);
                        return modified[key];
                    }
                    return Reflect.get(target, key, receiver);
                }
            });
            contactViews.set(real, clone);
        }
        return clone;
    }

    intercept(LarpCord, "fakeCurrentUser", contactsOnly);
    intercept(LarpCord, "hookUserProfile", (profile: unknown) => profile);
    intercept(LarpCord, "patchBannerUrl", () => null);
    intercept(UserStore, "getUser", (id: string) => contactsOnly(getUser.call(UserStore, id)));
    intercept(UserStore, "getCurrentUser", () => contactsOnly(getCurrentUser.call(UserStore)));
    intercept(UserProfileStore, "getUserProfile", UserProfileStore.getUserProfile);
    intercept(UserProfileStore, "getGuildMemberProfile", UserProfileStore.getGuildMemberProfile);
    intercept(GuildMemberStore, "getMember", GuildMemberStore.getMember);
    intercept(iconUtils, "getUserAvatarURL", iconUtils.getUserAvatarURL);
    intercept(iconUtils, "getAvatarDecorationURL", iconUtils.getAvatarDecorationURL);
    intercept(SnowflakeUtils, "extractTimestamp", SnowflakeUtils.extractTimestamp);
    if (AccountStore) {
        intercept(AccountStore, "getUsers", AccountStore.getUsers);
        intercept(AccountStore, "getValidUsers", AccountStore.getValidUsers);
    }

    function refresh() {
        UserStore.emitChange();
        UserProfileStore.emitChange();
        GuildMemberStore.emitChange();
        AccountStore?.emitChange();
    }
    for (const key of KEYS) SettingsStore.addChangeListener(`plugins.GhostClient.${key}`, refresh);
    refresh();

    return {
        refresh,
        stop() {
            installed = false;
            for (const key of KEYS) SettingsStore.removeChangeListener(`plugins.GhostClient.${key}`, refresh);
            for (const restore of restorers.reverse()) restore();
            refresh();
        }
    };
}
