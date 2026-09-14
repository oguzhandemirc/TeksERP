// =============================================================================
// İPLİK KG-STOK DEFTERİ (Paket D1) — tek yazar, append-only defter
// =============================================================================
// NEDEN VAR: İplik `Roll` DEĞİLDİR. Top metreyle ölçülür, barkodlanır, kesilir
// ve tek tek izlenir; iplik kg ile gelir, çuvaldan çuvala karışır ve tek tek
// izlenmez. İpliği `Roll` olarak modellemek her 25 kg'lık çuvala sahte bir
// barkod ve sahte bir "metraj" uydurmak olurdu — envanter ekranları o sahte
// metrajı toplayıp fabrikaya olmayan bir stok gösterirdi.
//
// ⚠️ TEK YAZAR KURALI: `YarnStock.balanceKg`'a YALNIZ bu dosya dokunur ve HER
// yazım AYNI transaction'da bir `YarnMovement` satırı doğurur. İkisi ayrışırsa
// bakiye sessizce yalan söyler — hata da log da çıkmaz, yalnız depo sayımı
// tutmaz ve kimse ne zaman saptığını bulamaz. Emsal: `CariBalance` ↔
// `CariTransaction` (`applyCariBalanceTx`). Yeni bir yüzey (fatura, üretim
// sarfiyatı, transfer) iplik stoğuna dokunacaksa `applyYarnMovementTx`'i
// ÇAĞIRIR; kendi `update`'ini YAZMAZ.
//
// ⚠️ BAKİYE NEGATİF OLABİLİR ve bu BİLİNÇLİDİR (DB'de CHECK yok). Sayım
// girilmeden çıkış yapılırsa bakiye gerçekten eksidir ve GÖRÜNMELİDİR. Çıkışı
// "bakiye yetmiyor" diye reddetmek sahayı durdurur (mal fiziksel olarak elde,
// eksik olan KAYIT); sıfıra kırpmak ise eksiği gizleyip envanteri sessizce
// yanlışlar — ikisi de yanlış cevaptır. Doğru cevap: YAZ ve UYAR.
//   ⚠️ BU VARSAYILAN DEĞİŞMEDİ. Üstüne OPT-IN bir kapı kondu:
//   `yarn.blockNegativeBalanceEnabled` AÇIKKEN yalnız `OUT` reddedilir
//   (`ADJUST_OUT` = sayım düzeltmesi + storno MUAF). Tek yüklem:
//   `helpers/yarn-balance-guard.helper.assertYarnBalanceCoversTx`, ve
//   `applyYarnMovementTx`in İÇİNDEN çağrılır — çağıran bazlı değil.
//
// ⚠️ SATIR SİLİNMEZ/DÜZELTİLMEZ: yanlış giriş TERS KAYITLA kapatılır
// (`ADJUST_OUT` / `ADJUST_IN`). Defter felsefesi cari/kasa ile aynı — geçmişi
// düzeltmek değil, düzeltmeyi de deftere yazmak. Bu yüzden bu serviste
// `update`/`delete` ucu YOKTUR ve eklenmemelidir.
//
// ⚠️ KAPSAM YALNIZ `ItemType.YARN`. `FABRIC` zaten `Roll` ile izleniyor ve
// buraya yazılırsa AYNI kalem için İKİ farklı stok rakamı doğar (hangisi
// doğru?). `CONSUMABLE` (boya/kimyasal) bilinçli olarak DIŞARIDA: onun da bir
// kg defteri olması gerekebilir ama bu ayrı bir üründür ve "iplik stoğu"
// başlığı altına sessizce sokulmamalı — bkz. rapor notu.
// =============================================================================
import { ItemType, Prisma, YarnMovementKind } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { yarnMovementSign } from "./helpers/yarn-sign.helper";
import { assertYarnBalanceCoversTx } from "./helpers/yarn-balance-guard.helper";
import { assertLotMatchesItemTx, normalizeLotNo, yarnLotBalancesTx } from "./helpers/yarn-lot.helper";
import { readIplikEnabled } from "./system-setting.service";
import { buildNextCursor, cursorWhere, decodeCursor } from "../utils/cursor";
import { buildTurkishSearch } from "../utils/query-parser";
import type { ApiResponse } from "../types/api.types";


type Tx = Prisma.TransactionClient;

/** `YarnStock.balanceKg` / `YarnMovement.qtyKg` kolon ölçeği — Decimal(14,3). */
const KG_SCALE = 3;

const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);

/**
 * `Decimal(14,3)` kolonunun taşma sınırı — tam kısım en fazla 11 hane.
 * Aşan değer PG'de `numeric field value out of range` ile patlar (ham İngilizce
 * mesaj, 500) — o yüzden sınır BURADA, Türkçe ve 400 olarak söylenir.
 */
const MAX_KG = new Prisma.Decimal("100000000000");

/**
 * Serbest metin miktarı Decimal'e çevirir — ÇEVİREMEZSE 400 DÖNER, 500 DEĞİL.
 *
 * ⚠️ NEDEN AYRI FONKSİYON: `new Prisma.Decimal("12,5")` düz bir `Error` fırlatır
 * (`[DecimalError] Invalid argument`), `AppError` değil → `error.middleware`
 * onu 500 "Sunucu hatası oluştu." yapar. Bu, sahada EN OLASI yazım hatasının
 * (Türkçe klavyede ondalık ayırıcı VİRGÜLDÜR) operatöre "sistem bozuldu" diye
 * görünmesi demekti: yaptığı şeyin yanlış olduğunu söyleyen tek kelime yok,
 * destek ekibi sunucu log'u aramaya gider. Panel input'u metin gönderdiği için
 * bu yol gerçek ve sık.
 *
 * ⚠️ VİRGÜL SESSİZCE NOKTAYA ÇEVRİLMEZ: "1,500" bu ülkede hem "1.5" hem "1500"
 * okunabilir ve tahmin etmek, deftere yanlış rakam yazmanın en sessiz yoludur.
 * Doğru davranış reddedip DOĞRU YAZIMI SÖYLEMEKTİR.
 */
function toKgDecimal(raw: number | string): Prisma.Decimal {
  let dec: Prisma.Decimal;
  try {
    dec = new Prisma.Decimal(typeof raw === "string" ? raw.trim() : raw);
  } catch {
    throw AppError.badRequest(
      `Miktar sayı olarak okunamadı ("${String(raw).slice(0, 32)}"). Ondalık ayırıcı NOKTA'dır — "12,5" değil "12.5" yazın.`,
    );
  }
  if (!dec.isFinite()) throw AppError.badRequest("Miktar geçerli bir sayı değil.");
  if (dec.abs().gte(MAX_KG)) {
    throw AppError.badRequest("Miktar çok büyük (en fazla 11 haneli kg girilebilir). Fazladan sıfır yazılmış olabilir.");
  }
  return dec;
}

/**
 * Hareketin BAKİYEYE etkisinin işareti.
 *
 * ⚠️ Miktar HER ZAMAN POZİTİFTİR (DB CHECK `yarn_movements_qty_positive` ile
 * kilitli); yönü YALNIZ `kind` söyler. İşaretli tek bir miktar alanı, bir gün
 * birinin `Math.abs()` yazıp eksi sayım farkını artı saymasına açık kapı
 * bırakırdı — ve o hata deftere doğru görünen bir satır olarak yazılırdı.
 */
export interface YarnMovementTxInput {
  itemId: string;
  warehouseId: string;
  kind: YarnMovementKind;
  /** POZİTİF kg. Yön `kind`ten gelir. */
  qtyKg: Prisma.Decimal.Value;
  goodsReceiptId?: string | null;
  invoiceId?: string | null;
  /**
   * Satırı doğuran TAM SAYIM (J2 #19). Tipli bağ — serbest `reason` metni
   * aranabilir değildir ve "bu sayım hangi düzeltmeleri yazdı" sorusu LIKE ile
   * cevaplanamaz (`goodsReceiptId` emsali).
   */
  stockCountId?: string | null;
  reason?: string | null;
  userId?: string | null;
  /** Devere 1b: WARP_* türlerinde ZORUNLU (CHECK), diğerlerinde YAZILMAZ. */
  warpBeamId?: string | null;
  /** WARP_RETURN(_REVERSAL): dip kaderi — `ReasonPresetKind.WARP_RETURN` kodu (sunucuda doğrulanır). */
  reasonCode?: string | null;
  /** Devere Faz 2: tedarikçi lotu (nullable). Lot kalemi hareket kalemiyle aynı olmalı; lot etiketli çıkış lot bakiyesini aşamaz. */
  lotId?: string | null;
  /** Bobin adedi — bilgi, bakiye değil (DB CHECK > 0). */
  bobbinCount?: number | null;
}

export interface YarnMovementTxResult {
  movementId: string;
  /** Hareketten SONRAKİ bakiye (DB'nin döndürdüğü değer — JS'te hesaplanmaz). */
  balanceKg: Prisma.Decimal;
}

/**
 * DEFTERE TEK YAZMA KAPISI — hareket satırı + denormalize bakiye, tek tx.
 *
 * ⚠️ Bakiye TEK BİR ATOMİK `INSERT … ON CONFLICT DO UPDATE` ile yazılır:
 *   • Prisma `upsert`in "önce ara, yoksa yarat" davranışına GÜVENİLMEZ — aynı
 *     kalem/depo için iki eşzamanlı ilk hareket ikisi de "satır yok" görüp
 *     INSERT dener, biri P2002 alır ve PG'de HATA ALAN İFADE TÜM TRANSACTION'I
 *     ABORT EDER (Prisma interactive tx savepoint kullanmaz) → hatayı yakalayıp
 *     devam etmek MÜMKÜN DEĞİLDİR. `ON CONFLICT` hiç hata üretmez.
 *   • Toplama DB tarafında yapılır (`+ EXCLUDED`), JS'te değil: okuyup-yazmak
 *     iki eşzamanlı hareketten birinin etkisini sessizce yutardı ve float
 *     aritmetiği zaten YASAK (perf/doğruluk kuralı).
 * `RETURNING` ile yeni bakiye geri okunur — ikinci bir SELECT yarışa açıktır
 * (arada başka bir hareket commit'lenirse operatöre yanlış bakiye söylenir).
 *
 * Miktar 3 haneye YUVARLANIR: kolon `Decimal(14,3)` ve PG zaten yuvarlar;
 * JS tarafında da yuvarlamazsak defter satırı ile bizim gösterdiğimiz rakam
 * son hanede ayrışır.
 */
export async function applyYarnMovementTx(tx: Tx, input: YarnMovementTxInput): Promise<YarnMovementTxResult> {
  // ⚠️ MODÜL KAPISI — GÖVDENİN İLK İŞİ, ÇAĞIRAN BAZLI DEĞİL (2026-09-02, D1 #2).
  // Ölçülmüş boşluk: `goods-receipt` ve `stock-count` router'ları yalnız
  // `requireTicaretEnabled` taşır; ticaret AÇIK + iplik KAPALI bir kurulumda o
  // iki yüzey kapıdan geçip kg defterine GERÇEKTEN yazıyordu (K10'un fatura
  // için kapattığı sızıntının birebir ikizi). Route kapısı çözüm DEĞİL: o
  // zaman KUMAŞ mal kabulü ve kumaş sayımı da iplik modülüne bağlanırdı.
  // Doğru yer TEK YAZAR'ın içidir — "yeni çağıran kapısız doğamaz" (eksi
  // bakiye guard'ıyla aynı gerekçe, birkaç satır aşağıda).
  // ⚠️ TEK KAYNAK: çağıranlara (goods-receipt · stock-count · invoice · yarn
  // servisinin kendi uçları) AYRICA kontrol EKLENMEZ — ikinci kopya bir gün
  // ayrışır ve hangisinin doğru olduğu sorusu doğar.
  // ⚠️ `tx` ile okunur (kendi transaction'ının gördüğü değer), CACHE'siz.
  if (!(await readIplikEnabled(tx))) {
    throw AppError.forbidden(
      "İplik modülü bu kurulumda kapalı — iplik hareketi yazılamaz. " +
        "Genel Ayarlar → Modüller bölümünden açılabilir.",
      { code: "MODULE_DISABLED", modul: "iplik" },
    );
  }

  const qty = D(input.qtyKg).toDecimalPlaces(KG_SCALE, Prisma.Decimal.ROUND_HALF_UP);
  if (qty.lte(0)) {
    // İkinci hat DB CHECK'idir; burada erken ve Türkçe hata veriyoruz ki
    // operatör ham PG mesajı yerine ne yaptığını anlatan bir cümle görsün.
    throw AppError.badRequest("İplik hareketi miktarı sıfırdan büyük olmalı (yön `kind` ile verilir).");
  }

  // ⚠️ EKSİ BAKİYE ENGELİ (opt-in `yarn.blockNegativeBalanceEnabled`) — TEK
  // YAZAR kapısının İÇİNDE, her iki yazımdan da ÖNCE. Çağıran bazlı olsaydı
  // yarın eklenen beşinci çağıran guard'ı yazmayı unutur ve eksi bakiye tam
  // ondan sızardı; burada "yeni çağıran guard'sız doğamaz". Bayrak kapalıyken
  // ve `OUT` dışındaki türlerde tek ek sorgu bile koşmaz (sıra load-bearing —
  // gerekçe helper başlığında). Muafiyet: `ADJUST_OUT` = sayım düzeltmesi +
  // belge stornosu; guard oraya GENİŞLETİLMEZ (test_yarn_stock §10).
  // Lot beyanı varsa önce KİMLİK: lot bu kalemin mi, aktif mi (çapraz-tablo CHECK yok).
  if (input.lotId) await assertLotMatchesItemTx(tx, input.lotId, input.itemId);
  await assertYarnBalanceCoversTx(tx, {
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    kind: input.kind,
    qtyKg: qty,
    lotId: input.lotId ?? null,
  });

  const movement = await tx.yarnMovement.create({
    data: {
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      kind: input.kind,
      qtyKg: qty,
      goodsReceiptId: input.goodsReceiptId ?? null,
      invoiceId: input.invoiceId ?? null,
      // ⚠️ Bu nesne bir ALLOWLIST'tir (elle kurulan gövde dersi): `YarnMovementTxInput`e
      // eklenip BURAYA yazılmayan alan SESSİZCE düşer ve bağ hiç kurulmaz.
      stockCountId: input.stockCountId ?? null,
      reason: input.reason?.trim() || null,
      userId: input.userId ?? null,
      warpBeamId: input.warpBeamId ?? null, reasonCode: input.reasonCode ?? null,
      lotId: input.lotId ?? null, bobbinCount: input.bobbinCount ?? null,
    },
    select: { id: true },
  });

  const delta = qty.mul(yarnMovementSign(input.kind));

  // ⚠️ `id` DB DEFAULT'u YOK (Prisma `@default(uuid())` UYGULAMA tarafındadır) →
  // ham INSERT'te elle üretilir; unutulursa NOT NULL ihlali alınır.
  const rows = await tx.$queryRaw<Array<{ balanceKg: Prisma.Decimal }>>`
    INSERT INTO "yarn_stocks" ("id", "itemId", "warehouseId", "balanceKg", "createdAt", "updatedAt")
    VALUES (${randomUUID()}::uuid, ${input.itemId}::uuid, ${input.warehouseId}::uuid, ${delta.toString()}::numeric, now(), now()) -- tz-ok: yarn_stocks.createdAt/updatedAt timestamptz, oturum UTC
    ON CONFLICT ("itemId", "warehouseId") DO UPDATE
      SET "balanceKg" = "yarn_stocks"."balanceKg" + EXCLUDED."balanceKg",
          "updatedAt" = now() -- tz-ok: yarn_stocks.updatedAt timestamptz, oturum UTC
    RETURNING "balanceKg"
  `;

  const balanceKg = rows[0] ? D(rows[0].balanceKg) : delta;
  return { movementId: movement.id, balanceKg };
}

// -----------------------------------------------------------------------------
// SERVİS
// -----------------------------------------------------------------------------

export interface YarnStockRow {
  id: string;
  balanceKg: Prisma.Decimal;
  item: { id: string; code: string; name: string; unit: string };
  warehouse: { id: string; code: string; name: string };
  updatedAt: Date;
}

export interface YarnMovementCreateInput {
  itemId: string;
  warehouseId: string;
  kind: YarnMovementKind;
  qtyKg: number | string;
  reason?: string | null;
  /** Devere Faz 2: elle hareket lot etiketi taşıyabilir (opsiyonel). */
  lotId?: string | null;
}

export class YarnService {
  /**
   * Kalem × depo bakiyeleri.
   *
   * `onlyNonZero` OPT-IN'dir: sıfır bakiyeli satır gürültüdür ama "bu iplik
   * buradaydı, bitti" bilgisi de gerçek bir cevaptır — hangisinin istendiğine
   * ekran karar verir, servis varsayım yapmaz.
   */
  async listStocks(params: {
    page?: number;
    pageSize?: number;
    itemId?: string | string[];
    warehouseId?: string | string[];
    onlyNonZero?: boolean;
    search?: string;
  }): Promise<{ success: true; data: YarnStockRow[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; totals: { balanceKg: string } }> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));

    const where: Prisma.YarnStockWhereInput = {};
    // ⚠️ CSV/çoklu seçim: tek değer → düz eşitlik (mevcut sorgu şekli korunur),
    // N değer → `in`. Ham CSV'yi uuid kolonuna geçirmek P2007 → 400 üretir
    // (2026-08-06 çoklu seçim dersi).
    const idCond = (v: string | string[] | undefined): string | { in: string[] } | undefined => {
      const list = (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((s) => s.trim()).filter(Boolean);
      if (list.length === 0) return undefined;
      return list.length === 1 ? list[0]! : { in: list };
    };
    const itemCond = idCond(params.itemId);
    const whCond = idCond(params.warehouseId);
    if (itemCond) where.itemId = itemCond;
    if (whCond) where.warehouseId = whCond;
    if (params.onlyNonZero) where.NOT = { balanceKg: 0 };
    if (params.search?.trim()) {
      // ⚠️ TÜRKÇE-DUYARLI ARAMA ZORUNLU — bu, düz `contains + insensitive`in
      // KESİN KIRIK olduğu yer: `Item.name` `normalizeItemName` ile tr-TR
      // BÜYÜĞE çevrilerek saklanıyor ("PENYE") ve ILIKE noktalı/noktasız i'yi
      // katlamaz (kural + gerekçe: `query-parser.ts`) → "penye" yazan kullanıcı
      // kaydı HİÇBİR ZAMAN bulamaz; hata da log da çıkmaz, liste boş döner.
      where.item = { OR: buildTurkishSearch(params.search, ["name", "code"]) };
    }

    const [rows, total, agg] = await Promise.all([
      prisma.yarnStock.findMany({
        where,
        // Çok stoklu depoda operatörün aradığı satır "en çok olan"dır.
        orderBy: [{ balanceKg: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          balanceKg: true,
          updatedAt: true,
          item: { select: { id: true, code: true, name: true, unit: true } },
          warehouse: { select: { id: true, code: true, name: true } },
        },
      }),
      prisma.yarnStock.count({ where }),
      prisma.yarnStock.aggregate({ where, _sum: { balanceKg: true } }),
    ]);

    return {
      success: true,
      data: rows as YarnStockRow[],
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      // Toplam SAYFANIN değil FİLTRENİN toplamıdır — "depoda ne kadar iplik var"
      // sorusunun cevabı sayfa 1'in toplamı değildir.
      totals: { balanceKg: (agg._sum.balanceKg ?? D(0)).toString() },
    };
  }

  /**
   * Hareket dökümü — CURSOR'lu.
   *
   * ⚠️ Offset DEĞİL: defter append-only ve yıllarca büyür (`RollMovement`
   * emsali); `OFFSET 50000` her sayfada 50k satır tarardı.
   */
  async listMovements(params: {
    limit?: number;
    cursor?: string;
    itemId?: string;
    warehouseId?: string;
    kind?: YarnMovementKind;
    goodsReceiptId?: string;
    lotId?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<{ success: true; data: unknown[]; nextCursor: string | null }> {
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));

    const where: Prisma.YarnMovementWhereInput = {};
    if (params.itemId) where.itemId = params.itemId;
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    if (params.kind) where.kind = params.kind;
    if (params.goodsReceiptId) where.goodsReceiptId = params.goodsReceiptId;
    if (params.lotId) where.lotId = params.lotId;
    if (params.dateFrom || params.dateTo) {
      where.createdAt = {
        ...(params.dateFrom ? { gte: params.dateFrom } : {}),
        ...(params.dateTo ? { lte: params.dateTo } : {}),
      };
    }

    const cur = decodeCursor(params.cursor);
    const finalWhere: Prisma.YarnMovementWhereInput = cur ? { AND: [where, cursorWhere(cur)] } : where;

    const rows = await prisma.yarnMovement.findMany({
      where: finalWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        kind: true,
        qtyKg: true,
        reason: true,
        createdAt: true,
        goodsReceiptId: true,
        invoiceId: true,
        item: { select: { id: true, code: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, fullName: true, username: true } },
        goodsReceipt: { select: { id: true, receiptNo: true } },
        lot: { select: { id: true, lotNo: true } },
        bobbinCount: true,
      },
    });

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return { success: true, data, nextCursor: hasMore ? buildNextCursor(data[data.length - 1]) : null };
  }

  /**
   * Elle hareket: giriş / çıkış / sayım düzeltmesi.
   *
   * Dış referanslar (kalem, depo) VAR MI + AKTİF Mİ diye doğrulanır — pasif
   * depoya stok yazmak, o depo kapatıldığı hâlde envanterin orada mal
   * göstermesi demektir.
   */
  async createMovement(input: YarnMovementCreateInput, userId?: string): Promise<ApiResponse<{
    id: string;
    balanceKg: string;
    negative: boolean;
  }>> {
    // ⚠️ `toKgDecimal` ÖNCE: ham `new Decimal()` çağrısı geçersiz metinde 500
    // üretiyordu (yukarıdaki gerekçe). Yuvarlama ondan SONRA gelir.
    const qty = toKgDecimal(input.qtyKg).toDecimalPlaces(KG_SCALE, Prisma.Decimal.ROUND_HALF_UP);
    if (qty.lte(0)) {
      throw AppError.badRequest("Miktar sıfırdan büyük olmalı. Çıkış için miktarı eksi yazmayın — işlem türünü (Çıkış) seçin.");
    }

    const item = await prisma.item.findUnique({
      where: { id: input.itemId },
      select: { id: true, name: true, code: true, itemType: true, isActive: true },
    });
    if (!item) throw AppError.badRequest("Kalem bulunamadı.");
    if (!item.isActive) throw AppError.badRequest(`"${item.name}" pasif durumda.`);
    if (item.itemType !== ItemType.YARN) {
      // Sessizce yazmak, aynı kalem için biri `Roll` biri kg olmak üzere İKİ
      // stok rakamı doğururdu ve hangisinin doğru olduğu sorulamazdı.
      throw AppError.badRequest(
        `"${item.name}" bir iplik kalemi değil (${item.itemType}). İplik stok defteri yalnız İPLİK kalemlerini taşır; ` +
          `kumaş stoğu top (Roll) olarak izlenir.`,
      );
    }

    const wh = await prisma.warehouse.findUnique({
      where: { id: input.warehouseId },
      select: { id: true, name: true, isActive: true },
    });
    if (!wh) throw AppError.badRequest("Depo bulunamadı.");
    if (!wh.isActive) throw AppError.badRequest(`"${wh.name}" deposu pasif — bu depoya stok hareketi yazılamaz.`);

    const res = await prisma.$transaction((tx) =>
      applyYarnMovementTx(tx, {
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        kind: input.kind,
        qtyKg: qty,
        reason: input.reason ?? null,
        userId: userId ?? null,
        lotId: input.lotId ?? null,
      }),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "YARN_MOVEMENT",
      recordId: res.movementId,
      newData: {
        itemId: input.itemId,
        itemCode: item.code,
        warehouseId: input.warehouseId,
        kind: input.kind,
        qtyKg: qty.toString(),
        balanceAfter: res.balanceKg.toString(),
        reason: input.reason ?? null,
      },
    });

    const negative = res.balanceKg.lt(0);
    const sign = yarnMovementSign(input.kind) > 0 ? "+" : "−";
    return {
      success: true,
      data: { id: res.movementId, balanceKg: res.balanceKg.toString(), negative },
      // ⚠️ Eksi bakiye ENGEL DEĞİL UYARIDIR — ve mutlaka SÖYLENİR. Sessiz eksi
      // bakiye, sayım yapılana kadar kimsenin fark etmediği bir hatadır.
      message: negative
        ? `${sign}${qty.toString()} kg yazıldı. ⚠️ "${item.name}" / "${wh.name}" bakiyesi EKSİDE: ${res.balanceKg.toString()} kg — açılış/sayım girişi eksik olabilir.`
        : `${sign}${qty.toString()} kg yazıldı. Yeni bakiye: ${res.balanceKg.toString()} kg.`,
    };
  }
}

export const yarnService = new YarnService();
export default yarnService;
