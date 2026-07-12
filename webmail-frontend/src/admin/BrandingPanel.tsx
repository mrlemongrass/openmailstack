import { useState } from 'react';
import { CheckCircle2, Image, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { defaultBranding, resolveBrandingPresentation, type BrandingSettings } from '../branding';
import {
  brandingImageRecommendations,
  calculateDrawRect,
  optimizeBrandingImage,
  type BrandingImageKey,
} from './branding-image';

interface BrandingPanelProps {
  branding: BrandingSettings;
  saving: boolean;
  status: string;
  statusIsError: boolean;
  dirty: boolean;
  onChange: (branding: BrandingSettings) => void;
  onReset: () => void;
  onSave: () => void;
}

const sourceImageLimit = 40 * 1024 * 1024;

const imageLabels: Record<BrandingImageKey, string> = {
  appIconDataUrl: 'App Icon',
  faviconDataUrl: 'Browser Favicon',
  loginLogoDataUrl: 'Login Logo',
  loginBackgroundDataUrl: 'Login Background',
};

const imageDescriptions: Record<BrandingImageKey, string> = {
  appIconDataUrl: 'Square mark used beside your site name.',
  faviconDataUrl: 'Small browser-tab icon.',
  loginLogoDataUrl: 'Wide or square logo for the sign-in card.',
  loginBackgroundDataUrl: 'Full-screen sign-in background.',
};

const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

interface ProcessedBrandingImage {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  originalWidth: number;
  originalHeight: number;
}

export function BrandingPanel({ branding, saving, status, statusIsError, dirty, onChange, onReset, onSave }: BrandingPanelProps) {
  const [uploadError, setUploadError] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [processedImages, setProcessedImages] = useState<Partial<Record<BrandingImageKey, ProcessedBrandingImage>>>({});
  const presentation = resolveBrandingPresentation(branding);

  const updateBranding = (updates: Partial<BrandingSettings>) => {
    onChange({ ...branding, ...updates });
  };

  const clearImage = (key: BrandingImageKey) => {
    setProcessedImages(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    updateBranding({ [key]: '' } as Partial<BrandingSettings>);
  };

  const resetBranding = () => {
    setProcessedImages({});
    setUploadError('');
    setUploadStatus('');
    onReset();
  };

  const readImageFile = async (key: BrandingImageKey, file: File) => {
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Use PNG, JPG, WebP, or GIF images.');
      setUploadStatus('');
      return;
    }
    if (file.size > sourceImageLimit) {
      setUploadError(`Use an original image smaller than ${Math.round(sourceImageLimit / (1024 * 1024))} MB.`);
      setUploadStatus('');
      return;
    }

    try {
      const resized = await resizeBrandingImage(file, key);
      setUploadError('');
      setUploadStatus(`${imageLabels[key]} is ready. It was fitted and optimized automatically.`);
      setProcessedImages(current => ({ ...current, [key]: resized }));
      updateBranding({ [key]: resized.dataUrl } as Partial<BrandingSettings>);
    } catch {
      setUploadError('That image could not be processed. Try a PNG, JPG, WebP, or GIF file.');
      setUploadStatus('');
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div>
          <div className="settings-eyebrow">Admin Settings</div>
          <h2>Branding</h2>
        </div>
        <div className="settings-action-row">
          <button className="btn btn-ghost" type="button" onClick={resetBranding} disabled={saving}>
            <RotateCcw size={18} /> Restore defaults
          </button>
          <button className="btn btn-primary" type="button" onClick={onSave} disabled={saving || !dirty}>
            <Save size={18} /> {saving ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </div>

      {status && <div className={statusIsError ? 'settings-error-banner' : 'settings-status-banner'} role={statusIsError ? 'alert' : 'status'}>{status}</div>}
      {dirty && <div className="settings-pending-banner" role="status">Unsaved changes. Choose Save changes to apply them across the site.</div>}
      {uploadStatus && <div className="settings-status-banner" role="status">{uploadStatus}</div>}
      {uploadError && <div className="settings-error-banner" role="alert">{uploadError}</div>}

      <div className="settings-grid">
        <section className="settings-section">
          <h3>Identity</h3>
          <label className="settings-field">
            <span>Site name</span>
            <input
              className="glass-input"
              value={branding.appName}
              onChange={event => {
                const appName = event.target.value;
                const loginTitleFollowsAppName = !branding.loginTitle.trim()
                  || branding.loginTitle === branding.appName
                  || branding.loginTitle === defaultBranding.loginTitle;
                updateBranding({ appName, ...(loginTitleFollowsAppName ? { loginTitle: appName } : {}) });
              }}
              placeholder={defaultBranding.appName}
            />
            <small>Shown in the app header and browser title.</small>
          </label>
          <label className="settings-field">
            <span>Organization name</span>
            <input
              className="glass-input"
              value={branding.companyName}
              onChange={event => updateBranding({ companyName: event.target.value })}
              placeholder="Company or organization"
            />
            <small>Optional context added to the browser title.</small>
          </label>
        </section>

        <section className="settings-section">
          <h3>Login Page</h3>
          <label className="settings-field">
            <span>Sign-in heading</span>
            <input
              className="glass-input"
              value={branding.loginTitle}
              onChange={event => updateBranding({ loginTitle: event.target.value })}
              placeholder={defaultBranding.loginTitle}
            />
            <small>Leave this matching the site name for a consistent identity.</small>
          </label>
          <label className="settings-field">
            <span>Sign-in message</span>
            <input
              className="glass-input"
              value={branding.loginSubtitle}
              onChange={event => updateBranding({ loginSubtitle: event.target.value })}
              placeholder={defaultBranding.loginSubtitle}
            />
          </label>
        </section>
      </div>

      <section className="settings-section">
        <h3>Images</h3>
        <p className="branding-section-intro">
          Upload a PNG, JPG, WebP, or GIF. We’ll crop or contain it for the destination and reduce its saved size automatically—exact pixel dimensions are not required.
        </p>
        <div className="branding-upload-grid">
          <BrandingImageField branding={branding} field="appIconDataUrl" processed={processedImages.appIconDataUrl} onUpload={readImageFile} onClear={clearImage} />
          <BrandingImageField branding={branding} field="faviconDataUrl" processed={processedImages.faviconDataUrl} onUpload={readImageFile} onClear={clearImage} />
          <BrandingImageField branding={branding} field="loginLogoDataUrl" processed={processedImages.loginLogoDataUrl} onUpload={readImageFile} onClear={clearImage} />
          <BrandingImageField branding={branding} field="loginBackgroundDataUrl" processed={processedImages.loginBackgroundDataUrl} onUpload={readImageFile} onClear={clearImage} wide />
        </div>
      </section>

      <section className="settings-section">
        <h3>Preview</h3>
        <div
          className="branding-login-preview"
          style={branding.loginBackgroundDataUrl ? { backgroundImage: `linear-gradient(rgba(7, 12, 20, 0.38), rgba(7, 12, 20, 0.68)), url(${branding.loginBackgroundDataUrl})` } : undefined}
        >
          <div className="branding-login-card">
            <BrandingLogo branding={branding} size="large" />
            <strong>{presentation.loginTitle}</strong>
            <span>{presentation.loginSubtitle}</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function BrandingImageField({
  branding,
  field,
  processed,
  wide = false,
  onUpload,
  onClear,
}: {
  branding: BrandingSettings;
  field: BrandingImageKey;
  processed?: ProcessedBrandingImage;
  wide?: boolean;
  onUpload: (field: BrandingImageKey, file: File) => void | Promise<void>;
  onClear: (field: BrandingImageKey) => void;
}) {
  const value = branding[field];

  return (
    <div className={`branding-upload-card ${wide ? 'wide' : ''}`}>
      <div className="branding-upload-preview">
        {value ? (
          <img src={value} alt="" />
        ) : (
          <Image size={28} />
        )}
      </div>
      <div className="branding-upload-meta">
        <strong>{imageLabels[field]}</strong>
        <span>{imageDescriptions[field]}</span>
        <span>Target: {recommendedSize(field)} · automatically adjusted</span>
        {value && processed ? (
          <span className="branding-upload-ready"><CheckCircle2 size={14} /> {processed.originalWidth} × {processed.originalHeight} → {processed.width} × {processed.height} px · {formatBytes(processed.bytes)}</span>
        ) : value ? (
          <span className="branding-upload-ready"><CheckCircle2 size={14} /> Saved and ready</span>
        ) : (
          <span>PNG, JPG, WebP, or GIF · source up to {Math.round(sourceImageLimit / (1024 * 1024))} MB</span>
        )}
      </div>
      <div className="settings-action-row">
        <label className="btn btn-ghost branding-file-button">
          <Upload size={16} /> {value ? 'Replace image' : 'Choose image'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) onUpload(field, file);
              event.target.value = '';
            }}
          />
        </label>
        {value && (
          <button className="btn btn-danger" type="button" onClick={() => onClear(field)} title={`Clear ${imageLabels[field]}`} aria-label={`Clear ${imageLabels[field]}`}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function BrandingLogo({ branding, size }: { branding: BrandingSettings; size: 'small' | 'large' }) {
  const logo = branding.loginLogoDataUrl || branding.appIconDataUrl;
  if (logo) {
    return <img className={`branding-logo ${size}`} src={logo} alt="" />;
  }
  return <Image className={`branding-logo-icon ${size}`} />;
}

const recommendedSize = (field: BrandingImageKey) => {
  const recommendation = brandingImageRecommendations[field];
  return `${recommendation.width} × ${recommendation.height} px`;
};

const formatBytes = (bytes: number) => bytes < 1024
  ? `${bytes} B`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const loadImage = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new window.Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Unable to load image'));
  };
  image.src = url;
});

async function resizeBrandingImage(file: File, field: BrandingImageKey): Promise<ProcessedBrandingImage> {
  const recommendation = brandingImageRecommendations[field];
  const image = await loadImage(file);
  let renderedCanvas: HTMLCanvasElement | null = null;
  let renderedWidth = 0;
  let renderedHeight = 0;
  const optimized = await optimizeBrandingImage(
    field,
    (width, height, type, quality) => {
      if (!renderedCanvas || width !== renderedWidth || height !== renderedHeight) {
        renderedCanvas = renderBrandingCanvas(image, width, height, recommendation.fit);
        renderedWidth = width;
        renderedHeight = height;
      }
      return renderedCanvas.toDataURL(type, quality);
    },
    () => new Promise(resolve => window.setTimeout(resolve, 0)),
  );
  return { ...optimized, originalWidth: image.naturalWidth, originalHeight: image.naturalHeight };
}

function renderBrandingCanvas(
  image: HTMLImageElement,
  width: number,
  height: number,
  fit: 'cover' | 'contain',
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  context.clearRect(0, 0, width, height);

  const rect = calculateDrawRect(image.naturalWidth, image.naturalHeight, width, height, fit);
  context.drawImage(
    image,
    rect.sourceX,
    rect.sourceY,
    rect.sourceWidth,
    rect.sourceHeight,
    rect.targetX,
    rect.targetY,
    rect.targetWidth,
    rect.targetHeight,
  );
  return canvas;
}
