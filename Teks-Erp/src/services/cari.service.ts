// =============================================================================
// CARİ HESAP SERVİSİ — hesap kartı · bakiye · ekstre
// =============================================================================
// Cari, müşteri/fason kartının MUHASEBE yüzüdür ve LAZY açılır (ilk fatura ya
// da tahsilat anında). Bu servis kartı yönetir ve defterden ekstre türetir;
// deftere YAZAN yalnız fatura ve tahsilat servisleridir.
// =============================================================================
import { Prisma, CariKind, Currency, CariTxnSource } from "@prisma/client";
import type { SuzgecEcho } from "./reports/_filters";
import { reasonOptions, type SebepSecenek } from "./reports/_secenekler";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ensureCariAccountTx, resolveCariAccountByCustomerTx } from "./helpers/finance.helper";
import { AuditService } from "./audit.service";
import { D0, D, applyCariBalanceTx } from "./helpers/finance.helper";
import { resolvePartyToCardTx } from "./helpers/party-card.helper";
import { assertPeriodOpenTx, lockCariPeriodScopeTx } from "./helpers/period-guard.helper";
import { periodCloseService } from "./period-close.service";
// H2 (2026-08-14): "Gecikmiş" kolonunun TEK kaynağı yaşlandırma çekirdeği —
// efektif vade + açık tutar + sanal FIFO mahsup kuralı ORADA yaşar, burada
// ikinci bir formül YAZILMAZ (bkz. finance-aging.report.ts başlığı).
import { collectAgingRows } from "./reports/finance-aging.report";
import { buildTurkishSearch } from "../utils/query-parser";
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
  /** Serbest not. Yanıtta TAŞINMAK ZORUNDA (2026-08-14): alan yazılabilir ama
   *  okunamazken paneldeki düzenleme diyaloğu boş bir Not kutusu çizip mevcut
   *  notu kullanıcı görmeden ezerdi — yazma-tek-yönlü alan yüzey almaz. */
  notes: string | null;
  isActive: boolean;
  /** Kartın rolleri (rol modeli) — kartsız eski fason hesabında null; panel rozeti buradan yazar. */
  roles: { isCustomerRole: boolean; isSupplierRole: boolean; isSubcontractorRole: boolean } | null;
  balances: Array<{ currency: Currency; balance: Prisma.Decimal }>;
  /** YALNIZ `withOverdue: true` istendiğinde döner — para birimi bazında vadesi
   *  geçmiş AÇIK tutar. Değer yaşlandırma raporunun `overdueTotal`'ıyla TEK
   *  kaynaktan (aynı çekirdek fonksiyon) üretilir; işaret sözleşmesi bakiyeyle
   *  aynıdır (POZİTİF = cari bize borçlu). STRING taşınır — para `number`'a
   *  çevrilmez (aging raporuyla aynı gerekçe). */
  overdue?: Array<{ currency: Currency; amount: string }>;
}

const PARTY_SELECT = {
  customer: { select: { id: true, code: true, name: true, taxNumber: true, isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: true } },
  subcontractor: { select: { id: true, code: true, name: true, taxNumber: true } },
} as const;

/** Kartın rol bayrakları — kartsız (eski fason kind'lı) hesapta null. */
function rolesOf(row: { customer: { isCustomerRole: boolean; isSupplierRole: boolean; isSubcontractorRole: boolean } | null }): CariListRow["roles"] {
  const c = row.customer;
  return c ? { isCustomerRole: c.isCustomerRole, isSupplierRole: c.isSupplierRole, isSubcontractorRole: c.isSubcontractorRole } : null;
}

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
    /** Kartın rol süzgeci (`partnerRoleAccountWhere`): hesap KARTIN bayrağıyla süzülür; eski panel göndermez → hepsi. */
    roleWhere?: Prisma.CustomerWhereInput;
    /** Yalnız bakiyesi SIFIR OLMAYANLAR — "kimden alacağım var" sorusu. */
    onlyWithBalance?: boolean;
    /** Yalnız HAREKETİ olan hesaplar (herhangi bir cari hareket; açılış bakiyesi dahil) — kartla doğan boş hesaplar listeyi şişirmesin (panel varsayılanı). Verilmezse hepsi (eski panel aynen). */
    hasActivity?: boolean;
    /** Belirli kartın hesabı (`readIdCondition`). */
    customerId?: string | { in: string[] };
    /** Vadesi geçmiş açık tutarları da getir (H2). Bayrak verilmezse ek sorgu
     *  KOŞMAZ — bugünkü yol bayt-bayt aynı kalır. */
    withOverdue?: boolean;
  }): Promise<{ data: CariListRow[]; pagination: { total: number; page: number; pageSize: number; totalPages: number } }> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));

    const where: Prisma.CariAccountWhereInput = {};
    if (params.kind) where.kind = params.kind;
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.roleWhere) where.customer = params.roleWhere;
    if (params.search?.trim()) {
      // ⚠️ TÜRKÇE-DUYARLI (kural + gerekçe: `utils/query-parser`).
      // ⚠️ CARİ ADI **NORMALİZE EDİLMEZ** — `Item.name`in aksine BÜYÜĞE
      // çevrilmez (bu kurulumda 49 müşterinin 22'si başlık düzeninde) ve
      // düzeltmenin en kritik yeri burasıdır: ILIKE noktalı/noktasız i'yi
      // katlamadığı için "iş bankası" yazan kullanıcı "T. İş Bankası"yı düz
      // `contains + insensitive` ile HİÇ bulamaz.
      where.OR = buildTurkishSearch(params.search, [
        "customer.name",
        "customer.code",
        "subcontractor.name",
        "subcontractor.code",
      ]);
    }
    if (params.onlyWithBalance) {
      where.balances = { some: { NOT: { balance: 0 } } };
    }
    if (params.hasActivity) where.transactions = { some: {} };
    if (params.customerId) where.customerId = params.customerId;

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

    // ── VADESİ GEÇEN TOPLAM (H2, 2026-08-14) — TEK KAYNAK: aging çekirdeği ──
    // Formül BURADA YAZILMAZ: efektif vade (belge vadesi → fatura tarihi +
    // cari vade günü → vadesiz), açık tutar (grandTotal − paidTotal) ve
    // kapanmamış kredinin SANAL FIFO mahsubu `collectAgingRows`'ta yaşar;
    // yaşlandırma raporu da AYNI fonksiyondan okur. İkinci bir SQL/formül,
    // iki ekranın aynı cariye iki farklı "gecikmiş" rakamı basması demekti
    // (bekçi: test_finance_reports §11 eşitliği fixture üzerinde birebir ölçer).
    //
    // ⚠️ N+1 DEĞİL: sayfadaki TÜM cari id'leri tek çağrıyla gider (`cariIds`);
    // çekirdek sabit sayıda toplu sorgu koşar, satır başına sorgu üretmez.
    // ⚠️ Bayrak yokken bu blok HİÇ KOŞMAZ (bekçi kaynak taramasıyla kilitler).
    let overdueByCari: Map<string, Array<{ currency: Currency; amount: string }>> | null = null;
    if (params.withOverdue && rows.length > 0) {
      const agingRows = await collectAgingRows({ asOf: new Date(), cariIds: rows.map((r) => r.id) });
      overdueByCari = new Map();
      for (const ar of agingRows) {
        if (D(ar.overdueTotal).isZero()) continue; // sıfır satır gürültüdür
        const list = overdueByCari.get(ar.cariId) ?? [];
        list.push({ currency: ar.currency, amount: ar.overdueTotal });
        overdueByCari.set(ar.cariId, list);
      }
      // Determinizm: aynı istek aynı sırayı üretsin (Map/acc sırası sorgu
      // planına göre oynayabilir).
      for (const list of overdueByCari.values()) {
        list.sort((a, b) => a.currency.localeCompare(b.currency));
      }
    }

    return {
      data: rows.map((r) => {
        const p = partyOf(r);
        return {
          id: r.id,
          kind: r.kind,
          code: p.code,
          name: p.name,
          taxNumber: p.taxNumber,
          roles: rolesOf(r),
          taxOffice: r.taxOffice,
          defaultCurrency: r.defaultCurrency,
          paymentTermDays: r.paymentTermDays,
          riskLimit: r.riskLimit,
          notes: r.notes,
          isActive: r.isActive,
          // Sıfır bakiyeli para birimi satırları gürültüdür; ekranda yer kaplar.
          balances: r.balances.filter((b) => !D(b.balance).isZero()),
          // Alan yalnız İSTENDİĞİNDE var — bayraksız yanıt bugünküyle birebir.
          ...(overdueByCari ? { overdue: overdueByCari.get(r.id) ?? [] } : {}),
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
    return { success: true, data: this.toRow(row) };
  }

  /**
   * KART → HESAP (Z-A ④): fatura/ödeme formu hesabı kod aramasıyla değil buradan bulur. YARATMAZ —
   * hesap yoksa 404 `CARI_ACCOUNT_MISSING` (kart doğuşu / göç script'i doldurur).
   */
  async findByCustomer(customerId: string): Promise<ApiResponse<CariListRow>> {
    const ref = await resolveCariAccountByCustomerTx(prisma, customerId);
    if (!ref) throw AppError.notFound("Bu kartın cari hesabı yok — kart hesabıyla doğar; eski kart için göç script'i koşulmalı.", { code: "CARI_ACCOUNT_MISSING", customerId });
    return this.findById(ref.id);
  }

  /** Z-A ⑤: kartın hesabına terim yaz (hesap yoksa doğar — `ensureCariAccountTx`); doğrulama + audit `update` yolunda. */
  async writeTermsForCustomer(customerId: string, input: Parameters<CariService["update"]>[1], userId?: string): Promise<string> {
    const accId = await prisma.$transaction(async (tx) => (await ensureCariAccountTx(tx, { customerId })).id);
    await this.update(accId, input, userId);
    return accId;
  }

  private toRow(row: Prisma.CariAccountGetPayload<{ include: typeof PARTY_SELECT & { balances: { select: { currency: true; balance: true } } } }>): CariListRow {
    const p = partyOf(row);
    return {
      id: row.id,
      kind: row.kind,
      code: p.code,
      roles: rolesOf(row),
      name: p.name,
      taxNumber: p.taxNumber,
      taxOffice: row.taxOffice,
      defaultCurrency: row.defaultCurrency,
      paymentTermDays: row.paymentTermDays,
      riskLimit: row.riskLimit,
      notes: row.notes,
      isActive: row.isActive,
      balances: row.balances,
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
    if ((input.customerId == null) === (input.subcontractorId == null)) {
      throw AppError.badRequest("Müşteri VEYA fason firma seçilmeli (ikisi birden değil).");
    }

    // Taraf gerçekten var mı + aktif mi (dış referans doğrulaması).
    if (input.customerId) {
      const c = await prisma.customer.findUnique({ where: { id: input.customerId }, select: { isActive: true } });
      if (!c) throw AppError.badRequest("Müşteri bulunamadı.");
      if (!c.isActive) throw AppError.badRequest("Müşteri pasif durumda.");
    } else {
      const s = await prisma.subcontractor.findUnique({
        where: { id: input.subcontractorId as string },
        select: { isActive: true },
      });
      if (!s) throw AppError.badRequest("Fason firma bulunamadı.");
      if (!s.isActive) throw AppError.badRequest("Fason firma pasif durumda.");
    }
    // Hesabın tek adresi kart: bağlı fason profili kartına çözülür (lazy yolla aynı çözücü).
    const { customerId, subcontractorId } = await resolvePartyToCardTx(prisma, input);

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
   * ⚠️ DEVİR MÜHÜRDEN OKUNUR (K5, 2026-08-14): devir düz aggregate DEĞİL,
   * `periodCloseService.resolveStatementOpening`un üç adımıyla çözülür —
   * `from`'dan önce biten en yeni AKTİF kapanışın MÜHÜRLÜ rakamı + kapanıştan
   * pencereye kadar biriken hareketler. Böylece kapanmış dönemin resmi rakamı
   * ile ekstre devri TEK kaynaktan gelir; kapanıştan sonra geçmişe sızmış bir
   * satır (guard atlaması) devri sessizce değiştiremez — o fark `verify`de
   * görünür. Kapanış YOKSA fallback bugünkü tek aggregate ile BAYT-BAYT aynıdır
   * (bekçi: `test_period_close` §11). Yanıttaki `carriedFrom` devrin dayandığı
   * kapanışı söyler (mühürsüz kurulumda `null` — istemciler alanı OPSİYONEL okur).
   *
   * ⚠️ AYRIM: mühürden okuyan yol yalnız bu SUNUM yüzeyidir. `verify` ve
   * yaşlandırma gibi DENETİM yüzeyleri BİLEREK yeniden hesaplar — drift alarmı
   * ancak bağımsız türetimle çalışır; oraları mühre bağlama.
   *
   * ⚠️ Para birimi ZORUNLU: iki para birimini tek ekstrede yürüyen bakiyeyle
   * göstermek matematiksel olarak anlamsızdır.
   */
  async statement(params: {
    cariId: string;
    currency: Currency;
    from: Date;
    to: Date;
    /**
     * Belge tipi süzgeci — YALNIZ `rows` dökümünü daraltır.
     *
     * @suzgec-ozet-degismez — özet/bakiye süzgeçten ETKİLENMEZ.
     * ⚠️ `opening`/`closing`/`totalDebit`/`totalCredit` ve `running` SÜZGEÇSİZ kalır
     * ve bu bir eksiklik değil, ekstrenin tanımıdır: yürüyen bakiye bütün
     * hareketlerden doğar. Süzgeç sorguya inseydi kolon "doğru görünen ama yanlış"
     * bir bakiye basardı — süzülen hareketler bakiyeyi yine değiştirmiş olurdu.
     */
    belgeTipi?: CariTxnSource;
  }): Promise<
    ApiResponse<{
      opening: Prisma.Decimal;
      closing: Prisma.Decimal;
      totalDebit: Prisma.Decimal;
      totalCredit: Prisma.Decimal;
      /** Devrin dayandığı dönem kapanışı — mühürsüz kurulumda `null`. */
      carriedFrom: { periodEnd: Date; closingBalance: Prisma.Decimal } | null;
      /** YALNIZ süzgeçliyken dolar; süzgeçsiz gövde bayt bayt eski. */
      suzgec?: SuzgecEcho;
      /**
       * Seçici kaynağı — pencerede GEÇEN belge tipleri. İkinci sorgu YOK ve bu
       * yapısaldır: süzgeç yalnız `rows` dökümüne uygulanıyor, `txns` süzgeçsiz
       * okunuyor ⇒ liste doğuştan süzgeçten bağımsız.
       *
       * ⚠️ `ad` HAM ENUM DEĞERİDİR ve bu bilinçli: Türkçe etiketlerin TEK KAYNAĞI
       * panelde (`Electron/src/lib/audit-labels.ts`, `test_audit_labels §4` her
       * enum değerinin karşılığını orada istiyor). Backend'e ikinci bir etiket
       * tablosu koymak "aynı soruyu cevaplayan koşul tek yerde yaşar" kuralının
       * doğrudan ihlali olurdu; panel kodu alır, etiketi kendi kataloğundan yazar.
       */
      secenekler: { belgeTipi: SebepSecenek[] };
      rows: Array<{
        id: string;
        txnDate: Date;
        description: string | null;
        sourceType: string;
        docNo: string | null;
        /** Satırı doğuran FATURANIN id'si — ekstre satırından belgeye tıkla-git
         *  (2026-08-15). `docNo` düz metindi; muhasebecinin en sık sorusu ("bu
         *  satır hangi fatura?") ancak Faturalar ekranında elle arayarak
         *  cevaplanabiliyordu. Fatura kaynaklı olmayan satırda `null`. */
        invoiceId: string | null;
        /** Satırı doğuran TAHSİLAT/ÖDEMENİN id'si. `invoiceId` ile AYRI alan:
         *  tek bir `documentId`, satırın türünü `sourceType`ten yeniden
         *  çıkarmayı zorunlu kılardı (o alan devir/storno satırlarında da dolu). */
        paymentId: string | null;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
        running: Prisma.Decimal;
        /** Bu satır bir ters kayıtsa: tersledigi satırın id'si (I3, 2026-08-14). */
        reversesTxnId: string | null;
        /** Bu satır TERSLENMİŞSE: onu tersleyen satırın id'si. Panel aktif-devir
         *  tespitini bu KESİN bilgiyle yapar (sezgisel sayım yalnız eski
         *  backend fallback'i olarak kaldı — `statementDevir.ts`). */
        reversedByTxnId: string | null;
      }>;
    }>
  > {
    const cari = await prisma.cariAccount.findUnique({ where: { id: params.cariId }, select: { id: true } });
    if (!cari) throw AppError.notFound("Cari hesap bulunamadı.");

    const resolved = await periodCloseService.resolveStatementOpening({
      cariId: params.cariId,
      currency: params.currency,
      from: params.from,
    });
    const opening = resolved.opening;

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
        // ⚠️ `id` DE TAŞINIR (2026-08-15): ekstre satırından belgeye TIKLA-GİT'in
        // ön koşulu. `docNo` düz metin olarak dönerken muhasebecinin en sık
        // sorusu ("bu satır hangi fatura?") ancak Faturalar ekranına gidip elle
        // arayarak cevaplanabiliyordu. Ek sorgu YOK — aynı ilişkiden bir kolon.
        invoice: { select: { id: true, docNo: true } },
        payment: { select: { id: true, docNo: true } },
        reversesTxnId: true,
        // Terslenme bilgisi SATIRIN KENDİSİNDE taşınır (I3): pencere kesmesi
        // sorununu kökten kaldırır — satır kendi terslenip terslenmediğini bilir.
        reversedBy: { select: { id: true } },
      },
    });

    let running = opening;
    let totalDebit = D0();
    let totalCredit = D0();
    let droppedRows = 0;
    // ⚠️ SIRA LOAD-BEARING: `running` ve toplamlar ÖNCE bütün hareketlerden
    // yürütülür, süzgeç SONRA uygulanır. Ters sırada ekstre süzgece göre değişen
    // bir bakiye basardı. Süzgeçli listede `running` ATLAYARAK ilerler — doğrudur.
    const rows = txns.flatMap((t) => {
      running = running.plus(D(t.debit)).minus(D(t.credit));
      totalDebit = totalDebit.plus(D(t.debit));
      totalCredit = totalCredit.plus(D(t.credit));
      if (params.belgeTipi !== undefined && t.sourceType !== params.belgeTipi) { droppedRows++; return []; }
      return [{
        id: t.id,
        txnDate: t.txnDate,
        description: t.description,
        sourceType: t.sourceType,
        docNo: t.invoice?.docNo ?? t.payment?.docNo ?? null,
        // Panel satırı doğru diyaloğa açsın diye İKİ ALAN AYRI: tek bir
        // `documentId` alanı, satırın fatura mı tahsilat mı olduğunu
        // `sourceType`ten yeniden çıkarmayı zorunlu kılardı (ve o alan devir/
        // storno satırlarında da dolu).
        invoiceId: t.invoice?.id ?? null,
        paymentId: t.payment?.id ?? null,
        debit: t.debit,
        credit: t.credit,
        reversesTxnId: t.reversesTxnId,
        reversedByTxnId: t.reversedBy?.id ?? null,
        running,
      }];
    });

    return {
      success: true,
      data: {
        opening,
        closing: running,
        totalDebit,
        totalCredit,
        carriedFrom: resolved.carriedFrom
          ? { periodEnd: resolved.carriedFrom.periodEnd, closingBalance: resolved.carriedFrom.closingBalance }
          : null,
        rows,
        ...(params.belgeTipi !== undefined
          ? { suzgec: { belgeTipi: params.belgeTipi, dusenSatir: droppedRows } }
          : {}),
        secenekler: { belgeTipi: reasonOptions(txns.map((t) => t.sourceType), () => undefined) },
      },
    };
  }
}

export const cariService = new CariService();
