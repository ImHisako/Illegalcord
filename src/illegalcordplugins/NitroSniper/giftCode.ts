/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Constants, RestAPI } from "@webpack/common";

import type { GiftCodeResolution } from "./types";

export async function resolveGiftType(code: string): Promise<string | null> {
    try {
        const response: { body: GiftCodeResolution; } = await RestAPI.get({
            url: Constants.Endpoints.GIFT_CODE_RESOLVE(code),
            query: {
                with_application: false,
                with_subscription_plan: true
            },
            oldFormErrors: true
        });

        return response.body.subscription_plan?.name ?? response.body.store_listing?.sku?.name ?? null;
    } catch {
        return null;
    }
}
