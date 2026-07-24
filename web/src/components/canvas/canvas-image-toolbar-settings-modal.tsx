import { useMemo, type ReactNode } from "react";
import { Button, Checkbox, Form, Modal, Space, Switch, Tag, Typography } from "antd";

import type { ImageQuickToolId } from "./canvas-image-toolbar-tools";

export type ImageToolbarSettingsTool = {
    id: ImageQuickToolId;
    title: string;
    label: string;
    icon: ReactNode;
    active?: boolean;
    danger?: boolean;
};

export function ImageToolSettingsModal({
    open,
    tools,
    selectedIds,
    showLabels,
    onToggle,
    onShowLabelsChange,
    onCancel,
    onSave,
}: {
    open: boolean;
    tools: ImageToolbarSettingsTool[];
    selectedIds: ImageQuickToolId[];
    showLabels: boolean;
    onToggle: (id: ImageQuickToolId, visible: boolean) => void;
    onShowLabelsChange: (value: boolean) => void;
    onCancel: () => void;
    onSave: () => void;
}) {
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    const selectedTools = tools.filter((tool) => selected.has(tool.id));

    const updateSelectedTools = (values: ImageQuickToolId[]) => {
        const next = new Set(values);
        tools.forEach((tool) => {
            const visible = next.has(tool.id);
            if (selected.has(tool.id) !== visible) onToggle(tool.id, visible);
        });
    };

    return (
        <Modal
            title="自定义工具栏"
            open={open}
            centered
            width={760}
            onCancel={onCancel}
            destroyOnHidden
            footer={
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <span>显示按钮文字</span>
                        <Switch checked={showLabels} onChange={onShowLabelsChange} />
                    </div>
                    <Space>
                        <Button onClick={onCancel}>取消</Button>
                        <Button type="primary" onClick={onSave}>
                            保存
                        </Button>
                    </Space>
                </div>
            }
        >
            <Typography.Paragraph type="secondary" className="!mb-4">
                选择你想在图片节点编辑栏中使用的快捷工具。
            </Typography.Paragraph>

            <Form layout="vertical" className="!mb-0">
                <Form.Item
                    className="!mb-4"
                    label={
                        <Space size={8}>
                            <span>快捷工具</span>
                            <Tag className="m-0">
                                {selectedTools.length}/{tools.length}
                            </Tag>
                        </Space>
                    }
                >
                    <Checkbox.Group value={selectedIds} className="grid w-full gap-3 md:grid-cols-3" onChange={(values) => updateSelectedTools(values as ImageQuickToolId[])}>
                        {tools.map((tool) => (
                            <Checkbox key={tool.id} value={tool.id} className="m-0">
                                <span className="inline-flex items-center gap-2">
                                    {tool.icon}
                                    {tool.label}
                                </span>
                            </Checkbox>
                        ))}
                    </Checkbox.Group>
                </Form.Item>
            </Form>
        </Modal>
    );
}
