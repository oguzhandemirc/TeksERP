// =============================================================================
// Vardiya tanımı yazma yüzeyi bekçisi — `routes/shift-definition.routes.ts` + servis
// =============================================================================
// Koşum: npx tsx scripts/test_shift_definition_surface.ts   (DB'li; kendi fikstürü, TEST-SD öneki)
//
// Ölçer:
//   §0 statik — router kapıları (verifyToken → requireDokumaEnabled → loom:spec-manage);
//      gövde `.strict()`; `ShiftInstance`e TEK yazar job (servis/route takvim yazmaz)
//   §1 doğuş — tanım + takvim AYNI istekte (yalnız gelecek pencereler), audit satırı
//   §2 doğrulama — kod/ad mükerreri 409 (adla, arşivdekini söyler), pencere 400, kod değişmez
//   §3 güncelleme — başlamamış pencereler yeni kurala çekilir, satır silinmez
//   §4 arşiv ↔ geri al — durum geçişi claim'li; gelecek pencere iptal, geri alınca diriliş;
//      arşivdeki tanım düzenlenemez
//   §5 önizleme — job'un planı; YAZMAZ
//   §6 çakışma — engel değil uyarı
//
// NEGATİF SONDALAR (kırmızı görülerek, 2026-10-10):
//   · servisten takvim tetiklemesi (`triggerCalendar`) boşa çıkarılınca §1b/§5b ❌
//   · güncelleme claim'inden `isActive: true` düşürülünce §4d/§4e ❌
//   · ad ön kapısı (`assertNameFree`) düşürülünce §2b/§4e ❌ (ham P2002, kodsuz)
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import {
  createShiftDefinition,
  previewShiftDefinition,
  setShiftDefinitionActive,
  updateShiftDefinition,
} from "../src/services/shift-definition.service";
import { shiftDefinitionCreateSchema, shiftDefinitionUpdateSchema } from "../src/routes/shift-definition.routes";
import { SHIFT_CALENDAR_CANCEL_REASON, SHIFT_CALENDAR_DAYS_AHEAD } from "../src/services/helpers/shift-calendar-plan.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const FLAG_KEY = "dokuma.enabled";
let originalFlag: unknown = undefined;
let flagTouched = false;
const ek = Date.now().toString(36).slice(-5).toUpperCase();
const defIds: string[] = [];

async function expectError(fn: () => Promise<unknown>, status: number, code?: string): Promise<{ ok: boolean; got: string }> {
  try {
    await fn();
    return { ok: false, got: "hata yok" };
  } catch (e) {
    if (!(e instanceof AppError)) return { ok: false, got: String(e) };
    const c = (e.details as { code?: string } | undefined)?.code;
    return { ok: e.statusCode === status && (code === undefined || c === code), got: `${e.statusCode} ${c ?? "-"} ${e.message}` };
  }
}

async function main(): Promise<void> {
  console.log("\n=== Vardiya tanımı yazma yüzeyi ===\n");

  // ── §0 statik ─────────────────────────────────────────────────────────────
  const routeSrc = readFileSync(join(__dirname, "../src/routes/shift-definition.routes.ts"), "utf8");
  check("§0a router toplu kapı: verifyToken → requireDokumaEnabled", /router\.use\(verifyToken,\s*requireDokumaEnabled\)/.test(routeSrc));
  check("§0b yazma uçları `loom:spec-manage`", /const manage = requirePermission\("loom:spec-manage"\)/.test(routeSrc)
    && (routeSrc.match(/router\.(post|patch)\("[^"]*",\s*manage,/g) ?? []).length === 5);
  check("§0c gövde şemaları `.strict()` (tanınmayan alan 400)", (routeSrc.match(/\.strict\(\)/g) ?? []).length >= 3);
  const yazanlar = [] as string[];
  const kok = join(__dirname, "../src");
  for (const f of ["services/shift-definition.service.ts", "routes/shift-definition.routes.ts", "services/helpers/shift-calendar-plan.helper.ts"]) {
    if (/\.shiftInstance\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(readFileSync(join(kok, f), "utf8"))) yazanlar.push(f);
  }
  check("§0d `ShiftInstance`e tek yazar job — tanım yüzeyi takvim YAZMAZ, job'u çağırır", yazanlar.length === 0, yazanlar.join(", "));

  if (!flagTouched) {
    const row = await prisma.systemSetting.findUnique({ where: { key: FLAG_KEY } });
    originalFlag = row ? row.value : undefined;
    flagTouched = true;
  }
  await prisma.systemSetting.upsert({ where: { key: FLAG_KEY }, create: { key: FLAG_KEY, value: true }, update: { value: true } });

  // ── §1 doğuş ──────────────────────────────────────────────────────────────
  const t0 = new Date();
  const body = shiftDefinitionCreateSchema.parse({ code: `a${ek}`.slice(0, 8), name: `TEST-SD Gündüz ${ek}`, startMinute: 8 * 60, durationMinutes: 8 * 60, plannedBreakMinutes: 30 });
  check("§1a kod büyük harfe çekilir", body.code === `A${ek}`.slice(0, 8), body.code);
  const c1 = await createShiftDefinition(body);
  const def = c1.data.definition;
  defIds.push(def.id);
  const pencereler = await prisma.shiftInstance.findMany({ where: { shiftDefinitionId: def.id } });
  const cal = c1.data.calendar;
  check("§1b takvim AYNI istekte doğdu (29–30 pencere, hepsi gelecekte)", cal !== null && cal !== "disabled"
    && cal.created === pencereler.length && pencereler.length >= SHIFT_CALENDAR_DAYS_AHEAD - 1 && pencereler.every((w) => w.startsAt > t0),
    JSON.stringify(cal));
  const audit = await prisma.systemLog.count({ where: { tableName: "SHIFT_DEFINITION", recordId: def.id, action: "CREATE" } });
  check("§1c audit satırı (SHIFT_DEFINITION CREATE)", audit === 1, String(audit));

  // ── §2 doğrulama ──────────────────────────────────────────────────────────
  const e1 = await expectError(() => createShiftDefinition({ ...body, name: `TEST-SD başka ${ek}` }), 409, "SHIFT_CODE_TAKEN");
  check("§2a aynı kod 409 SHIFT_CODE_TAKEN", e1.ok, e1.got);
  const e2 = await expectError(() => createShiftDefinition({ ...body, code: `B${ek}`.slice(0, 8), name: `test-sd gündüz ${ek.toLowerCase()}` }), 409, "SHIFT_NAME_TAKEN");
  check("§2b aynı ad (katlanmış) 409 SHIFT_NAME_TAKEN", e2.ok, e2.got);
  const e3 = await expectError(() => createShiftDefinition({ ...body, code: `C${ek}`.slice(0, 8), name: `TEST-SD mola ${ek}`, plannedBreakMinutes: 8 * 60 }), 400);
  check("§2c mola ≥ süre 400", e3.ok, e3.got);
  check("§2d başlangıç 1440 şemada 400", !shiftDefinitionCreateSchema.safeParse({ ...body, startMinute: 1440 }).success);
  check("§2e güncellemede `code` ve `isActive` YAZILAMAZ (strict)", !shiftDefinitionUpdateSchema.safeParse({ code: "Z" }).success
    && !shiftDefinitionUpdateSchema.safeParse({ isActive: false }).success);
  check("§2f yedi gün = boş dizi (her gün) normalize", (await updateShiftDefinition(def.id, { activeWeekdays: [6, 5, 4, 3, 2, 1, 0] })).data.definition.activeWeekdays.length === 0);

  // ── §3 güncelleme ─────────────────────────────────────────────────────────
  const u = await updateShiftDefinition(def.id, { durationMinutes: 9 * 60 });
  const ucal = u.data.calendar;
  const sonra = await prisma.shiftInstance.findMany({ where: { shiftDefinitionId: def.id } });
  check("§3a başlamamış pencereler yeni süreyle (9 sa), satır sayısı aynı", pencereler.length > 0 && ucal !== null && ucal !== "disabled" && ucal.rewritten === pencereler.length
    && sonra.length === pencereler.length && sonra.every((w) => w.endsAt.getTime() - w.startsAt.getTime() === 9 * 3600_000), JSON.stringify(ucal));

  // ── §5 önizleme (arşivden önce) ───────────────────────────────────────────
  const oncekiDamga = (await prisma.shiftDefinition.findUniqueOrThrow({ where: { id: def.id } })).updatedAt.getTime();
  const pv = await previewShiftDefinition(def.id, { active: false });
  check("§5a arşiv önizlemesi her gelecek pencereyi listeler (iptal edilecek)", pv.data.retire.length === sonra.length && pv.data.retire.every((w) => w.id),
    `${pv.data.retire.length}/${sonra.length}`);
  const pv2 = await previewShiftDefinition(def.id, { startMinute: 7 * 60 });
  check("§5b saat önizlemesi eski → yeni saatle", pv2.data.rewrite.length === sonra.length && !!pv2.data.rewrite[0]?.to);
  const pv3 = await previewShiftDefinition(null, { startMinute: 22 * 60, durationMinutes: 8 * 60 });
  check("§5c yeni tanım önizlemesi doğacak pencereleri listeler", pv3.data.create.length >= SHIFT_CALENDAR_DAYS_AHEAD - 1);
  const sonrakiDamga = (await prisma.shiftDefinition.findUniqueOrThrow({ where: { id: def.id } })).updatedAt.getTime();
  const hala = await prisma.shiftInstance.count({ where: { shiftDefinitionId: def.id, isCancelled: false } });
  check("§5d önizleme YAZMAZ", oncekiDamga === sonrakiDamga && hala === sonra.length);

  // ── §4 arşiv ↔ geri al ────────────────────────────────────────────────────
  const a = await setShiftDefinitionActive(def.id, false);
  const acal = a.data.calendar;
  const iptal = await prisma.shiftInstance.count({ where: { shiftDefinitionId: def.id, isCancelled: true, cancelReason: SHIFT_CALENDAR_CANCEL_REASON } });
  check("§4a arşiv = isActive false", a.data.definition.isActive === false);
  check("§4b gelecek pencereler takvim sebebiyle İPTAL, satır silinmez", acal !== null && acal !== "disabled" && acal.retired === sonra.length
    && iptal === sonra.length && (await prisma.shiftInstance.count({ where: { shiftDefinitionId: def.id } })) === sonra.length, JSON.stringify(acal));
  const e4 = await expectError(() => setShiftDefinitionActive(def.id, false), 409, "SHIFT_DEFINITION_ARCHIVED");
  check("§4c ikinci arşiv 409 (claim)", e4.ok, e4.got);
  const e5 = await expectError(() => updateShiftDefinition(def.id, { name: `TEST-SD arşivde ${ek}` }), 409, "SHIFT_DEFINITION_ARCHIVED");
  check("§4d arşivdeki tanım düzenlenemez 409", e5.ok, e5.got);
  const e6 = await expectError(() => createShiftDefinition({ ...body, code: `D${ek}`.slice(0, 8) }), 409, "SHIFT_NAME_TAKEN");
  check("§4e arşivdeki adla yeni tanım 409 — 'geri alın' der", e6.ok && /ARŞİVDE/.test(e6.got), e6.got);
  const r = await setShiftDefinitionActive(def.id, true);
  const acik = await prisma.shiftInstance.count({ where: { shiftDefinitionId: def.id, isCancelled: false } });
  check("§4f geri al → aynı satırlar DİRİLİR", r.data.definition.isActive && acik === sonra.length, `${acik}/${sonra.length}`);
  const e7 = await expectError(() => setShiftDefinitionActive(def.id, true), 409, "SHIFT_DEFINITION_ACTIVE");
  check("§4g ikinci geri al 409", e7.ok, e7.got);

  // ── §6 çakışma uyarısı ────────────────────────────────────────────────────
  const c2 = await createShiftDefinition(shiftDefinitionCreateSchema.parse({ code: `E${ek}`.slice(0, 8), name: `TEST-SD Ek ${ek}`, startMinute: 15 * 60, durationMinutes: 3 * 60 }));
  defIds.push(c2.data.definition.id);
  check("§6a çakışan tanım YAZILIR ama uyarı taşır (adıyla)", (c2.warnings ?? []).some((w) => w.includes(def.code)), JSON.stringify(c2.warnings));
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (defIds.length) {
        await prisma.shiftInstance.deleteMany({ where: { shiftDefinitionId: { in: defIds } } });
        await prisma.shiftDefinition.deleteMany({ where: { id: { in: defIds } } });
      }
      if (flagTouched) {
        if (originalFlag === undefined) await prisma.systemSetting.deleteMany({ where: { key: FLAG_KEY } });
        else await prisma.systemSetting.update({ where: { key: FLAG_KEY }, data: { value: originalFlag as Prisma.InputJsonValue } });
      }
    } catch (e) {
      console.error("temizlik hatası:", e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
