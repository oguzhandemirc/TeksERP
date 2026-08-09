// =============================================================================
// Test: "Son Çıkan Toplar" FİLTRELERİ + `Roll.labelCustomerId`
// Çalıştır: npx tsx scripts/test_recent_output_filters.ts
// =============================================================================
// 2026-08-09 saha isteği: "son çıkan toplar listesinde filtreler olsun —
// bugün, son 2 gün, belli tarih aralığı gibi". Uç o güne kadar yalnız
// `workOrderId · limit · cursor · search · withTotal` alıyordu.
//
// Bu bekçi dört şeyi kilitler:
//   §1 GÜN SINIRI FABRİKA GÜNÜNE göre — düz `new Date()` gece vardiyasının
//      00:00-03:00 arası işini BİR ÖNCEKİ güne yazardı (kök CLAUDE.md kuralı).
//      Bu, sessiz yanlış liste üreten türden bir hatadır: hata yok, log yok.
//   §2 `dayRange` ile serbest aralık ÇAKIŞIRSA hızlı seçim kazanır (AND'lenirse
//      "bugün" derken boş liste dönebilirdi).
//   §3 `labelCustomerId` etiket niyetiyle AYNI yazımda dolar (ayrışırsa filtre
//      sessizce yanlış liste döndürür).
//   §4 Filtreler cursor sözleşmesini BOZMAZ (sayfalama çalışmaya devam eder).
// =============================================================================
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { factoryDayStart } from "../src/constants/time";

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

const tambur = new TamburService();

interface Page {
  data: Array<{ id: string; barcode: string | null }>;
  pagination?: { hasMore: boolean; nextCursor: string | null };
}

const list = async (
  p: Parameters<typeof tambur.listRecentOutputRolls>[0],
): Promise<Page> => ((await tambur.listRecentOutputRolls({ mode: "cursor", ...p })) as unknown) as Page;

async function main(): Promise<void> {
  const ts = Date.now();
  const rollIds: string[] = [];
  let itemId = "";
  let customerId = "";
  let otherCustomerId = "";

  const mk = async (
    tag: string,
    createdAt: Date,
    opts: { quality?: string; customer?: string | null } = {},
  ): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TEST-RF-${tag}-${ts}`,
        itemId,
        status: RollStatus.WAREHOUSE,
        initialQty: 10,
        currentQty: 10,
        qualityGrade: opts.quality ?? "1.KALITE",
        entrySource: "TAMBUR_SPLIT",
        labelCustomerId: opts.customer ?? null,
        createdAt,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };

  try {
    const item = await prisma.item.create({
      data: { code: `TEST-RF-${ts}`, name: `TEST Filtre ${ts}`, itemType: "FABRIC" },
      select: { id: true },
    });
    itemId = item.id;
    const c1 = await prisma.customer.create({
      data: { code: `TEST-RFC1-${ts}`, name: `TEST Müşteri A ${ts}` },
      select: { id: true },
    });
    const c2 = await prisma.customer.create({
      data: { code: `TEST-RFC2-${ts}`, name: `TEST Müşteri B ${ts}` },
      select: { id: true },
    });
    customerId = c1.id;
    otherCustomerId = c2.id;

    const todayStart = factoryDayStart();
    // ⭐ GECE VARDİYASI TOPU: fabrika gününün ilk saati. UTC gün sınırı
    // kullanılsaydı bu top DÜNE düşer ve "bugün" filtresinde GÖRÜNMEZDİ.
    const nightShift = new Date(todayStart.getTime() + 30 * 60_000);
    const yesterday = new Date(todayStart.getTime() - 6 * 60 * 60_000);
    const weekAgo = new Date(todayStart.getTime() - 5 * 24 * 60 * 60_000);

    const idNight = await mk("NIGHT", nightShift, { customer: customerId });
    const idYest = await mk("YEST", yesterday, { quality: "A1" });
    const idWeek = await mk("WEEK", weekAgo, { customer: otherCustomerId });

    const mine = (p: Page): string[] =>
      p.data.filter((r) => r.barcode?.includes(`-${ts}`)).map((r) => r.id);

    // ── §1 Gün sınırı FABRİKA gününe göre ───────────────────────────────────
    console.log("\n── §1 Fabrika günü sınırı ──");

    const today = mine(await list({ dayRange: 1, limit: 200 }));
    check(
      "⭐ gece vardiyası topu BUGÜN filtresinde görünüyor",
      today.includes(idNight),
      "UTC gün sınırı kullanılsaydı düne düşer ve kaybolurdu",
    );
    check("dünkü top BUGÜN filtresinde YOK", !today.includes(idYest));
    check("haftalık top BUGÜN filtresinde YOK", !today.includes(idWeek));

    const two = mine(await list({ dayRange: 2, limit: 200 }));
    check("son 2 gün: bugün + dün", two.includes(idNight) && two.includes(idYest));
    check("son 2 gün: hafta öncesi YOK", !two.includes(idWeek));

    const seven = mine(await list({ dayRange: 7, limit: 200 }));
    check("son 7 gün: üçü de var", seven.length === 3, `${seven.length} top`);

    // ── §2 dayRange serbest aralığı EZER ────────────────────────────────────
    console.log("\n── §2 Hızlı seçim serbest aralığı ezer ──");

    const clash = mine(
      await list({
        dayRange: 1,
        dateFrom: new Date(weekAgo.getTime() - 86_400_000),
        dateTo: new Date(weekAgo.getTime() + 3600_000),
        limit: 200,
      }),
    );
    check(
      "dayRange + çelişen aralıkta hızlı seçim KAZANIR (boş liste dönmez)",
      clash.includes(idNight) && !clash.includes(idWeek),
      "AND'lenseydi kesişim boş çıkar ve operatör 'bugün hiç top yok' sanırdı",
    );

    // ── §3 Serbest aralık + kalite + müşteri ────────────────────────────────
    console.log("\n── §3 Serbest aralık · kalite · müşteri ──");

    const range = mine(
      await list({
        dateFrom: new Date(weekAgo.getTime() - 3600_000),
        dateTo: new Date(weekAgo.getTime() + 3600_000),
        limit: 200,
      }),
    );
    check("serbest aralık yalnız o günü döndürür", range.length === 1 && range[0] === idWeek);

    const a1 = mine(await list({ dayRange: 7, qualityGrade: "A1", limit: 200 }));
    check("kalite filtresi çalışıyor", a1.length === 1 && a1[0] === idYest);

    const byCust = mine(await list({ dayRange: 7, customerId, limit: 200 }));
    check(
      "müşteri filtresi `labelCustomerId` üzerinden çalışıyor",
      byCust.length === 1 && byCust[0] === idNight,
      `${byCust.length} top`,
    );
    const byOther = mine(await list({ dayRange: 7, customerId: otherCustomerId, limit: 200 }));
    check("diğer müşteri kendi topunu görüyor", byOther.length === 1 && byOther[0] === idWeek);

    // ── §4 Cursor sözleşmesi bozulmadı ──────────────────────────────────────
    console.log("\n── §4 Filtre + sayfalama birlikte ──");

    const p1 = await list({ dayRange: 7, limit: 2 });
    check("filtreli ilk sayfa limit'e uyuyor", p1.data.length === 2, `${p1.data.length} satır`);
    check("hasMore doğru", p1.pagination?.hasMore === true);
    const p2 = await list({
      dayRange: 7,
      limit: 2,
      cursor: p1.pagination?.nextCursor ?? undefined,
    });
    const overlap = p1.data.filter((a) => p2.data.some((b) => b.id === a.id));
    check("sayfalar arasında MÜKERRER satır yok", overlap.length === 0, `${overlap.length} çakışma`);

    // ── §5 Filtresiz çağrı DEĞİŞMEDİ (geri uyum) ────────────────────────────
    console.log("\n── §5 Filtresiz çağrı bayt-bayt aynı davranır ──");
    const plain = mine(await list({ limit: 200 }));
    check(
      "hiç filtre verilmezse tüm test topları geliyor",
      plain.length === 3,
      `${plain.length} top — eski istemci davranışı korunur`,
    );
  } finally {
    if (rollIds.length) {
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: { in: [customerId, otherCustomerId] } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
  }
}

main().then(
  () => process.exit(fail > 0 ? 1 : 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
