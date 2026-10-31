// =============================================================================
// CARİ KİLİDİ PANEL YÜZEYİ BEKÇİSİ (D4-I3; tasarım DALGA4 §10.8, §13 D4-I3; kural filtre-liste.md)
// =============================================================================
//   §1 "Kilitli" süzgeci SUNUCUDA: `GET /api/finance/cari?filter[held]=true` yalnız aktif kilitli hesabı döner,
//      `pagination.total` aynı where'den (sayfa boyu 1'de bile toplam doğru); açılmış kilit süzgeçten düşer;
//      satırın `hold` alanı (kapsam + sebep etiketi) sunucudan
//   §2 statik — `cariService.list` findMany ile count AYNI `where` nesnesini kullanır; süzgeç parçası helper'ın
//      `HELD_CARI_ACCOUNT_WHERE`ı (yüklem tek kaynak)
//   §3 kart Kilit sekmesi ucu `GET /api/finance/cari/by-customer/:id/holds`: `finance:hold` yeter, izinsiz 403
//   §4 rozetler: Cariler listesi `cariHold`, `holdViewsByCustomer` tek sorgu; İçerideki İşler + Sevke Hazır İşler
//      aynı helper'ı çağırır (kaynak taraması); sevk önizlemesi şerit metni = warnings[] satırı (§4d)
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31): ① `cari.service.ts`te `held` satırı yoruma alındı (süzgeç istemciye
//    taşınmış gibi) → §1a/§1b/§1d ❌ (12/3); ② count'a ayrı where (`{ ...where }`) verildi → §2a ❌ (14/1). Geri alındı → 15/0.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayar fotoğrafa döner.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Prisma } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { customerService } from "../src/routes/customer.routes";
import { cariHoldService } from "../src/services/cari-hold.service";
import { holdViewsByCustomer } from "../src/services/helpers/cari-hold-badge.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const SRC = path.resolve(__dirname, "../src");
const TAG = `TEST-CKP-${process.pid}`;
const AYARLAR = [SETTING_KEYS.FINANCE_ENABLED];
type Body = { data?: unknown; pagination?: { total: number }; details?: { code?: string } };

function statik(): void {
  console.log("── §2 Statik ──");
  const src = readFileSync(path.join(SRC, "services/cari.service.ts"), "utf8");
  const list = src.slice(src.indexOf("async list("), src.indexOf("async findById("));
  check(
    "§2a cari listesi: findMany ve count AYNI where nesnesinden",
    /findMany\(\{\s*where,/.test(list) && /cariAccount\.count\(\{ where \}\)/.test(list),
  );
  check("§2b süzgeç parçası helper'dan (HELD_CARI_ACCOUNT_WHERE) ve list() where'i tek kurucudan", /params\.held\)[^\n]*HELD_CARI_ACCOUNT_WHERE/.test(src) && /const where = cariListWhere\(params\);/.test(list));
  for (const f of ["services/ready-works.service.ts", "services/roll-owner.service.ts", "services/customer.service.ts"]) {
    check(`§4c ${path.basename(f)} rozeti holdViewsByCustomer'dan`, /holdViewsByCustomer\(|withCustomerHolds\(/.test(readFileSync(path.join(SRC, f), "utf8")));
  }
  const ship = readFileSync(path.join(SRC, "services/shipping.service.ts"), "utf8");
  check("§4d sevk önizlemesi: şerit metni (cariHold.warning) warnings[]'e giden satırın aynısı", /warning: cariHoldWarning\(holdNotice\)/.test(ship) && ship.includes("warnings.push(cariHold.warning)"));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== CARİ KİLİDİ PANEL BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin();
  const ids = { customers: [] as string[], users: [] as string[] };
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (p: string, token: string): Promise<{ status: number; body: Body }> => {
    const r = await fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Body };
  };
  const kullanici = async (ek: string, izinler: string[]): Promise<string> => {
    const username = `${TAG}-${ek}`.toLowerCase();
    const u = await prisma.user.create({ data: { username, fullName: `${TAG} ${ek}`, passwordHash: await AuthService.hashPassword("test123456"), isActive: true }, select: { id: true } });
    ids.users.push(u.id);
    const perms = await prisma.permission.findMany({ where: { code: { in: izinler } }, select: { id: true } });
    if (perms.length) await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: u.id, permissionId: p.id })) });
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test123456" }) });
    const t = ((await r.json()) as { data?: { token?: string } }).data?.token;
    if (!t) throw new Error(`login başarısız: ${username}`);
    return t;
  };
  const kartAc = async (ek: string): Promise<{ customerId: string; cariId: string }> => {
    const r = (await customerService.create({ name: `${TAG} ${ek}`, isCustomerRole: true }, admin.id)) as { data: { id: string } };
    ids.customers.push(r.data.id);
    const acc = await prisma.cariAccount.findFirstOrThrow({ where: { customerId: r.data.id }, select: { id: true } });
    return { customerId: r.data.id, cariId: acc.id };
  };
  const koy = (cariId: string) =>
    cariHoldService.place(cariId, { blocksIntake: true, blocksShipment: false, blocksInvoice: true, reasonCode: "BORC", reasonText: null, clientToken: randomUUID() }, admin.id);

  try {
    await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.FINANCE_ENABLED }, create: { key: SETTING_KEYS.FINANCE_ENABLED, value: true }, update: { value: true } });
    const okur = await kullanici("okur", ["finance:read", "customer:read"]);
    const koyan = await kullanici("koyan", ["finance:hold"]);
    const yabanci = await kullanici("yabanci", ["customer:read"]);
    const kilitli = await kartAc("Kilitli");
    const serbest = await kartAc("Serbest");
    const acilan = await kartAc("Acilan");
    await koy(kilitli.cariId);
    const a = await koy(acilan.cariId);
    await cariHoldService.release(a.data?.id as string, `${TAG} ödendi`, admin.id);

    console.log("── §1 Kilitli süzgeci ──");
    const q = encodeURIComponent(TAG);
    const held = await call(`/api/finance/cari?search=${q}&filter[held]=true&pageSize=50`, okur);
    const heldRows = (held.body.data ?? []) as Array<{ id: string; hold: { scopes: string[]; reasonLabel: string } | null }>;
    check("§1a süzgeç yalnız aktif kilitli hesabı döner (açılmış kilit düşer)", held.status === 200 && heldRows.length === 1 && heldRows[0]?.id === kilitli.cariId, `${held.status} ${heldRows.map((r) => r.id).join(",")}`);
    const one = await call(`/api/finance/cari?search=${q}&filter[held]=true&pageSize=1`, okur);
    check("§1b pagination.total süzgeçle aynı where'den (=1)", one.body.pagination?.total === 1, String(one.body.pagination?.total));
    const all = await call(`/api/finance/cari?search=${q}&pageSize=50`, okur);
    const allRows = (all.body.data ?? []) as Array<{ id: string; hold: { scopes: string[] } | null }>;
    check("§1c süzgeçsiz liste üç hesabı da döner (total=3)", all.body.pagination?.total === 3 && allRows.length === 3, String(all.body.pagination?.total));
    const h = heldRows[0]?.hold;
    check("§1d satırın hold alanı sunucudan (kapsam + sebep etiketi)", !!h && h.scopes.join(",") === "INTAKE,INVOICE" && !!h.reasonLabel, JSON.stringify(h));
    check("§1e kilitsiz/açılmış hesapta hold=null", allRows.filter((r) => r.id !== kilitli.cariId).every((r) => r.hold === null));

    console.log("── §3 Kart Kilit sekmesi ucu ──");
    const bc = await call(`/api/finance/cari/by-customer/${kilitli.customerId}/holds`, koyan);
    const bcData = bc.body.data as { cariId?: string; active?: { id: string } | null; history?: unknown[] } | undefined;
    check("§3a finance:hold ile 200 + cariId + aktif kilit", bc.status === 200 && bcData?.cariId === kilitli.cariId && !!bcData?.active, `${bc.status}`);
    const bcAcilan = await call(`/api/finance/cari/by-customer/${acilan.customerId}/holds`, okur);
    const ad = bcAcilan.body.data as { active?: unknown; history?: unknown[] } | undefined;
    check("§3b açılmış kilit: active=null, tarihçede 1 satır", ad?.active === null && ad?.history?.length === 1);
    const yasak = await call(`/api/finance/cari/by-customer/${kilitli.customerId}/holds`, yabanci);
    check("§3c finans izni yoksa 403", yasak.status === 403, String(yasak.status));

    console.log("── §4 Rozetler ──");
    const views = await holdViewsByCustomer([kilitli.customerId, serbest.customerId, acilan.customerId, null]);
    check("§4a holdViewsByCustomer yalnız kilitliyi döner + metin sunucudan", views.size === 1 && views.get(kilitli.customerId)?.holdText?.startsWith("Cari kilitli") === true, JSON.stringify([...views.values()]));
    const cl = await call(`/api/customers?search=${q}&limit=50`, okur);
    const cRows = (cl.body.data ?? []) as Array<{ id: string; cariHold?: { held: boolean } }>;
    check(
      "§4b Cariler listesi satırında cariHold (kilitli true, diğerleri false)",
      cRows.length === 3 && cRows.every((r) => r.cariHold?.held === (r.id === kilitli.customerId)),
      `${cl.status} ${cRows.length}`,
    );
  } finally {
    server.close();
    await temizle(ids, foto);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(ids: { customers: string[]; users: string[] }, foto: Array<{ key: string; value: Prisma.JsonValue }>): Promise<void> {
  const accs = await prisma.cariAccount.findMany({ where: { customerId: { in: ids.customers } }, select: { id: true } });
  const accIds = accs.map((a) => a.id);
  const holds = await prisma.cariHold.findMany({ where: { cariId: { in: accIds } }, select: { id: true } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...holds.map((h) => h.id), ...ids.customers, ...accIds] } } });
  await prisma.cariHold.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  for (const u of ids.users) {
    await prisma.userPermission.deleteMany({ where: { userId: u } });
    await prisma.session.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { userId: u } });
    await prisma.user.delete({ where: { id: u } }).catch(() => undefined);
  }
  for (const key of AYARLAR) {
    const eski = foto.find((f) => f.key === key);
    if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exitCode = 1;
});
