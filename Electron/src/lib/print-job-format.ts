// =============================================================================
// YAZDIRMA GEÇMİŞİ SATIR BİÇİMİ — durum rozeti, "ne basıldı", yazıcı, kişi, cihaz (A3)
// =============================================================================
// `SIMULE` başarı DEĞİLDİR (bayt hiçbir yazıcıya gitmedi); PDF'te `ILETILDI` "Kaydedildi" okunur.
// =============================================================================
import type { PrintJobRow, PrintOutputKind, PrintSource, PrintStatus, PrintSubjectKind, PrintTransport } from "@/services/printHistoryService";

export type PrintTone = "success" | "danger" | "muted" | "warning" | "simulated";

export interface PrintStatusView {
  label: string;
  tone: PrintTone;
  /** Simülasyon satırında ek uyarı rozeti. */
  flag?: "SİMÜLASYON";
}

export const PRINT_STATUS_LABELS: Record<PrintStatus, string> = {
  ILETILDI: "İletildi",
  HATA: "Hata",
  IPTAL: "İptal",
  BELIRSIZ: "Belirsiz",
  SIMULE: "Simüle",
};

/** Backend `PRINT_SUBJECT_LABELS` aynası. */
export const PRINT_SUBJECT_LABELS: Record<PrintSubjectKind, string> = {
  ETIKET_TOP: "Top etiketi",
  ETIKET_CUVAL: "Çuval etiketi",
  ETIKET_NUMUNE: "Kartela etiketi",
  ETIKET_TEZGAH: "Tezgah etiketi",
  ETIKET_LEVENT: "Levent etiketi",
  ETIKET_SERBEST: "Serbest etiket",
  ETIKET_TOPLU: "Toplu top etiketi",
  BELGE: "Belge",
  REFAKAT_KARTI: "Refakat kartı",
  CEKI_LISTESI: "Çeki listesi",
  FASON_CEKI: "Fason çekisi",
  SERBEST_BELGE: "Serbest belge",
  RAPOR: "Rapor",
  LISTE: "Liste",
  KIMLIK_KARTI: "Kimlik kartı",
  TEST: "Deneme baskısı",
};

export const PRINT_SOURCE_LABELS: Record<PrintSource, string> = {
  PANEL_MASAUSTU: "Masaüstü panel",
  PANEL_WEB: "Web",
  TABLET: "Tablet",
  TELEFON: "Telefon",
  SUNUCU: "Sunucu",
};

export const PRINT_OUTPUT_LABELS: Record<PrintOutputKind, string> = { PRINTER: "Yazıcı", PDF: "PDF" };

export const PRINT_TRANSPORT_LABELS: Record<PrintTransport, string> = {
  SISTEM_PENCERESI: "Sistem yazdırma penceresi",
  SESSIZ_OS: "Sessiz basım (işletim sistemi)",
  SERI: "Seri port",
  TCP_9100: "Ağ (TCP 9100)",
  CUPS: "CUPS kuyruğu",
  WINSPOOL: "Windows kuyruğu",
  BLUETOOTH: "Bluetooth",
  SUNUCU_TCP: "Sunucudan ağ (TCP)",
  PDF_DOSYA: "PDF dosyası",
};

export function printStatusView(job: Pick<PrintJobRow, "status" | "outputKind">): PrintStatusView {
  switch (job.status) {
    case "ILETILDI":
      return { label: job.outputKind === "PDF" ? "Kaydedildi" : "İletildi", tone: "success" };
    case "HATA":
      return { label: "Hata", tone: "danger" };
    case "IPTAL":
      return { label: "İptal", tone: "muted" };
    case "BELIRSIZ":
      return { label: "Belirsiz", tone: "warning" };
    case "SIMULE":
      return { label: "Simüle", tone: "simulated", flag: "SİMÜLASYON" };
  }
}

/** Yalnız `ILETILDI` başarıdır — simülasyon, iptal, belirsiz sayılmaz. */
export const isPrintSuccess = (job: Pick<PrintJobRow, "status">): boolean => job.status === "ILETILDI";

/** Rapor yolunu bilmeyen eski istemci: sürüm ve yol boş → yazıcı bilinmez. */
export const isLegacyClientRow = (job: Pick<PrintJobRow, "appVersion" | "transport">): boolean =>
  !job.appVersion && !job.transport;

export function printSubjectText(job: Pick<PrintJobRow, "subjectKind" | "subjectNo" | "itemCount" | "docVersion" | "subjectIds">): string {
  const label = PRINT_SUBJECT_LABELS[job.subjectKind] ?? job.subjectKind;
  const count = job.itemCount ?? (job.subjectIds?.length || null);
  if (job.subjectKind === "ETIKET_TOPLU") return `${count ?? "?"} top etiketi (toplu)`;
  const version = job.docVersion && job.docVersion > 1 ? ` v${job.docVersion}` : "";
  return job.subjectNo ? `${job.subjectNo}${version} · ${label}` : `${label}${version}`;
}

export function printPrinterText(job: Pick<PrintJobRow, "outputKind" | "peripheral" | "printerName" | "printerAddress" | "appVersion" | "transport">): string {
  if (job.outputKind === "PDF") return "PDF";
  const named = job.peripheral?.name || job.printerName || job.printerAddress;
  if (named) return named;
  return isLegacyClientRow(job) ? "eski istemci · yazıcı bilinmiyor" : "—";
}

export function printUserText(job: Pick<PrintJobRow, "user">): string {
  return job.user ? job.user.fullName || job.user.username : "—";
}

export function printDeviceText(job: Pick<PrintJobRow, "device" | "source">): string {
  return job.device?.name || PRINT_SOURCE_LABELS[job.source] || job.source;
}

/** Rozet renkleri — açık ve koyu temada okunur (Tailwind ton çiftleri). */
export const PRINT_TONE_CLASS: Record<PrintTone, string> = {
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  danger: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
  muted: "border-border bg-muted text-muted-foreground",
  warning: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  simulated: "border-purple-500/50 bg-purple-500/10 text-purple-700 dark:text-purple-300",
};
