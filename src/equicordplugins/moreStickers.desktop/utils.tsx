/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { classNameFactory } from "@utils/css";
import { PluginNative } from "@utils/types";
import { waitFor } from "@webpack";
import { React } from "@webpack/common";

import { FFmpegState } from "./types";

export const cl = classNameFactory("vc-more-stickers-");
export const clPicker = (className: string, ...args: any[]) => cl("picker-" + className, ...args);

const Native = VencordNative.pluginHelpers.MoreStickers as PluginNative<typeof import("./native")>;

export async function nativeFetch(url: string | URL, init?: RequestInit) {
    const { status, type, data } = await Native.fetchLine(url.toString(), init);
    return new Response(data, { status, headers: { "content-type": type } });
}

export class Mutex {
    current = Promise.resolve();
    lock() {
        let _resolve: () => void;
        const p = new Promise(resolve => {
            _resolve = () => resolve();
        }) as Promise<void>;
        // Caller gets a promise that resolves when the current outstanding
        // lock resolves
        const rv = this.current.then(() => _resolve);
        // Don't allow the next request until the new promise is done
        this.current = p;
        // Return the new promise
        return rv;
    }
}

export let FFmpegStateContext: React.Context<FFmpegState | undefined> | undefined;
waitFor("createContext", () => {
    FFmpegStateContext = React.createContext<FFmpegState | undefined>(undefined);
});

export async function loadFFmpeg(ffmpeg: FFmpeg, setLoaded: () => void) {
    console.log("Loading FFmpeg...");
    const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

    const classWorkerRaw = "var u=\"0.12.9\",R=`https://unpkg.com/@ffmpeg/core@${u}/dist/umd/ffmpeg-core.js`,s;(function(t){t.LOAD=\"LOAD\",t.EXEC=\"EXEC\",t.FFPROBE=\"FFPROBE\",t.WRITE_FILE=\"WRITE_FILE\",t.READ_FILE=\"READ_FILE\",t.DELETE_FILE=\"DELETE_FILE\",t.RENAME=\"RENAME\",t.CREATE_DIR=\"CREATE_DIR\",t.LIST_DIR=\"LIST_DIR\",t.DELETE_DIR=\"DELETE_DIR\",t.ERROR=\"ERROR\",t.DOWNLOAD=\"DOWNLOAD\",t.PROGRESS=\"PROGRESS\",t.LOG=\"LOG\",t.MOUNT=\"MOUNT\",t.UNMOUNT=\"UNMOUNT\"})(s||(s={}));var a=new Error(\"unknown message type\"),f=new Error(\"ffmpeg is not loaded, call `await ffmpeg.load()` first\"),F=new Error(\"called FFmpeg.terminate()\"),O=new Error(\"failed to import ffmpeg-core.js\");var r,l=async({coreURL:t,wasmURL:o,workerURL:e})=>{let n=!r;try{t||(t=R),importScripts(t)}catch{if((!t||t===R)&&(t=R.replace(\"/umd/\",\"/esm/\")),self.createFFmpegCore=(await import(t)).default,!self.createFFmpegCore)throw O}let E=t,c=o||t.replace(/.js$/g,\".wasm\"),m=e||t.replace(/.js$/g,\".worker.js\");return r=await self.createFFmpegCore({mainScriptUrlOrBlob:`${E}#${btoa(JSON.stringify({wasmURL:c,workerURL:m}))}`}),r.setLogger(i=>self.postMessage({type:s.LOG,data:i})),r.setProgress(i=>self.postMessage({type:s.PROGRESS,data:i})),n},D=({args:t,timeout:o=-1})=>{r.setTimeout(o),r.exec(...t);let e=r.ret;return r.reset(),e},I=({args:t,timeout:o=-1})=>{r.setTimeout(o),r.ffprobe(...t);let e=r.ret;return r.reset(),e},S=({path:t,data:o})=>(r.FS.writeFile(t,o),!0),p=({path:t,encoding:o})=>r.FS.readFile(t,{encoding:o}),L=({path:t})=>(r.FS.unlink(t),!0),A=({oldPath:t,newPath:o})=>(r.FS.rename(t,o),!0),N=({path:t})=>(r.FS.mkdir(t),!0),T=({path:t})=>{let o=r.FS.readdir(t),e=[];for(let n of o){let E=r.FS.stat(`${t}/${n}`),c=r.FS.isDir(E.mode);e.push({name:n,isDir:c})}return e},w=({path:t})=>(r.FS.rmdir(t),!0),k=({fsType:t,options:o,mountPoint:e})=>{let n=t,E=r.FS.filesystems[n];return E?(r.FS.mount(E,o,e),!0):!1},_=({mountPoint:t})=>(r.FS.unmount(t),!0);self.onmessage=async({data:{id:t,type:o,data:e}})=>{let n=[],E;try{if(o!==s.LOAD&&!r)throw f;switch(o){case s.LOAD:E=await l(e);break;case s.EXEC:E=D(e);break;case s.FFPROBE:E=I(e);break;case s.WRITE_FILE:E=S(e);break;case s.READ_FILE:E=p(e);break;case s.DELETE_FILE:E=L(e);break;case s.RENAME:E=A(e);break;case s.CREATE_DIR:E=N(e);break;case s.LIST_DIR:E=T(e);break;case s.DELETE_DIR:E=w(e);break;case s.MOUNT:E=k(e);break;case s.UNMOUNT:E=_(e);break;default:throw a}}catch(c){self.postMessage({id:t,type:s.ERROR,data:c.toString()});return}E instanceof Uint8Array&&n.push(E.buffer),self.postMessage({id:t,type:o,data:E},n)};\n";
    const classWorkerBlob = new Blob([(new TextEncoder()).encode(classWorkerRaw)], { type: "text/javascript" });
    const classWorkerUrl = URL.createObjectURL(classWorkerBlob);

    try {
        await ffmpeg.load({
            coreURL: `${baseURL}/ffmpeg-core.js`,
            wasmURL: `${baseURL}/ffmpeg-core.wasm`,
            workerURL: `${baseURL}/ffmpeg-core.worker.js`,
            classWorkerURL: classWorkerUrl,
        });
    } finally {
        URL.revokeObjectURL(classWorkerUrl);
    }
    setLoaded();
    console.log("FFmpeg loaded!");
}
