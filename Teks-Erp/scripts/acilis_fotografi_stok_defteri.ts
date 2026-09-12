// =============================================================================
// AÇILIŞ FOTOĞRAFI — stok defterinin doğruluk başlangıcı (OPENING_BALANCE)
// =============================================================================
//   npx tsx scripts/acilis_fotografi_stok_defteri.ts                    → KURU KOŞUM (varsayılan)
//   npx tsx scripts/acilis_fotografi_stok_defteri.ts --apply --onay=<N> → fotoğrafı yazar
//
// NEDEN (tasarım docs/design/DEPO-STOK-DEFTERI-TASARIM.md §D6): bugünkü defter
// depodaki topların çoğunun girişini hiç görmedi (statü terfisi satır yazmıyordu,
// üretimden depoya iniş A2'ye kadar yazılmıyordu). Eksikleri tek tek tamamlamak
// yüzlerce topa GERİYE DÖNÜK giriş uydurmak demek ve "ters kayıt bugüne yazılır"
// ilkesiyle çelişir. Fotoğraf geçmişi uydurmaz: kesme ANINDA stok kümesindeki
// HER topa "beyan edilmiş sayım" satırı yazar (SAP 561 emsali — fiziksel hareket
// yok). Defterin Σ'sı bu andan başlar; öncesi TARİHSEL İZDİR ve yeniden
// yorumlanmaz — bunun mekanik karşılığı `preEpoch` damgasıdır (migration
// 20260912150000): fotoğraftan önceki her satır preEpoch=true olur, as-of/Σ
// okumaları onları dışarıda bırakır.
//
// ⚠️ bb709bd9 ("tambur finalize çocuğu depoya girişi yazıyor — 516 topluk delik")
// BACKFILL DEĞİLDİR: o commit İLERİYE dönük yazar, geçmişteki 516 top BU
// fotoğrafla kapanır. Bir sonraki okuyan bunu backfill sanmasın.
//
// KAPSAM (tek kaynak: WAREHOUSE_STOCK_STATUSES ∧ warehouseId NOT NULL ∧ currentQty > 0):
//   her top için tek satır: eventType OPENING_BALANCE · to = {warehouseId, status} ·
//   qty = currentQty · reasonCode OPENING · from yok. Tek yazma kapısından
//   (`postStockMoves`, 0 metrajı FIRLATIR — o yüzden 0 m toplar önce ayıklanır ve
//   ATLANAN olarak listelenir).
//
// ÖN KOŞULLAR (üçü de sağlanmadan --apply DURUR):
//   ① warehouseId backfill bitmiş olmalı: stok kümesinde deposuz top KALMAMALI
//      (scripts/backfill_roll_warehouse.ts). Deposuz top listelenir, fotoğraf çekilmez.
//   ② Fason dönüşü ENTRY onarımı bitmiş olmalı (scripts/onarim_fason_donus_entry.ts):
//      açık aday kaldıysa uyarır — o satırlar preEpoch'a düşer, Σ etkilenmez, ama
//      GO/NO-GO #1 gereği önce kapanmalı (uyarı, engel değil).
//   ③ Daha önce fotoğraf çekilmemiş olmalı: OPENING_BALANCE satırı varsa DURUR
//      (fotoğraf bir kez çekilir; ikinci fotoğraf ayrı bir karardır).
//   ④ SESSİZ PENCERE: fotoğraf YAZMA TRAFİĞİ DURMUŞKEN çekilir (backend durdurulmuş ya
//      da vardiya dışı). Aksi hâlde `preEpoch` damgası ile fotoğraf satırları arasında
//      başka bir istek defter satırı yazarsa o satır kronolojik olarak epoch'tan ÖNCE
//      olduğu hâlde preEpoch=false kalır ve epoch ilk günden delinir. Script son 120 sn
//      içinde defter yazımı görürse `--apply`yi REDDEDER (kuru koşumda uyarır).
//   ⑤ HEDEF: `--apply` ayrıca `--hedef=<db-adı>` ister ve DATABASE_URL'den çözülen adla
//      birebir tutmazsa DURUR; başlık her koşumda DB adı + host basar. `--onay` kaç satır,
//      `--hedef` nerede sorusunu cevaplar — ikisi birden olmadan geri alınamaz yazma yok.
//
// EPOCH ANI: fotoğraf satırlarının createdAt'i (tek tx, aynı `now()`). Ayrıca
//   bir ayar anahtarı YAZMAZ — `warehouseLedgerStartDate` kapısı (D6) 6e'nin
//   D6 uygulamasıyla gelir; o güne kadar epoch = MAX(createdAt) WHERE OPENING_BALANCE.
//
// GÜVENLİK: dry-run varsayılan · `--apply` `--onay=<N>` ister (N = yazılacak satır
//   sayısı, kuru koşumla birebir) · tek transaction (preEpoch damgası + satırlar
//   hep-ya-hiç) · audit tx DIŞINDA · `--apply` KULLANICI KARARIDIR, onaysız koşulmaz.
//   ⚠️ preEpoch damgası defter satırına yazılan TEK güncellemedir ve migration'ın
//   bu kolonu tam bu iş için açtığı yorumla meşrudur (satırın olayı/miktarı değişmez).
//   Yönetici onayı (teks-erp-1e, 2026-09-12) ve sınırı: `preEpoch` kim/niçin/miktar
//   taşımayan bir SINIFLANDIRMA BAYRAĞIDIR (durum bayrağı ≠ damga ölçütü) — (a) bir
//   kez yazılır, ikinci koşum ③ ile REDDEDİLİR; damga ve fotoğraf satırları AYNI
//   `$transaction` içindedir, `--apply` yarıda kesilirse ikisi de geri sarılır, kısmi
//   işaretli defter KALMAZ; (b) hiçbir İŞ KARARINA girdi değildir — yalnız defter
//   epoch'unu anlatır, as-of/Σ okumaları onunla öncesini dışarıda bırakır; (c) arşiv
//   notu: "defter satırına yazılan tek güncelleme ve nedeni" (fotoğraf inişiyle).
//   HİZALAMA (6e teyidi, 2026-09-12): `preEpoch` ZAMANSAL ("fotoğraftan önce"), TEK
//   YAZARI bu script; 6e'nin helper/bekçi/ters kayıt yolları kolona ne yazar ne okur.
//   `statusuzAtlanan` SEMANTİK (`fromStatus IS NULL AND toStatus IS NULL`, ucu kurulamayan
//   satır) — bugün örtüşürler (721/721), ileride ayrışırlar: fotoğraftan SONRA eski
//   kapıdan (transfer · sevk · sayım-dışı iptal) yazılan satır preEpoch=false ama statüsüz.
//   ⚠️ BU YÜZDEN FOTOĞRAF SONRASI GÜVENİLİRLİK SINIRI: toplam Σ (qty) güvenilir; depo × STATÜ
//   kırılımlı Σ ve as-of kesiti, eski kapılar stok defterine taşınana kadar GÜVENİLİR
//   DEĞİL (6e dilim dilim taşıyor). "Epoch sonrası her şey doğru" sanılmasın; dry-run
//   canlı statüsüz satır sayısını bilgi olarak basar. D6'ya aynı cümle girer (1e).
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { Prisma, WarehouseEventType } from "@prisma/client";
import { postStockMoves, type StockMoveInput } from "../src/services/helpers/warehouse-ledger.helper";
import { WAREHOUSE_STOCK_STATUSES } from "../src/services/helpers/warehouse-stock.helper";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";
import { AuditService } from "../src/services/audit.service";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const ONAY = Number((argv.find((a) => a.startsWith("--onay=")) ?? "").split("=")[1] ?? NaN);
const HEDEF = (argv.find((a) => a.startsWith("--hedef=")) ?? "").split("=")[1] ?? "";
const BATCH = 500;
/** ④ sessiz pencere: bu kadar saniye içinde defter yazımı varsa trafik durmamıştır. */
const SESSIZ_PENCERE_SN = 120;

function fmt(d: Prisma.Decimal | number): string {
  return new Prisma.Decimal(d).toFixed(3);
}
function dbHost(): string {
  try { const u = new URL(process.env.DATABASE_URL ?? ""); return `${u.hostname}:${u.port || "5432"}`; } catch { return "(okunamadı)"; }
}

async function main(): Promise<void> {
  const db = hedefDbAdi();
  console.log(`=== Stok defteri AÇILIŞ FOTOĞRAFI — ${APPLY ? `UYGULAMA (onay=${ONAY}, hedef=${HEDEF})` : "KURU KOŞUM (hiçbir şey yazılmaz)"} ===`);
  console.log(`HEDEF VERİTABANI: ${db} @ ${dbHost()}\n`);

  // ④ sessiz pencere ölçümü
  const sonYazim = await prisma.warehouseMovement.count({ where: { createdAt: { gte: new Date(Date.now() - SESSIZ_PENCERE_SN * 1000) } } });

  // ③ bir kez çekilir
  const onceki = await prisma.warehouseMovement.count({ where: { eventType: WarehouseEventType.OPENING_BALANCE } });
  if (onceki > 0) {
    const son = await prisma.warehouseMovement.findFirst({
      where: { eventType: WarehouseEventType.OPENING_BALANCE },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    console.error(`❌ Fotoğraf ZATEN çekilmiş: ${onceki} OPENING_BALANCE satırı, epoch ${son?.createdAt.toISOString()}. İkinci fotoğraf ayrı karardır — bu script koşmaz.`);
    process.exitCode = 1;
    return;
  }

  // ① deposuz top
  const deposuz = await prisma.roll.findMany({
    where: { status: { in: [...WAREHOUSE_STOCK_STATUSES] }, warehouseId: null },
    select: { id: true, barcode: true, status: true, currentQty: true },
    orderBy: { createdAt: "asc" },
  });

  // ② açık fason ENTRY adayı (uyarı)
  const acikFason = await prisma.warehouseMovement.count({
    where: {
      eventType: WarehouseEventType.ENTRY,
      notes: { startsWith: "Fason dönüşü (" },
      reversesMovementId: null,
      reversedBy: { none: {} },
      roll: { status: { notIn: [...WAREHOUSE_STOCK_STATUSES] } },
    },
  });

  // Fotoğraf kümesi
  const stokta = await prisma.roll.findMany({
    where: { status: { in: [...WAREHOUSE_STOCK_STATUSES] }, warehouseId: { not: null } },
    select: {
      id: true, barcode: true, status: true, currentQty: true, warehouseId: true,
      warehouse: { select: { code: true } },
    },
    orderBy: [{ warehouseId: "asc" }, { createdAt: "asc" }],
  });
  const sifir = stokta.filter((r) => !new Prisma.Decimal(r.currentQty).greaterThan(0));
  const yazilacak = stokta.filter((r) => new Prisma.Decimal(r.currentQty).greaterThan(0));
  const toplamM = yazilacak.reduce((s, r) => s.plus(r.currentQty), new Prisma.Decimal(0));
  const preEpochSayisi = await prisma.warehouseMovement.count({ where: { preEpoch: false } });
  // BİLGİ: iki ucu da statüsüz (eski kapıdan yazılmış) satır — fotoğraftan sonra da
  // doğabilir; depo×statü kırılımı/as-of bu satırlar taşınana kadar güvenilir değil.
  const statusuz = await prisma.warehouseMovement.count({ where: { fromStatus: null, toStatus: null } });

  console.log(`Stok kümesi: ${stokta.length + deposuz.length} top · fotoğraflanacak: ${yazilacak.length} (${fmt(toplamM)} m) · 0 m ATLANAN: ${sifir.length} · DEPOSUZ (engel): ${deposuz.length}`);
  console.log(`preEpoch'a düşecek mevcut satır: ${preEpochSayisi} · açık fason ENTRY adayı (uyarı): ${acikFason}`);
  console.log(`BİLGİ — iki ucu statüsüz satır (eski kapılar): ${statusuz}; fotoğraf sonrası toplam Σ güvenilir, depo×statü/as-of kesiti eski kapılar taşınana kadar DEĞİL.`);
  console.log(`④ SESSİZ PENCERE — son ${SESSIZ_PENCERE_SN} sn'de defter yazımı: ${sonYazim} ${sonYazim > 0 ? "⚠️ TRAFİK VAR — --apply reddedilir; backend durdurulmalı / vardiya dışı" : "✓ sessiz"}\n`);

  // Depo kırılımı
  const depoKirilim = new Map<string, { adet: number; m: Prisma.Decimal }>();
  for (const r of yazilacak) {
    const k = r.warehouse?.code ?? r.warehouseId ?? "?";
    const e = depoKirilim.get(k) ?? { adet: 0, m: new Prisma.Decimal(0) };
    e.adet += 1; e.m = e.m.plus(r.currentQty); depoKirilim.set(k, e);
  }
  for (const [k, e] of depoKirilim) console.log(`  depo ${k}: ${e.adet} top / ${fmt(e.m)} m`);

  // Yıkıcı işlem kuralı: etkilenen HER kayıt listelenir.
  console.log("\n--- FOTOĞRAFLANACAK TOPLAR (top | depo | durum | metre) ---");
  for (const r of yazilacak) console.log(`${(r.barcode ?? r.id).padEnd(16)} | ${(r.warehouse?.code ?? "?").padEnd(8)} | ${r.status.padEnd(10)} | ${fmt(r.currentQty).padStart(9)}`);
  if (sifir.length > 0) {
    console.log("\n--- ATLANAN (0 m — kapı 0 metrajı yazmaz; stokta 0 m top ayrı bir tutarsızlıktır) ---");
    for (const r of sifir) console.log(`${(r.barcode ?? r.id).padEnd(16)} | ${(r.warehouse?.code ?? "?").padEnd(8)} | ${r.status}`);
  }
  if (deposuz.length > 0) {
    console.log(`\n--- DEPOSUZ (ENGEL ①): önce backfill_roll_warehouse.ts ---`);
    for (const r of deposuz) console.log(`${(r.barcode ?? r.id).padEnd(16)} | ${r.status.padEnd(10)} | ${fmt(r.currentQty).padStart(9)}`);
  }
  if (acikFason > 0) console.log(`\n⚠️ ${acikFason} açık fason ENTRY adayı var — GO/NO-GO #1 gereği önce onarim_fason_donus_entry.ts koşulmalı (Σ'yı etkilemez, sıra kuralıdır).`);

  if (!APPLY) {
    console.log(
      `\nKURU KOŞUM bitti. ${deposuz.length > 0 ? "ENGEL ① açık — --apply reddedilir. " : ""}${sonYazim > 0 ? "ENGEL ④ (trafik) açık. " : ""}Uygulamak için (kullanıcı onayıyla, HEDEF adı birebir):\n` +
        `  npx tsx scripts/acilis_fotografi_stok_defteri.ts --apply --onay=${yazilacak.length} --hedef=${db}`,
    );
    return;
  }
  if (!HEDEF || HEDEF !== db) { console.error(`❌ ⑤ --hedef=${HEDEF || "(yok)"} ≠ çözülen veritabanı "${db}". Yazma YOK.`); process.exitCode = 1; return; }
  if (deposuz.length > 0) { console.error(`❌ ENGEL ①: ${deposuz.length} deposuz top. Fotoğraf çekilmedi.`); process.exitCode = 1; return; }
  if (sonYazim > 0) { console.error(`❌ ENGEL ④: son ${SESSIZ_PENCERE_SN} sn'de ${sonYazim} defter yazımı — trafik durmadan fotoğraf çekilmez.`); process.exitCode = 1; return; }
  if (!Number.isFinite(ONAY)) { console.error("❌ --onay=<sayı> zorunlu."); process.exitCode = 1; return; }
  if (ONAY !== yazilacak.length) { console.error(`❌ ONAY UYUŞMUYOR: kuru koşum ${yazilacak.length}, --onay=${ONAY}.`); process.exitCode = 1; return; }
  if (yazilacak.length === 0) { console.log("\nYapılacak iş yok."); return; }

  const sonuc = await prisma.$transaction(async (tx) => {
    // preEpoch damgası: fotoğraftan ÖNCEKİ her satır tarihsel iz.
    const damga = await tx.warehouseMovement.updateMany({ where: { preEpoch: false }, data: { preEpoch: true } });
    let yazilan = 0;
    for (let i = 0; i < yazilacak.length; i += BATCH) {
      const dilim = yazilacak.slice(i, i + BATCH);
      const inputs: StockMoveInput[] = dilim.map((r) => ({
        rollId: r.id,
        eventType: WarehouseEventType.OPENING_BALANCE,
        qty: r.currentQty,
        to: { warehouseId: r.warehouseId as string, status: r.status },
        reasonCode: STOCK_MOVE_REASON.OPENING,
        userId: null,
        notes: "Açılış fotoğrafı — stok defterinin doğruluk başlangıcı",
      }));
      yazilan += await postStockMoves(tx, inputs);
    }
    return { damga: damga.count, yazilan };
  }, { timeout: 120_000 });

  console.log(`\n✅ Fotoğraf çekildi: ${sonuc.yazilan} satır / ${fmt(toplamM)} m; ${sonuc.damga} mevcut satır preEpoch damgalandı. ATLANAN 0 m: ${sifir.length}.`);

  try {
    await AuditService.log({
      userId: undefined,
      action: "CREATE",
      tableName: "WAREHOUSE_MOVEMENT",
      recordId: "OPENING_BALANCE",
      newData: { source: "acilis_fotografi_stok_defteri", event: "STOCK_LEDGER_OPENING", rows: sonuc.yazilan, meters: fmt(toplamM), preEpochStamped: sonuc.damga, skippedZero: sifir.length },
    });
  } catch (e) {
    console.warn("audit yazılamadı (best-effort):", (e as Error).message);
  }
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
