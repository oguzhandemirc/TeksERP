// Canlı okuma (L3) — `POST /gelen-belge/canli-okuma` istemcisi (sunucu `gelen-belge-canli-okuma.service.ts`, salt okuma,
// `gelen-belge:write`). Gövde sunucunun katı `ClientOcrSchema`sıyla AYNI alan listesinden kurulur (fazla alan 400 olur).
// Yanıt savunmayla ayrıştırılır: bozuk yanıt null döner, ekran o kareyi atlar; ağ hatası çağırana fırlar (sonraki kare dener).
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type { ClientOcr } from './deviceOcr';

/** Kare okuması tek istekte bu kadar bekler; geç kalan yanıt sonraki kareyi geciktirmesin. */
const LIVE_READ_TIMEOUT_MS = 5000;

export interface LiveReadBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LiveReadField {
  key: string;
  label: string;
  value: string | null;
  needsReview: boolean;
  issues?: string[];
  box?: LiveReadBox;
}

export interface LiveReadResult {
  template: { code: string; name: string; version: number } | null;
  score: number;
  fields: LiveReadField[];
  engineMs: number;
}

/** Gövde allowlist'i: yalnız `ClientOcrSchema` alanları (strictObject). */
export function toLiveReadBody(ocr: ClientOcr): ClientOcr {
  return {
    engine: ocr.engine,
    width: ocr.width,
    height: ocr.height,
    ...(ocr.rotation !== undefined ? { rotation: ocr.rotation } : {}),
    ...(ocr.ms !== undefined ? { ms: ocr.ms } : {}),
    words: ocr.words,
    ...(ocr.lines !== undefined ? { lines: ocr.lines } : {}),
  };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseBox(v: unknown): LiveReadBox | undefined {
  const b = v as Record<string, unknown> | null;
  return b && num(b.x) && num(b.y) && num(b.w) && num(b.h) ? { x: b.x, y: b.y, w: b.w, h: b.h } : undefined;
}

function parseField(v: unknown): LiveReadField | null {
  const f = v as Record<string, unknown> | null;
  if (!f || typeof f.key !== 'string' || typeof f.label !== 'string') return null;
  if (f.value !== null && typeof f.value !== 'string') return null;
  const box = parseBox(f.box);
  const issues = Array.isArray(f.issues) ? f.issues.filter((i): i is string => typeof i === 'string') : undefined;
  return { key: f.key, label: f.label, value: f.value, needsReview: f.needsReview === true, ...(issues ? { issues } : {}), ...(box ? { box } : {}) };
}

/** Sunucu yanıtı → sonuç; şekil bozuksa null (kare atlanır). */
export function parseLiveReadResult(raw: unknown): LiveReadResult | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.fields)) return null;
  const t = o.template as Record<string, unknown> | null;
  let template: LiveReadResult['template'] = null;
  if (t !== null && t !== undefined) {
    if (typeof t.code !== 'string' || typeof t.name !== 'string') return null;
    template = { code: t.code, name: t.name, version: num(t.version) ? t.version : 0 };
  }
  const fields: LiveReadField[] = [];
  for (const f of o.fields) {
    const p = parseField(f);
    if (!p) return null;
    fields.push(p);
  }
  return { template, score: num(o.score) ? o.score : 0, fields, engineMs: num(o.engineMs) ? o.engineMs : 0 };
}

export const liveReadService = {
  readFrame: async (ocr: ClientOcr): Promise<LiveReadResult | null> => {
    const r = await apiClient.post<ApiResponse<unknown>>('/gelen-belge/canli-okuma', toLiveReadBody(ocr), { timeout: LIVE_READ_TIMEOUT_MS });
    return parseLiveReadResult(r.data.data);
  },
};
