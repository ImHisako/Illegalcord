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

declare module "typed-emitter" {
    type Listener<Events, Event extends keyof Events> = Events[Event] extends (...args: infer Args) => infer Return
        ? (...args: Args) => Return
        : never;

    type EventArgs<Events, Event extends keyof Events> = Events[Event] extends (...args: infer Args) => unknown ? Args : never;

    type TypedEmitter<Events> = {
        on<Event extends keyof Events>(event: Event, listener: Listener<Events, Event>): TypedEmitter<Events>;
        once<Event extends keyof Events>(event: Event, listener: Listener<Events, Event>): TypedEmitter<Events>;
        off<Event extends keyof Events>(event: Event, listener: Listener<Events, Event>): TypedEmitter<Events>;
        removeListener<Event extends keyof Events>(event: Event, listener: Listener<Events, Event>): TypedEmitter<Events>;
        emit<Event extends keyof Events>(event: Event, ...args: EventArgs<Events, Event>): boolean;
    };

    export default TypedEmitter;
}
