import Quill from 'react-quill-new';

const Block = Quill.import('blots/block') as any;

class CodeBlockBlot extends Block {
  static blotName = 'code-block';
  static tagName = 'pre';
  static className = 'ql-code-block-container';

  static create(value: any) {
    const node = super.create(value);
    node.setAttribute('spellcheck', 'false');
    node.setAttribute('data-language', value || '');

    const code = document.createElement('code');
    code.className = value ? `language-${value}` : '';

    return node;
  }

  static formats(domNode: HTMLElement): any {
    return domNode.getAttribute('data-language') || '';
  }

  format(name: string, value: any): void {
    if (name === 'code-block') {
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
