/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./AddonCard.css";

import { Badge } from "@components/Badge";
import { BaseText } from "@components/BaseText";
import { Switch } from "@components/Switch";
import { classNameFactory } from "@utils/css";
import type { Plugin } from "@utils/types";
import { Tooltip, useRef } from "@webpack/common";
import type { MouseEventHandler, ReactNode } from "react";

import Plugins from "~plugins";

const cl = classNameFactory("vc-addon-");
const pluginCl = classNameFactory("vc-plugins-");

interface NightcordPortPlugin extends Plugin {
    isNightcordPlugin(name: string): boolean;
}

interface Props {
    name: ReactNode;
    description: ReactNode;
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
    disabled?: boolean;
    isNew?: boolean;
    sourceBadge?: ReactNode;
    tooltip?: string;
    onMouseEnter?: MouseEventHandler<HTMLDivElement>;
    onMouseLeave?: MouseEventHandler<HTMLDivElement>;

    infoButton?: ReactNode;
    footer?: ReactNode;
    author?: ReactNode;
}

export function AddonCard({ disabled, isNew, sourceBadge, tooltip, name, infoButton, footer, author, enabled, setEnabled, description, onMouseEnter, onMouseLeave }: Props) {
    const titleRef = useRef<HTMLDivElement>(null);
    const titleContainerRef = useRef<HTMLDivElement>(null);
    const isNightcordPlugin = typeof name === "string" && (Plugins.NightcordPort as NightcordPortPlugin).isNightcordPlugin(name);
    const resolvedSourceBadge = isNightcordPlugin
        ? <img src="https://nightcord.st/image.png" alt="Nightcord" className={pluginCl("source")} />
        : sourceBadge;
    const resolvedTooltip = isNightcordPlugin ? "Nightcord Plugin" : tooltip;

    return (
        <div
            className={cl("card", { "card-disabled": disabled })}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className={cl("header")}>
                <div className={cl("name-author")}>
                    <BaseText size="md" weight="bold" className={cl("name")}>
                        <div ref={titleContainerRef} className={cl("title-container")}>
                            <div
                                ref={titleRef}
                                className={cl("title")}
                                onMouseOver={() => {
                                    const title = titleRef.current!;
                                    const titleContainer = titleContainerRef.current!;

                                    title.style.setProperty("--offset", `${titleContainer.clientWidth - title.scrollWidth}px`);
                                    title.style.setProperty("--duration", `${Math.max(0.5, (title.scrollWidth - titleContainer.clientWidth) / 7)}s`);
                                }}
                            >
                                {name}
                            </div>
                        </div>
                        {isNew && <Badge text="NEW" variant="danger" />}
                    </BaseText>

                    {!!author && (
                        <BaseText size="md" color="text-subtle" className={cl("author")}>
                            {author}
                        </BaseText>
                    )}
                </div>

                <Tooltip text={resolvedTooltip}>
                    {({ onMouseEnter, onMouseLeave }) => (
                        <div
                            className={cl("source")}
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                        >
                            {resolvedSourceBadge}
                        </div>
                    )}
                </Tooltip>

                {infoButton}

                <Switch
                    checked={enabled}
                    onChange={setEnabled}
                    disabled={disabled}
                />
            </div>

            <div
                className={cl("note")}
                style={{ lineHeight: "1.25em", fontSize: "small" }}
                title={description ? description.toString() : ""}
            >
                {description}
            </div>

            {footer && <div className={cl("footer")}>{footer}</div>}
        </div>
    );
}
