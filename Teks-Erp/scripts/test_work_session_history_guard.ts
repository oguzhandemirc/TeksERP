// =============================================================================
// Bekçi: çalışma oturumu geçmişi SİLİNMEZ — istasyon/makine kalıcı silmesini ENGELLER
// Çalıştır: npx tsx scripts/run-all-tests.ts work_session_history_guard
//
// Kural (docs/kurallar/defter.md, 2026-09-11): WorkSession iş verisidir ("kim, ne
// zaman, hangi istasyonda/makinede çalıştı"); audit 6 ayda arşivlendiği için yerini
// tutmaz. Guard kalır, silme gider: oturumu olan istasyon/makine pasife alınır.
//
//   A. Makine: oturumlu (üretimsiz, cihazsız) → önizleme engel + döküm, silme 409, satırlar yerinde
//   B. Makinesiz istasyon oturumu → istasyon silme 409, satır yerinde
//   C. Oturumlu makinesi olan istasyon → 409, makine + satır yerinde
//   D. Körlük zemini: oturumsuz makine silinebilir kalır (guard her şeyi kilitlemiyor)
//   E. AST: src/ altında workSession.delete/deleteMany ya da ham DELETE work_sessions YOK
// =============================================================================
import fs from "fs";
import path from "path";
import * as ts from "typescript";
import type { Request, Response, NextFunction } from "express";
import prisma from "../src/lib/prisma";
import {
  machineHardRemove,
  machineDeletePreview,
  stationHardRemove,
} from "../src/services/helpers/guarded-hard-remove";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

interface Captured {
  status: number;
  body: { success: boolean; data: unknown; message?: string };
}

/** `next(err)` status 0 olarak yakalanır: guard bozulup FK'ya (P2003) düşülse de bekçi özetine ulaşır. */
function invoke(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  id: string,
): Promise<Captured> {
  return new Promise((resolve) => {
    const res = {
      status: (code: number) => ({ json: (body: Captured["body"]) => resolve({ status: code, body }) }),
    } as unknown as Response;
    const req = { params: { id }, user: { userId: undefined } } as unknown as Request;
    const next = (err?: unknown) => resolve({ status: 0, body: { success: false, data: {}, message: String(err) } });
    void handler(req, res, next as NextFunction);
  });
}

interface PreviewData {
  deletable: boolean;
  workSessionCount: number;
  recentWorkSessions: { id: string; userName: string }[];
  peripheralsToDetach: { id: string }[];
  blockers: { key: string; count: number; message: string }[];
}

// ── E: statik tarama ─────────────────────────────────────────────────────────
function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** `<x>.workSession.delete(...)` / `.deleteMany(...)` çağrı siteleri (yorumlar AST'ye girmez). */
function sessionDeleteSites(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["delete", "deleteMany"].includes(node.expression.name.text) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === "workSession"
    ) {
      hits.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function staticScan(): void {
  const srcDir = path.resolve(__dirname, "../src");
  const files = tsFiles(srcDir);
  const callSites: string[] = [];
  const rawSites: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const rel = path.relative(path.resolve(__dirname, ".."), f);
    callSites.push(...sessionDeleteSites(rel, src));
    if (/DELETE\s+FROM\s+"?work_sessions"?/i.test(src)) rawSites.push(rel);
  }
  // Körlük zemini: tarama gerçekten guard dosyasını gördü mü?
  check(
    "E0. Tarama zemini: src/ taraması guarded-hard-remove.ts'i kapsıyor",
    files.some((f) => f.endsWith(path.join("helpers", "guarded-hard-remove.ts"))) && files.length > 100,
    `${files.length} dosya`,
  );
  check("E1. src/ altında workSession.delete/deleteMany çağrısı YOK", callSites.length === 0, callSites.join(", "));
  check("E2. src/ altında ham DELETE FROM work_sessions YOK", rawSites.length === 0, rawSites.join(", "));
}

async function main(): Promise<void> {
  staticScan();

  const suffix = Date.now().toString(36).toUpperCase();
  const user = await ensureTestAdmin();
  const userRow = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { fullName: true } });

  const stationIds: string[] = [];
  const machineIds: string[] = [];
  const deviceIds: string[] = [];
  const peripheralIds: string[] = [];
  const sessionIds: string[] = [];

  try {
    const stA = await prisma.station.create({
      data: { name: `TEST-WSH-IST-A-${suffix}`, code: `TST-WSHA-${suffix}`.slice(0, 32), type: "INTERNAL", kind: "PROCESS_QC", isActive: true },
    });
    stationIds.push(stA.id);
    const stB = await prisma.station.create({
      data: { name: `TEST-WSH-IST-B-${suffix}`, code: `TST-WSHB-${suffix}`.slice(0, 32), type: "INTERNAL", kind: "RAW_QC", isActive: true },
    });
    stationIds.push(stB.id);
    const mA = await prisma.machine.create({
      data: { stationId: stA.id, name: `TEST-WSH-MAK-A-${suffix}`, code: `TST-WSHMA-${suffix}`.slice(0, 32), isActive: true },
    });
    machineIds.push(mA.id);
    const device = await prisma.device.create({
      data: { deviceId: `TEST-WSH-DEV-${suffix}`.slice(0, 64), name: `TEST-WSH-TABLET-${suffix}` },
    });
    deviceIds.push(device.id);
    const periph = await prisma.peripheralDevice.create({
      data: {
        code: `TST-WSHP-${suffix}`.slice(0, 32),
        name: `TEST-WSH-DONANIM-${suffix}`,
        kind: "LABEL_PRINTER",
        connectionType: "NETWORK_TCP",
        machineId: mA.id,
      },
    });
    peripheralIds.push(periph.id);
    const ended = new Date();
    const sA = await prisma.workSession.create({
      data: { userId: user.id, deviceId: device.id, machineId: mA.id, stationId: stA.id, endedAt: ended, endReason: "LOGOUT" },
    });
    sessionIds.push(sA.id);
    const sB = await prisma.workSession.create({
      data: { userId: user.id, deviceId: device.id, machineId: null, stationId: stB.id, endedAt: ended, endReason: "LOGOUT" },
    });
    sessionIds.push(sB.id);

    // ── A. Oturumlu makine ──────────────────────────────────────────────────
    const pv = await invoke(machineDeletePreview, mA.id);
    const pvd = pv.body.data as PreviewData;
    const sessBlocker = pvd.blockers.find((b) => b.key === "workSessionCount");
    check("A1. Önizleme: oturumlu makine deletable=false", pv.status === 200 && pvd.deletable === false, JSON.stringify(pvd));
    check("A2. Önizleme: oturum ENGEL listesinde, sayı=1", sessBlocker?.count === 1 && pvd.workSessionCount === 1);
    check(
      "A3. Önizleme: engel mesajı pasife yönlendirir, 'temizlenecek' demez",
      !!sessBlocker && /pasife/i.test(sessBlocker.message) && !/temizlen/i.test(sessBlocker.message),
      sessBlocker?.message,
    );
    check(
      "A4. Önizleme: oturum dökümü kayıt kayıt (id + kullanıcı adı)",
      pvd.recentWorkSessions.length === 1 &&
        pvd.recentWorkSessions[0].id === sA.id &&
        pvd.recentWorkSessions[0].userName === userRow.fullName,
    );
    check("A5. Önizleme: boşa çıkacak donanım adıyla listede", pvd.peripheralsToDetach.some((p) => p.id === periph.id));

    const rA = await invoke(machineHardRemove, mA.id);
    check(
      "A6. Makine kalıcı silme → 409 + workSessionCount=1",
      rA.status === 409 && (rA.body.data as { workSessionCount?: number }).workSessionCount === 1,
      `${rA.status} ${rA.body.message ?? ""}`,
    );
    check("A7. Oturum satırı YERİNDE", (await prisma.workSession.count({ where: { id: sA.id } })) === 1);
    check("A8. Makine YERİNDE", (await prisma.machine.count({ where: { id: mA.id } })) === 1);
    const periphAfter = await prisma.peripheralDevice.findUnique({ where: { id: periph.id }, select: { machineId: true } });
    check("A9. Reddedilen silmede donanım çözülmedi (tx hiç koşmadı)", periphAfter?.machineId === mA.id);

    // ── B. Makinesiz istasyon oturumu ───────────────────────────────────────
    const rB = await invoke(stationHardRemove, stB.id);
    check(
      "B1. Makinesiz oturumlu istasyon → 409 + workSessionCount=1",
      rB.status === 409 && (rB.body.data as { workSessionCount?: number }).workSessionCount === 1,
      `${rB.status} ${rB.body.message ?? ""}`,
    );
    check("B2. B mesajı pasife yönlendirir", /pasife/i.test(rB.body.message ?? ""));
    check("B3. İstasyon + oturum satırı YERİNDE",
      (await prisma.station.count({ where: { id: stB.id } })) === 1 &&
        (await prisma.workSession.count({ where: { id: sB.id } })) === 1);

    // ── C. Oturumlu makinesi olan istasyon ──────────────────────────────────
    const rC = await invoke(stationHardRemove, stA.id);
    check(
      "C1. Oturumlu makineli istasyon → 409 + workSessionCount=1",
      rC.status === 409 && (rC.body.data as { workSessionCount?: number }).workSessionCount === 1,
      `${rC.status} ${rC.body.message ?? ""}`,
    );
    check("C2. İstasyon + makine + oturum YERİNDE",
      (await prisma.station.count({ where: { id: stA.id } })) === 1 &&
        (await prisma.machine.count({ where: { id: mA.id } })) === 1 &&
        (await prisma.workSession.count({ where: { id: sA.id } })) === 1);

    // ── D. Körlük zemini: oturumsuz makine silinebilir ──────────────────────
    // Kendi istasyonunda: A–C bozulup istasyonları silse de D koşar ve özet basılır.
    const stD = await prisma.station.create({
      data: { name: `TEST-WSH-IST-D-${suffix}`, code: `TST-WSHD-${suffix}`.slice(0, 32), type: "INTERNAL", kind: "RAW_QC", isActive: true },
    });
    stationIds.push(stD.id);
    const mD = await prisma.machine.create({
      data: { stationId: stD.id, name: `TEST-WSH-MAK-D-${suffix}`, code: `TST-WSHMD-${suffix}`.slice(0, 32), isActive: true },
    });
    machineIds.push(mD.id);
    const pvD = await invoke(machineDeletePreview, mD.id);
    const pvDd = pvD.body.data as PreviewData;
    check(
      "D1. Oturumsuz makine önizlemesi deletable=true, döküm boş",
      pvDd.deletable === true && pvDd.workSessionCount === 0 && pvDd.recentWorkSessions.length === 0,
      JSON.stringify(pvDd),
    );
    const rD = await invoke(machineHardRemove, mD.id);
    check("D2. Oturumsuz makine → 200 kalıcı silindi", rD.status === 200 && (await prisma.machine.count({ where: { id: mD.id } })) === 0);
  } finally {
    await prisma.workSession.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.peripheralDevice.deleteMany({ where: { id: { in: peripheralIds } } });
    await prisma.machine.deleteMany({ where: { id: { in: machineIds } } });
    await prisma.device.deleteMany({ where: { id: { in: deviceIds } } });
    await prisma.station.deleteMany({ where: { id: { in: stationIds } } });
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
