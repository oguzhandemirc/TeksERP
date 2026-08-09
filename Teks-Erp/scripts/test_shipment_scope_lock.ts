// =============================================================================
// Test: Storno <-> iade sevkiyat kapsamlı kilidi (F-SEV-ESZ-001, 2026-08-09)
// Çalıştır: npx tsx scripts/test_shipment_scope_lock.ts
// =============================================================================
// KORUNAN INVARIANT: bir sevkiyat AYNI ANDA hem "geri alınmış" (PLANNED) hem
// "aktif iadesi var" olamaz. `resolveUndoBlockReason` bunu engellemek için var
// ama sorduğu şey HENÜZ OLMAYAN satırlardı (phantom) ve satır kilidi phantom'u
// kapatmaz — READ COMMITTED altında sayım ile commit arasında yeni bir
// `RollReturn` doğabiliyordu.
//
// YARIŞ TEK YÖNLÜYDÜ ve bunu bilmek düzeltmenin şeklini belirledi: iade tarafında
// topun atomik claim'i zaten vardı (`updateMany where {id, status: SHIPPED}` +
// `count===0 → throw`), yani "storno önce commit ederse" iade reddediliyordu.
// Korunmasız olan TERS sıralamaydı: iade önce commit ederse storno'nun sayımı 0
// okumuş olduğu için bloklamayı geçiyor ve sevkiyatı PLANNED'a çekiyordu.
//
// ÜRETİLDİ (2026-08-09): `undoDispatch`in iade sayımından sonra 1200 ms gecikme
// konulup o pencerede gerçek `createReturn` koşturuldu →
//   kilit YOKKEN : undo-OK | iade-OK    → sevkiyat PLANNED **ve** aktif iade 1  ⛔
//   kilit VARKEN : undo-OK | iade-HATA  → aktif iade 0                          ✅
//
// Bu bekçinin ASIL kontrolü SIRA'dır (§1): kilit, koruduğu okumadan ÖNCE
// alınmalı. Sonrasına alınırsa hiçbir şey kazanılmaz ve bu SESSİZDİR — davranış
// sondası dar pencerede çoğu zaman yeşil kalacağı için onu yakalayamaz.
// =============================================================================
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import prisma, { pool } from "../src/lib/prisma";
import { SHIPMENT_LOCK_NS } from "../src/services/helpers/shipment-locks.helper";
import { DUPLICATE_GUARD_LOCK_NS } from "../src/services/helpers/duplicate-guard.helper";
import { BATCH_NUMBER_LOCK_NS } from "../src/services/batch.service";
import { shippingService } from "../src/services/shipping.service";
import { returnService } from "../src/services/return.service";

const SRC = join(__dirname, "../src");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/** `fn` gövdesini bir sonraki aynı girintili metoda kadar alır. */
function bodyOf(src: string, marker: string, endMarker: string): string {
  const i = src.indexOf(marker);
  if (i === -1) return "";
  const j = src.indexOf(endMarker, i);
  return src.slice(i, j === -1 ? undefined : j);
}

async function main(): Promise<void> {
  console.log("=== Sevkiyat kapsamlı kilit sözleşmesi ===\n");

  // ── 1) SIRA — kilit, koruduğu okumadan ÖNCE (asıl kontrol) ────────────────
  console.log("[1] Kilit sırası (load-bearing)");
  const shipSrc = readFileSync(join(SRC, "services/shipping.service.ts"), "utf8");
  const undoBody = bodyOf(shipSrc, "async undoDispatch(", "\n  async ");
  check("undoDispatch gövdesi çözülebildi", undoBody.length > 200);
  const lockAt = undoBody.indexOf("lockShipmentScopeTx(");
  const countAt = undoBody.indexOf("rollReturn.count(");
  const claimAt = undoBody.indexOf("shipment.updateMany(");
  check("undoDispatch kilidi alıyor", lockAt !== -1);
  check(
    "kilit, iade SAYIMINDAN önce (phantom penceresi kapanır)",
    lockAt !== -1 && countAt !== -1 && lockAt < countAt,
    `lock@${lockAt} count@${countAt}`,
  );
  check(
    "kilit, sevkiyat CLAIM'inden önce",
    lockAt !== -1 && claimAt !== -1 && lockAt < claimAt,
    `lock@${lockAt} claim@${claimAt}`,
  );

  const retSrc = readFileSync(join(SRC, "services/return.service.ts"), "utf8");
  const createBody = bodyOf(retSrc, "const created = await prisma.$transaction", "\n    await AuditService");
  check("createReturn tx gövdesi çözülebildi", createBody.length > 200);
  const rLockAt = createBody.indexOf("lockShipmentScopeTx(");
  const rFlipAt = createBody.indexOf("roll.updateMany(");
  check("createReturn AYNI kilidi alıyor", rLockAt !== -1);
  check(
    "kilit, top flip'inden önce",
    rLockAt !== -1 && rFlipAt !== -1 && rLockAt < rFlipAt,
    `lock@${rLockAt} flip@${rFlipAt}`,
  );

  // ── 2) NAMESPACE — uzaylar ayrı olmalı ────────────────────────────────────
  console.log("\n[2] Advisory lock namespace ayrımı");
  check("SHIPMENT_LOCK_NS, KK1 (8021) ile çakışmıyor", SHIPMENT_LOCK_NS !== DUPLICATE_GUARD_LOCK_NS);
  check("SHIPMENT_LOCK_NS, parti no (8022) ile çakışmıyor", SHIPMENT_LOCK_NS !== BATCH_NUMBER_LOCK_NS);
  check(
    "2 ARGÜMANLI form kullanılıyor (1-argümanlı uzay ayrı bir uzaydır)",
    /pg_advisory_xact_lock\(\$\{SHIPMENT_LOCK_NS\}::int, hashtext\(/.test(
      readFileSync(join(SRC, "services/helpers/shipment-locks.helper.ts"), "utf8"),
    ),
  );
  // src GENELİNDE 1-argümanlı form kalmamalı (2026-08-09, F-KIM-GUV-003).
  // `session-registry` (kullanıcı x cihaz-tipi başına BİNLERCE anahtar) ile
  // `permission-management` (TEK sabit anahtar) aynı namespace'siz uzayı
  // paylaşıyordu. Sonuç yanlış veri değil GECİKMEdir — ve gecikmenin kaynağı
  // bulunamaz. Yeni bir kilit eklerken 2-argümanlı formu kullan.
  const oneArg: string[] = [];
  const walkSrc = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walkSrc(p);
      else if (p.endsWith(".ts") && /pg_advisory_xact_lock\(hashtext/.test(readFileSync(p, "utf8"))) {
        oneArg.push(p.slice(SRC.length + 1));
      }
    }
  };
  walkSrc(SRC);
  check("src genelinde 1-argümanlı pg_advisory_xact_lock KALMADI", oneArg.length === 0, oneArg.join(", "));

  // ── 3) DAVRANIŞ — eşzamanlı storno + iade YASAK DURUM üretmemeli ──────────
  console.log("\n[3] Eşzamanlı storno + iade (yasak durum üretilmemeli)");
  const tag = `TEST-SCOPELOCK-${Date.now()}`;
  const ids: Record<string, string> = {};
  try {
    const user = await prisma.user.findFirst({ select: { id: true } });
    const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
    if (!user || !item) {
      console.log("⏭️  fixture için user/item yok — davranış bölümü atlandı");
    } else {
      const cu = await prisma.customer.create({
        data: { code: `${tag}-C`, name: tag },
        select: { id: true },
      });
      ids.customer = cu.id;
      const sh = await prisma.shipment.create({
        data: { shipmentNo: `${tag}-S`, customerId: cu.id, status: "DISPATCHED", dispatchedAt: new Date() },
        select: { id: true },
      });
      ids.shipment = sh.id;
      const roll = await prisma.roll.create({
        data: {
          barcode: tag.slice(0, 40), itemId: item.id, initialQty: 100, currentQty: 100,
          status: "SHIPPED", preShipStatus: "WAREHOUSE", shipmentId: sh.id,
        },
        select: { id: true },
      });
      ids.roll = roll.id;

      const [undoRes, retRes] = await Promise.all([
        shippingService.undoDispatch(sh.id, "bekçi: eşzamanlılık", user.id).then(() => "ok").catch(() => "red"),
        returnService.createReturn({ rollId: roll.id, reasonText: "bekçi" }, user.id).then(() => "ok").catch(() => "red"),
      ]);
      const finalSh = await prisma.shipment.findUnique({ where: { id: sh.id }, select: { status: true } });
      const activeRet = await prisma.rollReturn.count({
        where: { fromShipmentId: sh.id, cancelledAt: null },
      });
      console.log(`   (storno=${undoRes} iade=${retRes} · durum=${finalSh?.status} · aktif iade=${activeRet})`);
      check(
        "YASAK DURUM yok: sevkiyat PLANNED iken aktif iade OLAMAZ",
        !(finalSh?.status === "PLANNED" && activeRet > 0),
      );
      check("iki akıştan en az biri reddedildi", undoRes === "red" || retRes === "red");
    }
  } finally {
    await prisma.rollReturn.deleteMany({ where: { fromShipmentId: ids.shipment } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: ids.roll } }).catch(() => {});
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: ids.shipment } }).catch(() => {});
    await prisma.shipment.deleteMany({ where: { id: ids.shipment } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: ids.customer } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
