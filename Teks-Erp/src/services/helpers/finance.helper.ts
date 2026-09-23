// =============================================================================
// ÖN MUHASEBE — ORTAK YARDIMCILAR
// =============================================================================
// Burada YALNIZ saf/tek-sorumluluklu parçalar var: belge numarası, tutar
// hesabı, kur çözümü, cari lazy açılışı. İş akışları (onay, storno, tahsilat)
// kendi servislerinde.
// =============================================================================
import { Prisma, CariKind, Currency, InvoiceType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { resolvePartyToCardTx } from "./party-card.helper";
import { nextSeriesNo } from "../number-series.service";

/** Sıfır Decimal — float aritmetiği YASAK (perf/doğruluk kuralı). */
export const D0 = (): Prisma.Decimal => new Prisma.Decimal(0);
export const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);

/**
 * Belge numarası ön ekleri.
 *
 * ⚠️ Fatura TÜRÜ ön eki belirler — tek "FT" ön eki kullanmak, satış ve alış
 * faturalarını aynı sayaçta karıştırırdı ve muhasebeci "SF00012 hangisiydi"
 * sorusunu belge numarasından cevaplayamazdı.
 */
export const INVOICE_SERIES: Record<InvoiceType, string> = {
  SALES: "invoiceSales",
  PURCHASE: "invoicePurchase",
  SALES_RETURN: "invoiceSalesReturn",
  PURCHASE_RETURN: "invoicePurchaseReturn",
};

/**
 * Günlük sıralı belge numarası — PREFIX + GGAAYY + sıra.
 *
 * ⚠️ `orderBy` ile DEĞİL, JS'te sayısal max ile çözülür: glibc collation
 * sırası lexicographic'tir ve sıra 9'dan 10'a geçince bozulur (order.service
 * kanıtlı deseni). Çağıran `withBarcodeRetry` ile sarmalar — unique çakışması
 * yarışta hâlâ mümkündür ve doğru cevap tekrar denemektir.
 */
export async function nextInvoiceNoTx(
  tx: Prisma.TransactionClient,
  type: InvoiceType,
  date: Date,
): Promise<string> {
  return nextSeriesNo(
    INVOICE_SERIES[type],
    async (full) => {
      const rows = await tx.invoice.findMany({
        where: { docNo: { gte: full, startsWith: full } },
        select: { docNo: true, createdAt: true },
      });
      return rows.map((r) => ({ code: r.docNo, createdAt: r.createdAt }));
    },
    date,
  );
}

/** Tahsilat "TH", ödeme "OD" (varsayılan; ön ekler `number_series`ten). */
export async function nextPaymentNoTx(
  tx: Prisma.TransactionClient,
  direction: "IN" | "OUT",
  date: Date,
): Promise<string> {
  return nextSeriesNo(
    direction === "IN" ? "paymentIn" : "paymentOut",
    async (full) => {
      const rows = await tx.payment.findMany({
        where: { docNo: { gte: full, startsWith: full } },
        select: { docNo: true, createdAt: true },
      });
      return rows.map((r) => ({ code: r.docNo, createdAt: r.createdAt }));
    },
    date,
  );
}

// -----------------------------------------------------------------------------
// TUTAR HESABI
// -----------------------------------------------------------------------------

export interface LineAmountsInput {
  qty: Prisma.Decimal.Value;
  unitPrice: Prisma.Decimal.Value;
  discountRate?: Prisma.Decimal.Value | null;
  vatRate?: Prisma.Decimal.Value | null;
  withholdingRate?: Prisma.Decimal.Value | null;
}

export interface LineAmounts {
  gross: Prisma.Decimal;
  discount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  withholdingAmount: Prisma.Decimal;
}

/**
 * Satır tutarları — TAMAMI Decimal.
 *
 * ⚠️ Yuvarlama SATIR BAZINDA yapılır (2 hane), belge toplamında değil. Sebep
 * sektörel: fatura kâğıdında her satırın tutarı basılır ve müşteri onları
 * toplar; belge toplamı satır toplamlarıyla TUTMAK ZORUNDADIR. Ham değerleri
 * toplayıp sonda yuvarlamak, kâğıtta 1 kuruşluk "hesap tutmuyor" üretir.
 *
 * ⚠️ Tevkifat KDV ÜZERİNDEN hesaplanır (Türk vergi mevzuatı: fason hizmetinde
 * alıcı, KDV'nin bir kısmını doğrudan vergi dairesine öder) — matrah üzerinden
 * değil. İkisi karıştırılırsa fason faturasının ödenecek tutarı yanlış çıkar.
 */
export function computeLineAmounts(input: LineAmountsInput): LineAmounts {
  const R = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const gross = R(D(input.qty).mul(D(input.unitPrice)));
  const discount = R(gross.mul(D(input.discountRate ?? 0)).div(100));
  const lineTotal = R(gross.minus(discount));
  const vatAmount = R(lineTotal.mul(D(input.vatRate ?? 0)).div(100));
  const withholdingAmount = R(vatAmount.mul(D(input.withholdingRate ?? 0)).div(100));
  return { gross, discount, lineTotal, vatAmount, withholdingAmount };
}

export interface InvoiceTotals {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  withholdingTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
}

/** Belge toplamları — satır tutarlarından, `.plus()` ile. */
export function computeInvoiceTotals(lines: LineAmountsInput[]): InvoiceTotals {
  let subtotal = D0();
  let discountTotal = D0();
  let vatTotal = D0();
  let withholdingTotal = D0();
  for (const l of lines) {
    const a = computeLineAmounts(l);
    subtotal = subtotal.plus(a.lineTotal);
    discountTotal = discountTotal.plus(a.discount);
    vatTotal = vatTotal.plus(a.vatAmount);
    withholdingTotal = withholdingTotal.plus(a.withholdingAmount);
  }
  // Tevkifat, ödenecek tutardan DÜŞÜLÜR (alıcı o kısmı vergi dairesine öder).
  const grandTotal = subtotal.plus(vatTotal).minus(withholdingTotal);
  return { subtotal, discountTotal, vatTotal, withholdingTotal, grandTotal };
}

/**
 * Cari deftere yazılacak YÖN.
 *
 * Sektör kuralı: müşteriden ALACAKLIYIZ (satış faturası → BORÇ kolonu), fason
 * firmaya BORÇLUYUZ (alış faturası → ALACAK kolonu). İade ters çevirir.
 *
 * ⚠️ Bu eşleme TEK YERDE yaşamalı — kopyalanırsa bir gün biri satış iadesini
 * yanlış kolona yazar ve cari bakiyesi iki kat sapar (hata çıkmadan).
 */
export function invoiceLedgerSide(type: InvoiceType): "debit" | "credit" {
  switch (type) {
    case "SALES":
      return "debit";
    case "PURCHASE":
      return "credit";
    case "SALES_RETURN":
      return "credit";
    case "PURCHASE_RETURN":
      return "debit";
  }
}

// -----------------------------------------------------------------------------
// VADE ÖN-DOLUMU
// -----------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * OTOMATİK TASLAKLARIN VADESİ — `issueDate + CariAccount.paymentTermDays`.
 *
 * ⚠️ NEDEN VAR (2026-08-15 saha planı, D-Karar "vade fallback ayrışması"):
 * iki otomatik üretici yol (`createDraftFromGoodsReceipt` ve
 * `autoDraftInvoiceAfterDispatch`) `dueDate` HİÇ yazmıyordu. Sonuç: aynı fatura
 * Faturalar listesinde sonsuza dek "gecikmemiş" (`settlementOf` yalnız
 * `Invoice.dueDate`e bakar) ama Yaşlandırma raporunda KIRMIZI görünüyordu —
 * çünkü rapor `dueDate ?? issueDate + paymentTermDays` fallback'ini uyguluyor
 * (`finance-aging.report.ts`). İki ekran aynı faturaya iki farklı cevap
 * veriyordu; kusur ekranlardan birinde değil, taslağın vadesiz doğmasındaydı.
 *
 * ⚠️ VADE UYDURULMAZ: `paymentTermDays` tanımsızsa `null` döner ve fatura
 * VADESİZ kalır. "Peşin say" (aynı gün) ya da sabit bir varsayılan (30 gün)
 * yazmak, hiç anlaşılmamış bir vadeyi anlaşılmış gibi gösterirdi — yaşlandırma
 * raporu o uydurma tarihe göre alacağı "gecikmiş" ilan ederdi.
 *
 * ⚠️ ÖN-DOLUMDUR, KİLİT DEĞİL: taslak `PATCH /invoices/:id` ile düzenlenebilir
 * ve panel fatura formu aynı değeri zaten öneriyor (`usePartyTermDays`).
 *
 * ⚠️ Hesap MUTLAK ANDIR (fabrika takvim günü DEĞİL): vade "fatura anı + N×24
 * saat" olarak yaşlandırma raporundaki formülle BİREBİR aynı yazılır — iki
 * yerde farklı yuvarlanırsa aynı fatura bir ekranda gecikmiş, diğerinde
 * gecikmemiş görünür ve bu notun kapattığı delik aynen geri açılır.
 */
export function deriveInvoiceDueDate(
  issueDate: Date,
  paymentTermDays: number | null | undefined,
): Date | null {
  if (paymentTermDays === null || paymentTermDays === undefined) return null;
  if (!Number.isFinite(paymentTermDays) || paymentTermDays < 0) return null;
  return new Date(issueDate.getTime() + paymentTermDays * DAY_MS);
}

// -----------------------------------------------------------------------------
// KUR
// -----------------------------------------------------------------------------

/**
 * Verilen güne (ya da öncesine) ait en yakın kuru döner.
 *
 * ⚠️ TL için DAİMA 1 — kur tablosunda TRY satırı ARANMAZ. Aranırsa ve satır
 * yoksa uç 400 verir; TL fatura kesmek için kur girmeyi zorunlu kılmak
 * anlamsızdır.
 *
 * ⚠️ Kur bulunamazsa `null` döner ve ÇAĞIRAN karar verir. Sessizce 1'e düşmek,
 * 1000 USD'lik faturayı 1000 TL olarak deftere yazardı — hata da log da
 * çıkmadan, ve ay sonunda bakiye 30 kat yanlış olurdu.
 */
export async function resolveExchangeRateTx(
  tx: Prisma.TransactionClient,
  currency: Currency,
  onDate: Date,
): Promise<Prisma.Decimal | null> {
  if (currency === "TRY") return D(1);
  const row = await tx.exchangeRate.findFirst({
    where: { currency, rateDate: { lte: onDate } },
    orderBy: { rateDate: "desc" },
    select: { rate: true },
  });
  return row ? D(row.rate) : null;
}

// -----------------------------------------------------------------------------
// CARİ LAZY AÇILIŞI
// -----------------------------------------------------------------------------

/**
 * Müşteri/fason için cari hesabı GEREKTİĞİNDE açar.
 *
 * ⚠️ Neden lazy: 200 müşterinin çoğunun cari hareketi yok. Hepsine boş hesap
 * açmak, cari listesini "hiç işlem görmemiş 190 satır" ile doldurup gerçek
 * bakiyeleri görünmez yapardı.
 *
 * ⚠️ Yarış: iki eşzamanlı fatura aynı müşteri için cari açmaya çalışabilir.
 * `customerId` üzerindeki partial unique bunu yapısal olarak engeller; burada
 * P2002'yi yakalayıp MEVCUDU okuruz (upsert kullanılmıyor çünkü `kind` ve
 * taraf kolonunun tutarlılığını CHECK constraint zaten garanti ediyor ve
 * upsert'in update dalı burada anlamsız — cari alanları bu yoldan güncellenmez).
 */
export type CariAccountParty = { customerId?: string | null; subcontractorId?: string | null };

/** Cari hesabın TEK ADRESİ karttır: fason bacağı `resolvePartyToCardTx` ile bağlı kartına çözülür (kopya yok). */
/**
 * Müşteri kartından cari hesabın kimliği — SALT OKUNUR (yaratmaz). Okuma uçları (açık fatura listesi) hesap açmasın:
 * hesap ilk fatura/ödemeyle doğar (`ensureCariAccountTx`); yoksa "açık fatura yok" doğru cevaptır. Aynı `where`.
 */
export async function findCariAccountIdByCustomer(customerId: string): Promise<string | null> {
  const row = await prisma.cariAccount.findFirst({ where: { customerId }, select: { id: true } });
  return row?.id ?? null;
}

/**
 * KART → HESAP tek çözücü (cari kart ↔ hesap birleşimi Z-A): kartın kendi hesabı YA DA kartın fason
 * profiline eski bacaktan bağlı hesap (göç öncesi kayıt). Yaratmaz — okuma yolu; doğuş `ensureCariAccountTx`.
 * Fatura/ödeme formu hesabı kod aramasıyla (`kind === party`) DEĞİL bu yolla bulur.
 */
/** Kartın hesap terimleri (Z-A opt-in DTO) — okuma tek yerden; hesap yoksa null. */
export async function readCariTermsByCustomer(customerId: string): Promise<{ id: string; paymentTermDays: number | null; defaultCurrency: Currency; taxOffice: string | null; riskLimit: Prisma.Decimal | null; isActive: boolean } | null> {
  const ref = await resolveCariAccountByCustomerTx(prisma, customerId);
  if (!ref) return null;
  return prisma.cariAccount.findUniqueOrThrow({ where: { id: ref.id }, select: { id: true, paymentTermDays: true, defaultCurrency: true, taxOffice: true, riskLimit: true, isActive: true } });
}

export async function resolveCariAccountByCustomerTx(
  db: Pick<typeof prisma, "cariAccount">,
  customerId: string,
): Promise<{ id: string; isActive: boolean } | null> {
  const row = await db.cariAccount.findFirst({
    where: { OR: [{ customerId }, { subcontractor: { customerId } }] },
    orderBy: { customerId: "desc" },
    select: { id: true, isActive: true },
  });
  return row ?? null;
}

export async function ensureCariAccountTx(
  tx: Prisma.TransactionClient,
  party: CariAccountParty,
): Promise<{ id: string; defaultCurrency: Currency }> {
  if ((party.customerId == null) === (party.subcontractorId == null)) {
    throw AppError.badRequest("Cari hesap için müşteri VEYA fason firma verilmeli (ikisi birden değil).");
  }
  const { customerId, subcontractorId } = await resolvePartyToCardTx(tx, party);

  const where = customerId ? { customerId } : { subcontractorId: subcontractorId as string };
  const existing = await tx.cariAccount.findFirst({
    where,
    select: { id: true, defaultCurrency: true, isActive: true },
  });
  if (existing) {
    if (!existing.isActive) {
      throw AppError.conflict("Bu carinin hesabı pasif durumda — önce Cari Hesaplar ekranından aktifleştirin.");
    }
    return { id: existing.id, defaultCurrency: existing.defaultCurrency };
  }

  try {
    const created = await tx.cariAccount.create({
      data: {
        kind: customerId ? CariKind.CUSTOMER : CariKind.SUBCONTRACTOR,
        customerId,
        subcontractorId,
      },
      select: { id: true, defaultCurrency: true },
    });
    return created;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await tx.cariAccount.findFirstOrThrow({
        where,
        select: { id: true, defaultCurrency: true },
      });
      return again;
    }
    throw e;
  }
}

/**
 * Cari bakiyesini ATOMİK olarak günceller (defter satırıyla AYNI tx'te).
 *
 * ⚠️ `upsert` + `increment`: okuyup-yazmak (read → compute → update) iki
 * eşzamanlı faturada birinin etkisini sessizce YUTAR. Denormalize alanın DB
 * seddi yok; tek koruma budur + `test_consistency` mutabakatı.
 *
 * Bakiye işareti: POZİTİF = cari BİZE borçlu (alacağımız). Borç kolonu artırır,
 * alacak kolonu azaltır.
 */
export async function applyCariBalanceTx(
  tx: Prisma.TransactionClient,
  cariId: string,
  currency: Currency,
  delta: Prisma.Decimal,
): Promise<void> {
  await tx.cariBalance.upsert({
    where: { cariId_currency: { cariId, currency } },
    create: { cariId, currency, balance: delta },
    update: { balance: { increment: delta } },
  });
}
