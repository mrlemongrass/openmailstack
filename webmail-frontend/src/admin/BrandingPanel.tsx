import { useState } from 'react';
import { Image, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { defaultBranding, type BrandingSettings } from '../branding';

type BrandingImageKey = 'appIconDataUrl' | 'faviconDataUrl' | 'loginLogoDataUrl' | 'loginBackgroundDataUrl';

interface BrandingPanelProps {
  branding: BrandingSettings;
  saving: boolean;
  status: string;
  onChange: (branding: BrandingSettings) => void;
  onReset: () => void;
  onSave: () => void;
}

const imageLimits: Record<BrandingImageKey, number> = {
  appIconDataUrl: 256 * 1024,
  faviconDataUrl: 256 * 1024,
  loginLogoDataUrl: 512 * 1024,
  loginBackgroundDataUrl: 2 * 1024 * 1024,
};

const sourceImageLimit = 12 * 1024 * 1024;

const imageLabels: Record<BrandingImageKey, string> = {
  appIconDataUrl: 'App Icon',
  faviconDataUrl: 'Browser Favicon',
  loginLogoDataUrl: 'Login Logo',
  loginBackgroundDataUrl: 'Login Background',
};

const imageRecommendations: Record<BrandingImageKey, { width: number; height: number; fit: 'cover' | 'contain'; outputType: 'image/png' | 'image/jpeg'; quality?: number }> = {
  appIconDataUrl: { width: 512, height: 512, fit: 'cover', outputType: 'image/png' },
  faviconDataUrl: { width: 64, height: 64, fit: 'cover', outputType: 'image/png' },
  loginLogoDataUrl: { width: 512, height: 160, fit: 'contain', outputType: 'image/png' },
  loginBackgroundDataUrl: { width: 2400, height: 1600, fit: 'cover', outputType: 'image/jpeg', quality: 0.86 },
};

const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function BrandingPanel({ branding, saving, status, onChange, onReset, onSave }: BrandingPanelProps) {
  const [uploadError, setUploadError] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');

  const updateBranding = (updates: Partial<BrandingSettings>) => {
    onChange({ ...branding, ...updates });
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
      const outputBytes = dataUrlBytes(resized);
      if (outputBytes > imageLimits[key]) {
        setUploadError(`${imageLabels[key]} was resized, but is still larger than ${Math.round(imageLimits[key] / 1024)} KB.`);
        setUploadStatus('');
        return;
      }

      setUploadError('');
      setUploadStatus(`${imageLabels[key]} resized to ${recommendedSize(key)}.`);
      updateBranding({ [key]: resized } as Partial<BrandingSettings>);
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
          <button className="btn btn-ghost" type="button" onClick={onReset} disabled={saving}>
            <RotateCcw size={18} /> Reset
          </button>
          <button className="btn btn-primary" type="button" onClick={onSave} disabled={saving}>
            <Save size={18} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {status && <div className="settings-status-banner">{status}</div>}
      {uploadStatus && <div className="settings-status-banner">{uploadStatus}</div>}
      {uploadError && <div className="settings-error-banner">{uploadError}</div>}

      <div className="settings-grid">
        <section className="settings-section">
          <h3>Identity</h3>
          <label className="settings-field">
            <span>App Name</span>
            <input
              className="glass-input"
              value={branding.appName}
              onChange={event => updateBranding({ appName: event.target.value })}
              placeholder={defaultBranding.appName}
            />
          </label>
          <label className="settings-field">
            <span>Company Name</span>
            <input
              className="glass-input"
              value={branding.companyName}
              onChange={event => updateBranding({ companyName: event.target.value })}
              placeholder="Company or organization"
            />
          </label>
        </section>

        <section className="settings-section">
          <h3>Login Page</h3>
          <label className="settings-field">
            <span>Login Title</span>
            <input
              className="glass-input"
              value={branding.loginTitle}
              onChange={event => updateBranding({ loginTitle: event.target.value })}
              placeholder={defaultBranding.loginTitle}
            />
          </label>
          <label className="settings-field">
            <span>Login Subtitle</span>
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
        <div className="branding-upload-grid">
          <BrandingImageField branding={branding} field="appIconDataUrl" onUpload={readImageFile} onClear={key => updateBranding({ [key]: '' } as Partial<BrandingSettings>)} />
          <BrandingImageField branding={branding} field="faviconDataUrl" onUpload={readImageFile} onClear={key => updateBranding({ [key]: '' } as Partial<BrandingSettings>)} />
          <BrandingImageField branding={branding} field="loginLogoDataUrl" onUpload={readImageFile} onClear={key => updateBranding({ [key]: '' } as Partial<BrandingSettings>)} />
          <BrandingImageField branding={branding} field="loginBackgroundDataUrl" onUpload={readImageFile} onClear={key => updateBranding({ [key]: '' } as Partial<BrandingSettings>)} wide />
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
            <strong>{branding.loginTitle || branding.appName || defaultBranding.appName}</strong>
            <span>{branding.loginSubtitle || defaultBranding.loginSubtitle}</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function BrandingImageField({
  branding,
  field,
  wide = false,
  onUpload,
  onClear,
}: {
  branding: BrandingSettings;
  field: BrandingImageKey;
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
        <span>{recommendedSize(field)} recommended</span>
        <span>Max {Math.round(imageLimits[field] / 1024)} KB saved</span>
      </div>
      <div className="settings-action-row">
        <label className="btn btn-ghost branding-file-button">
          <Upload size={16} /> Upload
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
  const recommendation = imageRecommendations[field];
  return `${recommendation.width} x ${recommendation.height} px`;
};

const dataUrlBytes = (dataUrl: string) => {
  const payload = dataUrl.split(',')[1] || '';
  return Math.floor((payload.length * 3) / 4);
};

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

async function resizeBrandingImage(file: File, field: BrandingImageKey): Promise<string> {
  const recommendation = imageRecommendations[field];
  const image = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = recommendation.width;
  canvas.height = recommendation.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');

  context.clearRect(0, 0, canvas.width, canvas.height);

  if (recommendation.fit === 'cover') {
    const sourceRatio = image.naturalWidth / image.naturalHeight;
    const targetRatio = recommendation.width / recommendation.height;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;
    let sourceX = 0;
    let sourceY = 0;

    if (sourceRatio > targetRatio) {
      sourceWidth = image.naturalHeight * targetRatio;
      sourceX = (image.naturalWidth - sourceWidth) / 2;
    } else {
      sourceHeight = image.naturalWidth / targetRatio;
      sourceY = (image.naturalHeight - sourceHeight) / 2;
    }

    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, recommendation.width, recommendation.height);
  } else {
    const scale = Math.min(recommendation.width / image.naturalWidth, recommendation.height / image.naturalHeight);
    const targetWidth = Math.round(image.naturalWidth * scale);
    const targetHeight = Math.round(image.naturalHeight * scale);
    const targetX = Math.round((recommendation.width - targetWidth) / 2);
    const targetY = Math.round((recommendation.height - targetHeight) / 2);
    context.drawImage(image, targetX, targetY, targetWidth, targetHeight);
  }

  if (field === 'loginBackgroundDataUrl') {
    for (const quality of [recommendation.quality || 0.86, 0.76, 0.64]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrlBytes(dataUrl) <= imageLimits[field]) return dataUrl;
    }
  }

  const dataUrl = canvas.toDataURL(recommendation.outputType, recommendation.quality);
  if (dataUrlBytes(dataUrl) <= imageLimits[field]) return dataUrl;

  return canvas.toDataURL('image/webp', 0.82);
}
