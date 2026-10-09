// This is the existing public R2 origin allowed by the Hosted media policy.
export const HOSTED_REFERENCE_UPLOAD_ORIGIN = "https://555acb10d58a7ff33a36dc527b319fb0.r2.cloudflarestorage.com";
export const DEV_VIDEO_REFERENCE_UPLOAD_PATH = "/__dev/video-reference-upload";

export function videoReferenceUploadUrl(raw: string, development: boolean) {
    const target = new URL(raw);
    if (target.protocol !== "https:" || target.username || target.password) throw new Error("参考图片上传地址无效。");
    return development && target.origin === HOSTED_REFERENCE_UPLOAD_ORIGIN ? `${DEV_VIDEO_REFERENCE_UPLOAD_PATH}${target.pathname}${target.search}` : target.href;
}

export function isDevVideoReferenceUpload(method: string | undefined, raw: string | undefined) {
    const target = new URL(raw || "/", "http://localhost");
    return method === "PUT" && /^\/__dev\/video-reference-upload\/[^/]+\/video-references\//.test(target.pathname) && /^[a-f0-9]{64}$/.test(target.searchParams.get("X-Amz-Signature") || "");
}
