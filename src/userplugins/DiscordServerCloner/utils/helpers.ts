import { state } from "../store";

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const randomDelay = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

export function escapeHtml(str: string): string {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode.apply(null, chunk as any);
    }
    return btoa(binary);
}

export function compareVersions(v1: string, v2: string): number {
    const clean1 = v1.replace(/[^0-9.]/g, '');
    const clean2 = v2.replace(/[^0-9.]/g, '');

    const parts1 = clean1.split('.').map(n => parseInt(n) || 0);
    const parts2 = clean2.split('.').map(n => parseInt(n) || 0);

    const maxLength = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLength; i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;

        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }

    return 0;
}

export const replaceEmojis = (text: string | null | undefined): string | null | undefined => {
    if (!text) return text;
    return text.replace(/<(a?):([a-zA-Z0-9_]+):(\d+)>/g, (match, animated, name, id) => {
        if (state.emojiIdMap[id]) return `<${animated}:${name}:${state.emojiIdMap[id]}>`;
        return match;
    });
};
