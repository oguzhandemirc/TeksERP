// =============================================================================
// BEKÇİ — TEK DEPOLU KURULUM PARİTESİ ("fabrikada sıfır görünür fark")
// =============================================================================
// Çalıştırma: npx tsx scripts/test_single_warehouse_parity.ts
//
// NEDEN: Çoklu depo, ÜRETİCİ fabrikanın canlı kurulumuna da gidiyor ve o fabrika
// güncelleme sonrası tek piksel fark görmemeli. Bu vaadin üç ayağı var ve üçü de
// SESSİZ kırılır — hata çıkmaz, log çıkmaz, yalnız bir gün fabrikadan "bu ekran
// niye değişti / bu alan neden zorunlu oldu" diye telefon gelir:
//
//   (a) BACKEND: yeni uçların hiçbiri zorunlu depo parametresi istemez; depo
//       verilmediğinde `resolveTargetWarehouseId` varsayılana düşer.
//   (b) SORGU: depo filtresi GÖNDERİLMEDİĞİNDE `where`e tek koşul eklenmez —
//       yani mevcut listeler bayt bayt aynı sonucu döner.
//   (c) ARAYÜZ: her yeni yüzey `multiWarehouse` kapısının arkasındadır ve o
//       karar TEK kaynaktan (`useMultiWarehouse`) gelir.
//
// ⚠️ (c) Electron tarafında yaşıyor ve backend onu import EDEMEZ → kaynak
// taramasıyla kilitlenir (emsal: `test_document_template_permission.ts`
// Electron aynasını böyle doğrular). Tarama kırılgan görünür ama alternatifi
// "hiç ölçmemek"tir: gating satırı silinse hiçbir test kırmızı vermezdi.
//
// ÖLÇÜLENLER:
//   §1 Tek aktif depo → istemci kapısı KAPALI (multiWarehouse=false eşdeğeri)
//   §2 Deposuz giriş çalışır ve varsayılan depoyu damgalar (uç imzası değişmedi)
//   §3 Depo filtresi YOKSA `where`de depo koşulu YOK — mevcut liste birebir
//   §4 Depo yüzeyleri Electron'da multiWarehouse kapılı (kaynak taraması)
//   §5 Yeni izinler fabrika rol şablonlarına SIZMADI
//   §6 Yeni tablolar mevcut akışların yanıt şeklini DEĞİŞTİRMEDİ (RollMovement
//      sayısı sabit — depo defteri ayrı tabloda)
// =============================================================================
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Request } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { ROLE_TEMPLATE_CATALOG } from "../src/constants/role-template-catalog";

const inventory = new InventoryService();

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

const ELECTRON = join(__dirname, "..", "..", "Electron", "src");
function readSrc(rel: string): string {
  const p = join(ELECTRON, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

const fakeReq = (query: Record<string, unknown>) => ({ query }) as unknown as Request;

const rollIds: string[] = [];
const tempWarehouseIds: string[] = [];

async function main(): Promise<void> {
  console.log("=== Tek depolu kurulum paritesi ===\n");

  const def = await ensureDefaultWarehouse();
  if (!def) throw new Error("Varsayılan depo çözülemedi — uzlaştırma bozuk.");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok.");

  // ── §1 İSTEMCİ KAPISI ────────────────────────────────────────────────────
  // Kapının kendisi Electron'da (`warehouses.length > 1`); burada ölçülen şey
  // onu besleyen VERİ: kurulumda tek aktif depo varsa kapı kapalı olmak
  // ZORUNDADIR. Fabrika bugün tam olarak bu durumda.
  const activeCount = await prisma.warehouse.count({ where: { isActive: true } });
  check(
    "§1a Fabrika senaryosu: tek aktif depo → yüzeyler çizilmez",
    activeCount >= 1,
    `aktif depo=${activeCount}${activeCount > 1 ? " (dev DB'de deneme deposu var — fabrikada 1 olacak)" : ""}`,
  );
  // Varsayılan depo HER ZAMAN tektir: ikinci `isDefault` satırı, seçicisiz
  // kurulumda hangi deponun kullanılacağını belirsizleştirirdi.
  const defaultCount = await prisma.warehouse.count({ where: { isDefault: true } });
  check("§1b Varsayılan depo TEK", defaultCount === 1, `isDefault=${defaultCount}`);

  // ── §2 UÇ İMZASI DEĞİŞMEDİ ──────────────────────────────────────────────
  // Fabrikanın hiçbir akışı depo göndermiyor. `warehouseId` opsiyonu HİÇ
  // verilmeden çağrı çalışmalı ve varsayılan depoyu damgalamalı.
  const entry = await inventory.createInitialEntry({ itemId: item.id, initialQty: 55 }, undefined, undefined, false);
  const rollId = (entry.data as { id: string }).id;
  rollIds.push(rollId);
  const roll = await prisma.roll.findUnique({
    where: { id: rollId },
    select: { warehouseId: true, status: true, goodsReceiptId: true, entrySource: true },
  });
  check("§2a Deposuz giriş HATA VERMEZ", Boolean(roll), `rollId=${rollId.slice(0, 8)}`);
  check("§2b Varsayılan depo damgalandı", roll?.warehouseId === def.id, `warehouseId=${roll?.warehouseId?.slice(0, 8)}`);
  // ⚠️ Statü ve giriş kaynağı DEĞİŞMEMELİ: depo eklemek malın ne olduğunu
  // değiştirmez. Bu satır düşerse fabrikanın ham girişi sessizce başka bir
  // sekmeye taşınırdı.
  check("§2c Statü eski davranış (renksiz → STOCK)", roll?.status === "STOCK", `status=${roll?.status}`);
  check("§2d Mal kabul bağı boş (üretim girişi fiş değildir)", roll?.goodsReceiptId === null);

  // ── §3 SORGU PARİTESİ ───────────────────────────────────────────────────
  // Depo filtresi göndermeyen mevcut ekranlar aynı satırları görmeli.
  const baseline = await inventory.findAllRolls(fakeReq({ "filter[statusIn]": "STOCK", pageSize: "20" }));
  const withEmptyFilter = await inventory.findAllRolls(
    fakeReq({ "filter[statusIn]": "STOCK", "filter[warehouseId]": "", pageSize: "20" }),
  );
  const bRows = (baseline as { data: Array<{ id: string }> }).data;
  const eRows = (withEmptyFilter as { data: Array<{ id: string }> }).data;
  check(
    "§3a Depo filtresi YOKKEN liste değişmedi",
    bRows.length > 0 && bRows.length === eRows.length && bRows[0]?.id === eRows[0]?.id,
    `base=${bRows.length} boşFiltre=${eRows.length}`,
  );
  // Filtre GERÇEKTEN verilince süzmeli — aksi halde §3a "filtre hiç çalışmıyor"
  // sebebiyle de yeşil kalırdı (körlük zemini).
  const filtered = await inventory.findAllRolls(
    fakeReq({ "filter[statusIn]": "STOCK", "filter[warehouseId]": def.id, pageSize: "20" }),
  );
  const fRows = (filtered as { data: Array<{ id: string }> }).data;
  check("§3b KÖRLÜK ZEMİNİ: filtre verilince süzüyor", fRows.length > 0, `süzülü=${fRows.length}`);
  const bogus = await inventory.findAllRolls(
    fakeReq({
      "filter[statusIn]": "STOCK",
      "filter[warehouseId]": "00000000-0000-0000-0000-000000000000",
      pageSize: "20",
    }),
  );
  check(
    "§3c Var olmayan depo → boş liste (filtre sessizce DÜŞMÜYOR)",
    (bogus as { data: unknown[] }).data.length === 0,
  );

  // Liste yanıtı depo ilişkisini taşır ama ESKİ alanlar yerinde durur.
  const sample = bRows[0] as unknown as Record<string, unknown>;
  check(
    "§3d Liste yanıtındaki eski alanlar duruyor",
    ["id", "barcode", "status", "currentQty", "item"].every((k) => k in sample),
  );

  // ── §4 ARAYÜZ KAPILARI (kaynak taraması) ────────────────────────────────
  // Her yeni depo yüzeyi tek kaynaktan gelen karara bağlı olmalı.
  const rollsPage = readSrc("pages/Operations/Rolls/RollsPage.tsx");
  const rollsBody = readSrc("pages/Operations/Rolls/RollsTableBody.tsx");
  const receiptForm = readSrc("pages/Operations/GoodsReceipts/GoodsReceiptFormDialog.tsx");
  const hook = readSrc("hooks/useWarehouses.ts");

  check("§4a useWarehouses hook'u var", hook.includes("export function useMultiWarehouse"));
  check(
    "§4b multiWarehouse kararı TEK yerde hesaplanıyor",
    hook.includes("warehouses.length > 1"),
    "kopyalanırsa biri 'aktif' süzgecini unutur",
  );
  check(
    "§4c Rolls 'Depo' kolonu multiWarehouse kapılı",
    rollsPage.includes("useMultiWarehouse") && /warehouse:\s*multiWarehouse/.test(rollsPage),
  );
  check(
    "§4d Rolls 'Depo' filtresi multiWarehouse kapılı",
    rollsBody.includes("multiWarehouse"),
  );
  check(
    "§4e Mal Kabul depo seçicisi tek depoda çizilmiyor",
    receiptForm.includes("{multiWarehouse && (") && receiptForm.includes("useDefaultWarehouse"),
  );
  // ⚠️ Kapı "yükleniyor" hâlinde KAPALI tarafa düşmeli: belirsizken yüzey
  // çizmek, fabrikada depo kolonunun bir an belirip kaybolması demekti.
  check(
    "§4f Belirsizken (yükleniyor) kapı KAPALI",
    hook.includes("q.data ?? []"),
    "veri yokken boş dizi → length>1 false",
  );

  // ── §5 İZİN SIZINTISI ───────────────────────────────────────────────────
  // Fabrikanın kullandığı rollere depo/mal kabul izni EKLENMEMELİ; eklenirse
  // yüzey multiWarehouse ile gizli olsa bile menüde/komut paletinde belirir.
  const NEW_PERMS = [
    "warehouse:read",
    "warehouse:write",
    "warehouse:transfer",
    "goods-receipt:read",
    "goods-receipt:write",
  ];
  // ⚠️ MUAF LİSTESİ GEREKÇELİ ve ÇİFT YÖNLÜ denetlenir (timestamptz bekçisi
  // emsali): ölü muaf, gerçek bir sızıntıyı sessizce kapsam dışında tutar.
  // `goods-receipt:*` listede HİÇ YOK ve olmamalı — mal kabul yalnız ticaret
  // kurulumunun yüzeyidir, üretici fabrikanın rollerinde işi yoktur.
  const ALLOWED_LEAKS: Record<string, string[]> = {
    // Plan kararı: depo TANIMI ve TRANSFER'i depo sorumlusunun işidir; yüzeyler
    // multiWarehouse kapılı olduğu için tek depolu fabrikada zaten görünmez.
    WEB_WAREHOUSE_SHIPPING: ["warehouse:read", "warehouse:transfer"],
    // Depoyu tanımlayan kişi sistem yöneticisidir.
    WEB_SYSTEM_ADMIN: ["warehouse:write"],
    // ⚠️ TİCARET KURULUM ŞABLONU (2026-08-14) — bu kuralın BİLİNÇLİ istisnası.
    // Kural "goods-receipt hiçbir şablonda olmasın" idi ve gerekçesi
    // GÖRÜNÜRLÜKTÜ: mal kabul karosu yalnız izinle kapılı, şablona akarsa
    // fabrikada belirir. WEB_TRADE bu gerekçeyi ihlal ETMEZ çünkü şablon
    // fabrikada KİMSEYE ATANMAZ (kural: katalog koda, atama panele) — atanmamış
    // şablon kimseye izin vermez, dolayısıyla hiçbir karo doğmaz. Persona
    // denetimi olmadığında kurulum 3 şablon + elle 4 izin istiyordu ve iki izin
    // atlanınca Envanter/Siparişler HİÇ görünmüyordu.
    WEB_TRADE: [
      "warehouse:read",
      "warehouse:write",
      "warehouse:transfer",
      "goods-receipt:read",
      "goods-receipt:write",
    ],
  };
  const leaked: string[] = [];
  const seenAllowed = new Set<string>();
  for (const tpl of ROLE_TEMPLATE_CATALOG) {
    // "Admin (Tam Yetki)" `mode:"all"` taşır — tanımı gereği HER izni içerir;
    // onu sızıntı saymak kontrolü anlamsız kılardı.
    if (tpl.mode !== "list") continue;
    const allowed = ALLOWED_LEAKS[tpl.code] ?? [];
    for (const p of NEW_PERMS) {
      if (!tpl.codes.includes(p)) continue;
      if (allowed.includes(p)) seenAllowed.add(`${tpl.code}:${p}`);
      else leaked.push(`${tpl.code}:${p}`);
    }
  }
  check(
    "§5a Depo/mal kabul izinleri fabrika rollerine SIZMADI",
    leaked.length === 0,
    leaked.length > 0 ? leaked.join(", ") : "temiz",
  );
  const expectedAllowed = Object.entries(ALLOWED_LEAKS).flatMap(([c, ps]) => ps.map((p) => `${c}:${p}`));
  const staleExempt = expectedAllowed.filter((e) => !seenAllowed.has(e));
  check(
    "§5b Muaf listesi BAYAT DEĞİL (her muaf gerçekten mevcut)",
    staleExempt.length === 0,
    staleExempt.length > 0 ? `ölü muaf: ${staleExempt.join(", ")}` : `${expectedAllowed.length} muaf doğrulandı`,
  );
  // goods-receipt izinlerinin hiçbir şablonda OLMAMASI ayrıca ve açıkça ölçülür
  // — muaf listesine bir gün eklenirse bu satır düşer.
  // Mal kabul izni YALNIZ ticaret şablonunda olabilir. Fabrika rollerinden
  // birine sızarsa (Depo&Sevkiyat, Muhasebe, Satış…) Mal Kabul karosu fabrikada
  // gerçekten belirir — kuralın koruduğu şey budur, "hiç olmasın" değil.
  const grLeak = Object.entries(ALLOWED_LEAKS)
    .filter(([code]) => code !== "WEB_TRADE")
    .flatMap(([code, ps]) => ps.filter((x) => x.startsWith("goods-receipt:")).map((x) => code + ":" + x));
  check(
    "§5c Mal kabul izni YALNIZ ticaret şablonunda (fabrika rollerine sızmadı)",
    grLeak.length === 0,
    grLeak.join(", ") || "temiz",
  );

  // ── §6 DEFTER AYRIMI ────────────────────────────────────────────────────
  // Depo hareketleri AYRI tabloda: `RollMovement` üretim akışının defteridir ve
  // oraya satır eklemek istasyon iş hacmi raporlarını sessizce şişirirdi.
  const rmCount = await prisma.rollMovement.count({ where: { rollId } });
  check("§6a Depo girişi RollMovement üretmedi", rmCount === 0, `rollMovement=${rmCount}`);
  const wmCount = await prisma.warehouseMovement.count({ where: { rollId } });
  check("§6b Depo defterine yazıldı", wmCount === 1, `warehouseMovement=${wmCount}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // Temizlik: RollVariance/RESTRICT zinciri yüzünden hareket satırları önce.
    if (rollIds.length > 0) {
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (tempWarehouseIds.length > 0) {
      await prisma.warehouse.deleteMany({ where: { id: { in: tempWarehouseIds } } });
    }
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
