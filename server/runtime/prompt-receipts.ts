import { createHash } from 'node:crypto';
import { mkdir, readFile, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export class PromptDeliveryError extends Error {
  readonly status = 409;
  readonly deliveryUnconfirmed = true;
}
type Receipt = { version: 1; hash: string; state: 'pending' | 'accepted' | 'uncertain'; runId?: string };
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);

// Claim on disk BEFORE dispatch. A crash between dispatch and recording its ACK
// leaves an uncertain receipt, never permission to execute the same request again.
// Receipts contain a hash and outcome, not prompt text, attachments or credentials.
export class PromptReceipts {
  private inFlight = new Map<string, { hash: string; result: Promise<string> }>();
  constructor(private readonly dir: string) {}
  execute(requestId: unknown, payload: unknown, dispatch: () => Promise<string>): Promise<string> {
    if (!validId(requestId)) return Promise.reject(new Error('invalid prompt request ID'));
    const id = requestId.toLowerCase();
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const active = this.inFlight.get(id);
    if (active) return active.hash === hash ? active.result : Promise.reject(new PromptDeliveryError('Request ID belongs to a different submission'));
    const result = Promise.resolve().then(() => this.claimAndDispatch(id, hash, dispatch));
    this.inFlight.set(id, { hash, result });
    const cleanup = () => { if (this.inFlight.get(id)?.result === result) this.inFlight.delete(id); };
    void result.then(cleanup, cleanup);
    return result;
  }
  private async read(file: string): Promise<Receipt | undefined> {
    try {
      const value = JSON.parse(await readFile(file, 'utf8')) as Receipt;
      if (value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.hash) || !['pending', 'accepted', 'uncertain'].includes(value.state) || value.state === 'accepted' && typeof value.runId !== 'string') throw new Error('invalid receipt');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new PromptDeliveryError('Submission receipt cannot be read. It will not be dispatched again; inspect session history.');
    }
  }
  private replay(receipt: Receipt, hash: string): string {
    if (receipt.hash !== hash) throw new PromptDeliveryError('Request ID belongs to a different submission');
    if (receipt.state === 'accepted') return receipt.runId!;
    throw new PromptDeliveryError('Delivery is unconfirmed. This submission will not be dispatched again. Review session history before composing another prompt.');
  }
  private async write(file: string, receipt: Receipt, exclusive = false) {
    const handle = await open(file, exclusive ? 'wx' : 'w', 0o600);
    try { await handle.writeFile(JSON.stringify(receipt)); await handle.sync(); }
    finally { await handle.close(); }
  }
  private async replace(file: string, receipt: Receipt) {
    const temp = `${file}.${process.pid}.tmp`;
    try { await this.write(temp, receipt); await rename(temp, file); }
    finally { await rm(temp, { force: true }).catch(() => {}); }
  }
  private async claimAndDispatch(id: string, hash: string, dispatch: () => Promise<string>): Promise<string> {
    const file = join(this.dir, `${id}.json`);
    const existing = await this.read(file);
    if (existing) return this.replay(existing, hash);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try { await this.write(file, { version: 1, hash, state: 'pending' }, true); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return this.replay((await this.read(file))!, hash);
      throw new PromptDeliveryError('Cannot record submission before dispatch. Nothing was sent by this attempt.');
    }
    let runId: string;
    try { runId = await dispatch(); }
    catch (error) {
      await this.replace(file, { version: 1, hash, state: 'uncertain' }).catch(() => {});
      const reason = error instanceof Error ? error.message.slice(0, 300) : 'unknown error';
      throw new PromptDeliveryError(`Submission did not return a confirmed acknowledgement: ${reason}. It will not be dispatched again; review session history.`);
    }
    try { await this.replace(file, { version: 1, hash, state: 'accepted', runId }); }
    catch { throw new PromptDeliveryError('Pi accepted the submission, but its receipt could not be saved. It will not be dispatched again; review session history.'); }
    return runId;
  }
}
