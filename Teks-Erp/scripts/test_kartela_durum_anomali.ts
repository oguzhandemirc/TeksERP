// =============================================================================
// TEST: KARTELA DURUM ANOMALİ ARACI — kuru döküm, onay kapısı, tek yazarlı düzeltme (K2)
// Çalıştır: npx tsx scripts/test_kartela_durum_anomali.ts
// =============================================================================
// `scripts/kartela_durum_anomali.ts` ALT SÜREÇ olarak koşulur (yayın günü nasıl koşacaksa):
//   §1 kuru koşum B sınıfını kayıt kayıt ve yazılacak olayla basar, HİÇBİR ŞEY yazmaz
//   §2 yanlış onay/hedef → yazma YOK, çıkış 1
//   §3 --apply → kartela çuvalına iner, SHIPMENT_REMOVED satırı (ANOMALI_DUZELTME, sebep)
//   §4 A sınıfı: seddi ihlal eden satır NOT VALID kısıtta listelenir, health helper'ı görür;
//      satır kalkınca --apply kısıtı VALIDATE eder
// Kısıtı geçici NOT VALID'e çeviren adım teardown'da (`temizle`) GERİ YÜKLENİR.
// =============================================================================

import { spawnSync } from "child_process";
import { join } from "path";
import prisma from "../src/lib/prisma";
import { readUnvalidatedConstraints } from "../src/lib/constraint-health";
import { cocukOrtami, hedefDbAdi } from "./lib/hedef-db-kapisi";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TS = Date.now().toString().slice(-7);
const KISIT = "swatches_status_shape";
/** Kısıt tanımı DB'den okunur (migration'ın kopyası tutulmaz); teardown aynı tanımı geri koyar. */
let SEDD = "";
let CUSTOMER = "", ITEM = "", SACK = "", SHIPMENT = "";
const swatchIds: string[] = [];
let kisitGevsedi = false;

function arac(args: string[]): { kod: number; cikti: string } {
  const r = spawnSync("npx", ["tsx", join(__dirname, "kartela_durum_anomali.ts"), ...args], {
    cwd: join(__dirname, ".."), env: cocukOrtami(), encoding: "utf8", timeout: 120_000,
  });
  return { kod: r.status ?? -1, cikti: `${r.stdout}${r.stderr}` };
}

async function main(): Promise<void> {
  console.log("=== Kartela durum anomali aracı ===");
  const db = hedefDbAdi();
  try {
    CUSTOMER = (await prisma.customer.create({ data: { code: `TEST-KDA-${TS}`, name: `Anomali Test ${TS}` } })).id;
    ITEM = (await prisma.item.create({ data: { code: `TEST-KDA-IT-${TS}`, name: `Anomali Ürün ${TS}`, itemType: "FABRIC" } })).id;
    const shp = await prisma.shipment.create({ data: { shipmentNo: `TST-KDA-SV-${TS}`, customerId: CUSTOMER, status: "CANCELLED" } });
    SHIPMENT = shp.id;
    const sack = await prisma.sack.create({ data: { sackNo: `TST-KDA-CV-${TS}`, shipmentId: SHIPMENT } });
    SACK = sack.id;
    // B sınıfı: iptal sevkiyata bağlı kaldı (eski bir iptal yolunun izi) — seddi ihlal ETMEZ.
    const b = await prisma.swatch.create({
      data: { cardNumber: `TST-KDA-B-${TS}`, barcode: `TST-KDA-BB-${TS}`, itemId: ITEM, sackId: SACK, shipmentId: SHIPMENT, status: "IN_SHIPMENT" },
    });
    swatchIds.push(b.id);

    // §1 kuru
    const kuru = arac([]);
    check("§1 kuru koşum B satırını ve yazılacak olayı basar, düzeltilecek 1",
      kuru.kod === 0 && kuru.cikti.includes(`TST-KDA-B-${TS}`) && kuru.cikti.includes("yazılacak olay: SHIPMENT_REMOVED")
        && /Düzeltilecek \(B, mekanik\): 1\b/.test(kuru.cikti), kuru.kod !== 0 ? kuru.cikti.slice(-300) : "");
    check("§1b kuru koşum hiçbir şey yazmaz",
      (await prisma.swatch.findUniqueOrThrow({ where: { id: b.id } })).status === "IN_SHIPMENT"
        && (await prisma.swatchEvent.count({ where: { swatchId: b.id } })) === 0);

    // §2 onay kapısı
    const yanlisOnay = arac(["--apply", "--onay=2", `--hedef=${db}`]);
    const yanlisHedef = arac(["--apply", "--onay=1", "--hedef=baska_db"]);
    check("§2 yanlış onay ya da hedef → çıkış 1, yazma YOK",
      yanlisOnay.kod === 1 && yanlisHedef.kod === 1 && (await prisma.swatchEvent.count({ where: { swatchId: b.id } })) === 0);

    // §3 uygulama
    const uygula = arac(["--apply", "--onay=1", `--hedef=${db}`]);
    const sonra = await prisma.swatch.findUniqueOrThrow({ where: { id: b.id } });
    const ev = await prisma.swatchEvent.findMany({ where: { swatchId: b.id } });
    check("§3 --apply → IN_SACK, sevkiyat bağı kalktı, tek SHIPMENT_REMOVED (tek yazar, sebep satırda)",
      uygula.kod === 0 && sonra.status === "IN_SACK" && sonra.shipmentId === null && ev.length === 1
        && ev[0].type === "SHIPMENT_REMOVED" && ev[0].trigger === "ANOMALI_DUZELTME"
        && ev[0].reason === "anomali düzeltme · kartela_durum_anomali" && ev[0].shipmentNo === shp.shipmentNo,
      uygula.kod !== 0 ? uygula.cikti.slice(-300) : "");

    // §4 A sınıfı — kısıt geçici NOT VALID (teardown geri yükler)
    SEDD = (await prisma.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${KISIT}`)[0].def.replace(/\s+NOT VALID$/, "");
    kisitGevsedi = true;
    await prisma.$executeRawUnsafe(`ALTER TABLE "swatches" DROP CONSTRAINT "${KISIT}"`);
    const a = await prisma.swatch.create({
      data: { cardNumber: `TST-KDA-A-${TS}`, barcode: `TST-KDA-AB-${TS}`, itemId: ITEM, cancelledAt: new Date(), status: "IN_STOCK" },
    });
    swatchIds.push(a.id);
    await prisma.$executeRawUnsafe(`ALTER TABLE "swatches" ADD CONSTRAINT "${KISIT}" ${SEDD} NOT VALID`);
    const nvOnce = await readUnvalidatedConstraints();
    const kuruA = arac([]);
    check("§4 ihlalli satır A sınıfında listelenir; kısıt NOT VALID ve sağlık helper'ında görünür",
      nvOnce.includes(KISIT) && kuruA.cikti.includes(`TST-KDA-A-${TS}`) && kuruA.cikti.includes("NOT VALID"));
    await prisma.swatch.delete({ where: { id: a.id } });
    const uygulaA = arac(["--apply", "--onay=0", `--hedef=${db}`]);
    check("§4b ihlal kalkınca --apply kısıtı VALIDATE eder",
      uygulaA.kod === 0 && uygulaA.cikti.includes("VALIDATE edildi") && !(await readUnvalidatedConstraints()).includes(KISIT),
      uygulaA.kod !== 0 ? uygulaA.cikti.slice(-300) : "");
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  await prisma.swatch.deleteMany({ where: { id: { in: swatchIds } } });
  if (kisitGevsedi) {
    const var_ = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_constraint WHERE conname = ${KISIT}`;
    if (Number(var_[0].n) === 0 && SEDD) await prisma.$executeRawUnsafe(`ALTER TABLE "swatches" ADD CONSTRAINT "${KISIT}" ${SEDD} NOT VALID`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "swatches" VALIDATE CONSTRAINT "${KISIT}"`);
  }
  if (SACK) await prisma.sack.deleteMany({ where: { id: SACK } });
  if (SHIPMENT) await prisma.shipment.deleteMany({ where: { id: SHIPMENT } });
  if (ITEM) await prisma.item.deleteMany({ where: { id: ITEM } });
  if (CUSTOMER) await prisma.customer.deleteMany({ where: { id: CUSTOMER } });
  await prisma.systemLog.deleteMany({ where: { action: "SWATCH_STATUS_ANOMALY_FIX", tableName: "SWATCH", createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch((err) => console.error("temizlik hatası:", err));
  await prisma.$disconnect();
  process.exit(1);
});
