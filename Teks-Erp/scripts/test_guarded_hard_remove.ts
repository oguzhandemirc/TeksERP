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

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
