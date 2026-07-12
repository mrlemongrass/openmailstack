export type BrandingImageKey = 'appIconDataUrl' | 'faviconDataUrl' | 'loginLogoDataUrl' | 'loginBackgroundDataUrl';

export const brandingImageLimits: Record<BrandingImageKey, number> = {
  appIconDataUrl: 256 * 1024,
  faviconDataUrl: 256 * 1024,
  loginLogoDataUrl: 512 * 1024,
  loginBackgroundDataUrl: 2 * 1024 * 1024,
};

export const brandingImageRecommendations: Record<BrandingImageKey, { width: number; height: number; fit: 'cover' | 'contain' }> = {
  appIconDataUrl: { width: 512, height: 512, fit: 'cover' },
  faviconDataUrl: { width: 64, height: 64, fit: 'cover' },
  loginLogoDataUrl: { width: 512, height: 160, fit: 'contain' },
  loginBackgroundDataUrl: { width: 2400, height: 1600, fit: 'cover' },
};

export interface BrandingImageOutput {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

export interface DrawRect {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  targetX: number;
  targetY: number;
  targetWidth: number;
  targetHeight: number;
}

export const dataUrlBytes = (dataUrl: string) => {
  const payload = dataUrl.split(',')[1] || '';
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
};

export function calculateDrawRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: 'cover' | 'contain',
): DrawRect {
  if (fit === 'cover') {
    const sourceRatio = sourceWidth / sourceHeight;
    const targetRatio = targetWidth / targetHeight;
    let croppedWidth = sourceWidth;
    let croppedHeight = sourceHeight;
    let sourceX = 0;
    let sourceY = 0;

    if (sourceRatio > targetRatio) {
      croppedWidth = sourceHeight * targetRatio;
      sourceX = (sourceWidth - croppedWidth) / 2;
    } else {
      croppedHeight = sourceWidth / targetRatio;
      sourceY = (sourceHeight - croppedHeight) / 2;
    }

    return {
      sourceX,
      sourceY,
      sourceWidth: croppedWidth,
      sourceHeight: croppedHeight,
      targetX: 0,
      targetY: 0,
      targetWidth,
      targetHeight,
    };
  }

  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const containedWidth = Math.round(sourceWidth * scale);
  const containedHeight = Math.round(sourceHeight * scale);
  return {
    sourceX: 0,
    sourceY: 0,
    sourceWidth,
    sourceHeight,
    targetX: Math.round((targetWidth - containedWidth) / 2),
    targetY: Math.round((targetHeight - containedHeight) / 2),
    targetWidth: containedWidth,
    targetHeight: containedHeight,
  };
}

export async function optimizeBrandingImage(
  field: BrandingImageKey,
  encode: (width: number, height: number, type: 'image/png' | 'image/jpeg' | 'image/webp', quality?: number) => string,
  yieldControl: () => Promise<void> = () => Promise.resolve(),
): Promise<BrandingImageOutput> {
  const recommendation = brandingImageRecommendations[field];
  const dimensionScales = [1, 0.85, 0.7, 0.55, 0.4];

  for (const dimensionScale of dimensionScales) {
    const width = Math.max(32, Math.round(recommendation.width * dimensionScale));
    const height = Math.max(32, Math.round(recommendation.height * dimensionScale));
    const candidates: Array<{ type: 'image/png' | 'image/jpeg' | 'image/webp'; quality?: number }> = field === 'loginBackgroundDataUrl'
      ? [0.86, 0.7, 0.54, 0.42].map(quality => ({ type: 'image/jpeg', quality }))
      : [{ type: 'image/png' }, ...[0.86, 0.7, 0.54].map(quality => ({ type: 'image/webp' as const, quality }))];

    for (const candidate of candidates) {
      const dataUrl = encode(width, height, candidate.type, candidate.quality);
      const bytes = dataUrlBytes(dataUrl);
      if (bytes <= brandingImageLimits[field]) return { dataUrl, width, height, bytes };
      await yieldControl();
    }
  }

  throw new Error('Image could not be reduced to the saved-size limit');
}
