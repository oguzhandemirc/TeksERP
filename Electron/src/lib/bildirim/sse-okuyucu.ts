// `text/event-stream` ayrıştırıcısı ve yük yardımcıları — zil istemcisinin saf (ağsız) parçası.
// EventSource başlık taşıyamadığı için akış `fetch` + ReadableStream ile okunur (plan §3.10).
export interface SseEvent {
  event: string;
  data: string;
}

/** `text/event-stream` gövdesini olaylara böler; `: ping` yorumları atlanır. */
export async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i: number;
      while ((i = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of chunk.split("\n")) {
          if (!line || line.startsWith(":")) continue;
          const k = line.indexOf(":");
          const field = k < 0 ? line : line.slice(0, k);
          const value = k < 0 ? "" : line.slice(k + 1).replace(/^ /, "");
          if (field === "event") event = value;
          else if (field === "data") data.push(value);
        }
        if (data.length || event !== "message") yield { event, data: data.join("\n") };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseJsonObject(s: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
export const asNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

