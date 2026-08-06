// =============================================================================
// Test: Rota adımının ŞABLON HEDEFİ — renk + özellik (2026-08-06)
// Çalıştır: npx tsx scripts/test_route_step_targets.ts
// =============================================================================
// Saha isteği: "rota oluştururken boyahaneye ekleyince alabileceği özellikleri
// göremiyorum ve seçemiyorum; bu kayıtlı rota kolay seçim işime yarayacak."
// Rota adımı artık hedef renk (`plannedColorId`) + hedef özellikleri
// (`RouteStepProperty`) saklıyor; iş emri açılışında istemci bunları hedef
// alanlara kopyalar.
//
// Korunan invariantlar:
//   1. İstemci sözleşmesi DÜZ ID DİZİSİDİR (`plannedPropertyIds`) — ham Prisma
//      nested write (`plannedProperties: {create:…}`) allowlist'e TAKILIR. Bu,
//      generic CRUD üzerinden ilişki manipülasyonunu kapatan F209 seddidir;
//      "istemci zaten nested yazsın" diye gevşetilirse `connect`/`deleteMany` de
//      aynı delikten geçer.
//   2. Hedef, adımın İSTASYONUNUN gerçekten uygulayabildiğiyle sınırlıdır:
//      renk → `hasDefaultCategory && appliesColor` (kategorisiz istasyonda bayrak
//      "bilinmiyor→serbest" olarak true doğar, tek başına yetmez), özellik →
//      istasyonun StationProperty listesi. Panel de bu iki kuralı uygular;
//      backend ikinci hattır (API'ye doğrudan gelen sapma sessizce kaydolmasın).
//   3. Pasif renk/özellik giremez (soft-delete giriş guard'ı, mevcut istasyon/
//      kategori/firma kontrolleriyle simetri).
//   4. Güncellemede adımlar silinip yeniden yazıldığı için pivot satırları da
//      CASCADE ile düşer — eski adımın özelliği yeni adıma sızmaz, artık satır
//      kalmaz.
//   5. HEDEFSİZ rota yolu davranışını KORUR: ek sorgu koşmaz, pivot satırı
//      doğurmaz (2026-08-06 öncesi gövdeyle birebir).
// =============================================================================
import prisma from "../src/lib/prisma";
import { RouteService, ROUTE_SERVICE_CONFIG } from "../src/services/route.service";

const svc = new RouteService(ROUTE_SERVICE_CONFIG);

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}
async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "hata bekleniyordu");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    check(label, m.includes(part), m);
  }
}

interface RouteStepShape {
  id: string;
  stationId: string;
  sequence: number;
  plannedColorId: string | null;
  plannedColor?: { id: string; name: string } | null;
  plannedProperties?: { propertyId: string }[];
}
type RouteShape = { id: string; steps: RouteStepShape[] };

async function main() {
  const ts = Date.now();
  const createdRouteIds: string[] = [];
  const createdStationIds: string[] = [];
  const createdPropIds: string[] = [];
  const createdColorIds: string[] = [];

  // --- Fixture: kendi istasyon/özellik/renklerimiz (ortam verisine bağımlı olma)
  const boyaCat = await prisma.subcontractorCategory.findUnique({ where: { code: "BOYA" } });
  const zimparaCat = await prisma.subcontractorCategory.findUnique({ where: { code: "ZIMPARA" } });
  if (!boyaCat || !zimparaCat) throw new Error("BOYA/ZIMPARA kategorisi eksik (npm run seed)");

  // Renk VEREN adım (boyahane): appliesColor=true + appliesProperty=true
  const stDye = await prisma.station.create({
    data: {
      code: `TEST-RST-DYE-${ts}`,
      name: "TEST Rota Boyahane",
      type: "EXTERNAL",
      kind: "OTHER",
      defaultCategoryId: boyaCat.id,
    },
    select: { id: true, name: true },
  });
  // Renk VERMEYEN ama özellik veren adım (zımpara)
  const stSand = await prisma.station.create({
    data: {
      code: `TEST-RST-SAND-${ts}`,
      name: "TEST Rota Zımpara",
      type: "EXTERNAL",
      kind: "OTHER",
      defaultCategoryId: zimparaCat.id,
    },
    select: { id: true, name: true },
  });
  // Kategorisiz iç istasyon — canApplyColor türetimi TRUE doğar ama
  // hasDefaultCategory false olduğu için renk yine de yazılamamalı (invariant 2).
  const stPlain = await prisma.station.create({
    data: {
      code: `TEST-RST-PLAIN-${ts}`,
      name: "TEST Rota Tambur",
      type: "INTERNAL",
      kind: "OTHER",
    },
    select: { id: true, name: true },
  });
  createdStationIds.push(stDye.id, stSand.id, stPlain.id);

  const propDye = await prisma.fabricProperty.create({
    data: { code: `TEST-RST-P1-${ts}`, name: `TEST Rota Özellik 1 ${ts}` },
    select: { id: true },
  });
  const propSand = await prisma.fabricProperty.create({
    data: { code: `TEST-RST-P2-${ts}`, name: `TEST Rota Özellik 2 ${ts}` },
    select: { id: true },
  });
  const propOff = await prisma.fabricProperty.create({
    data: { code: `TEST-RST-P3-${ts}`, name: `TEST Rota Özellik 3 ${ts}`, isActive: false },
    select: { id: true },
  });
  createdPropIds.push(propDye.id, propSand.id, propOff.id);

  // Yetenek bağları: boyahane → propDye (+ propOff), zımpara → propSand
  await prisma.stationProperty.createMany({
    data: [
      { stationId: stDye.id, propertyId: propDye.id },
      { stationId: stDye.id, propertyId: propOff.id },
      { stationId: stSand.id, propertyId: propSand.id },
    ],
  });

  const color = await prisma.color.create({
    data: { code: `TEST-RST-C1-${ts}`, name: `TEST Rota Renk ${ts}` },
    select: { id: true },
  });
  const colorOff = await prisma.color.create({
    data: { code: `TEST-RST-C2-${ts}`, name: `TEST Rota Pasif Renk ${ts}`, isActive: false },
    select: { id: true },
  });
  createdColorIds.push(color.id, colorOff.id);

  const mkSteps = (over: Record<string, unknown>[] = []) =>
    over.length > 0 ? over : [{ stationId: stDye.id, sequence: 1 }];

  try {
    // --- 1) Hedefli create → geri okumada renk + özellik döner ---------------
    const r1 = (
      await svc.create({
        name: `TEST Rota Hedefli ${ts}`,
        steps: {
          create: mkSteps([
            {
              stationId: stDye.id,
              sequence: 1,
              plannedColorId: color.id,
              plannedPropertyIds: [propDye.id],
            },
            { stationId: stSand.id, sequence: 2, plannedPropertyIds: [propSand.id] },
          ]),
        },
      })
    ).data as RouteShape;
    createdRouteIds.push(r1.id);

    const s1 = r1.steps.find((s) => s.sequence === 1);
    const s2 = r1.steps.find((s) => s.sequence === 2);
    check("1a) hedef renk kaydedildi", s1?.plannedColorId === color.id, s1?.plannedColorId ?? "yok");
    check(
      "1b) renk ADI da döner (panel ikinci sorgu atmasın)",
      Boolean(s1?.plannedColor?.name),
      s1?.plannedColor?.name ?? "yok",
    );
    check(
      "1c) hedef özellik kaydedildi (boyahane)",
      s1?.plannedProperties?.length === 1 && s1.plannedProperties[0]?.propertyId === propDye.id,
      JSON.stringify(s1?.plannedProperties ?? []),
    );
    check(
      "1d) ikinci adımın özelliği kendi istasyonundan",
      s2?.plannedProperties?.length === 1 && s2.plannedProperties[0]?.propertyId === propSand.id,
    );
    check("1e) renksiz adım renksiz kalır", s2?.plannedColorId === null);

    // --- 2) Ham Prisma nested write REDDEDİLİR (F209 allowlist) -------------
    await expectErr("2) plannedProperties nested write → 400", "izin verilmeyen alan", () =>
      svc.create({
        name: `TEST Rota Nested ${ts}`,
        steps: {
          create: [
            {
              stationId: stDye.id,
              sequence: 1,
              plannedProperties: { create: [{ propertyId: propDye.id }] },
            },
          ],
        },
      }),
    );

    // --- 3) İstasyon yeteneği sınırı ---------------------------------------
    await expectErr(
      "3a) istasyonun yetenek listesinde olmayan özellik → 400",
      "yetenek listesinde olmayan",
      () =>
        svc.create({
          name: `TEST Rota Yetenek ${ts}`,
          steps: {
            create: [
              { stationId: stSand.id, sequence: 1, plannedPropertyIds: [propDye.id] },
            ],
          },
        }),
    );
    await expectErr("3b) renk vermeyen kategori (zımpara) → 400", "renk uygulamıyor", () =>
      svc.create({
        name: `TEST Rota Zımpara Renk ${ts}`,
        steps: { create: [{ stationId: stSand.id, sequence: 1, plannedColorId: color.id }] },
      }),
    );
    await expectErr(
      "3c) KATEGORİSİZ istasyona renk → 400 (canApplyColor tek başına yetmez)",
      "renk uygulamıyor",
      () =>
        svc.create({
          name: `TEST Rota Kategorisiz Renk ${ts}`,
          steps: { create: [{ stationId: stPlain.id, sequence: 1, plannedColorId: color.id }] },
        }),
    );

    // --- 4) Pasif kayıt giriş guard'ı --------------------------------------
    await expectErr("4a) pasif renk → 400", "pasif renk", () =>
      svc.create({
        name: `TEST Rota Pasif Renk ${ts}`,
        steps: { create: [{ stationId: stDye.id, sequence: 1, plannedColorId: colorOff.id }] },
      }),
    );
    await expectErr("4b) pasif özellik → 400", "pasif özellik", () =>
      svc.create({
        name: `TEST Rota Pasif Özellik ${ts}`,
        steps: {
          create: [{ stationId: stDye.id, sequence: 1, plannedPropertyIds: [propOff.id] }],
        },
      }),
    );
    await expectErr("4c) bozuk özellik listesi → 400", "hedef özellik listesi geçersiz", () =>
      svc.create({
        name: `TEST Rota Bozuk ${ts}`,
        steps: {
          create: [{ stationId: stDye.id, sequence: 1, plannedPropertyIds: "MAVI" }],
        },
      }),
    );

    // Reddedilen create yarım kayıt bırakmamalı
    const orphan = await prisma.route.count({
      where: { name: { startsWith: "TEST Rota ", contains: String(ts) }, id: { notIn: createdRouteIds } },
    });
    check("4d) reddedilen create rota satırı bırakmaz", orphan === 0, `bulunan: ${orphan}`);

    // --- 5) Update: adımlar silinip yeniden yazılır, pivot CASCADE düşer ----
    const oldStepIds = r1.steps.map((s) => s.id);
    const r1b = (
      await svc.update(r1.id, {
        steps: {
          deleteMany: {},
          create: [
            { stationId: stDye.id, sequence: 1, plannedColorId: null, plannedPropertyIds: [] },
          ],
        },
      })
    ).data as RouteShape;
    check("5a) adım sayısı güncellendi", r1b.steps.length === 1, `${r1b.steps.length}`);
    check("5b) hedef temizlendi", r1b.steps[0]?.plannedColorId === null);
    check("5c) özellik satırı kalmadı", (r1b.steps[0]?.plannedProperties ?? []).length === 0);
    const orphanPivot = await prisma.routeStepProperty.count({
      where: { routeStepId: { in: oldStepIds } },
    });
    check("5d) eski adımların pivot satırları CASCADE ile düştü", orphanPivot === 0, `kalan: ${orphanPivot}`);

    // --- 6) Hedefsiz rota: davranış korunur --------------------------------
    const r2 = (
      await svc.create({
        name: `TEST Rota Hedefsiz ${ts}`,
        steps: { create: [{ stationId: stPlain.id, sequence: 1, defaultNotes: "not" }] },
      })
    ).data as RouteShape;
    createdRouteIds.push(r2.id);
    check("6a) hedefsiz adım renksiz doğar", r2.steps[0]?.plannedColorId === null);
    check("6b) hedefsiz adım pivot satırı doğurmaz", (r2.steps[0]?.plannedProperties ?? []).length === 0);

    // --- 7) Tekrarlı id'ler tek satıra iner (unique ihlali 500 vermez) ------
    const r3 = (
      await svc.create({
        name: `TEST Rota Tekrarlı ${ts}`,
        steps: {
          create: [
            {
              stationId: stDye.id,
              sequence: 1,
              plannedPropertyIds: [propDye.id, propDye.id],
            },
          ],
        },
      })
    ).data as RouteShape;
    createdRouteIds.push(r3.id);
    check("7) tekrarlı özellik id'si tek satır olur", (r3.steps[0]?.plannedProperties ?? []).length === 1);
  } finally {
    // Cleanup — pivot satırları route/step cascade'iyle düşer.
    await prisma.route.deleteMany({ where: { id: { in: createdRouteIds } } });
    await prisma.stationProperty.deleteMany({ where: { stationId: { in: createdStationIds } } });
    await prisma.station.deleteMany({ where: { id: { in: createdStationIds } } });
    await prisma.fabricProperty.deleteMany({ where: { id: { in: createdPropIds } } });
    await prisma.color.deleteMany({ where: { id: { in: createdColorIds } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
