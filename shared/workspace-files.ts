// Read-only preview of known UTF-8 text formats. Unknown or binary extensions are never served.
export const workspaceTextExtensions = [
  '.txt', '.md', '.markdown',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php', '.sh', '.ps1', '.bat', '.cmd', '.sql', '.lua', '.dart',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.xml'
] as const;

export function workspaceFileFormat(extension: string): 'markdown' | 'text' | 'code' | undefined {
  const lower = extension.toLowerCase();
  if (!workspaceTextExtensions.some(value => value === lower)) return undefined;
  return lower === '.md' || lower === '.markdown' ? 'markdown' : lower === '.txt' ? 'text' : 'code';
}
