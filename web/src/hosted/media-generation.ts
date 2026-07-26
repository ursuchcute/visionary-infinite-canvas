import type { UploadedFile } from "@/services/file-storage";

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "seedance" | "plugin"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

function unsupported(): never {
    throw new Error("Hosted 首发暂不支持视频或音频生成。");
}

export async function requestAudioGeneration(): Promise<Blob> {
    return unsupported();
}

export async function storeGeneratedAudio(): Promise<UploadedFile> {
    return unsupported();
}

export async function requestVideoGeneration(): Promise<VideoGenerationResult> {
    return unsupported();
}

export async function createVideoGenerationTask(): Promise<VideoGenerationTask> {
    return unsupported();
}

export async function pollVideoGenerationTask(): Promise<VideoGenerationTaskState> {
    return unsupported();
}

export async function storeGeneratedVideo(): Promise<UploadedFile> {
    return unsupported();
}
