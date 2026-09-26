export type StartupOptions={agentDir?:string;startupDir?:string};
export function agentDirectory(env?:NodeJS.ProcessEnv):string;
export function startupStatus(options?:StartupOptions):Promise<{supported:boolean;enabled:boolean;installed:boolean;conflict?:boolean}>;
export function setStartup(enabled:boolean,options?:StartupOptions):Promise<{supported:boolean;enabled:boolean;installed:boolean;conflict?:boolean}>;
export function ensureStartupOnPiSession(options?:StartupOptions):Promise<void>;
