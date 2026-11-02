// =============================================================================
// KURŞUN İSTASYONU — gramaj tablosu durumu (oie-a). Saf katman: vitest buradan kilitler.
// =============================================================================
// Sunucu `PUT /api/station-capabilities/:id/kursun` gramaj listesinin TAMAMINI alır: listeden
// çıkan kod SİLİNMEZ pasife düşer, bu yüzden pasif satırlar da gövdede kalır. Tek varsayılan
// kuralı hem burada (UI) hem sunucuda (400 + DB kısmi unique) uygulanır.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { Currency } from "@/pages/Finance/service";

export interface KursunGramajRow {
  /** Sunucudan gelen kod; yeni satırda yok (sunucu addan türetir). */
  code?: string;
  name: string;
  /** HAM METİN gr/m ("" = sayısız eski değer). */
  amount: string;
  isActive: boolean;
  isDefault: boolean;
}

export interface KursunStationState {
  enabled: boolean;
  rows: KursunGramajRow[];
  /** HAM METİN, "" = gram fiyatı yok (hizmet kalemi fiyatı). */
  gramPrice: string;
  gramCurrency: Currency;
}

export interface KursunStationDto {
  stationId: string;
  enabled: boolean;
  flagPropertyId: string | null;
  values: Array<{ id: string; code: string; name: string; amount: string | null; isDefault: boolean; isActive: boolean; sortOrder: number }>;
  gramPrice: string | null;
  gramCurrency: Currency | null;
}

export interface KursunStationBody {
  enabled: boolean;
  values?: Array<{ code?: string; name: string; amount: string | null; isActive: boolean; isDefault: boolean }>;
  gramPrice: string | null;
  gramCurrency: Currency | null;
}

export function stateFromDto(d: KursunStationDto): KursunStationState {
  return {
    enabled: d.enabled,
    rows: d.values.map((v) => ({ code: v.code, name: v.name, amount: v.amount ?? "", isActive: v.isActive, isDefault: v.isDefault })),
    gramPrice: d.gramPrice ?? "",
    gramCurrency: d.gramCurrency ?? "TRY",
  };
}

export function addRow(rows: KursunGramajRow[], name: string, amount: string): KursunGramajRow[] {
  return [...rows, { name: name.trim(), amount: amount.trim(), isActive: true, isDefault: false }];
}

/** Varsayılan TEKTİR: seçilen satır varsayılan olur, diğerleri düşer; zaten varsayılansa kaldırılır. Pasif satır seçilemez. */
export function setDefault(rows: KursunGramajRow[], index: number): KursunGramajRow[] {
  const target = rows[index];
  if (!target || !target.isActive) return rows;
  const next = !target.isDefault;
  return rows.map((r, i) => ({ ...r, isDefault: i === index ? next : false }));
}

/** Pasife al / geri aç (silme yok); pasife düşen varsayılanlığını da kaybeder. */
export function toggleActive(rows: KursunGramajRow[], index: number): KursunGramajRow[] {
  return rows.map((r, i) => (i === index ? { ...r, isActive: !r.isActive, isDefault: r.isActive ? false : r.isDefault } : r));
}

export function moveRow(rows: KursunGramajRow[], index: number, dir: -1 | 1): KursunGramajRow[] {
  const j = index + dir;
  if (j < 0 || j >= rows.length) return rows;
  const out = [...rows];
  [out[index], out[j]] = [out[j] as KursunGramajRow, out[index] as KursunGramajRow];
  return out;
}

/** gr/m: "" → null · "40" / "40,5" → "40" / "40.5" · geçersiz/≤0 → undefined. */
export function parseGramAmount(raw: string): string | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const m = /^(\d{1,7})(?:[.,](\d{1,3}))?$/.exec(t);
  if (!m) return undefined;
  const v = m[2] ? `${m[1]}.${m[2]}` : (m[1] as string);
  return Number(v) > 0 ? v : undefined;
}

export function parseGramPrice(raw: string): string | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const m = /^(\d{1,8})(?:[.,](\d{1,4}))?$/.exec(t);
  if (!m) return undefined;
  return m[2] ? `${m[1]}.${m[2]}` : (m[1] as string);
}

export function buildKursunBody(s: KursunStationState): { ok: true; body: KursunStationBody } | { ok: false; error: string } {
  const price = parseGramPrice(s.gramPrice);
  if (price === undefined) return { ok: false, error: "Gram fiyatı en fazla 4 ondalıklı sayı olmalı — örn. 0,05." };
  const base = { enabled: s.enabled, gramPrice: price, gramCurrency: price === null ? null : s.gramCurrency };
  if (!s.enabled) return { ok: true, body: base };
  const values: NonNullable<KursunStationBody["values"]> = [];
  for (const r of s.rows) {
    if (r.name.trim() === "") return { ok: false, error: "Gramaj adı boş olamaz." };
    const amount = parseGramAmount(r.amount);
    if (amount === undefined) return { ok: false, error: `'${r.name}' gramajı (gr/m) 0'dan büyük, en fazla 3 ondalıklı sayı olmalı.` };
    values.push({ ...(r.code ? { code: r.code } : {}), name: r.name.trim(), amount, isActive: r.isActive, isDefault: r.isActive && r.isDefault });
  }
  if (values.filter((v) => v.isDefault).length > 1) return { ok: false, error: "Yalnız bir gramaj varsayılan olabilir." };
  return { ok: true, body: { ...base, values } };
}

export const kursunStationKey = (stationId: string) => ["station-capabilities", "kursun", stationId] as const;

export async function fetchKursunStation(stationId: string): Promise<KursunStationDto> {
  const r = await apiClient.get<{ data: KursunStationDto }>(`/api/station-capabilities/${stationId}/kursun`);
  return r.data.data;
}

export async function saveKursunStation(stationId: string, body: KursunStationBody): Promise<KursunStationDto> {
  const r = await apiClient.put<{ data: KursunStationDto }>(`/api/station-capabilities/${stationId}/kursun`, body);
  return r.data.data;
}
