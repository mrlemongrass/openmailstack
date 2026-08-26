export declare const apiRouter: import("express-serve-static-core").Router;
export declare const ATTACHMENT_BUNDLE_MAX_COUNT = 100;
export declare const ATTACHMENT_BUNDLE_MAX_DECODED_BYTES: number;
export declare const ATTACHMENT_SOURCE_MAX_BYTES: number;
export declare const ATTACHMENT_DOWNLOAD_MAX_BYTES: number;
export declare const validateAttachmentBundleLimits: (attachments: any[]) => void;
export declare const writeAttachmentResponseChunk: (res: any, chunk: string | Buffer) => Promise<void>;
//# sourceMappingURL=api.d.ts.map