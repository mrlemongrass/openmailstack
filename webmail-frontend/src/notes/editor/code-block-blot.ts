import ReactQuill from 'react-quill-new';
const Quill = ReactQuill.Quill;

const Block = Quill.import('blots/block') as any;

class CodeBlockBlot extends Block {
  static blotName = 'syntax-code-block';
  static tagName = 'pre';
  static className = 'ql-syntax-code-block-container';

  static create(value: any) {
    const node = super.create(value);
    node.setAttribute('spellcheck', 'false');
    node.setAttribute('data-language', value || '');

    const code = document.createElement('code');
    code.className = value ? `language-${value}` : '';
    node.appendChild(code);

    return node;
  }

  static formats(domNode: HTMLElement): any {
    return domNode.getAttribute('data-language') || '';
  }

  format(name: string, value: any): void {
    if (name === 'syntax-code-block') {
      this.domNode.setAttribute('data-language', value || '');
      const code = this.domNode.querySelector('code');
      if (code) {
        code.className = value ? `language-${value}` : '';
      }
    } else {
      super.format(name, value);
    }
  }
}

export { CodeBlockBlot };
