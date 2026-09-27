// Read-only preview of known UTF-8 text formats. Unknown or binary extensions are never served.
export const workspaceTextExtensions = [
  '.txt', '.md', '.markdown',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php', '.sh', '.ps1', '.bat', '.cmd', '.sql', '.lua', '.dart',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.xml'
] as const;

export const workspaceMediaTypes: Record<string,{format:'image'|'video';mime:string}> = {
  '.png':{format:'image',mime:'image/png'},'.jpg':{format:'image',mime:'image/jpeg'},'.jpeg':{format:'image',mime:'image/jpeg'},
  '.gif':{format:'image',mime:'image/gif'},'.webp':{format:'image',mime:'image/webp'},
  '.mp4':{format:'video',mime:'video/mp4'},'.webm':{format:'video',mime:'video/webm'},
};
export const workspaceMediaType=(extension:string)=>workspaceMediaTypes[extension.toLowerCase()];

export function workspaceFileFormat(extension: string): 'markdown' | 'text' | 'code' | undefined {
  const lower = extension.toLowerCase();
  if (!workspaceTextExtensions.some(value => value === lower)) return undefined;
  return lower === '.md' || lower === '.markdown' ? 'markdown' : lower === '.txt' ? 'text' : 'code';
}
