import { BookmarkPlus, FolderPlus, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { type ReactNode, type UIEvent, useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, Popconfirm, Space, Spin, Tabs, Tag, Tooltip } from "antd";

import { PromptCard } from "@/components/prompts/prompt-card";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { MyPromptEditorDialog } from "./components/my-prompt-editor-dialog";
import { PromptDetailDialog } from "./components/prompt-detail-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/use-asset-store";
import { usePromptStore, type PersonalPrompt, type PersonalPromptInput } from "@/stores/use-prompt-store";
import { ALL_PROMPTS_OPTION, personalPromptToPrompt, type Prompt } from "@/services/api/prompts";

export default function PromptsPage() {
    const { message } = App.useApp();
    const [activeTab, setActiveTab] = useState("library");
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingPrompt, setEditingPrompt] = useState<PersonalPrompt | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);
    const personalPrompts = usePromptStore((state) => state.prompts);
    const addPrompt = usePromptStore((state) => state.addPrompt);
    const updatePrompt = usePromptStore((state) => state.updatePrompt);
    const removePrompt = usePromptStore((state) => state.removePrompt);
    const copyText = useCopyText();
    const { query, items: promptItems, tags: promptTags, categories: promptCategoryOptions, total: totalPrompts } = usePromptList({ keyword: titleKeyword, tags: selectedTags, category: selectedCategory, enabled: activeTab === "library" });
    const filteredPersonalPrompts = useMemo(() => {
        const keyword = titleKeyword.trim().toLowerCase();
        if (!keyword) return personalPrompts;
        return personalPrompts.filter((item) => [item.title, item.prompt, item.description, ...item.tags].join(" ").toLowerCase().includes(keyword));
    }, [personalPrompts, titleKeyword]);

    useEffect(() => {
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : "获取提示词失败");
    }, [message, query.error, query.isError]);

    const toggleTag = (tag: string) => {
        if (tag === ALL_PROMPTS_OPTION) return setSelectedTags([]);
        setSelectedTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]));
    };

    const savePromptAsset = (item: Prompt) => {
        addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl } });
        message.success("已加入资产");
    };

    const saveToFavorites = (item: Prompt) => {
        addPrompt(toPersonalInput(item));
        message.success("已收藏");
    };

    const openNewPrompt = () => {
        setEditingPrompt(null);
        setEditorOpen(true);
    };

    const openEditPrompt = (item: PersonalPrompt) => {
        setEditingPrompt(item);
        setEditorOpen(true);
    };

    const savePersonalPrompt = (input: PersonalPromptInput) => {
        if (editingPrompt) updatePrompt(editingPrompt.id, input);
        else addPrompt(input);
        message.success(editingPrompt ? "提示词已更新" : "提示词已添加");
    };

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        if (activeTab !== "library") return;
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    const personalItems = filteredPersonalPrompts.map(personalPromptToPrompt);
    const visibleCount = activeTab === "library" ? totalPrompts : filteredPersonalPrompts.length;

    return (
        <div className="flex h-full flex-col overflow-hidden text-stone-800 dark:text-stone-100">
            <main className="visionary-page min-h-0 flex-1 overflow-y-auto px-6 py-10" onScroll={handleListScroll}>
                <div className="mx-auto max-w-7xl pb-6">
                    <div className="flex flex-wrap items-start justify-between gap-5">
                        <div className="min-w-0">
                            <Tabs className="prompt-page-tabs" activeKey={activeTab} onChange={setActiveTab} items={[{ key: "library", label: "提示词库" }, { key: "personal", label: `收藏 (${personalPrompts.length})` }]} />
                            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">当前共 {visibleCount} 条提示词</p>
                        </div>
                        {activeTab === "personal" ? (
                            <Button type="primary" icon={<Plus className="size-4" />} onClick={openNewPrompt}>
                                新增提示词
                            </Button>
                        ) : null}
                    </div>
                </div>

                {activeTab === "library" ? (
                    <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
                        <aside className="visionary-surface flex flex-col overflow-hidden p-5 lg:sticky lg:top-4">
                            <div className="shrink-0">
                                <div className="text-xs font-medium text-stone-500 dark:text-stone-400">搜索</div>
                                <Input className="mt-2" prefix={<Search className="size-4 text-stone-400" />} value={titleKeyword} allowClear placeholder="标题、内容或标签" onChange={(event) => setTitleKeyword(event.target.value)} />
                                <div className="mt-5">
                                    <PromptFilter label="分类" options={promptCategoryOptions} selected={selectedCategory} onChange={setSelectedCategory} />
                                </div>
                            </div>
                            <div className="mt-5 flex h-[404px] min-h-0 shrink-0 flex-col">
                                <div className="mb-2 shrink-0 text-xs font-medium text-stone-500 dark:text-stone-400">标签</div>
                                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
                                    <div className="flex min-w-0 flex-wrap gap-2">
                                        {promptTags.map((tag) => {
                                            const active = tag === ALL_PROMPTS_OPTION ? selectedTags.length === 0 : selectedTags.includes(tag);
                                            return <Tag.CheckableTag key={tag} checked={active} className={cn("prompt-filter-tag max-w-full break-all leading-5", active && "is-active")} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }} onChange={() => toggleTag(tag)}>{tag}</Tag.CheckableTag>;
                                        })}
                                    </div>
                                </div>
                            </div>
                        </aside>
                        <section className="min-w-0">
                            {query.isLoading ? <div className="flex h-60 items-center justify-center"><Spin /></div> : null}
                            {!query.isLoading ? (
                                <PromptGrid
                                    items={promptItems}
                                    onOpen={setSelectedPrompt}
                                    renderActions={(item) => <><Button size="small" icon={<BookmarkPlus className="size-3.5" />} onClick={() => saveToFavorites(item)}>收藏</Button><Tooltip title="加入资产"><Button type="text" size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>加入资产</Button></Tooltip></>}
                                    onCopy={(item) => copyText(item.prompt, "提示词已复制")}
                                    emptyText="没有找到匹配的提示词"
                                />
                            ) : null}
                            <div className="mt-6 text-center text-xs text-stone-500 dark:text-stone-400">{query.isFetchingNextPage ? "加载中..." : query.hasNextPage ? "继续向下滚动加载更多" : promptItems.length > 0 ? "已经到底了" : null}</div>
                        </section>
                    </div>
                ) : null}
                {activeTab === "personal" ? (
                    <div className="mx-auto max-w-7xl">
                        <div className="mx-auto mb-6 w-full max-w-2xl">
                            <Input size="large" prefix={<Search className="size-4 text-stone-400" />} value={titleKeyword} allowClear placeholder="搜索收藏" onChange={(event) => setTitleKeyword(event.target.value)} />
                        </div>
                        <PromptGrid
                            items={personalItems}
                            onOpen={setSelectedPrompt}
                            onCopy={(item) => copyText(item.prompt, "提示词已复制")}
                            renderActions={(item) => {
                                const personal = personalPrompts.find((prompt) => prompt.id === item.id)!;
                                return <Space size={0}><Tooltip title="编辑"><Button type="text" size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEditPrompt(personal)} /></Tooltip><Popconfirm title="删除这条收藏？" okText="删除" cancelText="取消" onConfirm={() => removePrompt(item.id)}><Tooltip title="删除"><Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} /></Tooltip></Popconfirm></Space>;
                            }}
                            emptyText="还没有收藏提示词"
                        />
                    </div>
                ) : null}
            </main>

            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(prompt) => copyText(prompt, "提示词已复制")} onSaveAsset={selectedPrompt?.sourceId === "personal" ? undefined : savePromptAsset} onSavePrompt={selectedPrompt?.sourceId === "personal" ? undefined : saveToFavorites} />
            <MyPromptEditorDialog open={editorOpen} prompt={editingPrompt} onSave={savePersonalPrompt} onClose={() => setEditorOpen(false)} />
        </div>
    );
}

function PromptFilter({ label, options, selected, onChange }: { label: string; options: string[]; selected: string; onChange: (value: string) => void }) {
    return <div><div className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">{label}</div><div className="flex min-w-0 flex-wrap gap-2 overflow-x-hidden">{options.map((option) => <Tag.CheckableTag key={option} checked={selected === option} className={cn("prompt-filter-tag max-w-full break-all leading-5", selected === option && "is-active")} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }} onChange={() => onChange(option)}>{option}</Tag.CheckableTag>)}</div></div>;
}

function PromptGrid({ items, onOpen, onCopy, renderActions, emptyText }: { items: Prompt[]; onOpen: (item: Prompt) => void; onCopy: (item: Prompt) => void; renderActions: (item: Prompt) => ReactNode; emptyText: string }) {
    return <div><div className="mx-auto grid max-w-7xl gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{items.map((item) => <PromptCard key={`${item.sourceId}:${item.id}`} item={item} onOpen={() => onOpen(item)} onCopy={() => onCopy(item)} extraAction={renderActions(item)} />)}</div>{items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} className="py-16" /> : null}</div>;
}

function toPersonalInput(item: Prompt): PersonalPromptInput {
    return { title: item.title, prompt: item.prompt, description: item.description, coverUrl: item.coverUrl, referenceImageUrls: item.referenceImageUrls, tags: item.tags, imageMode: item.imageMode, imageModel: item.imageModel, imageSize: item.imageSize, imageCount: item.imageCount };
}
