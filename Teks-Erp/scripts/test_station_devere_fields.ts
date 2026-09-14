// =============================================================================
// İSTASYON/MAKİNE DEVERE ALANLARI — yazma yüzeyi AÇIK doğrulama (Faz 3 E2; H4 hükmü)
// =============================================================================
// NEDEN: `BaseController` modelinde her skaler kolon gövdeden yazılabilir (DMMF allowlist) — Faz 3
// panel `producesWarpBeam` / `consumesWarpBeam` / `warpBeamSlots` yazıyor. Yazılabilirlik BİLEREK
// açık, doğrulaması route'ta: yuva 0..32 tam sayı, yetenekler boolean. Salt-okunur (DB yok):
// middleware doğrudan çağrılır + dört uç middleware'i taşıyor mu statik ölçülür.
// NEGATİF SONDALAR (2026-09-15): `.max(32)` düşürüldü → §1c kırmızı · machineRouter.patch'ten
//   `validateMachineDevereFields` düşürüldü → §0b kırmızı.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { validateMachineDevereFields, validateStationDevereFields } from "../src/middlewares/devere-station-fields.middleware";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

function run(mw: (req: Request, res: Response, next: NextFunction) => void, body: unknown): { err: unknown; body: unknown } {
  const req = { body } as Request;
  let err: unknown = undefined;
  mw(req, {} as Response, ((e?: unknown) => { err = e; }) as NextFunction);
  return { err, body: req.body };
}
const zod = (r: { err: unknown }) => r.err instanceof ZodError;

console.log("=== İSTASYON/MAKİNE DEVERE ALANLARI ===\n── §0 Statik ──");
const routes = readFileSync(path.resolve(__dirname, "../src/routes/station.routes.ts"), "utf8");
check("§0a istasyon POST + PATCH `validateStationDevereFields` taşır", (routes.match(/router\.(post|patch)\([^\n]*validateStationDevereFields, stationController\.(create|update)\)/g) ?? []).length === 2);
check("§0b makine POST + PATCH `validateMachineDevereFields` taşır", (routes.match(/machineRouter\.(post|patch)\([^\n]*validateMachineDevereFields, machineController\.(create|update)\)/g) ?? []).length === 2);

console.log("\n── §1 Makine: warpBeamSlots ──");
check("§1a 2 → geçer, gövde korunur (diğer alanlar dokunulmaz)", !run(validateMachineDevereFields, { name: "T1", warpBeamSlots: 2 }).err && (run(validateMachineDevereFields, { name: "T1", warpBeamSlots: 2 }).body as { name: string }).name === "T1");
check("§1b 0 → geçer (cağlıklı çözgü makinesi meşru, §9.7h)", !run(validateMachineDevereFields, { warpBeamSlots: 0 }).err);
check("§1c ⭐ 33 → 400 (ZodError)", zod(run(validateMachineDevereFields, { warpBeamSlots: 33 })));
check("§1d −1 → 400", zod(run(validateMachineDevereFields, { warpBeamSlots: -1 })));
check("§1e 1.5 → 400 (tam sayı)", zod(run(validateMachineDevereFields, { warpBeamSlots: 1.5 })));
check("§1f \"2\" (metin) → 400 — panel sayı yollar, sessiz dönüşüm yok", zod(run(validateMachineDevereFields, { warpBeamSlots: "2" })));
check("§1g alan yoksa geçer (eski istemci BİREBİR)", !run(validateMachineDevereFields, { name: "T1" }).err);

console.log("\n── §2 İstasyon: producesWarpBeam / consumesWarpBeam ──");
check("§2a boolean ikili → geçer", !run(validateStationDevereFields, { name: "D", producesWarpBeam: true, consumesWarpBeam: false }).err);
check("§2b \"true\" (metin) → 400", zod(run(validateStationDevereFields, { consumesWarpBeam: "true" })));
check("§2c 1 (sayı) → 400", zod(run(validateStationDevereFields, { producesWarpBeam: 1 })));
check("§2d alan yoksa geçer", !run(validateStationDevereFields, { name: "D" }).err);
check("§2e gövde yoksa geçer (next çağrılır, patlamaz)", !run(validateStationDevereFields, undefined).err);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
