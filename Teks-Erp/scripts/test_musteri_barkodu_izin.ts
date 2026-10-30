// =============================================================================
// BEKÇİ — D4-F4 `roll:customer-code` izni + tablet aday sözleşmesi (DALGA4 §7.7, §13 D4-F4; GERÇEK DB + HTTP)
// Çalıştır: npx tsx scripts/run-all-tests.ts musteri_barkodu_izin
// =============================================================================
// §0 katalog: kod katalogda, `mobile:` ön eki YOK · varsayılan şablon ataması Tambur operatörü + Süpervizör.
// §1 ⭐ HTTP: yalnız `roll:customer-code` taşıyan kullanıcı bağlar + kaldırır (roll:write'sız).
// §2 ⭐ HTTP: ne `roll:customer-code` ne `roll:write` ne `mobile:tambur` taşıyan → bağla/kaldır 403 PERMISSION_DENIED.
// §3 ⭐ geri uyum: D4-F1'de bağlayabilen `roll:write` ve `mobile:tambur` bağlamaya DEVAM eder.
// §4 tablet aday sözleşmesi: 409 CUSTOMER_CODE_AMBIGUOUS adayı `barcode` + `customerName` + `currentQty` taşır.
// Negatif sonda (elle, PR gövdesinde): `ROLL_CUSTOMER_CODE_WRITE`tan `roll:customer-code` çıkarılınca §1 ❌;
// `mobile:tambur` çıkarılınca §3b ❌.
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { ItemType } from "@prisma/client";
import app from "../src/app";
import prisma from "../src/lib/prisma";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { ROLE_TEMPLATE_CATALOG } from "../src/constants/role-template-catalog";
import { AuthService } from "../src/services/auth.service";
import { RollCustomerCodeService } from "../src/services/roll-customer-code.service";
import { generateRollBarcodeTx } from "../src/services/helpers/roll-barcode.helper";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

const PERM = "roll:customer-code";
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

interface Resp { status: number; body: { data?: unknown; message?: string; details?: Record<string, unknown> } }

function catalogSection(): void {
  const entry = PERMISSION_CATALOG.find((p) => p.code === PERM);
  check("§0a izin katalogda (migration yok; boot uzlaştırması DB'ye getirir)", !!entry);
  check("§0b `mobile:` ön eki yok (iki nokta tek; wildcard `mobile:*` sızdırmaz)", !PERM.startsWith("mobile:") && PERM.split(":").length === 2);
  const holders = ROLE_TEMPLATE_CATALOG.filter((t) => t.codes.includes(PERM)).map((t) => t.code).sort();
  check("§0c ⭐ varsayılan şablon ataması: Tambur operatörü + Süpervizör", ["MOBILE_TAMBUR", "WEB_PRODUCTION_SUPERVISOR"].every((c) => holders.includes(c)), holders.join(", "));
}

async function main(): Promise<void> {
  catalogSection();
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);

  const STAMP = Date.now().toString(36).toUpperCase();
  const P = `TEST-MKI-${STAMP}`;
  const actor = await testActorId();
  const fx = { customerIds: [] as string[], rollIds: [] as string[], userIds: [] as string[], itemId: null as string | null };
  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.SCAN_CUSTOMER_CODE_LOOKUP];
  const saved = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const setOn = async (key: string) => {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: true, description: "TEST musteri_barkodu_izin" }, update: { value: true } });
  };
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, token: string | null, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let parsed: Resp["body"] = {};
    try { parsed = (await r.json()) as Resp["body"]; } catch { /* boş gövde */ }
    return { status: r.status, body: parsed };
  };
  const user = async (tag: string, perms: string[]): Promise<string> => {
    const username = `${P}-${tag}`.toLowerCase();
    const u = await prisma.user.create({ data: { username, fullName: `${P} ${tag}`, passwordHash: await AuthService.hashPassword("test123456"), isActive: true }, select: { id: true } });
    fx.userIds.push(u.id);
    const rows = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
    if (rows.length !== perms.length) throw new Error(`izin DB'de yok (uzlaştırma koşulmadı?): ${perms.join(",")}`);
    await prisma.userPermission.createMany({ data: rows.map((r) => ({ userId: u.id, permissionId: r.id })) });
    const login = await call("POST", "/api/auth/login", null, { username, password: "test123456" });
    const token = (login.body.data as { token?: string } | undefined)?.token;
    if (!token) throw new Error(`login başarısız: ${username} (${login.status} ${login.body.message ?? ""})`);
    return token;
  };
  const bind = (rollId: string, code: string, token: string) =>
    call("POST", `/api/rolls/${rollId}/customer-code`, token, { code, clientToken: randomUUID() });
  const revoke = (rollId: string, token: string) =>
    call("POST", `/api/rolls/${rollId}/customer-code/revoke`, token, { reason: "Etiket yanlış yapıştırıldı" });

  try {
    await setOn(SETTING_KEYS.EMANET_ENABLED);
    await setOn(SETTING_KEYS.SCAN_CUSTOMER_CODE_LOOKUP);
    invalidateFeatureFlagsCache();
    const item = await prisma.item.create({ data: { code: `${P}-K`.slice(0, 32), name: `TEST MKI kumaş ${STAMP}`, itemType: ItemType.FABRIC }, select: { id: true } });
    fx.itemId = item.id;
    const mkCust = async (tag: string) => {
      const c = await prisma.customer.create({ data: { code: `${P}-${tag}`.slice(0, 32), name: `TEST MKI ${tag} ${STAMP}` }, select: { id: true } });
      fx.customerIds.push(c.id);
      return c.id;
    };
    const A = await mkCust("A");
    const B = await mkCust("B");
    const mkRoll = async (owner: string, qty: number) => {
      const barcode = await generateRollBarcodeTx(prisma as never, "H");
      const r = await prisma.roll.create({ data: { itemId: item.id, initialQty: qty, currentQty: qty, ownerCustomerId: owner, barcode }, select: { id: true, barcode: true } });
      fx.rollIds.push(r.id);
      return { id: r.id, barcode: r.barcode! };
    };
    const r1 = await mkRoll(A, 50);
    const r2 = await mkRoll(A, 41.5);
    const r3 = await mkRoll(A, 50);
    const r4 = await mkRoll(B, 37);
    const r5 = await mkRoll(A, 50);

    // ── §1 dar izin bağlar + kaldırır ──
    const narrow = await user("dar", [PERM]);
    const b1 = await bind(r1.id, `MKI${STAMP}01`, narrow);
    check("§1a ⭐ yalnız roll:customer-code → bağla 200", b1.status === 200, `${b1.status} ${b1.body.message ?? ""}`);
    const v1 = await revoke(r1.id, narrow);
    check("§1b ⭐ yalnız roll:customer-code → kaldır 200", v1.status === 200, `${v1.status} ${v1.body.message ?? ""}`);

    // ── §2 izinsiz 403 ──
    const packer = await user("paket", ["mobile:tarti-paket", "roll:read"]);
    const d1 = await bind(r5.id, `MKI${STAMP}05`, packer);
    check("§2a ⭐ roll:customer-code ∧ roll:write ∧ mobile:tambur yok → bağla 403 PERMISSION_DENIED", d1.status === 403 && d1.body.details?.code === "PERMISSION_DENIED", `${d1.status} ${String(d1.body.details?.code)}`);
    const d2 = await revoke(r5.id, packer);
    check("§2b izinsiz kaldır 403 PERMISSION_DENIED", d2.status === 403 && d2.body.details?.code === "PERMISSION_DENIED", `${d2.status}`);
    const req = d1.body.details?.requiredAny as string[] | undefined;
    check("§2c 403 gövdesi dar izni adıyla söyler (requiredAny)", Array.isArray(req) && req.includes(PERM), JSON.stringify(req));

    // ── §3 geri uyum ──
    const SHARED = `MKI${STAMP}77`;
    const writer = await user("yazar", ["roll:write"]);
    const g1 = await bind(r2.id, SHARED, writer);
    check("§3a ⭐ geri uyum: roll:write bağlamaya devam eder", g1.status === 200, `${g1.status} ${g1.body.message ?? ""}`);
    const tambur = await user("tambur", ["mobile:tambur"]);
    const g2 = await bind(r3.id, `MKI${STAMP}03`, tambur);
    check("§3b ⭐ geri uyum: mobile:tambur bağlamaya devam eder", g2.status === 200, `${g2.status} ${g2.body.message ?? ""}`);

    // ── §4 tablet aday sözleşmesi ──
    await RollCustomerCodeService.bind(r4.id, { code: SHARED, clientToken: randomUUID() }, actor);
    const amb = await call("GET", `/api/rolls/barcode/${SHARED}`, packer);
    const cands = (amb.body.details?.candidates ?? []) as Array<{ rollId?: string; barcode?: string; customerName?: string; currentQty?: unknown }>;
    check("§4a belirsiz okutma → 409 CUSTOMER_CODE_AMBIGUOUS + 2 aday", amb.status === 409 && amb.body.details?.code === "CUSTOMER_CODE_AMBIGUOUS" && cands.length === 2, `${amb.status} ${cands.length}`);
    const q2 = cands.find((c) => c.rollId === r2.id);
    const q4 = cands.find((c) => c.rollId === r4.id);
    check("§4b ⭐ aday barkod + müşteri + metre taşır (sayı)", q2?.barcode === r2.barcode && typeof q2?.customerName === "string" && q2?.currentQty === 41.5 && q4?.currentQty === 37, JSON.stringify(cands.map((c) => c.currentQty)));
  } finally {
    server.close();
    for (const k of keys) {
      const s = saved.find((x) => x.key === k);
      if (s) await prisma.systemSetting.update({ where: { key: k }, data: { value: s.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    invalidateFeatureFlagsCache();
    if (fx.rollIds.length) {
      const codeIds = (await prisma.rollCustomerCode.findMany({ where: { rollId: { in: fx.rollIds } }, select: { id: true } })).map((c) => c.id);
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...fx.rollIds, ...codeIds] } } });
      await prisma.rollCustomerCode.deleteMany({ where: { rollId: { in: fx.rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: fx.rollIds } } });
    }
    if (fx.customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } });
    if (fx.itemId) await prisma.item.deleteMany({ where: { id: fx.itemId } });
    for (const u of fx.userIds) {
      await prisma.userPermission.deleteMany({ where: { userId: u } });
      await prisma.session.deleteMany({ where: { userId: u } });
      await prisma.systemLog.deleteMany({ where: { userId: u } });
      await prisma.user.deleteMany({ where: { id: u } });
    }
  }
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
  });
