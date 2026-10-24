// =============================================================================
// Sözleşme SENARYOLARI — `sample-data.ts`in üstüne kurulan örnek veri kümesi
// =============================================================================
// `sample-data.ts` DEĞİŞMEZ (panel önizlemesi + altın bekçiler ona bağlı); her
// sözleşme kendi senaryolarını onun kopyasından türetir. Bekçi, eşdeğerlik ve
// tasarımcının "örnek veri" seçicisi aynı kümeyi okur.
// =============================================================================

import type { PrintedDocType } from "@prisma/client";
import { envelopeHead, type PrintedDocSnapshot } from "../../printed-document.service";
import type { DocumentConfig } from "../../system-setting.service";
import { SAMPLE_PRINTED_DOCS, setSampleClock } from "../../document-render/sample-data";
import { previewSeriesCode, resolveSeriesFormat } from "../../number-series.service";

/** Senaryoların sabit saati — örnek numaranın tarih segmenti gün dönümünde kaymasın. */
export const SCENARIO_CLOCK = "2026-09-25T08:30:00.000Z";

/** Her sözleşmenin vermek ZORUNDA olduğu senaryolar (bekçi §0 ölçer). */
export const REQUIRED_SCENARIOS = ["ornek", "tek_kalem", "cok_sayfa", "bos_opsiyonel", "uzun_metin", "iptal"] as const;

/**
 * Örnek `doc`un bağımsız kopyası, sabit saatle. Getter'lı alanlar (seriden türeyen
 * örnek numara) kopya anında değerlenir; saat sonra varsayılana (şimdi) döner ki
 * aynı süreçteki panel önizlemesi donmuş tarihle kalmasın.
 */
export function sampleDoc(docType: PrintedDocType): Record<string, unknown> {
  setSampleClock(() => new Date(SCENARIO_CLOCK));
  try {
    return JSON.parse(JSON.stringify(SAMPLE_PRINTED_DOCS[docType])) as Record<string, unknown>;
  } finally {
    setSampleClock(null);
  }
}

/**
 * Senaryo örnek kodu — SERİDEN türetilir, literal yazılmaz (D7): fabrika ön eki değişince
 * senaryo da değişir. Yalnız senaryo kurulurken çağrılır (modül yüklenirken değil).
 */
export function sampleSeriesCode(key: string, seq: number): string {
  return previewSeriesCode(resolveSeriesFormat(key), seq, new Date(SCENARIO_CLOCK));
}

/** Senaryo zarfı — künyesi dolu (ek satırlı), ticari yuvarlama damgalı. */
export function sampleEnvelope(doc: Record<string, unknown>, docConfigOverride: DocumentConfig | null = null): PrintedDocSnapshot {
  // Baş (yuvarlama damgası dahil) TEK yazardan; yalnız donma anı senaryo saatine sabitlenir.
  return {
    ...envelopeHead(),
    frozenAt: SCENARIO_CLOCK,
    company: {
      name: "Örnek Tekstil San. ve Tic. A.Ş.",
      letterhead: {
        addressLine: "Organize Sanayi Bölgesi 3. Cadde No:5 Manisa",
        phone: "0236 000 00 00",
        taxInfo: "Manisa VD 1234567890",
        extraLines: ["IBAN: TR00 0000 0000 0000 0000 0000 00", "Mersis: 0123456789000015"],
      },
      logoHash: null,
    },
    docConfigOverride,
    doc,
  };
}

/** Uzun metin senaryosu için tekrarlı, kaçış gerektiren metin. */
export function longText(base: string, maxLength = 240): string {
  let s = base;
  while (s.length < maxLength) s += ` ${base}`;
  return `${s.slice(0, maxLength)} <&"'>`;
}
