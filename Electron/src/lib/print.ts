// =============================================================================
// TEK BASIM BOĞAZI — `printTracked` (izlenebilirlik A2) + izole iframe baskısı (Y3 fix)
// =============================================================================
// Panelin her kâğıt/PDF çıktısı `printTracked`/`trackPdfSave`ten geçer ve sonucu yazdırma
// geçmişine bildirilir (bekçi: print-bogaz.test). Electron'da basım ana süreçte gizli pencerede
// yapılır (sonuç ölçülür: gitti/iptal/hata); tarayıcıda iframe yolu sonucu bilemez → BELIRSIZ.
// window.print() ekran DOM'unu basıyordu: .print-area'nın @media print'teki
// `position:absolute`'u en yakın positioned ataya (DialogContent → TabPane →
// AppShell, hepsi overflow-hidden/transform'lu) göre çözülür → uzun belge tek
// sayfaya kırpılır, dar/kaymış basılır; arka plan sekmesinde açık başka bir
// irsaliye de aynı baskıya biner. Çözüm: .print-area gizli bir iframe'e klonlanır
// ve İFRAME basılır — layout zinciri yok, sayfalama doğal, tek belge garantili.
// =============================================================================

import { toast } from "sonner";
import type { DocPrintApi, DocPrintResult } from "@shared/doc-print";
import { getStoredMachineConfig, type DocumentPrinterConfig } from "@/lib/machine-config";
import { printErrorMessage, type PrintErrorCode } from "@/lib/print-error-codes";
import { baseReport, type PrintSubject } from "@/lib/print-report";
import {
  appVersion,
  printJobService,
  type PrintJobAttachment,
  type PrintOutputKind,
  type PrintStatus,
  type PrintTransport,
} from "@/services/printJobService";

export {
  frozenDocSubject,
  reportLabelSend,
  trackPdfSave,
  type LabelSendResult,
  type LabelSendTarget,
  type PrintSubject,
} from "@/lib/print-report";

/**
 * Verilen kökün içindeki (veya kendisi olan) `.print-area`'yı izole iframe'de
 * yazdırır. Alan bulunamazsa güvenli geri düşüş: klasik window.print().
 */
/**
 * Saha #7: tam bir HTML belgesini (backend'den gelen birleşik etiket çıktısı gibi)
 * izole iframe'de yazdırır. printDocumentArea DOM klonlar; bu ise verilen HTML
 * string'ini doğrudan iframe'e yazar (kendi <style>'ını taşır).
 */
function printHtmlString(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  // GÜVENLİK (2026-08-03, refakat kartı Faz 2): basılan HTML artık KULLANICI
  // YAZIMI olabiliyor (Şablon Stüdyosu uzman modu). Sandbox'sız bir iframe'de
  // gömülü <script> Electron renderer'ında ÇALIŞIR — ölçüldü, varsayılmadı.
  //
  // İki izin de LOAD-BEARING, kırpma:
  //   allow-same-origin → parent'ın contentDocument'a erişip doc.write ile
  //                       belgeyi yazması için. Yoksa iframe opak origin olur ve
  //                       aşağıdaki doc.open() sessizce null'a düşer (baskı ölür).
  //   allow-modals      → win.print() yazdırma diyaloğunu açabilsin diye.
  // allow-scripts BİLEREK YOK → gömülü script çalışmaz. (Sunucu tarafında ayrıca
  // sanitizeTemplateHtml script'i ayıklar; bu ikinci savunma hattıdır.)
  iframe.setAttribute("sandbox", "allow-same-origin allow-modals");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => iframe.remove();
  const images = Array.from(doc.images);
  const waitImages = Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }),
    ),
  );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
  void Promise.race([waitImages, timeout]).then(() => {
    requestAnimationFrame(() => {
      win.focus();
      win.addEventListener("afterprint", cleanup, { once: true });
      win.print();
      setTimeout(cleanup, 60_000);
    });
  });
}

function printDocumentArea(root: HTMLElement | null): void {
  const area = root?.classList.contains("print-area")
    ? root
    : (root?.querySelector<HTMLElement>(".print-area") ?? null);
  if (!area) {
    window.print();
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  // Bu yol uygulamanın KENDİ DOM'unu klonlar (kullanıcı HTML'i taşımaz), ama
  // baskı yüzeyini tek bir güvenlik duruşunda tutmak için aynı sandbox uygulanır
  // — "biri korumalı, öteki değil" hâli ileride yanlış tarafa örnek olur.
  iframe.setAttribute("sandbox", "allow-same-origin allow-modals");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    window.print();
    return;
  }

  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  doc.close();

  // Uygulamanın tüm stilleri (Vite'ın inject ettiği <style> + <link rel=stylesheet>)
  // iframe'e kopyalanır — belge bileşenleri ekrandakiyle aynı CSS'le render olur.
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    doc.head.appendChild(node.cloneNode(true));
  });

  const clone = area.cloneNode(true) as HTMLElement;
  doc.body.appendChild(clone);

  // cloneNode canvas İÇERİĞİNİ kopyalamaz (QR kodlar boş çıkar) — piksel kopyala.
  const srcCanvases = area.querySelectorAll("canvas");
  const dstCanvases = clone.querySelectorAll("canvas");
  srcCanvases.forEach((src, i) => {
    const dst = dstCanvases[i];
    if (!dst) return;
    dst.width = src.width;
    dst.height = src.height;
    dst.getContext("2d")?.drawImage(src, 0, 0);
  });

  const cleanup = () => iframe.remove();

  // Görseller (logo/barkod img'leri) yüklensin, sonra bas. Emniyet tavanı 2sn.
  const images = Array.from(doc.images);
  const waitImages = Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }),
    ),
  );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000));

  void Promise.race([waitImages, timeout]).then(() => {
    // Stil hesaplaması otursun diye bir frame bekle.
    requestAnimationFrame(() => {
      win.focus();
      win.addEventListener("afterprint", cleanup, { once: true });
      win.print();
      // afterprint bazı durumlarda gelmez (iptal vb.) — emniyet temizliği.
      setTimeout(cleanup, 60_000);
    });
  });
}

// ─── Tek boğaz ────────────────────────────────────────────────────────────────

export interface PrintTrackedOpts {
  subject: PrintSubject;
  /** Tam HTML belge (kendi <style>/@page'iyle) — ya bu ya `root`. */
  html?: string;
  /** `.print-area` taşıyan DOM kökü (ekrandaki belge). */
  root?: HTMLElement | null;
  outputKind?: PrintOutputKind;
  copies?: number;
  /**
   * Konunun iş ucu (print-event) başarıyı KENDİSİ bildirir: başarıda `/print-jobs` çağrılmaz
   * (çift satır olmasın), çağıran `outcome.printJob`ı iş ucunun gövdesine ekler. Hata/iptal
   * yine `/print-jobs`a gider ve iş ucu ÇAĞRILMAZ.
   */
  workEndpoint?: boolean;
}

export interface PrintOutcome {
  status: PrintStatus;
  /** İş ucu çağrılsın mı: gitti ya da (tarayıcıda) bilinmiyor. İptal/hata → hayır. */
  proceed: boolean;
  /** İş ucunun gövdesine eklenecek künye. */
  printJob: PrintJobAttachment;
  errorCode?: PrintErrorCode;
}

function docPrintApi(): DocPrintApi | undefined {
  return typeof window !== "undefined" ? window.api?.docPrint : undefined;
}

async function documentPrinterPref(): Promise<DocumentPrinterConfig> {
  try {
    return (await getStoredMachineConfig()).documentPrinter ?? {};
  } catch {
    return {};
  }
}

/** Basım öncesi bilinen hedef: sessiz basım açıksa seçili yazıcı, değilse sistem penceresi. */
async function plannedTarget(): Promise<{ silent: boolean; deviceName?: string; transport: PrintTransport }> {
  if (!docPrintApi()) return { silent: false, transport: "SISTEM_PENCERESI" };
  const pref = await documentPrinterPref();
  const deviceName = pref.deviceName?.trim() || undefined;
  const silent = Boolean(pref.silent && deviceName);
  return { silent, deviceName, transport: silent ? "SESSIZ_OS" : "SISTEM_PENCERESI" };
}

/**
 * Basımdan ÖNCE çağrılan iş ucu (çeki listesi: numara basımda doğar) için künye. Sonuç henüz
 * bilinmez; hedef ve sürüm bilinir. Künyede token yok: iş ucunun kendi idempotency'si yeter.
 */
export async function preparePrintJob(copies?: number): Promise<PrintJobAttachment> {
  const t = await plannedTarget();
  return {
    transport: t.transport,
    ...(t.silent && t.deviceName ? { printerName: t.deviceName } : {}),
    ...(copies ? { copies } : {}),
    ...(appVersion() ? { appVersion: appVersion() } : {}),
  };
}

/** Tarayıcının stil sayfaları tek <style> metni olarak; okunamayan sayfa varsa null (iframe yoluna düş). */
function collectAppCss(): string | null {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      parts.push(Array.from(sheet.cssRules, (r) => r.cssText).join("\n"));
    } catch {
      return null;
    }
  }
  return parts.join("\n");
}

/** `.print-area`yı ana sürecin çizebileceği tam belgeye çevirir (canvas → görsel). */
function areaToHtml(root: HTMLElement | null): string | null {
  const area = root?.classList.contains("print-area") ? root : (root?.querySelector<HTMLElement>(".print-area") ?? null);
  if (!area) return null;
  const css = collectAppCss();
  if (css === null) return null;
  const clone = area.cloneNode(true) as HTMLElement;
  const src = area.querySelectorAll("canvas");
  const dst = clone.querySelectorAll("canvas");
  src.forEach((c, i) => {
    const d = dst[i];
    if (!d) return;
    try {
      const img = document.createElement("img");
      img.src = c.toDataURL("image/png");
      img.width = c.width;
      img.height = c.height;
      img.setAttribute("style", d.getAttribute("style") ?? "");
      img.className = d.className;
      d.replaceWith(img);
    } catch {
      /* kirli canvas: boş kalır (iframe yolundaki davranış) */
    }
  });
  // Tema sınıfı BİLEREK taşınmaz: koyu temada da kâğıt açık basılır (iframe yolunun aynısı).
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body>${clone.outerHTML}</body></html>`;
}

/**
 * TEK basım boğazı. Basar, sonucu ölçer (Electron) ya da BELIRSIZ der (tarayıcı), yazdırma
 * geçmişine bildirir. ASLA fırlatmaz; rapor basımı beklemez ve engellemez.
 */
export async function printTracked(opts: PrintTrackedOpts): Promise<PrintOutcome> {
  const api = docPrintApi();
  const target = await plannedTarget();
  const html = opts.html ?? (api ? areaToHtml(opts.root ?? null) : null);
  let result: DocPrintResult | null = null;
  if (api && html) {
    try {
      result = await api.print({
        html,
        silent: target.silent,
        ...(target.deviceName && target.silent ? { deviceName: target.deviceName } : {}),
        ...(opts.copies && opts.copies > 1 ? { copies: opts.copies } : {}),
      });
    } catch {
      result = { status: "HATA", errorCode: "BILINMEYEN", durationMs: 0 };
    }
  } else if (opts.html !== undefined) {
    printHtmlString(opts.html);
  } else {
    printDocumentArea(opts.root ?? null);
  }

  const status: PrintStatus = result ? result.status : "BELIRSIZ";
  const transport: PrintTransport = result ? target.transport : "SISTEM_PENCERESI";
  const errorCode = result?.status === "HATA" ? result.errorCode : undefined;
  const printJob: PrintJobAttachment = {
    transport,
    ...(result && target.silent && target.deviceName ? { printerName: target.deviceName } : {}),
    ...(result ? { durationMs: result.durationMs } : {}),
    ...(opts.copies ? { copies: opts.copies } : {}),
    ...(appVersion() ? { appVersion: appVersion() } : {}),
  };
  const proceed = status === "ILETILDI" || status === "BELIRSIZ";
  if (errorCode) toast.error(`Yazdırılamadı: ${printErrorMessage(errorCode)}`);
  if (!(opts.workEndpoint && proceed)) {
    printJobService.report({
      ...baseReport(opts.subject, opts.outputKind),
      ...printJob,
      status,
      ...(errorCode ? { errorCode, errorMessage: printErrorMessage(errorCode) } : {}),
    });
  }
  return { status, proceed, printJob, ...(errorCode ? { errorCode } : {}) };
}

/**
 * Kimlik kartı / PIN listesi basımı. Konu YALNIZ kullanıcı kimliği taşır: kâğıttaki PIN, kart
 * kodu, parola hiçbir alana girmez (sır hijyeni; sunucu ayrıca `meta`yı düşürür).
 */
export function printIdentityCards(root: HTMLElement | null, userIds: string[]): Promise<PrintOutcome> {
  const ids = [...new Set(userIds)].slice(0, 200);
  const subject: PrintSubject =
    ids.length === 1 ? { kind: "KIMLIK_KARTI", table: "users", id: ids[0] } : { kind: "KIMLIK_KARTI", table: "users", ids };
  return printTracked({ subject, root });
}
