"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstalledVersionError = void 0;
exports.installedVersionCandidates = installedVersionCandidates;
exports.readInstalledVersion = readInstalledVersion;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
class InstalledVersionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InstalledVersionError';
    }
}
exports.InstalledVersionError = InstalledVersionError;
function installedVersionCandidates(sourceDirectory = __dirname, configuredPath = process.env.OMS_VERSION_FILE || '') {
    const explicitPath = configuredPath.trim();
    if (explicitPath)
        return [path_1.default.resolve(explicitPath)];
    const backendDirectory = path_1.default.resolve(sourceDirectory, '..');
    const candidates = [path_1.default.join(backendDirectory, 'VERSION')];
    if (path_1.default.basename(backendDirectory) === 'webmail-backend') {
        candidates.push(path_1.default.resolve(backendDirectory, '../VERSION'));
    }
    return candidates;
}
function readInstalledVersion() {
    const candidates = installedVersionCandidates();
    const versionFile = candidates.find(candidate => {
        try {
            return fs_1.default.statSync(candidate).isFile();
        }
        catch {
            return false;
        }
    });
    if (!versionFile) {
        throw new InstalledVersionError('OpenMailStack VERSION file is unavailable');
    }
    let version;
    try {
        version = fs_1.default.readFileSync(versionFile, 'utf8').trim();
    }
    catch {
        throw new InstalledVersionError('OpenMailStack VERSION file could not be read');
    }
    if (!VERSION_PATTERN.test(version)) {
        throw new InstalledVersionError('OpenMailStack VERSION file is invalid');
    }
    return version;
}
//# sourceMappingURL=version-info.js.map