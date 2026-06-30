import Quill from 'react-quill-new';

const Inline = Quill.import('blots/inline') as any;

class ChecklistBlot extends Inline {
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
    } else {
      super.format(name, value);
    }
  }
}

export { ChecklistBlot };
