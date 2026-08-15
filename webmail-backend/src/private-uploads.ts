import express, {
    type ErrorRequestHandler,
    type NextFunction,
    type Request,
    type RequestHandler,
    type Response,
    type Router,
} from 'express';
import { requireSameOriginBrowserRequest } from './browser-origin';

export interface PrivateUploadsRouterOptions {
    rootDirectory: string;
    authenticate: RequestHandler;
}

function privateNotesUploadPath(req: Request): { owner: string } | null {
    const rawSegments = req.path.split('/');
    if (rawSegments.length !== 4 || rawSegments[0] !== '') return null;
    try {
        const [collection, owner, filename] = rawSegments.slice(1).map(decodeURIComponent);
        if (collection !== 'notes'
            || !owner
            || !filename
            || [collection, owner, filename].some(segment => (
                segment === '.' || segment === '..' || /[\\/\0]/.test(segment)
            ))) return null;
        return { owner };
    } catch {
        return null;
    }
}

export function requireOwnedPrivateUpload(req: Request, res: Response, next: NextFunction): void {
    const upload = privateNotesUploadPath(req);
    const sessionOwner = String((req as any).user?.username || '');
    if (!upload || !sessionOwner || upload.owner !== sessionOwner) {
        res.status(404).end();
        return;
    }
    next();
}

function privateUploadResponseHeaders(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'private, no-store');
    next();
}

const privateUploadNotFound: ErrorRequestHandler = (error: any, _req, res, next) => {
    if (error?.code === 'ENOENT' || Number(error?.statusCode || error?.status) === 404) {
        res.status(404).end();
        return;
    }
    next(error);
};

export function createPrivateUploadsRouter({
    rootDirectory,
    authenticate,
}: PrivateUploadsRouterOptions): Router {
    const router = express.Router();
    router.use(requireSameOriginBrowserRequest);
    router.use(authenticate);
    router.use(requireOwnedPrivateUpload);
    router.use(privateUploadResponseHeaders);
    router.use(express.static(rootDirectory, { fallthrough: false }));
    router.use(privateUploadNotFound);
    return router;
}
