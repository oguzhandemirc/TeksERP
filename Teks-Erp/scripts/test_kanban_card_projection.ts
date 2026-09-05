// =============================================================================
// Test: Kanban kart projeksiyonu + WO liste rollup'ı (perf turu, 2026-09-05)
// Çalıştır: npx tsx scripts/test_kanban_card_projection.ts
//
// NEDEN: Üretim Akışı (Kanban) kartı, LİSTE yüzeyinin include'unu ödünç alıyordu
// → tek istek 115 sorgu. Kart artık DAR bir ilişki kümesi (ROLL_CARD_INCLUDE)
// kullanıyor → 66 sorgu (ölçüldü, tekserp_demo). Bu bekçi iki şeyi birlikte tutar:
//   ① KAZANÇ: kartın DÜŞÜRDÜĞÜ ilişkiler bir daha sessizce geri gelmesin
//      (roll_operations / users / machines / warehouses / stations turları SIFIR).
//   ② DAVRANIŞ: kart ile liste aynı SKALER kümeyi döndürsün (ayrışan yüzey
//      sınıfı) ve kartın taşıması gereken ilişkiler (detay panelinin
//      `detail ?? roll` fallback'i onları çizer) eksilmesin.
// Ayrıca WO liste rollup'ının bellekten okunan geçişleri (orderedMeters,
// currentFasonStations, fasonFirms) SQL gerçeğiyle karşılaştırılır — o geçişler
// aynı satırları 2-3 kez okumaktan çıkarıldı (24 → 18 sorgu).
//
// NEGATİF SONDA (2026-09-05, üç kez kırıldı ve md5 ile geri yüklendi):
//   A) rollColumn include'u ROLL_LIST_INCLUDE'a geri alındı → 7 ❌
//   B) ROLL_CARD_INCLUDE'dan `properties` düşürüldü          → 4 ❌
//   C) WO rollup'ında adım→istasyon haritası bozuldu         → 2 ❌
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { WorkOrderService } from "../src/services/workorder.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

// --- Sorgu sayacı: pg client'ı sarmala (yalnız ölçüm penceresinde sayar) -----
const byTable = new Map<string, number>();
let total = 0;
let capture = false;
pool.on("connect", (client: unknown) => {
  const c = client as { query: (...a: unknown[]) => unknown };
  const orig = c.query.bind(c);
  c.query = (...args: unknown[]) => {
    if (capture) {
      const first = args[0] as string | { text?: string };
      const sql = typeof first === "string" ? first : (first?.text ?? "");
      if (/^\s*(SELECT|WITH)/i.test(sql)) {
        total++;
        const m = sql.match(/FROM\s+"public"\."([A-Za-z_0-9]+)"/i) ?? sql.match(/FROM\s+"([A-Za-z_0-9]+)"/i);
        const t = m ? m[1] : "?";
        byTable.set(t, (byTable.get(t) ?? 0) + 1);
      }
    }
    return orig(...args);
  };
});

// Kart yanıtındaki İLİŞKİ anahtarları (geri kalanı skalerdir).
const RELATION_KEYS = [
  "item", "color", "operations", "createdBy", "createdMachine", "entryStation",
  "warehouse", "properties", "shipment", "sack", "currentStep", "dispatchItems",
];
const scalarKeys = (o: object): string[] =>
  Object.keys(o).filter((k) => !RELATION_KEYS.includes(k)).sort();

const req = (q: Record<string, string>) => ({ query: q, params: {}, body: {} }) as never;

async function main(): Promise<void> {
  const inv = new InventoryService();

  // ── 1) Sorgu bütçesi + düşürülen ilişkilerin SIFIR turu ────────────────────
  await inv.getProductionFlow({ includeQueues: true, includeSevk: true }); // ısıtma
  byTable.clear(); total = 0;
  capture = true;
  const flow = await inv.getProductionFlow({ includeQueues: true, includeSevk: true });
  capture = false;

  // Kolonların hiçbiri bu tabloları ARTIK okumamalı: karttan düşürülen ilişkiler
  // (operations · createdBy · createdMachine · warehouse · entryStation) ve
  // currentStep'in station dalı. Kuyruk/sevk kolonları bu tablolara HİÇ bakmaz,
  // yani sayaç veriden bağımsız SIFIRDIR (kolonlar boş olsa da dolu olsa da).
  for (const t of ["roll_operations", "users", "machines", "warehouses", "stations"]) {
    check(`production-flow: '${t}' tablosuna sorgu ATILMIYOR`, (byTable.get(t) ?? 0) === 0, `sayı=${byTable.get(t) ?? 0}`);
  }
  // Bütçe: ölçülen 66 (kuyruk kolonları BOŞ). Kuyruklar dolduğunda kuyruk-içi
  // nested select'ler kolon başına ~5 tur ekler → 90 üst sınır hem bugünü hem
  // dolu kuyruğu kapsar, hem de liste include'una geri dönüşü (115+) YAKALAR.
  check("production-flow sorgu bütçesi ≤ 90", total <= 90, `ölçülen=${total}`);

  // ── 2) Kart ile liste AYNI skaler kümeyi döndürüyor ────────────────────────
  const list = await inv.findAllRolls(req({ pageSize: "5" }));
  const listRoll = (list.data as object[])[0];
  const cardRoll = flow.data?.hamStok.rolls[0] ?? flow.data?.depo.rolls[0] ?? flow.data?.fason.rolls[0];
  if (!listRoll || !cardRoll) {
    check("kart/liste karşılaştırması için veri var", false, "liste ya da kolon boş");
  } else {
    const a = scalarKeys(listRoll), b = scalarKeys(cardRoll);
    check(
      "kart ile liste AYNI skaler kümeyi döndürüyor (ayrışan yüzey seddi)",
      a.join(",") === b.join(","),
      `yalnız listede: [${a.filter((k) => !b.includes(k))}] · yalnız kartta: [${b.filter((k) => !a.includes(k))}]`,
    );
  }

  // ── 3) Kartın TAŞIMASI GEREKEN ilişkileri ─────────────────────────────────
  // Detay paneli (RollDetailSheet) kart tıklanınca `detail ?? roll` ile çizilir;
  // bu ilişkiler liste satırından okunur → eksilirse panelde boş hücre çıkar.
  const REQUIRED = ["item", "color", "properties", "shipment", "sack", "currentStep"];
  for (const col of ["hamStok", "yariMamul", "depo", "fason"] as const) {
    const r = flow.data?.[col].rolls[0];
    if (!r) { console.log(`ℹ️  ${col} kolonu boş — ilişki kontrolü atlandı`); continue; }
    const keys = Object.keys(r);
    check(`${col}: kart ilişkileri tam (${REQUIRED.join("/")})`, REQUIRED.every((k) => keys.includes(k)),
      `eksik=[${REQUIRED.filter((k) => !keys.includes(k))}]`);
  }
  // Fason kolonu TEK farkı taşır: panelin "Fason bilgisi" kartı `roll.dispatchItems`
  // fallback'ini AT_SUBCONTRACTOR topta çizer. Diğer kolonlar bu zinciri (7 sorgu)
  // taşımaz — o statüye asla giremezler.
  const fasonRoll = flow.data?.fason.rolls[0] as Record<string, unknown> | undefined;
  if (fasonRoll) check("fason kolonu dispatchItems TAŞIYOR", "dispatchItems" in fasonRoll);
  const stockRoll = flow.data?.hamStok.rolls[0] as Record<string, unknown> | undefined;
  if (stockRoll) check("ham stok kolonu dispatchItems TAŞIMIYOR (7 sorgu)", !("dispatchItems" in stockRoll));

  // ── 4) WO liste rollup'ı: bellekten okunan geçişler SQL gerçeğiyle aynı ────
  const svc = new WorkOrderService();
  const rows: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (;;) {
    const r = (await svc.findAll(req({ mode: "cursor", limit: "200", withArchived: "true", ...(cursor ? { cursor } : {}) }))) as {
      data: Record<string, unknown>[]; pagination: { hasMore: boolean; nextCursor: string | null };
    };
    rows.push(...r.data);
    if (!r.pagination.hasMore || !r.pagination.nextCursor) break;
    cursor = r.pagination.nextCursor;
  }

  const curTruth = await prisma.$queryRaw<{ workOrderId: string; name: string }[]>`
    SELECT DISTINCT s."workOrderId", st."name"
    FROM rolls r JOIN work_order_steps s ON s.id = r."currentStepId"
    JOIN stations st ON st.id = s."stationId"
    WHERE r.status = 'AT_SUBCONTRACTOR'`;
  const curMap = new Map<string, Set<string>>();
  for (const c of curTruth) {
    if (!curMap.has(c.workOrderId)) curMap.set(c.workOrderId, new Set());
    curMap.get(c.workOrderId)!.add(c.name);
  }
  let badCur = 0, dolu = 0;
  for (const w of rows) {
    const exp = [...(curMap.get(w.id as string) ?? [])].sort().join("|");
    const got = [...(w.currentFasonStations as string[])].sort().join("|");
    if (exp) dolu++;
    if (exp !== got) badCur++;
  }
  check("currentFasonStations = SQL gerçeği (adım→istasyon bellekten)", badCur === 0, `WO=${rows.length} dolu=${dolu} sapma=${badCur}`);

  const firmTruth = await prisma.$queryRaw<{ workOrderId: string; name: string; station: string }[]>`
    SELECT d."workOrderId", sub."name", st."name" AS station
    FROM subcontractor_dispatches d
    JOIN subcontractors sub ON sub.id = d."subcontractorId"
    JOIN work_order_steps s ON s.id = d."stepId"
    JOIN stations st ON st.id = s."stationId"
    WHERE d."cancelledAt" IS NULL
    ORDER BY d."createdAt" ASC`;
  const firmMap = new Map<string, Map<string, boolean>>();
  for (const f of firmTruth) {
    if (!firmMap.has(f.workOrderId)) firmMap.set(f.workOrderId, new Map());
    const m = firmMap.get(f.workOrderId)!;
    const isCur = curMap.get(f.workOrderId)?.has(f.station) ?? false;
    m.set(f.name, (m.get(f.name) ?? false) || isCur);
  }
  let badFirm = 0, doluFirm = 0;
  for (const w of rows) {
    const exp = [...(firmMap.get(w.id as string) ?? new Map<string, boolean>())].map(([n, c]) => `${n}:${c}`).join("|");
    const got = (w.fasonFirms as { name: string; current: boolean }[]).map((f) => `${f.name}:${f.current}`).join("|");
    if (exp) doluFirm++;
    if (exp !== got) badFirm++;
  }
  check("fasonFirms = SQL gerçeği (sevk adımı bellekten)", badFirm === 0, `dolu=${doluFirm} sapma=${badFirm}`);

  // orderedMeters: bu DB'de work_order_to_order_lines BOŞ (0 satır) → gerçek
  // veriyle ölçülemez. Bellek yolunu SENTETİK girdiyle sondala: gerçek sipariş
  // satırı id'leri ver, toplam quantity ile karşılaştır. (Yazma YOK.)
  const lines = await prisma.orderLine.findMany({ select: { id: true, quantity: true }, take: 2, orderBy: { id: "asc" } });
  const anyWo = await prisma.workOrder.findFirst({ select: { id: true } });
  if (lines.length === 2 && anyWo) {
    const meters = svc as unknown as {
      withProductionMeters: (w: unknown[]) => Promise<{ orderedMeters: number }[]>;
    };
    const beklenen = Number(lines[0].quantity) + Number(lines[1].quantity);
    const out = await meters.withProductionMeters([
      { id: anyWo.id, steps: [], orderLinks: lines.map((l) => ({ orderLineId: l.id })) },
    ]);
    check("orderedMeters bellek yolu = bağlı sipariş satırlarının quantity toplamı",
      Math.abs(out[0].orderedMeters - beklenen) < 1e-9, `bekl=${beklenen} gelen=${out[0].orderedMeters}`);
    // orderLinks GELMEZSE eski DB yolu koşar (davranış aynı, sorgu bir fazla).
    const fallback = await meters.withProductionMeters([{ id: anyWo.id, steps: [] }]);
    check("orderLinks yokken DB yoluna düşüyor (çökme yok)", typeof fallback[0].orderedMeters === "number");
  } else {
    console.log("ℹ️  sipariş satırı < 2 — orderedMeters sondası atlandı");
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
