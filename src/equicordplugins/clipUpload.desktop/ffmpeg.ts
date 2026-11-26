/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { Logger } from "@utils/Logger";

const logger = new Logger("ClipUpload");

let ffmpeg: FFmpeg | null = null;
let ffmpegLoading: Promise<FFmpeg> | null = null;
let conversionCounter = 0;

async function loadFFmpeg() {
    if (ffmpeg?.loaded) return ffmpeg;
    if (ffmpegLoading) return ffmpegLoading;

    ffmpegLoading = (async () => {
        const instance = new FFmpeg();
        const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
        const classWorkerRaw = "var u=\"0.12.9\",R=`https://unpkg.com/@ffmpeg/core@${u}/dist/umd/ffmpeg-core.js`,s;(function(t){t.LOAD=\"LOAD\",t.EXEC=\"EXEC\",t.FFPROBE=\"FFPROBE\",t.WRITE_FILE=\"WRITE_FILE\",t.READ_FILE=\"READ_FILE\",t.DELETE_FILE=\"DELETE_FILE\",t.RENAME=\"RENAME\",t.CREATE_DIR=\"CREATE_DIR\",t.LIST_DIR=\"LIST_DIR\",t.DELETE_DIR=\"DELETE_DIR\",t.ERROR=\"ERROR\",t.DOWNLOAD=\"DOWNLOAD\",t.PROGRESS=\"PROGRESS\",t.LOG=\"LOG\",t.MOUNT=\"MOUNT\",t.UNMOUNT=\"UNMOUNT\"})(s||(s={}));var a=new Error(\"unknown message type\"),f=new Error(\"ffmpeg is not loaded, call `await ffmpeg.load()` first\"),F=new Error(\"called FFmpeg.terminate()\"),O=new Error(\"failed to import ffmpeg-core.js\");var r,l=async({coreURL:t,wasmURL:o,workerURL:e})=>{let n=!r;try{t||(t=R),importScripts(t)}catch{if((!t||t===R)&&(t=R.replace(\"/umd/\",\"/esm/\")),self.createFFmpegCore=(await import(t)).default,!self.createFFmpegCore)throw O}let E=t,c=o||t.replace(/.js$/g,\".wasm\"),m=e||t.replace(/.js$/g,\".worker.js\");return r=await self.createFFmpegCore({mainScriptUrlOrBlob:`${E}#${btoa(JSON.stringify({wasmURL:c,workerURL:m}))}`}),r.setLogger(i=>self.postMessage({type:s.LOG,data:i})),r.setProgress(i=>self.postMessage({type:s.PROGRESS,data:i})),n},D=({args:t,timeout:o=-1})=>{r.setTimeout(o),r.exec(...t);let e=r.ret;return r.reset(),e},I=({args:t,timeout:o=-1})=>{r.setTimeout(o),r.ffprobe(...t);let e=r.ret;return r.reset(),e},S=({path:t,data:o})=>(r.FS.writeFile(t,o),!0),p=({path:t,encoding:o})=>r.FS.readFile(t,{encoding:o}),L=({path:t})=>(r.FS.unlink(t),!0),A=({oldPath:t,newPath:o})=>(r.FS.rename(t,o),!0),N=({path:t})=>(r.FS.mkdir(t),!0),T=({path:t})=>{let o=r.FS.readdir(t),e=[];for(let n of o){let E=r.FS.stat(`${t}/${n}`),c=r.FS.isDir(E.mode);e.push({name:n,isDir:c})}return e},w=({path:t})=>(r.FS.rmdir(t),!0),k=({fsType:t,options:o,mountPoint:e})=>{let n=t,E=r.FS.filesystems[n];return E?(r.FS.mount(E,o,e),!0):!1},_=({mountPoint:t})=>(r.FS.unmount(t),!0);self.onmessage=async({data:{id:t,type:o,data:e}})=>{let n=[],E;try{if(o!==s.LOAD&&!r)throw f;switch(o){case s.LOAD:E=await l(e);break;case s.EXEC:E=D(e);break;case s.FFPROBE:E=I(e);break;case s.WRITE_FILE:E=S(e);break;case s.READ_FILE:E=p(e);break;case s.DELETE_FILE:E=L(e);break;case s.RENAME:E=A(e);break;case s.CREATE_DIR:E=N(e);break;case s.LIST_DIR:E=T(e);break;case s.DELETE_DIR:E=w(e);break;case s.MOUNT:E=k(e);break;case s.UNMOUNT:E=_(e);break;default:throw a}}catch(c){self.postMessage({id:t,type:s.ERROR,data:c.toString()});return}E instanceof Uint8Array&&n.push(E.buffer),self.postMessage({id:t,type:o,data:E},n)};\n";
        const classWorkerBlob = new Blob([(new TextEncoder()).encode(classWorkerRaw)], { type: "text/javascript" });
        const classWorkerURL = URL.createObjectURL(classWorkerBlob);

        try {
            await instance.load({
                coreURL: `${baseURL}/ffmpeg-core.js`,
                wasmURL: `${baseURL}/ffmpeg-core.wasm`,
                workerURL: `${baseURL}/ffmpeg-core.worker.js`,
                classWorkerURL
            });

            ffmpeg = instance;
            logger.info("FFmpeg loaded.");
            return instance;
        } catch (error) {
            instance.terminate();
            ffmpeg = null;
            throw error;
        } finally {
            URL.revokeObjectURL(classWorkerURL);
            ffmpegLoading = null;
        }
    })();

    return ffmpegLoading;
}

function getInputName(fileName: string, id: number) {
    return `input_${id}${fileName.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() ?? ".video"}`;
}

export async function convertClipToMp4(file: File, fileName: string) {
    const id = conversionCounter++;
    const inputName = getInputName(file.name, id);
    const outputName = `output_${id}.mp4`;
    const ff = await loadFFmpeg();

    try {
        await ff.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));

        const exitCode = await ff.exec([
            "-i", inputName,
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-profile:v", "high",
            "-level:v", "4.0",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            outputName
        ]);

        if (exitCode !== 0) throw new Error("Couldn't convert the selected file.");

        const data = await ff.readFile(outputName);
        if (typeof data === "string") throw new Error("Couldn't read the converted file.");

        return new File([new Uint8Array(data)], fileName, { type: "video/mp4" });
    } finally {
        await Promise.all([
            ff.deleteFile(inputName).catch(() => undefined),
            ff.deleteFile(outputName).catch(() => undefined)
        ]);
    }
}
