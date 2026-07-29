const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const sourcePath = path.resolve(__dirname, '../src/branding.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
}).outputText;
const testModule = new Module(sourcePath, module);
testModule.paths = module.paths;
testModule._compile(compiled, sourcePath);

const { cacheBranding, readCachedBranding, resolveBrandingPresentation } = testModule.exports;
const indexCss = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf8');

const imageSourcePath = path.resolve(__dirname, '../src/admin/branding-image.ts');
const imageSource = fs.readFileSync(imageSourcePath, 'utf8');
const compiledImageSource = ts.transpileModule(imageSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: imageSourcePath,
}).outputText;
const imageTestModule = new Module(imageSourcePath, module);
imageTestModule.paths = module.paths;
imageTestModule._compile(compiledImageSource, imageSourcePath);
const { brandingImageLimits, calculateDrawRect, optimizeBrandingImage } = imageTestModule.exports;

const imageDataUrl = (bytes, mime = 'image/png') => `data:${mime};base64,${Buffer.alloc(bytes).toString('base64')}`;

function loadTsxModule(relativePath, mocks) {
  const componentPath = path.resolve(__dirname, relativePath);
  const componentSource = fs.readFileSync(componentPath, 'utf8');
  const compiledComponent = ts.transpileModule(componentSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: componentPath,
  }).outputText;
  const componentModule = new Module(componentPath, module);
  componentModule.paths = module.paths;
  componentModule.require = id => Object.prototype.hasOwnProperty.call(mocks, id)
    ? mocks[id]
    : Module.prototype.require.call(componentModule, id);
  componentModule._compile(compiledComponent, componentPath);
  return componentModule.exports;
}

const iconComponents = new Proxy({}, {
  get: () => props => React.createElement('svg', props),
});

const houseBranding = {
  appName: 'House Vo',
  companyName: 'House Vo Consulting',
  loginTitle: 'House Vo Webmail',
  loginSubtitle: 'Welcome home',
  appIconDataUrl: 'data:image/png;base64,aWNvbg==',
  faviconDataUrl: '',
  loginLogoDataUrl: 'data:image/png;base64,bG9nbw==',
  loginBackgroundDataUrl: '',
};

test('saved site branding drives the header and sign-in presentation', () => {
  assert.equal(typeof resolveBrandingPresentation, 'function');

  const presentation = resolveBrandingPresentation({
    appName: 'HouseVo',
    companyName: 'House Vo Consulting',
    loginTitle: 'HouseVo Webmail',
    loginSubtitle: 'Welcome home',
    appIconDataUrl: 'data:image/png;base64,aWNvbg==',
    faviconDataUrl: '',
    loginLogoDataUrl: 'data:image/png;base64,bG9nbw==',
    loginBackgroundDataUrl: 'data:image/jpeg;base64,Ymc=',
  });

  assert.equal(presentation.appName, 'HouseVo');
  assert.equal(presentation.loginTitle, 'HouseVo Webmail');
  assert.equal(presentation.loginSubtitle, 'Welcome home');
  assert.equal(presentation.headerLogoDataUrl, 'data:image/png;base64,aWNvbg==');
  assert.equal(presentation.loginLogoDataUrl, 'data:image/png;base64,bG9nbw==');
  assert.equal(presentation.loginBackgroundDataUrl, 'data:image/jpeg;base64,Ymc=');
});

test('the real sign-in consumer renders saved branding instead of a hardcoded product name', () => {
  const { LoginPage } = loadTsxModule('../src/shared/layouts/AuthGate.tsx', {
    'react-router': { Outlet: () => null },
    '../hooks/useAuth': { useAuth: () => ({}) },
    'lucide-react': iconComponents,
    '../components/Spinner': { Spinner: () => null },
    '../../branding': testModule.exports,
    '../../branding-context': { useBranding: () => ({ branding: houseBranding, isBrandingLoading: false }) },
  });

  const markup = renderToStaticMarkup(React.createElement(LoginPage, {
    login: async () => false,
    branding: houseBranding,
  }));

  assert.match(markup, /House Vo Webmail/);
  assert.match(markup, /House Vo logo/);
  assert.match(markup, /class="login-logo-surface"/);
  assert.match(markup, /class="login-logo-image"/);
  assert.match(indexCss, /\.login-logo-surface\s*\{[\s\S]*background:\s*linear-gradient/);
  assert.doesNotMatch(markup, />OpenMailStack</);
});

test('the real authenticated header renders the saved site name', () => {
  const routerMocks = {
    Outlet: () => null,
    Link: ({ to, children, ...props }) => React.createElement('a', { ...props, href: to }, children),
    useLocation: () => ({ pathname: '/admin/branding' }),
  };
  const { AppShell } = loadTsxModule('../src/shared/layouts/AppShell.tsx', {
    'react-router': routerMocks,
    '../hooks/useAuth': { useAuth: () => ({ user: { email: 'admin@example.test' }, logout: () => undefined }) },
    '../hooks/useMediaQuery': { useMediaQuery: () => false },
    '../hooks/useCalendarSettings': { useCalendarSettings: () => ({ settings: { showHeaderClock: false, clockFormat: '12h', timeZoneMode: 'system', timeZone: 'UTC' }, isLoading: false, error: '', refresh: async () => undefined }) },
    '../hooks/useCalendarTimeZone': { useCalendarTimeZone: () => 'UTC' },
    'lucide-react': iconComponents,
    '../../scheduler/entitlement': { SCHEDULER_ENTITLEMENT_CHANGED: 'scheduler-entitlement-changed' },
    '../../branding': testModule.exports,
    '../../branding-context': { useBranding: () => ({ branding: houseBranding }) },
  });

  const markup = renderToStaticMarkup(React.createElement(AppShell));

  assert.match(markup, /House Vo/);
  assert.doesNotMatch(markup, />OpenMailStack</);
});

test('a blank custom login title follows the saved app name', () => {
  const presentation = resolveBrandingPresentation({
    appName: 'HouseVo',
    companyName: '',
    loginTitle: '',
    loginSubtitle: '',
    appIconDataUrl: '',
    faviconDataUrl: '',
    loginLogoDataUrl: '',
    loginBackgroundDataUrl: '',
  });

  assert.equal(presentation.loginTitle, 'HouseVo');
  assert.equal(presentation.loginSubtitle, 'Sign in to continue');
});

test('a legacy default login title follows a customized site name', () => {
  const presentation = resolveBrandingPresentation({
    appName: 'House Vo',
    companyName: '',
    loginTitle: 'OpenMailStack',
    loginSubtitle: 'Sign in to continue',
    appIconDataUrl: '',
    faviconDataUrl: '',
    loginLogoDataUrl: '',
    loginBackgroundDataUrl: '',
  });

  assert.equal(presentation.loginTitle, 'House Vo');
});

test('last known branding can be restored when the public endpoint is unavailable', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const branding = {
    appName: 'House Vo', companyName: '', loginTitle: 'House Vo', loginSubtitle: 'Welcome',
    appIconDataUrl: '', faviconDataUrl: '', loginLogoDataUrl: '', loginBackgroundDataUrl: '',
  };

  cacheBranding(branding, storage);

  assert.deepEqual(readCachedBranding(storage), branding);
});

test('square targets crop a wide source from the center', () => {
  const rect = calculateDrawRect(1440, 1000, 512, 512, 'cover');

  assert.equal(rect.sourceWidth, 1000);
  assert.equal(rect.sourceHeight, 1000);
  assert.equal(rect.sourceX, 220);
  assert.equal(rect.targetWidth, 512);
  assert.equal(rect.targetHeight, 512);
});

test('wide login logos are contained without cropping', () => {
  const rect = calculateDrawRect(1200, 300, 512, 160, 'contain');

  assert.equal(rect.sourceWidth, 1200);
  assert.equal(rect.sourceHeight, 300);
  assert.equal(rect.targetWidth, 512);
  assert.equal(rect.targetHeight, 128);
  assert.equal(rect.targetY, 16);
});

test('oversized icons progressively compress below the saved limit', async () => {
  const oversized = imageDataUrl(brandingImageLimits.appIconDataUrl + 1);
  const optimized = imageDataUrl(180 * 1024, 'image/webp');
  const attempts = [];

  const result = await optimizeBrandingImage('appIconDataUrl', (width, height, type, quality) => {
    attempts.push({ width, height, type, quality });
    return type === 'image/webp' && quality <= 0.7 ? optimized : oversized;
  });

  assert.equal(result.width, 512);
  assert.equal(result.height, 512);
  assert.ok(result.bytes <= brandingImageLimits.appIconDataUrl);
  assert.ok(attempts.some(attempt => attempt.type === 'image/webp'));
});

test('oversized backgrounds step down dimensions as well as JPEG quality', async () => {
  const oversized = imageDataUrl(brandingImageLimits.loginBackgroundDataUrl + 1, 'image/jpeg');
  const optimized = imageDataUrl(900 * 1024, 'image/jpeg');

  const result = await optimizeBrandingImage('loginBackgroundDataUrl', width => (
    width < 2400 ? optimized : oversized
  ));

  assert.equal(result.width, 2040);
  assert.equal(result.height, 1360);
  assert.ok(result.bytes <= brandingImageLimits.loginBackgroundDataUrl);
});
