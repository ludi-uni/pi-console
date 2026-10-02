type RecordValue = Record<string, any>;

/** Drop only finalized message events already in the baseline, and only before the
 * snapshot's stdout boundary. Timestamp + the entire message distinguish identical
 * prompt text; events after the boundary are always new, even with identical text. */
export function historyReplay(messages: RecordValue[], records: RecordValue[], boundary: number): RecordValue[] {
  const counts = new Map<string, number>();
  const identity = (message: RecordValue | undefined) => message && message.timestamp !== undefined
    ? JSON.stringify(message) : undefined;
  for (const message of messages) {
    const key = identity(message);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const skip = new Set<number>();
  let assistantStart: number | undefined;
  for (let i = 0; i < Math.min(boundary, records.length); i++) {
    const record = records[i];
    if (record.type === 'message_start' && record.message?.role === 'assistant') assistantStart = i;
    if (record.type !== 'message_end') continue;
    const key = identity(record.message);
    if (key && (counts.get(key) ?? 0) > 0) {
      counts.set(key, counts.get(key)! - 1);
      skip.add(i);
      if (record.message.role === 'assistant' && assistantStart !== undefined) {
        for (let j = assistantStart; j < i; j++) {
          if (['message_start', 'message_update'].includes(records[j].type)) skip.add(j);
        }
      }
    }
    if (record.message?.role === 'assistant') assistantStart = undefined;
  }
  return records.filter((_, index) => !skip.has(index));
}
