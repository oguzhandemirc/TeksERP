// =============================================================================
// DEPO ÇÖZÜCÜ — "bu top hangi depoya yazılacak?" sorusunun TEK cevabı.
// =============================================================================
// Fabrika akışlarının hiçbiri depo parametresi GÖNDERMEZ (KK1 girişi, tambur
// finalize/kesim, fason dönüşü…). Onların hepsi buradan varsayılan depoya düşer
// ve davranışları güncelleme öncesiyle bayt-bayt aynı kalır. Depoyu yalnız
// ticaret akışları (mal kabul, transfer) açıkça verir.
//
// ⚠️ Kural tek yerde durur. Her `roll.create` noktasına "depo yoksa varsayılanı
// bul" mantığı kopyalanırsa biri gün gelir farklı davranır (giriş istasyonu
// helper'ının başındaki 12-yol envanteri tam bu yüzden yazılmıştı).
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { bilgi, uyari } from "../../lib/logger";
import { p2002Mentions } from "../../utils/p2002";

type Db = Prisma.TransactionClient | typeof prisma;

/** Uzlaştırmanın doğurduğu varsayılan deponun sabit kodu. */
export const DEFAULT_WAREHOUSE_CODE = "DP-MERKEZ";
export const DEFAULT_WAREHOUSE_NAME = "Merkez Depo";

export type DefaultWarehouseResult = {
  action: "exists" | "promoted" | "created";
  id: string;
  name: string;
};

/**
 * Varsayılan deponun id'si (yoksa null).
 *
 * CACHE YOK — bilinçli: `warehouses` tek haneli satır sayısına sahip ve sorgu
 * partial unique index üzerinden koşuyor (<1 ms). Süreç-içi cache, ikinci bir
 * backend süreci varsayılanı değiştirdiğinde sessizce bayatlardı; kazanç ölçülebilir
 * değil, risk gerçek.
 */
export async function getDefaultWarehouseId(db: Db = prisma): Promise<string | null> {
  const row = await db.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  return row?.id ?? null;
}

/**
 * Yazılacak depoyu çözer.
 *
 * • `explicitId` verilmişse: VAR ve AKTİF olmalı, aksi halde 400. Açık bir kullanıcı
 *   seçimi sessizce başka bir depoya sapmamalı — sapsaydı mal "yanlış depoda"
 *   görünür ve kimse fark etmezdi.
 * • Verilmemişse: varsayılan depo.
 * • Varsayılan da yoksa: UZLAŞTIRMA ÇAĞRILIR (`ensureDefaultWarehouse`), sonra
 *   tekrar okunur. O da başarısızsa **409 FIRLATIR** — `null` DÖNMEZ.
 *
 * ⚠️ 2026-09-12'de FAIL-OPEN KAPANDI. Eski davranış `null` dönüp gürültülü
 * loglamaktı; gerekçesi *"reddetmek üretim kaydını durdurur"* idi. Ölçüldü ki o
 * gerekçenin karşılığı YOK: `ensureDefaultWarehouse` varsayılan yoksa depoyu
 * KENDİ YARATIR (yoksa terfi eder, hiç yoksa DP-MERKEZ'i doğurur). Yani
 * "varsayılan yok" durumu ancak o yaratmanın DÜŞTÜĞÜ durumdur — DB yazılamıyor
 * demektir ve üretim kaydı zaten durmuştur. Fail-open hiçbir kullanılabilirlik
 * satın almıyordu; yalnız bir hata mesajını SESSİZ bir veri kusuruna çeviriyordu
 * (`WAREHOUSE` statüsü "mal depoda" der, `warehouseId: null` "hangi depo?" —
 * kendi kendini yalanlayan satır).
 */
export async function resolveTargetWarehouseId(
  db: Db = prisma,
  explicitId?: string | null,
): Promise<string> {
  if (explicitId) {
    const w = await db.warehouse.findUnique({
      where: { id: explicitId },
      select: { id: true, isActive: true, name: true },
    });
    if (!w) throw AppError.badRequest("Seçilen depo bulunamadı.");
    if (!w.isActive) throw AppError.badRequest(`"${w.name}" deposu pasif durumda — mal bu depoya alınamaz.`);
    return w.id;
  }

  const fallback = await getDefaultWarehouseId(db);
  if (fallback) return fallback;

  // ⚠️ UZLAŞTIRMA TABAN İSTEMCİDE, ÇAĞIRANIN TX'İNDE DEĞİL — üç sebep:
  //   (1) P2002 kurtarması açık tx'te ÇALIŞMAZ: PostgreSQL'de herhangi bir ifade
  //       hatası tx'i ABORTED yapar (25P02) ve Prisma savepoint açmaz; yarış
  //       yakalanamadığı gibi çağıranın işlemi de düşerdi.
  //   (2) Çağıranın tx'i rollback olursa depo da geri alınır — master data
  //       rastgele bir kullanıcının işlemine bağlanmamalı.
  //   (3) Advisory kilit gerekmiyor: yarışı iki UNIQUE kapatıyor
  //       (`warehouses_code_key` + `warehouses_isDefault_key` partial) ve
  //       `ensureDefaultWarehouse` P2002'yi okuyup "exists"e düşüyor.
  // GÖRÜNÜRLÜK: repo READ COMMITTED (bkz. `shipping.service.ts` izolasyon notu),
  // yani dışarıda commit edilen satır açık tx'in SONRAKİ ifadesinde görünür.
  // ⚠️ Bu varsayım `RepeatableRead`e geçilirse KIRILIR — o zaman çözüm tx'i
  // açmadan ÖNCE çağırmaktır.
  await ensureDefaultWarehouse();
  const sonra = await getDefaultWarehouseId(db);
  if (sonra) return sonra;

  throw AppError.conflict(
    "Varsayılan depo yok ve oluşturulamadı — mal deposuz kaydedilemez. " +
      "Tanımlar → Depolar'dan bir depo açıp varsayılan yapın.",
  );
}

/**
 * DEPOYA GİRİŞ DAMGASI — `status: WAREHOUSE` yazan HER yolun ortak yükü.
 *
 * Topun deposu varsa DOKUNMAZ (boş nesne döner); yoksa çözümleyiciden alır.
 * Çağrı yerinde `data: { status: WAREHOUSE, ...(await warehouseStampTx(tx, r.warehouseId)) }`.
 *
 * ⚠️ NEDEN AYRI HELPER (2026-09-12): doğuş yolları zaten `resolveTargetWarehouseId`
 * boğazından geçiyordu, ama TERFİ yolları (`status`u WAREHOUSE'a çeken atomik
 * claim'ler) `warehouseId`ye HİÇ dokunmuyordu. Deposu olan top için sorun yok;
 * OLMAYAN top orada "depoda ama deposuz" satırına dönüşüyordu. Beş terfi yolu
 * var ve hepsinin aynı soruyu aynı şekilde cevaplaması gerekiyor — kopyalanırsa
 * biri gün gelir farklı davranır.
 *
 * ⚠️ ÜZERİNE YAZMAZ: topun mevcut deposu KORUNUR. Terfi malı TAŞIMAZ; "sevkten
 * geri dönen top hangi depodaydıysa oraya döner" kuralı budur.
 */
export async function warehouseStampTx(
  db: Db,
  mevcutWarehouseId: string | null,
): Promise<{ warehouseId?: string }> {
  if (mevcutWarehouseId) return {};
  return { warehouseId: await resolveTargetWarehouseId(db) };
}

/**
 * TOPLU terfi yollarının damgası — `warehouseStampTx`in çoklu ikizi.
 *
 * Toplu `updateMany`de her topun mevcut deposu farklı olabilir, tek bir `data`
 * parçası hepsine uymaz. Bu yüzden damga AYRI ve DAR bir yazımdır:
 * `warehouseId IS NULL` olanlara varsayılanı yazar, dolu olanlara DOKUNMAZ.
 * Terfi claim'inden SONRA çağrılır ve döndürdüğü sayı damgalanan top sayısıdır.
 *
 * ⚠️ Hiç deposuz top yoksa çözümleyici HİÇ çağrılmaz — yani normal fabrikada
 * (varsayılan depo yerinde, toplar damgalı) bu yol fazladan tek sorgu bile
 * üretmez, yalnız bir `count` okur.
 */
export async function warehouseStampManyTx(db: Db, rollIds: string[]): Promise<number> {
  if (rollIds.length === 0) return 0;
  const eksik = await db.roll.count({ where: { id: { in: rollIds }, warehouseId: null } });
  if (eksik === 0) return 0;
  const targetWarehouseId = await resolveTargetWarehouseId(db);
  const res = await db.roll.updateMany({
    where: { id: { in: rollIds }, warehouseId: null },
    data: { warehouseId: targetWarehouseId },
  });
  return res.count;
}

/**
 * Varsayılan deponun VARLIĞINI garanti eder. İdempotent; süreç başına bir kez
 * gerçekten koşar, sonuç `null`sa (hata) bir sonraki çağrı tekrar dener.
 *
 * SÖZLEŞME (2026-08 kararı, korunuyor):
 *   • Varsayılan VARSA hiçbir şey yapılmaz.
 *   • Depo(lar) var ama hiçbiri varsayılan DEĞİLSE → EN ESKİSİ terfi eder.
 *     (Sessizce ikinci bir "Merkez Depo" doğurmak envanteri ikiye bölerdi.)
 *   • Hiç depo yoksa → `DP-MERKEZ` doğar.
 *
 * ⚠️ BURADA YAŞIYOR, JOB'DA DEĞİL (2026-09-12): çözümleyici bunu ihtiyaç anında
 * çağırıyor ve job zaten bu dosyadan sabit alıyordu — fonksiyonu job'da bırakmak
 * DAİRESEL import olurdu. `jobs/default-warehouse.job.ts` bunu yeniden dışa
 * açar, o yüzden 17 çağrı yerinin import yolu DEĞİŞMEDİ.
 */
export async function ensureDefaultWarehouse(): Promise<DefaultWarehouseResult> {
  const existing = await prisma.warehouse.findFirst({
    where: { isDefault: true },
    select: { id: true, name: true },
  });
  if (existing) return { action: "exists", id: existing.id, name: existing.name };

  const oldest = await prisma.warehouse.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (oldest) {
    await prisma.warehouse.update({ where: { id: oldest.id }, data: { isDefault: true } });
    uyari("warehouse", `Varsayılan depo işaretli değildi — en eski depo ("${oldest.name}") varsayılan yapıldı.`);
    return { action: "promoted", id: oldest.id, name: oldest.name };
  }

  try {
    const created = await prisma.warehouse.create({
      data: { code: DEFAULT_WAREHOUSE_CODE, name: DEFAULT_WAREHOUSE_NAME, isDefault: true },
      select: { id: true, name: true },
    });
    bilgi("warehouse", `Varsayılan depo oluşturuldu: ${created.name} (${DEFAULT_WAREHOUSE_CODE})`);
    return { action: "created", id: created.id, name: created.name };
  } catch (err) {
    // Yarış: başka bir süreç/istek aynı anda yarattı (kod VEYA isDefault partial
    // unique çarptı) → onun yarattığını oku. Bu `catch`in çalışabilmesi, bu
    // fonksiyonun ÇAĞIRANIN TX'İ DIŞINDA koşmasına bağlıdır (yukarıdaki not).
    if (p2002Mentions(err, /warehouses_(code_key|isDefault_key)/)) {
      const now = await prisma.warehouse.findFirst({
        where: { isDefault: true },
        select: { id: true, name: true },
      });
      if (now) return { action: "exists", id: now.id, name: now.name };
    }
    throw err;
  }
}
