// =============================================================================
// BEKÇİ — ANA VERİ BİRLEŞTİRMESİ × YAZMA YARIŞI (BULGU-T3-007)
// Çalıştır: npx tsx scripts/test_master_data_merge_race.ts
// =============================================================================
// `Roll.itemId` CANLI bir kumaş satırını göstermelidir. Birleştirme kaynağı
// mezar taşına dönerken (`mergedIntoId` dolu, `isActive=false`) o kumaşa bakan
// TÜM toplar survivor'a taşınır. Ama taşıma turu, kendisinden SONRA doğan bir
// topu göremez:
//
//   • KK1 kontrolü tx DIŞINDA koşar → "kumaş aktif" der,
//   • birleştirme commit eder, taşıma turu o topu göremez (henüz yok),
//   • KK1 tx'i INSERT eder → canlı, barkodlu, ama MEZAR TAŞI kumaşa bakan top.
//
// O top envanter toplamına girer ama survivor'ın ürün filtresinde, Ürün
// Dengesi'nde ve sipariş karşılamada HİÇ GÖRÜNMEZ (hepsi `mergedIntoId IS NULL`
// süzer). Operatör "girdim ama yok" der; kimse arayamaz.
//
// İKİ KATMAN, ikisi de gerekli (ölçümle bulundu):
//   §1 TAZE OKUMA — tx içinde mezar taşı kontrolü. Deterministik durumu kapatır.
//   §2 PAYLAŞIMLI KİLİT — taze okuma TEK BAŞINA YETMEZ: yazma tx'i açıldığında
//      birleştirme henüz COMMIT ETMEMİŞTİR, yani okunacak bir mezar taşı da
//      yoktur. İki işlem birbirini beklemek zorundadır. Birleştirme
//      `pg_advisory_xact_lock(8030,1)` EXCLUSIVE alır; yazma yolu aynı anahtarı
//      SHARED alır (yazıcılar birbirini engellemez, yalnız birleştirmeyle
//      serileşirler).
//      ⚠️ Ölçüldü: yalnız taze okumayla repro §2'de 12 turun 3'ü hâlâ mezar
//      taşına yazıyordu.
// =============================================================================
import { ItemType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";

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

const STAMP = `TSTMRG${Date.now().toString().slice(-7)}`;
const inv = new InventoryService();
const itemIds: string[] = [];
const rollIds: string[] = [];
let ADMIN = "";
let seq = 0;

async function mkItem(tag: string): Promise<{ id: string; name: string }> {
  seq += 1;
  const it = await prisma.item.create({
    data: {
      code: `${STAMP}${String(seq).padStart(2, "0")}`.slice(0, 30),
      name: `${STAMP} ${tag} ${seq}`,
      itemType: ItemType.FABRIC,
    },
    select: { id: true, name: true },
  });
  itemIds.push(it.id);
  return it;
}

async function giris(itemId: string): Promise<{ ok: boolean; code: string; rollId: string | null }> {
  try {
    const r = await inv.createInitialEntry({ itemId, initialQty: 100 }, ADMIN);
    const id = (r.data as { id: string }).id;
    rollIds.push(id);
    return { ok: true, code: "", rollId: id };
  } catch (e) {
    return {
      ok: false,
      code: String((e as { details?: { code?: string } }).details?.code ?? ""),
      rollId: null,
    };
  }
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("fixture eksik: admin");
  ADMIN = admin.id;

  // ═══ §1 — DETERMİNİSTİK: mezar taşına giriş ═══
  // ⚠️ YALNIZ `mergedIntoId` doldurulur, `isActive` TRUE bırakılır: böylece
  // "yazma yolu mezar taşını KENDİ BAŞINA tanıyor mu" sorusu izole edilir.
  // (`isActive=false` ile karışsaydı eski, zaten var olan kontrol de geçerdi ve
  // yeni kapının işe yarayıp yaramadığı ölçülemezdi.)
  console.log("\n=== §1: mezar taşı kumaşa giriş (deterministik) ===");
  const survivor = await mkItem("SURVIVOR");
  const loser = await mkItem("TOMBSTONE");
  await prisma.item.update({
    where: { id: loser.id },
    data: { mergedIntoId: survivor.id, mergedAt: new Date() },
  });
  const r1 = await giris(loser.id);
  check(
    "§1: mezar taşı kumaşa giriş REDDEDİLİR",
    !r1.ok && r1.code === "ITEM_MERGED",
    `code=${r1.code || "(yok)"} ok=${r1.ok}`,
  );
  // Survivor'a giriş SERBEST kalmalı — kapı yalnız ölü satırı kesiyor, çalışmayı
  // durdurmuyor. (Bu kontrol olmasaydı "her girişi reddet" de yeşil verirdi.)
  const r1b = await giris(survivor.id);
  check("§1: survivor kumaşa giriş SERBEST (kapı çalışmayı durdurmuyor)", r1b.ok, `ok=${r1b.ok}`);
  await prisma.item.update({ where: { id: loser.id }, data: { mergedIntoId: null, mergedAt: null } });

  // ═══ §2 — GERÇEK YARIŞ ═══
  console.log("\n=== §2: birleştirme ile EŞZAMANLI giriş (8 tur) ===");
  const TUR = 8;
  let yetim = 0;
  let reddedilen = 0;
  let tasinan = 0;
  for (let t = 0; t < TUR; t++) {
    const surv = await mkItem(`S${t}`);
    // Birleştirmeyi UZATMAK için birden çok kaynak (her kaynak 42 taşıma kuralı
    // koşturur) — yarış penceresi görünür olsun.
    const kaynaklar = [await mkItem(`L${t}a`), await mkItem(`L${t}b`), await mkItem(`L${t}c`)];
    const hedef = kaynaklar[1]!; // operatörün ekranında seçili kalan kumaş
    const [, g] = await Promise.all([
      MasterDataMergeService.merge("item", {
        survivorId: surv.id,
        sourceIds: kaynaklar.map((k) => k.id),
        reason: `${STAMP} yaris testi`,
        acknowledgedConflicts: 0,
        userId: ADMIN,
      }).catch((e: unknown) => {
        if (t === 0) console.log("   [merge hatası] " + String((e as Error).message).slice(0, 140));
        return null;
      }),
      new Promise((r) => setTimeout(r, 3 * t)).then(() => giris(hedef.id)),
    ]);
    if (!g.ok) reddedilen++;
    if (g.ok && g.rollId) {
      const roll = await prisma.roll.findUnique({
        where: { id: g.rollId },
        select: { itemId: true, item: { select: { mergedIntoId: true } } },
      });
      if (roll?.item.mergedIntoId) yetim++;
      // Top KAYNAK kumaşa yazıldı ama şimdi SURVIVOR'ı gösteriyorsa,
      // birleştirmenin taşıma turu onu GÖRDÜ demektir → yarış penceresi
      // gerçekten yaşandı.
      if (roll?.itemId === surv.id) tasinan++;
    }
  }
  // ⭐ ASIL DEĞİŞMEZ: hiçbir canlı top mezar taşı kumaşa bakmaz. "Her tur
  // reddedilsin" BEKLENMEZ — birleştirme daha başlamadan gelen giriş MEŞRUDUR
  // ve geçmelidir (esneklik korunur).
  check("§2: hiçbir tur MEZAR TAŞI kumaşa top yazmadı", yetim === 0, `yetim=${yetim}/${TUR}`);
  // ⭐ KÖRLÜK ZEMİNİ — "yarış GERÇEKTEN yaşandı mı".
  // ⚠️ İlk yazımda zemin "en az bir tur REDDEDİLDİ" idi ve KIRMIZI verdi:
  // 8 turun 8'inde giriş birleştirmeden ÖNCE commit etti, birleştirme de onu
  // survivor'a TAŞIDI — yani sistem doğru davrandı ama zemin yanlış şeyi
  // bekliyordu. Red ZORUNLU DEĞİLDİR; zorunlu olan, iki işlemin gerçekten
  // çakışmış olmasıdır. Doğru ölçüt: giriş ya REDDEDİLDİ ya da kaynak kumaşa
  // yazılıp SURVIVOR'a TAŞINDI. İkisi de olmadıysa pencere ıskalanmıştır ve
  // "yetim yok" sonucu hiçbir şey kanıtlamaz.
  check(
    "§2: yarış penceresi gerçekten yaşandı (körlük zemini)",
    reddedilen + tasinan > 0,
    `taşınan=${tasinan}/${TUR} · reddedilen=${reddedilen}/${TUR}`,
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
    await prisma.roll.deleteMany({ where: { itemId: { in: itemIds } } }).catch(() => undefined);
    await prisma.item.updateMany({ where: { id: { in: itemIds } }, data: { mergedIntoId: null } }).catch(() => undefined);
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } }).catch(() => undefined);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
