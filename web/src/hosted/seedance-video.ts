export function seedanceReferenceLabel(kind: "image" | "video" | "audio", index: number) {
    const label = kind === "image" ? "图片" : kind === "video" ? "视频" : "音频";
    return `${label}${index}`;
}
