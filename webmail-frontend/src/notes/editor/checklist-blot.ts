import Quill from 'react-quill-new';

const Block = (Quill as any).import('blots/block');

class ChecklistBlot extends Block {
  static blotName = 'checklist-item';
  static tagName = 'li';
  static className = 'ql-checklist-item';

  static create(value: any) {
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
      const blot = (Quill as any).find(node);
      if (blot) {
        const current = node.getAttribute('data-checked') === 'true';
        blot.format('checklist-item', !current);
      }
    });
    node.insertBefore(checkbox, node.firstChild);
    return node;
  }

  static formats(domNode: HTMLElement): any {
    return domNode.getAttribute('data-checked') === 'true';
  }

  format(name: string, value: any): void {
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
