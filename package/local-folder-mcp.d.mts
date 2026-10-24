export function ownerOrigin(value: string): string;
export function privatePost(origin: string, route: string, body: any, token?: string, signal?: AbortSignal): Promise<any>;
export function discoverBroker(value: string, signal?: AbortSignal): Promise<string>;
export function createStdioSession(options: { post: (route: string, body: any, token?: string, signal?: AbortSignal) => Promise<any>; controlPost?: (route: string, body: any, token?: string, signal?: AbortSignal) => Promise<any>; now?: () => number; generation?: () => string }): { message(m: any): Promise<any>; close(): void };
