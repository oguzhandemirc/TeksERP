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
const codes: string[] = [];
const deviceLocalIds: string[] = [];
const userIds: string[] = [];

async function testAmbPartialUnique(): Promise<void> {
  console.log("\n=== 1) AMB çuval kodu partial unique ===");
  const amb = `AMB${String(90000 + (ts % 9000)).padStart(5, "0")}`; // ^AMB[0-9]{5}$
  const s1 = await prisma.sack.create({ data: { sackNo: `TST-AF-${ts}-1`, manualCode: amb } });
  sackIds.push(s1.id);
  await expectThrow(
    "aynı AMB kodu 2. çuvalda → P2002 (partial unique)",
    async () => {
      const s = await prisma.sack.create({ data: { sackNo: `TST-AF-${ts}-2`, manualCode: amb } });
      sackIds.push(s.id);
    },
    isP2002,
  );
  // Serbest (AMB-dışı) kod desene uymaz → çift olabilir (kasıtlı non-unique).
  const free = `TST-FREE-${ts}`;
  const f1 = await prisma.sack.create({ data: { sackNo: `TST-AF-${ts}-3`, manualCode: free } });
  const f2 = await prisma.sack.create({ data: { sackNo: `TST-AF-${ts}-4`, manualCode: free } });
  sackIds.push(f1.id, f2.id);
  check("serbest format kod çift olabilir (partial kapsam dışı)", true, free);
}

async function testLabelDefaultPartialUnique(): Promise<void> {
  console.log("\n=== 2) label-template tek-default partial unique ===");
  const a = await prisma.labelTemplate.create({ data: { name: `TST-LD-${ts}-A`, kind: "ROLL_FINISHED", isDefault: false, fields: [] as unknown as Prisma.InputJsonValue } });
  const b = await prisma.labelTemplate.create({ data: { name: `TST-LD-${ts}-B`, kind: "ROLL_FINISHED", isDefault: false, fields: [] as unknown as Prisma.InputJsonValue } });
  templateIds.push(a.id, b.id);
  const before = await prisma.labelTemplate.count({ where: { kind: "ROLL_FINISHED", isDefault: true } });
  // ROLL_FINISHED'in zaten 1 default'u var (seed). Test satırını da default yapmaya
  // çalışmak ikinci default demek → partial unique reddeder (ORM → temiz P2002).
  await expectThrow(
    "aynı kind'de 2. default → P2002",
    () => prisma.labelTemplate.update({ where: { id: b.id }, data: { isDefault: true } }),
    isP2002,
  );
  const after = await prisma.labelTemplate.count({ where: { kind: "ROLL_FINISHED", isDefault: true } });
  check("ihlal sonrası ROLL_FINISHED default sayısı değişmedi (hâlâ 1)", before === after && after === 1, `${before}→${after}`);
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

async function testDevicePairAtomic(): Promise<void> {
  console.log("\n=== 4) device pair atomik claim (eşzamanlı) ===");
  const station = await prisma.station.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!station) throw new Error("İstasyon yok (seed)");
  const machine = await prisma.machine.create({ data: { stationId: station.id, code: `TST-AF-M-${ts}`, name: "TEST AF MAKİNE" }, select: { id: true } });
  machineIds.push(machine.id);
  const pc = await DeviceService.createPairingCode({ machineId: machine.id, deviceName: "TEST AF Tablet" });
  codes.push(pc.code);
  const d1 = `tst-af-dev-${ts}-1`, d2 = `tst-af-dev-${ts}-2`;
  deviceLocalIds.push(d1, d2);

  const results = await Promise.allSettled([
    DeviceService.pair({ deviceId: d1, code: pc.code }),
    DeviceService.pair({ deviceId: d2, code: pc.code }),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const rej = results.filter((r) => r.status === "rejected").length;
  check("tek-kullanımlık kod: 1 başarı + 1 409 (atomik claim)", ok === 1 && rej === 1, `ok=${ok} rej=${rej}`);
  const used = await prisma.pairingCode.findUnique({ where: { code: pc.code }, select: { usedAt: true, usedDeviceId: true } });
  check("kod usedAt + tek usedDeviceId işaretlendi", used?.usedAt != null && used?.usedDeviceId != null);
  const devCount = await prisma.device.count({ where: { deviceId: { in: [d1, d2] } } });
  check("yalnız kazanan cihaz oluştu (kaybeden upsert'e ulaşmadı)", devCount === 1, `device=${devCount}`);
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
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.device.deleteMany({ where: { deviceId: { in: deviceLocalIds } } });
  await prisma.pairingCode.deleteMany({ where: { code: { in: codes } } });
  await prisma.machine.deleteMany({ where: { id: { in: machineIds } } });
  await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.labelTemplate.deleteMany({ where: { id: { in: templateIds } } });
  await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
}

async function main(): Promise<void> {
  try {
    await testAmbPartialUnique();
    await testLabelDefaultPartialUnique();
    await testDeleteErrorAtomic();
    await testDevicePairAtomic();
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
