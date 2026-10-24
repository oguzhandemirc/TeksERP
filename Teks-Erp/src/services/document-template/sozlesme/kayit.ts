// =============================================================================
// Belge veri sözleşmesi ERİŞİMİ — `getContract` + genel yardımcılar
// =============================================================================
// Kayıt `index.ts`teki satırlardan kurulur; aynı docType iki kez kayıtlıysa modül
// yüklenirken düşer (sessizce birinin ezilmesi yerine). Bilinmeyen tür FAIL-CLOSED.
// =============================================================================

import { AppError } from "../../../utils/app-error";
import * as REGISTRY from "./index";
import type { ConfigFieldType, FieldClass, FieldType, DocumentContract } from "./tipler";

export type RegisteredContract = DocumentContract<object, unknown>;

const CONTRACTS: ReadonlyMap<string, RegisteredContract> = (() => {
  const m = new Map<string, RegisteredContract>();
  for (const s of Object.values(REGISTRY) as RegisteredContract[]) {
    if (m.has(s.docType)) throw new Error(`Belge sözleşmesi iki kez kayıtlı: ${s.docType}`);
    m.set(s.docType, s);
  }
  return m;
})();

/** Kayıtlı sözleşme; yoksa 400 `DOCUMENT_CONTRACT_UNKNOWN` (tanınmayan kapsam fail-closed). */
export function getContract(docType: string): RegisteredContract {
  const s = CONTRACTS.get(docType);
  if (!s) {
    throw AppError.badRequest(`"${docType}" belge türü için veri sözleşmesi tanımlı değil.`, {
      code: "DOCUMENT_CONTRACT_UNKNOWN",
      docType,
    });
  }
  return s;
}

/** Kayıtlı bütün sözleşmeler, docType sırasıyla. */
export function listContracts(): RegisteredContract[] {
  return [...CONTRACTS.values()].sort((a, b) => a.docType.localeCompare(b.docType, "en"));
}

/** Sözleşmenin iç alanları: kod → (tablo, renderer kolonu). */
export function internalFieldsOf(s: RegisteredContract): Array<{ kod: string; yol: string; tablo: string | null; kaynakKolon: string | null }> {
  const out: Array<{ kod: string; yol: string; tablo: string | null; kaynakKolon: string | null }> = [];
  for (const a of s.kokler) if (a.sinif === "ic" && a.icKod) out.push({ kod: a.icKod, yol: a.yol, tablo: null, kaynakKolon: null });
  for (const t of s.tablolar) {
    for (const c of t.kolonlar) {
      if (c.sinif === "ic" && c.icKod) {
        out.push({ kod: c.icKod, yol: `tablolar.${t.anahtar}[].${c.yol}`, tablo: t.anahtar, kaynakKolon: c.kaynakKolon ?? null });
      }
    }
  }
  return out;
}

/**
 * Plan P-d dönüşümü: Sistem ayarında `columns.<tablo>.shown` ile açılmış iç kolonlar →
 * tasarımcının tek kapısı `internalFields`. Kopyalama/dondurma ve eşdeğerlik aynı yolu kullanır.
 */
export function shownToInternalFields(s: RegisteredContract, rawConfig: unknown): string[] {
  const columns =
    rawConfig && typeof rawConfig === "object" ? (rawConfig as { columns?: Record<string, { shown?: unknown }> }).columns : undefined;
  const out: string[] = [];
  for (const a of internalFieldsOf(s)) {
    if (!a.tablo || !a.kaynakKolon) continue;
    const shown = columns?.[a.tablo]?.shown;
    if (Array.isArray(shown) && shown.includes(a.kaynakKolon)) out.push(a.kod);
  }
  return out;
}

/** Sözleşmede olmayan `internalFields` kodları — kayıt/yayın yolu bunları 400 ile reddeder. */
export function unknownInternalFields(s: RegisteredContract, internalFields: readonly string[]): string[] {
  const known = new Set(internalFieldsOf(s).map((a) => a.kod));
  return internalFields.filter((k) => !known.has(k));
}

export type SummaryClass = FieldClass | "ayar";
export interface SummaryEntry {
  tur: FieldType | ConfigFieldType;
  sinif: SummaryClass;
}

/** Sözleşmenin bağlamda vaat ettiği her yol — özet (`belge-sozlesme-ozeti.json`) bundan üretilir. */
export function contractPaths(s: RegisteredContract): Record<string, SummaryEntry> {
  const out: Record<string, SummaryEntry> = {};
  for (const a of s.kokler) out[a.yol] = { tur: a.tur, sinif: a.sinif };
  for (const t of s.tablolar) {
    for (const c of t.kolonlar) out[`tablolar.${t.anahtar}[].${c.yol}`] = { tur: c.tur, sinif: c.sinif };
  }
  for (const a of internalFieldsOf(s)) out[`ic_acik.${a.kod}`] = { tur: "mantiksal", sinif: "musteri" };
  for (const a of s.ayarSemasi) {
    out[`ayar.${a.yol}`] = { tur: a.tur, sinif: "ayar" };
    if (a.yol.startsWith("kolonlar.")) {
      for (const alt of ["anahtar", "kaynak", "etiket", "hiza", "toplam"]) {
        out[`ayar.${a.yol}[].${alt}`] = { tur: "metin", sinif: "ayar" };
      }
    }
  }
  return out;
}
