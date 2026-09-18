// =============================================================================
// FATURA KAPAMA — `PaymentAllocation` (Paket C2)
// =============================================================================
// "Hangi tahsilat/çek hangi faturayı kapattı" bağı. İki soruyu ayırır:
//   • CARİ BAKİYE  → "bu müşteri bize toplam ne kadar borçlu" (defter toplamı)
//   • KAPAMA       → "hangi FATURA hâlâ açık" (yaşlandırmanın girdisi)
// Birincisi tek sayıdır ve kapama olmadan da doğrudur; ikincisi ancak faturayla
// parayı eşleyerek cevaplanır. Yaşlandırma raporunun (C4) tek veri kaynağı budur.
//
// ⚠️ ALLOCATION DEFTERE SATIR YAZMAZ. Cari bakiyesi zaten İKİ KEZ oynadı:
// faturanın ONAYINDA (borç) ve tahsilatın KAYDINDA (alacak). Kapama üçüncü bir
// satır yazsaydı aynı para ÜÇÜNCÜ kez muhasebeleşir ve bakiye kalıcı olarak
// yanlış olurdu. Kapama yalnız İKİ SAYACI hareket ettirir:
//   `Invoice.paidTotal` · (`Payment.allocatedTotal` XOR `Cheque.allocatedTotal`)
//
// ⚠️ AÇIK/KISMİ/KAPALI BİR KOLON DEĞİLDİR — `paidTotal` ile `grandTotal`
// karşılaştırılarak TÜRETİLİR. İkinci bir durum kolonu, ikinci bir denormalize
// alan demekti ve iki denormalize alan bir gün ayrışır: "kapalı görünen ama
// parası gelmemiş fatura" tam olarak böyle doğar.
//
// ⚠️ SAYAÇ YAZIMI RAW ATOMİK UPDATE'tir (`$executeRaw`), Prisma `update` DEĞİL:
//   UPDATE ... SET "paidTotal" = "paidTotal" + $a
//    WHERE id = $i AND "paidTotal" + $a <= "grandTotal"
// Prisma `where`'i İKİ KOLONU birbiriyle karşılaştıramaz (`paidTotal <
// grandTotal` yazılamaz), yani "oku → karşılaştır → yaz" deseni tek seçenek
// olurdu ve o desen iki eşzamanlı kapamada aşımı SESSİZCE geçirirdi. Ham
// UPDATE'te koşul PG'nin satır kilidi ALTINDA yeniden değerlendirilir
// (EvalPlanQual) → yarışta yalnız sığan kapamalar geçer, gerisi `count === 0`
// ile 409 alır. DB tarafında ayrıca CHECK seddi var; ikisi aynı şeyi iki
// katmanda söyler ve biri düşerse diğeri hâlâ tutar.
//
// ⚠️ FLOAT YOK: tüm aritmetik `Prisma.Decimal`, ham SQL'e giden değer
// `.toFixed(2)` ile METİN olarak gidip `::numeric`e cast edilir. Sayıyı JS
// number'a düşürmek 0.1 + 0.2 sınıfı bir kuruş sapması demekti ve o sapma
// CHECK'lere takılmadan yıllarca birikirdi.
// =============================================================================
import { Prisma, InvoiceStatus, InvoiceType, PaymentStatus, PaymentDirection, ChequeKind, ChequeStatus, Currency } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { D, D0, findCariAccountIdByCustomer } from "./helpers/finance.helper";
// ⚠️ Çek durum adları TEK KAYNAK: `cheque.service` sözlüğü ("Ekranda ve hata
// mesajında okunan durum adları"). Buraya ikinci bir sözlük yazmak, aynı
// durumun iki farklı adla anılmasına giden en kısa yoldur.
import { CHEQUE_STATUS_LABEL } from "./cheque.service";
import type { ApiResponse } from "../types/api.types";

// -----------------------------------------------------------------------------
// SÖZLEŞME TİPLERİ
// -----------------------------------------------------------------------------

export interface AllocateInput {
  invoiceId: string;
  /** Tahsilat/ödeme XOR çek — ikisi birden ya da hiçbiri geçersiz. */
  paymentId?: string | null;
  chequeId?: string | null;
  amount: Prisma.Decimal.Value;
  notes?: string | null;
}

export interface AllocationRow {
  id: string;
  invoiceId: string;
  paymentId: string | null;
  chequeId: string | null;
  amount: string;
  notes: string | null;
  createdAt: Date;
}

export interface OpenInvoiceRow {
  id: string;
  docNo: string;
  type: InvoiceType;
  currency: Currency;
  issueDate: Date;
  dueDate: Date | null;
  /** Efektif vade — `dueDate ?? issueDate`. FIFO sırasının anahtarı. */
  effectiveDueDate: Date;
  grandTotal: string;
  paidTotal: string;
  /** `grandTotal - paidTotal` — kapatılabilir kalan. */
  openTotal: string;
  /** FIFO ÖNERİSİ: verilen tutar bu faturaya ne kadar düşer (yalnız `amount` sorulduysa). */
  suggested?: string;
}

/** Storno yollarının serbest bıraktığı kapamaların özeti. */
export interface ReleaseSummary {
  /** Silinen kapama satırı sayısı. */
  count: number;
  /** Serbest kalan toplam tutar (kaynağın para biriminde). */
  total: Prisma.Decimal;
  /** Yeniden açılan fatura id'leri — çağıran isterse mesajına koyar. */
  invoiceIds: string[];
}

/**
 * AKTİF KAPAMA YÜKLEMİ — tek kaynak (defter doktrini, 2026-09-11).
 *
 * Çözülmüş kapama artık SİLİNMİYOR, `revokedAt` ile damgalanıyor; satırı okuyan
 * HER yol bu yüklemden geçer. Elle kopyalanan `revokedAt: null` bir gün unutulur
 * ve çözülmüş kapama sayaca/rapora geri sızar (ayrışan yüzey sınıfı).
 */
export const ACTIVE_ALLOCATION = { revokedAt: null } as const;

export interface ReleaseOptions {
  /**
   * SEBEP etiketi (`PAYMENT_CANCEL` / `INVOICE_CANCEL` / `CHEQUE_BOUNCE` …).
   * Artık satırın KENDİSİNE de yazılır (`revokeReason`) — eskiden kapama satırı
   * fiziksel silindiği için tek yer audit'ti, o da 6 ayda arşivleniyordu ve
   * "bu fatura neden yeniden açıldı" sorusu kalıcı olarak cevapsız kalıyordu.
   */
  reason?: string;
  userId?: string;
}

// -----------------------------------------------------------------------------
// SAF PARÇALAR
// -----------------------------------------------------------------------------

/**
 * Faturanın kapanabilmesi için kaynağın YÖNÜ tutmak zorunda.
 *
 * ⚠️ KURAL BİLİNÇLİ DAR (plan C2 kilitli kararı): yalnız `IN ↔ SALES` ve
 * `OUT ↔ PURCHASE`. İade faturaları (SALES_RETURN / PURCHASE_RETURN) ve çapraz
 * yön kapamaları Faz 3'e bırakıldı — sebebi "unutuldu" değil: iade faturası bir
 * ALACAK DEKONTUDUR, tahsilatla değil KARŞI FATURAYLA mahsuplaşır. Onu bugünkü
 * modelde kapatmaya izin vermek, "500 TL iade faturasını 500 TL tahsilatla
 * kapattım" gibi ekonomik olarak yanlış bir kaydı mümkün kılardı.
 */
export function directionMatchesInvoice(direction: PaymentDirection, type: InvoiceType): boolean {
  if (direction === PaymentDirection.IN) return type === InvoiceType.SALES;
  return type === InvoiceType.PURCHASE;
}

/**
 * Çekin YÖNÜ ↔ fatura türü. Aldığımız çek satış faturamızı kapatır, verdiğimiz
 * çek alış faturamızı. `ChequeKind` bunun tek kaynağıdır — `Cheque.status`'e
 * bakmak yanlış olurdu (durum "nerede" der, "kimin borcunu kapatır" demez).
 */
export function chequeKindMatchesInvoice(kind: ChequeKind, type: InvoiceType): boolean {
  if (kind === ChequeKind.RECEIVED) return type === InvoiceType.SALES;
  return type === InvoiceType.PURCHASE;
}

/**
 * PARASI YOK statüler — kapamanın DIŞLADIĞI küme (Sınıf 4'ün tek kaynağı).
 *
 * BOUNCED / RETURNED / CANCELLED: çekin parası GELMEDİ ya da çek geri verildi →
 * onunla fatura kapatmak, olmayan parayla borç kapatmaktır. COLLECTED bilinçli
 * olarak LİSTEDE DEĞİL: tahsil edilmiş çeke kapama MEŞRUDUR (müşterinin ödemesi
 * gerçekleşti; dışlanan yalnız paranın YOK olduğu durumlardır).
 *
 * ⚠️ ÜÇ YÜZEY AYNI KÜMEYİ SÖYLEMEK ZORUNDA: ① bu liste — ön kontrol
 * (`chequeCanAllocate`) ve `bumpChequeAllocated`'ın SQL süzgeci İKİSİ DE
 * buradan okur, ayrışmaları yapısal olarak imkânsız; ② DB CHECK'i
 * `cheques_terminal_not_allocated` (migration 20260814110200 — SQL literal'i
 * bu sabiti OKUYAMAZ, listeyi değiştirirken migration da değişir); ③
 * `error.middleware`'in o CHECK için bastığı Türkçe mesaj. Blocklist biçimi
 * bilinçli (allowlist DEĞİL): DB CHECK de blocklist'tir — yarın yeni bir çek
 * statüsü doğarsa iki katman AYNI cevabı verir; allowlist'te uygulama "hayır"
 * derken sed "evet" derdi (ya da tersi).
 */
export const CHEQUE_NO_MONEY_STATUSES: readonly ChequeStatus[] = [
  ChequeStatus.BOUNCED,
  ChequeStatus.RETURNED,
  ChequeStatus.CANCELLED,
];

/** Çek KAPAMAYA UYGUN mu — parası-yok statüler dışında her durum kapatabilir. */
export function chequeCanAllocate(status: ChequeStatus): boolean {
  return !CHEQUE_NO_MONEY_STATUSES.includes(status);
}

/**
 * FIFO ÖNERİSİ — en eski vadeli faturadan başlayarak tutarı dağıtır.
 *
 * ⚠️ BU BİR ÖNERİDİR, OTOMATİK KAPAMA DEĞİL. Sektörde "hangi faturayı kapattın"
 * kararı müşteriyle konuşulan bir karardır (müşteri "şu faturayı ödedim" der,
 * en eskisini değil). Otomatik commit, o kararı sistemin sessizce vermesi
 * olurdu ve düzeltmek için önce yanlış kapamayı çözmek gerekirdi. Bu yüzden
 * öneri YALNIZ okuma ucundan döner; yazan uç her zaman açık bir listedir.
 *
 * Saf fonksiyon — bekçi onu doğrudan ölçer.
 */
export function suggestFifo(
  openTotals: Prisma.Decimal[],
  amount: Prisma.Decimal,
): Prisma.Decimal[] {
  let left = amount;
  return openTotals.map((open) => {
    if (left.lte(0)) return D0();
    const take = left.gte(open) ? open : left;
    left = left.minus(take);
    return take;
  });
}

// -----------------------------------------------------------------------------
// HAM SAYAÇ YAZARLARI
// -----------------------------------------------------------------------------
// ⚠️ Dört fonksiyon da `count === 0`'ı BAŞARISIZLIK sayar ve çağıranı fırlatmaya
// zorlar. "0 satır güncellendi"yi sessizce geçmek, sayaçların defterle
// ayrıştığı ve kimsenin haberi olmadığı durumdur — tam olarak bu modülün
// önlemek için var olduğu şey.

/** `Invoice.paidTotal += amount`, `grandTotal` tavanına çarparsa 0 döner. */
async function bumpInvoicePaid(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  amount: Prisma.Decimal,
): Promise<number> {
  const a = amount.toFixed(2);
  return tx.$executeRaw`
    UPDATE "invoices"
       SET "paidTotal" = "paidTotal" + ${a}::numeric,
           "updatedAt" = NOW()  -- tz-ok: kolon timestamptz; ham UPDATE Prisma'nin @updatedAt kancasını atlar, elle yazılmazsa sayaç değişir ama damga BAYAT kalır
     WHERE "id" = ${invoiceId}::uuid
       AND "status" = 'CONFIRMED'
       AND "paidTotal" + ${a}::numeric <= "grandTotal"
  `;
}

/** `Invoice.paidTotal -= amount`, 0'ın altına inecekse 0 döner. */
async function dropInvoicePaid(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  amount: Prisma.Decimal,
): Promise<number> {
  const a = amount.toFixed(2);
  return tx.$executeRaw`
    UPDATE "invoices"
       SET "paidTotal" = "paidTotal" - ${a}::numeric,
           "updatedAt" = NOW()  -- tz-ok: kolon timestamptz; ham UPDATE Prisma'nin @updatedAt kancasını atlar, elle yazılmazsa sayaç değişir ama damga BAYAT kalır
     WHERE "id" = ${invoiceId}::uuid
       AND "paidTotal" - ${a}::numeric >= 0
  `;
}

/**
 * `Payment.allocatedTotal += amount` — `amount` tavanına ve `ACTIVE` durumuna bağlı.
 *
 * ⚠️ `status = 'ACTIVE'` koşulu WHERE'de LOAD-BEARING: ön kontrolle iptal
 * durumunu okumak yetmez, çünkü ön kontrol ile yazım arasında tahsilat iptal
 * edilebilir. Koşul burada olunca iptal edilmiş tahsilatla kapama YAPILAMAZ —
 * kilit altında yeniden değerlendirilir.
 */
async function bumpPaymentAllocated(
  tx: Prisma.TransactionClient,
  paymentId: string,
  amount: Prisma.Decimal,
): Promise<number> {
  const a = amount.toFixed(2);
  return tx.$executeRaw`
    UPDATE "payments"
       SET "allocatedTotal" = "allocatedTotal" + ${a}::numeric,
           "updatedAt" = NOW()  -- tz-ok: kolon timestamptz; ham UPDATE Prisma'nin @updatedAt kancasını atlar, elle yazılmazsa sayaç değişir ama damga BAYAT kalır
     WHERE "id" = ${paymentId}::uuid
       AND "status" = 'ACTIVE'
       AND "allocatedTotal" + ${a}::numeric <= "amount"
  `;
}

async function dropPaymentAllocated(
  tx: Prisma.TransactionClient,
  paymentId: string,
  amount: Prisma.Decimal,
): Promise<number> {
  const a = amount.toFixed(2);
  return tx.$executeRaw`
    UPDATE "payments"
       SET "allocatedTotal" = "allocatedTotal" - ${a}::numeric,
           "updatedAt" = NOW()  -- tz-ok: kolon timestamptz; ham UPDATE Prisma'nin @updatedAt kancasını atlar, elle yazılmazsa sayaç değişir ama damga BAYAT kalır
     WHERE "id" = ${paymentId}::uuid
       AND "allocatedTotal" - ${a}::numeric >= 0
  `;
}

/**
 * `Cheque.allocatedTotal += amount`.
 *
 * ⚠️ Durum süzgeci `CHEQUE_NO_MONEY_STATUSES` sabitinden gelir — ön kontrol
 * (`chequeCanAllocate`) ile AYNI kaynak, ayrışmaları yapısal olarak imkânsız
 * (eskiden burada elle yazılmış bir allowlist vardı ve "BİREBİR tut" kuralı
 * yalnız bir yorumdu). Süzgecin buradaki varlığı LOAD-BEARING (Sınıf 4 —
 * çift yönlü CAS'ın kapama bacağı): ön kontrol ile bu UPDATE arasında çek
 * karşılıksız/iade/iptal EDİLEBİLİR; koşul PG satır kilidi ALTINDA yeniden
 * değerlendirildiği için (EvalPlanQual) yarışta parasız çeke kapama YAZILAMAZ.
 * `count === 0` tanısı çağırandadır (`explainChequeBumpZeroTx`), üçüncü katman
 * DB CHECK'i `cheques_terminal_not_allocated`.
 */
async function bumpChequeAllocated(
  tx: Prisma.TransactionClient,
  chequeId: string,
  amount: Prisma.Decimal,
): Promise<number> {
  const a = amount.toFixed(2);
  return tx.$executeRaw`
    UPDATE "cheques"
       SET "allocatedTotal" = "allocatedTotal" + ${a}::numeric,
           "updatedAt" = NOW()  -- tz-ok: kolon timestamptz; ham UPDATE Prisma'nin @updatedAt kancasını atlar, elle yazılmazsa sayaç değişir ama damga BAYAT kalır
     WHERE "id" = ${chequeId}::uuid
       AND NOT ("status" = ANY(${[...CHEQUE_NO_MONEY_STATUSES]}::"ChequeStatus"[]))
       AND "allocatedTotal" + ${a}::numeric <= "amount"
  `;
}

/**
 * `Cheque.allocatedTotal -= amount`.
 *
 * ⚠️ Durum süzgeci YOK ve olmamalı: bu fonksiyonu çağıran yol tam da çekin
 * KARŞILIKSIZ çıktığı (BOUNCED) ya da iptal edildiği andır. Buraya "yalnız
 * canlı çekte düş" koşulu koymak, çözülmesi gereken tek durumda çözmemek olurdu.
 */
async function dropChequeAllocated(
  tx: Prisma.TransactionClient,
  chequeId: string,
  amount: Prisma.Decimal,
): Promise<number> {
  const a = amount.toFixed(2);
  return tx.$executeRaw`
    UPDATE "cheques"
       SET "allocatedTotal" = "allocatedTotal" - ${a}::numeric,
           "updatedAt" = NOW()  -- tz-ok: kolon timestamptz; ham UPDATE Prisma'nin @updatedAt kancasını atlar, elle yazılmazsa sayaç değişir ama damga BAYAT kalır
     WHERE "id" = ${chequeId}::uuid
       AND "allocatedTotal" - ${a}::numeric >= 0
  `;
}

// -----------------------------------------------------------------------------
// SERBEST BIRAKMA (STORNO ENTEGRASYONLARI)
// -----------------------------------------------------------------------------
// ⚠️ ÜÇÜ DE `tx` ALIR ve KENDİ TRANSACTION'INI AÇMAZ. Sebep: kaynağın stornosu
// ile kapamanın çözülmesi YA BİRLİKTE olur YA HİÇ. Ayrı tx'te koşsalardı araya
// giren bir hata "tahsilat iptal edildi ama fatura hâlâ kapalı görünüyor"
// durumunu KALICI yapardı — bu modülün önlemek için var olduğu tek şey.
//
// ⚠️ SATIR FİZİKSEL OLARAK SİLİNİR — "soft delete" kuralının YAZILI istisnası.
// Gerekçe migration 20260814102000'in kendi yorumunda: negatif tutarlı bir
// "ters kapama" satırı CHECK (`amount > 0`) ile yasak, çünkü kapama bir DEFTER
// KAYDI DEĞİL bir EŞLEŞMEDİR; eşleşme bozulunca izi kalması gereken şey satırın
// kendisi değil, kaynağın storno kaydıdır (o append-only defterde duruyor).
// Kapamanın izi ayrıca audit'e yazılır.

/**
 * Verilen kapama satırlarını çözer: fatura sayaçlarını düşürür, satırları
 * REVOKE DAMGASIYLA işaretler (silmez — defter doktrini).
 *
 * Ortak gövde — üç storno yolu da buradan geçer ki "faturayı düş ama kaynağı
 * düşme" gibi yarım bir çözülme yazılamasın.
 */
async function releaseRowsTx(
  tx: Prisma.TransactionClient,
  rows: Array<{ id: string; invoiceId: string; amount: Prisma.Decimal }>,
  opts: ReleaseOptions = {},
): Promise<{ total: Prisma.Decimal; invoiceIds: string[] }> {
  const { reason, userId } = opts;
  // Fatura BAŞINA topla: aynı kaynağın aynı faturaya birden çok kısmi kapaması
  // meşrudur (unique yok — migration notu). Satır satır düşmek de doğru sonucu
  // verirdi ama tek UPDATE hem daha az kilit hem daha az tur.
  const byInvoice = new Map<string, Prisma.Decimal>();
  let total = D0();
  for (const r of rows) {
    const amt = D(r.amount);
    total = total.plus(amt);
    byInvoice.set(r.invoiceId, (byInvoice.get(r.invoiceId) ?? D0()).plus(amt));
  }

  for (const [invoiceId, sum] of byInvoice) {
    const n = await dropInvoicePaid(tx, invoiceId, sum);
    if (n === 0) {
      // Sayaç düşürülemiyorsa `paidTotal` zaten kapamalardan AZ demektir: veri
      // sapmış. Sessizce geçmek sapmayı kalıcılaştırırdı; storno'yu düşürmek
      // sapmayı görünür yapar ve düzeltilmeden ikinci bir işlem yapılamaz.
      throw AppError.conflict(
        "Fatura kapama sayacı tutarsız (paidTotal beklenenden az) — işlem geri alındı. Muhasebe mutabakatı çalıştırılmalı.",
      );
    }
  }
  // ATOMİK CLAIM korunur: `revokedAt: null` yüklemi eski `deleteMany`in yerini
  // tutar — eşzamanlı iki storno aynı satırı iki kez çözemez, kaybeden 0 sayar.
  const revoked = await tx.paymentAllocation.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, ...ACTIVE_ALLOCATION },
    data: { revokedAt: new Date(), revokedById: userId ?? null, revokeReason: reason ?? null },
  });
  if (revoked.count !== rows.length) {
    throw AppError.conflict(
      "Kapama satırlarından biri bu sırada zaten çözülmüş — işlem geri alındı, listeyi yenileyin.",
    );
  }
  return { total, invoiceIds: [...byInvoice.keys()] };
}

/**
 * TAHSİLAT STORNOSU — bu tahsilatın kapattığı tüm faturaları yeniden açar.
 *
 * Çağıran: `payment.service.cancel()` (claim'den SONRA, ters defter satırıyla
 * AYNI tx'te). Bu satır atlanırsa iptal edilmiş bir tahsilat faturayı "kapalı"
 * tutmaya devam eder — bekçinin §7 bölümü tam olarak bunu kanıta bağlar.
 */
export async function releaseAllocationsForPaymentTx(
  tx: Prisma.TransactionClient,
  paymentId: string,
  opts: ReleaseOptions = {},
): Promise<ReleaseSummary> {
  const rows = await tx.paymentAllocation.findMany({
    where: { paymentId, ...ACTIVE_ALLOCATION },
    select: { id: true, invoiceId: true, amount: true },
  });
  if (rows.length === 0) return { count: 0, total: D0(), invoiceIds: [] };

  const { total, invoiceIds } = await releaseRowsTx(tx, rows, opts);
  const n = await dropPaymentAllocated(tx, paymentId, total);
  if (n === 0) {
    throw AppError.conflict(
      "Tahsilat kapama sayacı tutarsız (allocatedTotal beklenenden az) — işlem geri alındı.",
    );
  }

  void AuditService.log({
    userId: opts.userId,
    action: "DELETE",
    tableName: "PAYMENT_ALLOCATION",
    recordId: paymentId,
    oldData: { event: "ALLOCATIONS_RELEASED", reason: opts.reason ?? "PAYMENT_CANCEL", count: rows.length, total: total.toString(), invoiceIds },
  });
  return { count: rows.length, total, invoiceIds };
}

/**
 * ÇEK STORNOSU — karşılıksız (BOUNCE) / iade / iptal.
 *
 * Çağıran: `cheque.service` (C1, paralel yazılıyor). Bu satır atlanırsa
 * karşılıksız çıkmış bir çek faturayı kapalı tutar: cari bakiyesi ters kayıtla
 * düzelir ama YAŞLANDIRMA raporu o faturayı hiç görmez — yani "parası yok olmuş
 * ama kapalı görünen fatura". Bakiyenin doğru olması bunu ÖRTER, gizlemez.
 */
/**
 * ⚠️ ŞU AN ÇAĞRILMIYOR — ve bu BİLİNÇLİ bir tasarım kararıdır, unutulmuş bir
 * bağlantı değil.
 *
 * Plan "çek karşılıksız çıkarsa kapama çözülür" diyordu. `cheque.service` bunun
 * yerine BLOKLAMAYI seçti: kapaması olan bir çek karşılıksız/iade/iptal
 * edilemez, önce kapama kaldırılır (`assertNotAllocated`, mesaj yolu gösterir).
 * Blokla-yerine-otomatik-çöz tercihi daha güvenli: N faturayı sessizce yeniden
 * açmak yerine kullanıcı ne olduğunu görerek onaylar.
 *
 * Yardımcı SİLİNMEDİ çünkü karar tersine dönebilir (tek adımlı akış istenirse
 * çağrı noktası hazır) ve bekçisi davranışı zaten kilitliyor. Silmeden önce
 * yukarıdaki gerekçeyi çürüt.
 */
export async function releaseAllocationsForChequeTx(
  tx: Prisma.TransactionClient,
  chequeId: string,
  opts: ReleaseOptions = {},
): Promise<ReleaseSummary> {
  const rows = await tx.paymentAllocation.findMany({
    where: { chequeId, ...ACTIVE_ALLOCATION },
    select: { id: true, invoiceId: true, amount: true },
  });
  if (rows.length === 0) return { count: 0, total: D0(), invoiceIds: [] };

  const { total, invoiceIds } = await releaseRowsTx(tx, rows, opts);
  const n = await dropChequeAllocated(tx, chequeId, total);
  if (n === 0) {
    throw AppError.conflict("Çek kapama sayacı tutarsız (allocatedTotal beklenenden az) — işlem geri alındı.");
  }

  void AuditService.log({
    userId: opts.userId,
    action: "DELETE",
    tableName: "PAYMENT_ALLOCATION",
    recordId: chequeId,
    oldData: { event: "ALLOCATIONS_RELEASED", reason: opts.reason ?? "CHEQUE_RELEASE", count: rows.length, total: total.toString(), invoiceIds },
  });
  return { count: rows.length, total, invoiceIds };
}

/**
 * FATURA STORNOSU — bu faturayı kapatan tüm tahsilat/çekleri SERBEST bırakır.
 *
 * Çağıran: `invoice.service.cancel()`. Fatura iptal edilince parası ortada
 * kalmaz: tahsilat/çek yeniden "kapatılmamış" sayılır ve başka bir faturaya
 * bağlanabilir. Bu satır atlanırsa tahsilat sonsuza dek bir hayalete bağlı
 * kalır (`allocatedTotal` düşmez → o parayla başka fatura kapatılamaz).
 *
 * ⚠️ Kaynaklar KAYNAK BAŞINA gruplanır: aynı fatura hem bir tahsilat hem bir
 * çekle kısmen kapanmış olabilir; tek toplamı tek kaynaktan düşmek diğerini
 * sonsuza dek kilitli bırakırdı.
 */
export async function releaseAllocationsForInvoiceTx(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  opts: ReleaseOptions = {},
): Promise<ReleaseSummary> {
  const rows = await tx.paymentAllocation.findMany({
    where: { invoiceId, ...ACTIVE_ALLOCATION },
    select: { id: true, invoiceId: true, paymentId: true, chequeId: true, amount: true },
  });
  if (rows.length === 0) return { count: 0, total: D0(), invoiceIds: [] };

  const byPayment = new Map<string, Prisma.Decimal>();
  const byCheque = new Map<string, Prisma.Decimal>();
  for (const r of rows) {
    const amt = D(r.amount);
    if (r.paymentId) byPayment.set(r.paymentId, (byPayment.get(r.paymentId) ?? D0()).plus(amt));
    else if (r.chequeId) byCheque.set(r.chequeId, (byCheque.get(r.chequeId) ?? D0()).plus(amt));
  }

  const { total } = await releaseRowsTx(tx, rows, opts);
  for (const [pid, sum] of byPayment) {
    if ((await dropPaymentAllocated(tx, pid, sum)) === 0) {
      throw AppError.conflict("Tahsilat kapama sayacı tutarsız — işlem geri alındı.");
    }
  }
  for (const [cid, sum] of byCheque) {
    if ((await dropChequeAllocated(tx, cid, sum)) === 0) {
      throw AppError.conflict("Çek kapama sayacı tutarsız — işlem geri alındı.");
    }
  }

  void AuditService.log({
    userId: opts.userId,
    action: "DELETE",
    tableName: "PAYMENT_ALLOCATION",
    recordId: invoiceId,
    oldData: {
      event: "ALLOCATIONS_RELEASED",
      reason: opts.reason ?? "INVOICE_CANCEL",
      count: rows.length,
      total: total.toString(),
      paymentIds: [...byPayment.keys()],
      chequeIds: [...byCheque.keys()],
    },
  });
  return { count: rows.length, total, invoiceIds: [invoiceId] };
}

// -----------------------------------------------------------------------------
// SERVİS
// -----------------------------------------------------------------------------

/** Kapama kaynağının tx içinde taze okunmuş özeti. */
interface SourceInfo {
  label: string;
  cariId: string;
  currency: Currency;
  amount: Prisma.Decimal;
  allocatedTotal: Prisma.Decimal;
}

export class PaymentAllocationService {
  // ---------------------------------------------------------------------------
  // KAPAMA
  // ---------------------------------------------------------------------------

  /**
   * Tek kapama satırı yazar.
   *
   * ⚠️ Ön kontroller (cari/para birimi/yön/durum) İYİ HATA MESAJI içindir,
   * KORUMA DEĞİL: gerçek koruma ham UPDATE'lerin WHERE koşullarında ve DB
   * CHECK'lerinde yaşar. İkisi karıştırılıp ön kontrole güvenilirse
   * "oku → karar ver → yaz" penceresinde aşım geçer.
   */
  async allocate(input: AllocateInput, userId?: string): Promise<ApiResponse<{ id: string; invoiceDocNo: string; invoiceClosed: boolean }>> {
    const amount = D(input.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (amount.lte(0)) throw AppError.badRequest("Kapama tutarı sıfırdan büyük olmalı.");

    const hasPayment = Boolean(input.paymentId);
    const hasCheque = Boolean(input.chequeId);
    if (hasPayment === hasCheque) {
      throw AppError.badRequest("Kapama kaynağı olarak tahsilat VEYA çek seçilmeli (ikisi birden değil).");
    }

    const result = await prisma.$transaction(async (tx) => this.allocateOneTx(tx, input, amount, userId));

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "PAYMENT_ALLOCATION",
      recordId: result.id,
      newData: {
        invoiceId: input.invoiceId,
        paymentId: input.paymentId ?? null,
        chequeId: input.chequeId ?? null,
        amount: amount.toString(),
      },
    });
    return {
      success: true,
      data: result,
      message: result.invoiceClosed
        ? `${result.invoiceDocNo} tamamen kapandı.`
        : `${result.invoiceDocNo} için ${amount.toString()} kapatıldı.`,
    };
  }

  /**
   * ÇOKLU KAPAMA — tek tahsilatı N faturaya dağıtır.
   *
   * ⚠️ HEPSİ-YA-HİÇ ve bu, kurşun toplu dağıtımının BİLİNÇLİ TERSİDİR. Orada
   * parçalı sonuç doğruydu (her satır bağımsız bir iş) ; burada satırlar TEK
   * BİR DAĞITIMIN parçalarıdır: kullanıcı "1000 TL'yi şu üç faturaya böl"
   * diyor. Üçüncüsü sığmazsa ilk ikisini yazmak, kullanıcının hiç istemediği
   * bir dağıtımı kalıcı yapar ve düzeltmek için önce onu çözmek gerekir.
   */
  async allocateBulk(
    input: { paymentId?: string | null; chequeId?: string | null; items: Array<{ invoiceId: string; amount: Prisma.Decimal.Value; notes?: string | null }> },
    userId?: string,
  ): Promise<ApiResponse<{ count: number; total: string; ids: string[] }>> {
    if (input.items.length === 0) throw AppError.badRequest("Kapatılacak fatura seçilmedi.");
    const hasPayment = Boolean(input.paymentId);
    const hasCheque = Boolean(input.chequeId);
    if (hasPayment === hasCheque) {
      throw AppError.badRequest("Kapama kaynağı olarak tahsilat VEYA çek seçilmeli (ikisi birden değil).");
    }

    const rows = await prisma.$transaction(async (tx) => {
      const out: Array<{ id: string; amount: Prisma.Decimal }> = [];
      for (const it of input.items) {
        const amount = D(it.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        if (amount.lte(0)) throw AppError.badRequest("Kapama tutarı sıfırdan büyük olmalı.");
        const r = await this.allocateOneTx(
          tx,
          { invoiceId: it.invoiceId, paymentId: input.paymentId ?? null, chequeId: input.chequeId ?? null, amount, notes: it.notes ?? null },
          amount,
          userId,
        );
        out.push({ id: r.id, amount });
      }
      return out;
    });

    const total = rows.reduce((acc, r) => acc.plus(r.amount), D0());
    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "PAYMENT_ALLOCATION",
      recordId: (input.paymentId ?? input.chequeId) as string,
      newData: { event: "ALLOCATE_BULK", count: rows.length, total: total.toString() },
    });
    return {
      success: true,
      data: { count: rows.length, total: total.toString(), ids: rows.map((r) => r.id) },
      message: `${rows.length} fatura için toplam ${total.toString()} kapatıldı.`,
    };
  }

  /** Tek kapamanın tx-içi gövdesi — `allocate` ve `allocateBulk` ORTAK kullanır. */
  private async allocateOneTx(
    tx: Prisma.TransactionClient,
    input: AllocateInput,
    amount: Prisma.Decimal,
    userId?: string,
  ): Promise<{ id: string; invoiceDocNo: string; invoiceClosed: boolean }> {
    const inv = await tx.invoice.findUnique({
      where: { id: input.invoiceId },
      select: { id: true, docNo: true, type: true, status: true, cariId: true, currency: true, grandTotal: true, paidTotal: true },
    });
    if (!inv) throw AppError.notFound("Fatura bulunamadı.");
    if (inv.status === InvoiceStatus.DRAFT) {
      throw AppError.conflict(
        `${inv.docNo} henüz onaylanmamış — taslak fatura deftere işlemediği için kapatılamaz. Önce onaylayın.`,
      );
    }
    if (inv.status === InvoiceStatus.CANCELLED) {
      throw AppError.conflict(`${inv.docNo} iptal edilmiş — kapatılamaz.`);
    }

    const src = input.paymentId
      ? await this.loadPaymentTx(tx, input.paymentId, inv.type)
      : await this.loadChequeTx(tx, input.chequeId as string, inv.type);

    // ── BİLİNÇLİ DAR KURALLAR ────────────────────────────────────────────
    // Çapraz cari ve çapraz kur kapaması Faz 3. İkisi de "yapılabilir ama
    // yanlış": başka carinin parasıyla kapamak muhasebede bir VİRMAN'dır
    // (iki cari deftere de satır ister), farklı para birimi ise KUR FARKI
    // doğurur ve o fark bir yere yazılmak zorundadır. İkisini de sessizce
    // yapmak, farkı yok saymak olurdu.
    if (src.cariId !== inv.cariId) {
      throw AppError.badRequest(
        `${src.label} başka bir cariye ait — farklı carinin ödemesiyle fatura kapatılamaz (mahsuplaşma ayrı bir işlemdir).`,
      );
    }
    if (src.currency !== inv.currency) {
      throw AppError.badRequest(
        `${src.label} ${src.currency}, fatura ${inv.currency} — farklı para biriminde kapama kur farkı doğurur ve bu sürümde desteklenmiyor.`,
      );
    }

    const invOpen = D(inv.grandTotal).minus(D(inv.paidTotal));
    const srcFree = src.amount.minus(src.allocatedTotal);

    // ── ATOMİK SAYAÇLAR ──────────────────────────────────────────────────
    // ⚠️ SIRA SABİT (önce fatura, sonra kaynak): iki eşzamanlı kapama aynı
    // faturayla aynı tahsilata dokunabilir; ters sırayla yazan bir yol
    // eklenirse klasik ABBA deadlock'u doğar.
    if ((await bumpInvoicePaid(tx, inv.id, amount)) === 0) {
      // 0'ın iki sebebi olabilir: tavan YA DA fatura kontrol ile yazım arasında
      // iptal edildi (allocate ‖ invoice.cancel yarışı) — tanı tx İÇİNDE taze
      // okumayla; sebep iptalse aşağıdaki tavan satırına hiç düşülmez.
      await this.explainInvoiceBumpZeroTx(tx, inv.id);
      throw AppError.conflict(
        `${inv.docNo} için kapatılabilecek tutar ${invOpen.toString()} ${inv.currency} — ${amount.toString()} yazılamaz.`,
      );
    }
    const srcBumped = input.paymentId
      ? await bumpPaymentAllocated(tx, input.paymentId, amount)
      : await bumpChequeAllocated(tx, input.chequeId as string, amount);
    if (srcBumped === 0) {
      // Kaynak dalında 0'ın İKİ ayrı sebebi olabilir (tavan ya da kaynağın bu
      // sırada parasızlaşması — çekte terminal statü, tahsilatta iptal) ve
      // ikisine aynı mesajı basmak yanlış dalda YALAN olur — tanı tx İÇİNDE
      // taze okumayla konur; sebep tavan değilse aşağıdaki satıra hiç düşülmez
      // (fırlatır).
      if (input.chequeId) await this.explainChequeBumpZeroTx(tx, input.chequeId);
      else await this.explainPaymentBumpZeroTx(tx, input.paymentId as string);
      throw AppError.conflict(
        `${src.label} üzerinde kapamaya kalan tutar ${srcFree.toString()} ${src.currency} — ${amount.toString()} yazılamaz.`,
      );
    }

    const row = await tx.paymentAllocation.create({
      data: {
        invoiceId: inv.id,
        paymentId: input.paymentId ?? null,
        chequeId: input.chequeId ?? null,
        amount,
        notes: input.notes ?? null,
        createdById: userId ?? null,
      },
      select: { id: true },
    });

    // "Kapandı mı" TÜRETİLİR — kolon değil. Taze okunur, çünkü aynı tx'te
    // birden çok kapama olabilir (bulk).
    const after = await tx.invoice.findUniqueOrThrow({
      where: { id: inv.id },
      select: { grandTotal: true, paidTotal: true },
    });
    return {
      id: row.id,
      invoiceDocNo: inv.docNo,
      invoiceClosed: D(after.paidTotal).gte(D(after.grandTotal)),
    };
  }

  /**
   * Çek bump'ı 0 döndüğünde SEBEBİ tx İÇİNDE taze okumayla ayırt eder (Sınıf 4).
   *
   * Ön kontrol (`loadChequeTx`) İYİ MESAJ içindir, koruma değil: kontrol ile
   * ham UPDATE arasında çek karşılıksız/iade/iptal edilebilir (canlı yarış —
   * bekçinin §12 kilit-altı sondası bu pencereyi deterministik üretir). O
   * durumda "kapamaya kalan tutar X" tavan mesajı YALAN olurdu: kalan tutar
   * değil, paranın KENDİSİ yok. Üç dal:
   *   kayıt yok → 404 · parası-yok statü → anlamlı 409 · değilse → dönüş
   *   (çağıran mevcut tavan 409'unu basar).
   */
  private async explainChequeBumpZeroTx(tx: Prisma.TransactionClient, chequeId: string): Promise<void> {
    const fresh = await tx.cheque.findUnique({
      where: { id: chequeId },
      select: { docNo: true, status: true },
    });
    if (!fresh) throw AppError.notFound("Çek/senet bulunamadı.");
    if (!chequeCanAllocate(fresh.status)) {
      const label =
        fresh.status === ChequeStatus.BOUNCED
          ? "karşılıksız çıktı"
          : fresh.status === ChequeStatus.RETURNED
            ? "sahibine iade edildi"
            : "iptal edildi";
      throw AppError.conflict(
        `${fresh.docNo} bu sırada ${label} — karşılıksız/iade/iptal çekle kapama yapılamaz (çekin parası yoktur). Listeyi yenileyip başka bir kaynak seçin.`,
      );
    }
  }

  /**
   * Fatura bump'ı 0 döndüğünde SEBEBİ ayırt eder — çek tanısının FATURA ikizi.
   *
   * Ön kontrol DRAFT/CANCELLED'ı zaten reddetti; buraya düşen 0'ın sebebi ya
   * TAVANDIR ya da fatura kontrol ile yazım arasında iptal edildi (allocate ‖
   * invoice.cancel yarışı — bekçi §12m deterministik üretir). İkincisinde tavan
   * mesajı YALAN olurdu: "kapatılabilecek tutar X" değil, faturanın kendisi yok.
   * Üç dal: kayıt yok → 404 · CONFIRMED değil → anlamlı 409 · değilse → dönüş
   * (çağıran mevcut tavan 409'unu basar).
   */
  private async explainInvoiceBumpZeroTx(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
    const fresh = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { docNo: true, status: true } });
    if (!fresh) throw AppError.notFound("Fatura bulunamadı.");
    if (fresh.status === InvoiceStatus.CANCELLED) {
      throw AppError.conflict(
        `${fresh.docNo} bu sırada iptal edildi — iptal edilmiş fatura kapatılamaz. Listeyi yenileyin.`,
      );
    }
    if (fresh.status === InvoiceStatus.DRAFT) {
      throw AppError.conflict(`${fresh.docNo} onaylı değil — taslak fatura kapatılamaz.`);
    }
  }

  /**
   * Tahsilat bump'ı 0 döndüğünde SEBEBİ ayırt eder — çek tanısının TAHSİLAT
   * ikizi. `bumpPaymentAllocated`ın WHERE'indeki `status='ACTIVE'` koşulu,
   * allocate ‖ payment.cancel yarışında 0 döndürür (bekçi §12k deterministik
   * üretir); tavan mesajı basmak yanlış dalda konuşmak olurdu.
   */
  private async explainPaymentBumpZeroTx(tx: Prisma.TransactionClient, paymentId: string): Promise<void> {
    const fresh = await tx.payment.findUnique({ where: { id: paymentId }, select: { docNo: true, status: true } });
    if (!fresh) throw AppError.notFound("Tahsilat/ödeme bulunamadı.");
    if (fresh.status !== PaymentStatus.ACTIVE) {
      throw AppError.conflict(
        `${fresh.docNo} bu sırada iptal edildi — iptal edilmiş tahsilatla kapama yapılamaz. Listeyi yenileyip başka bir kaynak seçin.`,
      );
    }
  }

  private async loadPaymentTx(tx: Prisma.TransactionClient, paymentId: string, invoiceType: InvoiceType): Promise<SourceInfo> {
    const p = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, docNo: true, direction: true, status: true, cariId: true, currency: true, amount: true, allocatedTotal: true },
    });
    if (!p) throw AppError.notFound("Tahsilat/ödeme bulunamadı.");
    if (p.status !== PaymentStatus.ACTIVE) throw AppError.conflict(`${p.docNo} iptal edilmiş — kapama yapılamaz.`);
    if (!directionMatchesInvoice(p.direction, invoiceType)) {
      throw AppError.badRequest(
        p.direction === PaymentDirection.IN
          ? `${p.docNo} bir TAHSİLATTIR ve yalnız SATIŞ faturasını kapatabilir.`
          : `${p.docNo} bir ÖDEMEDİR ve yalnız ALIŞ faturasını kapatabilir.`,
      );
    }
    return {
      label: p.docNo,
      cariId: p.cariId,
      currency: p.currency,
      amount: D(p.amount),
      allocatedTotal: D(p.allocatedTotal),
    };
  }

  private async loadChequeTx(tx: Prisma.TransactionClient, chequeId: string, invoiceType: InvoiceType): Promise<SourceInfo> {
    const c = await tx.cheque.findUnique({
      where: { id: chequeId },
      select: { id: true, docNo: true, kind: true, status: true, cariId: true, currency: true, amount: true, allocatedTotal: true },
    });
    if (!c) throw AppError.notFound("Çek/senet bulunamadı.");
    if (!chequeCanAllocate(c.status)) {
      throw AppError.conflict(
        `${c.docNo} durumu "${CHEQUE_STATUS_LABEL[c.status]}" — bu çekle fatura kapatılamaz (karşılıksız/iade/iptal çekin parası yoktur).`,
      );
    }
    if (!chequeKindMatchesInvoice(c.kind, invoiceType)) {
      throw AppError.badRequest(
        c.kind === ChequeKind.RECEIVED
          ? `${c.docNo} ALINAN bir çektir ve yalnız SATIŞ faturasını kapatabilir.`
          : `${c.docNo} VERİLEN bir çektir ve yalnız ALIŞ faturasını kapatabilir.`,
      );
    }
    return {
      label: c.docNo,
      cariId: c.cariId,
      currency: c.currency,
      amount: D(c.amount),
      allocatedTotal: D(c.allocatedTotal),
    };
  }

  // ---------------------------------------------------------------------------
  // KAPAMA ÇÖZME (elle düzeltme)
  // ---------------------------------------------------------------------------

  /**
   * Tek kapamayı geri alır — "yanlış faturaya bağladım" düzeltmesi.
   *
   * ⚠️ ELLE DÜZELTME BİRİNCİ SINIFTIR (plan kararı): FIFO bir öneri olduğu için
   * yanlış eşleşme OLAĞANDIR ve düzeltmesi kolay olmalı. Kaynağın kendisine
   * (tahsilata/çeke) dokunulmaz — para hâlâ kasada, yalnız eşleşme çözülür.
   */
  async deallocate(id: string, userId?: string): Promise<ApiResponse<{ id: string; invoiceId: string; amount: string }>> {
    const result = await prisma.$transaction(async (tx) => {
      // ⚠️ ATOMİK CLAIM: satırı ÖNCE damgala, sonra sayaçları düş. `findUnique →
      // if → update` deseninde iki eşzamanlı istek aynı satırı iki kez "çözer"
      // ve sayaçları İKİ KEZ düşürürdü (fatura sahte açık kalırdı). `updateMany`
      // + `revokedAt: null` yüklemi etkilenen satır sayısını döner → gerçek claim.
      const row = await tx.paymentAllocation.findUnique({
        where: { id },
        select: { id: true, invoiceId: true, paymentId: true, chequeId: true, amount: true },
      });
      if (!row) throw AppError.notFound("Kapama kaydı bulunamadı.");
      const revoked = await tx.paymentAllocation.updateMany({
        where: { id, ...ACTIVE_ALLOCATION },
        data: { revokedAt: new Date(), revokedById: userId ?? null, revokeReason: "DEALLOCATE" },
      });
      if (revoked.count === 0) throw AppError.conflict("Kapama kaydı bu sırada zaten çözülmüş.");

      const amount = D(row.amount);
      if ((await dropInvoicePaid(tx, row.invoiceId, amount)) === 0) {
        throw AppError.conflict("Fatura kapama sayacı tutarsız — işlem geri alındı.");
      }
      const srcDropped = row.paymentId
        ? await dropPaymentAllocated(tx, row.paymentId, amount)
        : await dropChequeAllocated(tx, row.chequeId as string, amount);
      if (srcDropped === 0) throw AppError.conflict("Kaynak kapama sayacı tutarsız — işlem geri alındı.");

      return { id: row.id, invoiceId: row.invoiceId, amount: amount.toString() };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "PAYMENT_ALLOCATION",
      recordId: result.id,
      oldData: { revokedAt: null },
      newData: { event: "DEALLOCATE", invoiceId: result.invoiceId, amount: result.amount },
    });
    return { success: true, data: result, message: `${result.amount} tutarlı kapama çözüldü.` };
  }

  // ---------------------------------------------------------------------------
  // OKUMA
  // ---------------------------------------------------------------------------

  /** Bir faturanın / tahsilatın / çekin kapama satırları. */
  async list(params: { invoiceId?: string; paymentId?: string; chequeId?: string }): Promise<{ data: unknown[] }> {
    const where: Prisma.PaymentAllocationWhereInput = {};
    if (params.invoiceId) where.invoiceId = params.invoiceId;
    if (params.paymentId) where.paymentId = params.paymentId;
    if (params.chequeId) where.chequeId = params.chequeId;
    if (Object.keys(where).length === 0) {
      // Süzgeçsiz liste, tüm kapama tarihçesini tek sayfada döndürmeye çalışırdı
      // ve hiçbir ekranın işine yaramazdı; boş sonuç yerine sebebi söylenir.
      throw AppError.badRequest("Fatura, tahsilat veya çek seçilmeli.");
    }
    const data = await prisma.paymentAllocation.findMany({
      where: { ...where, ...ACTIVE_ALLOCATION },
      select: {
        id: true,
        amount: true,
        notes: true,
        createdAt: true,
        invoice: { select: { id: true, docNo: true, type: true, currency: true, grandTotal: true, paidTotal: true, issueDate: true, dueDate: true } },
        payment: { select: { id: true, docNo: true, direction: true, paymentDate: true } },
        cheque: { select: { id: true, docNo: true, kind: true, status: true, dueDate: true } },
      },
      orderBy: [{ createdAt: "asc" }],
    });
    return { data };
  }

  /**
   * AÇIK FATURALAR — kapama ekranının listesi ve FIFO önerisinin kaynağı.
   *
   * ⚠️ HAM SQL ZORUNLU: süzgeç `"paidTotal" < "grandTotal"` yani İKİ KOLONUN
   * karşılaştırması ve Prisma `where`'i bunu ifade edemez. Prisma ile yazmanın
   * tek yolu "hepsini çek, JS'te süz" olurdu — o da hem `invoices_open` partial
   * index'ini boşa çıkarır hem de ciro büyüdükçe yavaşlar.
   *
   * ⚠️ SIRA DETERMİNİSTİK olmak ZORUNDA: öneri her açılışta aynı çıkmalı, yoksa
   * kullanıcı aynı ekranı iki kez açtığında farklı dağıtım görür ve hangisinin
   * "doğru" olduğunu soramaz. Anahtar: efektif vade → keşide tarihi → belge no
   * (sonuncusu unique, yani eşitlik tam olarak bozulur).
   */
  async listOpenInvoices(params: {
    /** İkisinden TAM BİRİ: hesap kimliği ya da müşteri kartı (ödeme diyaloğu kartı bilir, hesabı değil — salt okunur çözülür; hesap yoksa boş liste). */
    cariId?: string | null;
    customerId?: string | null;
    currency: Currency;
    /** `IN` → satış faturaları, `OUT` → alış faturaları (yön kuralının aynası). */
    direction?: PaymentDirection;
    /** Verilirse FIFO önerisi hesaplanır (yalnız ÖNERİ — otomatik kapama yok). */
    amount?: Prisma.Decimal.Value | null;
    limit?: number;
  }): Promise<{ data: OpenInvoiceRow[]; totalOpen: string }> {
    if ((params.cariId == null) === (params.customerId == null)) {
      throw AppError.badRequest("Açık fatura listesi için cari hesap VEYA müşteri kartı verilmeli (ikisi birden değil).");
    }
    const cariId = params.cariId ?? (await findCariAccountIdByCustomer(params.customerId as string));
    if (!cariId) return { data: [], totalOpen: "0" };
    const limit = Math.min(500, Math.max(1, params.limit ?? 200));
    const types: InvoiceType[] =
      params.direction === PaymentDirection.IN
        ? [InvoiceType.SALES]
        : params.direction === PaymentDirection.OUT
          ? [InvoiceType.PURCHASE]
          : [InvoiceType.SALES, InvoiceType.PURCHASE];

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        docNo: string;
        type: InvoiceType;
        currency: Currency;
        issueDate: Date;
        dueDate: Date | null;
        grandTotal: Prisma.Decimal;
        paidTotal: Prisma.Decimal;
      }>
    >`
      SELECT "id", "docNo", "type", "currency", "issueDate", "dueDate", "grandTotal", "paidTotal"
        FROM "invoices"
       WHERE "cariId" = ${cariId}::uuid
         AND "currency" = ${params.currency}::"Currency"
         AND "status" = 'CONFIRMED'
         AND "paidTotal" < "grandTotal"
         AND "type" = ANY(${types}::"InvoiceType"[])
       ORDER BY COALESCE("dueDate", "issueDate") ASC, "issueDate" ASC, "docNo" ASC
       LIMIT ${limit}
    `;

    const opens = rows.map((r) => D(r.grandTotal).minus(D(r.paidTotal)));
    const totalOpen = opens.reduce((a, b) => a.plus(b), D0());
    const suggestion =
      params.amount != null ? suggestFifo(opens, D(params.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)) : null;

    return {
      data: rows.map((r, i) => ({
        id: r.id,
        docNo: r.docNo,
        type: r.type,
        currency: r.currency,
        issueDate: r.issueDate,
        dueDate: r.dueDate,
        effectiveDueDate: r.dueDate ?? r.issueDate,
        grandTotal: D(r.grandTotal).toString(),
        paidTotal: D(r.paidTotal).toString(),
        openTotal: (opens[i] as Prisma.Decimal).toString(),
        ...(suggestion ? { suggested: (suggestion[i] as Prisma.Decimal).toString() } : {}),
      })),
      totalOpen: totalOpen.toString(),
    };
  }

  /**
   * KAPAMAYA BAĞLANMAMIŞ tahsilat/ödemeler — "bu para hangi faturaya ait?"
   *
   * Yaşlandırma raporunun (C4) sanal FIFO mahsubu da bu kümeyi okur; ekranda
   * ise "serbest tahsilat" listesi olarak görünür.
   */
  async listUnallocatedPayments(params: {
    cariId: string;
    currency: Currency;
    direction?: PaymentDirection;
    limit?: number;
  }): Promise<{ data: Array<{ id: string; docNo: string; direction: PaymentDirection; paymentDate: Date; amount: string; allocatedTotal: string; freeTotal: string }>; totalFree: string }> {
    const limit = Math.min(500, Math.max(1, params.limit ?? 200));
    const rows = await prisma.$queryRaw<
      Array<{ id: string; docNo: string; direction: PaymentDirection; paymentDate: Date; amount: Prisma.Decimal; allocatedTotal: Prisma.Decimal }>
    >`
      SELECT "id", "docNo", "direction", "paymentDate", "amount", "allocatedTotal"
        FROM "payments"
       WHERE "cariId" = ${params.cariId}::uuid
         AND "currency" = ${params.currency}::"Currency"
         AND "status" = 'ACTIVE'
         AND "allocatedTotal" < "amount"
         ${params.direction ? Prisma.sql`AND "direction" = ${params.direction}::"PaymentDirection"` : Prisma.empty}
       ORDER BY "paymentDate" ASC, "docNo" ASC
       LIMIT ${limit}
    `;
    let totalFree = D0();
    const data = rows.map((r) => {
      const free = D(r.amount).minus(D(r.allocatedTotal));
      totalFree = totalFree.plus(free);
      return {
        id: r.id,
        docNo: r.docNo,
        direction: r.direction,
        paymentDate: r.paymentDate,
        amount: D(r.amount).toString(),
        allocatedTotal: D(r.allocatedTotal).toString(),
        freeTotal: free.toString(),
      };
    });
    return { data, totalFree: totalFree.toString() };
  }
}

export const paymentAllocationService = new PaymentAllocationService();

// -----------------------------------------------------------------------------
// OTOMATİK FIFO KAPAMA — `finance.autoAllocateOnPaymentEnabled` (dalga 2)
// -----------------------------------------------------------------------------
// ⚠️ BU FONKSİYON KURAL YAZMAZ, MEVCUT YOLU ÇAĞIRIR. Aday süzgeci (aynı cari ·
// aynı para birimi · yön · CONFIRMED · açık > 0), FIFO sırası (efektif vade =
// `dueDate ?? issueDate`) ve dağıtım aritmetiği ZATEN `listOpenInvoices` +
// `suggestFifo`'da yaşıyor; yazım tarafı ZATEN `allocateBulk`'ta. Burada ikinci
// bir formül yazmak, elle kapama ekranıyla otomatiğin bir gün AYRI cevaplar
// vermesi demekti — ve fark tam da kimsenin bakmadığı yerde (gece kaydedilen
// tahsilat) doğardı.
//
// ⚠️ TX'İN DIŞINDA, AYRI ADIM: tahsilat ASLA kapama yüzünden düşmez. Para el
// değiştirdi ve kaydı yazıldı; hangi faturaya sayılacağı ikinci bir sorudur ve
// yanlış/eksik cevabı düzeltilebilir (kapama elle çözülür), oysa kaydın hiç
// yazılmaması düzeltilemez. Bu yüzden çağıran hatayı YUTAR (bkz. payment.service).
//
// ⚠️ HEPSİ-YA-HİÇ (allocateBulk'ın sözleşmesi) BURADA DA DOĞRUDUR: okuma ile
// yazım arasında bir fatura elle kapanırsa TÜM otomatik dağıtım geri sarılır ve
// hiçbir satır yazılmaz. Yarısını yazmak, kullanıcının hiç istemediği bir
// dağıtımı kalıcı yapardı; kaybedilen şey yalnız otomasyonun o turudur.

/** Otomatik kapamanın sonucu — çağıran yanıt mesajını bundan kurar. */
export interface AutoAllocateSummary {
  /** Yazılan kapama satırı sayısı (0 = yapacak iş yoktu ya da aday yok). */
  count: number;
  /** Kapatılan toplam tutar (tahsilatın para biriminde). */
  total: Prisma.Decimal;
  /** Kapamaya girmeyen artan tutar — AVANS olarak açıkta kalır. */
  leftover: Prisma.Decimal;
  /** Kapatılan faturaların belge numaraları (audit/mesaj için). */
  invoiceDocNos: string[];
}

const EMPTY_AUTO_ALLOCATE: AutoAllocateSummary = {
  count: 0,
  total: D0(),
  leftover: D0(),
  invoiceDocNos: [],
};

/**
 * Bir tahsilatın/ödemenin KAPAMAYA KALAN tutarını en eski açık faturalara FIFO
 * dağıtır. Bayrağı ÇAĞIRAN okur (payment.service) — bu fonksiyon saf mekanizmadır.
 *
 * ⚠️ ÜRETİLEN SATIRLAR NORMAL KAPAMA SATIRLARIDIR: `notes` BOŞ bırakılır ve
 * "otomatik" olduğunu söyleyen hiçbir kolon/işaret yazılmaz. Sebebi tersinden:
 * satıra "Otomatik kapama" metni yazsaydık, bir gün biri o metne göre süzen kod
 * yazardı ("otomatikleri toplu çöz") ve serbest metin sessizce bir DAVRANIŞ
 * ANAHTARINA dönüşürdü. Provenance'ın yeri audit'tir (aşağıdaki kayıt), satırın
 * kendisi değil — ve satır elle silinebilir kalır ("sistem yaptı" diye kilit yok).
 *
 * @returns Yazılan kapamaların özeti; yapacak iş yoksa sıfırlı özet.
 */
export async function autoAllocatePaymentFifo(
  paymentId: string,
  userId?: string,
): Promise<AutoAllocateSummary> {
  const p = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      docNo: true,
      status: true,
      direction: true,
      cariId: true,
      currency: true,
      amount: true,
      allocatedTotal: true,
    },
  });
  // Kayıt yok / bu arada iptal edildi → sessiz sıfır. Otomasyon bir KULLANICI
  // KOMUTU değildir; olmayan bir şey için fırlatmak, çağıranın zaten yuttuğu bir
  // hatayı gürültüye çevirirdi.
  if (!p || p.status !== PaymentStatus.ACTIVE) return EMPTY_AUTO_ALLOCATE;

  // Kalan = tutar − zaten bağlanmış. Yeni kayıtta `allocatedTotal` 0'dır; çıkarma
  // yine de yapılır, çünkü fonksiyon kısmen bağlanmış bir tahsilat için elle de
  // çağrılabilir ve o durumda tutarın tamamını dağıtmak aşım 409'u üretirdi.
  const free = D(p.amount).minus(D(p.allocatedTotal));
  if (free.lte(0)) return EMPTY_AUTO_ALLOCATE;

  // Aday listesi + FIFO önerisi TEK KAYNAK: kapama ekranının gördüğü liste.
  // `direction` süzgeci yön kuralının (IN↔SALES, OUT↔PURCHASE) aynasıdır;
  // `currency` eşitliği farklı para birimli faturayı ATLAR (kur farkı kararı
  // otomatikleştirilmez — bayrak JSDoc'unun MUAF satırı).
  const open = await paymentAllocationService.listOpenInvoices({
    cariId: p.cariId,
    currency: p.currency,
    direction: p.direction,
    amount: free,
  });

  const items = open.data
    .map((row) => ({ invoiceId: row.id, docNo: row.docNo, amount: D(row.suggested ?? 0) }))
    .filter((it) => it.amount.gt(0));
  if (items.length === 0) return EMPTY_AUTO_ALLOCATE;

  await paymentAllocationService.allocateBulk(
    {
      paymentId: p.id,
      items: items.map((it) => ({ invoiceId: it.invoiceId, amount: it.amount, notes: null })),
    },
    userId,
  );

  const total = items.reduce((acc, it) => acc.plus(it.amount), D0());
  void AuditService.log({
    userId,
    action: "CREATE",
    tableName: "PAYMENT_ALLOCATION",
    recordId: p.id,
    newData: {
      event: "AUTO_ALLOCATE_ON_PAYMENT",
      paymentDocNo: p.docNo,
      count: items.length,
      total: total.toString(),
      leftover: free.minus(total).toString(),
      invoiceDocNos: items.map((it) => it.docNo),
    },
  });

  return {
    count: items.length,
    total,
    // Artan tutar hiçbir faturaya yazılmaz: AVANS'tır. Buraya "kalanı da bir
    // yere say" mantığı eklemek, olmayan bir borç uydurmak olurdu.
    leftover: free.minus(total),
    invoiceDocNos: items.map((it) => it.docNo),
  };
}
