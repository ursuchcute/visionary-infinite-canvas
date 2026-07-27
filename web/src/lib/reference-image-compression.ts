const MAX_REFERENCE_IMAGE_BYTES = 6 * 1024 * 1024;
const REFERENCE_IMAGE_COMPRESSION_TRIGGER_BYTES = 3 * 1024 * 1024;
const MAX_REFERENCE_INPUT_BYTES = 30 * 1024 * 1024;
const DIRECT_UPLOAD_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MPO_SIGNATURE = new Uint8Array([0x4d, 0x50, 0x46, 0x00]);

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    reject(new Error("无法压缩参考图片。"));
                    return;
                }
                resolve(blob);
            },
            type,
            quality,
        );
    });
}

function loadImage(blob: Blob) {
    return new Promise<{ image: HTMLImageElement; objectUrl: string }>((resolve, reject) => {
        const objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => resolve({ image, objectUrl });
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("参考图片读取失败。"));
        };
        image.src = objectUrl;
    });
}

function compressionProfile(size: number, maxBytes: number) {
    if (size <= maxBytes) return { maxEdge: 3000, quality: 0.92, minQuality: 0.84, minEdge: 1800 };
    if (size <= 12 * 1024 * 1024) return { maxEdge: 2560, quality: 0.9, minQuality: 0.78, minEdge: 1700 };
    return { maxEdge: 2400, quality: 0.88, minQuality: 0.74, minEdge: 1600 };
}

async function isMpoImage(blob: Blob) {
    if (!["image/jpeg", "image/jpg", ""].includes(blob.type.toLowerCase())) return false;
    const bytes = new Uint8Array(await blob.slice(0, Math.min(blob.size, 512 * 1024)).arrayBuffer());
    if (bytes.length < 8 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
    for (let index = 0; index <= bytes.length - MPO_SIGNATURE.length; index += 1) {
        if (bytes[index] === MPO_SIGNATURE[0] && bytes[index + 1] === MPO_SIGNATURE[1] && bytes[index + 2] === MPO_SIGNATURE[2] && bytes[index + 3] === MPO_SIGNATURE[3]) return true;
    }
    return false;
}

function scaledDimensions(width: number, height: number, maxEdge: number) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

async function encodeImage(image: HTMLImageElement, maxEdge: number, quality: number, type: "image/webp" | "image/jpeg") {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const dimensions = scaledDimensions(width, height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d", { alpha: type === "image/webp" });
    if (!context) throw new Error("无法创建图片压缩画布。");
    if (type === "image/jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, dimensions.width, dimensions.height);
    } else {
        context.clearRect(0, 0, dimensions.width, dimensions.height);
    }
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
    return canvasToBlob(canvas, type, quality);
}

/**
 * Uses the main site's reference-image policy for Canvas submissions:
 * small JPEG/PNG/WebP files are left untouched, while larger files are
 * progressively encoded and scaled until they fit the server's 6MB limit.
 * The source Blob remains unchanged so the node preview keeps its original
 * quality.
 */
export async function prepareReferenceImageForUpload(source: Blob, maxBytes = MAX_REFERENCE_IMAGE_BYTES) {
    if (!source.type.toLowerCase().startsWith("image/")) throw new Error("参考文件不是有效图片。");
    if (source.size > MAX_REFERENCE_INPUT_BYTES) throw new Error("参考图片不能超过 30MB。");
    const targetBytes = Math.max(512 * 1024, Math.min(MAX_REFERENCE_IMAGE_BYTES, Math.floor(maxBytes)));
    const isMpo = await isMpoImage(source);
    if (!isMpo && source.size <= Math.min(REFERENCE_IMAGE_COMPRESSION_TRIGGER_BYTES, targetBytes) && DIRECT_UPLOAD_IMAGE_TYPES.has(source.type.toLowerCase())) return source;

    const { image, objectUrl } = await loadImage(source);
    const profile = compressionProfile(source.size, targetBytes);
    let maxEdge = profile.maxEdge;
    let quality = profile.quality;
    let smallest: Blob | null = null;

    try {
        for (let attempt = 0; attempt < 7; attempt += 1) {
            let encoded = await encodeImage(image, maxEdge, quality, "image/webp").catch(() => null);
            if (!encoded) encoded = await encodeImage(image, maxEdge, quality, "image/jpeg");
            if (!smallest || encoded.size < smallest.size) smallest = encoded;
            if (encoded.size <= targetBytes) {
                if (!isMpo && source.size <= targetBytes && encoded.size > source.size * 0.85 && DIRECT_UPLOAD_IMAGE_TYPES.has(source.type.toLowerCase())) return source;
                return encoded;
            }
            quality = Math.max(profile.minQuality, quality - 0.05);
            maxEdge = Math.max(profile.minEdge, Math.round(maxEdge * 0.86));
        }

        if (!isMpo && source.size <= targetBytes && DIRECT_UPLOAD_IMAGE_TYPES.has(source.type.toLowerCase())) return source;
        if (smallest && smallest.size <= targetBytes) return smallest;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }

    throw new Error("参考图片压缩后仍超过上传限制，请换一张图片后再试。");
}

export const referenceImageCompressionLimits = {
    maxBytes: MAX_REFERENCE_IMAGE_BYTES,
    triggerBytes: REFERENCE_IMAGE_COMPRESSION_TRIGGER_BYTES,
    maxInputBytes: MAX_REFERENCE_INPUT_BYTES,
};
