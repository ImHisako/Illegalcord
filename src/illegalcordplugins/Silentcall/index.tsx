/*
 * Vencord, a Discord client mod
 * SilentGroupCall — start DM/group calls without ringing the other members.
 *
 * When you start a call, Discord's client sends a separate
 * `POST /channels/{id}/call/ring` request to notify the other members. This
 * plugin wraps Discord's HTTP client and skips that one request when the call is
 * in scope. You stay connected and the call is still joinable; nobody gets buzzed.
 *
 * Only the call button's *automatic* ring is silenced: a ring is dropped only if
 * it comes shortly after you join that channel's call (VOICE_CHANNEL_SELECT) and
 * isn't aimed at specific users. Right-click "Ring to Call" and in-call ring
 * buttons later on go through untouched.
 *
 * Right-clicking the "Start Voice Call" button in a group DM opens a picker: the
 * call starts, and its automatic ring is rewritten to target only the members you
 * ticked (or dropped if you ticked nobody). Still no extra request is ever sent.
 *
 * Why the HTTP layer and not the `ring()` action itself: webpack module exports
 * are getter-only (assigning to them throws), and regex patches against minified
 * code break on every Discord update. The REST endpoint path is part of Discord's
 * public API and far more stable, and `RestAPI` is a plain, writable object.
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import {
    ChannelStore,
    ContextMenuApi,
    FluxDispatcher,
    Menu,
    RelationshipStore,
    RestAPI,
    SelectedChannelStore,
    UserStore,
    useState,
} from "@webpack/common";

// 1 = DM (1-on-1), 3 = GROUP_DM. Stable, documented Discord API values.
const CHANNEL_TYPE_DM = 1;
const CHANNEL_TYPE_GROUP_DM = 3;

// Matches the ring endpoint, with or without the API base / version prefix.
const RING_URL = /\/channels\/(\d+)\/call\/ring(?:$|[?#])/;

// The header call button. Matched by its (English) label, since Discord's class
// names are hashed and change between builds.
const CALL_BUTTON = '[aria-label="Start Voice Call"]';

const settings = definePluginSettings({
    silenceGroupCalls: {
        type: OptionType.BOOLEAN,
        description: "Don't ring members when you start a group call",
        default: true,
    },
    silenceDMCalls: {
        type: OptionType.BOOLEAN,
        description: "Don't ring the other person when you start a 1-on-1 DM call",
        default: false,
    },
    disableOnCanary: {
        type: OptionType.BOOLEAN,
        description: "Do nothing when running in Discord Canary (settings are shared between clients)",
        default: false,
        restartNeeded: true,
    },
    debugLogs: {
        type: OptionType.BOOLEAN,
        description: "Log plugin activity to the console (DevTools → Console, filter 'SilentGroupCall')",
        default: false,
    },
});

const logger = new Logger("SilentGroupCall");
const debug = (...args: any[]) => {
    if (settings.store.debugLogs) logger.info(...args);
};

// channelId -> when you joined its call. The automatic ring can follow an async
// check (1-on-1 DMs ask whether the user is ringable first), hence a window.
const AUTO_RING_WINDOW_MS = 15_000;
const pendingAutoRings = new Map<string, number>();

// channelId -> who to ring, chosen in the call button's right-click picker.
// Applies to that channel's next automatic ring, within the same window.
// "all" means let Discord's ring-everyone through untouched.
type Picks = string[] | "all";
const pendingPicks = new Map<string, { recipients: Picks; at: number; }>();

function onVoiceChannelSelect({ channelId }: { channelId?: string | null; }) {
    if (channelId) pendingAutoRings.set(channelId, Date.now());
}

/** Consume this channel's join mark; true if it was still fresh. */
function takePendingAutoRing(channelId: string): boolean {
    const t = pendingAutoRings.get(channelId);
    if (t === undefined) return false;
    pendingAutoRings.delete(channelId);
    return Date.now() - t <= AUTO_RING_WINDOW_MS;
}

/** Consume this channel's picker choice; null if there is none or it's stale. */
function takePendingPicks(channelId: string): Picks | null {
    const p = pendingPicks.get(channelId);
    if (p === undefined) return null;
    pendingPicks.delete(channelId);
    return Date.now() - p.at <= AUTO_RING_WINDOW_MS ? p.recipients : null;
}

/** A ring naming specific users ("Ring to Call") is always deliberate. */
function isTargetedRing(req: unknown): boolean {
    const recipients = (req as any)?.body?.recipients;
    return Array.isArray(recipients) && recipients.length > 0;
}

type PostFn = (...args: any[]) => any;

// The original RestAPI.post. null means "not currently patched".
let originalPost: PostFn | null = null;
// Whether the wrapper should act. Lets stop() neutralize the wrapper even when
// another plugin has wrapped RestAPI.post on top of ours (see stop()).
let active = false;

function getUrl(req: unknown): string | undefined {
    if (typeof req === "string") return req;
    if (req && typeof req === "object" && typeof (req as any).url === "string") return (req as any).url;
    return undefined;
}

type RingDecision =
    | { action: "pass"; }
    | { action: "drop"; }
    | { action: "rewrite"; recipients: string[]; };

function decideRing(channelId: string, req: unknown): RingDecision {
    const targeted = isTargetedRing(req);
    // Always consume both marks, so stale ones can't affect a later manual ring.
    const joined = takePendingAutoRing(channelId);
    const picks = takePendingPicks(channelId);
    const auto = (joined || picks !== null) && !targeted;

    let channel: any;
    try {
        channel = ChannelStore.getChannel(channelId);
    } catch {
        channel = undefined;
    }

    const inScope =
        channel?.type === CHANNEL_TYPE_GROUP_DM ? settings.store.silenceGroupCalls :
        channel?.type === CHANNEL_TYPE_DM ? settings.store.silenceDMCalls :
        false;

    // An explicit picker choice wins over the silence settings.
    const decision: RingDecision =
        !auto || picks === "all" ? { action: "pass" } :
        picks?.length ? { action: "rewrite", recipients: picks } :
        picks || inScope ? { action: "drop" } :
        { action: "pass" };

    debug("ring request", {
        channelId,
        type: channel?.type,
        auto,
        targeted,
        picks,
        silenceGroupCalls: settings.store.silenceGroupCalls,
        silenceDMCalls: settings.store.silenceDMCalls,
        decision: decision.action === "rewrite" ? `ringing only ${(picks as string[]).join(", ")}` :
            decision.action === "drop" ? "silencing" :
            picks === "all" ? "ringing everyone (picker)" :
            auto ? "ringing normally" : "ringing normally (manual ring)",
    });

    return decision;
}

function wrappedPost(this: unknown, ...args: any[]) {
    if (active) {
        const match = getUrl(args[0])?.match(RING_URL);
        if (match) {
            const decision = decideRing(match[1], args[0]);
            if (decision.action === "drop") {
                // Pretend the request succeeded (Discord answers 204 No Content) so
                // callers awaiting it don't surface an error. No request is sent.
                return Promise.resolve({ ok: true, status: 204, body: null, headers: {}, text: "" });
            }
            if (decision.action === "rewrite") {
                const req = args[0];
                args[0] = { ...req, body: { ...req.body, recipients: decision.recipients } };
            }
        }
    }
    return originalPost!.apply(this, args);
}

function displayName(userId: string): string {
    const user = UserStore.getUser(userId);
    return RelationshipStore.getNickname(userId) ?? user?.globalName ?? user?.username ?? userId;
}

function RingPicker({ channel, button }: { channel: Channel; button: HTMLElement; }) {
    const [picked, setPicked] = useState<string[]>([]);
    const toggle = (id: string) =>
        setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

    // Discord only lets you ring members you're friends with.
    const members = channel.recipients.map(id => ({
        id,
        name: displayName(id),
        friend: RelationshipStore.isFriend(id),
    }));

    return (
        <Menu.Menu
            navId="silent-group-call-ring-picker"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="Ring who?"
        >
            <Menu.MenuGroup label="Ring who?">
                {members.map(m => (
                    <Menu.MenuCheckboxItem
                        key={m.id}
                        id={`sgc-ring-${m.id}`}
                        label={m.friend ? m.name : `${m.name} (not a friend)`}
                        checked={picked.includes(m.id)}
                        disabled={!m.friend}
                        action={() => toggle(m.id)}
                    />
                ))}
            </Menu.MenuGroup>
            <Menu.MenuSeparator />
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="sgc-start-call"
                    label={picked.length ? `Start call and ring ${picked.length}` : "Start call without ringing"}
                    action={() => startPickedCall(channel.id, picked, button)}
                />
                <Menu.MenuItem
                    id="sgc-start-call-all"
                    label="Start call and ring everyone"
                    action={() => startPickedCall(channel.id, "all", button)}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

function startPickedCall(channelId: string, recipients: Picks, button: HTMLElement) {
    const target = button.isConnected ? button : document.querySelector<HTMLElement>(CALL_BUTTON);
    if (!target) {
        logger.error("call button disappeared — not starting the call");
        return;
    }

    pendingPicks.set(channelId, { recipients, at: Date.now() });
    debug("picker: starting call", { channelId, recipients });
    target.click();
}

function onContextMenu(e: MouseEvent) {
    const button = (e.target as Element | null)?.closest?.<HTMLElement>(CALL_BUTTON);
    if (!button) return;

    const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    if (channel?.type !== CHANNEL_TYPE_GROUP_DM) return;

    e.preventDefault();
    e.stopPropagation();
    // Native event from a document listener; it carries the same target/position fields.
    ContextMenuApi.openContextMenu(e as any, () => <RingPicker channel={channel} button={button} />);
}

function attachListeners() {
    FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
    document.addEventListener("contextmenu", onContextMenu, true);
}

function detachListeners() {
    FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
    document.removeEventListener("contextmenu", onContextMenu, true);
}

export default definePlugin({
    name: "SilentGroupCall",
    description: "Start DM and group calls without ringing the other members — they can still see and join the call, they just don't get the incoming-call notification. Right-click the call button in a group DM to pick who gets rung.",
    authors: [{ name: "gandhistyle", id: 0n }],
    settings,

    start() {
        if (settings.store.disableOnCanary && (window as any).GLOBAL_ENV?.RELEASE_CHANNEL === "canary") {
            logger.info("running in Discord Canary — staying inactive");
            return;
        }

        if (originalPost) {
            // Wrapper is still installed from a previous run (see stop()); just re-arm it.
            active = true;
            attachListeners();
            logger.info("re-enabled ring interception");
            return;
        }

        let post: unknown;
        try {
            post = RestAPI?.post;
        } catch (e) {
            logger.error("could not find Discord's HTTP module — plugin inactive", e);
            return;
        }

        if (typeof post !== "function") {
            logger.error("RestAPI.post is not a function — plugin inactive");
            return;
        }

        try {
            originalPost = post as PostFn;
            RestAPI.post = wrappedPost;
        } catch (e) {
            originalPost = null;
            logger.error("RestAPI.post is not writable — plugin inactive", e);
            return;
        }

        active = true;
        attachListeners();
        logger.info("intercepting call ring requests");
    },

    stop() {
        active = false;
        pendingAutoRings.clear();
        pendingPicks.clear();
        if (!originalPost) return;

        detachListeners();

        // Only restore if we're still the outermost wrapper. If another plugin
        // wrapped on top of us, restoring would clobber its patch, so we leave our
        // wrapper in place as an inert passthrough instead.
        if (RestAPI.post === wrappedPost) {
            try {
                RestAPI.post = originalPost;
                originalPost = null;
            } catch (e) {
                logger.error("failed to restore RestAPI.post", e);
            }
        }

        logger.info("stopped intercepting call ring requests");
    },
});
