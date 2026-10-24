// Pure fake-provider fixture only. No installed server or credential profile is loaded.
export function fakeBroker(): any;
export function harness(override?: (...args:any[])=>Promise<any>): Promise<any>;
export const modernMeta: Record<string,any>;
