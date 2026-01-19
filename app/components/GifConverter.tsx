
'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileImage, Download, Copy, RefreshCw, Settings, Smartphone, Check } from 'lucide-react';
import { loadGifFrames, extractComposedFrames, processFrame, generateHeaderFile } from '../utils/gif-processing';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export default function GifConverter() {
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [sourceFrames, setSourceFrames] = useState<ImageData[]>([]);
    const [gifDuration, setGifDuration] = useState(0);

    // Settings
    const [width, setWidth] = useState(128);
    const [height, setHeight] = useState(64);
    const [threshold, setThreshold] = useState(128);
    const [invert, setInvert] = useState(false);
    const [dither, setDither] = useState(true);
    const [fit, setFit] = useState<'stretch' | 'cover' | 'contain'>('cover');
    const [fps, setFps] = useState(30);
    const [varName, setVarName] = useState("my_animation");
    const [useCompression, setUseCompression] = useState(false);

    // Output
    const [processedFrames, setProcessedFrames] = useState<{ pixels: Uint8Array; preview: ImageData }[]>([]);
    const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
    const [code, setCode] = useState("");
    const [generated, setGenerated] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const requestRef = useRef<number>(0);
    const startTimeRef = useRef<number>(0);

    // Debounced processing trigger
    useEffect(() => {
        if (sourceFrames.length === 0) return;

        const timer = setTimeout(() => {
            processAllFrames();
        }, 500); // 500ms debounce

        return () => clearTimeout(timer);
    }, [sourceFrames, width, height, threshold, invert, dither, fit]);

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        const f = acceptedFiles[0];
        if (!f) return;
        setFile(f);
        setLoading(true);
        setGenerated(false);

        try {
            const rawFrames = await loadGifFrames(f);
            // We assume the first frame dims are roughly indicative or we use the gif header dims
            // parseGIF usually gives a logic screen width/height, but loadGifFrames just returns frames.
            // We need logic screen size. 
            // Actually gifuct-js `parseGIF` return object has `lsd` (Logical Screen Descriptor) with width/height.
            // But my `loadGifFrames` wrapper didn't expose it.
            // I'll update the wrapper or just guess from the first frame or let user set it. 
            // Ideally I should detect it. Use first frame dims for now as fallback.
            const w = rawFrames[0]?.dims.width || 128;
            const h = rawFrames[0]?.dims.height || 64;

            const composed = extractComposedFrames(rawFrames, w, h);
            setSourceFrames(composed);

            // Auto-set aspect-ratio correct dimensions if possible?
            // For now default to 128x64 but maybe respect aspect ratio?
            // Let's stick to user defaults 128x64 as it's the target hardware usually.

        } catch (err) {
            console.error(err);
            alert("GIF 解析失败");
        } finally {
            setLoading(false);
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'image/gif': ['.gif'] },
        maxFiles: 1
    });

    const processAllFrames = () => {
        if (!sourceFrames.length) return;

        const newProcessed = sourceFrames.map(frame => {
            return processFrame(frame, {
                width,
                height,
                threshold,
                invert,
                dither,
                fit
            });
        });

        setProcessedFrames(newProcessed);
        setGenerated(true);
    };

    // Animation Loop for Preview
    useEffect(() => {
        if (!processedFrames.length) return;

        const animate = (time: number) => {
            if (!startTimeRef.current) startTimeRef.current = time;
            // Calculate frame based on FPS
            const elapsed = time - startTimeRef.current;
            const frameInterval = 1000 / fps;
            const frameIdx = Math.floor(elapsed / frameInterval) % processedFrames.length;

            setCurrentFrameIndex(frameIdx);

            // Draw
            const ctx = canvasRef.current?.getContext('2d');
            if (ctx) {
                ctx.putImageData(processedFrames[frameIdx].preview, 0, 0);
            }

            requestRef.current = requestAnimationFrame(animate);
        };

        requestRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(requestRef.current);
    }, [processedFrames, fps]);

    const handleGenerateCode = () => {
        if (!processedFrames.length) return;

        const pixels = processedFrames.map(p => p.pixels);
        const c = generateHeaderFile(pixels, width, height, fps, varName, useCompression);
        setCode(c);
    };

    // Re-generate code when processed frames update if we already generated it once
    useEffect(() => {
        if (generated && code) {
            handleGenerateCode();
        }
    }, [processedFrames, varName, useCompression]);

    // Force code generation on first valid process
    useEffect(() => {
        if (generated && !code && processedFrames.length) {
            handleGenerateCode();
        }
    }, [generated, processedFrames]);

    const copyToClipboard = () => {
        navigator.clipboard.writeText(code);
        // maybe show toast
    };

    const downloadHeader = () => {
        const blob = new Blob([code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${varName}.h`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto p-6">

            <header className="flex flex-col gap-2 mb-4">
                <h2 className="text-3xl font-bold bg-gradient-to-r from-indigo-500 to-purple-600 bg-clip-text text-transparent">
                    GIF 转 SSD1306 转换器
                </h2>
                <p className="text-zinc-500 dark:text-zinc-400">
                    将 GIF 动画转换为适用于 ESP32/Arduino OLED 显示屏的 C 语言字节数组。
                </p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Column: Input & Controls */}
                <div className="lg:col-span-5 flex flex-col gap-6">

                    {/* Upload Area */}
                    <div
                        {...getRootProps()}
                        className={cn(
                            "border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-all cursor-pointer",
                            isDragActive ? "border-indigo-500 bg-indigo-50/10" : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50"
                        )}
                    >
                        <input {...getInputProps()} />
                        {file ? (
                            <div className="flex flex-col items-center gap-2">
                                <FileImage className="w-10 h-10 text-indigo-500" />
                                <p className="font-medium">{file.name}</p>
                                <p className="text-xs text-zinc-500">{(file.size / 1024).toFixed(1)} KB</p>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setFile(null); setSourceFrames([]); setCode(""); }}
                                    className="mt-2 text-xs text-red-500 hover:text-red-600 font-medium"
                                >
                                    移除
                                </button>
                            </div>
                        ) : (
                            <>
                                <Upload className="w-10 h-10 text-zinc-400 mb-2" />
                                <p className="text-sm font-medium">拖拽 GIF 到这里</p>
                                <p className="text-xs text-zinc-500 mt-1">或点击浏览</p>
                            </>
                        )}
                    </div>

                    {/* Controls */}
                    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm flex flex-col gap-6">
                        <div className="flex items-center gap-2 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                            <Settings className="w-4 h-4 text-zinc-500" />
                            <h3 className="font-semibold text-sm">参数配置</h3>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-zinc-500">宽度 (px)</label>
                                <input
                                    type="number"
                                    value={width}
                                    onChange={e => setWidth(Number(e.target.value))}
                                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-zinc-500">高度 (px)</label>
                                <input
                                    type="number"
                                    value={height}
                                    onChange={e => setHeight(Number(e.target.value))}
                                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between">
                                <label className="text-xs font-medium text-zinc-500">黑白阈值 ({threshold})</label>
                            </div>
                            <input
                                type="range"
                                min="1" max="255"
                                value={threshold}
                                onChange={e => setThreshold(Number(e.target.value))}
                                className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-zinc-500">帧率 (FPS)</label>
                                <input
                                    type="number"
                                    value={fps}
                                    onChange={e => setFps(Number(e.target.value))}
                                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-zinc-500">变量名</label>
                                <input
                                    type="text"
                                    value={varName}
                                    onChange={e => setVarName(e.target.value)}
                                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                            </div>
                        </div>


                        <div className="space-y-2">
                            <label className="text-xs font-medium text-zinc-500">缩放模式</label>
                            <div className="flex bg-zinc-50 dark:bg-zinc-800 rounded-lg p-1 border border-zinc-200 dark:border-zinc-700">
                                <button
                                    onClick={() => setFit('stretch')}
                                    className={cn(
                                        "flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                        fit === 'stretch'
                                            ? "bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-400 shadow-sm"
                                            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                    )}
                                >
                                    拉伸
                                </button>
                                <button
                                    onClick={() => setFit('cover')}
                                    className={cn(
                                        "flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                        fit === 'cover'
                                            ? "bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-400 shadow-sm"
                                            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                    )}
                                >
                                    裁剪居中
                                </button>
                                <button
                                    onClick={() => setFit('contain')}
                                    className={cn(
                                        "flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                        fit === 'contain'
                                            ? "bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-400 shadow-sm"
                                            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                    )}
                                >
                                    包含
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-col gap-3">
                            <label className="flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                                <input type="checkbox" checked={invert} onChange={e => setInvert(e.target.checked)} className="w-4 h-4 rounded text-indigo-500" />
                                <span className="text-sm font-medium">反转颜色</span>
                            </label>
                            <label className="flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                                <input type="checkbox" checked={dither} onChange={e => setDither(e.target.checked)} className="w-4 h-4 rounded text-indigo-500" />
                                <span className="text-sm font-medium">抖动算法 (Floyd-Steinberg)</span>
                            </label>
                            <label className="flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                                <input type="checkbox" checked={useCompression} onChange={e => setUseCompression(e.target.checked)} className="w-4 h-4 rounded text-indigo-500" />
                                <span className="text-sm font-medium">启用 RLE 压缩 (节省空间)</span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Right Column: Preview & Output */}
                <div className="lg:col-span-7 flex flex-col gap-6">

                    {/* Preview Card */}
                    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm min-h-[300px] flex flex-col items-center justify-center relative overflow-hidden">
                        <div className="absolute top-4 left-4 flex gap-2">
                            <div className="px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 text-xs font-medium text-zinc-500">
                                预览 ({width}x{height})
                            </div>
                        </div>

                        {loading ? (
                            <div className="animate-pulse flex flex-col items-center">
                                <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mb-2" />
                                <span className="text-sm text-zinc-500">处理帧中...</span>
                            </div>
                        ) : processedFrames.length > 0 ? (
                            <div className="flex flex-col items-center gap-4">
                                <div className="p-4 bg-zinc-100 dark:bg-black rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-inner">
                                    {/* We assume pixel ratio is 1:1, but on HighDPI screens it might be tiny. Lets scale it up with CSS */}
                                    <canvas
                                        ref={canvasRef}
                                        width={width}
                                        height={height}
                                        className="image-pixelated"
                                        style={{ width: width * 2, height: height * 2 }} // 2x Zoom
                                    />
                                </div>
                                <div className="flex gap-4 text-xs text-zinc-500">
                                    <span>帧: {currentFrameIndex + 1} / {processedFrames.length}</span>
                                </div>
                            </div>
                        ) : (
                            <div className="text-zinc-400 flex flex-col items-center">
                                <Smartphone className="w-12 h-12 mb-2 opacity-20" />
                                <p>上传 GIF 以查看预览</p>
                            </div>
                        )}
                    </div>

                    {/* Code Output */}
                    <div className="bg-[#1e1e1e] rounded-xl border border-zinc-800 overflow-hidden flex flex-col h-[400px]">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 bg-[#252526]">
                            <span className="text-xs font-mono text-zinc-400">output.h</span>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleGenerateCode}
                                    className="p-1.5 hover:bg-white/10 rounded-md text-zinc-400 hover:text-white transition"
                                    title="重新生成"
                                >
                                    <RefreshCw size={14} />
                                </button>
                                <button
                                    onClick={copyToClipboard}
                                    className="p-1.5 hover:bg-white/10 rounded-md text-zinc-400 hover:text-white transition"
                                    title="复制代码"
                                >
                                    <Copy size={14} />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto p-4 font-mono text-xs text-blue-200">
                            {code ? (
                                <pre className="whitespace-pre-wrap break-all">
                                    {code}
                                </pre>
                            ) : (
                                <div className="h-full flex items-center justify-center text-zinc-600 italic">
                                    代码将显示在这里...
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-zinc-700 bg-[#252526] flex justify-end">
                            <button
                                onClick={downloadHeader}
                                disabled={!code}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                            >
                                <Download size={16} />
                                下载 .h 文件
                            </button>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
