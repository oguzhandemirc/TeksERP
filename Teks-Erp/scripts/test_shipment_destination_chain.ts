// =============================================================================
// Test: sevk yönü zinciri — `resolveShipmentDestination` (kilit kararı 2026-09-23)
// Çalıştır: npx tsx scripts/test_shipment_destination_chain.ts
// Doğrulananlar:
//   1. Saf zincir (`pickShipmentDestination`): şube > cari > null, kaynak beyanlı.
//   2. DB: iki yön de boş → null (ilk sevk) · cari dolu → CUSTOMER · şube dolu →
//      BRANCH (carinin yönünü EZER) · şube boş → cariye düşer · pasif şube de yönünü taşır.
//   3. Fail-closed: başka carinin şubesi → 400 · olmayan cari → 404.
//   5. Sevk ekranı ucu: ihracat kodu yalnız EXPORT'ta (şube > cari), gizlenen kod silinmez,
//      hızlı sevk engel gerekçesi. 6. İki belge render'ı ihracat kodunu `pickExportCode`dan alır.
//   4. `customers.branchesEnabled` KAPALI iken şube taşıyan sevkiyatta şubenin yönü
//      uygulanır (zincir bayrağı okumaz). Bayrak gerçekten kapalı okunamazsa
//      ÖLÇÜLEMEDİ basılır ve koşum kırmızıdır — "uyumlu" sayılmaz.
// Negatif sondalar (2026-09-23, üçü de geri alındı → 11/0/0):
//   ① zincirde şube/cari sırası ters → 1b, 2c, 4 KIRMIZI (3 başarısız)
//   ② şube sorgusundan `customerId` koşulu düştü → 3a KIRMIZI
//   ③ 4'te bayrak `true` yazıldı → ÖLÇÜLEMEDİ basıldı, çıkış 1
//   ④ render'a elle `??` zinciri geri kondu → §6 ❌ (ilk hâli yorumdaki zinciri de sayıyordu)
//   ⑤ exportCodeForDestination yönden bağımsız → 5d/5e/5h ❌
// =============================================================================
import prisma from "../src/lib/prisma";
import { CustomerService } from "../src/services/customer.service";
import {
  SETTING_KEYS,
  readCustomerBranchesEnabled,
} from "../src/services/system-setting.service";
import {
  exportCodeForDestination,
  pickExportCode,
  pickShipmentDestination,
  readShipmentDestinationLock,
  resolveShipmentDestination,
} from "../src/services/helpers/shipment-destination.helper";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppError } from "../src/utils/app-error";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";

let pass = 0;
let fail = 0;
let olculemedi = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
function unmeasured(label: string, why: string) {
  olculemedi++;
  console.log(`⚠️  ÖLÇÜLEMEDİ: ${label} — ${why}`);
}

const service = new CustomerService({
  modelName: "customer",
  tableName: "CUSTOMER",
  searchFields: ["name"],
  codeSearchFields: ["code", "taxNumber", "exportCode"],
  defaultInclude: undefined,
  uniqueField: "code",
  nestedCreateFields: ["branches"],
});

async function expectError(fn: () => Promise<unknown>): Promise<AppError | null> {
  try { await fn(); return null; } catch (e) { return e instanceof AppError ? e : null; }
}

async function main() {
  // 1) saf zincir
  const p1 = pickShipmentDestination({ branchDestination: null, customerDestination: null });
  check("1a ikisi boş → null / kaynak null", p1.destination === null && p1.source === null);
  const p2 = pickShipmentDestination({ branchDestination: "DOMESTIC", customerDestination: "EXPORT" });
  check("1b şube dolu → şube kazanır", p2.destination === "DOMESTIC" && p2.source === "BRANCH", JSON.stringify(p2));
  const p3 = pickShipmentDestination({ branchDestination: null, customerDestination: "EXPORT" });
  check("1c şube boş → cari", p3.destination === "EXPORT" && p3.source === "CUSTOMER", JSON.stringify(p3));

  const ts = Date.now();
  const createdIds: string[] = [];
  const flagKey = SETTING_KEYS.CUSTOMER_BRANCHES_ENABLED;
  let flagBefore: { value: unknown } | null = null;
  try {
    const bos = (await service.create({ name: `TEST Yön Boş ${ts}` }, undefined)).data as { id: string };
    createdIds.push(bos.id);
    const ihr = (await service.create({ name: `TEST Yön İhracat ${ts}`, defaultDestination: "EXPORT" }, undefined)).data as { id: string };
    createdIds.push(ihr.id);
    const subeYurtici = await prisma.customerBranch.create({ data: { customerId: ihr.id, name: `TEST Şube Yİ ${ts}`, defaultDestination: "DOMESTIC" }, select: { id: true } });
    const subeBos = await prisma.customerBranch.create({ data: { customerId: ihr.id, name: `TEST Şube Boş ${ts}` }, select: { id: true } });
    await prisma.customer.update({ where: { id: ihr.id }, data: { exportCode: `EXP-C-${ts}` } });
    await prisma.customer.update({ where: { id: bos.id }, data: { exportCode: `EXP-Y-${ts}` } });
    const subeKodlu = await prisma.customerBranch.create({ data: { customerId: ihr.id, name: `TEST Şube Kod ${ts}`, code: `EXP-B-${ts}` }, select: { id: true } });
    const subePasif = await prisma.customerBranch.create({ data: { customerId: bos.id, name: `TEST Şube Pasif ${ts}`, defaultDestination: "EXPORT", isActive: false }, select: { id: true } });

    // 2) DB zinciri
    const r1 = await resolveShipmentDestination(prisma, { customerId: bos.id });
    check("2a cari boş, şube yok → null (ilk sevk)", r1.destination === null && r1.source === null, JSON.stringify(r1));
    const r2 = await resolveShipmentDestination(prisma, { customerId: ihr.id, branchId: null });
    check("2b cari EXPORT → CUSTOMER/EXPORT", r2.destination === "EXPORT" && r2.source === "CUSTOMER", JSON.stringify(r2));
    const r3 = await resolveShipmentDestination(prisma, { customerId: ihr.id, branchId: subeYurtici.id });
    check("2c şube DOMESTIC, cari EXPORT → BRANCH/DOMESTIC", r3.destination === "DOMESTIC" && r3.source === "BRANCH", JSON.stringify(r3));
    const r4 = await resolveShipmentDestination(prisma, { customerId: ihr.id, branchId: subeBos.id });
    check("2d şube boş → cariye düşer (CUSTOMER/EXPORT)", r4.destination === "EXPORT" && r4.source === "CUSTOMER", JSON.stringify(r4));
    const r5 = await resolveShipmentDestination(prisma, { customerId: bos.id, branchId: subePasif.id });
    check("2e pasif şube yönünü taşır (BRANCH/EXPORT)", r5.destination === "EXPORT" && r5.source === "BRANCH", JSON.stringify(r5));

    // 5) sevk ekranı ucu — ihracat kodu yalnız yurtdışında, belgeyle aynı çözüm
    const l1 = await readShipmentDestinationLock(prisma, { customerId: ihr.id });
    check("5a EXPORT cari → kod cariden", l1.destination === "EXPORT" && l1.exportCode === `EXP-C-${ts}`, JSON.stringify(l1));
    check("5b EXPORT → hızlı sevk engel gerekçesi dolu, kaynağı söylüyor", !!l1.quickShipBlockedReason?.startsWith("Bu cari ihracat olarak kilitli"), String(l1.quickShipBlockedReason));
    const l2 = await readShipmentDestinationLock(prisma, { customerId: ihr.id, branchId: subeKodlu.id });
    check("5c şube ihracat kodu cariden ÖNCE", l2.exportCode === `EXP-B-${ts}` && l2.source === "CUSTOMER", JSON.stringify(l2));
    const l3 = await readShipmentDestinationLock(prisma, { customerId: ihr.id, branchId: subeYurtici.id });
    check("5d yön YURTİÇİ → kod GÖSTERİLMEZ (cari kodu dolu olsa da)", l3.destination === "DOMESTIC" && l3.exportCode === null && l3.quickShipBlockedReason === null, JSON.stringify(l3));
    const l4 = await readShipmentDestinationLock(prisma, { customerId: bos.id });
    check("5e zincir boş → yön null, kod null (dolu kod gizli ama silinmedi)", l4.destination === null && l4.exportCode === null, JSON.stringify(l4));
    const bosKod = await prisma.customer.findUnique({ where: { id: bos.id }, select: { exportCode: true } });
    check("5f gizlenen kod yerinde", bosKod?.exportCode === `EXP-Y-${ts}`);
    check("5g saf: pickExportCode şube > cari", pickExportCode({ branchCode: "B", customerExportCode: "C" }) === "B" && pickExportCode({ branchCode: null, customerExportCode: "C" }) === "C");
    check("5h saf: exportCodeForDestination yalnız EXPORT", exportCodeForDestination("DOMESTIC", { customerExportCode: "C" }) === null && exportCodeForDestination("EXPORT", { customerExportCode: "C" }) === "C");

    // 6) tek çözüm — iki belge render'ı ihracat kodunu yardımcıdan alır, elle `??` zinciri yok
    for (const f of ["shipment-dispatch.html.ts", "fason-direct-ship.html.ts"]) {
      // Yorumlar ayıklanır: açıklama metnindeki `branchCode ?? customerExportCode` kod değildir.
      const src = readFileSync(join(__dirname, "../src/services/document-render", f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      check(`6 ${f} pickExportCode'u çağırır, elle zincir yok`, src.includes("pickExportCode(") && !/branchCode\s*\?\?\s*\w*\.?(customerExportCode|exportCode)/.test(src));
    }

    // 3) fail-closed
    const e1 = await expectError(() => resolveShipmentDestination(prisma, { customerId: bos.id, branchId: subeYurtici.id }));
    check("3a başka carinin şubesi → 400", e1?.statusCode === 400, e1?.message ?? "hata yok");
    const e2 = await expectError(() => resolveShipmentDestination(prisma, { customerId: "00000000-0000-4000-8000-000000000000" }));
    check("3b olmayan cari → 404", e2?.statusCode === 404, e2?.message ?? "hata yok");

    // 4) bayrak kapalı + şube taşıyan sevkiyat → şubenin yönü (bayrak okunmaz)
    flagBefore = await prisma.systemSetting.findUnique({ where: { key: flagKey }, select: { value: true } });
    await prisma.systemSetting.upsert({ where: { key: flagKey }, create: { key: flagKey, value: false }, update: { value: false } });
    const flagNow = await readCustomerBranchesEnabled(prisma);
    if (flagNow !== false) {
      unmeasured("4 bayrak kapalıyken şube yönü", `bayrak kapalı okunamadı (okunan: ${String(flagNow)})`);
    } else {
      const r6 = await resolveShipmentDestination(prisma, { customerId: ihr.id, branchId: subeYurtici.id });
      check("4 branchesEnabled=false + branchId → BRANCH/DOMESTIC", r6.destination === "DOMESTIC" && r6.source === "BRANCH", JSON.stringify(r6));
    }
  } finally {
    if (flagBefore) {
      await prisma.systemSetting.update({ where: { key: flagKey }, data: { value: flagBefore.value as never } });
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: flagKey } });
    }
    await cleanupTestCustomers(createdIds);
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız, ${olculemedi} ölçülemedi ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 || olculemedi > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
