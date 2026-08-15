"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireOwnedPrivateUpload = requireOwnedPrivateUpload;
exports.createPrivateUploadsRouter = createPrivateUploadsRouter;
const express_1 = __importDefault(require("express"));
const browser_origin_1 = require("./browser-origin");
function privateNotesUploadPath(req) {
    const rawSegments = req.path.split('/');
    if (rawSegments.length !== 4 || rawSegments[0] !== '')
        return null;
    try {
        const [collection, owner, filename] = rawSegments.slice(1).map(decodeURIComponent);
        if (collection !== 'notes'
            || !owner
            || !filename
            || [collection, owner, filename].some(segment => (segment === '.' || segment === '..' || /[\\/\0]/.test(segment))))
            return null;
        return { owner };
    }
    catch {
        return null;
    }
}
function requireOwnedPrivateUpload(req, res, next) {
    const upload = privateNotesUploadPath(req);
    const sessionOwner = String(req.user?.username || '');
    if (!upload || !sessionOwner || upload.owner !== sessionOwner) {
        res.status(404).end();
        return;
    }
    next();
}
function privateUploadResponseHeaders(_req, res, next) {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'private, no-store');
    next();
}
const privateUploadNotFound = (error, _req, res, next) => {
    if (error?.code === 'ENOENT' || Number(error?.statusCode || error?.status) === 404) {
        res.status(404).end();
        return;
    }
    next(error);
};
function createPrivateUploadsRouter({ rootDirectory, authenticate, }) {
    const router = express_1.default.Router();
    router.use(browser_origin_1.requireSameOriginBrowserRequest);
    router.use(authenticate);
    router.use(requireOwnedPrivateUpload);
    router.use(privateUploadResponseHeaders);
    router.use(express_1.default.static(rootDirectory, { fallthrough: false }));
    router.use(privateUploadNotFound);
    return router;
}
//# sourceMappingURL=private-uploads.js.map