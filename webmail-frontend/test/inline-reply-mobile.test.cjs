const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const componentPath = path.resolve(__dirname, '../src/mail/components/InlineReply.tsx');

function renderInlineReply() {
  const source = fs.readFileSync(componentPath, 'utf8');
  const compiled = ts.transpileModule(source, {
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
  componentModule.require = id => {
    if (id === 'lucide-react') {
      return new Proxy({}, {
        get: () => props => React.createElement('svg', props),
      });
    }
    if (id === '../../shared/components/Spinner') {
      return { Spinner: () => React.createElement('span', null, 'Loading') };
    }
    return Module.prototype.require.call(componentModule, id);
  };
  componentModule._compile(compiled, componentPath);

  return renderToStaticMarkup(React.createElement(componentModule.exports.InlineReply, {
    replyTo: 'localtest@housevo.us',
    replyText: 'A temporary reply',
    replySending: false,
    onReplyTextChange: () => undefined,
    onSend: () => undefined,
    onSendAndArchive: () => undefined,
    onOpenFullCompose: () => undefined,
  }));
}

test('mobile inline reply keeps its primary and secondary actions readable', () => {
  const markup = renderInlineReply();
  const css = fs.readFileSync(
    path.resolve(__dirname, '../src/index.css'),
    'utf8',
  );

  assert.match(markup, /class="inline-reply-actions"/);
  assert.match(
    css,
    /@media \(max-width: 767px\)[\s\S]*\.inline-reply-actions\s*\{[\s\S]*grid-template-columns:\s*1fr 1fr[\s\S]*\.inline-reply-actions \.btn:first-child\s*\{[\s\S]*grid-column:\s*1 \/ -1/,
  );
});
