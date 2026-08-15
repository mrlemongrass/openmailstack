import type { NextFunction, Request, Response } from 'express';
import type { IncomingMessage } from 'http';
type OriginRequest = Pick<IncomingMessage, 'headers' | 'socket'>;
export declare function browserRequestHasSameOrigin(req: OriginRequest): boolean;
export declare function requireSameOriginBrowserRequest(req: Request, res: Response, next: NextFunction): void;
export declare function allowSameOriginSocketRequest(req: IncomingMessage, callback: (error: string | null | undefined, success: boolean) => void): void;
export {};
//# sourceMappingURL=browser-origin.d.ts.map