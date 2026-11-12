// =============================================================================
// TEZGÂH PLAN ALANLARI BEKÇİSİ — `Machine.planRpm` · `planEfficiencyPct` · `maxWorkingWidthCm`
// =============================================================================
// Sözleşme (panel bağlayıcı): makine POST/PATCH gövdesinde bu üç ad; null serbest; GET aynı
// adlarla sayı döner. Doğrulama `machine-plan-fields.middleware` (Türkçe), son hat DB CHECK.
//
// NEGATİF SONDA — 2026-11-11 koşuldu (cp + geri alma):
//   middleware'de `n <= 0` dalı sökülünce → §1c ❌ · migration CHECK'i (planRpm > 0) düşürülünce → §3a ❌
//   PATCH zincirinden `validateMachinePlanFields` sökülünce → §1m ❌
// Koşum: npx tsx scripts/test_tezgah_plan_alanlari.ts
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { machinePlanFields } from "../src/middlewares/machine-plan-fields.middleware";
import { machineService } from "../src/routes/station.routes";
import { installDecimalNumberSerializer } from "../src/utils/json-replacer";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const ek = `${Date.now().toString(36)}`;
const ids: { station?: string; machine?: string } = {};

function parseErr(body: unknown): string | null {
  const r = machinePlanFields.safeParse(body);
  return r.success ? null : r.error.issues.map((i) => i.message).join(" | ");
}

async function main(): Promise<void> {
  console.log("\n=== Tezgâh plan alanları ===\n");
  installDecimalNumberSerializer();

  // §1 Doğrulama (gövde katmanı)
  const ok = machinePlanFields.parse({ name: "x", planRpm: 600, planEfficiencyPct: "85,5", maxWorkingWidthCm: 340 });
  check("§1a Geçerli gövde: devir tam sayı, ondalıklar METİN (float yazılmaz), diğer alan geçer", ok.planRpm === 600 && ok.planEfficiencyPct === "85.50" && ok.maxWorkingWidthCm === "340.00" && ok.name === "x", JSON.stringify(ok));
  const nulls = machinePlanFields.parse({ planRpm: null, planEfficiencyPct: "", maxWorkingWidthCm: null });
  check("§1b null ve boş metin → null (temizler)", nulls.planRpm === null && nulls.planEfficiencyPct === null && nulls.maxWorkingWidthCm === null);
  check("§1c Devir 0 → Türkçe 400 mesajı", (parseErr({ planRpm: 0 }) ?? "").includes("sıfırdan büyük"));
  check("§1d Devir ondalık → reddedilir", (parseErr({ planRpm: 600.5 }) ?? "").includes("tam sayı"));
  check("§1e Randıman > 100 → reddedilir", (parseErr({ planEfficiencyPct: 100.01 }) ?? "").includes("%100"));
  check("§1f Randıman 100 kabul (sınır dahil)", parseErr({ planEfficiencyPct: 100 }) === null);
  check("§1g En 0 → reddedilir", (parseErr({ maxWorkingWidthCm: 0 }) ?? "").includes("sıfırdan büyük"));
  check("§1h Üç ondalık → reddedilir", (parseErr({ maxWorkingWidthCm: "12.345" }) ?? "").includes("2 ondalık"));
  check("§1i Sayı olmayan metin → reddedilir", (parseErr({ planRpm: "abc" }) ?? "").includes("sayı olmalı"));
  check("§1j Alan yoksa dokunulmaz (optional)", !("planRpm" in machinePlanFields.parse({ name: "y" })));
  // Panel gövde biçimi (koordinatör 2026-11-11): SAYI gelir, silinince null, hiç doldurulmamışsa anahtar yok
  const panel = machinePlanFields.parse({ planRpm: 600, planEfficiencyPct: 85.5, maxWorkingWidthCm: 340 });
  check("§1k Panel biçimi: sayı gövde kabul (600 · 85.5 · 340)", panel.planRpm === 600 && panel.planEfficiencyPct === "85.50" && panel.maxWorkingWidthCm === "340.00", JSON.stringify(panel));
  const partial = machinePlanFields.parse({ name: "z", planRpm: null });
  check("§1l Panel biçimi: silinen alan null, gelmeyen anahtar gövdeye EKLENMEZ", partial.planRpm === null && !("planEfficiencyPct" in partial) && !("maxWorkingWidthCm" in partial), JSON.stringify(partial));

  const routes = readFileSync(join(__dirname, "..", "src", "routes", "station.routes.ts"), "utf8");
  check("§1m makine POST + PATCH zinciri `validateMachinePlanFields` taşır (controller'dan önce)", (routes.match(/machineRouter\.(post|patch)\([^\n]*validateMachinePlanFields[^\n]*machineController\.(create|update)\)/g) ?? []).length === 2);

  // §2 BaseController yazma/okuma yolu (servis; gövde önce middleware'den geçer)
  const station = await prisma.station.create({
    data: { name: `TEST-TPA-IST-${ek}`, code: `TEST-TPA-S-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "PROCESS_QC", isActive: true },
  });
  ids.station = station.id;
  const created = await machineService.create(machinePlanFields.parse({ stationId: station.id, name: `TEST-TPA-MAK-${ek}`, planRpm: 650, planEfficiencyPct: 82.5, maxWorkingWidthCm: "280" }));
  const m = JSON.parse(JSON.stringify(created.data)) as Record<string, unknown>;
  ids.machine = m.id as string;
  check("§2a POST: üç alan yazıldı ve SAYI olarak döndü", m.planRpm === 650 && m.planEfficiencyPct === 82.5 && m.maxWorkingWidthCm === 280, JSON.stringify({ r: m.planRpm, e: m.planEfficiencyPct, w: m.maxWorkingWidthCm }));
  const got = JSON.parse(JSON.stringify((await machineService.findById(ids.machine)).data)) as Record<string, unknown>;
  check("§2b GET: aynı adlarla okunur", got.planRpm === 650 && got.planEfficiencyPct === 82.5 && got.maxWorkingWidthCm === 280);
  await machineService.update(ids.machine, machinePlanFields.parse({ planEfficiencyPct: null }));
  const after = await prisma.machine.findUnique({ where: { id: ids.machine }, select: { planRpm: true, planEfficiencyPct: true, maxWorkingWidthCm: true } });
  check("§2c PATCH null yalnız o alanı temizler, diğerleri kalır", after?.planEfficiencyPct === null && after?.planRpm === 650 && after?.maxWorkingWidthCm?.toString() === "280");

  // §3 DB CHECK — son hat (middleware atlanırsa)
  const reject = async (data: Record<string, unknown>): Promise<boolean> => {
    try {
      await prisma.machine.update({ where: { id: ids.machine! }, data });
      return false;
    } catch {
      return true;
    }
  };
  check("§3a CHECK machines_plan_rpm_pos: planRpm = 0 reddedilir", await reject({ planRpm: 0 }));
  check("§3b CHECK machines_plan_efficiency_range: 100.5 reddedilir", await reject({ planEfficiencyPct: "100.5" }));
  check("§3c CHECK machines_plan_efficiency_range: 0 reddedilir", await reject({ planEfficiencyPct: "0" }));
  check("§3d CHECK machines_max_working_width_pos: -1 reddedilir", await reject({ maxWorkingWidthCm: "-1" }));
  check("§3e NULL serbest (CHECK NULL'ı reddetmez)", !(await reject({ planRpm: null, maxWorkingWidthCm: null })));
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ Beklenmeyen hata:", e);
  })
  .finally(async () => {
    if (ids.machine) await prisma.machine.deleteMany({ where: { id: ids.machine } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
