// =============================================================================
// GELEN BELGE — cihaz okumasının SUNUCU TAMAMLAMASI: tablet okuması bir şablona sınıflandı ve başlık alanı boş kaldıysa
// aynı fotoğraf sunucu okuyucusuna (okuma servisi) BİR KEZ okutulur; birleşim `sunucu-tamamlama.ts`te (yalnız boş alan dolar).
// Tx DIŞINDA koşar. Okuyucu yok/hata/zaman aşımı → cihaz sonucu kalır (fail-soft) ama uyarı log'u + zarfta `failed` künyesi.
// Ek gecikme yalnız eksik alanlı sayfada: tam okunmuş sayfada okuyucu hiç çağrılmaz.
// =============================================================================
import { bilgi, uyari } from "../lib/logger";
import { extractDocument, type OcrResult } from "../lib/gelen-belge/motor";
import { readerOcr } from "../lib/gelen-belge/okuma-istemcisi";
import { missingHeaderFields } from "../lib/gelen-belge/sunucu-tamamlama";
import { getReaderUrl } from "../lib/gelen-belge/url";
import { engineTemplates } from "./gelen-belge-ozel-sablon.service";
import { FALLBACK_TEMPLATE_CODE } from "./gelen-belge-sablon.service";
import type { CompleteFn } from "./gelen-belge-okuma.service";
import type { ServerComplement } from "./gelen-belge-taslak-doldur.service";

/** Yükleme isteği içinde beklenir: sunucu okuması ölçülen ~1 s; tavan istek zaman aşımından kısa (aşılırsa cihaz sonucu kalır). */
export const SERVER_COMPLETE_TIMEOUT_MS = 20 * 1000;

/** Cihaz okumasının boş başlık alanları (sınıflanmamış/yedek şablonda boş liste). */
export async function deviceMissingFields(result: OcrResult): Promise<string[]> {
  return missingHeaderFields(extractDocument(result, await engineTemplates(), FALLBACK_TEMPLATE_CODE), FALLBACK_TEMPLATE_CODE);
}

/** Bekçi okuyucuyu ve adresi bu parametrelerle verir; üretimde `readerOcr` + `getReaderUrl()`. */
export function serverCompleter(read: typeof readerOcr = readerOcr, readerUrl: () => string | null = () => getReaderUrl().url): CompleteFn {
  return async (result, content, mimeType): Promise<ServerComplement | null> => {
    const missing = await deviceMissingFields(result);
    if (missing.length === 0) return null;
    const base = { missing, engine: null, version: null, durationMs: null };
    const url = readerUrl();
    if (!url) {
      uyari("gelen-belge", `cihaz okumasında ${missing.length} başlık alanı boş; okuma servisi adresi yok — sunucu tamamlaması atlandı`);
      return { ...base, ocr: null, failed: "READER_OFF" };
    }
    const t0 = Date.now();
    const r = await read(url, content, mimeType, SERVER_COMPLETE_TIMEOUT_MS).catch((err: unknown) => ({ ok: false as const, kind: "UNAVAILABLE" as const, code: `PROGRAM_HATASI:${err instanceof Error ? err.name : "?"}` }));
    const ms = Date.now() - t0;
    if (!r.ok) {
      uyari("gelen-belge", `sunucu tamamlaması okunamadı (${r.code}, ${ms} ms) — cihaz okuması kaldı; boş alanlar: ${missing.join(", ")}`);
      return { ...base, ocr: null, failed: r.code };
    }
    bilgi("gelen-belge", `sunucu tamamlaması okundu (${ms} ms); cihazda boş: ${missing.join(", ")}`);
    return { ocr: r.result, missing, engine: r.engine, version: r.version, durationMs: r.durationMs, failed: null };
  };
}
