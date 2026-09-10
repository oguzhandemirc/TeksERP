// =============================================================================
// Test: guarded-hard-remove helper (K3 refactor doğrulaması)
// Çalıştır: npx tsx scripts/test_guarded_hard_remove.ts
// Doğrulananlar:
//   1. 404 — olmayan kayıt
//   2. 409 — bağımlılık guard'ı (rotadan üretilmiş WO varsa rota silinemez)
//   3. 200 — temiz kayıt kalıcı silinir (adımlar dahil), audit düşer
// =============================================================================
import prisma from "../src/lib/prisma";
import {
  routeHardRemove,
  stationHardRemove,
  machineHardRemove,
  machineDeletePreview,
} from "../src/services/helpers/guarded-hard-remove";
import type { Request, Response, NextFunction } from "express";

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

interface Captured {
  status: number;
  body: { success: boolean; data: unknown; message: string };
}

async function invoke(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  id: string
): Promise<Captured> {
  return new Promise((resolve, reject) => {
    const res = {
      status(code: number) {
        return {
          json(body: Captured["body"]) {
            resolve({ status: code, body });
          },
        };
      },
    } as unknown as Response;
    const req = { params: { id }, user: { userId: undefined } } as unknown as Request;
    const next = (err?: unknown) => reject(err ?? new Error("next() çağrıldı"));
    void handler(req, res, next as NextFunction);
  });
}

async function main() {
  const suffix = Date.now().toString(36);

  // --- 1) 404: olmayan kayıt ---
  const r404 = await invoke(routeHardRemove, "00000000-0000-0000-0000-000000000000");
  check("Olmayan rota → 404", r404.status === 404);

  // --- Fixture: temiz rota + adımsız istasyon ---
  const station = await prisma.station.create({
    data: {
      name: `TEST-GHR-IST-${suffix}`,
      code: `TEST-GHR-${suffix}`.toUpperCase().slice(0, 32),
      type: "INTERNAL",
      kind: "RAW_QC",
      isActive: true,
    },
  });
  const route = await prisma.route.create({
    data: {
      name: `TEST-GHR-ROTA-${suffix}`,
      isActive: true,
      steps: { create: [{ stationId: station.id, sequence: 1 }] },
    },
  });

  try {
    // --- 2) 409: istasyon rota adımında kullanılıyor → station silinemez ---
    const r409 = await invoke(stationHardRemove, station.id);
    check(
      "Rota adımındaki istasyon → 409 + somut sayı",
      r409.status === 409 &&
        (r409.body.data as { routeStepCount?: number }).routeStepCount === 1,
      r409.body.message
    );

    // --- 3) 200: temiz rota silinir (adımlar dahil) ---
    const r200 = await invoke(routeHardRemove, route.id);
    check("Temiz rota → 200 kalıcı silindi", r200.status === 200, r200.body.message);
    const routeGone = await prisma.route.findUnique({ where: { id: route.id } });
    const stepsGone = await prisma.routeStep.count({ where: { routeId: route.id } });
    check("Rota DB'den gitti", routeGone === null);
    check("Rota adımları da gitti", stepsGone === 0);

    // --- 4) Artık serbest kalan istasyon silinir ---
    const r200b = await invoke(stationHardRemove, station.id);
    check("Serbest istasyon → 200 kalıcı silindi", r200b.status === 200);
    const stGone = await prisma.station.findUnique({ where: { id: station.id } });
    check("İstasyon DB'den gitti", stGone === null);

    // --- 5) Audit izi düştü ---
    const audit = await prisma.systemLog.count({
      where: { tableName: "ROUTE", recordId: route.id, action: "DELETE" },
    });
    check("Audit DELETE kaydı düştü", audit >= 1);
  } finally {
    // Cleanup — silinmemiş fixture kaldıysa temizle
    await prisma.routeStep.deleteMany({ where: { routeId: route.id } });
    await prisma.route.deleteMany({ where: { id: route.id } });
    await prisma.machine.deleteMany({ where: { stationId: station.id } });
    await prisma.station.deleteMany({ where: { id: station.id } });
  }

  // ---------------------------------------------------------------------------
  // Machine hard-delete guard (yanlışlıkla makine olarak eklenmiş donanım senaryosu)
  // ---------------------------------------------------------------------------
  const mStation = await prisma.station.create({
    data: {
      name: `TEST-GHR-MST-${suffix}`,
      code: `TEST-GHR-M-${suffix}`.toUpperCase().slice(0, 32),
      type: "INTERNAL",
      kind: "PROCESS_QC",
      isActive: true,
    },
  });
  const machine = await prisma.machine.create({
    data: {
      stationId: mStation.id,
      name: `TEST-GHR-MAK-${suffix}`,
      code: `TEST-GHR-MK-${suffix}`.toUpperCase().slice(0, 32),
      isActive: true,
    },
  });
  const peripheral = await prisma.peripheralDevice.create({
    data: {
      code: `TEST-GHR-PER-${suffix}`.toUpperCase().slice(0, 32),
      name: `TEST-GHR-DONANIM-${suffix}`,
      kind: "LABEL_PRINTER",
      connectionType: "NETWORK_TCP",
      machineId: machine.id,
    },
  });
  // Oturum geçmişi silmeyi ENGELLER — o senaryo test_work_session_history_guard.ts'te;
  // burada oturumsuz makine: cihaz eşleşmesi engeli + donanım detach.
  const device = await prisma.device.create({
    data: { deviceId: `TEST-GHR-DEV-${suffix}`.slice(0, 64), name: `TEST-GHR-TABLET-${suffix}` },
  });

  try {
    // --- 6) 404: olmayan makine ---
    const m404 = await invoke(machineHardRemove, "00000000-0000-0000-0000-000000000000");
    check("Olmayan makine → 404", m404.status === 404);

    // --- 7) 409: makineye ATANMIŞ tablet (cihaz) var → silinemez (eşleşme engeli) ---
    // Yeni politika: DONANIM (peripheral) bloklamaz, silmede detach edilir. Gerçek
    // engel = üretim izi veya atanmış cihaz. Fixture device'ını makineye bağla.
    await prisma.device.update({ where: { id: device.id }, data: { machineId: machine.id } });
    const m409 = await invoke(machineHardRemove, machine.id);
    check(
      "Atanmış tabletli makine → 409 + somut sayı",
      m409.status === 409 && (m409.body.data as { deviceCount?: number }).deviceCount === 1,
      m409.body.message
    );

    // --- 8) Preview: cihaz atanmışken deletable=false + device blocker; DONANIM detach (blocker DEĞİL) ---
    const pv1 = await invoke(machineDeletePreview, machine.id);
    const pv1d = pv1.body.data as {
      deletable: boolean;
      blockers: { key: string }[];
      peripheralDetachCount: number;
    };
    check(
      "Preview (cihaz atanmış) → deletable=false + device blocker + donanım detach",
      pv1.status === 200 &&
        pv1d.deletable === false &&
        pv1d.blockers.some((b) => b.key === "deviceCount") &&
        !pv1d.blockers.some((b) => b.key === "peripheralCount") &&
        pv1d.peripheralDetachCount === 1
    );

    // --- 9) Cihaz ataması kalkınca → donanım ENGELLEMEZ → preview deletable=true ---
    await prisma.device.update({ where: { id: device.id }, data: { machineId: null } });
    const pv2 = await invoke(machineDeletePreview, machine.id);
    const pv2d = pv2.body.data as {
      deletable: boolean;
      workSessionCount: number;
      peripheralDetachCount: number;
      peripheralsToDetach: { id: string }[];
    };
    check(
      "Preview (donanımlı, cihazsız, oturumsuz) → deletable=true + donanım detach=1 (kayıt kayıt)",
      pv2.status === 200 &&
        pv2d.deletable === true &&
        pv2d.workSessionCount === 0 &&
        pv2d.peripheralDetachCount === 1 &&
        pv2d.peripheralsToDetach.length === 1 &&
        pv2d.peripheralsToDetach[0].id === peripheral.id,
      JSON.stringify(pv2d)
    );

    // --- 10) Donanım ENGELLEMİYOR → 200 kalıcı silindi; donanım DETACH (silinmez) ---
    const m200 = await invoke(machineHardRemove, machine.id);
    check("Donanımlı makine → 200 kalıcı silindi", m200.status === 200, m200.body.message);
    const machineGone = await prisma.machine.findUnique({ where: { id: machine.id } });
    check("Makine DB'den gitti", machineGone === null);
    // Donanım SİLİNMEZ, machineId=null'a çekilir (boşa çıkar, ayarı korunur → başka makineye atanabilir).
    const peripheralAfter = await prisma.peripheralDevice.findUnique({ where: { id: peripheral.id } });
    check(
      "Donanım silinmedi, machineId=null (detach)",
      peripheralAfter !== null && peripheralAfter.machineId === null
    );

    const mAudit = await prisma.systemLog.count({
      where: { tableName: "MACHINE", recordId: machine.id, action: "DELETE" },
    });
    check("Makine audit DELETE kaydı düştü", mAudit >= 1);
  } finally {
    await prisma.peripheralDevice.deleteMany({ where: { id: peripheral.id } });
    await prisma.machine.deleteMany({ where: { id: machine.id } });
    await prisma.device.deleteMany({ where: { id: device.id } });
    await prisma.station.deleteMany({ where: { id: mStation.id } });
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
