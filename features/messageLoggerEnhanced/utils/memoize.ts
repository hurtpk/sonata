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

type MemoizedFunction<T extends (...args: any[]) => any> = {
    (...args: Parameters<T>): ReturnType<T>;
    clear(): void;
};

/**
 * Remembers results by their arguments. `max` keeps only the most recently used results (unlimited
 * when not given): MessageStore.getMessage runs this for every logged message, many times a second,
 * and an unlimited cache kept a full copy of every one of those messages for the whole session.
 */
export function memoize<T extends (...args: any[]) => any>(func: T, max = Infinity): MemoizedFunction<T> {
    const cache = new Map<string, ReturnType<T>>();

    const memoizedFunc = (...args: Parameters<T>): ReturnType<T> => {
        const key = JSON.stringify(args);
        if (cache.has(key)) {
            const hit = cache.get(key)!;
            // Most recently used last, so the oldest is first in line to go.
            cache.delete(key);
            cache.set(key, hit);
            return hit;
        }

        const result = func(...args);
        cache.set(key, result);
        if (cache.size > max) cache.delete(cache.keys().next().value!);
        return result;
    };

    memoizedFunc.clear = () => cache.clear();

    return memoizedFunc;
}
