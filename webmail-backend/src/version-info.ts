import fs from 'fs';
import path from 'path';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export class InstalledVersionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InstalledVersionError';
    }
}

export function installedVersionCandidates(
    sourceDirectory = __dirname,
    configuredPath = process.env.OMS_VERSION_FILE || '',
): string[] {
    const explicitPath = configuredPath.trim();
    if (explicitPath) return [path.resolve(explicitPath)];

    const backendDirectory = path.resolve(sourceDirectory, '..');
    const candidates = [path.join(backendDirectory, 'VERSION')];
    if (path.basename(backendDirectory) === 'webmail-backend') {
        candidates.push(path.resolve(backendDirectory, '../VERSION'));
    }
    return candidates;
}

export function readInstalledVersion(): string {
    const candidates = installedVersionCandidates();
    const versionFile = candidates.find(candidate => {
        try {
            return fs.statSync(candidate).isFile();
        } catch {
            return false;
        }
    });

    if (!versionFile) {
        throw new InstalledVersionError('OpenMailStack VERSION file is unavailable');
    }

    let version: string;
    try {
        version = fs.readFileSync(versionFile, 'utf8').trim();
    } catch {
        throw new InstalledVersionError('OpenMailStack VERSION file could not be read');
    }
    if (!VERSION_PATTERN.test(version)) {
        throw new InstalledVersionError('OpenMailStack VERSION file is invalid');
    }
    return version;
}
