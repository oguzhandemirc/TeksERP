// =============================================================================
// Test: İSTASYON YETENEĞİ KATEGORİDEN AYRILDI (2026-08-10)
// Çalıştır: npx tsx scripts/test_station_capability_flags.ts
// =============================================================================
// Korunan invariant ÇİFT YÖNLÜ:
//   (a) BUGÜNKÜ DAVRANIŞ BİREBİR KORUNUR — Tambur/Kurşun gibi kategorisiz iç
//       istasyonlara hâlâ renk ATANAMAZ. (Eski kural `hasDefaultCategory &&
//       canApplyColor` bileşiğiydi; tek bayrağa geçerken iç istasyonlara
//       `true` yazılsaydı bu kapı sessizce açılırdı — 2026-08-06 uyarısı.)
//   (b) YENİ KAPI AÇILIR — "renk uygular" işaretli bir İÇ istasyon rota
//       adımında renk taşıyabilir ve hedef renkli iş emri AÇILIR. Eskiden
//       "rotada hiç fason kategorisi tanımlı değil" ile 400 alıyordu.
//
// Doğrulananlar:
//   1. Göç doğru: EXTERNAL bayrakları kategoriden, iç istasyonlar renk=false
//   2. deriveCapabilityFlags istasyonun KENDİ alanlarını okur
//   3. stepCanApplyColor/Property yüklemi: istasyon VEYA kategori
//   4. Rota adımı: kategorisiz + renk=false istasyona renk ATANAMAZ (bugünkü red)
//   5. Rota adımı: renk=true iç istasyona renk ATANABİLİR (yeni kapı)
//   6. WO guard: tümü-iç rotada hedef renk ARTIK KABUL (eski: 400)
//   7. WO guard: renk verebilen adım YOKSA hâlâ 400 (guard körelmedi)
//   8. Fason kabul KATEGORİDEN okumaya devam eder (planlama ≠ çalışma zamanı)
// =============================================================================
import prisma from "../src/lib/prisma";
import { deriveCapabilityFlags } from "../src/services/station-capability.service";
import {
  stepCanApplyColor,
  stepCanApplyProperty,
} from "../src/services/helpers/step-capability.helper";
import { RouteService, ROUTE_SERVICE_CONFIG } from "../src/services/route.service";
import { StationService } from "../src/services/station.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}

const routeSvc = new RouteService(ROUTE_SERVICE_CONFIG);
// Panelin kullandığı gerçek config (station.routes.ts ile aynı) — tohumlama
// davranışı ancak SERVİS üzerinden ölçülebilir; ham prisma.create onu atlar.
const stationSvc = new StationService({
  modelName: "station",
  tableName: "STATION",
  searchFields: ["code", "name"],
  uniqueField: "code",
  duplicateNameField: "name",
  entityLabel: "istasyon",
  autoCode: { prefix: "IST" },
});

async function main() {
  const ts = Date.now();
  const cleanupRouteIds: string[] = [];
  const cleanupStationIds: string[] = [];
  const cleanupColorIds: string[] = [];

  // ── Fixture: iki iç istasyon (biri renk verir, biri vermez) + bir renk ─────
  const stPlain = await prisma.station.create({
    data: {
      code: `TEST-SCF-PLAIN-${ts}`,
      name: "TEST İç İstasyon (renksiz)",
      type: "INTERNAL",
      kind: "OTHER",
      // appliesColor kolon varsayılanı = false (bugünkü davranışın karşılığı)
    },
    select: { id: true, appliesColor: true, appliesProperty: true },
  });
  cleanupStationIds.push(stPlain.id);

  const stDye = await prisma.station.create({
    data: {
      code: `TEST-SCF-DYE-${ts}`,
      name: "TEST İç Boyahane",
      type: "INTERNAL",
      kind: "OTHER",
      appliesColor: true,
    },
    select: { id: true, appliesColor: true, appliesProperty: true },
  });
  cleanupStationIds.push(stDye.id);

  const color = await prisma.color.create({
    data: { code: `TEST-SCF-C-${ts}`, name: `TEST Renk ${ts}` },
    select: { id: true },
  });
  cleanupColorIds.push(color.id);

  try {
    // ── 1) Göç doğru mu (canlı satırlar) ────────────────────────────────────
    const real = await prisma.station.findMany({
      where: { code: { in: ["TAMBUR_1", "KURSUN_KK2", "BOYA_FASON", "ZIMPARA_FASON"] } },
      select: {
        code: true,
        appliesColor: true,
        appliesProperty: true,
        defaultCategory: { select: { appliesColor: true, appliesProperty: true } },
      },
    });
    const byCode = Object.fromEntries(real.map((s) => [s.code, s]));
    if (byCode.TAMBUR_1) {
      check("göç: TAMBUR_1 renk=false (bugünkü red korunur)", byCode.TAMBUR_1.appliesColor === false);
    }
    if (byCode.KURSUN_KK2) {
      check("göç: KURSUN_KK2 renk=false, özellik=true",
        byCode.KURSUN_KK2.appliesColor === false && byCode.KURSUN_KK2.appliesProperty === true);
    }
    for (const s of real.filter((r) => r.defaultCategory)) {
      check(`göç: ${s.code} bayrakları KATEGORİDEN kopyalandı`,
        s.appliesColor === s.defaultCategory!.appliesColor &&
          s.appliesProperty === s.defaultCategory!.appliesProperty,
        `st=${s.appliesColor}/${s.appliesProperty} cat=${s.defaultCategory!.appliesColor}/${s.defaultCategory!.appliesProperty}`);
    }

    // ── 2) deriveCapabilityFlags istasyonun KENDİ alanlarını okur ───────────
    const f1 = deriveCapabilityFlags({ kind: "OTHER", ...stPlain, defaultCategory: null });
    check("kategorisiz + renk=false → canApplyColor false", f1.canApplyColor === false);
    check("kategorisiz + özellik=true → canApplyProperty true", f1.canApplyProperty === true);
    const f2 = deriveCapabilityFlags({ kind: "OTHER", ...stDye, defaultCategory: null });
    check("kategorisiz + renk=true → canApplyColor TRUE (yeni kapı)", f2.canApplyColor === true);

    // ── 3) Ortak yüklem ─────────────────────────────────────────────────────
    check("yüklem: istasyon verir → true", stepCanApplyColor(stDye, null));
    check("yüklem: istasyon vermez, kategori verir → true",
      stepCanApplyColor(stPlain, { appliesColor: true }));
    check("yüklem: ikisi de vermez → false", !stepCanApplyColor(stPlain, { appliesColor: false }));
    check("yüklem (özellik): simetrik", stepCanApplyProperty(stPlain, null) === true);

    // ── 4/5) Rota adımı hedefi ──────────────────────────────────────────────
    const mkRoute = async (name: string, stationId: string) =>
      (await routeSvc.create(
        {
          name,
          steps: [{ stationId, sequence: 1, plannedColorId: color.id }],
        },
        undefined,
      )).data as { id: string };

    await expectErr(
      "rota: renk vermeyen iç istasyona renk ATANAMAZ (bugünkü red korunur)",
      "renk uygulamıyor",
      () => mkRoute(`TEST SCF Red ${ts}`, stPlain.id),
    );

    // ⚠️ try ile sarılı: yüklem körleştirilirse (sonda) bu çağrı FIRLATIR ve
    // sarmazsak test çöker — hangi kontrolün düştüğü görünmez.
    let okRouteId: string | null = null;
    let openGateErr = "";
    try {
      const okRoute = await mkRoute(`TEST SCF Kabul ${ts}`, stDye.id);
      okRouteId = okRoute.id;
      cleanupRouteIds.push(okRoute.id);
    } catch (e) {
      openGateErr = e instanceof Error ? e.message : String(e);
    }
    const savedStep = okRouteId
      ? await prisma.routeStep.findFirst({
          where: { routeId: okRouteId },
          select: { plannedColorId: true },
        })
      : null;
    check("rota: renk veren İÇ istasyona renk ATANABİLİR (yeni kapı)",
      savedStep?.plannedColorId === color.id,
      openGateErr || String(savedStep?.plannedColorId));

    // ── 6/7) WO guard'ı — assertRouteCoversTargets üzerinden dolaylı ────────
    // Guard `workorder.service` içinde private; davranışı yüklem üzerinden
    // ölçüyoruz (aynı fonksiyonu çağırıyor). Tümü-iç rota + renk veren adım:
    const allInternalCanColor = [stDye, stPlain].some((s) => stepCanApplyColor(s, null));
    check("WO guard: tümü-iç rotada renk veren adım BULUNUR (eski hâlde 400'dü)",
      allInternalCanColor === true);
    const noneCanColor = [stPlain].some((s) => stepCanApplyColor(s, null));
    check("WO guard: renk veren adım yoksa hâlâ reddeder (körelmedi)",
      noneCanColor === false);

    // ── 7b) KATEGORİ SEÇİLİNCE BAYRAK TOHUMLANIR (StationService) ───────────
    // Türetmeyi kaldırırken kaybolacak ergonomi: "Boyahane" kategorisini seçen
    // admin ayrıca "renk uygular" kutusunu işaretlemek zorunda kalırdı ve
    // unutulduğunda yeni fason istasyonu SESSİZCE yeteneksiz doğardı.
    // ⚠️ Tohum, KİLİT DEĞİL: açıkça gönderilen bayrak kazanır.
    const boyaCat = await prisma.subcontractorCategory.findUnique({
      where: { code: "BOYA" },
      select: { id: true, appliesColor: true },
    });
    if (boyaCat) {
      const seeded = (await stationSvc.create({
        name: `TEST SCF Tohum ${ts}`,
        type: "EXTERNAL",
        kind: "OTHER",
        defaultCategoryId: boyaCat.id,
      })) as { data?: { id: string; appliesColor: boolean } };
      if (seeded.data) cleanupStationIds.push(seeded.data.id);
      check("kategori seçilince renk bayrağı KATEGORİDEN tohumlandı",
        seeded.data?.appliesColor === boyaCat.appliesColor,
        `st=${seeded.data?.appliesColor} cat=${boyaCat.appliesColor}`);

      const explicit = (await stationSvc.create({
        name: `TEST SCF Ezme ${ts}`,
        type: "EXTERNAL",
        kind: "OTHER",
        defaultCategoryId: boyaCat.id,
        appliesColor: false,
      })) as { data?: { id: string; appliesColor: boolean } };
      if (explicit.data) cleanupStationIds.push(explicit.data.id);
      check("açıkça gönderilen bayrak tohumu EZER (tohum kilit değil)",
        explicit.data?.appliesColor === false, String(explicit.data?.appliesColor));
    }

    // ── 8) Fason kabul KATEGORİDEN okur (planlama ≠ çalışma zamanı) ─────────
    // Kaynak taraması: istasyon bayrağı fason kabul yoluna SIZMAMALI.
    const fs = await import("node:fs/promises");
    const sub = await fs.readFile("src/services/subcontractor.service.ts", "utf8");
    const receiptBlock = sub.slice(sub.indexOf("const appliesColor ="), sub.indexOf("const appliesColor =") + 200);
    check("fason kabul `requiredCategory.appliesColor` okur (istasyon bayrağı DEĞİL)",
      receiptBlock.includes("step.requiredCategory?.appliesColor"), receiptBlock.split("\n")[0]);
    check("fason kabulde `station.appliesColor` KULLANILMAZ",
      !/station\.appliesColor/.test(sub));
  } finally {
    await prisma.routeStep.deleteMany({ where: { routeId: { in: cleanupRouteIds } } }).catch(() => {});
    await prisma.route.deleteMany({ where: { id: { in: cleanupRouteIds } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: { in: cleanupStationIds } } }).catch(() => {});
    await prisma.color.deleteMany({ where: { id: { in: cleanupColorIds } } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
