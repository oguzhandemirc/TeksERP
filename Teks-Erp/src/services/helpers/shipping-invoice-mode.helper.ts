// =============================================================================
// FATURA İZİ REJİMİ — TEK KARAR NOKTASI (`shipping.invoiceMode`)
// =============================================================================
// Bugünkü "dış muhasebe izi" TEK alan çifti değil, DÖRT KOLON × İKİ TABLO
// (`Shipment.invoiceNo/invoicedAt/invoicedById` + `DirectShipment` ikizi) ve onu
// yazan İKİ yol var:
//   ① ELLE İŞARET  → `setShipmentInvoice` / `setDirectShipmentInvoice`
//   ② İÇ FATURA ONAYI → `invoice.service.confirm` (aynı tx'te `invoiceNo = docNo`)
//
// Bayrak YALNIZ ①'i kapılar. ② HER MODDA damgalamaya DEVAM EDER ve bu
// pazarlık dışıdır: storno kapısı (`resolveUndoBlockReason`) yalnız `invoiceNo`ya
// bakar — damga da kaldırılsaydı "faturalanmış sevkiyat geri alınamaz" koruması
// hiçbir test kırmadan düşerdi.
//
// ⚠️ İZ KALDIRMA (`invoiceNo: null`) HER MODDA AÇIK. `ic` moduna geçen bir
// kurulumda, mod açılmadan ÖNCE basılmış YANLIŞ bir iz kalıcı olurdu; kapı
// "yeni iz yazma"yı kapatır, "yanlışı düzeltme"yi değil.
//
// ⚠️ `maybeAutoDraftInvoiceAfterDispatch` BU BAYRAĞIN DIŞINDA — o finans
// kancasıdır ve kendi çift kapısını taşır (`financeEnabled` →
// `financeAutoDraftFromShipmentEnabled`).
//
// ⚠️ BU DOSYA `prisma.invoice.` ERİŞİMCİSİ TAŞIMAZ. Sevkiyat router'ı rejimsizdir;
// buraya doğrudan bir fatura sorgusu yazmak `test_finance_regime_gate`'i kırar
// ("kapısız ticaret router'ı"). İç fatura bilgisi ÇAĞIRANDAN gelir ve orada
// `Shipment.invoices` nested relation select'iyle okunur (bugün de güvenli olan
// yazım budur).
// =============================================================================
import { AppError } from "../../utils/app-error";
import {
  readShippingInvoiceMode,
  type ShippingInvoiceMode,
} from "../system-setting.service";

/** Etkin rejim. DÜZ okuyucu (Sevkiyat çekirdek blok — ebeveyn modül YOK). */
export async function resolveInvoiceMode(): Promise<ShippingInvoiceMode> {
  return readShippingInvoiceMode();
}

/**
 * ELLE fatura izi yazma kapısı.
 *
 * `dis`   → bugünkü davranış, engel yok.
 * `ic`    → 400 `INVOICE_TRACE_DISABLED` (iz KALDIRMA muaf — `clearing`).
 * `ikisi` → engel YOK; iç faturası olan sevkte çağıran `invoiceTraceWarning`
 *           ile amber uyarı üretir.
 *
 * Kapı SERVİSTE, route'ta DEĞİL: toplu işaretleme (`BulkInvoiceAction`), tekil
 * diyalog ve gelecekteki her çağıran AYNI cevabı almalı.
 */
export function assertInvoiceTraceAllowed(
  mode: ShippingInvoiceMode,
  p: { clearing: boolean },
): void {
  if (mode !== "ic") return;
  if (p.clearing) return;
  throw AppError.badRequest(
    "Bu kurulumda fatura numarası elle işaretlenmez — fatura Muhasebe → Faturalar " +
      "ekranından kesilir ve onaylandığında sevkiyata kendisi işlenir. " +
      "(Yanlış girilmiş bir izi KALDIRMAK hâlâ mümkündür.)",
    { code: "INVOICE_TRACE_DISABLED" },
  );
}

/**
 * `ikisi` rejiminde iç faturası OLAN sevke elle iz yazılırsa amber uyarı.
 *
 * Engel DEĞİL — bilinçli: `ikisi` bir GEÇİŞ DÖNEMİ rejimidir (bir kısmı dış
 * programda, bir kısmı ERP'de kesiliyor) ve orada iki numaranın yan yana
 * yaşaması kabul edilmiş bir bedeldir. Uyarı, muhasebecinin aynı sevk için iki
 * farklı numara görmesini SÜRPRİZ olmaktan çıkarır.
 */
export function invoiceTraceWarning(
  mode: ShippingInvoiceMode,
  p: { clearing: boolean; internalDocNo: string | null },
): string | null {
  if (mode !== "ikisi") return null;
  if (p.clearing) return null;
  if (!p.internalDocNo) return null;
  return (
    `Bu sevkin ERP faturası zaten var (${p.internalDocNo}) — elle yazdığınız numara ` +
    "muhasebe listesinde onun yerine görünür ve mükerrer kayıt üretebilir."
  );
}
