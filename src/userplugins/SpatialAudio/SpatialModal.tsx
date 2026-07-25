/*
* Vencord, a Discord client mod
* Copyright (c) 2025 Vendicated and contributors*
* SPDX-License-Identifier: GPL-3.0-or-later
*/
import { ChannelStore, GuildMemberStore, React, useStateFromStores, UserStore, VoiceStateStore } from "@webpack/common";

import {
    CANVAS_SIZE,
    cl,
    defaultPosition,
    disableSpatial,
    enableSpatial,
    getPosition,
    isSpatialActive,
    resetPositions,
    setManualMode,
    setPosition,
    SpatialActiveStore,
    SpatialPositionStore,
} from "./state";

interface Props {
    channelId: string;
    onClose: () => void;
}

export function SpatialModal({ channelId, onClose }: Props) {
    // VoiceStateStore.getVoiceStatesForChannel returns a reference-stable object
    // that Discord mutates in place, so subscribing to it directly never triggers
    // a re-render when a participant joins or leaves. Subscribe to a freshly
    // computed membership signature instead — its identity changes on join/leave,
    // so useStateFromStores' default equality check fires a re-render. (serverInfo's
    // GuildInfoModal selects getMemberIds for the same reason.)
    const memberKey = useStateFromStores([VoiceStateStore], () =>
        Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId)).sort().join(",")
    );
    const isActive = useStateFromStores([SpatialActiveStore], () => isSpatialActive(channelId));
    void useStateFromStores([SpatialPositionStore], () => SpatialPositionStore.getRevision());

    const currentUser = UserStore.getCurrentUser();
    const currentUserId = currentUser?.id;
    const guildId = ChannelStore.getChannel(channelId)?.guild_id;
    const participants = React.useMemo(
        () => Object.values(VoiceStateStore.getVoiceStatesForChannel(channelId))
            .filter(vs => vs.userId !== currentUserId)
            .sort((a, b) => a.userId.localeCompare(b.userId))
            .map((vs, i, arr) => {
                const user = UserStore.getUser(vs.userId);
                const displayName = (guildId && GuildMemberStore.getNick(guildId, vs.userId))
                    || user?.globalName
                    || user?.username
                    || vs.userId;
                return {
                    userId: vs.userId,
                    displayName,
                    avatarURL: user?.getAvatarURL(undefined, 128),
                    index: i,
                    total: arr.length,
                };
            }),
        [memberKey, channelId, currentUserId, guildId]
    );

    const canvasRef = React.useRef<HTMLDivElement | null>(null);
    const draggingIdRef = React.useRef<string | null>(null);
    const activeDragRef = React.useRef<{ move: (e: PointerEvent) => void; up: () => void; } | null>(null);

    // Remove any lingering document listeners if the modal unmounts during a drag.
    React.useEffect(() => () => {
        if (activeDragRef.current) {
            document.removeEventListener("pointermove", activeDragRef.current.move);
            document.removeEventListener("pointerup", activeDragRef.current.up);
        }
    }, []);

    // Add vc-spatial-ready after mount so CSS transitions don't fire on initial render.
    React.useEffect(() => {
        canvasRef.current?.classList.add("vc-spatial-ready");
    }, []);

    function onPointerDown(e: React.PointerEvent, userId: string) {
        e.preventDefault();
        const nodeEl = e.currentTarget as HTMLElement;
        nodeEl.setPointerCapture(e.pointerId);
        draggingIdRef.current = userId;

        const startX = e.clientX;
        const startY = e.clientY;
        let hasDraggedFar = false;

        canvasRef.current?.classList.add("dragging");

        const onMove = (me: PointerEvent) => {
            if (draggingIdRef.current !== userId || !canvasRef.current) return;
            const rect = canvasRef.current.getBoundingClientRect();
            const x = Math.max(0, Math.min(CANVAS_SIZE, me.clientX - rect.left));
            const y = Math.max(0, Math.min(CANVAS_SIZE, me.clientY - rect.top));
            if (!hasDraggedFar) {
                const dx = me.clientX - startX;
                const dy = me.clientY - startY;
                if (Math.sqrt(dx * dx + dy * dy) > 10) hasDraggedFar = true;
            }
            // Update panner and positions map without triggering a React re-render.
            // Direct DOM update gives smooth 60 fps visual feedback during drag.
            setPosition(channelId, userId, x, y, true);
            nodeEl.style.left = `${x}px`;
            nodeEl.style.top = `${y}px`;
        };

        const onUp = () => {
            draggingIdRef.current = null;
            canvasRef.current?.classList.remove("dragging");
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            activeDragRef.current = null;
            if (hasDraggedFar) setManualMode(channelId, true);
            // One emit after drag ends so React renders the final position.
            SpatialPositionStore.emit();
        };

        activeDragRef.current = { move: onMove, up: onUp };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
    }

    function handleToggle() {
        if (isActive) disableSpatial(channelId);
        else enableSpatial(channelId);
    }

    function handleReset() {
        resetPositions(channelId);
    }

    return (
        <div className={cl("backdrop")} onClick={onClose}>
            <div className={cl("panel")} onClick={e => e.stopPropagation()}>
                <div className={cl("header")}>
                    <span className={cl("title")}>Spatial Audio</span>
                    <button className={cl("close")} aria-label="Close" onClick={onClose}>✕</button>
                </div>

                <div
                    ref={canvasRef}
                    className={cl("canvas", !isActive && "canvas-inactive")}
                    style={{ width: CANVAS_SIZE, height: CANVAS_SIZE } as React.CSSProperties}
                >
                    <div
                        className={cl("node", "node-self")}
                        style={{ left: CANVAS_SIZE / 2, top: CANVAS_SIZE / 2 } as React.CSSProperties}
                    >
                        <div className={cl("avatar")}>
                            <img src={currentUser?.getAvatarURL(undefined, 128)} alt="" draggable={false} />
                        </div>
                        <span className={cl("label")}>You</span>
                    </div>

                    {participants.map(p => {
                        const pos = getPosition(channelId, p.userId) ?? defaultPosition(p.index, p.total);
                        return (
                            <div
                                key={p.userId}
                                data-participant={p.userId}
                                data-testid="participant-node"
                                className={cl("node")}
                                style={{ left: pos.x, top: pos.y } as React.CSSProperties}
                                onPointerDown={e => onPointerDown(e, p.userId)}
                            >
                                <div className={cl("avatar")}>
                                    <img src={p.avatarURL} alt="" draggable={false} />
                                </div>
                                <span className={cl("label")}>{p.displayName}</span>
                            </div>
                        );
                    })}
                </div>

                <div className={cl("footer")}>
                    <button className={cl("reset")} onClick={handleReset}>↺ Reset positions</button>
                    <label className={cl("toggle-label")}>
                        Spatial audio
                        <input
                            type="checkbox"
                            role="switch"
                            checked={isActive}
                            onChange={handleToggle}
                        />
                    </label>
                </div>
            </div>
        </div>
    );
}
