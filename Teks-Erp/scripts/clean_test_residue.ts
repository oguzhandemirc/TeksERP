// =============================================================================
// Test artığı temizleyici — çökmüş/yarım kalan koşumlardan kalan fixture'lar
// Çalıştır: npx tsx scripts/clean_test_residue.ts          (dry-run, sadece rapor)
//           npx tsx scripts/clean_test_residue.ts --apply  (gerçekten siler)
//
// NEDEN VAR: dev veritabanı artık fabrikanın canlı yedeği. Testler kendi
// yarattığını `finally`/`teardown` içinde siler — ama koşucu 180sn'de SIGTERM
// gönderdiğinde o blok HİÇ çalışmaz. Kalan satırlar iki zarar verir:
//   1. `test_consistency` §18 (aktif master-data ad mükerreri) kalıcı kırmızıya
//      döner ve GERÇEK bir mükerrer bulgusu bu gürültünün içinde kaybolur.
//   2. `TEST-SINV-*` toplar WAREHOUSE/AT_KARTELA statüsünde kalır → Envanter
//      ekranlarında hayalet stok olarak görünür.
//
// ⚠️ GÜVENLİK — SADECE KİMLİK ALANI: silme kararı yalnız kod/barkod/sipariş no
// üzerindeki `TEST-`/`TST-` damgasına bakar. AD'a göre HİÇBİR silme yapılmaz
// (ad eşleşmesi fabrika kaydını da yakalardı). Damganın fabrika verisinde SIFIR
// satır eşlediği 2026-09-05 yedeği üzerinde ölçüldü — bkz. `TEST_DAMGALARI`.
//
// Silinemeyen satır SESSİZCE ATLANMAZ, raporlanır: bir fixture'ın neden
// silinemediği ("şu top hâlâ o rengi kullanıyor") testin temizlik sırasındaki
// gerçek bir hatasına işaret edebilir.
// @temizlik-scripti: dosyanın TAMAMI temizliktir — çökmüş koşumların artığını süpüren araç; silme testin sonunda değil, işin KENDİSİ
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { assertGelistirmeVeritabani } from "./db-guard";
import { fixtureHedefEngeli, hacimHedefEngeli, hedefDbAdi } from "./lib/hedef-db-kapisi";

// ⚠️ İLK İFADE — bu betik geri alınamaz silme yapar ve hedefini `DATABASE_URL`den
// okur. Kapı 2026-09-06'da eklendi: betik silmeyi Prisma `deleteMany` ile yaptığı
// için `test_script_guards`ın ham-SQL izleri onu yıkıcı olarak GÖRMÜYORDU; yani
// kapısız kaldığı fark edilmemişti.
assertGelistirmeVeritabani("clean_test_residue");

// ⚠️ İKİNCİ KAPI (2026-09-12): `db-guard` `_dev`/`_demo`yu da GELİŞTİRME hedefi
// sayar ve bu projede dev hedefi artık fabrikanın canlı YEDEĞİ. Fixture silen bu
// betik için o izin fazla geniş: hedef fixture kalıbında değilse `--apply`
// OLMADAN da dururuz. Kuru koşum "zararsız" değildir — raporu doğru sanan
// operatörün bir sonraki komutu `--apply` olur.
const fixtureEngeli = fixtureHedefEngeli();
if (fixtureEngeli) {
  console.error(`\n⛔ clean_test_residue DURDURULDU — ${fixtureEngeli}\n`);
  process.exit(1);
}
// ⚠️ KAÇIŞIN İZİ, OKUYAN YOLUNKİNDEN ZAYIF OLAMAZ: `BEKCI_HEDEF_ONAY=1` ile
// geçildiğinde `db-guard`ın "🔓 Hedef doğrulandı" satırı ONAYLAYICI görünüyor ve
// hedefin fixture OLMADIĞI çıktının hiçbir yerinde yazmıyordu. Geri alınamaz
// silme yapan yol, hedefini her koşumda ADIYLA beyan eder.
console.log(`\n🎯 Hedef veritabanı: ${hedefDbAdi()}`);
if (process.env.BEKCI_HEDEF_ONAY === "1") {
  console.warn(
    `⚠️  FIXTURE OLMAYAN HEDEFTE SİLME — ${hedefDbAdi()} (BEKCI_HEDEF_ONAY=1 ile geçildi)`,
  );
}

const APPLY = process.argv.includes("--apply");

/**
 * Test fixture damgası — ENVANTER DEĞİL DESEN (2026-09-06).
 *
 * ÖNCE ne vardı: elle tutulan 14 önekli bir liste ("yeni bir önek doğarsa buraya
 * ekle"). ÖLÇÜLDÜ: o liste dev veritabanındaki 313 artık topun SIFIRINI eşliyordu;
 * bekçi dosyalarında geçen farklı `TEST-`/`TST-` öneki sayısı 406'ydı. Elle sayılan
 * kapsam listesi bu repoda zaten yasak (kök CLAUDE.md § Yasaklar) — envanter
 * tutulmaz, desen tutulur.
 *
 * ⚠️ GÜVENLİK SONDASI (2026-09-06, fabrikanın 2026-09-05 yedeği üzerinde):
 * bu desen FABRİKA verisinde rolls/work_orders/orders/items/colors/customers/sacks
 * tablolarının hiçbirinde tek satır bile eşlemedi (0). Aynı desen dev veritabanında
 * 328 top + 5 ürün + 7 müşteri yakalıyor.
 *
 * ⚠️ YALNIZ KİMLİK ALANI: eşleşme yalnız kod/barkod/sipariş no üzerinde yapılır.
 * AD'a göre HİÇBİR silme yoktur — ad eşleşmesi fabrika kaydını da yakalardı ve
 * fixture adlarının damgasız olabildiği ölçüldü ([DB-29d]).
 */
const TEST_DAMGALARI = ["TEST-", "TST-"];

const orPrefix = (field: string, prefixes: string[]) =>
  prefixes.map((p) => ({ [field]: { startsWith: p } }));

/**
 * Hata gerekçesinin İLK ANLAMLI satırı. Prisma hataları çok satırlı ve ÇOĞU
 * BOŞ SATIRLA BAŞLAR — düz `message.split("\n")[0]` boş string döndürür ve
 * rapor "SİLİNEMEDİ: " diye gerekçesiz kalır. Bu dosyanın kendi başlığındaki
 * kural ("silinemeyen satır SESSİZCE ATLANMAZ, raporlanır") o hâlde fiilen
 * çiğnenmiş olur — ölçüldü 2026-09-06, 8 satır gerekçesiz raporlandı.
 */
function ilkSatir(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const anlamli = e.message
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  // Prisma kodu (P2003 = FK ihlali) varsa başa koy — asıl teşhis odur.
  const kod = (e as { code?: string }).code;
  const govde = anlamli[0] ?? e.name;
  return kod ? `${kod} — ${govde}` : govde;
}

let planned = 0;
let deleted = 0;
let blocked = 0;

async function phase(label: string, run: () => Promise<number>): Promise<void> {
  if (!APPLY) return;
  try {
    const n = await run();
    if (n > 0) console.log(`  ↳ ${label}: ${n}`);
  } catch (e) {
    blocked++;
    console.log(`  ⚠️  ${label} BAŞARISIZ: ${ilkSatir(e)}`);
  }
}

async function main() {
  // ÜÇÜNCÜ KAPI — HACİM: ad kalıbı doğru olsa bile hedef fabrika ölçeğinde veri
  // taşıyorsa (fabrikanın `..._test` adlı yeni bir kopyası) silme YAPILMAZ.
  const hacim = await hacimHedefEngeli();
  if (hacim.engel) {
    console.error(`\n⛔ clean_test_residue DURDURULDU — ${hacim.engel}\n`);
    process.exit(1);
  }
  if (hacim.olcumNotu) console.log(`⚠️  Hedef hacmi ölçülemedi (${hacim.olcumNotu}) — yalnız ad kapısı geçerli.`);

  console.log(APPLY ? "== UYGULAMA MODU (siler) ==" : "== DRY-RUN (yazmaz; --apply ile uygula) ==");

  // ── 1) TOPLAR — bağımlı satırlar önce, FK sırası test teardown'larıyla aynı ──
  const rolls = await prisma.roll.findMany({
    where: { OR: orPrefix("barcode", TEST_DAMGALARI) },
    select: { id: true, barcode: true, status: true },
  });
  console.log(`\n── TOPLAR — ${rolls.length} artık (${TEST_DAMGALARI.join(", ")}) ──`);
  planned += rolls.length;
  if (!APPLY) for (const r of rolls) console.log(`  • ${r.barcode} [${r.status}]`);
  const rollIds = rolls.map((r) => r.id);
  if (rollIds.length > 0) {
    // Çuval/sevkiyat/adım bağlarını KOPAR — aksi halde sack/shipment silinemez.
    await phase("çuval-sevkiyat bağı koparıldı", async () =>
      (await prisma.roll.updateMany({
        where: { id: { in: rollIds } },
        data: { sackId: null, shipmentId: null, currentStepId: null },
      })).count,
    );
    // Kartela zinciri: makbuz kalemi → sevk kalemi → kartela. Sıra ZORUNLU,
    // `kartela_dispatch_items.rollId` RESTRICT (topu doğrudan silmeye izin vermez).
    // Makbuz kalemi topa İKİ yoldan bağlı: tükenen top (`consumedRollId`) ve
    // kaynak sevk kalemi (`sourceDispatchItemId` → o kalemin `rollId`'si). İkisi de
    // temizlenmezse sevk kalemi ya da top silinemez.
    await phase("kartela makbuz kalemleri", async () =>
      (await prisma.kartelaReceiptItem.deleteMany({
        where: {
          OR: [
            { consumedRollId: { in: rollIds } },
            { sourceDispatchItem: { rollId: { in: rollIds } } },
          ],
        },
      })).count,
    );
    await phase("kartela sevk kalemleri", async () =>
      (await prisma.kartelaDispatchItem.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    // Kalemler + KALEMSİZ KALAN BAŞLIK: kalemi silip başlığı bırakmak, fason
    // sevklerinde aynı sınıf hasarı doğurmuştu (başlık duruyor, kalemi yok).
    // Kapsam TEST damgasıyla sınırlı: yalnız bu topların kartelalarını düşen düşümler.
    const dusumIds = [
      ...new Set(
        (
          await prisma.swatchStockReductionItem.findMany({
            where: { swatch: { parentRollId: { in: rollIds } } },
            select: { reductionId: true },
          })
        ).map((i) => i.reductionId),
      ),
    ];
    await phase("kartela düşüm kalemleri", async () =>
      (await prisma.swatchStockReductionItem.deleteMany({
        where: { swatch: { parentRollId: { in: rollIds } } },
      })).count,
    );
    await phase("kalemsiz kalan kartela düşümleri (başlık)", async () =>
      dusumIds.length === 0
        ? 0
        : (await prisma.swatchStockReduction.deleteMany({ where: { id: { in: dusumIds }, items: { none: {} } } })).count,
    );
    await phase("kartelalar", async () =>
      (await prisma.swatch.deleteMany({ where: { parentRollId: { in: rollIds } } })).count,
    );
    // ⚠️ FK ZİNCİRİ 2026-09-06'DA TAMAMLANDI. Eksik olan BEŞ RESTRICT bağı,
    // `--apply` ilk kez koşulduğunda 453 topun tamamını P2003 ile düşürdü ve
    // gerekçe raporda BOŞ görünüyordu (bkz. `ilkSatir`). Şema envanterinden
    // ölçüldü: `rolls`a bakan 17 FK'nın 11'i RESTRICT ve altısı burada eksikti.
    await phase("fason sevk kalemleri", async () =>
      (await prisma.subcontractorDispatchItem.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("fason kabul kalemleri", async () =>
      (await prisma.subcontractorReceiptItem.deleteMany({ where: { newRollId: { in: rollIds } } })).count,
    );
    await phase("sayım satırları", async () =>
      (await prisma.stockCountLine.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("plan sapmaları", async () =>
      (await prisma.rollPlanDeviation.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("sapma kayıtları (RollVariance)", async () =>
      (await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("hata kayıtları", async () =>
      (await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("iade kayıtları", async () =>
      (await prisma.rollReturn.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("hareketler", async () =>
      (await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("operasyonlar", async () =>
      (await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("özellikler", async () =>
      (await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("çocuk toplar", async () =>
      (await prisma.roll.deleteMany({ where: { parentRollId: { in: rollIds } } })).count,
    );
    // ⚠️ ÜST KAYIT DA GİDER — 2026-09-06'da bu satır EKSİKTİ ve ısırdı: yalnız
    // kalemleri silmek 429 fason sevkini KALEMSİZ bıraktı ve `test_consistency`
    // §19 (snapshot toplamı ↔ kalem toplamı) 429 drift satırıyla kırmızı verdi.
    // Ders: bir kaleme dokunan temizlik, o kalemin ÖZETİNİ tutan satırı da
    // hesaba katmak zorundadır — yoksa temizlik bir tutarsızlık ÜRETİR.
    // ⚠️ KAPSAM DAR: yalnız KALEMİ KALMAMIŞ ve TEST iş emrine bağlı sevk/fişler.
    // "Boş olan her sevkiyatı sil" demek fabrikanın meşru boş kaydını da alırdı.
    await phase("kalemsiz fason sevkleri (üst kayıt)", async () =>
      (await prisma.subcontractorDispatch.deleteMany({
        where: {
          items: { none: {} },
          workOrder: { OR: orPrefix("workOrderNumber", TEST_DAMGALARI) },
        },
      })).count,
    );
    await phase("kalemsiz fason fişleri (üst kayıt)", async () =>
      (await prisma.subcontractorReceipt.deleteMany({
        where: {
          items: { none: {} },
          workOrder: { OR: orPrefix("workOrderNumber", TEST_DAMGALARI) },
        },
      })).count,
    );
    await phase("toplar", async () => {
      const n = (await prisma.roll.deleteMany({ where: { id: { in: rollIds } } })).count;
      deleted += n;
      return n;
    });
  }

  // ── 2) SİPARİŞLER ──
  const orders = await prisma.order.findMany({
    where: { OR: orPrefix("orderNumber", TEST_DAMGALARI) },
    select: { id: true, orderNumber: true },
  });
  console.log(`\n── SİPARİŞLER — ${orders.length} artık (${TEST_DAMGALARI.join(", ")}) ──`);
  planned += orders.length;
  if (!APPLY) for (const o of orders) console.log(`  • ${o.orderNumber}`);
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length > 0) {
    await phase("sipariş kalemleri", async () =>
      (await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } })).count,
    );
    await phase("siparişler", async () => {
      const n = (await prisma.order.deleteMany({ where: { id: { in: orderIds } } })).count;
      deleted += n;
      return n;
    });
  }

  // ── 3) MASTER DATA — şubeler müşteriden ÖNCE ──
  const targets = [
    { label: "ŞUBE", model: "customerBranch" as const, where: { customer: { OR: orPrefix("code", TEST_DAMGALARI) } } },
    { label: "MÜŞTERİ", model: "customer" as const, where: { OR: orPrefix("code", TEST_DAMGALARI) } },
    { label: "RENK", model: "color" as const, where: { OR: orPrefix("code", TEST_DAMGALARI) } },
    { label: "ÜRÜN", model: "item" as const, where: { OR: orPrefix("code", TEST_DAMGALARI) } },
  ];

  for (const t of targets) {
    const delegate = (prisma as unknown as Record<string, {
      findMany: (a: unknown) => Promise<{ id: string; name: string }[]>;
      delete: (a: unknown) => Promise<unknown>;
    }>)[t.model];
    const rows = await delegate.findMany({
      where: t.where,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    console.log(`\n── ${t.label} — ${rows.length} artık ──`);
    planned += rows.length;
    for (const r of rows) {
      if (!APPLY) {
        console.log(`  • ${r.name}`);
        continue;
      }
      try {
        await delegate.delete({ where: { id: r.id } });
        deleted++;
        console.log(`  ✅ ${r.name}`);
      } catch (e) {
        blocked++;
        console.log(
          `  ⚠️  ${r.name} — SİLİNEMEDİ: ${ilkSatir(e)}`,
        );
      }
    }
  }

  console.log(
    APPLY
      ? `\n=== ${deleted} kayıt silindi, ${blocked} engellendi ===`
      : `\n=== ${planned} kayıt silinecek (dry-run — hiçbir şey yazılmadı) ===`,
  );
  return blocked;
}

main()
  .then(async (b) => {
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = b > 0 ? 1 : 0;
  })
  .catch(async (e) => {
    console.error("HATA:", e);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = 1;
  });
