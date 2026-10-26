// =============================================================================
// VARDİYA TAKVİMİ BEKÇİSİ — rapor vardiya boyutu ↔ takvim pencereleri boğaz-ikiz mi?
// =============================================================================
// Raporlar v2 R1-SEMCEK: "genel vardiya" boyutu `vardiya-takvimi.helper.ts`in SQL'inden gelir
// (`shiftOfSql` / `shiftDaySql`); dokuma takvim işi pencereleri `planShiftCalendar` ile üretir.
// İkisi aynı tanımdan AYNI cevabı vermezse rapor çubuğu ile vardiya karnesi ayrışır. Ölçülen:
// §1 plan penceresinin her iç anı (baş · +1 dk · orta · son dakika) = tanım kodu + pencerenin
// `factoryDayKey`i (gece yarısını aşan kuyruk ÖNCEKİ güne) · §2 haftagünü kısıtı (cumartesi
// 15:00 boş; cumartesi 03:00 cuma gecesinin kuyruğu; pazar 03:00 boş) · §3 boş haftagünü = her
// gün · §4 tanımsız kurulum NULL.
//
// NEGATİF SONDA (2026-10-24): kuyruk dalında `(${day} - 1)` → `${day}` → 2 ❌ (§1c kuyruk günü · §2b cuma kuyruğu);
// md5 ile birebir geri alındı.
//
// Koşum: npx tsx scripts/test_vardiya_takvimi.ts  (DB: yalnız SELECT, yazma YOK)
// =============================================================================
import prisma from "../src/lib/prisma";
import { planShiftCalendar, type PlanDefinition } from "../src/services/helpers/shift-calendar-plan.helper";
import { shiftDaySql, shiftOfSql, type ShiftRule } from "../src/services/helpers/vardiya-takvimi.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const RULES: ShiftRule[] = [
  { code: "SABAH", name: "Sabah", startMinute: 360, durationMinutes: 480, activeWeekdays: [] },
  { code: "AKSAM", name: "Akşam", startMinute: 840, durationMinutes: 480, activeWeekdays: [1, 2, 3, 4, 5] },
  { code: "GECE", name: "Gece", startMinute: 1320, durationMinutes: 480, activeWeekdays: [1, 2, 3, 4, 5] },
];

async function classify(ats: Date[], rules: readonly ShiftRule[]): Promise<Array<{ code: string | null; day: string | null }>> {
  const iso = ats.map((d) => d.toISOString());
  const rows = await prisma.$queryRaw<Array<{ i: bigint; code: string | null; day: string | null }>>`
    SELECT t.i, ${shiftOfSql("t.at", rules)} AS code, (${shiftDaySql("t.at", rules)})::text AS day
    FROM (SELECT u.s::timestamptz AS at, u.i FROM unnest(${iso}::text[]) WITH ORDINALITY u(s, i)) t
    ORDER BY t.i
  `;
  return rows.map((r) => ({ code: r.code, day: r.day }));
}

async function main(): Promise<void> {
  console.log("\n=== Vardiya takvimi (rapor boyutu ↔ plan penceresi) bekçisi ===\n");
  // 2026-10-19 Pzt 00:00 Europe/Istanbul; 30 günlük ufukta tüm pencereler "create" doğar.
  const now = new Date("2026-10-18T21:00:00.000Z");
  const defs: PlanDefinition[] = RULES.map((r) => ({
    id: r.code, startMinute: r.startMinute, durationMinutes: r.durationMinutes,
    activeWeekdays: [...r.activeWeekdays], isActive: true,
  }));
  const plan = planShiftCalendar(defs, [], now);
  const windows = plan.actions.flatMap((a) => (a.kind === "create" ? [a] : []));
  check("§0 plan pencere üretti (3 tanım × 30 gün, haftagünü süzgeçli)", windows.length > 60, String(windows.length));

  // ── §1 her pencerenin iç anları ─────────────────────────────────────────────
  const MIN = 60_000;
  const pts: Array<{ at: Date; code: string; day: string; tail: boolean }> = [];
  for (const w of windows) {
    const s = w.startsAt.getTime();
    const e = w.endsAt.getTime();
    const day = w.factoryDayKey.toISOString().slice(0, 10);
    for (const t of [s, s + MIN, Math.floor((s + e) / 2 / MIN) * MIN, e - MIN]) {
      const tail = w.shiftDefinitionId === "GECE" && t - s >= 2 * 3600_000; // yerel 00:00 sonrası
      pts.push({ at: new Date(t), code: w.shiftDefinitionId, day, tail });
    }
  }
  const got = await classify(pts.map((p) => p.at), RULES);
  const codeMiss = pts.filter((p, i) => got[i]?.code !== p.code);
  const dayMissHead = pts.filter((p, i) => !p.tail && got[i]?.day !== p.day);
  const dayMissTail = pts.filter((p, i) => p.tail && got[i]?.day !== p.day);
  check("§1a pencere iç anı = tanım kodu", codeMiss.length === 0, codeMiss.slice(0, 3).map((p) => `${p.at.toISOString()}≠${p.code}`).join(" · "));
  check("§1b pencere iç anı = pencerenin fabrika günü", dayMissHead.length === 0, dayMissHead.slice(0, 3).map((p) => p.at.toISOString()).join(" · "));
  check(
    "§1c ⭐ gece yarısını aşan kuyruk BAŞLADIĞI (önceki) fabrika gününe yazılır",
    pts.some((p) => p.tail) && dayMissTail.length === 0,
    dayMissTail.slice(0, 3).map((p) => `${p.at.toISOString()}≠${p.day}`).join(" · "),
  );
  const ends = await classify(windows.map((w) => w.endsAt), RULES);
  const endLeak = windows.filter((w, i) => ends[i]?.code === w.shiftDefinitionId && w.shiftDefinitionId !== "SABAH");
  check("§1d pencere sonu (yarı-açık) o vardiyaya yazılmaz", endLeak.length === 0, String(endLeak.length));

  // ── §2 haftagünü kısıtı ───────────────────────────────────────────────────
  const [satAfternoon, satNight, sunNight] = await classify([
    new Date("2026-10-24T12:00:00.000Z"), // Cmt 15:00 yerel — AKSAM hafta içi
    new Date("2026-10-24T00:00:00.000Z"), // Cmt 03:00 yerel — Cuma GECE kuyruğu
    new Date("2026-10-25T00:00:00.000Z"), // Paz 03:00 yerel — Cmt GECE yok
  ], RULES);
  check("§2a cumartesi 15:00 hiçbir vardiyaya düşmez", satAfternoon?.code === null, String(satAfternoon?.code));
  check("§2b cumartesi 03:00 = cuma gecesi kuyruğu (GECE, 2026-10-23)", satNight?.code === "GECE" && satNight?.day === "2026-10-23", JSON.stringify(satNight));
  check("§2c pazar 03:00 boş (cumartesi gece vardiyası yok)", sunNight?.code === null && sunNight?.day === null, JSON.stringify(sunNight));

  // ── §3 boş haftagünü = her gün ────────────────────────────────────────────
  const [sunMorning] = await classify([new Date("2026-10-25T07:00:00.000Z")], RULES); // Paz 10:00
  check("§3 boş haftagünü listesi her gün (pazar 10:00 SABAH)", sunMorning?.code === "SABAH" && sunMorning?.day === "2026-10-25", JSON.stringify(sunMorning));

  // ── §4 tanımsız kurulum ───────────────────────────────────────────────────
  const [none] = await classify([new Date("2026-10-20T07:00:00.000Z")], []);
  check("§4 tanım yoksa kod ve gün NULL", none?.code === null && none?.day === null, JSON.stringify(none));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
