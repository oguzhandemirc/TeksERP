// =============================================================================
// Test: PATRON ÖZETİ (`GET /api/boss/overview`) — 2026-09-01
// Çalıştır: npx tsx scripts/test_boss_overview.ts
// =============================================================================
// İKİ İDDİA:
//
// ⭐ ① İZİN SIZMIYOR. Uç `requirePermission` TAŞIMIYOR (bilinçli — beş bölüm beş
// ayrı izne bakıyor). Bu, süzmenin TAMAMEN servise emanet edildiği anlamına
// gelir; süzme kırılırsa yalnız `report:sales` taşıyan biri stok, üretim ve
// fason rakamlarını da görür ve bunu hiçbir yerde göremeyiz. Bu yüzden her
// bölüm hem POZİTİF hem NEGATİF yönde ölçülür.
//
// ⭐ ② RAKAMLAR KAYNAK RAPORLA BİREBİR AYNI ("ayrışan yüzey" sınıfı). Özet,
// mevcut rapor servislerini compose ediyor; bir gün biri "burada hızlıca
// hesaplayayım" derse patron ekranı ile rapor ekranı FARKLI sayı basar ve
// hangisinin doğru olduğu sorusunun cevabı kimsede olmaz. Bu bölüm o kaymayı
// mekanik olarak yakalar (2026-08-27'de aynı sınıf: pano 48 / envanter 47).
// =============================================================================

import prisma, { pool } from "../src/lib/prisma";
import { getBossOverview } from "../src/services/boss/overview.service";
import { getStockScorecard } from "../src/services/reports/stock-scorecard.report.service";
import { getOpenOrderCoverage } from "../src/services/reports/open-order-coverage.report.service";
import { InventoryService } from "../src/services/inventory.service";
import { ROLE_TEMPLATE_CATALOG } from "../src/constants/role-template-catalog";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";

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

const RANGE = { from: new Date(Date.now() - 30 * 86400_000), to: new Date() };
const call = (permissions: string[]) => getBossOverview({ permissions, range: RANGE });

/** Bölüm → onu açan izin(ler). Negatif sondanın kaynağı da bu tablodur. */
const SECTIONS = [
  ["stock", ["report:inventory"]],
  ["orders", ["report:sales"]],
  ["production", ["report:production", "roll:read"]],
  ["shipping", ["report:sales", "shipping:read"]],
  ["subcontract", ["report:subcontract"]],
] as const;

// -----------------------------------------------------------------------------
// 1) İZİN SÜZMESİ — pozitif ve negatif
// -----------------------------------------------------------------------------
async function sectionPermissions(): Promise<void> {
  console.log("\n[1] İzin süzmesi");
  check("körlük zemini: bölüm sayısı", SECTIONS.length === 5);

  // ⭐ İZİNSİZ KULLANICI HİÇBİR ŞEY GÖRMEZ.
  const none = await call([]);
  for (const [name] of SECTIONS) {
    check(
      `izinsiz: ${name} null`,
      none[name as keyof typeof none] === null,
      String(none[name as keyof typeof none] === null),
    );
  }
  check(
    "izinsiz: denied tüm bölümleri listeler",
    SECTIONS.every(([n]) => none.denied.includes(n)),
    none.denied.join(","),
  );

  // ⭐ TEK İZİN YALNIZ KENDİ BÖLÜMÜNÜ AÇAR — asıl sızıntı sondası.
  for (const [name, codes] of SECTIONS) {
    const only = await call([codes[0]]);
    check(`${codes[0]} → ${name} DOLU`, only[name as keyof typeof only] !== null);
    for (const [other] of SECTIONS) {
      if (other === name) continue;
      // "shipping" ile "orders" AYNI izni (report:sales) paylaşıyor — meşru.
      const shares = (SECTIONS.find((s) => s[0] === other)?.[1] as readonly string[]).includes(
        codes[0],
      );
      if (shares) continue;
      check(
        `  ${codes[0]} → ${other} SIZMIYOR`,
        only[other as keyof typeof only] === null,
      );
    }
  }

  // Tam yetki (`*`) her bölümü açar — RBAC joker kuralı burada da geçerli.
  const all = await call(["*"]);
  check(
    "'*' tüm bölümleri açar (matchesPermission kullanılıyor)",
    SECTIONS.every(([n]) => all[n as keyof typeof all] !== null) && all.denied.length === 0,
  );
  // ⚠️ `admin:*` rapor izinlerini VERMEZ (domain joker yalnız kendi öneki içinde).
  const adminOnly = await call(["admin:*"]);
  check(
    "'admin:*' rapor bölümlerini AÇMAZ (joker domain'e kapalı)",
    adminOnly.stock === null && adminOnly.orders === null,
  );
  // Domain jokeri kendi önekinde çalışır.
  const reportStar = await call(["report:*"]);
  check(
    "'report:*' rapor bölümlerini açar",
    reportStar.stock !== null && reportStar.orders !== null && reportStar.subcontract !== null,
  );
}

// -----------------------------------------------------------------------------
// 2) RAKAM MUTABAKATI — kaynak raporla birebir
// -----------------------------------------------------------------------------
async function sectionNumbers(): Promise<void> {
  console.log("\n[2] Rakam mutabakatı (kaynak raporla birebir)");
  const o = await call(["*"]);

  const stock = await getStockScorecard();
  check(
    "stok: rawQty kaynakla aynı",
    o.stock?.rawQty === stock.summary.rawQty,
    `${o.stock?.rawQty} ↔ ${stock.summary.rawQty}`,
  );
  check("stok: semiQty kaynakla aynı", o.stock?.semiQty === stock.summary.semiQty);
  check("stok: finishedQty kaynakla aynı", o.stock?.finishedQty === stock.summary.finishedQty);
  check("stok: deadQty kaynakla aynı", o.stock?.deadQty === stock.summary.deadQty);

  const cov = await getOpenOrderCoverage();
  check(
    "sipariş: openQty kaynakla aynı",
    o.orders?.openQty === cov.summary.openQty,
    `${o.orders?.openQty} ↔ ${cov.summary.openQty}`,
  );
  check("sipariş: coveragePct kaynakla aynı", o.orders?.coveragePct === cov.summary.coveragePct);
  check(
    "sipariş: geciken kalem kaynakla aynı",
    o.orders?.overdueLines === cov.summary.overdueUncoveredLines,
  );

  // ⚠️ KIRILIM LİSTELERİ DE ÖLÇÜLÜR — ilk yazımda ölçülmüyordu ve negatif sonda
  // bunu yakaladı: `byCustomer`da `openQty` yerine başka bir sayısal alan okumak
  // DERLENİYOR ve testi GEÇİYORDU. Yani patron ekranı sessizce başka bir rakam
  // basardı. Özet sayılar tutuyor diye kırılımın da tuttuğunu VARSAYMA.
  //
  // ⚠️ SONDA SEÇERKEN: bu veri setinde `openQty === uncoveredQty` (hiçbir sipariş
  // depodan karşılanmıyor, `fromWarehouseQty` her müşteride 0). O ikisini
  // birbiriyle değiştiren bir sonda YEŞİL kalır — kontrol yanlış olduğu için
  // değil, VERİ ayrımı ifade edemediği için. Kırmızı kanıtı `fromWarehouseQty`
  // ile ya da etiketi bozarak alınır (ikisi de ölçüldü, 2026-09-01).
  const covTop = cov.byCustomer.slice(0, 5);
  check(
    "sipariş: müşteri kırılımı kaynakla aynı (etiket VE metraj)",
    (o.orders?.topCustomers.length ?? -1) === covTop.length &&
      (o.orders?.topCustomers.every(
        (r, i) => r.label === covTop[i]?.label && r.qty === covTop[i]?.openQty,
      ) ??
        false),
    `${o.orders?.topCustomers[0]?.qty} ↔ ${covTop[0]?.openQty}`,
  );
  const stockTop = stock.byItem.slice(0, 5);
  check(
    "stok: kumaş kırılımı kaynakla aynı (etiket VE metraj)",
    (o.stock?.topItems.length ?? -1) === stockTop.length &&
      (o.stock?.topItems.every(
        (r, i) => r.label === stockTop[i]?.label && r.qty === stockTop[i]?.qty,
      ) ??
        false),
    `${o.stock?.topItems[0]?.qty} ↔ ${stockTop[0]?.qty}`,
  );

  // ⭐ ÜRETİM KOLONU: `total` TAM SAYIMDIR, önizleme dizisinin uzunluğu DEĞİL.
  // `.length` yazılsaydı her kolon 10'da tavanlanır ve fabrika büyüdükçe rakam
  // sessizce yanlışlaşırdı (önizleme PREVIEW=10).
  const flow = await new InventoryService().getProductionFlow({
    includeQueues: true,
    includeSevk: true,
  });
  const hamCol = o.production?.columns.find((c) => c.key === "hamStok");
  check(
    "üretim: Ham Stok sayımı kaynakla aynı",
    hamCol?.count === flow.data?.hamStok.total,
    `${hamCol?.count} ↔ ${flow.data?.hamStok.total}`,
  );
  check(
    "üretim: sayım ÖNİZLEME uzunluğu değil (PREVIEW tavanı yok)",
    hamCol?.count !== undefined && hamCol.count >= (flow.data?.hamStok.rolls.length ?? 0),
  );
  check(
    "üretim: yedi kolon da geliyor",
    o.production?.columns.length === 7,
    String(o.production?.columns.length),
  );
}

// -----------------------------------------------------------------------------
// 3) SÖZLEŞME + WEB_BOSS rolü
// -----------------------------------------------------------------------------
async function sectionContract(): Promise<void> {
  console.log("\n[3] Sözleşme + patron rolü");
  const o = await call(["*"]);
  check("generatedAt ISO", !Number.isNaN(Date.parse(o.generatedAt)));
  check("range yanıtta yer alıyor", o.range.from === RANGE.from.toISOString());

  const boss = ROLE_TEMPLATE_CATALOG.find((r) => r.code === "WEB_BOSS");
  check("WEB_BOSS şablonu katalogda", Boolean(boss));
  if (!boss) return;

  // `Set<string>` AÇIKÇA: katalog kodları katı bir union tipi ve
  // `Set<union>.has(string)` derlenmez. Bekçinin işi kodun katalogda OLUP
  // OLMADIĞINI ölçmek, tip düzeyinde zaten doğru olanı tekrarlamak değil.
  const known: Set<string> = new Set(PERMISSION_CATALOG.map((x) => String(x.code)));
  check(
    "WEB_BOSS'un her kodu izin kataloğunda var",
    boss.codes.every((c) => known.has(c)),
    boss.codes.filter((c) => !known.has(c)).join(",") || "hepsi geçerli",
  );

  // ⭐ Patron rolüyle özetin BEŞ bölümü de dolmalı — rol ile uç ayrışırsa
  // patron ekranı kartsız açılır ve sebebi hiçbir yerde yazmaz.
  const asBoss = await call([...boss.codes]);
  for (const [name] of SECTIONS) {
    check(`WEB_BOSS: ${name} dolu`, asBoss[name as keyof typeof asBoss] !== null);
  }

  // ⚠️ SoD üçlüsü ve finans BİLEREK dışarıda (2026-08-06 kararı).
  for (const forbidden of [
    "roll:manual-adjust",
    "shipping:invoice",
    "shipping:undo-dispatch",
    "report:finance",
    "admin:settings",
    "admin:users",
  ]) {
    check(`WEB_BOSS '${forbidden}' TAŞIMIYOR`, !(boss.codes as readonly string[]).includes(forbidden));
  }
}

// -----------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("=== PATRON ÖZETİ ===");
  await sectionPermissions();
  await sectionNumbers();
  await sectionContract();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

void main();
