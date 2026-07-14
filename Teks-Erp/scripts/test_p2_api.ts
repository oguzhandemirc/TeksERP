// =============================================================================
// P2 api-misc bucket testi — F221 (istasyon-türü izin enforcement) + F59 (WO
// width null yazımı).  Koşum:
//   DATABASE_URL="...adnansahin_p2_test..." npx tsx scripts/test_p2_api.ts
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkSessionService } from "../src/services/work-session.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { AuthService } from "../src/services/auth.service";
import { AppError } from "../src/utils/app-error";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectForbidden(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; }
  catch (e) { return e instanceof AppError && e.statusCode === 403; }
}

async function main(): Promise<void> {
  const ts = Date.now();
  const created: { users: string[]; devices: string[]; wos: string[] } = { users: [], devices: [], wos: [] };

  try {
    // --- F221: RAW_QC (KK1) makinesinde oturum izin enforcement ---
    const rawqcMachine = await prisma.machine.findFirst({
      where: { isActive: true, station: { kind: "RAW_QC", isActive: true } },
      select: { id: true, stationId: true },
    });
    if (!rawqcMachine) throw new Error("RAW_QC makinesi seed'de yok");

    const user = await prisma.user.create({
      data: { username: `TEST-op-${ts}`, passwordHash: await AuthService.hashPassword("test123"), fullName: "TEST Operatör" },
      select: { id: true },
    });
    created.users.push(user.id);
    const mkDevice = async (n: number) => {
      const d = await prisma.device.create({
        data: { deviceId: `TEST-dev-${ts}-${n}`, name: `TEST Tablet ${n}` },
        select: { id: true },
      });
      created.devices.push(d.id);
      return d.id;
    };
    const dev1 = await mkDevice(1), dev2 = await mkDevice(2), dev3 = await mkDevice(3);

    // Doğru izinle (mobile:kk1) → açılır.
    const ok = await WorkSessionService.open({
      userId: user.id, deviceRowId: dev1, machineId: rawqcMachine.id, permissions: ["mobile:kk1"],
    });
    check("F221: mobile:kk1 izniyle RAW_QC oturumu açıldı", !!(ok.data as { id: string }).id);
    await WorkSessionService.closeForDevice(dev1);

    // Yanlış türden izinle (mobile:tambur, kk1 YOK) → 403.
    const denied = await expectForbidden(() =>
      WorkSessionService.open({
        userId: user.id, deviceRowId: dev2, machineId: rawqcMachine.id, permissions: ["mobile:tambur"],
      }),
    );
    check("F221: yalnız mobile:tambur izinli kullanıcı RAW_QC açamaz (403)", denied);

    // mobile:* wildcard → açılır (matchesPermission domain wildcard).
    const wild = await WorkSessionService.open({
      userId: user.id, deviceRowId: dev3, machineId: rawqcMachine.id, permissions: ["mobile:*"],
    });
    check("F221: mobile:* wildcard ile açılır", !!(wild.data as { id: string }).id);
    await WorkSessionService.closeForDevice(dev3);

    // permissions OMIT → güvenilen dahili çağrı, enforcement atlanır.
    const trusted = await WorkSessionService.open({
      userId: user.id, deviceRowId: dev1, machineId: rawqcMachine.id,
    });
    check("F221: permissions verilmezse enforcement atlanır (dahili çağrı)", !!(trusted.data as { id: string }).id);
    await WorkSessionService.closeForDevice(dev1);

    // --- F59: WO width null yazımı (?? undefined null'ı yutuyordu) ---
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-WO-${ts}`, width: 150 },
      select: { id: true, width: true },
    });
    created.wos.push(wo.id);
    check("F59: WO width=150 ile oluştu", Number(wo.width) === 150);

    const svc = new WorkOrderService();
    await svc.update(wo.id, { width: null });
    const after = await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { width: true } });
    check("F59: update({width:null}) width'i NULL yazdı (yutmadı)", after?.width === null,
      `width=${after?.width}`);

    // targetQuantity null yazımı da (kilit guard'ı yok, düz yazım).
    await prisma.workOrder.update({ where: { id: wo.id }, data: { targetQuantity: 500 } });
    await svc.update(wo.id, { targetQuantity: null });
    const after2 = await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { targetQuantity: true } });
    check("F59: update({targetQuantity:null}) NULL yazdı", after2?.targetQuantity === null);
  } finally {
    await prisma.workSession.deleteMany({ where: { deviceId: { in: created.devices } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: created.wos } } }).catch(() => {});
    await prisma.device.deleteMany({ where: { id: { in: created.devices } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { userId: { in: created.users } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: created.users } } }).catch(() => {});
  }
}

main()
  .then(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("HATA:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
