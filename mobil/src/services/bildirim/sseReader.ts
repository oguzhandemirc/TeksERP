// `text/event-stream` ayrıştırıcısı — zil istemcisinin saf (ağsız) parçası. `expo/fetch` gövdesi
// ReadableStream verir; RN'de EventSource yok ve başlık taşıyamazdı (plan §3.10).
export interface SseEvent {
  event: string;
  data: string;
}

function parseChunk(chunk: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of chunk.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const k = line.indexOf(':');
    const field = k < 0 ? line : line.slice(0, k);
    const value = k < 0 ? '' : line.slice(k + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length || event !== 'message' ? { event, data: data.join('\n') } : null;
}

/** Gövdeyi olaylara böler; `: ping` yorumları atlanır. */
export async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let i: number;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const ev = parseChunk(buffer.slice(0, i));
        buffer = buffer.slice(i + 2);
        if (ev) yield ev;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseJsonObject(s: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
