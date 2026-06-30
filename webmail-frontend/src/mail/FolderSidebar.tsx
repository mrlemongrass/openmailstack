import { useNavigate } from 'react-router';
import { Inbox, Send, Star, Trash2, Archive, FolderOpen, Edit2 } from 'lucide-react';
import type { MailFolder } from '../shared/types';

interface FolderSidebarProps {
  folders: MailFolder[];
  activeFolder: string;
  expandedFolders: Record<string, boolean>;
  onToggleExpand: (path: string) => void;
  onCompose: () => void;
  quota: { usage: number; limit: number } | null;
}

interface FolderTreeNode {
  name: string;
  fullPath: string;
  children: Record<string, FolderTreeNode>;
  unseen: number;
}

function buildFolderTree(folders: MailFolder[]): FolderTreeNode[] {
  const root: Record<string, FolderTreeNode> = {};
  for (const f of folders) {
    const parts = f.path.split(/[./]/).filter(Boolean);
    if (parts.length === 0) continue;
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      if (!current[name]) {
        current[name] = { name, fullPath: parts.slice(0, i + 1).join('/'), children: {}, unseen: 0 };
      }
      if (i === parts.length - 1) current[name].unseen = f.unseen;
      current = current[name].children;
    }
  }
  return Object.values(root);
}

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  INBOX: Inbox, Sent: Send, Starred: Star, Trash: Trash2, Archive: Archive,
};

export function FolderSidebar({
  folders, activeFolder, expandedFolders, onToggleExpand, onCompose, quota,
}: FolderSidebarProps) {
  const tree = buildFolderTree(folders);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12 }}>
      <button className="btn btn-primary" onClick={onCompose} style={{ width: '100%', marginBottom: 16 }}>
        <Edit2 size={16} /> Compose
      </button>
      <nav style={{ flex: 1, overflowY: 'auto' }}>
        {tree.map((node) => (
          <FolderItem key={node.fullPath} node={node} activeFolder={activeFolder}
            expandedFolders={expandedFolders} onToggleExpand={onToggleExpand}
            depth={0} />
        ))}
      </nav>
      {quota && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-glass)',
          fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{formatBytes(quota.usage)}</span><span>{formatBytes(quota.limit)}</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)' }}>
            <div style={{ height: '100%', borderRadius: 2,
              width: `${Math.min(100, (quota.usage / quota.limit) * 100)}%`,
              background: quota.usage / quota.limit > 0.9 ? 'var(--danger)' : 'var(--accent-primary)' }} />
          </div>
        </div>
      )}
    </div>
  );
}

function FolderItem({ node, activeFolder, expandedFolders, onToggleExpand, depth }: {
  node: FolderTreeNode; activeFolder: string;
  expandedFolders: Record<string, boolean>;
  onToggleExpand: (path: string) => void;
  depth: number;
}) {
  const navigate = useNavigate();
  const isExpanded = expandedFolders[node.fullPath];
  const hasChildren = Object.keys(node.children).length > 0;
  const IconComp = ICON_MAP[node.name] || FolderOpen;
  const isActive = activeFolder === node.fullPath;

  const handleNavigate = () => {
    navigate(`/mail/${encodeURIComponent(node.fullPath)}`);
  };

  return (
    <div>
      <div className={`nav-item${isActive ? ' nav-item--active' : ''}`}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
          paddingLeft: 12 + depth * 16, borderRadius: 'var(--radius-md)', cursor: 'pointer',
          fontWeight: isActive ? 600 : 400, background: isActive ? 'rgba(59,130,246,0.15)' : 'transparent',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: '0.9rem' }}>
        {hasChildren ? (
          <span style={{ fontSize: '0.7rem', width: 12, cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onToggleExpand(node.fullPath); }}>
            {isExpanded ? '▼' : '▶'}
          </span>
        ) : (
          <span style={{ fontSize: '0.7rem', width: 12 }} />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}
          onClick={handleNavigate}>
          <IconComp size={16} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        </div>
        {node.unseen > 0 && (
          <span style={{ background: 'var(--accent-primary)', color: 'white', borderRadius: 999,
            padding: '1px 6px', fontSize: '0.7rem', fontWeight: 600 }}>{node.unseen}</span>
        )}
      </div>
      {isExpanded && hasChildren && Object.values(node.children).map((child: any) => (
        <FolderItem key={child.fullPath} node={child} activeFolder={activeFolder}
          expandedFolders={expandedFolders} onToggleExpand={onToggleExpand}
          depth={depth + 1} />
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
