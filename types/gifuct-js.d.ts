
declare module 'gifuct-js' {
    export function parseGIF(buffer: ArrayBuffer): any;
    export function decompressFrames(gif: any, buildImagePatches: boolean): any[];
}
