import { useMachineConfig } from "@/hooks/useMachineConfig";
import { labelService, type LabelCustomerContext } from "@/services/labelService";
import { reportLabelSend, type LabelSendResult, type PrintSubject } from "@/lib/print";
import type { PrintErrorCode } from "@/lib/print-error-codes";
import type { PrintJobAttachment } from "@/services/printJobService";

/** Doğrudan etiket gönderiminin sonucu; başarıda iş ucunun gövdesine eklenecek künye. */
export interface LabelSendOutcome {
  ok: boolean;
  error?: string;
  errorCode?: PrintErrorCode;
  printJob?: PrintJobAttachment;
}

/**
 * Bu iş istasyonunun YEREL etiket yazıcısı (Argox seri/COM) — DİYALOGSUZ baskı.
 * Açık + port seçiliyse etiket native PPLA olarak seri porta gönderilir
 * (`window.api.printer.send`), OS yazdırma diyaloğu AÇILMAZ → "her seferinde
 * yazdırma ekranı çıkması" sorunu kalkar. Yapılandırılmamışsa `directEnabled=false`
 * döner; çağıran eski `iframe.print()` yedeğine düşer (geriye uyumlu).
 *
 * Sevkiyat PC'sinde Argox'a BT modülü eşleşince Windows'ta sanal COM portu olur;
 * USB kablo da COM olarak görünür — ikisi de bu `serial` transport.
 */
export function useLabelPrinter() {
  const { config } = useMachineConfig();
  const cfg = config.labelPrinter;
  const printer = typeof window !== "undefined" ? window.api?.printer : undefined;
  const directEnabled = Boolean(cfg?.enabled && cfg?.path && printer);

  // Cihaz Kaydı yönlendirmesi: seçiliyse dil/profil/şablon global yerine bu
  // cihazdan çözülür — istasyon-özel dil (Bixolon=ZPL) global ayarı bozmaz.
  const peripheralId = cfg?.peripheralId || undefined;

  /**
   * Gönderir ve sonucu yazdırma geçmişine bağlar (izlenebilirlik A2): hata HER ZAMAN `/print-jobs`a
   * sınıflı kodla gider; başarıda dönen `printJob` künyesi çağıranın iş ucuna (print-event) eklenir.
   */
  async function send(
    fetchNative: () => Promise<{ contentB64: string; language: string }>,
    subject: PrintSubject,
  ): Promise<LabelSendOutcome> {
    if (!directEnabled || !printer || !cfg?.path) {
      return { ok: false, error: "Yazıcı yapılandırılmadı" };
    }
    const target = { transport: cfg.transport ?? "serial", address: cfg.path, peripheralId } as const;
    const started = Date.now();
    const finish = (res: LabelSendResult, error?: string): LabelSendOutcome => {
      const r = reportLabelSend(subject, target, res, { durationMs: Date.now() - started, workEndpoint: true });
      return res.ok ? { ok: true, printJob: r.printJob } : { ok: false, error, errorCode: r.errorCode };
    };
    let native: { contentB64: string; language: string };
    try {
      native = await fetchNative();
    } catch (e) {
      return finish({ ok: false, errorCode: "ICERIK_ALINAMADI" }, (e as Error).message);
    }
    // FAIL-CLOSED: yalnız BİLİNEN native dil yazıcıya gönderilir. Header cross-origin
    // sıyrılır/boş gelirse (CORS) ham bayt göndermek yerine reddet → çöp etiket çıkmaz.
    const NATIVE_LANGS = ["PPLA", "PPLB", "ZPL"];
    if (!NATIVE_LANGS.includes(native.language) || !native.contentB64) {
      return finish(
        { ok: false, errorCode: "YAZICI_DILI_YOK" },
        native.language === "RASTER_HTML" || !native.language
          ? "Bu bilgisayara Cihaz Kaydı yazıcısı seçilmemiş — Sistem → Bu Bilgisayar → Yazıcı'dan seçin."
          : `Desteklenmeyen yazıcı dili: ${native.language}`,
      );
    }
    let res: { ok: boolean; bytes: number; available: boolean; error: string | null };
    try {
      res = await printer.send({
        transport: cfg.transport ?? "serial",
        target: cfg.path,
        baudRate: cfg.baudRate,
        contentB64: native.contentB64,
      });
    } catch (e) {
      return finish({ ok: false, error: (e as Error).message }, (e as Error).message);
    }
    if (!res.available) {
      return finish({ ok: false, errorCode: "SERI_SURUCU_YOK" }, "Seri sürücü bu derlemede hazır değil (npm run electron:rebuild).");
    }
    return finish({ ok: res.ok, bytes: res.bytes, error: res.error }, res.error ?? undefined);
  }

  /** Tek top — diyalogsuz seri/COM baskı. */
  const printRoll = (rollId: string, opts?: LabelCustomerContext) =>
    send(() => labelService.getRollNative(rollId, opts, peripheralId), { kind: "ETIKET_TOP", table: "rolls", id: rollId });

  /**
   * N farklı top tek-job — diyalogsuz toplu seri/COM baskı.
   * `customerId`: hepsini o müşterinin etiket şablonuyla bas (çuval müşterisi değişti).
   */
  const printRollsBulk = (rollIds: string[], copies?: number, customerId?: string | null) =>
    send(() => labelService.getBulkRollLabelsNative(rollIds, copies, peripheralId, customerId), {
      kind: "ETIKET_TOPLU",
      table: "rolls",
      ids: rollIds.slice(0, 200),
      itemCount: Math.max(rollIds.length, 1),
    });

  /** Tek çuval — diyalogsuz seri/COM baskı (barkod = çuval no). */
  const printSack = (sackId: string) =>
    send(() => labelService.getSackNative(sackId, peripheralId), { kind: "ETIKET_CUVAL", table: "sacks", id: sackId });

  // Önizleme de bu cihazdan çözülsün diye dışa verilir: peripheralId geçilirse
  // backend dili cihazın languageOverride'ından (PPLA/PPLB/ZPL) çözer → önizleme
  // = baskı (WYSIWYG). Geçilmezse global fallback RASTER_HTML (HTML önizleme).
  return { directEnabled, printRoll, printRollsBulk, printSack, peripheralId };
}
