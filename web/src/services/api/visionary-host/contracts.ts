export type VisionaryHostFeatureFlags = {
    image: boolean;
    text: boolean;
};

export type VisionaryHostUser = {
    id: string;
    name?: string;
    credits: number;
};

export type VisionaryHostImageModel = {
    id: string;
    label?: string;
    ratios?: string[];
    imageSizes?: string[];
    qualities?: string[];
};

export type VisionaryHostTextModel = {
    key: string;
    label?: string;
    description?: string;
};

export type VisionaryHostBootstrap = {
    protocolVersion: 1;
    releaseVersion: string;
    storageNamespace: string;
    user: VisionaryHostUser;
    features: VisionaryHostFeatureFlags;
    image: {
        models: VisionaryHostImageModel[];
        defaultModel: string;
        defaults?: {
            ratio?: string;
            imageSize?: string;
            quality?: string;
            optimizeChineseText?: boolean;
        };
    };
    text: {
        models: VisionaryHostTextModel[];
        defaultModel: string;
    };
};

export type VisionaryHostExchangeResponse = {
    ok: true;
    expiresAt: string;
};

export type VisionaryHostRequestContext = {
    clientOperationId: string;
    projectId: string;
    nodeId: string;
};

export type VisionaryHostImageRequest = VisionaryHostRequestContext & {
    prompt: string;
    model: string;
    ratio: string;
    imageSize: string;
    quality: string;
    optimizeChineseText: boolean;
    referenceGenerationIds?: string[];
    referenceImageRefs?: string[];
};

export type VisionaryHostImageQuote = {
    estimatedCredits: number;
    remainingCredits?: number;
};

export type VisionaryHostBilling = {
    state: "reserved" | "settled" | "refunded" | "failed";
    reservedCredits: number;
    chargedCredits: number;
    refundedCredits: number;
    remainingCredits?: number;
};

export type VisionaryHostImageItem = {
    generationId: string;
    url: string;
};

export type VisionaryHostImageResponse = {
    operationId: string;
    status?: string;
    retryAfterSeconds?: number;
    images: VisionaryHostImageItem[];
    billing: VisionaryHostBilling;
};

export type VisionaryHostImageRecoveryResult = {
    operationId: string;
    status: "not_found" | "pending" | "failed" | "completed" | "success";
    id?: string;
    imageUrl?: string;
    previewImageUrl?: string;
    chargedCredits?: number;
    error?: string;
    retryAfterSeconds?: number;
};

export type VisionaryHostImageRecoveryResponse = {
    success: true;
    retryAfterSeconds?: number;
    results: VisionaryHostImageRecoveryResult[];
    credits?: number;
};

export type VisionaryHostTextCapabilities = {
    enabled: boolean;
    billingEnabled: boolean;
    defaultModel: string;
    models: VisionaryHostTextModel[];
    maxOutputTokens?: number;
};

export type VisionaryHostTextConversation = {
    id: string;
    modelKey: string;
};

export type VisionaryHostTextRun = {
    runId: string;
    reservation?: {
        reservedCredits?: number;
        remainingCredits?: number;
    } | null;
};

export type VisionaryHostSseFrame = {
    id?: string;
    event: string;
    data: Record<string, unknown>;
};

export type VisionaryCanvasReadyMessage = {
    type: "visionary.canvas.ready";
    protocolVersion: 1;
    nonce: string;
};

export type VisionaryCanvasConnectMessage = {
    type: "visionary.canvas.connect";
    protocolVersion: 1;
    nonce: string;
};

export type VisionaryCanvasPortReadyMessage = {
    type: "visionary.canvas.port-ready";
    protocolVersion: 1;
    nonce: string;
};

export type VisionaryCanvasSessionEstablishedMessage = {
    type: "visionary.canvas.session.established";
    protocolVersion: 1;
    nonce: string;
};

export type VisionaryCanvasTicketMessage = {
    type: "visionary.canvas.ticket";
    protocolVersion: 1;
    nonce: string;
    ticket: string;
    expiresAt: string;
};

export type VisionaryCanvasPortMessage =
    | VisionaryCanvasTicketMessage
    | {
          type: "visionary.canvas.credits.updated";
          protocolVersion: 1;
          nonce: string;
          credits?: number;
      }
    | {
          type: "visionary.canvas.session.invalid";
          protocolVersion: 1;
          nonce: string;
          reason?: string;
      }
    | {
          type: "visionary.canvas.session.closed";
          protocolVersion: 1;
          nonce: string;
          reason?: string;
      };
