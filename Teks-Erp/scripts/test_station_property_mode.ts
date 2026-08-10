// =============================================================================
// Test: İSTASYON-ÖZELLİK DAVRANIŞ MODU (AUTO / OPTIONAL / REQUIRED) — 2026-08-10
// Çalıştır: npx tsx scripts/test_station_property_mode.ts
// =============================================================================
// Korunan invariant: bir özelliğin istasyonda NASIL teyit edileceği ayarlanabilir
// olmalı ve varsayılan SESSİZ OTOMATİK OLMAMALI. Şemanın kendi uyarısı:
// "Kurşun'un listesine ikinci bir özellik eklendiği gün o özellik oradan geçen
// HER TOPA sessizce yazılır."
//
// Doğrulananlar:
//   1. Yeni satırın varsayılan modu OPTIONAL — AUTO DEĞİL (kapatılan tuzak)
//   2. AUTO satır seçim olmadan da topa yazılır
//   3. OPTIONAL satır seçilmedikçe YAZILMAZ
//   4. OPTIONAL satır seçilince yazılır
//   5. REQUIRED işaretlenmemişse 400 — ve mesaj özelliğin ADINI söyler
//   6. REQUIRED işaretlenince geçer
//   7. KESİŞİM: istasyonun taşımadığı bir özellik id'si gönderilse de yazılmaz
//   8. setCapabilities mod yazar
//   9. setCapabilities mod GÖNDERİLMEYEN satırın modunu KORUR (ad/liste düzenlemesi
//      dokunulmamış satırların modunu sıfırlamamalı)
//  10. Eski `propertyIds` sözleşmesi hâlâ çalışır (panel güncellenene kadar)
//  11. Kurşun bypass yüklemi: AUTO olmayan KURSUN satırı AUTO süzgecinden GEÇMEZ
// =============================================================================
import prisma from "../src/lib/prisma";
import {
  assertRequiredPropertiesSelected,
  copyStationCapabilitiesToRoll,
  loadStationPropertyCaps,
} from "../src/services/helpers/station-capability-transfer.helper";
import { StationCapabilityService } from "../src/services/station-capability.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const svc = new StationCapabilityService();

async function main() {
  const ts = Date.now();

  // ── Fixture: kendi istasyonumuz + 3 özellik + 1 top ─────────────────────────
  const station = await prisma.station.create({
    data: { code: `TEST-SPM-${ts}`, name: "TEST Mod İstasyonu", type: "INTERNAL", kind: "OTHER" },
    select: { id: true },
  });
  const mkProp = (suffix: string, name: string) =>
    prisma.fabricProperty.create({
      data: { code: `TEST-SPM-${suffix}-${ts}`, name, valueType: "FLAG" },
      select: { id: true, name: true },
    });
  const pAuto = await mkProp("A", "TEST Otomatik Özellik");
  const pOpt = await mkProp("O", "TEST Opsiyonel Özellik");
  const pReq = await mkProp("R", "TEST Zorunlu Özellik");
  // İstasyonun TAŞIMADIĞI özellik — kesişim kontrolü için.
  const pOutsider = await mkProp("X", "TEST Yabancı Özellik");

  const item = await prisma.item.create({
    data: { code: `TEST-SPM-ITM-${ts}`, name: `TEST Mod ${ts}`, itemType: "FABRIC" },
    select: { id: true },
  });
  const mkRoll = async (n: number) =>
    (await prisma.roll.create({
      data: {
        barcode: `TEST-SPM-R${n}-${ts}`,
        itemId: item.id,
        status: "WAREHOUSE",
        initialQty: 100,
        currentQty: 100,
        entrySource: "TAMBUR_MANUAL",
      },
      select: { id: true },
    })).id;

  const rollIds: string[] = [];
  const propIds = [pAuto.id, pOpt.id, pReq.id, pOutsider.id];

  try {
    // ── 1) Varsayılan mod OPTIONAL (kapatılan tuzak) ─────────────────────────
    await prisma.stationProperty.create({
      data: { stationId: station.id, propertyId: pAuto.id },
    });
    const defaultRow = await prisma.stationProperty.findFirstOrThrow({
      where: { stationId: station.id, propertyId: pAuto.id },
      select: { mode: true },
    });
    check("yeni satırın varsayılan modu OPTIONAL (AUTO değil)", defaultRow.mode === "OPTIONAL",
      defaultRow.mode);

    // Şimdi test kurulumunu tamamla: A=AUTO, O=OPTIONAL, R=REQUIRED
    await prisma.stationProperty.update({
      where: { stationId_propertyId: { stationId: station.id, propertyId: pAuto.id } },
      data: { mode: "AUTO" },
    });
    await prisma.stationProperty.create({
      data: { stationId: station.id, propertyId: pOpt.id, mode: "OPTIONAL" },
    });
    await prisma.stationProperty.create({
      data: { stationId: station.id, propertyId: pReq.id, mode: "REQUIRED" },
    });

    const caps = await loadStationPropertyCaps(prisma, station.id);
    check("yetenek listesi 3 satır döndü", caps.length === 3, String(caps.length));

    // ── 2/3) Seçim YOK → yalnız AUTO yazılır ─────────────────────────────────
    const r1 = await mkRoll(1); rollIds.push(r1);
    await copyStationCapabilitiesToRoll(prisma, { stationId: station.id, rollId: r1, caps });
    const r1props = await prisma.rollProperty.findMany({
      where: { rollId: r1 }, select: { propertyId: true },
    });
    const r1set = new Set(r1props.map((p) => p.propertyId));
    check("AUTO satır seçim olmadan YAZILDI", r1set.has(pAuto.id));
    check("OPTIONAL satır seçilmedikçe YAZILMADI", !r1set.has(pOpt.id));
    check("REQUIRED satır da seçilmedikçe yazılmadı", !r1set.has(pReq.id));
    check("toplam yalnız 1 özellik yazıldı", r1props.length === 1, String(r1props.length));

    // ── 4/7) Seçim VAR → AUTO + seçilenler; yabancı id yazılmaz ──────────────
    const r2 = await mkRoll(2); rollIds.push(r2);
    await copyStationCapabilitiesToRoll(prisma, {
      stationId: station.id,
      rollId: r2,
      selectedPropertyIds: [pOpt.id, pOutsider.id],
      caps,
    });
    const r2set = new Set(
      (await prisma.rollProperty.findMany({ where: { rollId: r2 }, select: { propertyId: true } }))
        .map((p) => p.propertyId),
    );
    check("seçilen OPTIONAL yazıldı", r2set.has(pOpt.id));
    check("AUTO yine yazıldı (seçilmese de)", r2set.has(pAuto.id));
    check("KESİŞİM: istasyonda olmayan özellik YAZILMADI", !r2set.has(pOutsider.id));

    // ── 5/6) REQUIRED zorunluluğu ────────────────────────────────────────────
    let reqErr = "";
    try {
      assertRequiredPropertiesSelected(caps, [pOpt.id]);
    } catch (e) {
      reqErr = e instanceof Error ? e.message : String(e);
    }
    check("REQUIRED işaretlenmemişse hata verir", reqErr !== "", reqErr);
    check("hata mesajı özelliğin ADINI söyler ('bazıları' demez)",
      reqErr.includes("TEST Zorunlu Özellik"), reqErr);

    let okErr = "";
    try {
      assertRequiredPropertiesSelected(caps, [pReq.id]);
    } catch (e) {
      okErr = e instanceof Error ? e.message : String(e);
    }
    check("REQUIRED işaretlenince geçer", okErr === "", okErr);

    // ── 8/9/10) setCapabilities mod sözleşmesi ───────────────────────────────
    // Modu açıkça değiştir
    await svc.setCapabilities(station.id, {
      properties: [
        { propertyId: pAuto.id, mode: "AUTO" },
        { propertyId: pOpt.id, mode: "REQUIRED" },
        { propertyId: pReq.id, mode: "REQUIRED" },
      ],
    });
    const afterSet = Object.fromEntries(
      (await prisma.stationProperty.findMany({
        where: { stationId: station.id },
        select: { propertyId: true, mode: true },
      })).map((r) => [r.propertyId, r.mode]),
    );
    check("setCapabilities modu YAZDI (OPTIONAL → REQUIRED)", afterSet[pOpt.id] === "REQUIRED",
      String(afterSet[pOpt.id]));

    // Mod GÖNDERİLMEDEN listeye yeni özellik ekle → dokunulmayanların modu korunur
    await svc.setCapabilities(station.id, {
      properties: [
        { propertyId: pAuto.id },
        { propertyId: pOpt.id },
        { propertyId: pReq.id },
        { propertyId: pOutsider.id },
      ],
    });
    const afterAdd = Object.fromEntries(
      (await prisma.stationProperty.findMany({
        where: { stationId: station.id },
        select: { propertyId: true, mode: true },
      })).map((r) => [r.propertyId, r.mode]),
    );
    check("mod gönderilmeyince MEVCUT satırın modu KORUNDU (AUTO)", afterAdd[pAuto.id] === "AUTO",
      String(afterAdd[pAuto.id]));
    check("mod gönderilmeyince REQUIRED de korundu", afterAdd[pOpt.id] === "REQUIRED",
      String(afterAdd[pOpt.id]));
    check("yeni eklenen satır OPTIONAL doğdu", afterAdd[pOutsider.id] === "OPTIONAL",
      String(afterAdd[pOutsider.id]));

    // Eski sözleşme (`propertyIds`) hâlâ çalışmalı — panel güncellenene kadar
    await svc.setCapabilities(station.id, { propertyIds: [pAuto.id, pOpt.id] });
    const afterLegacy = await prisma.stationProperty.findMany({
      where: { stationId: station.id },
      select: { propertyId: true, mode: true },
    });
    check("eski propertyIds sözleşmesi replace etti", afterLegacy.length === 2,
      String(afterLegacy.length));
    check("eski sözleşmede de mod korundu",
      afterLegacy.find((r) => r.propertyId === pAuto.id)?.mode === "AUTO");

    // ── 11) Kurşun bypass yüklemi: AUTO süzgeci ──────────────────────────────
    // Bypass'ta tablet salt-okunur → işaretleyecek operatör yok → OPTIONAL bir
    // KURSUN satırı kapanışta hiç uygulanmaz. Guard bu yüzden AUTO arar.
    await prisma.stationProperty.update({
      where: { stationId_propertyId: { stationId: station.id, propertyId: pAuto.id } },
      data: { mode: "OPTIONAL" },
    });
    const autoHit = await prisma.stationProperty.findFirst({
      where: { stationId: station.id, propertyId: pAuto.id, mode: "AUTO" },
      select: { id: true },
    });
    check("AUTO olmayan satır AUTO süzgecinden GEÇMEZ (bypass guard'ı)", autoHit === null);
  } finally {
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: item.id } }).catch(() => {});
    await prisma.stationProperty.deleteMany({ where: { stationId: station.id } }).catch(() => {});
    await prisma.fabricProperty.deleteMany({ where: { id: { in: propIds } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: station.id } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
