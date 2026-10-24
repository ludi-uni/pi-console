import type { ChildProcess } from 'node:child_process';
export function hostPiCli(argv?: string[]): string | undefined;
export function resolvePiCli(env?: NodeJS.ProcessEnv, argv?: string[]): string;
export function startConsole(options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<{ child: ChildProcess; url: string }>;
