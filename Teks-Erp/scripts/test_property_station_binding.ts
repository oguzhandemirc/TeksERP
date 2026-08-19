// =============================================================================
// Test: Kumaş özelliği DOĞARKEN istasyonuna bağlanır (2026-08-02)
// Çalıştır: npx tsx scripts/test_property_station_binding.ts
// =============================================================================
// Korunan invariant: "tanımlandı ama hiçbir iş emrinde seçilemez" ara durumu
// DOĞAMAZ. Saha vakası: `ZIMPARALI` 16 Temmuz'da tanımlandı, hiçbir istasyonun
// StationProperty listesine girmedi ve iki hafta boyunca 0 iş emri / 0 top ile
// kullanılamaz kaldı — çünkü panelde özellik seçmenin tek yolu rota adımındaki
// istasyon chip'leri.
//
// Doğrulananlar:
//   1. stationIds HİÇ gönderilmezse create → 400
//   2. stationIds boş dizi ise create → 400
//   3. geçerli istasyonla create → özellik + StationProperty AYNI anda doğar
//   4. pasif istasyon → 400 (istasyon ADIYLA)
//   5. özellik kazandıramayan kategori (KARTELA: appliesProperty=false) → 400
//   6. olmayan istasyon id → 400
//   7. update stationIds ile replace eder
//   8. update stationIds YOKSA bağlara dokunmaz (ad düzenlemesi bağı silmesin)
//   9. update boş stationIds → 400 (kayıt sonradan da bağsız bırakılamaz)
//  10. reddedilen create HİÇBİR özellik satırı bırakmaz (yarım kayıt yok)
// =============================================================================
import prisma from "../src/lib/prisma";
import { FabricPropertyService } from "../src/services/fabric-property.service";

const svc = new FabricPropertyService({
  modelName: "fabricProperty",
  tableName: "FABRIC_PROPERTY",
  searchFields: ["name", "category", "description"],
  codeSearchFields: ["code"],
  nestedCreateFields: ["stationCapabilities"],
  defaultInclude: {
    stationCapabilities: {
      select: {
        stationId: true,
        station: { select: { id: true, code: true, name: true, isActive: true } },
      },
    },
  },
  duplicateNameField: "name",
  entityLabel: "özellik",
});

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

type Created = { id: string; stationCapabilities?: { stationId: string }[] };

async function main() {
  const ts = Date.now();
  const NIL = "00000000-0000-0000-0000-000000000000";
  const createdPropIds: string[] = [];

  // --- Fixture: kendi istasyonlarımız (ortamdaki veriye bağımlı olma) --------
  // Kategorisiz INTERNAL → canApplyProperty türetimi true.
  const stA = await prisma.station.create({
    data: { code: `TEST-PSB-A-${ts}`, name: "TEST Bağ İstasyon A", type: "INTERNAL", kind: "OTHER" },
    select: { id: true, name: true },
  });
  const stB = await prisma.station.create({
    data: { code: `TEST-PSB-B-${ts}`, name: "TEST Bağ İstasyon B", type: "INTERNAL", kind: "OTHER" },
    select: { id: true },
  });
  const stOff = await prisma.station.create({
    data: { code: `TEST-PSB-OFF-${ts}`, name: "TEST Bağ Pasif", type: "INTERNAL", kind: "OTHER", isActive: false },
    select: { id: true, name: true },
  });
  // Özellik kazandıramayan istasyon (KARTELA kategorisi appliesProperty=false).
  //
  // ⚠️ 2026-08-10: `appliesProperty` AÇIKÇA yazılır. Yetenek artık kategoriden
  // TÜRETİLMİYOR, istasyonun kendi alanında; bu fixture `prisma.station.create`
  // ile SERVİSİ ATLIYOR, dolayısıyla `StationService`'in "kategoriden tohumla"
  // adımı koşmaz ve kolon varsayılanı (true) kalırdı. Panelden açılan bir
  // kartela istasyonu bu değeri servis üzerinden otomatik alır.
  const kartelaCat = await prisma.subcontractorCategory.findUnique({ where: { code: "KARTELA" } });
  if (!kartelaCat) throw new Error("KARTELA kategorisi eksik (npm run seed)");
  const stNoProp = await prisma.station.create({
    data: {
      code: `TEST-PSB-NOPROP-${ts}`,
      name: "TEST Özellik Veremeyen",
      type: "EXTERNAL",
      kind: "OTHER",
      defaultCategoryId: kartelaCat.id,
      appliesProperty: kartelaCat.appliesProperty, // = false
    },
    select: { id: true, name: true },
  });

  try {
    // 1) stationIds hiç gönderilmedi
    await expectErr("stationIds YOK → 400", "istasyon(lar) belirtilmeli", () =>
      svc.create({ name: `TEST Bağsız ${ts}`, isActive: true }),
    );

    // 2) boş dizi
    await expectErr("stationIds boş dizi → 400", "en az bir istasyon", () =>
      svc.create({ name: `TEST Boş ${ts}`, stationIds: [], isActive: true }),
    );

    // 10) reddedilen create yarım kayıt bırakmadı
    const orphanCount = await prisma.fabricProperty.count({
      where: { name: { in: [`TEST Bağsız ${ts}`, `TEST Boş ${ts}`] } },
    });
    check("reddedilen create HİÇBİR özellik satırı bırakmadı", orphanCount === 0, `satır=${orphanCount}`);

    // 3) geçerli create → özellik + bağ aynı anda
    const okRes = await svc.create({
      name: `TEST Bağlı ${ts}`,
      stationIds: [stA.id],
      isActive: true,
    });
    const created = okRes.data as Created;
    createdPropIds.push(created.id);
    const linkRows = await prisma.stationProperty.findMany({
      where: { propertyId: created.id },
      select: { stationId: true },
    });
    check(
      "geçerli create → özellik + StationProperty birlikte doğdu",
      linkRows.length === 1 && linkRows[0].stationId === stA.id,
      `bağ=${linkRows.length}`,
    );
    check(
      "create yanıtı istasyon bağlarını döner (panel rozeti buna dayanır)",
      (created.stationCapabilities ?? []).length === 1,
      `caps=${(created.stationCapabilities ?? []).length}`,
    );

    // 4) pasif istasyon — istasyon ADIYLA reddedilmeli
    await expectErr("pasif istasyon → 400 (adıyla)", stOff.name, () =>
      svc.create({ name: `TEST Pasif İst ${ts}`, stationIds: [stOff.id], isActive: true }),
    );

    // 5) özellik kazandıramayan kategori
    await expectErr("appliesProperty=false istasyon → 400 (adıyla)", stNoProp.name, () =>
      svc.create({ name: `TEST Yetkisiz İst ${ts}`, stationIds: [stNoProp.id], isActive: true }),
    );

    // 6) olmayan istasyon
    await expectErr("olmayan istasyon id → 400", "bulunamadı", () =>
      svc.create({ name: `TEST Yok İst ${ts}`, stationIds: [NIL], isActive: true }),
    );

    // 7) update stationIds ile replace
    await svc.update(created.id, { stationIds: [stB.id] });
    const afterReplace = await prisma.stationProperty.findMany({
      where: { propertyId: created.id },
      select: { stationId: true },
    });
    check(
      "update stationIds → replace (A gitti, B geldi)",
      afterReplace.length === 1 && afterReplace[0].stationId === stB.id,
      `bağ=${afterReplace.map((r) => (r.stationId === stB.id ? "B" : "?")).join(",")}`,
    );

    // 8) stationIds gönderilmeden ad düzenlemesi bağa DOKUNMAMALI
    await svc.update(created.id, { name: `TEST Bağlı ${ts} (düzenlendi)` });
    const afterRename = await prisma.stationProperty.count({ where: { propertyId: created.id } });
    check("stationIds YOKken ad düzenlemesi bağı korudu", afterRename === 1, `bağ=${afterRename}`);

    // 9) update ile bağsız bırakılamaz
    await expectErr("update boş stationIds → 400", "en az bir istasyon", () =>
      svc.update(created.id, { stationIds: [] }),
    );
    const afterFailedUpdate = await prisma.stationProperty.count({ where: { propertyId: created.id } });
    check("reddedilen update bağı bozmadı", afterFailedUpdate === 1, `bağ=${afterFailedUpdate}`);
  } finally {
    // Kendi yarattıklarımızı temizle (StationProperty → Station/Property Cascade
    // garantisi yok; propertyId FK'sı RESTRICT olabilir → önce bağları sil).
    await prisma.stationProperty.deleteMany({
      where: { OR: [{ propertyId: { in: createdPropIds } }, { stationId: { in: [stA.id, stB.id, stOff.id, stNoProp.id] } }] },
    }).catch(() => {});
    await prisma.fabricProperty.deleteMany({ where: { id: { in: createdPropIds } } }).catch(() => {});
    await prisma.station.deleteMany({
      where: { id: { in: [stA.id, stB.id, stOff.id, stNoProp.id] } },
    }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
