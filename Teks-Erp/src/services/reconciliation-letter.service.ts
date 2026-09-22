// =============================================================================
// CARİ MUTABAKAT MEKTUBU SERVİSİ (2026-08-15, J2 #18)
// =============================================================================
// "Şu tarih itibarıyla defterlerimizde bakiyeniz şudur, mutabık mısınız?" diye
// karşı tarafa giden, imzalanıp geri gelmesi beklenen RESMİ belge.
//
// ⚠️ DEFTERE HİÇBİR ŞEY YAZMAZ. Ne `CariTransaction`, ne `CariBalance`, ne
// kasa/banka. Mektup bir OKUMA'nın fotoğrafıdır. Bu yüzden dönem kilidi
// (`assertPeriodOpenTx`) de aranmaz: kapanmış bir dönemin mutabakatını kesmek
// tam da o dönemin ilan edilmiş rakamını karşı tarafa sormaktır — engellenecek
// bir şey değil, mühürün amacıdır.
//
// ⚠️ BAKİYE `cari_balances`TAN OKUNMAZ, DEFTERDEN TÜRETİLİR (Sınıf 5). Sebep
// yapısal: `CariBalance` BUGÜNKÜ bakiyedir, `asOf` ise KEYFİ bir gündür
// ("31 Temmuz itibarıyla mutabakat" olağandır). Denormalize alanı okumak,
// geçmişe dönük her mektuba sessizce bugünün rakamını basardı — hata yok, log
// yok, yalnız yanlış bir resmi belge.
//
// ⚠️⚠️ DÖNEM MÜHRÜNDEN (`CariPeriodClose`) DE OKUNMAZ — ve bu, ekstre devrinin
// (`periodCloseService.resolveStatementOpening`) BİLİNÇLİ olarak farklı davrandığı
// tek yerdir. Soruldu (2026-08-15 çapraz incelemesi: "ekstre mühürden okuyor,
// mektup ham defterden; aynı ekranda iki rakam") ve mühre bağlanmadı, üç sebeple:
//   ① MÜHÜR BU BELGENİN İSTEDİĞİ VERİYİ TAŞIMIYOR. `CariPeriodClose` yalnız NET
//      `closingBalance` saklar; mektup ise BORÇ | ALACAK | BAKİYE üçlüsünü basar.
//      Bakiyeyi mühürden, borç/alacağı defterden almak, KENDİ ARİTMETİĞİ TUTMAYAN
//      bir resmi kâğıt üretirdi (borç − alacak ≠ bakiye) — sessiz bir farktan
//      açıkça daha kötüdür.
//   ② KESİT KEYFÎ, MÜHÜR DEĞİL. `asOf` herhangi bir gündür; mühür yalnız kapatılan
//      dönemin son gününde ve yalnız kapatılan PARA BİRİMLERİ için vardır. Mektup
//      "hangi para birimlerinde hareket var" sorusunu da defterden öğrenir.
//   ③ İKİSİ AYRI SORU SORUYOR. Devir "ilan ettiğimiz rakamdan devam et" der
//      (sunum kestirmesi); mektup "defterimiz BUGÜN ne diyor, mutabık mısınız"
//      diye sorar — karşı taraf detay isterse gösterilecek şey defterin kendisidir.
//      Kapanıştan sonra geçmişe satır sızmışsa iki rakam ayrışır; o bir MEKTUP
//      HATASI değil, `periodCloseService.verify`in adı konmuş alarmıdır ve doğru
//      tepki mektuba sahte bir rakam bastırmak değil, mührü onarmaktır.
// Bekçi bu kararı KİLİTLER (`test_official_finance_docs` §12): bilerek YANLIŞ bir
// mühür kurulup mektubun yine defter gerçeğini bastığı ölçülür.
//
// ⚠️ SIFIR BAKİYELİ AMA HAREKETLİ PARA BİRİMİ DE SATIRDIR. "Borç 5.000 · Alacak
// 5.000 · Bakiye 0" satırını gizlemek, karşı tarafın o para birimindeki
// hareketleri hiç görmemesi demektir — oysa mutabakatın konusu tam olarak
// hareketlerin karşılıklı tutmasıdır. `groupBy` bunu doğal olarak üretir;
// filtrelemiyoruz ve filtrelenmemesi bekçide kilitli.
//
// ⚠️ `clientToken` YOK (bilinçli, J2 #18 kararı). Kayıt-yaratan uç sözleşmesinin
// gerekçesi "timeout-retry'de mükerrer KAYIT" riskidir; buradaki kayıt para,
// stok ya da defter oynatmaz — mükerrer kopyanın maliyeti boşa giden bir belge
// numarasıdır ve `cancel` tek adımda kapatır. Ayrıca mektup ekrandaki bir
// SEÇİMDEN (cari + tarih) doğar; KK1 gibi bir seri-giriş kuyruğu yoktur.
// İstenirse eklenmesi tek nullable kolon + partial unique index'tir ve o zaman
// replay yanıtı `payment.create` gibi BİREBİR aynı şekli döndürmelidir.
// =============================================================================
import { Currency, Prisma, PrintedDocType, ReconciliationLetterStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { formatSeriesCode, resolveSeriesFormat, seriesPrefix, seriesSeqFrom } from "./number-series.service";
import { D } from "./helpers/finance.helper";
import { printedDocumentService, registerPrintedDocBuilder } from "./printed-document.service";
import {
  renderReconciliationLetterHtml,
  type ReconciliationLetterDoc,
  type ReconciliationBalanceRow,
} from "./document-render/finance-doc.html";
import type { PrintedDocDb } from "./printed-document.service";
import type { ApiResponse } from "../types/api.types";

/** Mutabakat mektubu ön eki — MBT + GGAAYY + NNNN. */
const DOC_PREFIX = "MBT";

/**
 * Günlük sıralı belge numarası.
 *
 * ⚠️ `orderBy` ile DEĞİL, JS'te sayısal max ile (glibc collation lexicographic
 * ve sıra 9→10 geçişinde bozulur — `nextInvoiceNoTx` kanıtlı deseni). Çağıran
 * `withBarcodeRetry` ile sarmalar: yarışta P2002 hâlâ mümkündür ve doğru cevap
 * tekrar denemektir.
 *
 * ⚠️ ÇIPA DÜZENLEME GÜNÜDÜR, `asOf` DEĞİL: `asOf` belgenin İÇERİĞİ (bakiye
 * kesiti), numaranın GGAAYY'si ise belgenin KESİLDİĞİ gün. Geçmişe dönük bir
 * kesit için geçmiş tarihli numara üretmek, bugün kesilen kâğıdı geçmişe
 * yazmak olurdu.
 */
async function nextLetterNo(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  const fmt = resolveSeriesFormat("reconciliationLetter");
  const full = seriesPrefix(fmt, date);
  const rows = await tx.reconciliationLetter.findMany({
    where: { docNo: { gte: full, startsWith: full } },
    select: { docNo: true },
  });
  return formatSeriesCode(fmt, seriesSeqFrom(fmt, rows.map((r) => r.docNo), full), date);
}

/**
 * PARA BİRİMİ SIRASI — `Currency` enum'unun BEYAN sırası (TRY, USD, EUR, GBP…).
 *
 * ⚠️ Sıra deterministik olmak ZORUNDA: aynı mektup iki kez üretildiğinde
 * (önizleme + revizyon) satırlar yer değiştirirse belge "değişmiş" görünür ve
 * karşılaştırma imkânsızlaşır. `groupBy` sırası garanti edilmez.
 */
const CURRENCY_ORDER: Currency[] = Object.values(Currency);

export interface CariBalanceSnapshotRow {
  currency: Currency;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  /** BORÇ − ALACAK. POZİTİF = cari BİZE borçlu. */
  balance: Prisma.Decimal;
}

/**
 * Cari defterin `asOf` ANINDAKİ para birimi bazlı fotoğrafı.
 *
 * TEK KAYNAK: builder da, "önizleme" de, bekçi de bunu çağırır. Kopyalansaydı
 * bir gün biri `lte` yerine `lt` yazar ve mektup ile ekran aynı cari için farklı
 * rakam söylerdi.
 *
 * ⚠️ `txnDate <= asOf` — DAHİL. `asOf` bir GÜN SONU çıpasıdır ve "31 Temmuz
 * itibarıyla" denince 31 Temmuz'un hareketleri DAHİLDİR.
 *
 * ⚠️ ÇIPAYI SINIR KATMANI GARANTİ EDER, İSTEMCİ DEĞİL: `reconciliation-letter
 * .routes` gün-yalnız bir `asOf`u (`2026-07-31`) `resolveRangeEnd` ile o günün
 * SONUNA çözer. Eskiden yalnız Electron'un `dayEndIso` göndermesine güveniliyordu;
 * ham `new Date("2026-07-31")` UTC gece yarısıdır ve ikinci bir istemci (mobil,
 * script, Swagger) o günün hareketlerini SESSİZCE düşürerek DONMUŞ bir resmi
 * belge üretirdi. Bu fonksiyona başka bir yerden `asOf` geçirirken aynı çözümü
 * uygula — `new Date(<gün>)` yazma.
 */
export async function deriveCariBalancesAsOf(
  db: PrintedDocDb,
  cariId: string,
  asOf: Date,
): Promise<CariBalanceSnapshotRow[]> {
  const grouped = await db.cariTransaction.groupBy({
    by: ["currency"],
    where: { cariId, txnDate: { lte: asOf } },
    _sum: { debit: true, credit: true },
  });

  return grouped
    .map((g) => {
      const debit = D(g._sum.debit ?? 0);
      const credit = D(g._sum.credit ?? 0);
      return { currency: g.currency, debit, credit, balance: debit.minus(credit) };
    })
    .sort((a, b) => CURRENCY_ORDER.indexOf(a.currency) - CURRENCY_ORDER.indexOf(b.currency));
}

export interface CreateReconciliationLetterInput {
  cariId: string;
  /** Bakiye kesiti — verilmezse ŞİMDİ. */
  asOf?: Date;
  notes?: string | null;
}

export class ReconciliationLetterService {
  /**
   * Mutabakat mektubu keser ve belgeyi AYNI transaction'da dondurur.
   *
   * ⚠️ FREEZE TX'İN İÇİNDE (makbuz emsali): kayıt ile resmi belge ya birlikte
   * doğar ya hiç. Dışarıda dondurmak, "mektup var ama kâğıdı yok" satırları
   * üretirdi ve bunu ancak biri basmaya çalışınca fark ederdik.
   */
  async create(
    input: CreateReconciliationLetterInput,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const asOf = input.asOf ?? new Date();
    // Düzenleme anı — belge numarasının çıpası (asOf DEĞİL, yukarıdaki nota bak).
    const issuedAt = new Date();

    const result = await withBarcodeRetry(async () =>
      prisma.$transaction(async (tx) => {
        const cari = await tx.cariAccount.findUnique({
          where: { id: input.cariId },
          select: { id: true, isActive: true },
        });
        if (!cari) throw AppError.badRequest("Cari hesap bulunamadı.");
        // ⚠️ Pasif cariye mutabakat kesilmez: pasifleştirme "bu kartla artık iş
        // yapılmıyor" kararıdır ve karşı tarafa imza için kâğıt göndermek onunla
        // çelişir. Gerçekten gerekiyorsa kart önce aktifleştirilir (yol açık).
        if (!cari.isActive) {
          throw AppError.conflict(
            "Bu carinin hesabı pasif durumda — mutabakat mektubu için önce Cari Hesaplar ekranından aktifleştirin.",
          );
        }

        const docNo = await nextLetterNo(tx, issuedAt);
        const letter = await tx.reconciliationLetter.create({
          data: {
            docNo,
            cariId: cari.id,
            asOf,
            notes: input.notes?.trim() || null,
            createdById: userId ?? null,
          },
          select: { id: true, docNo: true },
        });

        await printedDocumentService.freezeForSource(
          tx,
          PrintedDocType.RECONCILIATION_LETTER,
          letter.id,
          userId,
        );

        return letter;
      }),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "RECONCILIATION_LETTER",
      recordId: result.id,
      newData: { docNo: result.docNo, cariId: input.cariId, asOf: asOf.toISOString() },
    });
    return { success: true, data: result, message: `${result.docNo} düzenlendi.` };
  }

  /**
   * İptal — kayıt SİLİNMEZ, belge VOIDED'a çekilir (İPTAL filigranıyla basılır).
   *
   * ⚠️ ATOMİK CLAIM: `updateMany WHERE {id, status: ACTIVE}` — iki eşzamanlı
   * iptalden yalnız biri geçer. `findUnique → if → update` burada da yasak;
   * ikinci istek sessizce "başarılı" dönüp ikinci bir audit satırı yazardı.
   */
  async cancel(
    id: string,
    reason: string | undefined,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.reconciliationLetter.updateMany({
        where: { id, status: ReconciliationLetterStatus.ACTIVE },
        data: {
          status: ReconciliationLetterStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason?.trim() || null,
        },
      });
      if (claimed.count === 0) {
        const cur = await tx.reconciliationLetter.findUnique({
          where: { id },
          select: { docNo: true },
        });
        if (!cur) throw AppError.notFound("Mutabakat mektubu bulunamadı.");
        throw AppError.conflict(`${cur.docNo} zaten iptal edilmiş.`);
      }

      const row = await tx.reconciliationLetter.findUniqueOrThrow({
        where: { id },
        select: { id: true, docNo: true },
      });

      await printedDocumentService.voidForSource(
        tx,
        PrintedDocType.RECONCILIATION_LETTER,
        row.id,
        reason?.trim() || "Mutabakat mektubu iptal edildi",
      );
      return row;
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "RECONCILIATION_LETTER",
      recordId: id,
      newData: { event: "RECONCILIATION_LETTER_CANCELLED", docNo: result.docNo, reason },
    });
    return { success: true, data: result, message: `${result.docNo} iptal edildi.` };
  }

  /**
   * Liste — OFFSET sayfalama (cursor DEĞİL, bilinçli): mutabakat mektubu düşük
   * hacimli bir belgedir (cari başına yılda birkaç). Cursor'a geçirmek, yüz
   * binlerce satırlık tablolar için yazılmış bir aracı hiç ihtiyaç duymayan bir
   * yüzeye taşımaktı.
   */
  async list(params: {
    page?: number;
    pageSize?: number;
    cariId?: string;
    status?: ReconciliationLetterStatus;
    from?: Date;
    to?: Date;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const where: Prisma.ReconciliationLetterWhereInput = {};
    if (params.cariId) where.cariId = params.cariId;
    if (params.status) where.status = params.status;
    if (params.from || params.to) {
      where.createdAt = {
        ...(params.from ? { gte: params.from } : {}),
        ...(params.to ? { lte: params.to } : {}),
      };
    }
    if (params.search?.trim()) {
      where.docNo = { contains: params.search.trim(), mode: "insensitive" };
    }

    const [data, total] = await Promise.all([
      prisma.reconciliationLetter.findMany({
        where,
        select: {
          id: true,
          docNo: true,
          status: true,
          asOf: true,
          notes: true,
          createdAt: true,
          cari: {
            select: {
              id: true,
              customer: { select: { code: true, name: true } },
              subcontractor: { select: { code: true, name: true } },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.reconciliationLetter.count({ where }),
    ]);
    return {
      data,
      pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /**
   * Detay — satırlar CANLI türetilir (`asOf` sabit olduğu için normalde donmuş
   * belgeyle aynı çıkar). ⚠️ Resmi rakam DONMUŞ BELGEDEDİR; bu uç ekranda
   * göstermek içindir ve geçmişe tarihli bir hareket sonradan girilirse ikisi
   * ayrışabilir — o fark bir HATA değil, revizyon (`reissue`) sinyalidir.
   */
  async findById(id: string): Promise<ApiResponse<unknown>> {
    const row = await prisma.reconciliationLetter.findUnique({
      where: { id },
      select: {
        id: true,
        docNo: true,
        status: true,
        asOf: true,
        notes: true,
        createdAt: true,
        cancelledAt: true,
        cancelReason: true,
        cari: {
          select: {
            id: true,
            taxOffice: true,
            customer: { select: { code: true, name: true, taxNumber: true } },
            subcontractor: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!row) throw AppError.notFound("Mutabakat mektubu bulunamadı.");

    const balances = await deriveCariBalancesAsOf(prisma, row.cari.id, row.asOf);
    return {
      success: true,
      data: {
        ...row,
        balances: balances.map((b) => ({
          currency: b.currency,
          debit: b.debit.toString(),
          credit: b.credit.toString(),
          balance: b.balance.toString(),
        })),
      },
    };
  }
}

export const reconciliationLetterService = new ReconciliationLetterService();

// ---------------------------------------------------------------------------
// BELGE BUILDER — cari mutabakat mektubu
// ---------------------------------------------------------------------------
// ⚠️ Kayıt IMPORT YAN ETKİSİYLE oluşur (routes → bu servis). Bekçilerde import
// satırı yoksa registry boş kalır ve testler vakumen yeşile döner.

registerPrintedDocBuilder(PrintedDocType.RECONCILIATION_LETTER, {
  fresh: async (db, sourceId) => {
    const letter = await db.reconciliationLetter.findUnique({
      where: { id: sourceId },
      select: {
        id: true,
        docNo: true,
        asOf: true,
        notes: true,
        status: true,
        createdAt: true,
        createdById: true,
        cancelledAt: true,
        cancelReason: true,
        cari: {
          select: {
            id: true,
            taxOffice: true,
            customer: { select: { code: true, name: true, taxNumber: true } },
            subcontractor: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!letter) return null;

    const party = letter.cari.customer ?? letter.cari.subcontractor ?? null;
    // Vergi satırı: daire (cari kartında) + numara (müşteri kartında), ikisi de
    // opsiyonel — hiçbiri yoksa satır basılmaz. ⚠️ Vergi NUMARASI yalnız
    // `Customer`da var; fason firma tarafında alan YOK (şema gerçeği), o yüzden
    // fason carisinde yalnız daire basılabilir.
    const taxInfo =
      [letter.cari.taxOffice, letter.cari.customer?.taxNumber].filter(Boolean).join(" · ") || null;

    const creator = letter.createdById
      ? await db.user.findUnique({
          where: { id: letter.createdById },
          select: { fullName: true, username: true },
        })
      : null;

    const balances = await deriveCariBalancesAsOf(db, letter.cari.id, letter.asOf);
    const rows: ReconciliationBalanceRow[] = balances.map((b) => ({
      currency: b.currency,
      debit: b.debit.toString(),
      credit: b.credit.toString(),
      balance: b.balance.toString(),
    }));

    const doc: ReconciliationLetterDoc = {
      header: {
        documentNo: letter.docNo,
        date: letter.createdAt.toISOString(),
        asOf: letter.asOf.toISOString(),
        partyName: party?.name ?? "—",
        partyCode: party?.code ?? null,
        partyTaxInfo: taxInfo,
        createdBy: creator?.fullName ?? creator?.username ?? null,
      },
      balances: rows,
      notes: letter.notes,
    };

    return {
      documentNo: letter.docNo,
      doc: doc as unknown as Record<string, unknown>,
      voidInfo:
        letter.status === ReconciliationLetterStatus.CANCELLED
          ? { reason: letter.cancelReason, at: letter.cancelledAt ?? new Date() }
          : null,
    };
  },
  renderHtml: renderReconciliationLetterHtml,
});
