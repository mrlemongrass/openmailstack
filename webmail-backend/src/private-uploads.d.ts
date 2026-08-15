import { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
export interface PrivateUploadsRouterOptions {
    rootDirectory: string;
    authenticate: RequestHandler;
}
export declare function requireOwnedPrivateUpload(req: Request, res: Response, next: NextFunction): void;
export declare function createPrivateUploadsRouter({ rootDirectory, authenticate, }: PrivateUploadsRouterOptions): Router;
//# sourceMappingURL=private-uploads.d.ts.map