// =============================================================================
// BEKÇİ — PASİFE ALMANIN ETKİSİ GÖRÜNÜR (BULGU-T2-010)
// Çalıştır: npx tsx scripts/test_deactivate_impact.ts
// =============================================================================
// Ana veriyi pasife almak bağımlılık kontrolsüz ve önizlemesizdi. Sahada
// ölçüldü: 1 AÇIK sipariş kalemi (1.500 m) ve 2 canlı top PASİF bir kumaşa
// bağlıydı. Etkisi sessiz — iş emri formunun kumaş seçicisi `isActive:true`
// süzdüğü için o siparişe iş emri AÇILAMAZ; toplar envanterde sayılır ama
// üretime alınamaz. Operatör "kumaş kayboldu" der, sebep hiçbir yerde yazmaz.
//
// ⚠️ BU BEKÇİ "PASİFE ALMA ENGELLENSİN" DEMİYOR. Denetimin önerisi 409+force
// idi; deploy sırası backend ÖNCE olduğu için panel `force` göndermeyi öğrenene
// kadar sahada bugün yapılabilen bir iş yapılamaz hâle gelirdi. Ölçülen şey
// GÖRÜNÜRLÜK: sayım mesaja ve audit'e giriyor mu.
//
// §1 CANLI bağımlılık → uyarı + audit
// §2 BAĞIMLILIK YOKKEN uyarı YOK (vakumen dolu değil)
// §3 ÖLÜ satırlar sayılmaz (gürültü uyarıyı değersizleştirir)
// §4 Pasife alma HÂLÂ ÇALIŞIYOR (esneklik korundu)
//
// ⚠️ ÜRÜN KARTI BU BEKÇİDEN ÇIKTI (2026-09-25, URUN-YASAM-DONGUSU.md §14/2): kullanıcı
// kararıyla üründe "uyar ama bırak" bilerek değişti — canlı referanslı kart artık Pasif'e
// ALINAMAZ (409 + kayıt listesi; ölçen `test_item_archive_gate`). Bu bekçi bugün hâlâ
// uyar-ama-bırak yolundaki ana veriyi (RENK) ölçer; S4 bu kapıyı diğer ana verilere de
// getirdiğinde bu dosya arşiv kapısı bekçisine katlanır.
// =============================================================================
import { ItemType, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { colorService } from "../src/routes/color.routes";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const STAMP = `TSTDEA${Date.now().toString().slice(-7)}`;
const svc = colorService;
const itemIds: string[] = [];
const colorIds: string[] = [];
const rollIds: string[] = [];
let kumasId = "";

/** Pasife alınacak kayıt: RENK (bkz. başlık — ürün arşiv kapısına geçti). */
async function mkItem(tag: string): Promise<string> {
  if (!kumasId) {
    const it = await prisma.item.create({
      data: { code: `${STAMP}K`.slice(0, 30), name: `${STAMP} KUMAS`, itemType: ItemType.FABRIC },
      select: { id: true },
    });
    itemIds.push(it.id);
    kumasId = it.id;
  }
  const c = await prisma.color.create({
    data: { code: `${STAMP}${tag}`.slice(0, 30), name: `${STAMP} RENK ${tag}` },
    select: { id: true },
  });
  colorIds.push(c.id);
  return c.id;
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });

  // ═══ §1 — CANLI bağımlılık ═══
  console.log("\n=== §1: canlı bağımlılık uyarı üretiyor ===");
  const bagli = await mkItem("A");
  const canliTop = await prisma.roll.create({
    data: {
      barcode: `${STAMP}-R1`.slice(0, 30),
      itemId: kumasId,
      colorId: bagli,
      initialQty: 100,
      currentQty: 100,
      status: RollStatus.WAREHOUSE,
    },
    select: { id: true },
  });
  rollIds.push(canliTop.id);

  const r1 = await svc.softDelete(bagli, admin?.id);
  check("§1: pasife alma BAŞARILI (engellenmiyor — esneklik korundu)", r1.success === true);
  check(
    "§1: mesaj canlı bağımlılığı SÖYLÜYOR",
    /CANLI veri var/.test(r1.message ?? "") && /top/i.test(r1.message ?? ""),
    (r1.message ?? "").slice(0, 95),
  );
  const iz = await prisma.systemLog.findFirst({
    where: { tableName: "COLOR", recordId: bagli, action: "DELETE" },
    orderBy: { createdAt: "desc" },
    select: { newData: true },
  });
  check(
    "§1: sayım audit'e de düştü ('neden kayboldu' defterde)",
    JSON.stringify(iz?.newData ?? {}).includes("liveDependencies"),
    JSON.stringify(iz?.newData ?? {}).slice(0, 80),
  );

  // ═══ §2 — bağımlılık YOKKEN uyarı YOK ═══
  console.log("\n=== §2: temiz kayıtta uyarı yok ===");
  const temiz = await mkItem("B");
  const r2 = await svc.softDelete(temiz, admin?.id);
  check("§2: temiz kayıt pasife alınıyor", r2.success === true);
  check(
    "§2: uyarı YOK (kontrol vakumen dolu değil)",
    !/CANLI veri var/.test(r2.message ?? ""),
    (r2.message ?? "").slice(0, 60),
  );

  // ═══ §3 — ÖLÜ satırlar sayılmaz ═══
  console.log("\n=== §3: ölü satırlar gürültü üretmiyor ===");
  const oluBagli = await mkItem("C");
  const oluTop = await prisma.roll.create({
    data: {
      barcode: `${STAMP}-R2`.slice(0, 30),
      itemId: kumasId,
      colorId: oluBagli,
      initialQty: 100,
      currentQty: 0,
      // ⚠️ İptal edilmiş top pasife almayı sorunlu KILMAZ; sayılsaydı uyarı
      // her kayıtta çıkar ve operatör onu okumayı bırakırdı.
      status: RollStatus.CANCELLED,
    },
    select: { id: true },
  });
  rollIds.push(oluTop.id);
  const r3 = await svc.softDelete(oluBagli, admin?.id);
  check(
    "§3: yalnız ÖLÜ satırı olan kayıtta uyarı YOK",
    !/CANLI veri var/.test(r3.message ?? ""),
    (r3.message ?? "").slice(0, 60),
  );
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => undefined);
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...itemIds, ...colorIds] } } }).catch(() => undefined);
    await prisma.color.deleteMany({ where: { id: { in: colorIds } } }).catch(() => undefined);
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } }).catch(() => undefined);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
