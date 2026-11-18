import type { Editor } from '@study/shared';

const names = { vscode: 'VS Code', cursor: 'Cursor' } as const;

/** Where a task lives inside the lab repository, with the separator the path already uses. */
export function taskFolder(labRepoPath: string, labFolder: string): string {
  const separator = labRepoPath.includes('\\') && !labRepoPath.includes('/') ? '\\' : '/';
  const base = labRepoPath.replace(/[\\/]+$/, '');
  return `${base}${separator}${labFolder.split('/').join(separator)}`;
}

/**
 * A link that asks the editor to open a folder. Both editors register the same
 * `<scheme>://file/<absolute path>` form.
 */
export function editorLink(editor: Editor, folder: string): { href: string; label: string } | null {
  if (editor === 'none') return null;
  const path = folder.replaceAll('\\', '/').replace(/^\/+/, '');
  return { href: `${editor}://file/${encodeURI(path)}`, label: `Open in ${names[editor]}` };
}
