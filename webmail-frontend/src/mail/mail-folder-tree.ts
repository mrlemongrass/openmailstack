import type { MailFolder } from '../shared/types';

export interface FolderTreeNode {
  name: string;
  fullPath: string;
  children: Record<string, FolderTreeNode>;
  unseen: number;
  delimiter: string;
  specialUse?: string;
  disabled: boolean;
  exists: boolean;
}

const createFolderNodeMap = (): Record<string, FolderTreeNode> => (
  Object.create(null) as Record<string, FolderTreeNode>
);

export function buildFolderTree(folders: MailFolder[]): FolderTreeNode[] {
  const root = createFolderNodeMap();
  for (const folder of folders) {
    const delimiter = typeof folder.delimiter === 'string'
      ? folder.delimiter
      : (folder.path.includes('/') ? '/' : folder.path.includes('.') ? '.' : '');
    const parts = delimiter
      ? folder.path.split(delimiter).filter(Boolean)
      : [folder.path].filter(Boolean);
    if (parts.length === 0) continue;
    let current = root;
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      const fullPath = delimiter ? parts.slice(0, index + 1).join(delimiter) : name;
      if (!Object.hasOwn(current, name)) {
        current[name] = {
          name,
          fullPath,
          children: createFolderNodeMap(),
          unseen: 0,
          delimiter,
          disabled: false,
          exists: false,
        };
      }
      current[name].fullPath = fullPath;
      if (index === parts.length - 1) {
        current[name].unseen = folder.unseen;
        current[name].delimiter = delimiter;
        current[name].specialUse = folder.specialUse;
        current[name].disabled = Boolean(folder.disabled);
        current[name].exists = true;
      }
      current = current[name].children;
    }
  }
  return Object.values(root);
}
