// =============================================================================
// BEKÇİ — TOPLU ÇUVAL DAĞITMA: önizleme + uygulama (2026-09-06)
// =============================================================================
// İSTEK: "listeden çuvalları seçip silebilelim — burada silmek çuvalı DAĞITMAK
// anlamında, gerçek bir silme değil."
//
// ⭐ SINIF: YIKICI İŞLEM. Kök CLAUDE.md: "Yıkıcı işlemde backend preview ucu döner,
//    arayüz etkilenen HER kaydı listeler ve per-record seçim sunar; soyut sayı
//    yetmez." Bu bekçi önizlemenin gerçekten SATIR döndürdüğünü ölçer — sayı değil.
//
// ⭐ İKİ HÜKÜM AYNI OLMALI: tekil dağıtma (`distributeSackContents`) sevkiyata
//    atanmış çuvalı reddediyor. Toplu yol da reddetmeli, YOKSA toplu düğme
//    tekil kapıyı atlatan bir arka kapı olurdu.
//
// ⭐ HEPSİ-YA-HİÇBİRİ DEĞİL: engelli çuval ATLANIR ve sebebi RAPORLANIR. Sessizce
//    atlamak "yeşil ≠ yapıldı" olurdu; tümünü düşürmek sahada kullanılamazdı.
//
// ⭐ NEGATİF SONDA (2026-09-06): ① sevkiyat engeli kaldırılınca §3 kırmızı
//    ② önizleme `rolls` dizisi boşaltılınca §2 kırmızı. İkisi de ölçüldü.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { RollStatus, ShipmentStatus } from "@prisma/client";
import { shippingService } from "../src/services/shipping.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { fixtureWarehouseId } from "./fixture-warehouse";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

const TS = Date.now();
const P = `TEST-SBD-${TS}`;
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ""}`); }
}

let ADMIN = "";
let CUSTOMER = "";
let ITEM = "";
const rollIds: string[] = [];
const sackIds: string[] = [];
const shipmentIds: string[] = [];

/** Depoda, içinde `n` top olan bir çuval kur. */
async function cuvalKur(n: number, metraj = 50): Promise<string> {
  const sack = (
    // ⚠️ Elle çuval no VERİLMEZ: çuval OKUTULAN bir seri ve elle değer kendi
    // türüne çözülmek zorunda; fikstür ön eki bunu bozardı. Numarayı sunucu
    // üretir, temizlik toplanan id'lerden yürür.
    await shippingService.openSack({ customerId: CUSTOMER }, ADMIN)
  ).data as { id: string };
  sackIds.push(sack.id);
  for (let i = 0; i < n; i++) {
    const roll = await prisma.roll.create({
      data: {
        // Sevk edilebilmek icin deposu DOLU olmali: deposuz bir top stok
        // kumesinden cikamaz (`assertRollsHaveWarehouse`, 409). Uretimde
        // deposuz top dogamaz, fikstur de uretmemeli.
        warehouseId: await fixtureWarehouseId(),
        barcode: `${P}-R${rollIds.length}`,
        itemId: ITEM,
        initialQty: metraj,
        currentQty: metraj,
        qualityGrade: "1.KALITE",
        width: 150,
        status: RollStatus.WAREHOUSE,
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true, barcode: true },
    });
    rollIds.push(roll.id);
    await shippingService.scanIntoSack({ sackId: sack.id, barcode: roll.barcode! }, ADMIN);
  }
  return sack.id;
}

async function run(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  ADMIN = admin?.id ?? "";
  const cust = await prisma.customer.create({ data: { code: `${P}-C`, name: `${P} MUSTERI` }, select: { id: true } });
  CUSTOMER = cust.id;
  const item = await prisma.item.create({
    data: { code: `${P}-I`, name: `${P} KUMAS`, itemType: "FABRIC" },
    select: { id: true },
  });
  ITEM = item.id;

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  console.log("\n§1 — körlük zemini: fixture gerçekten kuruldu");
  const s1 = await cuvalKur(3);
  const s2 = await cuvalKur(2);
  const dolu = await prisma.roll.count({ where: { sackId: { in: [s1, s2] } } });
  check("iki çuvalda toplam 5 top var (aksi hâlde bu bekçi hiçbir şey ölçmez)", dolu === 5, `${dolu} top`);

  // ── §2 ÖNİZLEME SATIR DÖNDÜRÜR ────────────────────────────────────────────
  console.log("\n§2 — önizleme: SAYI değil SATIR");
  const on = (await shippingService.previewDistributeSacks([s1, s2])).data as {
    sacks: { sackId: string; rollCount: number; totalMeters: number; engel: string | null; rolls: { id: string; barcode: string | null; meters: number }[] }[];
    ozet: { secilen: number; dagitilacak: number; engelli: number; toplamTop: number; toplamMetraj: number };
  };
  check("⭐ önizleme YAZMAZ: toplar hâlâ çuvalda", (await prisma.roll.count({ where: { sackId: { in: [s1, s2] } } })) === 5);
  check("iki çuval da önizlemede", on.sacks.length === 2, `${on.sacks.length}`);
  const sat1 = on.sacks.find((x) => x.sackId === s1);
  check(
    "⭐ etkilenen HER top SATIR olarak dönüyor (soyut sayı yetmez)",
    !!sat1 && sat1.rolls.length === 3 && sat1.rolls.every((r) => !!r.barcode && r.meters > 0),
    `${sat1?.rolls.length} satır`,
  );
  check("özet sayıları satırlarla tutarlı", on.ozet.toplamTop === 5 && on.ozet.dagitilacak === 2, JSON.stringify(on.ozet));
  check("toplam metraj hesaplanıyor", on.ozet.toplamMetraj === 250, `${on.ozet.toplamMetraj} m`);

  // ── §3 SEVKİYATTAKİ ÇUVAL ENGELLİ ─────────────────────────────────────────
  console.log("\n§3 — sevkiyata atanmış çuval TOPLU yoldan da dağıtılamaz");
  const s3 = await cuvalKur(1);
  const sev = (
    await shippingService.createShipment(
      { sackIds: [s3], customerId: CUSTOMER, orderless: true },
      ADMIN,
    )
  ).data as { id: string };
  shipmentIds.push(sev.id);
  const on2 = (await shippingService.previewDistributeSacks([s1, s3])).data as {
    sacks: { sackId: string; engel: string | null }[];
    ozet: { dagitilacak: number; engelli: number };
  };
  check(
    "⭐ sevkiyattaki çuval ENGELLİ ve sebebi yazıyor",
    on2.sacks.find((x) => x.sackId === s3)?.engel != null,
    on2.sacks.find((x) => x.sackId === s3)?.engel ?? "(engel YOK — arka kapı!)",
  );
  check("depodaki çuval engelsiz", on2.sacks.find((x) => x.sackId === s1)?.engel === null);
  check("özet engelliyi ayrı sayıyor", on2.ozet.dagitilacak === 1 && on2.ozet.engelli === 1, JSON.stringify(on2.ozet));

  // ── §4 UYGULA: engelli ATLANIR, sebebi raporlanır ─────────────────────────
  console.log("\n§4 — uygula: kısmi başarı SESSİZ değil");
  const sonuc = (await shippingService.distributeSacksBulk({ sackIds: [s1, s3] }, ADMIN)).data as {
    dagitilan: { sackId: string; removedRolls: number }[];
    atlanan: { sackId: string; sebep: string }[];
  };
  check("⭐ depodaki çuval dağıtıldı", sonuc.dagitilan.length === 1 && sonuc.dagitilan[0]?.sackId === s1, JSON.stringify(sonuc.dagitilan));
  check("⭐ sevkiyattaki çuval ATLANDI ve sebebi döndü", sonuc.atlanan.length === 1 && !!sonuc.atlanan[0]?.sebep, JSON.stringify(sonuc.atlanan));
  check("⭐ dağıtılan çuvalın topları DEPOYA çıktı (sackId null)", (await prisma.roll.count({ where: { sackId: s1 } })) === 0);
  check("⭐ ÇUVAL SİLİNMEDİ — 'silme' dağıtmadır", (await prisma.sack.count({ where: { id: s1 } })) === 1);
  check("sevkiyattaki çuvalın içeriği KORUNDU", (await prisma.roll.count({ where: { sackId: s3 } })) === 1);

  // ── §5 GİRDİ KAPISI ───────────────────────────────────────────────────────
  console.log("\n§5 — girdi kapısı");
  let bosHata = false;
  try { await shippingService.previewDistributeSacks([]); } catch { bosHata = true; }
  check("boş seçim reddediliyor", bosHata);
  const on3 = (await shippingService.previewDistributeSacks([s2, "00000000-0000-0000-0000-000000000000"])).data as {
    bulunamayan: string[];
  };
  check("olmayan çuval SESSİZCE yutulmuyor, `bulunamayan`da raporlanıyor", on3.bulunamayan.length === 1, JSON.stringify(on3.bulunamayan));
}

async function teardown(): Promise<void> {
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } }).catch(() => {});
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentIds } } }).catch(() => {});
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
  await prisma.sack.deleteMany({ where: { id: { in: sackIds } } }).catch(() => {});
  await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } }).catch(() => {});
  if (ITEM) await prisma.item.deleteMany({ where: { id: ITEM } }).catch(() => {});
  if (CUSTOMER) await prisma.customer.deleteMany({ where: { id: CUSTOMER } }).catch(() => {});
}

run()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    await teardown().catch((e) => console.error("teardown hatası:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
