import { AppConfigPanel } from "@/components/layout/app-config-modal";
import { Sparkles } from "lucide-react";

export default function ConfigPage() {
    return (
        <main className="visionary-page h-full overflow-y-auto">
            <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
                <div className="mb-8 text-center">
                    <div className="visionary-kicker"><Sparkles className="size-3.5 text-blue-500" />系统控制台</div>
                    <h1 className="visionary-title mt-4 text-4xl font-bold sm:text-5xl">配置与用户偏好</h1>
                    <p className="mt-3 text-sm text-stone-500">渠道聚合、模型选择和同步偏好</p>
                </div>
                <div className="visionary-surface p-5 sm:p-7">
                    <AppConfigPanel />
                </div>
            </div>
        </main>
    );
}
