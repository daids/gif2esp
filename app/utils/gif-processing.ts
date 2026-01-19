
import { parseGIF, decompressFrames } from 'gifuct-js';

export interface GifFrameData {
    imageData: ImageData;
    delay: number;
}

export interface ProcessingOptions {
    width: number;
    height: number;
    threshold: number;
    invert: boolean;
    dither: boolean;
    fit: 'stretch' | 'cover' | 'contain';
}

/**
 * Loads and parses a GIF file
 */
export async function loadGifFrames(file: File): Promise<any[]> {
    const buffer = await file.arrayBuffer();
    const gif = parseGIF(buffer);
    const frames = decompressFrames(gif, true);
    return frames;
}

export function extractComposedFrames(rawFrames: any[], gifWidth: number, gifHeight: number): ImageData[] {
    const canvas = new OffscreenCanvas(gifWidth, gifHeight);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No context');

    // Create a temp canvas for the frame patch
    const patchCanvas = new OffscreenCanvas(gifWidth, gifHeight);
    const patchCtx = patchCanvas.getContext('2d');
    if (!patchCtx) throw new Error('No patch context');

    let previousImageData: ImageData | null = null;
    const frames: ImageData[] = [];

    rawFrames.forEach((frame: any) => {
        const { dims, patch, disposalType } = frame;

        // Save current state if disposal is "Restore to Previous" (3)
        // Note: Full support for disposal 3 is complex, usually just keeping a buffer is enough.
        // For simplicity we might ignore complex disposal 3 or just map to 2 if needed, 
        // but let's try to support it by saving the full canvas state before drawing.
        const addFrame = () => {
            frames.push(ctx.getImageData(0, 0, gifWidth, gifHeight));
        };

        // Backup for disposal 3 implies we need the state BEFORE this frame is drawn, 
        // to restore it AFTER this frame is displayed (i.e. for the NEXT frame).
        // But `frames` output needs to be what is SEEN for *this* frame.
        // So sequence is:
        // 1. Handle disposal of PREVIOUS frame (if it was type 2 or 3) -> effectively handled by loop structure usually?
        // Actually, disposal happens AFTER the frame is displayed.
        // So for frame N, we draw on top of N-1's end state. 
        // Then we capture N. 
        // Then we apply N's disposal to prepare for N+1.

        // However, we need to carefully handle the "previous" buffer.

        // let's create the patch
        const patchData = new ImageData(new Uint8ClampedArray(patch), dims.width, dims.height);

        // Save state for disposal 3 (Restore to Previous)
        // We need the state *before* we draw the current patch
        const _backup = disposalType === 3 ? ctx.getImageData(0, 0, gifWidth, gifHeight) : null;

        patchCanvas.width = dims.width;
        patchCanvas.height = dims.height;
        patchCtx.putImageData(patchData, 0, 0);

        // Draw patch to main canvas
        ctx.drawImage(patchCanvas, dims.left, dims.top);

        // Output this frame (this is what the user sees)
        const frameImage = ctx.getImageData(0, 0, gifWidth, gifHeight);
        frames.push(frameImage);

        // Handle Disposal for NEXT frame
        if (disposalType === 2) {
            // Restore to background (clear)
            ctx.clearRect(dims.left, dims.top, dims.width, dims.height);
        } else if (disposalType === 3 && _backup) {
            // Restore to previous
            ctx.putImageData(_backup, 0, 0);
        }
        // Type 1 (Do not dispose) - do nothing, leave it drawn.
    });

    return frames;
}

/**
 * Converts a single RGBA frame to a 1-bit monochrome bitmap (SSD1306 compatible buffer usually)
 * This specific version outputs a flat byte array where 1 bit = 1 pixel.
 * We will format it properly for SSD1306 (Page Addressing) later.
 */
export function processFrame(
    frameImageData: ImageData,
    options: ProcessingOptions
): { pixels: Uint8Array; preview: ImageData } {
    const { width, height, threshold, invert, dither, fit } = options;

    const targetData = new Uint8ClampedArray(width * height * 4);
    const sourceData = frameImageData.data;
    const sw = frameImageData.width;
    const sh = frameImageData.height;

    // Calculate scaling and offsets based on Fit Mode
    let scaleX = width / sw;
    let scaleY = height / sh;
    let offsetX = 0;
    let offsetY = 0;

    if (fit === 'cover') {
        // Scale to cover the entire target area, keeping aspect ratio
        const scale = Math.max(scaleX, scaleY);
        scaleX = scale;
        scaleY = scale;
        // Center the image
        offsetX = (width - sw * scale) / 2;
        offsetY = (height - sh * scale) / 2;
    } else if (fit === 'contain') {
        // Scale to fit within the target area, keeping aspect ratio
        const scale = Math.min(scaleX, scaleY);
        scaleX = scale;
        scaleY = scale;
        // Center the image
        offsetX = (width - sw * scale) / 2;
        offsetY = (height - sh * scale) / 2;
    }
    // 'stretch' (default if not cover/contain) just uses independent scaleX/scaleY as calc'd initially with offset 0

    // Sampling loop
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Map target pixel (x,y) back to source space
            // source_x = (x - offsetX) / scaleX
            // source_y = (y - offsetY) / scaleY

            const srcX = Math.floor((x - offsetX) / scaleX);
            const srcY = Math.floor((y - offsetY) / scaleY);

            let r = 0, g = 0, b = 0, a = 255;

            // Check bounds (essential for crop/contain/cover modes where src might be out of bounds)
            if (srcX >= 0 && srcX < sw && srcY >= 0 && srcY < sh) {
                const srcIdx = (srcY * sw + srcX) * 4;
                r = sourceData[srcIdx];
                g = sourceData[srcIdx + 1];
                b = sourceData[srcIdx + 2];
                a = sourceData[srcIdx + 3];
            } else {
                // Out of bounds (padding for contain mode, or just safety)
                // Default to Black (0,0,0) or White? 
                // Usually black background makes sense for OLED.
                r = 0; g = 0; b = 0; a = 255;
            }

            const targetIdx = (y * width + x) * 4;
            targetData[targetIdx] = r;
            targetData[targetIdx + 1] = g;
            targetData[targetIdx + 2] = b;
            targetData[targetIdx + 3] = a;
        }
    }

    // Now convert to monochrome
    // We'll create the preview ImageData and the binary pixel array simultaneously
    const monoPixels = new Uint8Array(Math.ceil((width * height) / 8));
    // Note: The above is just a raw container. The actual format for SSD1306 (Page addressing) is specific.
    // SSD1306 Page Mode: Each byte is a vertical column of 8 pixels.
    // Byte 0: (0,0) bit0, (0,1) bit1 ... (0,7) bit7
    // Byte 1: (1,0) bit0 ...
    // ...
    // After 'width' bytes, we move to the next page (y=8).

    const ssd1306Buffer = new Uint8Array((width * height) / 8);

    // Dithering error diffusion buffer
    // We'll use Floyd-Steinberg
    // We need a float buffer for error diffusion to avoid premature clamping
    const grayBuffer = new Float32Array(width * height);

    // 1. Convert to Grayscale
    for (let i = 0; i < width * height; i++) {
        const r = targetData[i * 4];
        const g = targetData[i * 4 + 1];
        const b = targetData[i * 4 + 2];
        // Luminance formula
        grayBuffer[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // 2. Process Pixels
    if (dither) {
        // DITHERING MODE (Floyd-Steinberg)

        // If invert is true, we invert the luminance BEFORE dithering
        // This distributes the "black" error correctly across the "white" background or vice-versa
        if (invert) {
            for (let i = 0; i < width * height; i++) {
                grayBuffer[i] = 255 - grayBuffer[i];
            }
        }

        // Clear SSD1306 buffer to zero just in case
        ssd1306Buffer.fill(0);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const oldVal = grayBuffer[idx];
                const newVal = oldVal < threshold ? 0 : 255;
                const quantError = oldVal - newVal;

                // Floyd-Steinberg Error Diffusion
                if (x + 1 < width)
                    grayBuffer[y * width + (x + 1)] += quantError * (7 / 16);
                if (y + 1 < height) {
                    if (x > 0)
                        grayBuffer[(y + 1) * width + (x - 1)] += quantError * (3 / 16);
                    grayBuffer[(y + 1) * width + x] += quantError * (5 / 16);
                    if (x + 1 < width)
                        grayBuffer[(y + 1) * width + (x + 1)] += quantError * (1 / 16);
                }

                // Write to output
                // Since we already inverted the input (if needed), 'newVal' is the final desired intensity
                targetData[idx * 4] = newVal;
                targetData[idx * 4 + 1] = newVal;
                targetData[idx * 4 + 2] = newVal;
                targetData[idx * 4 + 3] = 255; // Alpha full

                if (newVal > 128) {
                    const page = Math.floor(y / 8);
                    const bit = y % 8;
                    const byteIdx = page * width + x;
                    if (byteIdx < ssd1306Buffer.length) {
                        ssd1306Buffer[byteIdx] |= (1 << bit);
                    }
                }
            }
        }
    } else {
        // STANDARD MODE (Simple Threshold)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                let oldPixel = grayBuffer[idx];
                let newPixel = oldPixel < threshold ? 0 : 255;

                if (invert) newPixel = 255 - newPixel;

                // Update the targetData for preview
                targetData[idx * 4] = newPixel;
                targetData[idx * 4 + 1] = newPixel;
                targetData[idx * 4 + 2] = newPixel;
                targetData[idx * 4 + 3] = 255; // Alpha full

                // Store in SSD1306 buffer
                if (newPixel > 128) {
                    const page = Math.floor(y / 8);
                    const bit = y % 8;
                    const byteIdx = page * width + x;
                    if (byteIdx < ssd1306Buffer.length) {
                        ssd1306Buffer[byteIdx] |= (1 << bit);
                    }
                }
            }
        }
    }

    return {
        pixels: ssd1306Buffer,
        preview: new ImageData(targetData, width, height)
    };
}

/**
 * Generates the C Header file content
 */
export function generateHeaderFile(
    framesFrames: Uint8Array[],
    width: number,
    height: number,
    fps: number,
    variableName: string = "animation"
): string {
    const frameCount = framesFrames.length;
    // Calculate buffer size (one frame)
    const bufferSize = framesFrames[0].length;

    let out = `/**
 * Generated by gif2esp
 * Resolution: ${width}x${height}
 * Frames: ${frameCount}
 * FPS: ${fps}
 * Format: SSD1306 Page Addressing (Vertical Byte)
 */

#include <stdint.h>
#include <pgmspace.h> // For ESP8266/ESP32 PROGMEM support if needed

const uint16_t ${variableName}_width = ${width};
const uint16_t ${variableName}_height = ${height};
const uint16_t ${variableName}_frames = ${frameCount};
const uint16_t ${variableName}_fps = ${fps};

`;

    // Write each frame
    framesFrames.forEach((frame, idx) => {
        out += `// Frame ${idx}\n`;
        out += `const uint8_t ${variableName}_frame_${idx}[] = {\n`;
        for (let i = 0; i < frame.length; i++) {
            out += `0x${frame[i].toString(16).padStart(2, '0')}`;
            if (i < frame.length - 1) out += ", ";
            if ((i + 1) % 16 === 0) out += "\n";
        }
        out += "\n};\n\n";
    });

    // Array of pointers
    out += `const uint8_t* const ${variableName}_data[] = {\n`;
    for (let i = 0; i < frameCount; i++) {
        out += `    ${variableName}_frame_${i}`;
        if (i < frameCount - 1) out += ",";
        out += "\n";
    }
    out += "};\n";

    return out;
}
