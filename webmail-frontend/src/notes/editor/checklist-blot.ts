import ReactQuill from 'react-quill-new';
const Quill = ReactQuill.Quill as unknown as {
  import(path: string): unknown;
  find(node: Node): { format(name: string, value: unknown): void } | null;
};

type QuillBlockConstructor = {
  new (...args: unknown[]): { domNode: HTMLElement; format(name: string, value: unknown): void };
  create(value: unknown): HTMLElement;
};

const Block = Quill.import('blots/block') as QuillBlockConstructor;

class ChecklistBlot extends Block {
  declare domNode: HTMLElement;

  static blotName = 'checklist-item';
  static tagName = 'li';
  static className = 'ql-checklist-item';

  static create(value: unknown) {
    const node = super.create(value);
    node.setAttribute('data-checked', value === true ? 'true' : 'false');
    // Insert a clickable checkbox span
    const checkbox = document.createElement('span');
    checkbox.className = 'ql-checkbox';
    checkbox.contentEditable = 'false';
    checkbox.innerHTML = value ? '✓' : '';
    // Click handler to toggle checked state
    checkbox.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const blot = Quill.find(node);
      if (blot) {
        const current = node.getAttribute('data-checked') === 'true';
        blot.format('checklist-item', !current);
      }
    });
    node.insertBefore(checkbox, node.firstChild);
    return node;
  }

  static formats(domNode: HTMLElement): boolean {
    return domNode.getAttribute('data-checked') === 'true';
  }

  format(name: string, value: unknown): void {
    if (name === 'checklist-item') {
      this.domNode.setAttribute('data-checked', value ? 'true' : 'false');
      const checkbox = this.domNode.querySelector('.ql-checkbox');
      if (checkbox) {
        (checkbox as HTMLElement).innerHTML = value ? '✓' : '';
      }
    }
    super.format(name, value);
  }
}

export { ChecklistBlot };
