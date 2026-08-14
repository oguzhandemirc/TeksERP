// =============================================================================
// DÖNEM KAPANIŞI SERVİSİ — cari bazlı kapanış fotoğrafı (C3)
// =============================================================================
// "31.12.2025 itibarıyla bu carinin TRY bakiyesi 15.000 TL'dir" — kapanış budur.
//
// ── KAPANIŞ BİR FOTOĞRAFTIR, HAREKET DEĞİL ──────────────────────────────────
// `cari_transactions`'a satır YAZMAZ. Yazsaydı bir sonraki ekstre aynı tutarı
// İKİ KEZ sayardı: bir kez devir satırı olarak, bir kez de o devri oluşturan
// hareketler olarak. Muhasebe programlarında "devir fişi" diye bir kayıt
// görülmesinin sebebi hesap planı bazlı kapanıştır (gelir/gider hesapları
// sıfırlanır); CARİ hesapta bakiye devam eder ve kapanış yalnız bir MÜHÜRDÜR.
//
// ── KAYNAK DEFTER APPEND-ONLY → KAPANIŞ HER AN YENİDEN TÜRETİLEBİLİR ────────
// Bu yüzden kapanış satırı "gerçeğin kaynağı" değil, gerçeğin O ANDAKİ
// ÖLÇÜMÜDÜR. `txnCount` de tam bunun için saklanır: yeniden türetildiğinde
// tutmuyorsa defter kapanıştan sonra değişmiş demektir (bkz. `verify`).
//
// ── ÜÇ SEDDİN İŞ BÖLÜMÜ ─────────────────────────────────────────────────────
//   1. `assertPeriodOpenTx` (helper) — kapalı döneme YAZMAYI engeller.
//   2. Bu servisteki advisory lock — kapanış ANINDA araya yazma girmesini
//      engeller (fotoğraf ile defter ayrışmasın).
//   3. `verify` — yine de ayrışma olduysa GÖRÜNÜR kılar (sessiz drift yok).
// =============================================================================

import { Prisma, Currency } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { D, D0 } from "./helpers/finance.helper";
import {
  lockCariPeriodScopeTx,
  periodDayKey,
  periodEndCutExclusive,
  formatDayKeyTr,
} from "./helpers/period-guard.helper";
import type { ApiResponse } from "../types/api.types";

/** Bir dönemin ölçülmüş fotoğrafı — hem önizleme hem doğrulama bunu döner. */
export interface PeriodSnapshot {
  /** Kapanışın kapsadığı son takvim günü (dahil), `@db.Date` anahtarı. */
  periodEnd: Date;
  /** Kapanışın kapsadığı son ANIN dış sınırı — `txnDate < cut`. */
  cut: Date;
  closingBalance: Prisma.Decimal;
  txnCount: number;
  totalDebit: Prisma.Decimal;
  totalCredit: Prisma.Decimal;
}

export interface PeriodCloseRow {
  id: string;
  cariId: string;
  cariName: string;
  cariCode: string;
  currency: Currency;
  periodEnd: Date;
  closingBalance: Prisma.Decimal;
  txnCount: number;
  notes: string | null;
  closedById: string | null;
  createdAt: Date;
  reopenedAt: Date | null;
  reopenedById: string | null;
  reopenReason: string | null;
}

const CARI_PARTY_SELECT = {
  customer: { select: { code: true, name: true } },
  subcontractor: { select: { code: true, name: true } },
} as const;

type CariPartyRow = {
  customer: { code: string; name: string } | null;
  subcontractor: { code: string; name: string } | null;
};

function partyLabel(cari: CariPartyRow): { code: string; name: string } {
  const p = cari.customer ?? cari.subcontractor;
  // CHECK constraint gereği daima biri dolu; bu dal yalnız tip daraltması.
  return p ? { code: p.code, name: p.name } : { code: "—", name: "—" };
}

/**
 * Bir (cari, para birimi) için `cut` anına kadarki defter fotoğrafını ölçer.
 *
 * ⚠️ TEK ÖLÇÜM NOKTASI: önizleme, kapanış ve doğrulama üçü de buradan geçer.
 * Kopyalansaydı önizlemenin gösterdiği rakam ile kaydedilen rakam bir gün
 * ayrışırdı — ve ayrışmayı kimse fark etmezdi, çünkü ikisi de "doğru görünen"
 * sayılardır.
 */
async function measureTx(
  tx: Prisma.TransactionClient,
  cariId: string,
  currency: Currency,
  periodEnd: Date,
): Promise<PeriodSnapshot> {
  const cut = periodEndCutExclusive(periodEnd);
  const agg = await tx.cariTransaction.aggregate({
    where: { cariId, currency, txnDate: { lt: cut } },
    _sum: { debit: true, credit: true },
    _count: true,
  });
  const totalDebit = D(agg._sum.debit ?? 0);
  const totalCredit = D(agg._sum.credit ?? 0);
  return {
    periodEnd,
    cut,
    // POZİTİF = cari BİZE borçlu (`applyCariBalanceTx` sözleşmesiyle aynı yön).
    closingBalance: totalDebit.minus(totalCredit),
    txnCount: agg._count,
    totalDebit,
    totalCredit,
  };
}

export class PeriodCloseService {
  /**
   * ÖNİZLEME — hiçbir şey yazmaz.
   *
   * Kapanış geri alınabilir ama UCUZ DEĞİLDİR (iz bırakır, denetimde sorulur):
   * kullanıcı hangi rakamı mühürlediğini ÖNCE görmelidir.
   */
  async preview(params: {
    cariId: string;
    currency: Currency;
    periodEnd: Date;
  }): Promise<
    ApiResponse<
      PeriodSnapshot & {
        alreadyClosed: boolean;
        blockingClose: { id: string; periodEnd: Date; closingBalance: Prisma.Decimal } | null;
        previousClose: { id: string; periodEnd: Date; closingBalance: Prisma.Decimal } | null;
      }
    >
  > {
    const dayKey = periodDayKey(params.periodEnd);
    await this.assertCariExists(params.cariId);

    // Önizleme kilit ALMAZ — salt okuma ve rakam zaten "şu anki tahmin"dir.
    const snap = await measureTx(prisma, params.cariId, params.currency, dayKey);

    const blocking = await prisma.cariPeriodClose.findFirst({
      where: { cariId: params.cariId, currency: params.currency, reopenedAt: null, periodEnd: { gte: dayKey } },
      orderBy: { periodEnd: "asc" },
      select: { id: true, periodEnd: true, closingBalance: true },
    });
    const previous = await prisma.cariPeriodClose.findFirst({
      where: { cariId: params.cariId, currency: params.currency, reopenedAt: null, periodEnd: { lt: dayKey } },
      orderBy: { periodEnd: "desc" },
      select: { id: true, periodEnd: true, closingBalance: true },
    });

    return {
      success: true,
      data: {
        ...snap,
        alreadyClosed: blocking != null && blocking.periodEnd.getTime() === dayKey.getTime(),
        blockingClose: blocking,
        previousClose: previous,
      },
    };
  }

  /**
   * DÖNEMİ KAPAT.
   *
   * ⚠️ GELECEK DÖNEM KAPATILAMAZ. Teknik olarak mümkündü ve sonucu felaketti:
   * 31.12.2026 kapatılırsa BUGÜNKÜ her fatura/tahsilat 409 alır ve muhasebeci
   * "sistem çalışmıyor" der. Kapanış geçmişi mühürlemek içindir.
   *
   * ⚠️ SIRALI: yeni kapanış, mevcut aktif kapanıştan İLERİ olmak zorunda.
   * Aksi halde "31.12.2025 kapalıyken 30.11.2025'i kapatmak" gibi anlamsız bir
   * iç içe geçme doğar ve `previousClose` zinciri (ekstre devrinin dayandığı
   * şey) belirsizleşir.
   */
  async close(
    input: {
      cariId: string;
      currency: Currency;
      periodEnd: Date;
      notes?: string | null;
    },
    userId?: string,
  ): Promise<ApiResponse<{ id: string; periodEnd: Date; closingBalance: Prisma.Decimal; txnCount: number }>> {
    const dayKey = periodDayKey(input.periodEnd);
    const today = periodDayKey(new Date());
    if (dayKey.getTime() > today.getTime()) {
      throw AppError.badRequest(
        `Gelecek bir dönem kapatılamaz (${formatDayKeyTr(dayKey)}). Kapanış yalnız BİTMİŞ dönemler için yapılır.`,
      );
    }
    await this.assertCariExists(input.cariId);

    const created = await prisma.$transaction(async (tx) => {
      // ⚠️ TX'İN İLK İFADESİ: fotoğraf ile araya girecek defter yazımı
      // serileşsin. `assertPeriodOpenTx` AYNI kilidi alır — yani ölçüm sırasında
      // bu (cari, para birimi) için yeni satır COMMIT EDİLEMEZ.
      await lockCariPeriodScopeTx(tx, input.cariId, input.currency);

      // Kilit ALTINDA taze okuma (check-then-act değil).
      const blocking = await tx.cariPeriodClose.findFirst({
        where: { cariId: input.cariId, currency: input.currency, reopenedAt: null, periodEnd: { gte: dayKey } },
        orderBy: { periodEnd: "asc" },
        select: { periodEnd: true },
      });
      if (blocking) {
        throw AppError.conflict(
          blocking.periodEnd.getTime() === dayKey.getTime()
            ? `${formatDayKeyTr(dayKey)} dönemi (${input.currency}) zaten kapalı.`
            : `Daha ileri bir kapanış var (${formatDayKeyTr(blocking.periodEnd)}) — ${formatDayKeyTr(dayKey)} zaten onun içinde kapalı sayılır.`,
        );
      }

      const snap = await measureTx(tx, input.cariId, input.currency, dayKey);

      try {
        return await tx.cariPeriodClose.create({
          data: {
            cariId: input.cariId,
            currency: input.currency,
            periodEnd: dayKey,
            closingBalance: snap.closingBalance,
            txnCount: snap.txnCount,
            notes: input.notes?.trim() || null,
            closedById: userId ?? null,
          },
          select: { id: true, periodEnd: true, closingBalance: true, txnCount: true },
        });
      } catch (e) {
        // Partial unique (`cari_period_close_active_uq`) — advisory kilit aynı
        // anahtarı serileştirdiği için pratikte ulaşılmaz; yine de sessiz 500
        // yerine anlamlı 409 verilir (kilit bir gün kaldırılırsa tek sed budur).
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw AppError.conflict(`${formatDayKeyTr(dayKey)} dönemi (${input.currency}) zaten kapalı.`);
        }
        throw e;
      }
    });

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "CARI_PERIOD_CLOSE",
      recordId: created.id,
      newData: {
        cariId: input.cariId,
        currency: input.currency,
        periodEnd: formatDayKeyTr(created.periodEnd),
        closingBalance: created.closingBalance.toString(),
        txnCount: created.txnCount,
      },
    });

    return {
      success: true,
      data: created,
      message: `${formatDayKeyTr(created.periodEnd)} dönemi kapatıldı (${input.currency}).`,
    };
  }

  /**
   * DÖNEMİ YENİDEN AÇ — satır SİLİNMEZ, işaretlenir.
   *
   * ⚠️ İz denetimde tam olarak aranan şeydir: "bu dönem bir kez kapandı, sonra
   * açıldı, gerekçesi şu". Satırı silmek o soruyu cevapsız bırakırdı.
   *
   * ⚠️ LIFO — daha YENİ bir aktif kapanış varken eski dönem açılamaz. Sebep
   * yalnız muhasebe geleneği değil, MEKANİK: guard "gün <= periodEnd" ile
   * kapsadığı için Aralık'ı açsanız da Ocak kapanışı Aralık'a yazmayı hâlâ
   * engellerdi. Kullanıcı "açtım ama yine yazamıyorum" derdi — sessiz değil,
   * ama anlamsız bir durum.
   */
  async reopen(
    id: string,
    reason: string,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; periodEnd: Date }>> {
    const trimmed = reason?.trim() ?? "";
    if (trimmed.length < 3) {
      throw AppError.badRequest("Yeniden açma gerekçesi zorunlu (en az 3 karakter) — kapanış izi gerekçesiyle anlamlıdır.");
    }

    const row = await prisma.cariPeriodClose.findUnique({
      where: { id },
      select: { id: true, cariId: true, currency: true, periodEnd: true },
    });
    if (!row) throw AppError.notFound("Dönem kapanışı bulunamadı.");

    const result = await prisma.$transaction(async (tx) => {
      await lockCariPeriodScopeTx(tx, row.cariId, row.currency);

      const later = await tx.cariPeriodClose.findFirst({
        where: {
          cariId: row.cariId,
          currency: row.currency,
          reopenedAt: null,
          periodEnd: { gt: row.periodEnd },
        },
        orderBy: { periodEnd: "desc" },
        select: { periodEnd: true },
      });
      if (later) {
        throw AppError.conflict(
          `Önce daha yeni kapanışı açın (${formatDayKeyTr(later.periodEnd)}). ` +
            `O kapanış duruyorken ${formatDayKeyTr(row.periodEnd)} dönemine yine yazılamaz.`,
        );
      }

      // ATOMİK CLAIM — `findUnique → if → update` değil.
      const claimed = await tx.cariPeriodClose.updateMany({
        where: { id, reopenedAt: null },
        data: { reopenedAt: new Date(), reopenedById: userId ?? null, reopenReason: trimmed },
      });
      if (claimed.count === 0) {
        throw AppError.conflict(`${formatDayKeyTr(row.periodEnd)} kapanışı zaten yeniden açılmış.`);
      }
      return { id, periodEnd: row.periodEnd };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CARI_PERIOD_CLOSE",
      recordId: id,
      oldData: { reopenedAt: null },
      newData: { reopenedAt: new Date().toISOString(), reopenReason: trimmed, periodEnd: formatDayKeyTr(row.periodEnd) },
    });

    return {
      success: true,
      data: result,
      message: `${formatDayKeyTr(row.periodEnd)} dönemi yeniden açıldı — bu işlem iz bıraktı.`,
    };
  }

  /**
   * DOĞRULAMA — kapanışı BUGÜN yeniden türetip fotoğrafla karşılaştırır.
   *
   * `txnCount` şemaya tam bu iş için kondu ("kontrol toplamı"). Drift varsa
   * ya guard bir yerden atlandı ya da satır DB'ye elle yazıldı; ikisi de
   * sessiz kalmamalı. Salt okuma — hiçbir şeyi DÜZELTMEZ (kapanmış resmi
   * rakamı sessizce tazelemek bu modülün reddettiği tek şeydir).
   */
  async verify(id: string): Promise<
    ApiResponse<{
      id: string;
      periodEnd: Date;
      stored: { closingBalance: Prisma.Decimal; txnCount: number };
      derived: { closingBalance: Prisma.Decimal; txnCount: number };
      drift: boolean;
      balanceDelta: Prisma.Decimal;
      countDelta: number;
    }>
  > {
    const row = await prisma.cariPeriodClose.findUnique({
      where: { id },
      select: { id: true, cariId: true, currency: true, periodEnd: true, closingBalance: true, txnCount: true },
    });
    if (!row) throw AppError.notFound("Dönem kapanışı bulunamadı.");

    const snap = await measureTx(prisma, row.cariId, row.currency, row.periodEnd);
    const balanceDelta = snap.closingBalance.minus(D(row.closingBalance));
    const countDelta = snap.txnCount - row.txnCount;

    return {
      success: true,
      data: {
        id: row.id,
        periodEnd: row.periodEnd,
        stored: { closingBalance: row.closingBalance, txnCount: row.txnCount },
        derived: { closingBalance: snap.closingBalance, txnCount: snap.txnCount },
        drift: !balanceDelta.isZero() || countDelta !== 0,
        balanceDelta,
        countDelta,
      },
    };
  }

  /** Kapanış geçmişi. Varsayılan: yalnız AKTİF kapanışlar. */
  async list(params: {
    cariId?: string;
    currency?: Currency;
    /** Yeniden açılmışlar da gelsin mi — denetim görünümü. */
    includeReopened?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<{
    data: PeriodCloseRow[];
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));

    const where: Prisma.CariPeriodCloseWhereInput = {};
    if (params.cariId) where.cariId = params.cariId;
    if (params.currency) where.currency = params.currency;
    if (!params.includeReopened) where.reopenedAt = null;

    const [rows, total] = await Promise.all([
      prisma.cariPeriodClose.findMany({
        where,
        // En yeni kapanış en üstte — muhasebecinin aradığı "en son nereyi
        // kapattık" sorusu. `periodEnd` ile sıralanır (createdAt DEĞİL: geçmiş
        // bir dönem sonradan kapatılmış olabilir).
        orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          cariId: true,
          currency: true,
          periodEnd: true,
          closingBalance: true,
          txnCount: true,
          notes: true,
          closedById: true,
          createdAt: true,
          reopenedAt: true,
          reopenedById: true,
          reopenReason: true,
          cari: { select: CARI_PARTY_SELECT },
        },
      }),
      prisma.cariPeriodClose.count({ where }),
    ]);

    return {
      data: rows.map((r) => {
        const p = partyLabel(r.cari);
        return {
          id: r.id,
          cariId: r.cariId,
          cariCode: p.code,
          cariName: p.name,
          currency: r.currency,
          periodEnd: r.periodEnd,
          closingBalance: r.closingBalance,
          txnCount: r.txnCount,
          notes: r.notes,
          closedById: r.closedById,
          createdAt: r.createdAt,
          reopenedAt: r.reopenedAt,
          reopenedById: r.reopenedById,
          reopenReason: r.reopenReason,
        };
      }),
      pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /**
   * "Bu cari bu para biriminde nereye kadar kapalı" — ekranın kilit rozeti.
   * Kapanış yoksa `null` (ve bu bir hata DEĞİLDİR: kapanış opsiyoneldir).
   */
  async status(params: {
    cariId: string;
    currency: Currency;
  }): Promise<ApiResponse<{ closedThrough: Date | null; closingBalance: Prisma.Decimal | null; closeId: string | null }>> {
    const row = await prisma.cariPeriodClose.findFirst({
      where: { cariId: params.cariId, currency: params.currency, reopenedAt: null },
      orderBy: { periodEnd: "desc" },
      select: { id: true, periodEnd: true, closingBalance: true },
    });
    return {
      success: true,
      data: {
        closedThrough: row?.periodEnd ?? null,
        closingBalance: row?.closingBalance ?? null,
        closeId: row?.id ?? null,
      },
    };
  }

  /**
   * EKSTRE DEVRİ — ÜÇ ADIM.
   *
   *   1. `from`'dan ÖNCE biten en yeni AKTİF kapanışı bul  → mühürlü rakam
   *   2. o kapanışın bitiş anından `from`'a kadarki hareketleri topla
   *   3. ikisini topla                                      → dönem devri
   *
   * ⚠️ KAPANIŞ HİÇ YOKSA BUGÜNKÜ YOL BAYT-BAYT: tüm geçmişin tek aggregate'i.
   * Kapanış OPSİYONELDİR — kullanmayan kurulumun ekstresi tek satır bile
   * değişmemeli.
   *
   * ⚠️ MATEMATİKSEL OLARAK AYNI SONUCU ÜRETİR (kapanış fotoğrafı ile defter
   * ayrışmadığı sürece): `Σ(txn < cut)` + `Σ(cut ≤ txn < from)` = `Σ(txn < from)`.
   * Yani bu kestirme bir PERFORMANS optimizasyonu değil, bir DOĞRULUK
   * beyanıdır: kapanmış dönem tekrar toplanmaz, MÜHÜRLÜ rakam kullanılır.
   * Fark çıkarsa kapanıştan sonra geçmişe yazılmış demektir — `verify` onu
   * söyler; ekstrenin sessizce başka bir rakam basması engellenir.
   */
  async resolveStatementOpening(
    params: { cariId: string; currency: Currency; from: Date },
    client: Prisma.TransactionClient = prisma,
  ): Promise<{
    opening: Prisma.Decimal;
    /** Devrin dayandığı kapanış — yoksa `null` (tam geçmiş toplandı). */
    carriedFrom: { id: string; periodEnd: Date; closingBalance: Prisma.Decimal } | null;
    /** Kapanıştan `from`'a kadar biriken hareketlerin net etkisi. */
    sinceClose: Prisma.Decimal;
  }> {
    const fromKey = periodDayKey(params.from);

    // ADIM 1 — `from`'un gününden ÖNCE biten en yeni aktif kapanış.
    // `lt fromKey` (lte DEĞİL): kapanış `from`'un kendi gününde bitiyorsa o gün
    // hem kapanışın içinde hem ekstre penceresinde olurdu → çift sayım.
    const close = await client.cariPeriodClose.findFirst({
      where: { cariId: params.cariId, currency: params.currency, reopenedAt: null, periodEnd: { lt: fromKey } },
      orderBy: { periodEnd: "desc" },
      select: { id: true, periodEnd: true, closingBalance: true },
    });

    if (!close) {
      const agg = await client.cariTransaction.aggregate({
        where: { cariId: params.cariId, currency: params.currency, txnDate: { lt: params.from } },
        _sum: { debit: true, credit: true },
      });
      return {
        opening: D(agg._sum.debit ?? 0).minus(D(agg._sum.credit ?? 0)),
        carriedFrom: null,
        sinceClose: D0(),
      };
    }

    // ADIM 2 — kapanış anı ile pencere başlangıcı arasındaki hareketler.
    const cut = periodEndCutExclusive(close.periodEnd);
    const agg = await client.cariTransaction.aggregate({
      where: { cariId: params.cariId, currency: params.currency, txnDate: { gte: cut, lt: params.from } },
      _sum: { debit: true, credit: true },
    });
    const sinceClose = D(agg._sum.debit ?? 0).minus(D(agg._sum.credit ?? 0));

    // ADIM 3.
    return { opening: D(close.closingBalance).plus(sinceClose), carriedFrom: close, sinceClose };
  }

  private async assertCariExists(cariId: string): Promise<void> {
    // ⚠️ `isActive` ARANMAZ: pasif cari geçmiş taşımaya devam eder ve tam da
    // hesabı kapatılmış carilerin dönem mühürlenmesi gerekir. (Pasifleştirme
    // zaten sıfır bakiye şartına bağlı — `cari.service.update`.)
    const cari = await prisma.cariAccount.findUnique({ where: { id: cariId }, select: { id: true } });
    if (!cari) throw AppError.notFound("Cari hesap bulunamadı.");
  }
}

export const periodCloseService = new PeriodCloseService();
