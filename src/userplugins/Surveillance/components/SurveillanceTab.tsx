/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { HeadingPrimary, HeadingTertiary } from "@components/Heading";
import { SettingsTab, wrapTab } from "@components/settings";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildStore, Modal, openModal, React, TextInput, Toasts, useEffect, useMemo, UserStore, useState, useStateFromStores } from "@webpack/common";

import { addServerTarget, getServerTargets, getTargets, removeServerTarget, removeTarget, setServerTargets, setTargets, settings, subscribeServerTargets, subscribeTargets } from "..";
import { clearEvents, getEvents, loadEvents, subscribe } from "../store";
import type { SurveillanceEvent, SurveillanceEventType } from "../types";

type EventFilter = "all" | "activity" | "message" | "presence" | "reaction" | "server" | "typing" | "voice";
type SurveillancePage = "user" | "server";

interface CachedUser {
    id: string;
    username: string;
    globalName?: string | null;
}

const EVENT_PAGE_SIZE = 100;
const SEARCH_RESULT_LIMIT = 30;
const TARGET_LIST_LIMIT = 50;
const cl = classNameFactory("vc-surveillance-");

const filterOptions: Array<{ label: string; value: EventFilter; }> = [
    { label: "All", value: "all" },
    { label: "Messages", value: "message" },
    { label: "Server", value: "server" },
    { label: "Reactions", value: "reaction" },
    { label: "Presence", value: "presence" },
    { label: "Voice", value: "voice" },
    { label: "Activities", value: "activity" },
    { label: "Typing", value: "typing" },
];

const pageOptions: Array<{ label: string; value: SurveillancePage; }> = [
    { label: "User Surveillance", value: "user" },
    { label: "Server Surveillance", value: "server" },
];

const typeLabels: Record<SurveillanceEventType, string> = {
    activity_start: "Activity",
    activity_stop: "Activity",
    activity_update: "Activity",
    channel_create: "Channel",
    channel_delete: "Channel",
    channel_update: "Channel",
    guild_member_add: "Member",
    guild_member_remove: "Member",
    guild_member_update: "Member",
    guild_update: "Server",
    message: "Message",
    message_delete: "Deleted",
    message_edit: "Edited",
    reaction_add: "Reaction",
    reaction_remove: "Reaction",
    reaction_remove_all: "Reaction",
    role_create: "Role",
    role_delete: "Role",
    role_update: "Role",
    status: "Status",
    thread_create: "Thread",
    thread_delete: "Thread",
    thread_update: "Thread",
    typing: "Typing",
    voice_join: "Voice",
    voice_leave: "Voice",
    voice_move: "Voice",
    voice_update: "Voice",
};

const getBadgeClass = (type: SurveillanceEventType) => {
    if (type.startsWith("activity_")) return cl("event-play");
    if (type === "message_delete") return cl("event-deleted");
    return cl(`event-${type}`);
};

const isCachedUser = (value: unknown): value is CachedUser => {
    if (typeof value !== "object" || value == null) return false;

    const user = value as Record<string, unknown>;
    return typeof user.id === "string" && typeof user.username === "string";
};

const getCachedUsers = () => {
    const users = UserStore.getUsers?.();
    if (typeof users !== "object" || users == null) return [];

    return Object.values(users).filter(isCachedUser);
};

const areStringArraysEqual = (first: string[], second: string[]) =>
    first.length === second.length && first.every((value, index) => value === second[index]);

const eventMatchesPage = (event: SurveillanceEvent, page: SurveillancePage) =>
    page === "server" ? event.scope === "server" : event.scope !== "server";

const eventMatchesFilter = (event: SurveillanceEvent, filter: EventFilter) => {
    if (filter === "all") return true;
    if (filter === "presence") return event.type === "status";
    if (filter === "server") return event.scope === "server" || ["channel_", "thread_", "guild_", "role_"].some(prefix => event.type.startsWith(prefix));
    return event.type.startsWith(filter);
};

const eventMatchesQuery = (event: SurveillanceEvent, query: string) => {
    if (!query) return true;

    const value = query.toLowerCase();
    return [
        event.username,
        event.userId,
        event.details,
        event.channelName,
        event.guildName,
        event.content,
        event.before,
        event.after,
    ].some(part => part?.toLowerCase().includes(value));
};

const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleString();

const formatLabel = (label: string) =>
    label.replace(/[A-Z]/g, match => ` ${match}`).replace(/^./, match => match.toUpperCase());

const toast = (message: string, type: string = Toasts.Type.SUCCESS) =>
    Toasts.show({
        type,
        message,
        id: Toasts.genId(),
    });

function DetailField({ label, value, wide, preserve }: { label: string; value?: string | number | boolean | null; wide?: boolean; preserve?: boolean; }) {
    if (value == null || value === "") return null;

    const text = String(value);

    return (
        <div className={classes(cl("modal-field"), wide && cl("modal-wide"))}>
            <strong>{label}</strong>
            {preserve ? <pre>{text}</pre> : <span>{text}</span>}
        </div>
    );
}

const EventDetailsModal = ErrorBoundary.wrap(function EventDetailsModal({ event, modalProps }: { event: SurveillanceEvent; modalProps: RenderModalProps; }) {
    const channel = event.channelId ? ChannelStore.getChannel(event.channelId) : undefined;
    const guild = event.guildId ? GuildStore.getGuild(event.guildId) : undefined;
    const metadata = Object.entries(event.metadata ?? {}).filter(([, value]) => value != null);

    const copyEvent = () => {
        try {
            void Promise.resolve(copyToClipboard(JSON.stringify(event, null, 2))).then(
                () => toast("Event copied."),
                () => toast("Failed to copy event.", Toasts.Type.FAILURE)
            );
        } catch {
            toast("Failed to copy event.", Toasts.Type.FAILURE);
        }
    };

    return (
        <Modal
            {...modalProps}
            size="md"
            title={<HeadingPrimary className={cl("modal-title")}>Event Details</HeadingPrimary>}
        >
            <div className={cl("modal-content")}>
                <div className={cl("modal-grid")}>
                    <DetailField label="Type" value={typeLabels[event.type]} />
                    <DetailField label="Time" value={formatTime(event.timestamp)} />
                    <DetailField label="User" value={event.username} />
                    <DetailField label="User ID" value={event.userId} />
                    <DetailField label="Scope" value={event.scope} />
                    <DetailField label="Server" value={event.guildName ?? guild?.name} />
                    <DetailField label="Server ID" value={event.guildId} />
                    <DetailField label="Channel" value={event.channelName ?? channel?.name} />
                    <DetailField label="Channel ID" value={event.channelId} />
                    <DetailField label="Details" value={event.details} wide={true} preserve={true} />
                    <DetailField label="Message Content" value={event.content} wide={true} preserve={true} />
                    <DetailField label="Before" value={event.before} wide={true} preserve={true} />
                    <DetailField label="After" value={event.after} wide={true} preserve={true} />
                </div>

                {metadata.length ? (
                    <div className={cl("modal-grid")}>
                        {metadata.map(([key, value]) => (
                            <DetailField key={key} label={formatLabel(key)} value={value} />
                        ))}
                    </div>
                ) : null}

                <div className={cl("actions")}>
                    <button className={cl("action")} onClick={copyEvent}>Copy Event JSON</button>
                </div>
                <div className={cl("modal-meta")}>Event ID: {event.id}</div>
            </div>
        </Modal>
    );
}, { noop: true });

const openEventModal = (event: SurveillanceEvent) => {
    openModal(modalProps => <EventDetailsModal event={event} modalProps={modalProps} />);
};

function TargetPill({ userId }: { userId: string; }) {
    const user = UserStore.getUser(userId);

    return (
        <button className={cl("target-pill")} onClick={() => removeTarget(userId)}>
            <span>{user?.username ?? userId}</span>
            <span className={cl("target-id")}>{userId}</span>
        </button>
    );
}

function ServerPill({ guildId }: { guildId: string; }) {
    const guild = GuildStore.getGuild(guildId);

    return (
        <button className={cl("target-pill")} onClick={() => removeServerTarget(guildId)}>
            <span>{guild?.name ?? guildId}</span>
            <span className={cl("target-id")}>{guildId}</span>
        </button>
    );
}

function UserSearchResult({ user, onAdd }: { user: CachedUser; onAdd(userId: string): void; }) {
    return (
        <button className={cl("search-result")} onClick={() => onAdd(user.id)} type="button">
            <span>
                <strong>{user.globalName ?? user.username}</strong>
                <small>{user.username}</small>
            </span>
            <span className={cl("target-id")}>{user.id}</span>
        </button>
    );
}

function ServerSearchResult({ guildId, onAdd }: { guildId: string; onAdd(guildId: string): void; }) {
    const guild = GuildStore.getGuild(guildId);

    return (
        <button className={cl("search-result")} onClick={() => onAdd(guildId)} type="button">
            <span>
                <strong>{guild?.name ?? guildId}</strong>
                <small>Server</small>
            </span>
            <span className={cl("target-id")}>{guildId}</span>
        </button>
    );
}

function Stat({ label, value }: { label: string; value: number; }) {
    return (
        <div className={cl("stat")}>
            <span>{value}</span>
            <small>{label}</small>
        </div>
    );
}

function EventRow({ event }: { event: SurveillanceEvent; }) {
    const channel = event.channelId ? ChannelStore.getChannel(event.channelId) : undefined;
    const guild = event.guildId ? GuildStore.getGuild(event.guildId) : undefined;
    const location = [
        event.guildName ?? guild?.name,
        event.channelName ?? channel?.name,
    ].filter(Boolean).join(" / ");

    return (
        <button className={classes(cl("event-row"), event.type.startsWith("activity_") && cl("event-row-compact"))} onClick={() => openEventModal(event)} type="button">
            <div className={classes(cl("event-badge"), getBadgeClass(event.type))}>
                {typeLabels[event.type]}
            </div>
            <div className={cl("event-main")}>
                <div className={cl("event-head")}>
                    <strong>{event.username}</strong>
                    <span>{formatTime(event.timestamp)}</span>
                </div>
                <div className={cl("event-details")}>{event.details}</div>
                {location ? <div className={cl("event-location")}>{location}</div> : null}
                {event.before || event.after ? (
                    <div className={cl("event-diff")}>
                        {event.before ? <span>Before: {event.before}</span> : null}
                        {event.after ? <span>After: {event.after}</span> : null}
                    </div>
                ) : null}
            </div>
        </button>
    );
}

function SurveillanceTab() {
    const [events, setEvents] = useState<SurveillanceEvent[]>(getEvents());
    const [page, setPage] = useState<SurveillancePage>("user");
    const [targets, setLocalTargets] = useState(getTargets());
    const [serverTargets, setLocalServerTargets] = useState(getServerTargets());
    const [targetInput, setTargetInput] = useState("");
    const [userSearch, setUserSearch] = useState("");
    const [serverSearch, setServerSearch] = useState("");
    const [collapsedPages, setCollapsedPages] = useState<Record<SurveillancePage, boolean>>({
        server: false,
        user: false,
    });
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<EventFilter>("all");
    const [visibleEventCount, setVisibleEventCount] = useState(EVENT_PAGE_SIZE);
    const guildIds = useStateFromStores([GuildStore], () => GuildStore.getGuildsArray().map(guild => guild.id), [], areStringArraysEqual);

    useEffect(() => {
        void loadEvents(settings.store.maxEvents).then(() => setEvents(getEvents()));

        const unsubscribeEvents = subscribe(() => setEvents(getEvents()));
        const unsubscribeTargets = subscribeTargets(() => setLocalTargets([...getTargets()]));
        const unsubscribeServerTargets = subscribeServerTargets(() => setLocalServerTargets([...getServerTargets()]));

        return () => {
            unsubscribeEvents();
            unsubscribeTargets();
            unsubscribeServerTargets();
        };
    }, []);

    useEffect(() => {
        setVisibleEventCount(EVENT_PAGE_SIZE);
    }, [filter, page, query]);

    const targetIds = useMemo(() => new Set(targets), [targets]);
    const serverTargetIds = useMemo(() => new Set(serverTargets), [serverTargets]);
    const targetPanelCollapsed = collapsedPages[page];

    const scopedEvents = useMemo(() =>
        events.filter(event => eventMatchesPage(event, page)),
        [events, page]
    );

    const filteredEvents = useMemo(() =>
        scopedEvents.filter(event => eventMatchesFilter(event, filter) && eventMatchesQuery(event, query)),
        [filter, query, scopedEvents]
    );

    const visibleEvents = useMemo(() =>
        filteredEvents.slice(0, visibleEventCount),
        [filteredEvents, visibleEventCount]
    );

    const stats = useMemo(() => {
        const users = new Set<string>();
        const guilds = new Set<string>();
        const channels = new Set<string>();

        for (const event of scopedEvents) {
            users.add(event.userId);
            if (event.guildId) guilds.add(event.guildId);
            if (event.channelId) channels.add(event.channelId);
        }

        return {
            events: scopedEvents.length,
            users: users.size,
            guilds: guilds.size,
            channels: channels.size,
        };
    }, [scopedEvents]);

    const userSearchResults = useMemo(() => {
        const search = userSearch.trim().toLowerCase();
        if (page !== "user" || targetPanelCollapsed || !search) return { matches: [], total: 0 };

        const matches: CachedUser[] = [];
        let total = 0;

        for (const user of getCachedUsers()) {
            if (targetIds.has(user.id)) continue;
            if (
                !user.id.includes(search)
                && !user.username.toLowerCase().includes(search)
                && !user.globalName?.toLowerCase().includes(search)
            ) continue;

            total++;
            if (matches.length < SEARCH_RESULT_LIMIT) matches.push(user);
        }

        return { matches, total };
    }, [page, targetIds, targetPanelCollapsed, userSearch]);

    const serverSearchResults = useMemo(() => {
        const search = serverSearch.trim().toLowerCase();
        if (page !== "server" || targetPanelCollapsed) return { matches: [], total: 0 };

        const matches: string[] = [];
        let total = 0;

        for (const guildId of guildIds) {
            if (serverTargetIds.has(guildId)) continue;

            const guild = GuildStore.getGuild(guildId);
            const guildName = guild?.name ?? guildId;
            if (search && !guildId.includes(search) && !guildName.toLowerCase().includes(search)) continue;

            total++;
            if (matches.length < SEARCH_RESULT_LIMIT) matches.push(guildId);
        }

        return { matches, total };
    }, [guildIds, page, serverSearch, serverTargetIds, targetPanelCollapsed]);

    const userMatches = userSearchResults.matches;
    const serverMatches = serverSearchResults.matches;

    const selectedPageLabel = page === "server" ? "server" : "user";

    const addUserTarget = (userId: string) => {
        setTargets([...targets, userId]);
        toast("User target added.");
    };

    const addVisibleUsers = () => {
        if (!userMatches.length) {
            toast("No users to add.", Toasts.Type.FAILURE);
            return;
        }

        setTargets([...targets, ...userMatches.map(user => user.id)]);
        toast("Visible users added.");
    };

    const addVisibleServers = () => {
        if (!serverMatches.length) {
            toast("No servers to add.", Toasts.Type.FAILURE);
            return;
        }

        setServerTargets([...serverTargets, ...serverMatches]);
        toast("Visible servers added.");
    };

    const addServer = (guildId: string) => {
        addServerTarget(guildId);
        toast("Server target added.");
    };

    const clearPageTargets = () => {
        if (page === "server") {
            setServerTargets([]);
            toast("Server targets cleared.");
            return;
        }

        setTargets([]);
        toast("User targets cleared.");
    };

    const pageTargetCount = page === "server" ? serverTargets.length : targets.length;

    const pageHeading = page === "server" ? "Server Surveillance" : "User Surveillance";

    const pageEmpty = page === "server" ? "No server events." : "No user events.";

    const targetEmpty = page === "server" ? "No server targets." : "No user targets.";

    const targetLabel = page === "server" ? "Servers" : "Users";

    const targetCount = page === "server" ? serverTargets.length : targets.length;

    const resultCount = page === "server" ? serverMatches.length : userMatches.length;

    const totalAvailable = page === "server" ? serverSearchResults.total : userSearchResults.total;

    const searchPlaceholder = page === "server" ? "Search servers by name or ID..." : "Search cached users by name or ID...";

    const shownTargets = targets.slice(0, TARGET_LIST_LIMIT);

    const shownServerTargets = serverTargets.slice(0, TARGET_LIST_LIMIT);

    const hiddenTargetCount = targetCount - (page === "server" ? shownServerTargets.length : shownTargets.length);

    const toggleTargetPanel = () => {
        setCollapsedPages(current => ({ ...current, [page]: !current[page] }));
    };

    const showSearchHint = page === "user" && !userSearch.trim();

    const searchMeta = `${resultCount} shown${totalAvailable > SEARCH_RESULT_LIMIT ? ` of ${totalAvailable}` : ""}`;

    const addInputTargets = () => {
        const ids = targetInput.match(/\d+/g) ?? [];
        if (!ids.length) {
            toast("Enter a valid Discord user ID.", Toasts.Type.FAILURE);
            return;
        }

        setTargets([...targets, ...ids]);
        setTargetInput("");
        toast("Target list updated.");
    };

    const copyEvents = () => {
        try {
            void Promise.resolve(copyToClipboard(JSON.stringify(filteredEvents, null, 2))).then(
                () => toast("Surveillance events copied."),
                () => toast("Failed to copy surveillance events.", Toasts.Type.FAILURE)
            );
        } catch {
            toast("Failed to copy surveillance events.", Toasts.Type.FAILURE);
        }
    };

    const resetEvents = () => {
        void clearEvents().then(() => toast("Surveillance events cleared."));
    };

    return (
        <SettingsTab>
            <div className={cl("root")}>
                <div className={cl("header")}>
                    <HeadingPrimary>Surveillance</HeadingPrimary>
                    <div className={cl("actions")}>
                        <button className={cl("action")} onClick={copyEvents}>Export JSON</button>
                        <button className={classes(cl("action"), cl("danger"))} onClick={resetEvents}>Clear</button>
                    </div>
                </div>

                <div className={cl("page-tabs")}>
                    {pageOptions.map(option => {
                        const count = option.value === "server" ? serverTargets.length : targets.length;

                        return (
                            <button
                                key={option.value}
                                className={classes(cl("page-tab"), page === option.value && cl("page-tab-active"))}
                                onClick={() => setPage(option.value)}
                                type="button"
                            >
                                <span>{option.label}</span>
                                <small>{count} targets</small>
                            </button>
                        );
                    })}
                </div>

                <div className={cl("stats")}>
                    <Stat label="Events" value={stats.events} />
                    <Stat label="Users" value={stats.users} />
                    <Stat label="Servers" value={stats.guilds} />
                    <Stat label="Channels" value={stats.channels} />
                </div>

                <section className={cl("panel")}>
                    <div className={cl("section-head")}>
                        <HeadingTertiary>{pageHeading}</HeadingTertiary>
                        <div className={cl("actions")}>
                            <button className={cl("action")} onClick={toggleTargetPanel}>
                                {targetPanelCollapsed ? "Open" : "Close"}
                            </button>
                            {targetPanelCollapsed ? null : (
                                <button className={cl("action")} disabled={!resultCount} onClick={page === "server" ? addVisibleServers : addVisibleUsers}>
                                    Add visible
                                </button>
                            )}
                            <button className={classes(cl("action"), cl("danger"))} disabled={!pageTargetCount} onClick={clearPageTargets}>
                                Clear {targetLabel}
                            </button>
                        </div>
                    </div>

                    {targetPanelCollapsed ? (
                        <div className={cl("collapsed-summary")}>
                            {targetCount} selected {selectedPageLabel} targets.
                        </div>
                    ) : (
                        <>
                            {page === "user" ? (
                                <>
                                    <div className={cl("target-input")}>
                                        <TextInput value={targetInput} placeholder="Discord user IDs..." onChange={setTargetInput} />
                                        <button className={cl("action")} onClick={addInputTargets}>Add IDs</button>
                                    </div>
                                    <div className={cl("target-input")}>
                                        <TextInput value={userSearch} placeholder={searchPlaceholder} onChange={setUserSearch} />
                                    </div>
                                    <div className={cl("search-meta")}>{showSearchHint ? "Type a username or user ID to search cached users." : searchMeta}</div>
                                    {showSearchHint ? null : (
                                        <div className={cl("search-results")}>
                                            {userMatches.length ? userMatches.map(user => (
                                                <UserSearchResult key={user.id} user={user} onAdd={addUserTarget} />
                                            )) : <span className={cl("empty")}>No users found.</span>}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className={cl("target-input")}>
                                        <TextInput value={serverSearch} placeholder={searchPlaceholder} onChange={setServerSearch} />
                                    </div>
                                    <div className={cl("search-meta")}>{searchMeta}</div>
                                    <div className={cl("search-results")}>
                                        {serverMatches.length ? serverMatches.map(guildId => (
                                            <ServerSearchResult key={guildId} guildId={guildId} onAdd={addServer} />
                                        )) : <span className={cl("empty")}>No servers found.</span>}
                                    </div>
                                </>
                            )}

                            <div className={cl("target-summary")}>
                                <strong>{targetCount} selected {selectedPageLabel} targets</strong>
                                <div className={cl("target-list")}>
                                    {page === "server"
                                        ? serverTargets.length ? shownServerTargets.map(guildId => (
                                            <ServerPill key={guildId} guildId={guildId} />
                                        )) : <span className={cl("empty")}>{targetEmpty}</span>
                                        : targets.length ? shownTargets.map(userId => (
                                            <TargetPill key={userId} userId={userId} />
                                        )) : <span className={cl("empty")}>{targetEmpty}</span>}
                                    {hiddenTargetCount > 0 ? <span className={cl("empty")}>{hiddenTargetCount} more hidden.</span> : null}
                                </div>
                            </div>
                        </>
                    )}
                </section>

                <section className={cl("panel")}>
                    <div className={cl("timeline-head")}>
                        <HeadingTertiary>{pageHeading} Timeline</HeadingTertiary>
                        <TextInput value={query} placeholder={`Search ${selectedPageLabel} events...`} onChange={setQuery} />
                    </div>
                    <div className={cl("filters")}>
                        {filterOptions.map(option => (
                            <button
                                key={option.value}
                                className={classes(cl("filter"), filter === option.value && cl("filter-active"))}
                                onClick={() => setFilter(option.value)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <div className={cl("timeline")}>
                        {visibleEvents.length ? visibleEvents.map(event => (
                            <EventRow key={event.id} event={event} />
                        )) : <div className={cl("empty")}>{pageEmpty}</div>}
                    </div>
                    {filteredEvents.length > visibleEvents.length ? (
                        <div className={cl("timeline-footer")}>
                            <span>Showing {visibleEvents.length} of {filteredEvents.length}</span>
                            <button
                                className={cl("action")}
                                onClick={() => setVisibleEventCount(count => count + EVENT_PAGE_SIZE)}
                            >
                                Show more
                            </button>
                        </div>
                    ) : null}
                </section>
            </div>
        </SettingsTab>
    );
}

export default wrapTab(SurveillanceTab, "Surveillance");
