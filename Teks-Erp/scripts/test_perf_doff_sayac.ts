// =============================================================================
// BEKÇİ — Doff kodu sayaç satırından, tx'ten ÖNCE (Perf-4 B-03)
// Çalıştır: npx tsx scripts/test_perf_doff_sayac.ts
// =============================================================================
// Eski yol: 8029 (gün ön eki, tek anahtar) altında günün bütün kodları taranıyor,
// kilit commit'e kadar sürüyordu → 50 tablet aynı anda doff: p95 484 ms (tek başına
// 12 ms). Yeni yol: `number_series_counters` satırı tek UPDATE ile ilerler, ifade
// biter bitmez commit olur; boşluk serbest, tekillik `doff_events_code_key`te.
//
//   §1 ⭐ doff'un eski 8029 kapsamı elle tutulurken kayıt BLOKLANMAZ (kilit bekleme yok)
//   §2 ⭐ 50 paralel kayıt → 50 başarılı, 50 tekil kod
//   §3 ⭐ sayaç satırı yokken DOĞUŞ: mevcut kodların max'ından (0007 varken 0008, 0009)
//   §4 ⭐ eşzamanlı doğuş: 20 paralel rezervasyon → tek satır, 20 tekil, BİTİŞİK (6..25)
//   §5 ⭐ rezervasyon tx'e bağlı değil: tx geri dönse de sayaç ilerlemiş kalır (boşluk serbest)
//   §6 ⭐ sayaç ayarı (adım 10) değişince yeni kapsam satırı, hizalı (0011, 0021)
//   §7 panel önizlemesi = üretecin sıradakisi (sayaç satırından)
//
// Negatif sondalar (2026-10-13, cp + geri; her biri kırmızı verdi):
//   · `openDoffFresh` eski yola (tx + 8029 + tx içi rezervasyon) döndürülünce: §1 kırmızı (bloklandı).
//   · tohum yarışının kaybedeni yeniden UPDATE etmeden tohumu dönünce: §4 kırmızı (mükerrer).
//   · `counterScopeKey`ten adım düşürülünce: §6 kırmızı (eski satır adım 10'la ilerledi, hizasız).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; uzak tarihli kapsamlar kullanır, temizler.
// =============================================================================
import { MachineDataSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { openDoff } from "../src/services/machine-doff.service";
import { reserveDoffCode } from "../src/services/helpers/machine-doff-open.helper";
import { lockCodeScopeTx } from "../src/services/helpers/code-unique.helper";
import { previewNextNumber } from "../src/services/helpers/series-panel.helper";
import { refreshNumberSeriesCache, resolveSeriesFormat, seriesPrefix } from "../src/services/number-series.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const seq = (c: string): number => Number(c.slice(-4));
// Uzak gelecek: gerçek günün sayaç satırına ve kodlarına dokunmaz.
const D1 = new Date(Date.UTC(2097, 4, 17, 9));
const D2 = new Date(Date.UTC(2097, 4, 18, 9));

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(1); }
  console.log("\n=== Doff kodu: sayaç satırı, tx'ten önce (B-03) ===\n");
  await refreshNumberSeriesCache();
  const ek = Date.now().toString(36).toUpperCase();
  const station = await prisma.station.create({ data: { name: `TEST-DS-${ek}`, code: `TEST-DS-${ek}`.slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true } });
  const machines = await Promise.all(Array.from({ length: 50 }, (_, i) =>
    prisma.machine.create({ data: { stationId: station.id, name: `TEST-DS-${ek}-${i}`, code: `TDS${ek}${i}`.slice(0, 32), isActive: true }, select: { id: true } })));
  const fmt0 = resolveSeriesFormat("doffEvent");
  const p1 = seriesPrefix(fmt0, D1);
  const p2 = seriesPrefix(fmt0, D2);
  const seriesRow = await prisma.numberSeries.findUnique({ where: { key: "doffEvent" }, select: { step: true } });
  const taban = { productionLineNo: 1, pieceCount: 1, counterSource: MachineDataSource.OPERATOR };

  try {
    // ── §1 eski 8029 kapsamı tutulurken kayıt bloklanmaz ──────────────────
    let birak!: () => void;
    const kapi = new Promise<void>((r) => { birak = r; });
    const kilit = prisma.$transaction(async (tx) => {
      await lockCodeScopeTx(tx, "doffEvent", seriesPrefix(fmt0, new Date()));
      await kapi;
    }, { timeout: 15_000 });
    kilit.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 150));
    let bitti = false;
    const kayit = openDoff({ ...taban, machineId: machines[0]!.id }).then((r) => { bitti = true; return r; });
    kayit.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 400));
    check("§1 ⭐ 8029 doff kapsamı tutulurken kayıt BLOKLANMADI (400 ms içinde döndü)", bitti, `bitti=${bitti}`);
    birak();
    await kilit;
    await kayit;

    // ── §2 50 paralel ─────────────────────────────────────────────────────
    const sonuc = await Promise.allSettled(machines.map((m) => openDoff({ ...taban, machineId: m.id })));
    const kodlar = sonuc.flatMap((r) => (r.status === "fulfilled" ? [r.value.data!.code] : []));
    const hatalar = sonuc.flatMap((r) => (r.status === "rejected" ? [String((r.reason as Error)?.message).slice(0, 60)] : []));
    check("§2 ⭐ 50 paralel kayıt: 50 başarılı, 50 tekil kod", kodlar.length === 50 && new Set(kodlar).size === 50,
      `başarılı=${kodlar.length} tekil=${new Set(kodlar).size} hata=${hatalar.join(",")}`);

    // ── §3 doğuş: mevcut max'tan ──────────────────────────────────────────
    for (const n of [3, 7]) {
      await prisma.doffEvent.create({ data: { machineId: machines[0]!.id, productionLineNo: 1, doffedAt: D1, pieceCount: 1, counterSource: MachineDataSource.OPERATOR, code: `${p1}${String(n).padStart(fmt0.digits, "0")}` } });
    }
    const satirOnce = await prisma.numberSeriesCounter.count({ where: { seriesKey: "doffEvent", scopeKey: { startsWith: `${p1}|` } } });
    const r1 = await reserveDoffCode(D1);
    const r2 = await reserveDoffCode(D1);
    check("§3 ⭐ sayaç satırı yokken doğuş mevcut max'tan: 0007 varken 0008, 0009", satirOnce === 0 && seq(r1) === 8 && seq(r2) === 9, `satır önce=${satirOnce} · ${r1}, ${r2}`);

    // ── §4 eşzamanlı doğuş ────────────────────────────────────────────────
    await prisma.doffEvent.create({ data: { machineId: machines[0]!.id, productionLineNo: 1, doffedAt: D2, pieceCount: 1, counterSource: MachineDataSource.OPERATOR, code: `${p2}${String(5).padStart(fmt0.digits, "0")}` } });
    const es = (await Promise.all(Array.from({ length: 20 }, () => reserveDoffCode(D2)))).map(seq).sort((a, b) => a - b);
    const satir = await prisma.numberSeriesCounter.findMany({ where: { seriesKey: "doffEvent", scopeKey: { startsWith: `${p2}|` } }, select: { n: true } });
    const bitisik = es.every((v, i) => v === 6 + i);
    check("§4 ⭐ 20 paralel doğuş: tek satır, 20 tekil, bitişik 6..25", satir.length === 1 && new Set(es).size === 20 && bitisik && satir[0]!.n === 25,
      `satır=${satir.length} n=${satir[0]?.n} · ${es.join(",")}`);

    // ── §5 tx geri dönse de rezervasyon kalır ─────────────────────────────
    let icerde = "";
    await prisma.$transaction(async () => { icerde = await reserveDoffCode(D1); throw new Error("GERI_AL"); }).catch(() => undefined);
    const sonra = await reserveDoffCode(D1);
    check("§5 ⭐ tx geri döndü, rezervasyon geri alınmadı: sıradaki bir sonraki (boşluk serbest)", seq(icerde) === 10 && seq(sonra) === 11, `${icerde} → ${sonra}`);

    // ── §6 sayaç ayarı değişince yeni kapsam ──────────────────────────────
    await prisma.numberSeries.update({ where: { key: "doffEvent" }, data: { step: 10 } });
    await refreshNumberSeriesCache();
    const a10 = await reserveDoffCode(D1);
    const b10 = await reserveDoffCode(D1);
    check("§6 ⭐ adım 10: yeni kapsam satırı mevcut koddan (0007) hizalı tohumlanır → 0011, 0021", seq(a10) === 11 && seq(b10) === 21, `${a10}, ${b10}`);
    await prisma.numberSeries.update({ where: { key: "doffEvent" }, data: { step: seriesRow?.step ?? null } });
    await refreshNumberSeriesCache();

    // ── §7 önizleme = üreteç ──────────────────────────────────────────────
    const ekran = await previewNextNumber("doffEvent");
    const uretec = await reserveDoffCode(new Date());
    check("§7 panel önizlemesi = üretecin sıradakisi (sayaç satırından)", ekran === uretec, `ekran ${ekran} · üreteç ${uretec}`);
  } finally {
    await prisma.numberSeries.update({ where: { key: "doffEvent" }, data: { step: seriesRow?.step ?? null } }).catch(() => undefined);
    await refreshNumberSeriesCache().catch(() => undefined);
    const ids = machines.map((m) => m.id);
    const doffIds = (await prisma.doffEvent.findMany({ where: { machineId: { in: ids } }, select: { id: true } })).map((d) => d.id);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: doffIds } } });
    await prisma.doffEvent.deleteMany({ where: { machineId: { in: ids } } });
    await prisma.numberSeriesCounter.deleteMany({ where: { seriesKey: "doffEvent", OR: [{ scopeKey: { startsWith: `${p1}|` } }, { scopeKey: { startsWith: `${p2}|` } }] } });
    await prisma.machine.deleteMany({ where: { id: { in: ids } } });
    await prisma.station.deleteMany({ where: { id: station.id } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("❌ bekçi çöktü:", e);
  await prisma.$disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
