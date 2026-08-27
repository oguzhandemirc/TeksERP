// =============================================================================
// Test: Dışarıdan alınan YARI MAMUL girişi (2026-08-17, madde 9)
// Çalıştır: npx tsx scripts/test_semi_finished_entry.ts
// =============================================================================
// Korunan invariant: yarı mamul RENKLİ gelir ama BİTMİŞ DEĞİLDİR.
//
// KK1 yolunda statü renkten çıkarılıyor:
//     colorId != null ? WAREHOUSE : STOCK
// Yarı mamul tanımı gereği renkli olduğu için bu sezgi onu doğrudan BİTMİŞ
// DEPO'ya düşürür — mal üretime hiç girmez, operatör onu ham stokta arar ve
// bulamaz. Bu yüzden çağrı statüyü AÇIKÇA zorlar (`forcedStatus: STOCK`) ve
// kaynağı ayrı işaretler (`entrySource: SEMI_FINISHED`).
//
// Bu bekçi ikisini de ölçer; biri düşerse sessiz bir stok kayması olur.
// =============================================================================
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { RollEntrySource, RollStatus } from "@prisma/client";

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

async function main(): Promise<void> {
  const ts = Date.now();
  const svc = new InventoryService();
  const rollIds: string[] = [];
  let itemId = "";
  let colorId = "";

  try {
    const item = await prisma.item.create({
      data: { code: `TEST-SEMI-ITM-${ts}`, name: `TEST SEMI KUMAS ${ts}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    itemId = item.id;
    const color = await prisma.color.create({
      data: { code: `TEST-SEMI-CLR-${ts}`, name: `TEST SEMI MAVI ${ts}` },
      select: { id: true },
    });
    colorId = color.id;

    // ── 1) Yarı mamul: RENKLİ ama HAM STOKTA ────────────────────────────────
    const semi = await svc.createInitialEntry(
      { itemId, colorId, initialQty: 1200 },
      undefined,
      null,
      false,
      {
        forcedEntrySource: RollEntrySource.SEMI_FINISHED,
        forcedStatus: RollStatus.STOCK,
      },
    );
    const semiRoll = semi.data as { id: string; status: string; entrySource: string; colorId: string | null };
    rollIds.push(semiRoll.id);
    check("yarı mamul topu oluştu", Boolean(semiRoll.id));
    check("rengi var (boyalı geldi)", semiRoll.colorId === colorId);
    check(
      "HAM STOK'a düştü (bitmiş depoya DEĞİL)",
      semiRoll.status === RollStatus.STOCK,
      `status=${semiRoll.status}`,
    );
    check(
      "giriş kaynağı SEMI_FINISHED",
      semiRoll.entrySource === RollEntrySource.SEMI_FINISHED,
      `entrySource=${semiRoll.entrySource}`,
    );

    // ── 2) KARŞILAŞTIRMA: aynı payload, bayraksız → BİTMİŞ DEPO ─────────────
    // Bu satır kararın gerekçesini KANITLAR: bayrak olmasaydı mal depoya
    // düşerdi. Fixture ayırt edici olmasaydı 1. kontrol vakumen yeşil kalırdı.
    const plain = await svc.createInitialEntry({ itemId, colorId, initialQty: 900 });
    const plainRoll = plain.data as { id: string; status: string; entrySource: string };
    rollIds.push(plainRoll.id);
    check(
      "bayraksız aynı giriş BİTMİŞ DEPO'ya düşüyor (sezgi hâlâ yürürlükte)",
      plainRoll.status === RollStatus.WAREHOUSE,
      `status=${plainRoll.status}`,
    );
    check(
      "bayraksız girişin kaynağı SEMI_FINISHED DEĞİL",
      plainRoll.entrySource !== RollEntrySource.SEMI_FINISHED,
      `entrySource=${plainRoll.entrySource}`,
    );

    // ── 3) Envanterde SÜZÜLEBİLİR (ayrı depo yerine ayrı işaret kararı) ─────
    const filtered = await prisma.roll.findMany({
      where: { entrySource: RollEntrySource.SEMI_FINISHED, id: { in: rollIds } },
      select: { id: true },
    });
    check("giriş türüne göre süzülüyor", filtered.length === 1 && filtered[0].id === semiRoll.id);

    // ── 4) Statüsü STOCK — yani üretime aday ────────────────────────────────
    // ⚠️ Bu kontrol 2026-08-26'da ANLAM DEĞİŞTİRDİ. Eskiden "ham stok listesinde
    // görünür" diyordu; artık yarı mamul Envanter'de KENDİ sekmesinde duruyor ve
    // Ham Stok listesinde GÖRÜNMÜYOR (§5). Ölçtüğü invariant yine de geçerli ve
    // gerekli: top hâlâ STOCK statüsünde, yani iş emrine bağlanabilir.
    const inStock = await prisma.roll.count({
      where: { id: semiRoll.id, status: RollStatus.STOCK },
    });
    check("STOCK statüsünde (iş emrine bağlanabilir)", inStock === 1);

    // ── 5) ENVANTER KAPSAMLARI: ham ↔ yarı mamul ayrımı ─────────────────────
    // Ayrım üç kapsamla kuruluyor ve üçünün İLİŞKİSİ load-bearing:
    //   RAW_STOCK       = birleşim  → mobil Hızlı İş Emri top seçicisi kullanır
    //   RAW_STOCK_PURE  = yalnız ham → masaüstü "Ham Stok" sekmesi
    //   SEMI_FINISHED   = yalnız yarı mamul → masaüstü "Yarı Mamul" sekmesi
    // Birleşim daraltılırsa yarı mamul TABLETTEN görünmez olur; dar kapsamlar
    // gevşerse envanterdeki ayrım sessizce geri alınır.
    const scopeIds = async (scope: string): Promise<string[]> => {
      const where = (
        svc as unknown as {
          buildRollWhere: (p: { filters: Record<string, string> }) => Record<string, unknown>;
        }
      ).buildRollWhere({ filters: { rollScope: scope, status: "ALL" } });
      const rows = await prisma.roll.findMany({
        where: { AND: [where as never, { id: { in: rollIds } }] },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    };

    // Karşılaştırma için ikinci bir HAM top (renksiz → STOCK, SUPPLIER_RECEIPT).
    const rawEntry = await svc.createInitialEntry({ itemId, initialQty: 700 });
    const rawRoll = rawEntry.data as { id: string; status: string };
    rollIds.push(rawRoll.id);
    check("karşılaştırma topu ham stokta", rawRoll.status === RollStatus.STOCK, `status=${rawRoll.status}`);

    const pure = await scopeIds("RAW_STOCK_PURE");
    const semiScope = await scopeIds("SEMI_FINISHED");
    const union = await scopeIds("RAW_STOCK");

    check("RAW_STOCK_PURE yarı mamulü GÖRMEZ", !pure.includes(semiRoll.id));
    check("RAW_STOCK_PURE ham topu görür", pure.includes(rawRoll.id));
    check("SEMI_FINISHED yalnız yarı mamulü görür", semiScope.length === 1 && semiScope[0] === semiRoll.id);
    check(
      "RAW_STOCK İKİSİNİ BİRDEN görür (tablet sözleşmesi — DARALTMA)",
      union.includes(semiRoll.id) && union.includes(rawRoll.id),
    );
    check(
      "birleşim = dar kapsamların toplamı",
      union.length === pure.length + semiScope.length,
      `union=${union.length} pure=${pure.length} semi=${semiScope.length}`,
    );

    // ── 6) Bilinmeyen kapsam SESSİZ KALMAZ ──────────────────────────────────
    // Eskiden eşleşmeyen bir değer hiçbir daralma yapmıyordu ve liste
    // CANCELLED/SHIPPED dahil TÜM tabloyu döndürüyordu — hata yok, log yok.
    let unknownThrew = false;
    try {
      await scopeIds("YOK_BOYLE_BIR_KAPSAM");
    } catch {
      unknownThrew = true;
    }
    check("bilinmeyen rollScope reddediliyor", unknownThrew);

    // ── 7) Top geçmişinde "Ham Giriş" YAZMAZ ────────────────────────────────
    // `entryTitle` switch'inin default dalı sessiz bir yalan üretiyordu: enum'a
    // 2026-08-17'de eklenen SEMI_FINISHED case'i yazılmamıştı.
    const hist = await svc.getRollHistory(semiRoll.id);
    const events = (hist.data as { events?: Array<{ title?: string }> } | null)?.events ?? [];
    const entryEvent = events[0];
    check(
      "geçmişte 'Ham Giriş' değil yarı mamul yazıyor",
      Boolean(entryEvent?.title && !entryEvent.title.includes("Ham Giriş")),
      `title=${entryEvent?.title}`,
    );
  } finally {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    if (colorId) await prisma.color.deleteMany({ where: { id: colorId } });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
