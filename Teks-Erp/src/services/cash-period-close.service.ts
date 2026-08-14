// =============================================================================
// KASA/BANKA DÖNEM KAPANIŞI SERVİSİ — hesap bazlı kapanış fotoğrafı (K-1)
// =============================================================================
// "31.12.2025 itibarıyla Merkez Kasa'da 15.000 TL vardır" — kapanış budur.
// `PeriodCloseService`ın (cari, C3) HESAP-bazlı ikizi; desenler oradan taşındı.
//
// ── KAPANIŞ BİR FOTOĞRAFTIR, HAREKET DEĞİL ──────────────────────────────────
// Hiçbir deftere satır YAZMAZ. Kasa defteri üç tablodan türetilir ve kapanış
// yalnız o türetimin belli bir andaki ÖLÇÜMÜNÜ mühürler.
//
// ── FOTOĞRAFIN KAYNAĞI: ÜÇ YAZAR (test_consistency §23/§24 ile AYNI evren) ──
//   1. `payments`          — carili tahsilat/ödeme       (çıpa: paymentDate)
//   2. `cash_transactions` — masraf/gelir/virman/açılış  (çıpa: txnDate)
//   3. `cheque_events`     — COLLECT / PAY / COLLECT_CANCEL (çıpa: eventDate)
// Yalnız birine bakan bir ölçüm diğer yazarların hareketini "drift" sanırdı;
// §23/§24 mutabakat sorgularının UNION'ı buradaki `measureTx` ile aynı kümeyi
// toplamak ZORUNDADIR — ayrışırlarsa aynı kasa için iki "doğru" rakam doğar.
//
// ⚠️ `COLLECT_CANCEL` (K-2) BİLİNÇLİ İÇERİDE: tahsil stornosu ters kasa
// hareketini OLAY SATIRIYLA taşır (COLLECT'in kendisi gibi — ayrı
// CashTransaction doğmaz). Dışarıda bırakılsaydı ilk collect-stornosu, hem
// kapanış fotoğrafını hem `verify`i sahte drift'e düşürürdü. Bugün 0 satır →
// davranış birebir; K-2 indiği gün formül hazır.
//
// ⚠️ CARİ İKİZİNDEN FARKLAR:
//   • Boyut HESAP — para birimi YOK (hesap tek para birimli, şema kararı).
//   • Kilit uzayı 8028 (cari 8026'dan AYRI — kasa kapanışı cari yazarlarını
//     serileştirmemeli).
//   • Kaynak defter append-only DEĞİL: Payment/CashTransaction iptali satırı
//     CANCELLED'a çekip toplamdan GERİYE DÖNÜK düşürür. Bu yüzden iptal
//     yolları guard'ı ORİJİNAL tarihle çağırır (payment.cancel ·
//     cash-transaction.cancel — helper başlığında yazılı; ÇEK stornosu K-2
//     hariç: olay defteri append-only, ters satır bugüne düşer → çıpa `now`);
//     `verify` de tam bu sınıf sızıntıyı görünür kılmak için var.
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { D } from "./helpers/finance.helper";
import {
  CashAccountRef,
  CashAccountScope,
  cashScopeWhere,
  lockCashPeriodScopeTx,
  resolveCashAccountScope,
} from "./helpers/cash-period-guard.helper";
import { periodDayKey, periodEndCutExclusive, formatDayKeyTr } from "./helpers/period-guard.helper";
import type { ApiResponse } from "../types/api.types";

/** Bir dönemin ölçülmüş fotoğrafı — önizleme, kapanış ve doğrulama bunu döner. */
export interface CashPeriodSnapshot {
  /** Kapanışın kapsadığı son takvim günü (dahil), `@db.Date` anahtarı. */
  periodEnd: Date;
  /** Kapanışın kapsadığı son ANIN dış sınırı — hareket tarihi < cut. */
  cut: Date;
  closingBalance: Prisma.Decimal;
  /** ÜÇ yazarın toplam hareket sayısı — yeniden türetim kontrol toplamı. */
  txnCount: number;
  totalIn: Prisma.Decimal;
  totalOut: Prisma.Decimal;
}

export interface CashPeriodCloseRow {
  id: string;
  accountKind: "CASH_BOX" | "BANK_ACCOUNT";
  accountId: string;
  accountCode: string;
  accountName: string;
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

interface AccountInfo {
  scope: CashAccountScope;
  name: string;
  code: string;
}

/**
 * Bir hesap için `cut` anına kadarki kasa defteri fotoğrafını ölçer.
 *
 * ⚠️ TEK ÖLÇÜM NOKTASI: önizleme, kapanış ve doğrulama üçü de buradan geçer
 * (cari `measureTx` gerekçesi — kopyalansaydı önizlemenin gösterdiği rakam ile
 * kaydedilen rakam bir gün ayrışırdı ve ikisi de "doğru görünürdü").
 *
 * ⚠️ HAM SQL — perf kuralı 8: üçüncü yazarın tutarı JOIN ister (`ChequeEvent`
 * tutar taşımaz, `cheques.amount`tan okunur) ve işaretli toplam CASE ister;
 * Prisma aggregate ikisini de yapamaz. Zaman fonksiyonu YOK (tz-ok gerekmez);
 * `::text` dönüşü `D()` ile Decimal'e alınır — JS float'a hiç düşülmez.
 */
async function measureTx(
  tx: Prisma.TransactionClient,
  scope: CashAccountScope,
  periodEnd: Date,
): Promise<CashPeriodSnapshot> {
  const cut = periodEndCutExclusive(periodEnd);
  // Kolon adı iki tabloda da aynı; çek olay tablosunda alias şart (cheques'te
  // de `bankAccountId` var — niteliksiz yazım "ambiguous column" verirdi).
  const col = scope.field === "cashBoxId" ? Prisma.sql`"cashBoxId"` : Prisma.sql`"bankAccountId"`;
  const eCol = scope.field === "cashBoxId" ? Prisma.sql`e."cashBoxId"` : Prisma.sql`e."bankAccountId"`;

  const rows = await tx.$queryRaw<Array<{ toplam: string; giren: string; cikan: string; adet: number }>>(Prisma.sql`
    SELECT COALESCE(SUM(u.t), 0)::text AS toplam,
           COALESCE(SUM(CASE WHEN u.t > 0 THEN u.t ELSE 0 END), 0)::text AS giren,
           COALESCE(SUM(CASE WHEN u.t < 0 THEN -u.t ELSE 0 END), 0)::text AS cikan,
           COUNT(*)::int AS adet
    FROM (
      SELECT CASE WHEN direction = 'IN' THEN amount ELSE -amount END AS t
        FROM payments
        WHERE status <> 'CANCELLED' AND ${col} = ${scope.accountId}::uuid AND "paymentDate" < ${cut}
      UNION ALL
      SELECT CASE WHEN direction = 'IN' THEN amount ELSE -amount END AS t
        FROM cash_transactions
        WHERE status <> 'CANCELLED' AND ${col} = ${scope.accountId}::uuid AND "txnDate" < ${cut}
      UNION ALL
      -- YALNIZ para oynatan olaylar: COLLECT (+) · PAY (−) · COLLECT_CANCEL (−,
      -- COLLECT'in stornosu). DEPOSIT bilinçli DIŞARIDA (§23 notu: tahsile
      -- verilen çek henüz para değildir). CANCELLED süzgeci YOK — olay defteri
      -- append-only, "iptal edilmiş olay" diye bir şey yoktur.
      SELECT CASE WHEN e.type = 'COLLECT' THEN ch.amount ELSE -ch.amount END AS t
        FROM cheque_events e JOIN cheques ch ON ch.id = e."chequeId"
        WHERE e.type IN ('COLLECT', 'PAY', 'COLLECT_CANCEL')
          AND ${eCol} = ${scope.accountId}::uuid AND e."eventDate" < ${cut}
    ) u
  `);

  const r = rows[0] ?? { toplam: "0", giren: "0", cikan: "0", adet: 0 };
  return {
    periodEnd,
    cut,
    closingBalance: D(r.toplam),
    txnCount: r.adet,
    totalIn: D(r.giren),
    totalOut: D(r.cikan),
  };
}

export class CashPeriodCloseService {
  /**
   * ÖNİZLEME — hiçbir şey yazmaz.
   *
   * Kapanış geri alınabilir ama UCUZ DEĞİLDİR (iz bırakır, denetimde sorulur):
   * kullanıcı hangi rakamı mühürlediğini ÖNCE görmelidir.
   */
  async preview(params: CashAccountRef & { periodEnd: Date }): Promise<
    ApiResponse<
      CashPeriodSnapshot & {
        account: { kind: "CASH_BOX" | "BANK_ACCOUNT"; id: string; code: string; name: string };
        alreadyClosed: boolean;
        blockingClose: { id: string; periodEnd: Date; closingBalance: Prisma.Decimal } | null;
        previousClose: { id: string; periodEnd: Date; closingBalance: Prisma.Decimal } | null;
      }
    >
  > {
    const dayKey = periodDayKey(params.periodEnd);
    const acc = await this.loadAccount(params);
    const scopeWhere = cashScopeWhere(params);

    // Önizleme kilit ALMAZ — salt okuma ve rakam zaten "şu anki tahmin"dir.
    const snap = await measureTx(prisma, acc.scope, dayKey);

    const blocking = await prisma.cashPeriodClose.findFirst({
      where: { ...scopeWhere, reopenedAt: null, periodEnd: { gte: dayKey } },
      orderBy: { periodEnd: "asc" },
      select: { id: true, periodEnd: true, closingBalance: true },
    });
    const previous = await prisma.cashPeriodClose.findFirst({
      where: { ...scopeWhere, reopenedAt: null, periodEnd: { lt: dayKey } },
      orderBy: { periodEnd: "desc" },
      select: { id: true, periodEnd: true, closingBalance: true },
    });

    return {
      success: true,
      data: {
        ...snap,
        account: {
          kind: acc.scope.field === "cashBoxId" ? "CASH_BOX" : "BANK_ACCOUNT",
          id: acc.scope.accountId,
          code: acc.code,
          name: acc.name,
        },
        alreadyClosed: blocking != null && blocking.periodEnd.getTime() === dayKey.getTime(),
        blockingClose: blocking,
        previousClose: previous,
      },
    };
  }

  /**
   * DÖNEMİ KAPAT.
   *
   * ⚠️ GELECEK DÖNEM KAPATILAMAZ — cari ikizindeki gerekçenin aynısı:
   * 31.12.2026 kapatılırsa BUGÜNKÜ her kasa hareketi 409 alır ve muhasebeci
   * "sistem çalışmıyor" der. Kapanış geçmişi mühürlemek içindir.
   *
   * ⚠️ SIRALI: yeni kapanış, mevcut aktif kapanıştan İLERİ olmak zorunda —
   * iç içe kapanış `previousClose` zincirini belirsizleştirirdi.
   */
  async close(
    input: CashAccountRef & { periodEnd: Date; notes?: string | null },
    userId?: string,
  ): Promise<ApiResponse<{ id: string; periodEnd: Date; closingBalance: Prisma.Decimal; txnCount: number }>> {
    const dayKey = periodDayKey(input.periodEnd);
    const today = periodDayKey(new Date());
    if (dayKey.getTime() > today.getTime()) {
      throw AppError.badRequest(
        `Gelecek bir dönem kapatılamaz (${formatDayKeyTr(dayKey)}). Kapanış yalnız BİTMİŞ dönemler için yapılır.`,
      );
    }
    const acc = await this.loadAccount(input);
    const scopeWhere = cashScopeWhere(input);

    const created = await prisma.$transaction(async (tx) => {
      // ⚠️ TX'İN İLK İFADESİ: fotoğraf ile araya girecek kasa yazımı
      // serileşsin. `assertCashPeriodOpenTx` AYNI kilidi alır — yani ölçüm
      // sırasında bu hesap için yeni hareket COMMIT EDİLEMEZ. Kilit sonraya
      // alınırsa hiçbir şey kazanılmaz (KK1 TOCTOU dersi).
      await lockCashPeriodScopeTx(tx, input);

      // Kilit ALTINDA taze okuma (check-then-act değil).
      const blocking = await tx.cashPeriodClose.findFirst({
        where: { ...scopeWhere, reopenedAt: null, periodEnd: { gte: dayKey } },
        orderBy: { periodEnd: "asc" },
        select: { periodEnd: true },
      });
      if (blocking) {
        throw AppError.conflict(
          blocking.periodEnd.getTime() === dayKey.getTime()
            ? `"${acc.name}" için ${formatDayKeyTr(dayKey)} dönemi zaten kapalı.`
            : `"${acc.name}" için daha ileri bir kapanış var (${formatDayKeyTr(blocking.periodEnd)}) — ` +
              `${formatDayKeyTr(dayKey)} zaten onun içinde kapalı sayılır.`,
        );
      }

      const snap = await measureTx(tx, acc.scope, dayKey);

      try {
        return await tx.cashPeriodClose.create({
          data: {
            cashBoxId: acc.scope.field === "cashBoxId" ? acc.scope.accountId : null,
            bankAccountId: acc.scope.field === "bankAccountId" ? acc.scope.accountId : null,
            periodEnd: dayKey,
            closingBalance: snap.closingBalance,
            txnCount: snap.txnCount,
            notes: input.notes?.trim() || null,
            closedById: userId ?? null,
          },
          select: { id: true, periodEnd: true, closingBalance: true, txnCount: true },
        });
      } catch (e) {
        // Partial unique (`cash_period_close_box/bank_active_uq`) — advisory
        // kilit aynı anahtarı serileştirdiği için pratikte ulaşılmaz; yine de
        // sessiz 500 yerine anlamlı 409 (kilit bir gün kaldırılırsa tek sed).
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw AppError.conflict(`"${acc.name}" için ${formatDayKeyTr(dayKey)} dönemi zaten kapalı.`);
        }
        throw e;
      }
    });

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "CASH_PERIOD_CLOSE",
      recordId: created.id,
      newData: {
        account: acc.name,
        [acc.scope.field]: acc.scope.accountId,
        periodEnd: formatDayKeyTr(created.periodEnd),
        closingBalance: created.closingBalance.toString(),
        txnCount: created.txnCount,
      },
    });

    return {
      success: true,
      data: created,
      message: `"${acc.name}" — ${formatDayKeyTr(created.periodEnd)} dönemi kapatıldı.`,
    };
  }

  /**
   * DÖNEMİ YENİDEN AÇ — satır SİLİNMEZ, işaretlenir (denetim izi).
   *
   * ⚠️ LIFO — daha YENİ bir aktif kapanış varken eski dönem açılamaz. Yalnız
   * gelenek değil MEKANİK (cari ikizindeki gerekçe): guard "gün <= periodEnd"
   * ile kapsadığı için Aralık'ı açsanız da Ocak kapanışı Aralık'a yazmayı hâlâ
   * engellerdi — kullanıcı "açtım ama yine yazamıyorum" derdi.
   */
  async reopen(id: string, reason: string, userId?: string): Promise<ApiResponse<{ id: string; periodEnd: Date }>> {
    const trimmed = reason?.trim() ?? "";
    if (trimmed.length < 3) {
      throw AppError.badRequest(
        "Yeniden açma gerekçesi zorunlu (en az 3 karakter) — kapanış izi gerekçesiyle anlamlıdır.",
      );
    }

    const row = await prisma.cashPeriodClose.findUnique({
      where: { id },
      select: { id: true, cashBoxId: true, bankAccountId: true, periodEnd: true },
    });
    if (!row) throw AppError.notFound("Dönem kapanışı bulunamadı.");
    const ref: CashAccountRef = { cashBoxId: row.cashBoxId, bankAccountId: row.bankAccountId };
    const scopeWhere = cashScopeWhere(ref);

    const result = await prisma.$transaction(async (tx) => {
      await lockCashPeriodScopeTx(tx, ref);

      const later = await tx.cashPeriodClose.findFirst({
        where: { ...scopeWhere, reopenedAt: null, periodEnd: { gt: row.periodEnd } },
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
      const claimed = await tx.cashPeriodClose.updateMany({
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
      tableName: "CASH_PERIOD_CLOSE",
      recordId: id,
      oldData: { reopenedAt: null },
      newData: {
        reopenedAt: new Date().toISOString(),
        reopenReason: trimmed,
        periodEnd: formatDayKeyTr(row.periodEnd),
      },
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
   * SALT OKUMA — drift ALARMDIR, düzeltmez: kapanmış resmi rakamı sessizce
   * tazelemek bu modülün reddettiği tek şeydir. Drift'in bilinen kaynakları:
   * guard'ı atlayan bir yazar, elle DB yazımı, ya da kapalı dönemdeki bir
   * Payment/CashTransaction'ın iptali (iptal satırı geriye dönük düşürür —
   * cari defterin aksine bu defter append-only değildir).
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
    const row = await prisma.cashPeriodClose.findUnique({
      where: { id },
      select: {
        id: true,
        cashBoxId: true,
        bankAccountId: true,
        periodEnd: true,
        closingBalance: true,
        txnCount: true,
      },
    });
    if (!row) throw AppError.notFound("Dönem kapanışı bulunamadı.");

    const scope = resolveCashAccountScope({ cashBoxId: row.cashBoxId, bankAccountId: row.bankAccountId });
    const snap = await measureTx(prisma, scope, row.periodEnd);
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
    cashBoxId?: string;
    bankAccountId?: string;
    /** Yeniden açılmışlar da gelsin mi — denetim görünümü. */
    includeReopened?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<{
    data: CashPeriodCloseRow[];
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));

    // Liste süzgeci opsiyoneldir (hesapsız çağrı = tüm hesaplar) — XOR yalnız
    // İKİSİ BİRDEN verilirse ihlaldir (kesişim tanım gereği boştur, sessiz boş
    // liste yerine 400).
    if (params.cashBoxId && params.bankAccountId) {
      throw AppError.badRequest("Kasa VE banka süzgeci birlikte verilemez — birini seçin.");
    }
    const where: Prisma.CashPeriodCloseWhereInput = {};
    if (params.cashBoxId) where.cashBoxId = params.cashBoxId;
    if (params.bankAccountId) where.bankAccountId = params.bankAccountId;
    if (!params.includeReopened) where.reopenedAt = null;

    const [rows, total] = await Promise.all([
      prisma.cashPeriodClose.findMany({
        where,
        // En yeni kapanış üstte — `periodEnd` ile (createdAt DEĞİL: geçmiş bir
        // dönem sonradan kapatılmış olabilir).
        orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          cashBoxId: true,
          bankAccountId: true,
          periodEnd: true,
          closingBalance: true,
          txnCount: true,
          notes: true,
          closedById: true,
          createdAt: true,
          reopenedAt: true,
          reopenedById: true,
          reopenReason: true,
          cashBox: { select: { code: true, name: true } },
          bankAccount: { select: { code: true, name: true } },
        },
      }),
      prisma.cashPeriodClose.count({ where }),
    ]);

    return {
      data: rows.map((r) => {
        // XOR CHECK gereği daima biri dolu; dal yalnız tip daraltması.
        const acc = r.cashBox ?? r.bankAccount;
        return {
          id: r.id,
          accountKind: r.cashBoxId ? ("CASH_BOX" as const) : ("BANK_ACCOUNT" as const),
          accountId: (r.cashBoxId ?? r.bankAccountId) as string,
          accountCode: acc?.code ?? "—",
          accountName: acc?.name ?? "—",
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
   * "Bu hesap nereye kadar kapalı" — ekranın kilit rozeti.
   * Kapanış yoksa `null` (hata DEĞİL: kapanış opsiyoneldir).
   */
  async status(params: CashAccountRef): Promise<
    ApiResponse<{ closedThrough: Date | null; closingBalance: Prisma.Decimal | null; closeId: string | null }>
  > {
    const scopeWhere = cashScopeWhere(params);
    const row = await prisma.cashPeriodClose.findFirst({
      where: { ...scopeWhere, reopenedAt: null },
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
   * Hesabı çözer + adını döner.
   *
   * ⚠️ `isActive` ARANMAZ (cari ikizindeki karar): pasif kasa geçmiş taşımaya
   * devam eder ve tam da kapatılan hesapların dönemi mühürlenmek istenir.
   */
  private async loadAccount(ref: CashAccountRef): Promise<AccountInfo> {
    const scope = resolveCashAccountScope(ref);
    if (scope.field === "cashBoxId") {
      const box = await prisma.cashBox.findUnique({
        where: { id: scope.accountId },
        select: { code: true, name: true },
      });
      if (!box) throw AppError.notFound("Kasa bulunamadı.");
      return { scope, name: box.name, code: box.code };
    }
    const acc = await prisma.bankAccount.findUnique({
      where: { id: scope.accountId },
      select: { code: true, name: true },
    });
    if (!acc) throw AppError.notFound("Banka hesabı bulunamadı.");
    return { scope, name: acc.name, code: acc.code };
  }
}

export const cashPeriodCloseService = new CashPeriodCloseService();
