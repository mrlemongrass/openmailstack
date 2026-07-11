import ReactQuill from 'react-quill-new';
const Quill = ReactQuill.Quill as unknown as {
  import(path: string): unknown;
};

type QuillBlockConstructor = {
  new (...args: unknown[]): { domNode: HTMLElement; format(name: string, value: unknown): void };
  create(value: unknown): HTMLElement;
};

const Block = Quill.import('blots/block') as QuillBlockConstructor;

class CodeBlockBlot extends Block {
  declare domNode: HTMLElement;

  static blotName = 'syntax-code-block';
  static tagName = 'pre';
  static className = 'ql-syntax-code-block-container';

  static create(value: unknown) {
    const node = super.create(value);
    node.setAttribute('spellcheck', 'false');
    node.setAttribute('data-language', typeof value === 'string' ? value : '');

    const code = document.createElement('code');
    code.className = typeof value === 'string' && value ? `language-${value}` : '';
    node.appendChild(code);

    return node;
  }

  static formats(domNode: HTMLElement): string {
    return domNode.getAttribute('data-language') || '';
  }

  format(name: string, value: unknown): void {
    if (name === 'syntax-code-block') {
      const language = typeof value === 'string' ? value : '';
      this.domNode.setAttribute('data-language', language);
      const code = this.domNode.querySelector('code');
      if (code) {
        code.className = language ? `language-${language}` : '';
      }
    } else {
      super.format(name, value);
    }
  }
}

export { CodeBlockBlot };
