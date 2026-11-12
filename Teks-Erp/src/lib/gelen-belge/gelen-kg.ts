// GELEN KG — fason gelen malın belgedeki kilosu (belge tanıt 3 aşama, 2026-11-09; saf, DB yok). Öncelik SABİTTİR:
// ELLE → şablon alanı (`toplamKg`) → beyan (tablo/blok kg toplamı) → Σ satır kg (yalnız HER satırda kg varsa).
// Okuma özeti, `/partiler`, form kaydı ve İE detayı AYNI seçiciden türetir; kısmi toplam önerilmez (sessiz eksik olmaz).
export type IncomingKgSource = "MANUAL" | "FIELD" | "TOTAL" | "LINE_SUM";

type NumLike = number | string | { toString(): string } | null | undefined;

export interface IncomingKgInput {
  manualKg?: NumLike;
  /** Şablonun `toplamKg` alanı (metre hücresi koruması çağıranda uygulanmış). */
  fieldKg?: NumLike;
  /** Beyan kg: belge geneli başlık beyanı ya da tablo/blok toplamlarının toplamı. */
  declaredKg?: NumLike;
  /** Canlı satır kiloları; biri boş/sıfırsa Σ satır kaynağı kullanılmaz. */
  lineKgs?: ReadonlyArray<NumLike>;
}

export interface IncomingKgResult {
  kg: number | null;
  source: IncomingKgSource | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Pozitif sonlu sayı; değilse null (≤ 0, NaN, boş metin, nesne reddedilir). */
export function positiveKg(v: NumLike): number | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  if (typeof v !== "number" && String(v).trim() === "") return null;
  return Number.isFinite(s) && s > 0 ? r3(s) : null;
}

/** Σ satır: en az bir satır ve HER satır pozitif kg taşımalı; yoksa null. */
export function lineSumKg(lineKgs: ReadonlyArray<NumLike> | undefined): number | null {
  if (!lineKgs?.length) return null;
  let sum = 0;
  for (const v of lineKgs) {
    const n = positiveKg(v);
    if (n === null) return null;
    sum += n;
  }
  return r3(sum);
}

export function pickIncomingKg(i: IncomingKgInput): IncomingKgResult {
  const order: Array<[IncomingKgSource, number | null]> = [
    ["MANUAL", positiveKg(i.manualKg)],
    ["FIELD", positiveKg(i.fieldKg)],
    ["TOTAL", positiveKg(i.declaredKg)],
    ["LINE_SUM", lineSumKg(i.lineKgs)],
  ];
  const hit = order.find(([, v]) => v !== null);
  return hit ? { kg: hit[1], source: hit[0] } : { kg: null, source: null };
}

/** Partinin gelen kg'si (`resolvePartyMeters` emsali): bölüm beyanı kg'si → Σ satır kg. */
export function resolvePartyKg(declaredKg: NumLike, lineKgs: ReadonlyArray<NumLike>, manualKg?: NumLike): IncomingKgResult {
  return pickIncomingKg({ manualKg, declaredKg, lineKgs });
}

/** Belge beyanının kg'si: başlık beyanı (`document.kg`) varsa o; yoksa blok kg'leri — HER blok kg taşıyorsa toplamı. */
export function declaredKgOf(totalsDeclared: unknown): number | null {
  const t = totalsDeclared && typeof totalsDeclared === "object" ? (totalsDeclared as { document?: { kg?: unknown } | null; blocks?: unknown }) : null;
  const doc = positiveKg(t?.document?.kg as NumLike);
  if (doc !== null) return doc;
  if (!Array.isArray(t?.blocks) || t.blocks.length === 0) return null;
  return lineSumKg(t.blocks.map((b) => (b && typeof b === "object" ? ((b as { kg?: unknown }).kg as NumLike) : null)));
}

/** Bölümün beyan kg'si (`totalsDeclared.blocks[blockNo].kg`); yoksa null. */
export function blockDeclaredKg(totalsDeclared: unknown, blockNo: number): number | null {
  const blocks = totalsDeclared && typeof totalsDeclared === "object" ? (totalsDeclared as { blocks?: unknown }).blocks : undefined;
  if (!Array.isArray(blocks)) return null;
  const b = blocks.find((x) => !!x && typeof x === "object" && (x as { blockNo?: unknown }).blockNo === blockNo) as { kg?: unknown } | undefined;
  return positiveKg(b?.kg as NumLike);
}
