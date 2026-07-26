import { usePromptStore, type PersonalPrompt } from "@/stores/use-prompt-store";

export type Prompt = {
    id: string;
    title: string;
    prompt: string;
    description: string;
    coverUrl: string;
    referenceImageUrls: string[];
    tags: string[];
    preview: string;
    createdAt: string;
    updatedAt: string;
    author?: string;
    sourceUrl?: string;
    imageMode?: string;
    imageModel?: string;
    imageSize?: string;
    imageCount?: number;
    sourceId: string;
    category: string;
    githubUrl: string;
};

export const ALL_PROMPTS_OPTION = "全部";
export const PERSONAL_PROMPTS_CATEGORY = "收藏";

export type PromptSourceStatus = {
    sourceId: string;
    count: number;
    lastSuccessAt: string;
    lastError: string;
};

export type PromptSourceRefreshResult = PromptSourceStatus & {
    sourceName: string;
    success: boolean;
};

export type PromptSourceRefreshSummary = {
    results: PromptSourceRefreshResult[];
    total: number;
    successCount: number;
    failureCount: number;
};

export function personalPromptToPrompt(item: PersonalPrompt): Prompt {
    return {
        ...item,
        coverUrl: item.coverUrl || item.referenceImageUrls[0] || "",
        sourceId: "personal",
        category: PERSONAL_PROMPTS_CATEGORY,
        githubUrl: "",
        preview: "",
    };
}

export async function fetchPrompts({
    keyword = "",
    tag = [],
    category = ALL_PROMPTS_OPTION,
    page = 1,
    pageSize = 20,
    includePersonal = true,
}: { keyword?: string; tag?: string[]; category?: string; page?: number; pageSize?: number; includePersonal?: boolean } = {}) {
    const allItems = includePersonal ? usePromptStore.getState().prompts.map(personalPromptToPrompt) : [];
    const normalizedKeyword = keyword.trim().toLowerCase();
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.max(1, Math.min(100, pageSize));
    const filtered = filterPrompts(allItems, normalizedKeyword, category, tag);
    const withoutTagFilter = filterPrompts(allItems, normalizedKeyword, category, []);
    return {
        items: filtered.slice((normalizedPage - 1) * normalizedPageSize, normalizedPage * normalizedPageSize),
        tags: collectTags(withoutTagFilter),
        categories: allItems.length ? [PERSONAL_PROMPTS_CATEGORY] : [],
        total: filtered.length,
    };
}

export async function fetchSourcePrompts(_sourceId: string): Promise<Prompt[]> {
    return [];
}

export async function refreshSource(sourceId: string): Promise<PromptSourceRefreshResult> {
    return {
        sourceId,
        sourceName: "",
        count: 0,
        lastSuccessAt: "",
        lastError: "Hosted 模式不支持外部提示词来源。",
        success: false,
    };
}

export async function refreshAllSources(): Promise<PromptSourceRefreshSummary> {
    return emptyRefreshSummary();
}

export async function refreshDueSources(_maxAgeMs: number): Promise<PromptSourceRefreshSummary> {
    return emptyRefreshSummary();
}

export async function fetchPromptSourceStatuses(): Promise<Record<string, PromptSourceStatus>> {
    return {};
}

export function formatPromptDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function filterPrompts(items: Prompt[], keyword: string, category: string, tags: string[]) {
    return items.filter((item) => {
        if (category && category !== ALL_PROMPTS_OPTION && category !== "all" && item.category !== category) return false;
        if (tags.length && !tags.some((tag) => item.tags.includes(tag))) return false;
        if (!keyword) return true;
        return [item.title, item.prompt, item.description, item.category, ...item.tags].join(" ").toLowerCase().includes(keyword);
    });
}

function collectTags(items: Prompt[]) {
    return Array.from(new Set(items.flatMap((item) => item.tags).filter(Boolean)));
}

function emptyRefreshSummary(): PromptSourceRefreshSummary {
    return { results: [], total: 0, successCount: 0, failureCount: 0 };
}
