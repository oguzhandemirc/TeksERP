// =============================================================================
// YETKI DENETIMI BEKCISI — guvenlik denetimi Bolge 2 (YETKI) bulgularinin uctan uca sondasi
// =============================================================================
// Kaynak: Teks-Erp-wt/denetim/guvenlik-2-yetki.md B1-B7 (saldiri testi olarak dogdu, duzeltmeyle
// kalici bekci oldu). Her kontrol GUVENLI davranisi ister; duzeltme geri alinirsa ilgili § kirmizi.
//   B1 yetki kademesi — baskasina kendinde olmayan izni veremez (GRANT_EXCEEDS_ACTOR) · daha yetkili
//      hedefin parola/TOTP/PIN/kart sifirlamasi iki kisilik onay (talep → kapsayan ikinci yonetici)
//   B2 shipping:write fatura isareti koyamaz (yalniz shipping:invoice)
//   B3 PATCH /warehouses/:id isDefault · kullanimdaki istasyonun kind'i
//   B4 production.enabled=false iken /api/rolls uretim uclari (open-fabric) 403 MODULE_DISABLED
//   B5 workOrderQuickOwnOnlyEnabled acikken hizli is emri yalniz kendi is emrini duzenler
//   B6 supportOwnTicketsOnlyEnabled acikken destek talebi yalniz sahibine (yonetici hepsini)
//   B7 [KALAN, beyanli] mobile:kk1-yalniz hesap /api/feature-flags anlik goruntusu (izdusum yok)
//
// Kosum (yalniz _test DB; kendi sunucusunu bekci kosucusu acar):
//   DATABASE_URL='postgresql://…/<ad>_test?schema=public' \
//     node ../scripts/agir-is.mjs -- npx tsx scripts/bekci-http.ts yetki_denetimi
// Global ayar yazar (production.enabled vb.); bulduguna finally'de doner.
// =============================================================================
import { randomBytes } from "node:crypto";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { httpBekciKapisi } from "./lib/http-bekci-kapisi";
import { atlamaDefteri } from "./lib/atlama";
import { DEFAULT_OPERATOR_PERMISSION_CODES } from "../src/services/permission-management.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`OK   ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}
const ATLAMA = atlamaDefteri(() => { fail++; });
const BASE = process.env.TEST_API_URL ?? "http://localhost:4112";
const HTTP_CHECKS = 20;
const ek = Date.now().toString(36);

interface Cevap { status: number; json: Record<string, unknown> }
async function call(token: string | null, method: string, url: string, body?: unknown): Promise<Cevap> {
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}
const codeOf = (j: Record<string, unknown>): unknown => (j.details as { code?: unknown } | undefined)?.code;
const dataOf = <T>(j: Record<string, unknown>): T => j.data as T;
const ozet = (c: Cevap): string => `${c.status} ${String(codeOf(c.json) ?? "")} ${String(c.json.message ?? "")}`.trim().slice(0, 160);

interface Kisi { id: string; username: string; password: string }
const ids = { users: [] as string[], shipments: [] as string[], customers: [] as string[], items: [] as string[], stations: [] as string[], machines: [] as string[], workOrders: [] as string[], tickets: [] as string[], requests: [] as string[] };
const parola = (): string => `Dny-${randomBytes(8).toString("hex")}-Aa9!`;

async function kisi(etiket: string, codes: string[]): Promise<Kisi> {
  const password = parola();
  const username = `TSTDNY${etiket}${ek}`.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
  const u = await prisma.user.create({
    data: { username, fullName: `TEST DENETIM ${etiket}`, passwordHash: await bcrypt.hash(password, 10), isActive: true },
    select: { id: true },
  });
  ids.users.push(u.id);
  if (codes.length) {
    const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
    const eksik = codes.filter((c) => !perms.some((p) => p.code === c));
    if (eksik.length) throw new Error(`Izin katalogunda yok: ${eksik.join(", ")}`);
    await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: u.id, permissionId: p.id })) });
  }
  return { id: u.id, username, password };
}

async function giris(k: { username: string; password: string }, clientType = "electron"): Promise<{ token: string | null; c: Cevap }> {
  const c = await call(null, "POST", "/api/auth/login", { username: k.username, password: k.password, clientType, confirmKick: true });
  return { token: c.status === 200 ? (dataOf<{ token?: string }>(c.json).token ?? null) : null, c };
}

const YONETILEN = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.AUTH_LOGIN_METHODS, SETTING_KEYS.WORKORDER_QUICK_OWN_ONLY_ENABLED, SETTING_KEYS.SUPPORT_OWN_TICKETS_ONLY_ENABLED];
const ilk = new Map<string, unknown>();
async function ayarYaz(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function main(): Promise<void> {
  console.log("\n=== Guvenlik denetimi Bolge 2 (YETKI) — saldiri sondasi ===\n");
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: YONETILEN } }, select: { key: true, value: true } });
  for (const k of YONETILEN) ilk.set(k, rows.find((r) => r.key === k)?.value ?? undefined);
  const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_CHECKS });
  if (kapi.kirmizi) { check("HTTP ayagi olculebildi", false, kapi.kirmizi); return; }
  if (!kapi.token) { ATLAMA.atla("HTTP turu", kapi.atlaSebebi ?? "sunucu yok", HTTP_CHECKS); return; }
  const admin = kapi.token;
  try {
    await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await b1();
    await b2(admin);
    await b3();
    await b4();
    await b5(admin);
    await b6();
    await b7();
  } finally {
    for (const [key, value] of ilk) {
      if (value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
      else await prisma.systemSetting.update({ where: { key }, data: { value: value as never } });
    }
    await temizle();
  }
}

// ── B1: admin:users yanal yukselme ve kimlige burunme ───────────────────────────
async function b1(): Promise<void> {
  console.log("\n§B1 — admin:users kademesizligi");
  // Beyanli istisna: yeni kullaniciya verilen sabit operator paketi kademe kapisindan GECMEZ — o yuzden
  // yalniz tablet kodu tasiyabilir (yonetim/SoD kodu girerse istisna yukselme kapisina doner).
  const yasakli = ([...DEFAULT_OPERATOR_PERMISSION_CODES] as string[]).filter((c) => !c.startsWith("mobile:") || c === "mobile:*");
  check("§B1 operator varsayilan paketi yalniz tablet kodlari (kademe istisnasi dar)", yasakli.length === 0, yasakli.join(",") || "temiz");
  const A = await kisi("A", ["admin:users"]);                       // sadece kullanici yonetimi
  const T = await kisi("B1T", ["order:read"]);                      // dusuk yetkili kurban
  const a = await giris(A);
  if (!a.token) { check("§B1 on kosul: admin:users-yalniz aktor giris yapar", false, ozet(a.c)); return; }
  const tok = a.token;

  // (1) baskasina ADMIN_FULL (= admin:* dahil katalogun tamami) uygula
  const tpl = await prisma.permissionTemplate.findFirst({ where: { code: "ADMIN_FULL" }, select: { id: true } });
  if (!tpl) { check("§B1 on kosul: ADMIN_FULL sablonu DB'de", false, "rol uzlastirmasi kosulmali"); }
  else {
    const applied = await call(tok, "POST", `/api/admin/users/${T.id}/apply-template`, { templateId: tpl.id, mode: "replace" });
    // GUVENLI beklenti: aktor admin:* tasimadigi icin kendi kumesini asan grant REDDEDILMELI
    check("§B1a admin:users-yalniz aktor baskasina ADMIN_FULL VEREMEMELI (beklenen 403/409)",
      applied.status === 403 || applied.status === 409, ozet(applied));
    const kurbanPerms = await prisma.userPermission.count({
      where: { userId: T.id, permission: { code: "admin:*" } },
    });
    check("§B1b kurbana admin:* YAZILMAMALI", kurbanPerms === 0, `admin:* satir sayisi=${kurbanPerms}`);
  }

  // (2) iki adimli kendini yukseltme: yeni admin ac -> ona tam yetki -> onunla gir
  const created = await call(tok, "POST", "/api/admin/users", {
    username: `TSTDNYNEW${ek}`.slice(0, 40), fullName: "TEST DENETIM YENI", password: parola(), grantOperatorDefaults: false,
  });
  if (created.status === 201) {
    const yeniId = dataOf<{ id: string }>(created.json).id;
    if (yeniId) ids.users.push(yeniId);
    const tpl2 = tpl;
    if (tpl2) {
      const ap = await call(tok, "POST", `/api/admin/users/${yeniId}/apply-template`, { templateId: tpl2.id, mode: "replace" });
      const grew = await prisma.userPermission.count({ where: { userId: yeniId, permission: { code: "admin:*" } } });
      check("§B1c admin:users-yalniz aktor YENI hesaba admin:* VEREMEMELI", ap.status === 403 || ap.status === 409 || grew === 0, `${ozet(ap)} admin:*=${grew}`);
    }
  } else {
    check("§B1c (yeni hesap acma on kosulu)", false, ozet(created));
  }

  // (3) kimlik teslimi: dusuk yetkili aktor YUKSEK yetkili hedefin PIN'ini sifirlayip duz okuyabilir mi
  const V = await kisi("B1V", ["shipping:invoice", "shipping:undo-dispatch", "roll:manual-adjust"]); // SoD tasiyan kurban
  const pinResp = await call(tok, "POST", `/api/admin/users/${V.id}/quick-pin`, {});
  // Bugunku davranis: 200 + duz pin doner. GUVENLI beklenti: SoD/privileged hedefte 403 ya da ikinci onay.
  const pinDondu = pinResp.status === 200 && typeof dataOf<{ pin?: string }>(pinResp.json)?.pin === "string";
  check("§B1d admin:users-yalniz aktor SoD-tasiyan hedefin PIN'ini DUZ OKUYAMAMALI (beklenen 403)",
    pinResp.status === 403, `${ozet(pinResp)} pinDuzDondu=${pinDondu}`);

  // okuma ucu AND kapili mi (admin:settings + admin:users): aktorde admin:settings yok -> 403 beklenir (bu dogru davranis)
  const cred = await call(tok, "GET", `/api/admin/users/${V.id}/credentials`);
  check("§B1e okuma ucu /credentials AND kapili (admin:settings yoksa 403) — yazma ucuyla asimetri kaniti",
    cred.status === 403, ozet(cred));

  // (4) parola sifirlama + kimlikle giris: aktor kurbanin parolasini sifirlar, yeni parolayla onun kimligiyle girilir mi
  const yeniPw = parola();
  const rp = await call(tok, "POST", `/api/admin/users/${V.id}/reset-password`, { password: yeniPw });
  // reset-password baska birine mustChangePassword koyar -> parolali girisde 403 PASSWORD_CHANGE_REQUIRED (desktop haric).
  // mobile ile dener: mustChange tableti engeller; ama desktop token alir ve change-password ucuna daralir.
  const asV = await giris({ username: V.username, password: yeniPw }, "electron");
  // GUVENLI beklenti: SoD-tasiyan hedefin parolasini admin:users-yalniz aktor sifirLAYAMAMALI (403).
  check("§B1f admin:users-yalniz aktor SoD-tasiyan hedefin PAROLASINI SIFIRLAYAMAMALI (beklenen 403)",
    rp.status === 403, ozet(rp));
  check("§B1g sifirlama sonrasi hedefin kimligiyle (desktop) oturum ACILMAMALI",
    asV.token === null, `${ozet(asV.c)} token=${asV.token ? "VAR" : "yok"}`);

  // (5) TOTP sifirlama tek kapi mi
  const tr = await call(tok, "POST", `/api/admin/users/${V.id}/totp/reset`, {});
  check("§B1h admin:users-yalniz aktor SoD-tasiyan hedefin TOTP'sini SIFIRLAYAMAMALI (beklenen 403)",
    tr.status === 403, ozet(tr));
  check("§B1h2 ret kodu CREDENTIAL_RESET_NEEDS_APPROVAL (yol: iki kisilik talep)",
    codeOf(tr.json) === "CREDENTIAL_RESET_NEEDS_APPROVAL" && codeOf(rp.json) === "CREDENTIAL_RESET_NEEDS_APPROVAL", `${ozet(tr)} | ${ozet(rp)}`);

  // (6) karsi kanit: aktorun KENDINDE olan izni baskasina vermesi serbest (kapi asiri daraltmiyor)
  const adminUsers = await prisma.permission.findFirst({ where: { code: "admin:users" }, select: { id: true } });
  const ver = await call(tok, "POST", `/api/admin/users/${T.id}/permissions`, { permissionId: adminUsers?.id });
  check("§B1i karsi kanit: aktor KENDINDE olan izni (admin:users) baskasina VEREBILIR", ver.status === 201 || ver.status === 200, ozet(ver));
  const gecmez = await call(tok, "POST", `/api/admin/users/${T.id}/permissions`, {
    permissionId: (await prisma.permission.findFirst({ where: { code: "shipping:invoice" }, select: { id: true } }))?.id,
  });
  check("§B1i2 tekil grant da kademeli: kendinde olmayan shipping:invoice → 409 GRANT_EXCEEDS_ACTOR",
    gecmez.status === 409 && codeOf(gecmez.json) === "GRANT_EXCEEDS_ACTOR", ozet(gecmez));

  // (7) iki kisilik akis: A talep eder → A onaylayamaz → yetersiz B onaylayamaz → hedefi kapsayan C onaylar
  const talep = await call(tok, "POST", "/api/admin/credential-reset-requests", {
    targetUserId: V.id, kind: "PASSWORD", reason: "TEST sifre unutuldu", clientToken: crypto.randomUUID(),
  });
  const talepId = dataOf<{ id?: string }>(talep.json)?.id;
  check("§B1j talep acilir (201 PENDING)", talep.status === 201 && dataOf<{ status?: string }>(talep.json)?.status === "PENDING", ozet(talep));
  if (!talepId) return;
  ids.requests.push(talepId);
  const kendi = await call(tok, "POST", `/api/admin/credential-reset-requests/${talepId}/approve`, { password: parola() });
  check("§B1k talep eden KENDI talebini onaylayamaz (403 APPROVER_IS_REQUESTER)",
    kendi.status === 403 && codeOf(kendi.json) === "APPROVER_IS_REQUESTER", ozet(kendi));
  const B = await kisi("B1B", ["admin:users"]);
  const b = await giris(B);
  const yetersiz = b.token ? await call(b.token, "POST", `/api/admin/credential-reset-requests/${talepId}/approve`, { password: parola() }) : b.c;
  check("§B1l hedefi KAPSAMAYAN ikinci yonetici onaylayamaz (403 APPROVER_NOT_SUFFICIENT)",
    yetersiz.status === 403 && codeOf(yetersiz.json) === "APPROVER_NOT_SUFFICIENT", ozet(yetersiz));
  const C = await kisi("B1C", ["admin:users", "shipping:invoice", "shipping:undo-dispatch", "roll:manual-adjust"]);
  const c = await giris(C);
  const onayPw = parola();
  const onay = c.token ? await call(c.token, "POST", `/api/admin/credential-reset-requests/${talepId}/approve`, { password: onayPw }) : c.c;
  check("§B1m hedefi kapsayan ikinci yonetici onaylar → uygulanir (200)", onay.status === 200, ozet(onay));
  const asV2 = await giris({ username: V.username, password: onayPw }, "electron");
  check("§B1m2 onaylanan gecici parola hedefte gecerli (giris token verir)", asV2.token !== null, ozet(asV2.c));
  const satir = await prisma.credentialResetRequest.findUnique({ where: { id: talepId }, select: { status: true, requestedById: true, decidedById: true, decidedAt: true } });
  check("§B1n talep ve onay defterde dogru aktorlerle (talep=A, karar=C, APPLIED)",
    satir?.status === "APPLIED" && satir.requestedById === A.id && satir.decidedById === C.id && satir.decidedAt !== null, JSON.stringify(satir));
  const iz = await prisma.systemLog.findFirst({ where: { tableName: "CREDENTIAL_RESET_REQUEST", recordId: talepId, action: "UPDATE" }, select: { userId: true } });
  check("§B1n2 audit onayi ONAYLAYANLA yazar", iz?.userId === C.id, `audit userId=${iz?.userId ?? "yok"}`);
  const tekrar = c.token ? await call(c.token, "POST", `/api/admin/credential-reset-requests/${talepId}/approve`, { password: parola() }) : c.c;
  check("§B1o karara baglanmis talep ikinci kez uygulanmaz (409 REQUEST_NOT_PENDING)",
    tekrar.status === 409 && codeOf(tekrar.json) === "REQUEST_NOT_PENDING", ozet(tekrar));
}

// ── B2: SoD uclusu zorlanmiyor — shipping:write fatura isareti koyuyor ──────────
async function b2(admin: string): Promise<void> {
  console.log("\n§B2 — SoD: shipping:write fatura isareti koyar [KARAR]");
  const customer = await prisma.customer.create({ data: { code: `TSTDNY-C-${ek}`, name: `TEST DENETIM MUSTERI ${ek}`, taxNumber: "5556667778" }, select: { id: true } });
  ids.customers.push(customer.id);
  const shipment = await prisma.shipment.create({
    data: { shipmentNo: `TSTDNY-SHP-${ek}`, customerId: customer.id, status: "DISPATCHED", destination: "DOMESTIC", dispatchedAt: new Date() },
    select: { id: true },
  });
  ids.shipments.push(shipment.id);

  const W = await kisi("B2W", ["shipping:write"]); // gunluk sevkiyatci, fatura izni YOK
  const w = await giris(W);
  if (!w.token) { check("§B2 on kosul: shipping:write-yalniz aktor giris yapar", false, ozet(w.c)); return; }
  const inv = await call(w.token, "POST", `/api/shipping/shipments/${shipment.id}/invoice`, { invoiceNo: `FTR-${ek}` });
  // Bugunku davranis: 200 (route shipping:write kabul eder). GUVENLI/kural beklentisi: 403.
  check("§B2a shipping:write-yalniz aktor fatura isareti KOYAMAMALI (SoD — beklenen 403)",
    inv.status === 403, ozet(inv));

  // karsi kanit: admin (tam yetki) ayni islemde 200 doner mi (route calisiyor mu)
  const invAdmin = await call(admin, "POST", `/api/shipping/shipments/${shipment.id}/invoice`, { invoiceNo: null });
  check("§B2b karsi kanit: tam yetkili aktor ayni ucta basarili (route canli)", invAdmin.status === 200, ozet(invAdmin));
}

// ── B3: mass assignment — PATCH ile korumasiz skaler kolon ──────────────────────
async function b3(): Promise<void> {
  console.log("\n§B3 — mass assignment (bare BaseController)");
  const W = await kisi("B3W", ["warehouse:write", "station:write"]);
  const w = await giris(W);
  if (!w.token) { check("§B3 on kosul: write aktor giris yapar", false, ozet(w.c)); return; }

  const def = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true, name: true } });
  if (!def) { check("§B3 on kosul: varsayilan depo var", false, "ensureDefaultWarehouse kosulmali"); }
  else {
    const before = await prisma.warehouse.count({ where: { isDefault: true } });
    const patch = await call(w.token, "PATCH", `/api/warehouses/${def.id}`, { isDefault: false });
    const after = await prisma.warehouse.count({ where: { isDefault: true } });
    // GUVENLI beklenti: isDefault PATCH gövdesinden YAZILAMAMALI (boğaz yalniz POST /default).
    check("§B3a PATCH /warehouses/:id isDefault YAZAMAMALI (varsayilan bozulmamali)",
      after === before, `once=${before} sonra=${after} resp=${ozet(patch)}`);
    // geri al (bozulduysa)
    if (after < before) await prisma.warehouse.update({ where: { id: def.id }, data: { isDefault: true } });
  }

  const st = await prisma.station.create({ data: { name: `TSTDNY-ST-${ek}`, code: `TSTDNYST${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "OTHER", isActive: true }, select: { id: true } });
  ids.stations.push(st.id);
  // Kullanilmamis istasyonda kind duzeltmesi serbest (yeni tanim duzeltmesi — panel formu kind'i duzenler).
  const patchSt = await call(w.token, "PATCH", `/api/stations/${st.id}`, { kind: "WEAVING" });
  const stAfter = await prisma.station.findUnique({ where: { id: st.id }, select: { kind: true } });
  check("§B3b karsi kanit: KULLANILMAMIS istasyonda kind duzeltilebilir (200)",
    patchSt.status === 200 && stAfter?.kind === "WEAVING", `${ozet(patchSt)} kind=${String(stAfter?.kind)}`);
  // Kullanimdaki istasyon (makine bagli): kind degisimi gecmisin anlamini kaydirir → 409.
  const mk = await prisma.machine.create({ data: { stationId: st.id, code: `TSTDNYMK${ek}`.toUpperCase().slice(0, 32), name: `TSTDNY-MK-${ek}` }, select: { id: true } });
  ids.machines.push(mk.id);
  const patchSt2 = await call(w.token, "PATCH", `/api/stations/${st.id}`, { kind: "OTHER", appliesQuality: true });
  const stAfter2 = await prisma.station.findUnique({ where: { id: st.id }, select: { kind: true, appliesQuality: true } });
  check("§B3c KULLANIMDAKI istasyonda kind DEGISTIRILEMEZ (409 STATION_KIND_IN_USE)",
    patchSt2.status === 409 && codeOf(patchSt2.json) === "STATION_KIND_IN_USE" && stAfter2?.kind === "WEAVING",
    `${ozet(patchSt2)} kind=${String(stAfter2?.kind)}`);
  const patchSt3 = await call(w.token, "PATCH", `/api/stations/${st.id}`, { kind: "WEAVING", name: `TSTDNY-ST2-${ek}` });
  check("§B3d kullanimdaki istasyonda AYNI kind'i tasiyan tam form gecer (eski panel)", patchSt3.status === 200, ozet(patchSt3));
}

// ── B4: /api/rolls uretim rejim kapisi yok ──────────────────────────────────────
async function b4(): Promise<void> {
  console.log("\n§B4 — /api/rolls uretim rejim kapisi");
  await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, false);
  const R = await kisi("B4R", ["roll:write"]);
  const r = await giris(R);
  if (!r.token) { check("§B4 on kosul: roll:write aktor giris yapar", false, ozet(r.c)); await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, true); return; }
  // open-fabric uretim ucu: production kapaliyken MODULE_DISABLED beklenir.
  const of = await call(r.token, "POST", "/api/rolls/open-fabric", { receiptId: "00000000-0000-0000-0000-000000000000", stepId: "00000000-0000-0000-0000-000000000000" });
  // Kapi VARSA middleware'de 403 MODULE_DISABLED gelir (controller'a inmeden). 404/400 = istek
  // servis katmanina ULASTI = kapi YOK. Bu yuzden MODULE_DISABLED disi her cevap "acik" kanitidir.
  check("§B4a production.enabled=false iken /api/rolls/open-fabric 403 MODULE_DISABLED vermeli (kapi yok = acik)",
    of.status === 403 && codeOf(of.json) === "MODULE_DISABLED", `${ozet(of)} (403/MODULE_DISABLED disi = kapi yok)`);
  const kf = await call(r.token, "POST", "/api/rolls/00000000-0000-0000-0000-000000000000/kursun-finish", {});
  check("§B4b production.enabled=false iken /api/rolls/:id/kursun-finish 403 MODULE_DISABLED",
    kf.status === 403 && codeOf(kf.json) === "MODULE_DISABLED", ozet(kf));
  // Kurtarma ucu BILEREK kapisiz: uretim kapandiktan sonra takili topu depoya almanin tek yolu.
  const M = await kisi("B4M", ["roll:manual-adjust"]);
  const m = await giris(M);
  const rs = m.token ? await call(m.token, "POST", "/api/rolls/00000000-0000-0000-0000-000000000000/rescue-stuck", { reason: "deneme kurtarma" }) : null;
  check("§B4c karsi kanit: kurtarma ucu (rescue-stuck) uretim kapaliyken de servise ulasir (MODULE_DISABLED degil)",
    rs !== null && codeOf(rs.json) !== "MODULE_DISABLED", rs ? ozet(rs) : ozet(m.c));
  // initial-entry CEKIRDEK (KK1) — bilincli kapisiz; yalniz kayit, beklenti degil.
  await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, true);
}

// ── B5: mobile:hizli-is-emri herhangi is emrini duzenler ────────────────────────
async function b5(admin: string): Promise<void> {
  console.log("\n§B5 — mobile:hizli-is-emri kapsami (ayar: workOrderQuickOwnOnlyEnabled)");
  const item = await prisma.item.create({ data: { code: `TSTDNY-WOI-${ek}`, name: `TEST DENETIM WO KUMAS ${ek}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  ids.items.push(item.id);
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `TSTDNY-WO-${ek}`, status: "PLANNED", type: "STOCK_PRODUCTION", targetItemId: item.id }, select: { id: true } });
  ids.workOrders.push(wo.id);
  const O = await kisi("B5O", ["mobile:hizli-is-emri"]); // saha operatoru
  const own = await prisma.workOrder.create({ data: { workOrderNumber: `TSTDNY-WO2-${ek}`, status: "PLANNED", type: "STOCK_PRODUCTION", targetItemId: item.id, createdById: O.id }, select: { id: true } });
  ids.workOrders.push(own.id);
  const o = await giris(O, "mobile");
  if (!o.token) { check("§B5 on kosul: mobile:hizli-is-emri aktor (mobil) giris yapar", false, ozet(o.c)); return; }
  const miktar = async (id: string): Promise<number> =>
    Number((await prisma.workOrder.findUnique({ where: { id }, select: { targetQuantity: true } }))?.targetQuantity ?? 0);

  await ayarYaz(SETTING_KEYS.WORKORDER_QUICK_OWN_ONLY_ENABLED, false);
  const p0 = await call(o.token, "PATCH", `/api/work-orders/${wo.id}`, { targetQuantity: 111 });
  check("§B5a ayar KAPALI (varsayilan = bugun): hizli is emri planlamanin is emrini duzenler (200)",
    p0.status === 200 && (await miktar(wo.id)) === 111, ozet(p0));

  await ayarYaz(SETTING_KEYS.WORKORDER_QUICK_OWN_ONLY_ENABLED, true);
  const p1 = await call(o.token, "PATCH", `/api/work-orders/${wo.id}`, { targetQuantity: 12345 });
  check("§B5b ayar ACIK: planlamanin is emri DUZENLENEMEZ (403 PERMISSION_DENIED, required workorder:write)",
    p1.status === 403 && codeOf(p1.json) === "PERMISSION_DENIED" && (p1.json.details as { required?: string } | undefined)?.required === "workorder:write" && (await miktar(wo.id)) === 111,
    `${ozet(p1)} miktar=${await miktar(wo.id)}`);
  const c1 = await call(o.token, "POST", `/api/work-orders/${wo.id}/cancel`, { reason: "deneme" });
  check("§B5c ayar ACIK: planlamanin is emri IPTAL EDILEMEZ (403)", c1.status === 403, ozet(c1));
  const p2 = await call(o.token, "PATCH", `/api/work-orders/${own.id}`, { targetQuantity: 222 });
  check("§B5d ayar ACIK: KENDI baslattigi is emri duzenlenir (200)", p2.status === 200 && (await miktar(own.id)) === 222, ozet(p2));
  const p3 = await call(admin, "PATCH", `/api/work-orders/${wo.id}`, { targetQuantity: 333 });
  check("§B5e ayar ACIK: workorder:write tasiyan etkilenmez (200)", p3.status === 200 && (await miktar(wo.id)) === 333, ozet(p3));
  await ayarYaz(SETTING_KEYS.WORKORDER_QUICK_OWN_ONLY_ENABLED, false);
}

// ── B6: support:create baskasinin talebini okur ─────────────────────────────────
async function b6(): Promise<void> {
  console.log("\n§B6 — support:create okuma kapsami (ayar: supportOwnTicketsOnlyEnabled)");
  const A = await kisi("B6A", ["support:create"]);
  const B = await kisi("B6B", ["support:create"]);
  const Y = await kisi("B6Y", ["support:create", "admin:settings"]);
  const a = await giris(A);
  const b = await giris(B);
  const y = await giris(Y);
  if (!a.token || !b.token || !y.token) { check("§B6 on kosul: uc support aktoru giris yapar", false, `${ozet(a.c)} | ${ozet(b.c)} | ${ozet(y.c)}`); return; }
  const created = await call(a.token, "POST", "/api/destek", { konu: `TSTDNY gizli ${ek}`, aciklama: "A kullanicisinin ozel yazismasi", clientToken: crypto.randomUUID() });
  if (created.status !== 201) { check("§B6 on kosul: A talep acar", false, ozet(created)); return; }
  const tid = dataOf<{ id: string }>(created.json).id;
  if (tid) ids.tickets.push(tid);
  const listede = async (token: string): Promise<boolean> => JSON.stringify((await call(token, "GET", "/api/destek")).json).includes(`TSTDNY gizli ${ek}`);

  await ayarYaz(SETTING_KEYS.SUPPORT_OWN_TICKETS_ONLY_ENABLED, false);
  const d0 = await call(b.token, "GET", `/api/destek/${tid}`);
  check("§B6a ayar KAPALI (varsayilan = bugun): B, A'nin talebini listede ve detayda gorur",
    (await listede(b.token)) && d0.status === 200, ozet(d0));

  await ayarYaz(SETTING_KEYS.SUPPORT_OWN_TICKETS_ONLY_ENABLED, true);
  const gorur = await listede(b.token);
  const d1 = await call(b.token, "GET", `/api/destek/${tid}`);
  check("§B6b ayar ACIK: B, A'nin talebini LISTEDE GORMEZ", !gorur, `listede=${gorur}`);
  check("§B6c ayar ACIK: B, A'nin talebini DETAYDA OKUYAMAZ (404 SUPPORT_TICKET_NOT_FOUND)",
    d1.status === 404 && codeOf(d1.json) === "SUPPORT_TICKET_NOT_FOUND", ozet(d1));
  const dA = await call(a.token, "GET", `/api/destek/${tid}`);
  check("§B6d ayar ACIK: sahibi kendi talebini gorur", (await listede(a.token)) && dA.status === 200, ozet(dA));
  const dY = await call(y.token, "GET", `/api/destek/${tid}`);
  check("§B6e ayar ACIK: admin:settings tasiyan yonetici hepsini gorur", (await listede(y.token)) && dY.status === 200, ozet(dY));
  await ayarYaz(SETTING_KEYS.SUPPORT_OWN_TICKETS_ONLY_ENABLED, false);
}

// ── B7: mobile:kk1-yalniz hesap feature-flags anlik goruntusunu okur ────────────
async function b7(): Promise<void> {
  console.log("\n§B7 — kimlikli-izinsiz feature-flags okuma [KARAR]");
  const K = await kisi("B7K", ["mobile:kk1"]);
  const k = await giris(K, "mobile");
  if (!k.token) { check("§B7 on kosul: mobile:kk1 aktor giris yapar", false, ozet(k.c)); return; }
  const ff = await call(k.token, "GET", "/api/feature-flags");
  const genis = ff.status === 200 && Object.keys(dataOf<Record<string, unknown>>(ff.json) ?? {}).length > 5;
  // KARAR: PIN-yalniz operator butun ayar anlik goruntusunu (modul/numara serisi/kunye) okumali mi?
  // BEYANLI KALAN (B7 bu dilimde duzeltilmedi — rapor "## Duzeltme"): bugunku genis yuzey
  // olculur; tablet izdusumu inince bu kontrol kirmiziya doner ve guvenli beklentiye cevrilir.
  check("§B7a [KALAN] mobile:kk1-yalniz hesap feature-flags anlik goruntusunu okur (izdusum yok — beyanli)",
    genis, `${ff.status} anahtarSayisi=${Object.keys(dataOf<Record<string, unknown>>(ff.json) ?? {}).length}`);
  check("§B7b (kayit) feature-flags yaniti sir TASIMIYOR (security.* dislanir)",
    !JSON.stringify(ff.json).toLowerCase().includes("passwordhash"), `genisYuzey=${genis}`);
}

async function temizle(): Promise<void> {
  await prisma.supportTicketReply.deleteMany({ where: { ticketId: { in: ids.tickets } } }).catch(() => {});
  await prisma.supportTicket.deleteMany({ where: { id: { in: ids.tickets } } }).catch(() => {});
  await prisma.workOrder.deleteMany({ where: { id: { in: ids.workOrders } } }).catch(() => {});
  await prisma.sack.deleteMany({ where: { shipmentId: { in: ids.shipments } } }).catch(() => {});
  await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } }).catch(() => {});
  await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } }).catch(() => {});
  await prisma.station.deleteMany({ where: { id: { in: ids.stations } } }).catch(() => {});
  await prisma.item.deleteMany({ where: { id: { in: ids.items } } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } }).catch(() => {});
  await prisma.credentialResetRequest.deleteMany({ where: { id: { in: ids.requests } } }).catch(() => {});
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.users, ...ids.requests] } } }).catch(() => {});
  await prisma.userPermission.deleteMany({ where: { userId: { in: ids.users } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { userId: { in: ids.users } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } }).catch(() => {});
}

main()
  .then(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    process.exitCode = fail > 0 ? 1 : 0;
  })
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    process.exitCode = 1;
  });
