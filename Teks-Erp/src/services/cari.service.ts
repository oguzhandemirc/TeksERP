// =============================================================================
// CARİ HESAP SERVİSİ — hesap kartı · bakiye · ekstre
// =============================================================================
// Cari, müşteri/fason kartının MUHASEBE yüzüdür ve LAZY açılır (ilk fatura ya
// da tahsilat anında). Bu servis kartı yönetir ve defterden ekstre türetir;
// deftere YAZAN yalnız fatura ve tahsilat servisleridir.
// =============================================================================
import { Prisma, CariKind, Currency, CariTxnSource } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { D0, D, applyCariBalanceTx } from "./helpers/finance.helper";
import { assertPeriodOpenTx, lockCariPeriodScopeTx } from "./helpers/period-guard.helper";
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
   * AÇILIŞ / DEVİR BAKİYESİ — sisteme geçiş gününün olmazsa olmazı.
   *
   * Firma programa geçtiğinde müşterilerinin ve tedarikçilerinin MEVCUT
   * borç/alacakları vardır. Girilemezse ilk günden itibaren her bakiye ve her
   * yaşlandırma yanlış başlar — ve yanlışlığın kaynağı hiçbir yerde görünmez.
   *
   * ⚠️ Devir bir HAREKETTİR, bakiyeye elle yazılan bir sayı DEĞİL: ADJUSTMENT
   * kaynaklı normal bir defter satırı olarak düşer. Böylece ekstrede görünür,
   * açıklaması okunur ve gerekirse TERS SATIRLA düzeltilir. CariBalance'a
   * doğrudan yazmak defterle bakiyeyi ilk günden ayrıştırırdı (§21 mutabakatı
   * kırmızı verirdi).
   *
   * ⚠️ İZİN finance:invoice — deftere işleyen her şey aynı kapıdan geçer
   * (finance:write taslak/tanım içindir; devir taslak değildir).
   *
   * ⚠️ İKİNCİ devir REDDEDİLİR: ikinci açılış satırı "hangisi gerçek devir"
   * sorusunu cevapsız bırakır ve bakiyeyi sessizce şişirir. Düzeltme yolu ters
   * düzeltme kaydıdır — ayrı ve GÖRÜNÜR bir karar olmalı.
   */
  async setOpeningBalance(
    input: {
      cariId: string;
      currency: Currency;
      /** POZİTİF = cari BİZE borçlu (alacağımız); NEGATİF = biz ona borçluyuz. */
      balance: Prisma.Decimal.Value;
      description?: string | null;
      /** Devrin ait olduğu an — varsayılan şimdi (geçmiş tarih girilebilir). */
      txnDate?: Date;
    },
    userId?: string,
  ): Promise<ApiResponse<{ id: string }>> {
    const amount = D(input.balance);
    if (amount.isZero()) {
      throw AppError.badRequest("Devir tutarı sıfır olamaz — sıfır bakiye için kayıt gerekmez.");
    }
    const cari = await prisma.cariAccount.findUnique({
      where: { id: input.cariId },
      select: { id: true, isActive: true },
    });
    if (!cari) throw AppError.notFound("Cari hesap bulunamadı.");
    if (!cari.isActive) throw AppError.badRequest("Pasif cariye devir girilemez.");

    const txnDate = input.txnDate ?? new Date();
    const created = await prisma.$transaction(async (tx) => {
      // ⚠️ TX'İN İLK İFADESİ: KİLİT — mükerrer devir kontrolünden ÖNCE (TOCTOU).
      // Eskiden dup-kontrolü kilitsiz koşuyordu (KK1 tuzağının birebir tekrarı):
      // 5 paralel devir isteğinin 5'i de "devir yok" görüyor, sonra kilitte
      // SERİLEŞİP 5 satır yazıyordu — tx'ler sıralanmıştı, kontroller
      // sıralanmamıştı. Kilit korunan okumadan SONRA alınırsa hiçbir şey
      // kazanılmaz. (`assertPeriodOpenTx` aşağıda AYNI kilidi tekrar alır —
      // advisory xact lock reentrant, çift alma zararsız.)
      await lockCariPeriodScopeTx(tx, input.cariId, input.currency);

      // Mükerrer devir kontrolü — artık KİLİT ALTINDA taze okuma. "Devir var mı"
      // sorusu "TERS KAYDI OLMAYAN ADJUSTMENT var mı" sorusudur: iptal edilmiş
      // (ADJUSTMENT_CANCEL ile terslenmiş) devir, yeni devrin önünü KESMEZ —
      // düzeltme akışının tamamı budur (iptal et → doğrusunu gir).
      const dup = await tx.cariTransaction.findFirst({
        where: {
          cariId: input.cariId,
          currency: input.currency,
          sourceType: CariTxnSource.ADJUSTMENT,
          reversedBy: { is: null },
        },
        select: { id: true, txnDate: true },
      });
      if (dup) {
        // 409 GERÇEK yolu gösterir — "ters bir düzeltme kaydı girin" diyen eski
        // mesajın gösterdiği uç ürün genelinde YOKTU (Sınıf 2'nin kök bulgusu).
        throw AppError.conflict(
          `Bu cari için ${input.currency} devri zaten girilmiş (${dup.txnDate.toLocaleDateString("tr-TR")}). ` +
            `Düzeltmek için önce mevcut devri iptal edin (Devri İptal Et).`,
        );
      }

      // ⚠️ DÖNEM KİLİDİ — satır YAZILMADAN ÖNCE, AYNI tx'te. Devir, kilidin en
      // çok gerektiği yazardır: `txnDate` KULLANICININ seçtiği geçmiş bir tarih
      // olabilir (imza opsiyonel bırakıyor), yani kapanmış bir döneme düşmesi
      // istisna değil OLAĞAN durumdur — ve düşerse o dönemin ilan edilmiş
      // bakiyesini geriye dönük değiştirir. Çıpa `now` DEĞİL `txnDate`'tir.
      //
      // ⚠️ SIRA: mükerrer devir kontrolü (yukarıda) ÖNCE. Kaydın KENDİ
      // tutarlılığı bağlam çözümünden önce sorulur — aksi halde ikinci kez devir
      // giren kullanıcı "devir zaten girilmiş" yerine "dönem kapalı" duyar ve
      // asıl hatasını iki tur sonra öğrenir.
      await assertPeriodOpenTx(tx, { cariId: input.cariId, currency: input.currency, txnDate });

      // Devir POZİTİFSE cari bize borçludur → BORÇ kolonu (fatura yönüyle aynı
      // sözleşme: pozitif bakiye = alacağımız).
      const isDebit = amount.gt(0);
      const abs = amount.abs();
      const row = await tx.cariTransaction.create({
        data: {
          cariId: input.cariId,
          currency: input.currency,
          txnDate,
          debit: isDebit ? abs : D0(),
          credit: isDebit ? D0() : abs,
          // Devirde kur damgası 1 ve TL karşılığı yalnız TRY'de dolu: tutar
          // ZATEN o para biriminde girildi, geçmişin kuru bilinmiyor —
          // uydurma kur TL raporunu sessizce yanlışlardı.
          amountTry: input.currency === Currency.TRY ? abs : D0(),
          exchangeRate: D(1),
          sourceType: CariTxnSource.ADJUSTMENT,
          description: input.description?.trim() || "Devir bakiyesi",
          createdById: userId ?? null,
        },
        select: { id: true },
      });
      await applyCariBalanceTx(tx, input.cariId, input.currency, amount);
      return row;
    });

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "CARI_ACCOUNT",
      recordId: input.cariId,
      newData: { event: "OPENING_BALANCE", currency: input.currency, balance: amount.toString() },
    });
    return { success: true, data: created, message: "Devir bakiyesi kaydedildi." };
  }

  /**
   * DEVİR STORNOSU — `ADJUSTMENT`ın tipli ters yolu (Sınıf 2, 2026-08-14).
   *
   * Yanlış girilen devir (4.250 yerine 42.500) düzeltilemiyordu: 409 mesajı
   * "ters bir düzeltme kaydı girin" diyordu ama o yolu yazan uç ürün genelinde
   * YOKTU. Defter APPEND-ONLY olduğu için düzeltme daima TERS SATIRDIR (SAP
   * FB08 storno belgesi modeli): orijinal satır SİLİNMEZ, `ADJUSTMENT_CANCEL`
   * kaynaklı ters satır `reversesTxnId` bağıyla yazılır.
   *
   * ⚠️ TERS KAYIT **BUGÜNE** yazılır (`txnDate = now`) — diğer storno yollarıyla
   * (fatura/tahsilat iptali) aynı sözleşme. Devir kapanmış bir dönemin içinde
   * olsa bile o dönemin İLAN EDİLMİŞ fotoğrafı DEĞİŞMEZ; düzeltme açık döneme
   * düşer ve `assertPeriodOpenTx` yalnız BUGÜNÜ sorar.
   *
   * ⚠️ TUTAR/KUR ORİJİNALDEN AYNEN: debit↔credit yer değiştirir, `amountTry` ve
   * `exchangeRate` birebir kopyalanır — TL karşılığı ters yönde birebir kapansın.
   * "Bugünün kuruyla tersle" YANLIŞ olurdu: aradaki kur farkı defterde hayalet
   * bir TL bakiyesi bırakırdı.
   *
   * ⚠️ ÇİFT STORNO İMKÂNSIZ — üç katman: (1) aktif devir araması kilit altında
   * `reversedBy: null` ister, (2) `reversesTxnId` partial unique (ikinci ters
   * satır P2002 → anlamlı 409), (3) storno sonrası aktif devir kalmadığı için
   * ikinci çağrı 404 alır. Storno'nun kendisi de geri alınabilir: yeni devir
   * girmek serbesttir (dup-kontrolü yalnız TERSLENMEMİŞ devri sayar).
   *
   * İZİN: `finance:invoice` — YENİ İZİN YOK (tasarım kararı). Devri giren
   * iptalini de yapar; iptal append-only'dir ve kendisi de yeni devirle telafi
   * edilir — `roll:manual-adjust` sınıfı "geçmişi serbest yeniden yazma" burada
   * doğmuyor.
   */
  async cancelOpeningBalance(
    input: {
      cariId: string;
      currency: Currency;
      /** ZORUNLU — storno bir düzeltme kararıdır, gerekçesiz kayda geçmez. */
      reason: string;
    },
    userId?: string,
  ): Promise<ApiResponse<{ id: string; reversesTxnId: string }>> {
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 3) {
      throw AppError.badRequest(
        "İptal gerekçesi zorunlu (en az 3 karakter) — storno kaydı gerekçesiyle anlamlıdır.",
      );
    }

    const cari = await prisma.cariAccount.findUnique({
      where: { id: input.cariId },
      select: { id: true, isActive: true },
    });
    if (!cari) throw AppError.notFound("Cari hesap bulunamadı.");
    // Pasif cari sıfır bakiye şartıyla pasifleşti; storno bakiyesini sıfırdan
    // uzaklaştırır ve açık bakiye pasif caride GÖRÜNMEZ olurdu (update'teki
    // pasifleştirme guard'ının ayna kuralı).
    if (!cari.isActive) {
      throw AppError.badRequest("Pasif caride devir iptali yapılamaz — önce cariyi aktifleştirin.");
    }

    const result = await prisma.$transaction(async (tx) => {
      // ⚠️ TX'İN İLK İFADESİ: aktif devir okuması kilit ALTINDA yapılır —
      // eşzamanlı ikinci storno / yeni devir girişi bu kilitte serileşir
      // (`setOpeningBalance` ile aynı kilit: iki yazar birbirini görür).
      await lockCariPeriodScopeTx(tx, input.cariId, input.currency);

      // AKTİF devir = ters kaydı OLMAYAN ADJUSTMENT. Aynı anda en fazla bir
      // tane olabilir (dup-guard); `orderBy` yalnız determinizm için.
      const original = await tx.cariTransaction.findFirst({
        where: {
          cariId: input.cariId,
          currency: input.currency,
          sourceType: CariTxnSource.ADJUSTMENT,
          reversedBy: { is: null },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, txnDate: true, debit: true, credit: true, amountTry: true, exchangeRate: true },
      });
      if (!original) {
        throw AppError.notFound(
          `Bu cari için iptal edilecek ${input.currency} devri yok — devir hiç girilmemiş ya da zaten iptal edilmiş. ` +
            `Yeni devir girmek için "Devir Bakiyesi" ekranını kullanın.`,
        );
      }

      // Ters kayıt BUGÜNE düşer — kapanmış dönem fotoğrafı değişmez (yukarıda).
      const txnDate = new Date();
      await assertPeriodOpenTx(tx, { cariId: input.cariId, currency: input.currency, txnDate });

      let row: { id: string };
      try {
        row = await tx.cariTransaction.create({
          data: {
            cariId: input.cariId,
            currency: input.currency,
            txnDate,
            // Birebir ters: borç ↔ alacak yer değiştirir.
            debit: D(original.credit),
            credit: D(original.debit),
            amountTry: D(original.amountTry),
            exchangeRate: D(original.exchangeRate),
            sourceType: CariTxnSource.ADJUSTMENT_CANCEL,
            reversesTxnId: original.id,
            description: `Devir iptali — ${reason}`,
            createdById: userId ?? null,
          },
          select: { id: true },
        });
      } catch (e) {
        // Partial unique (`reversesTxnId WHERE NOT NULL`) — advisory kilit aynı
        // anahtarı serileştirdiği için pratikte ulaşılmaz; kilit bir gün
        // kaldırılırsa tek sed budur (period-close P2002 emsali).
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw AppError.conflict(
            "Bu devir zaten iptal edilmiş (ters kaydı var). Yeni devir girmek için \"Devir Bakiyesi\" ekranını kullanın.",
          );
        }
        throw e;
      }

      // Ters delta: orijinal bakiye etkisi (debit − credit) idi → tersi.
      await applyCariBalanceTx(tx, input.cariId, input.currency, D(original.credit).minus(D(original.debit)));
      return { id: row.id, reversesTxnId: original.id };
    });

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "CARI_ACCOUNT",
      recordId: input.cariId,
      newData: {
        event: "OPENING_BALANCE_CANCEL",
        currency: input.currency,
        reversesTxnId: result.reversesTxnId,
        reason,
      },
    });
    return {
      success: true,
      data: result,
      message: "Devir iptal edildi — ters kayıt bugüne yazıldı; doğru devri şimdi girebilirsiniz.",
    };
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
