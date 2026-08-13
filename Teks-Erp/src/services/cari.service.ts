// =============================================================================
// CARİ HESAP SERVİSİ — hesap kartı · bakiye · ekstre
// =============================================================================
// Cari, müşteri/fason kartının MUHASEBE yüzüdür ve LAZY açılır (ilk fatura ya
// da tahsilat anında). Bu servis kartı yönetir ve defterden ekstre türetir;
// deftere YAZAN yalnız fatura ve tahsilat servisleridir.
// =============================================================================
import { Prisma, CariKind, Currency } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { D0, D } from "./helpers/finance.helper";
import type { ApiResponse } from "../types/api.types";

export interface CariListRow {
  id: string;
  kind: CariKind;
  name: string;
  code: string;
  taxOffice: string | null;
  taxNumber: string | null;
  defaultCurrency: Currency;
  paymentTermDays: number | null;
  riskLimit: Prisma.Decimal | null;
  isActive: boolean;
  balances: Array<{ currency: Currency; balance: Prisma.Decimal }>;
}

const PARTY_SELECT = {
  customer: { select: { id: true, code: true, name: true, taxNumber: true } },
  subcontractor: { select: { id: true, code: true, name: true, taxNumber: true } },
} as const;

/** Cari kartının görünen adı/kodu — hangi tarafa bağlıysa oradan. */
function partyOf(row: {
  customer: { id: string; code: string; name: string; taxNumber: string | null } | null;
  subcontractor: { id: string; code: string; name: string; taxNumber: string | null } | null;
}): { code: string; name: string; taxNumber: string | null } {
  const p = row.customer ?? row.subcontractor;
  // CHECK constraint gereği ikisinden biri DAİMA dolu; bu dal yalnız tip
  // daraltması için — ulaşılırsa veri bozulmuş demektir ve sessiz "—" basmak
  // yerine gürültü çıkarmak doğrudur.
  if (!p) throw AppError.internal("Cari hesap hiçbir tarafa bağlı değil (veri tutarsızlığı).");
  return { code: p.code, name: p.name, taxNumber: p.taxNumber };
}

export class CariService {
  /**
   * Cari listesi + bakiyeler.
   *
   * ⚠️ Bakiye SATIRLA BİRLİKTE gelir (N+1 yok) ve PARA BİRİMİ BAZINDA dizidir —
   * tek sayıya indirmek 1000 USD ile 30.000 TL'yi toplamak olurdu.
   */
  async list(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    kind?: CariKind;
    isActive?: boolean;
    /** Yalnız bakiyesi SIFIR OLMAYANLAR — "kimden alacağım var" sorusu. */
    onlyWithBalance?: boolean;
  }): Promise<{ data: CariListRow[]; pagination: { total: number; page: number; pageSize: number; totalPages: number } }> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));

    const where: Prisma.CariAccountWhereInput = {};
    if (params.kind) where.kind = params.kind;
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { customer: { code: { contains: q, mode: "insensitive" } } },
        { subcontractor: { name: { contains: q, mode: "insensitive" } } },
        { subcontractor: { code: { contains: q, mode: "insensitive" } } },
      ];
    }
    if (params.onlyWithBalance) {
      where.balances = { some: { NOT: { balance: 0 } } };
    }

    const [rows, total] = await Promise.all([
      prisma.cariAccount.findMany({
        where,
        include: { ...PARTY_SELECT, balances: { select: { currency: true, balance: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.cariAccount.count({ where }),
    ]);

    return {
      data: rows.map((r) => {
        const p = partyOf(r);
        return {
          id: r.id,
          kind: r.kind,
          code: p.code,
          name: p.name,
          taxNumber: p.taxNumber,
          taxOffice: r.taxOffice,
          defaultCurrency: r.defaultCurrency,
          paymentTermDays: r.paymentTermDays,
          riskLimit: r.riskLimit,
          isActive: r.isActive,
          // Sıfır bakiyeli para birimi satırları gürültüdür; ekranda yer kaplar.
          balances: r.balances.filter((b) => !D(b.balance).isZero()),
        };
      }),
      pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async findById(id: string): Promise<ApiResponse<CariListRow>> {
    const row = await prisma.cariAccount.findUnique({
      where: { id },
      include: { ...PARTY_SELECT, balances: { select: { currency: true, balance: true } } },
    });
    if (!row) throw AppError.notFound("Cari hesap bulunamadı.");
    const p = partyOf(row);
    return {
      success: true,
      data: {
        id: row.id,
        kind: row.kind,
        code: p.code,
        name: p.name,
        taxNumber: p.taxNumber,
        taxOffice: row.taxOffice,
        defaultCurrency: row.defaultCurrency,
        paymentTermDays: row.paymentTermDays,
        riskLimit: row.riskLimit,
        isActive: row.isActive,
        balances: row.balances,
      },
    };
  }

  /**
   * Cari kartını AÇIKÇA oluşturur (lazy yol dışında — muhasebeci vergi dairesi
   * / vade bilgisini önceden girmek isteyebilir).
   */
  async create(
    input: {
      customerId?: string | null;
      subcontractorId?: string | null;
      taxOffice?: string | null;
      defaultCurrency?: Currency;
      paymentTermDays?: number | null;
      riskLimit?: Prisma.Decimal.Value | null;
      notes?: string | null;
    },
    userId?: string,
  ): Promise<ApiResponse<{ id: string }>> {
    const customerId = input.customerId ?? null;
    const subcontractorId = input.subcontractorId ?? null;
    if ((customerId === null) === (subcontractorId === null)) {
      throw AppError.badRequest("Müşteri VEYA fason firma seçilmeli (ikisi birden değil).");
    }

    // Taraf gerçekten var mı + aktif mi (dış referans doğrulaması).
    if (customerId) {
      const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { isActive: true } });
      if (!c) throw AppError.badRequest("Müşteri bulunamadı.");
      if (!c.isActive) throw AppError.badRequest("Müşteri pasif durumda.");
    } else {
      const s = await prisma.subcontractor.findUnique({
        where: { id: subcontractorId as string },
        select: { isActive: true },
      });
      if (!s) throw AppError.badRequest("Fason firma bulunamadı.");
      if (!s.isActive) throw AppError.badRequest("Fason firma pasif durumda.");
    }

    const dup = await prisma.cariAccount.findFirst({
      where: customerId ? { customerId } : { subcontractorId: subcontractorId as string },
      select: { id: true },
    });
    if (dup) throw AppError.conflict("Bu taraf için cari hesap zaten açık.");

    const created = await prisma.cariAccount.create({
      data: {
        kind: customerId ? CariKind.CUSTOMER : CariKind.SUBCONTRACTOR,
        customerId,
        subcontractorId,
        taxOffice: input.taxOffice ?? null,
        defaultCurrency: input.defaultCurrency ?? Currency.TRY,
        paymentTermDays: input.paymentTermDays ?? null,
        riskLimit: input.riskLimit == null ? null : D(input.riskLimit),
        notes: input.notes ?? null,
      },
      select: { id: true },
    });

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "CARI_ACCOUNT",
      recordId: created.id,
      newData: { customerId, subcontractorId },
    });
    return { success: true, data: created, message: "Cari hesap oluşturuldu." };
  }

  async update(
    id: string,
    input: {
      taxOffice?: string | null;
      defaultCurrency?: Currency;
      paymentTermDays?: number | null;
      riskLimit?: Prisma.Decimal.Value | null;
      notes?: string | null;
      isActive?: boolean;
    },
    userId?: string,
  ): Promise<ApiResponse<{ id: string }>> {
    const existing = await prisma.cariAccount.findUnique({
      where: { id },
      select: { id: true, taxOffice: true, defaultCurrency: true, paymentTermDays: true, isActive: true },
    });
    if (!existing) throw AppError.notFound("Cari hesap bulunamadı.");

    // ⚠️ Bakiyesi olan cari PASİFLEŞTİRİLEMEZ: pasif cari listelerden düşer ve
    // açık bakiye görünmez olur — muhasebede "kapatılmamış hesabı gizlemek"
    // tam olarak yapılmaması gereken şeydir.
    if (input.isActive === false) {
      const open = await prisma.cariBalance.findFirst({
        where: { cariId: id, NOT: { balance: 0 } },
        select: { currency: true, balance: true },
      });
      if (open) {
        throw AppError.conflict(
          `Bu carinin ${open.currency} bakiyesi ${open.balance.toString()} — sıfırlanmadan pasifleştirilemez.`,
        );
      }
    }

    const updated = await prisma.cariAccount.update({
      where: { id },
      data: {
        ...(input.taxOffice !== undefined ? { taxOffice: input.taxOffice } : {}),
        ...(input.defaultCurrency !== undefined ? { defaultCurrency: input.defaultCurrency } : {}),
        ...(input.paymentTermDays !== undefined ? { paymentTermDays: input.paymentTermDays } : {}),
        ...(input.riskLimit !== undefined ? { riskLimit: input.riskLimit == null ? null : D(input.riskLimit) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: { id: true },
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CARI_ACCOUNT",
      recordId: id,
      oldData: existing,
      newData: input as Record<string, unknown>,
    });
    return { success: true, data: updated, message: "Cari hesap güncellendi." };
  }

  /**
   * CARİ EKSTRE — dönem devri + yürüyen bakiye.
   *
   * ⚠️ "Dönem devri" (opening) dönem BAŞINDAN ÖNCEKİ tüm hareketlerin
   * toplamıdır ve ayrı sorgulanır. Yalnız dönem içi satırları göstermek,
   * ekstrenin en çok bakılan sayısını (kapanış bakiyesi) YANLIŞ üretirdi.
   *
   * ⚠️ Para birimi ZORUNLU: iki para birimini tek ekstrede yürüyen bakiyeyle
   * göstermek matematiksel olarak anlamsızdır.
   */
  async statement(params: {
    cariId: string;
    currency: Currency;
    from: Date;
    to: Date;
  }): Promise<
    ApiResponse<{
      opening: Prisma.Decimal;
      closing: Prisma.Decimal;
      totalDebit: Prisma.Decimal;
      totalCredit: Prisma.Decimal;
      rows: Array<{
        id: string;
        txnDate: Date;
        description: string | null;
        sourceType: string;
        docNo: string | null;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
        running: Prisma.Decimal;
      }>;
    }>
  > {
    const cari = await prisma.cariAccount.findUnique({ where: { id: params.cariId }, select: { id: true } });
    if (!cari) throw AppError.notFound("Cari hesap bulunamadı.");

    const openingAgg = await prisma.cariTransaction.aggregate({
      where: { cariId: params.cariId, currency: params.currency, txnDate: { lt: params.from } },
      _sum: { debit: true, credit: true },
    });
    const opening = D(openingAgg._sum.debit ?? 0).minus(D(openingAgg._sum.credit ?? 0));

    const txns = await prisma.cariTransaction.findMany({
      where: {
        cariId: params.cariId,
        currency: params.currency,
        txnDate: { gte: params.from, lte: params.to },
      },
      // ⚠️ İkincil anahtar `createdAt`: aynı gün tarihli iki hareketin sırası
      // yoksa yürüyen bakiye her sorguda farklı çıkabilir (ekstre "oynak"
      // görünür ve kimse ona güvenmez).
      orderBy: [{ txnDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        txnDate: true,
        description: true,
        sourceType: true,
        debit: true,
        credit: true,
        invoice: { select: { docNo: true } },
        payment: { select: { docNo: true } },
      },
    });

    let running = opening;
    let totalDebit = D0();
    let totalCredit = D0();
    const rows = txns.map((t) => {
      running = running.plus(D(t.debit)).minus(D(t.credit));
      totalDebit = totalDebit.plus(D(t.debit));
      totalCredit = totalCredit.plus(D(t.credit));
      return {
        id: t.id,
        txnDate: t.txnDate,
        description: t.description,
        sourceType: t.sourceType,
        docNo: t.invoice?.docNo ?? t.payment?.docNo ?? null,
        debit: t.debit,
        credit: t.credit,
        running,
      };
    });

    return {
      success: true,
      data: { opening, closing: running, totalDebit, totalCredit, rows },
    };
  }
}

export const cariService = new CariService();
