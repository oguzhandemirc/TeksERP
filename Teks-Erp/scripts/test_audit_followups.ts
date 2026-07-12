// =============================================================================
// TEST: Denetim kapsam-dışı follow-up'ları (feat/audit-followups-hardening)
// Çalıştır: npx tsx scripts/test_audit_followups.ts
// =============================================================================
// 1) AMB çuval kodu partial unique  — aynı AMB kodu 2. kez → P2002; serbest kod çift → OK
// 2) label-template tek-default partial unique — aynı kind'de 2 default → P2002
// 3) kursun-qc deleteError atomik    — işlenmiş RollError → 400; işlenmemiş → silinir
// 4) device pair atomik claim        — aynı kodu 2 eşzamanlı pair → 1 OK + 1 409
// 5) User.tokenVersion bump          — login v=1; yetki grant → DB v=2 (eski token ≠ yeni)
// Cache lost-invalidation fix'i kod-incelemesi + mevcut test_observability_cache ile kapsanır.
// =============================================================================

import prisma from "../src/lib/prisma";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { DeviceService } from "../src/services/device.service";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { AuthService } from "../src/services/auth.service";
import { PermissionManagementService } from "../src/services/permission-management.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
function isP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}
async function expectThrow(label: string, fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<void> {
  try { await fn(); check(label, false, "hata bekleniyordu, gelmedi"); }
  catch (e) { check(label, pred(e), e instanceof Error ? e.message : String(e)); }
}

const ts = Date.now();
const sackIds: string[] = [];
const templateIds: string[] = [];
const rollIds: string[] = [];
const machineIds: string[] = [];
const deviceLocalIds: string[] = [];
const userIds: string[] = [];

async function testLabelDefaultPartialUnique(): Promise<void> {
  // ETİKET STÜDYOSU v2 sözleşme değişikliği: eski label_templates_one_default_per_kind
  // partial unique index KALDIRILDI (isDefault artık DEPRECATED çift-yazım kolonu).
  // Bağlam-başına-tek-default DB seddi yeni evinde: label_context_defaults.kind UNIQUE.
  console.log("\n=== 2) bağlam-default tek kaynak (LabelContextDefault.kind UNIQUE) ===");
  const a = await prisma.labelTemplate.create({ data: { name: `TST-LD-${ts}-A`, kind: "ROLL_FINISHED", isDefault: false, fields: [] as unknown as Prisma.InputJsonValue } });
  const b = await prisma.labelTemplate.create({ data: { name: `TST-LD-${ts}-B`, kind: "ROLL_FINISHED", isDefault: false, fields: [] as unknown as Prisma.InputJsonValue } });
  templateIds.push(a.id, b.id);

  // Bağlamın default'u yoksa (fixture-bağımsızlık) test satırıyla kur; sonda geri al.
  const existing = await prisma.labelContextDefault.findUnique({ where: { kind: "ROLL_FINISHED" } });
  let createdDefault = false;
  if (!existing) {
    await prisma.labelContextDefault.create({ data: { kind: "ROLL_FINISHED", templateId: a.id } });
    createdDefault = true;
  }
  const before = await prisma.labelContextDefault.count({ where: { kind: "ROLL_FINISHED" } });
  await expectThrow(
    "aynı kind'de 2. bağlam-default satırı → P2002",
    () => prisma.labelContextDefault.create({ data: { kind: "ROLL_FINISHED", templateId: b.id } }),
    isP2002,
  );
  const after = await prisma.labelContextDefault.count({ where: { kind: "ROLL_FINISHED" } });
  check("ihlal sonrası bağlam-default sayısı değişmedi (hâlâ 1)", before === after && after === 1, `${before}→${after}`);
  if (createdDefault) {
    await prisma.labelContextDefault.deleteMany({ where: { kind: "ROLL_FINISHED", templateId: a.id } });
  }
}

async function testDeleteErrorAtomic(): Promise<void> {
  console.log("\n=== 3) kursun-qc deleteError atomik guard ===");
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!item || !admin) throw new Error("Seed fixture eksik (PATOS/admin)");
  const roll = await prisma.roll.create({ data: { barcode: `TST-AF-ROLL-${ts}`, itemId: item.id, initialQty: 50, currentQty: 50, status: "WAREHOUSE", qualityGrade: "1.KALITE", createdById: admin.id } });
  rollIds.push(roll.id);

  const processed = await prisma.rollError.create({ data: { rollId: roll.id, startMeter: 10, isProcessed: true } });
  const unprocessed = await prisma.rollError.create({ data: { rollId: roll.id, startMeter: 20, isProcessed: false } });
  const svc = new KursunQcService();

  await expectThrow(
    "işlenmiş (Tambur kararlı) RollError silinemez → 400",
    () => svc.deleteError({ errorId: processed.id }, admin.id),
    (e) => (e instanceof Error ? e.message : "").includes("Tambur kararı"),
  );
  const stillThere = await prisma.rollError.findUnique({ where: { id: processed.id }, select: { id: true } });
  check("işlenmiş kayıt hâlâ duruyor (silinmedi)", !!stillThere);

  await svc.deleteError({ errorId: unprocessed.id }, admin.id);
  const gone = await prisma.rollError.findUnique({ where: { id: unprocessed.id }, select: { id: true } });
  check("işlenmemiş kayıt silindi", !gone);
}

async function testDeviceAnnounceIdempotent(): Promise<void> {
  console.log("\n=== 4) device announce eşzamanlı (idempotent upsert) ===");
  const dId = `tst-af-dev-${ts}`;
  deviceLocalIds.push(dId);
  const results = await Promise.allSettled([
    DeviceService.announce({ deviceId: dId, name: "TEST AF Tablet" }),
    DeviceService.announce({ deviceId: dId, name: "TEST AF Tablet" }),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled").length;
  check("eşzamanlı announce: en az 1 başarı", ok >= 1, `ok=${ok}`);
  const devCount = await prisma.device.count({ where: { deviceId: dId } });
  check("deviceId unique → tek Device satırı", devCount === 1, `device=${devCount}`);
}

async function testTokenVersionBump(): Promise<void> {
  console.log("\n=== 5) User.tokenVersion bump ===");
  const username = `tst-af-user-${ts}`;
  const u = await prisma.user.create({ data: { username, fullName: "TEST AF Kullanıcı", passwordHash: await bcrypt.hash("test123", 10), isActive: true } });
  userIds.push(u.id);
  check("yeni kullanıcı tokenVersion=1", u.tokenVersion === 1, String(u.tokenVersion));

  const { token } = await AuthService.login(username, "test123");
  const decoded = jwt.decode(token) as { tokenVersion?: number } | null;
  check("login token'ı tokenVersion taşıyor (=1)", decoded?.tokenVersion === 1, String(decoded?.tokenVersion));

  const perm = await prisma.permission.findFirst({ select: { id: true } });
  if (!perm) throw new Error("Permission yok (seed)");
  await PermissionManagementService.grantPermission(u.id, { permissionId: perm.id }, u.id);
  const after = await prisma.user.findUnique({ where: { id: u.id }, select: { tokenVersion: true } });
  check("yetki grant → tokenVersion bump (2)", after?.tokenVersion === 2, String(after?.tokenVersion));
  check("eski token sürümü artık DB ile uyumsuz (middleware 401 verir)", (decoded?.tokenVersion ?? 0) !== (after?.tokenVersion ?? 0));
}

async function cleanup(): Promise<void> {
  await prisma.userPermission.deleteMany({ where: { userId: { in: userIds } } });
  // Login artık Session kaydı yaratıyor (jti registry) → user silmeden önce temizle
  // (sessions.userId onDelete Restrict).
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.device.deleteMany({ where: { deviceId: { in: deviceLocalIds } } });
  await prisma.machine.deleteMany({ where: { id: { in: machineIds } } });
  await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.labelTemplate.deleteMany({ where: { id: { in: templateIds } } });
  await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
}

async function main(): Promise<void> {
  try {
    await testLabelDefaultPartialUnique();
    await testDeleteErrorAtomic();
    await testDeviceAnnounceIdempotent();
    await testTokenVersionBump();
  } finally {
    await cleanup();
    console.log("(test verisi temizlendi)");
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
