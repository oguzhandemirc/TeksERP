// Okuma sidecar'ı istemcisi (D3b) — ham `fetch` değil `egressRequest` boğazı (proxy/adres kuralı tek yerde).
// Yanıt Zod ile `OcrResult`a doğrulanır: FAIL-CLOSED — şemaya uymayan gövde "okunamadı" sayılır, motor hiç görmez.
// Ham OCR metni ve fotoğraf baytı loga/audit'e YAZILMAZ (yalnız boyut, süre, motor adı).
import { z } from "zod";
import { EgressError, egressRequest } from "../http-egress";
import type { OcrResult } from "./motor";

/** Sidecar tek sayfa kilidiyle çalışır; 2600 px fotoğraf CPU'da ~10–60 s (tasarım §3.2: 90 s). */
export const READER_TIMEOUT_MS = 90 * 1000;
/** OCR JSON'u (satır/eleman kutuları) birkaç MB olabilir; egress varsayılanı (2 MB) dar. */
const READER_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const HEALTH_TIMEOUT_MS = 5 * 1000;

const Rect = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const Point = z.object({ x: z.number(), y: z.number() });
const Element = z.object({
  text: z.string(),
  rect: Rect,
  corners: z.array(Point).optional(),
  confidence: z.number().nullable().default(null),
  angle: z.number().nullable().optional(),
});
const Line = z.object({
  text: z.string(),
  rect: Rect,
  corners: z.array(Point).optional(),
  confidence: z.number().nullable().default(null),
  angle: z.number().nullable().default(null),
  elements: z.array(Element).default([]),
});
const Block = z.object({ text: z.string(), rect: Rect, corners: z.array(Point).optional(), lines: z.array(Line) });

/** Sidecar `POST /ocr` gövdesi — `motor/types.ts` `OcrResult` ile aynı sözleşme; fazla alan yok sayılır. */
export const OcrResultSchema = z.object({
  text: z.string(),
  blocks: z.array(Block),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  durationMs: z.number().optional(),
  engine: z.string().optional(),
});

const HealthSchema = z.object({ status: z.string().optional(), engine: z.string().optional(), version: z.string().optional() }).loose();

export type ReaderFailureKind = "UNAVAILABLE" | "HTTP" | "INVALID";

export type ReaderResult =
  | { ok: true; result: OcrResult; engine: string | null; version: string | null; durationMs: number }
  | { ok: false; kind: ReaderFailureKind; code: string; status?: number };

export interface ReaderHealth {
  readonly ok: boolean;
  readonly engine: string | null;
  readonly version: string | null;
  readonly code: string | null;
}

/** `GET /health` — servis ayakta mı; ağ/zaman aşımı → ok:false (fırlatmaz). */
export async function readerHealth(base: string): Promise<ReaderHealth> {
  try {
    const res = await egressRequest(`${base}/health`, { method: "GET", timeoutMs: HEALTH_TIMEOUT_MS, headers: { accept: "application/json" } });
    if (res.status < 200 || res.status >= 300) return { ok: false, engine: null, version: null, code: `HTTP_${res.status}` };
    const parsed = HealthSchema.safeParse(JSON.parse(res.body.toString("utf8")));
    if (!parsed.success) return { ok: false, engine: null, version: null, code: "INVALID_HEALTH" };
    return { ok: true, engine: parsed.data.engine ?? null, version: parsed.data.version ?? null, code: null };
  } catch (err) {
    return { ok: false, engine: null, version: null, code: err instanceof EgressError ? err.code : "EGRESS_NETWORK" };
  }
}

/**
 * `POST /ocr` — fotoğraf JSON `{imageBase64}` ile gider (prototip sözleşmesi; multipart paketi yok).
 * 5xx/ağ/zaman aşımı → UNAVAILABLE (iş yeniden dener) · 4xx → HTTP (kalıcı) · şema dışı gövde → INVALID (kalıcı).
 */
export async function readerOcr(base: string, content: Buffer, mimeType: string, timeoutMs: number = READER_TIMEOUT_MS): Promise<ReaderResult> {
  const started = Date.now();
  let res: { status: number; body: Buffer; headers: Record<string, unknown> };
  try {
    res = await egressRequest(`${base}/ocr`, {
      method: "POST",
      timeoutMs,
      maxBytes: READER_MAX_RESPONSE_BYTES,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ imageBase64: content.toString("base64"), mimeType }),
    });
  } catch (err) {
    return { ok: false, kind: "UNAVAILABLE", code: err instanceof EgressError ? err.code : "EGRESS_NETWORK" };
  }
  if (res.status >= 500 || res.status === 429) return { ok: false, kind: "UNAVAILABLE", code: `HTTP_${res.status}`, status: res.status };
  if (res.status < 200 || res.status >= 300) return { ok: false, kind: "HTTP", code: `HTTP_${res.status}`, status: res.status };
  let json: unknown;
  try {
    json = JSON.parse(res.body.toString("utf8"));
  } catch {
    return { ok: false, kind: "INVALID", code: "OCR_RESULT_NOT_JSON" };
  }
  const parsed = OcrResultSchema.safeParse(json);
  if (!parsed.success) return { ok: false, kind: "INVALID", code: "OCR_RESULT_SCHEMA" };
  const version = typeof res.headers["x-okuma-version"] === "string" ? (res.headers["x-okuma-version"] as string) : null;
  return { ok: true, result: parsed.data as OcrResult, engine: parsed.data.engine ?? null, version, durationMs: Date.now() - started };
}
