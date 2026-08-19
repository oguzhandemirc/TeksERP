// =============================================================================
// Saha #14 regresyonu: rota şablonu fason firma (plannedSubcontractorId) round-trip
// =============================================================================
// Saha bug'ı: "iş emri şablonu kaydediyorum, rotadaki fason firmasını seçip
// kaydediyorum, şablonu tekrar kullanınca firma boş geliyor." Frontend'in
// gönderdiği DÜZ array step payload'ı, RouteService.create ile kaydedilip
// findById (frontend seedFromRoute'un çektiği yol) ile geri okunduğunda firmanın
// hem scalar (plannedSubcontractorId) hem nested (plannedSubcontractor.name) olarak
// döndüğünü doğrular. defaultInclude'dan plannedSubcontractor düşerse VEYA
// BaseService nested create firmayı süzerse bu test kırılır.
//
// Config: ROUTE_SERVICE_CONFIG (route.service.ts) — canlı wiring ile TEK KAYNAK.
// =============================================================================
import prisma from "../src/lib/prisma";
import { RouteService, ROUTE_SERVICE_CONFIG } from "../src/services/route.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  ok ? pass++ : fail++;
};

interface StepShape {
  plannedSubcontractorId: string | null;
  plannedSubcontractor: { id: string; name: string } | null;
}

async function main() {
  const station = await prisma.station.findFirst({
    where: { type: "EXTERNAL", isActive: true },
  });
  // ⚠️ FİRMA "herhangi bir aktif firma" DEĞİL, fixture'dan çözülür (CLAUDE.md
  // test kuralı). Eski hâli `subcontractor.findFirst({isActive:true})` idi ve
  // SIRA BAĞIMLIYDI: dönen firmanın kategorisi adımın `requiredCategoryId`'siyle
  // uyuşmazsa `validateSteps` 400 atıyordu — test tek başına YEŞİL, paket içinde
  // (başka testler firma satırlarını ekleyip sildikçe) ARADA BİR kırmızı.
  // Belirsizlik açık kırmızıdan tehlikelidir: ters yönde, yanlış kategorideki
  // firma testi yanlış şeyi doğrulayarak GEÇİRİRDİ.
  const firm = await ensureTestDyeHouse();
  if (!station) throw new Error("Fixture yok (EXTERNAL istasyon gerekli)");
  console.log(`Fixture: station=${station.name} firm=${firm.name}`);

  const service = new RouteService(ROUTE_SERVICE_CONFIG);
  let routeId: string | null = null;

  try {
    // Frontend routeStepsToCreatePayload'ın gönderdiği ŞEKİL: düz array step'ler.
    const payload = {
      name: `TEST rota ${Date.now()}`,
      code: `TEST-RT-${Date.now()}`,
      isActive: true,
      isFavorite: false,
      steps: [
        {
          stationId: station.id,
          sequence: 1,
          defaultNotes: "test not",
          // Kategori FİRMANIN kendi kategorisinden yazılır — istasyonun
          // `defaultCategoryId`'sinden okumak, ikisinin ayrışabildiği her
          // ortamda aynı sıra-bağımlı 400'ü geri getirir.
          requiredCategoryId: firm.categoryId,
          plannedSubcontractorId: firm.id,
        },
      ],
    };

    const created = await service.create(payload as unknown as Record<string, unknown>);
    const cd = created.data as { id: string; steps: StepShape[] };
    routeId = cd.id;
    check("create → 1 adım döndü", cd.steps?.length === 1);
    check("create → scalar plannedSubcontractorId dolu", cd.steps?.[0]?.plannedSubcontractorId === firm.id);
    check("create → nested plannedSubcontractor.id dolu", cd.steps?.[0]?.plannedSubcontractor?.id === firm.id);

    // findById = frontend seedFromRoute'un çektiği yol (şablonu tekrar kullanma).
    const fetched = await service.findById(routeId);
    const fd = fetched.data as { steps: StepShape[] };
    check("findById → scalar plannedSubcontractorId dolu", fd.steps?.[0]?.plannedSubcontractorId === firm.id);
    check("findById → nested plannedSubcontractor.id dolu", fd.steps?.[0]?.plannedSubcontractor?.id === firm.id);
  } finally {
    if (routeId) {
      await prisma.routeStep.deleteMany({ where: { routeId } });
      await prisma.route.delete({ where: { id: routeId } });
    }
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
