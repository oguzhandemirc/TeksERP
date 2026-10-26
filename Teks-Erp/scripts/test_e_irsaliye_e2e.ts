// =============================================================================
// Test: e-İrsaliye UÇTAN UCA — HTTP akışı (E8-UCTAN, plan §1.4 · §3 · §4.3)
// =============================================================================
// v1'in ilan ettiği çıktıyı AKIŞLA ölçer (modul-bayrak.md: statik bekçi yetmez). Sunucu bu
// süreçte `app.listen(0)` ile açılır (ikinci backend süreci yok); DB = DATABASE_URL (_test).
// Sevkiyat fikstürle DISPATCHED doğar (ACTIVE kâğıt irsaliye snapshot'ı); sonrası tamamen HTTP.
//   §1 varsayılan kurulum: readiness YAPILANDIRILMAMIS · hazırla 409 · sevkiyat liste/detay/
//      storno önizlemesi e-İrsaliyesiz (yalnız opsiyonel alan) · liste süzgeci 400
//   §2 PATCH /api/feature-flags: yarım yapılandırma fail-closed · tanınmayan bağdaştırıcı 400 ·
//      künye + dışa aktar + yürürlük → HAZIR (ayar şifresi tanımlıysa §2 DB'ye düşer, beyanlı)
//   §3 hazırla (token replay) → üret → GET XML ucu yok → indir (XML yapısal doğrulama) →
//      gönderildi → storno önizleme = mutasyon 409 → yanıt KABUL → geri al (undo'suz 403)
//   §4 simülasyon: elle işaret 400 · gönder + sorgula belirlenimli · süzgeç SIMULASYON
//   §5 storno+kapat: önizleme numara boşluğunu söyler → kayıt IPTAL + olay
//   §6 izin matrisi (read'siz 403 · write'sız 403 · undo'suz 403) · §7 EXPORT 400
//   §8 eski panel e-İrsaliye alanı göndermeden ayar kaydeder → yapılandırma bozulmaz
//
// NEGATİF SONDA (2026-10-25, cp+md5 ile geri alındı; yeşilken):
//   `resolveUndoBlockReason`ten `if (eIrsBlock) return eIrsBlock;` kaldırıldı → 3 ❌
//   (§3g önizleme storno'ya izin verdi · §3h storno 200 döndü · §3h2 sevkiyat PLANNED'a düştü).
//
// Çalıştır: npx tsx scripts/test_e_irsaliye_e2e.ts
// =============================================================================
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import app from "../src/app";
import prisma from "../src/lib/prisma";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { DEFAULT_COMPANY_LEGAL_IDENTITY } from "../src/services/e-irsaliye/e-irsaliye-settings";
import { simulatedOutcome } from "../src/services/e-irsaliye/adapters/simulasyon.adapter";
import { validateDespatchXml } from "../src/services/e-irsaliye/despatch-advice.validate";
import { dispatchDoc, envelope } from "./fixture-e-irsaliye";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const P = `E8T${Date.now().toString(36).toUpperCase()}`;
// Sağlaması tutan KURGU kimlikler (gerçek kişi/firma değil) — E5/E6 bekçileriyle aynı.
const TCKN = "10000000146";
const VKN_SUPPLIER = "4721003456";
const VKN_CUSTOMER = "123456789" + vknCheck("123456789");
const FULL_ID = { ...DEFAULT_COMPANY_LEGAL_IDENTITY, kimlikNo: VKN_SUPPLIER, unvan: "Örnek Dokuma A.Ş.", vergiDairesi: "Uludağ", il: "Bursa", ilce: "Nilüfer" };
const DRIVER = { driverNationalId: TCKN };
const OPTIONAL_EIRS_KEYS = new Set(["eIrsaliyeStatus", "eIrsaliyeSimulasyon", "eIrsaliye"]);

function vknCheck(nine: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (Number(nine[i]) + 9 - i) % 10;
    sum += t === 9 ? 9 : (t * 2 ** (9 - i)) % 9;
  }
  return String((10 - (sum % 10)) % 10);
}

type Body = { success?: boolean; data?: any; message?: string; details?: { code?: string; [k: string]: unknown }; [k: string]: unknown };
type Resp = { status: number; body: Body };
let base = "";
async function call(method: string, path: string, token: string | null, body?: unknown): Promise<Resp> {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: Body = {};
  try { parsed = (await r.json()) as Body; } catch { /* boş gövde */ }
  return { status: r.status, body: parsed };
}
const codeOf = (r: Resp) => String(r.body.details?.code ?? "");
async function login(username: string, password: string): Promise<string> {
  const r = await call("POST", "/api/auth/login", null, { username, password, clientType: "electron" });
  const t = r.body.data?.token as string | undefined;
  if (!t) throw new Error(`login başarısız: ${username} (${r.status})`);
  return t;
}

let customerId = "";
const shipmentIds: string[] = [];
const userIds: string[] = [];
const savedSettings = new Map<string, unknown>();
const tok = { admin: "", none: "", read: "", write: "" };

async function makeShipment(tag: string, destination: "DOMESTIC" | "EXPORT" = "DOMESTIC") {
  const s = await prisma.shipment.create({
    data: { shipmentNo: `${P}-${tag}`, customerId, status: "DISPATCHED", destination, dispatchedAt: new Date(), plateNumber: "16 abc 123", driverName: "Ali Veli" },
    select: { id: true },
  });
  shipmentIds.push(s.id);
  const doc = dispatchDoc({ customerName: `${P} MUSTERI`, taxNumber: VKN_CUSTOMER, products: [{ name: "Ham bez 120", customerName: null, rollCount: 3, totalMeters: 300.5 } as never], totalKg: 75, sackCount: 1 });
  await prisma.printedDocument.create({ data: { docType: "SHIPMENT_DISPATCH", sourceId: s.id, version: 1, status: "ACTIVE", documentNo: `${P}-${tag}`, snapshot: envelope(doc) as never } });
  return s.id;
}

async function makeUser(tag: string, codes: string[]): Promise<string> {
  const username = `${P}-${tag}`.toLowerCase();
  const password = randomUUID();
  const u = await prisma.user.create({ data: { username, fullName: `${P} ${tag}`, passwordHash: await AuthService.hashPassword(password), isActive: true }, select: { id: true } });
  userIds.push(u.id);
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
  if (perms.length !== codes.length) throw new Error(`izin kataloğu eksik: ${codes.join(",")}`);
  await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: u.id, permissionId: p.id })) });
  return login(username, password);
}

const readiness = async () => (await call("GET", "/api/e-irsaliye/readiness", tok.admin)).body.data as { durum: string; eksikler: string[] };
const listRow = async (shipmentId: string, q = "") => {
  const r = await call("GET", `/api/shipping/shipments?search=${encodeURIComponent(P)}&limit=100${q}`, tok.admin);
  return { r, row: ((r.body.data ?? []) as Array<Record<string, unknown>>).find((x) => x.id === shipmentId) };
};
const eirsKeys = (o: Record<string, unknown> | undefined) => Object.keys(o ?? {}).filter((k) => /irsaliye/i.test(k));

let passwordFallback = false;
async function patchFlags(body: Record<string, unknown>): Promise<Resp> {
  if (passwordFallback) {
    if (body.companyLegalIdentity) await setSetting(SETTING_KEYS.COMPANY_LEGAL_IDENTITY, body.companyLegalIdentity);
    if (body.eIrsaliyeConfig) await setSetting(SETTING_KEYS.EIRSALIYE_CONFIG, body.eIrsaliyeConfig);
    return { status: 200, body: {} };
  }
  return call("PATCH", "/api/feature-flags", tok.admin, body);
}
async function setSetting(key: string, value: unknown) {
  await prisma.systemSetting.upsert({ where: { key }, update: { value: value as object }, create: { key, value: value as object } });
}

async function s1(shipA: string) {
  console.log("\n§1 varsayılan kurulum (yapılandırılmamış)");
  const rd = await readiness();
  check("§1a readiness YAPILANDIRILMAMIS + eksik listesi", rd.durum === "YAPILANDIRILMAMIS" && rd.eksikler.length > 0, rd.eksikler.join(" | "));
  const p = await call("POST", `/api/e-irsaliye/by-shipment/${shipA}`, tok.admin, { clientToken: randomUUID(), ...DRIVER });
  check("§1b hazırla 409 EIRSALIYE_NOT_CONFIGURED + Türkçe eksikler", p.status === 409 && codeOf(p) === "EIRSALIYE_NOT_CONFIGURED" && Array.isArray(p.body.details?.eksikler), `${p.status} ${codeOf(p)}`);
  check("§1c kayıt doğmadı", (await prisma.eIrsaliye.count({ where: { sourceId: shipA } })) === 0);
  const { r, row } = await listRow(shipA);
  check("§1d sevkiyat listesi: satır var, e-İrsaliye alanları yalnız opsiyonel ve boş", r.status === 200 && !!row && row.eIrsaliyeStatus === null && row.eIrsaliyeSimulasyon === false && eirsKeys(row).every((k) => OPTIONAL_EIRS_KEYS.has(k)), `${r.status} ${eirsKeys(row).join(",")}`);
  const f = await call("GET", `/api/shipping/shipments?filter[eIrsaliye]=EKSIK`, tok.admin);
  check("§1e e-İrsaliye süzgeci yapılandırılmamışta 400 (yok sayılmaz)", f.status === 400 && codeOf(f) === "EIRSALIYE_NOT_CONFIGURED", `${f.status} ${codeOf(f)}`);
  const pv = await call("GET", `/api/shipping/shipments/${shipA}/undo-dispatch-preview`, tok.admin);
  check("§1f storno önizlemesi: geri alınabilir, e-İrsaliye satırı null", pv.status === 200 && pv.body.data?.canUndo === true && pv.body.data?.eIrsaliye === null, `${pv.status} ${pv.body.data?.blockReason ?? ""}`);
  const d = await call("GET", `/api/shipping/shipments/${shipA}`, tok.admin);
  check("§1g sevkiyat detayı 200, zorunlu yeni e-İrsaliye alanı yok", d.status === 200 && eirsKeys(d.body.data).every((k) => OPTIONAL_EIRS_KEYS.has(k)), eirsKeys(d.body.data).join(","));
}

async function s2(shipA: string) {
  console.log("\n§2 yapılandırma kapısı (HTTP)");
  const ff = await call("GET", "/api/feature-flags", tok.admin);
  passwordFallback = ff.body.data?.settingsPasswordRequired === true || (ff.body as { settingsPasswordRequired?: boolean }).settingsPasswordRequired === true;
  if (passwordFallback) console.log("ℹ️ ayar şifresi tanımlı — §2 yazımları DB'den (şifre bekçiye yazılmaz); okuma ayağı HTTP");
  const half = await patchFlags({ eIrsaliyeConfig: { adapter: "disaAktar", yururlukTarihi: "2026-01-01" } });
  const rdHalf = await readiness();
  check("§2a yarım yapılandırma (künyesiz) → hâlâ YAPILANDIRILMAMIS, eksik künye", half.status === 200 && rdHalf.durum === "YAPILANDIRILMAMIS" && rdHalf.eksikler.some((m) => /künye/i.test(m)), `${half.status} ${rdHalf.eksikler.join(" | ")}`);
  const p = await call("POST", `/api/e-irsaliye/by-shipment/${shipA}`, tok.admin, { clientToken: randomUUID(), ...DRIVER });
  check("§2b yarım yapılandırmada XML yolu kapalı (409)", p.status === 409 && codeOf(p) === "EIRSALIYE_NOT_CONFIGURED");
  if (!passwordFallback) {
    const bad = await call("PATCH", "/api/feature-flags", tok.admin, { eIrsaliyeConfig: { adapter: "logo", yururlukTarihi: "2026-01-01" } });
    check("§2c tanınmayan bağdaştırıcı 400 (yok'a düşürülmez)", bad.status === 400, `${bad.status}`);
  }
  const full = await patchFlags({ companyLegalIdentity: FULL_ID });
  const rd = await readiness();
  check("§2d künye + dışa aktar + yürürlük → HAZIR", full.status === 200 && rd.durum === "HAZIR", `${full.status} ${rd.eksikler.join(" | ")}`);
}

async function s3(shipA: string) {
  console.log("\n§3 ana akış: hazırla → üret → indir → gönderildi → storno 409 → yanıt → geri al");
  const t = randomUUID();
  const p1 = await call("POST", `/api/e-irsaliye/by-shipment/${shipA}`, tok.admin, { clientToken: t, ...DRIVER });
  const rec = p1.body.data?.kayit as { id: string; status: string } | undefined;
  check("§3a hazırla → 201 TASLAK", p1.status === 201 && rec?.status === "TASLAK", `${p1.status}`);
  const p2 = await call("POST", `/api/e-irsaliye/by-shipment/${shipA}`, tok.admin, { clientToken: t, ...DRIVER });
  check("§3b aynı token replay → aynı kayıt, tek satır", p2.body.data?.kayit?.id === rec?.id && (await prisma.eIrsaliye.count({ where: { sourceId: shipA } })) === 1, `${p2.status}`);
  const id = rec?.id ?? randomUUID();
  const g = await call("POST", `/api/e-irsaliye/${id}/generate`, tok.admin);
  const docNo = String(g.body.data?.kayit?.documentNo ?? "");
  check("§3c üret → OLUSTURULDU, GİB biçimli numara + ETTN, yanıtta XML yok", g.status === 200 && g.body.data?.kayit?.status === "OLUSTURULDU" && /^EIR20\d{2}\d{9}$/.test(docNo) && /^[0-9a-f-]{36}$/.test(String(g.body.data?.kayit?.ettn)) && !JSON.stringify(g.body).includes("<DespatchAdvice"), docNo);
  const gx = await call("GET", `/api/e-irsaliye/${id}/xml`, tok.admin);
  check("§3d salt-okur GET XML ucu yok", gx.status === 404, `${gx.status}`);
  const dl = await call("POST", `/api/e-irsaliye/${id}/download`, tok.admin, {});
  const xml = String(dl.body.data?.xml ?? "");
  check("§3e indir → dosya adı + XML; yapısal doğrulama geçer, numara + alıcı VKN içinde", dl.status === 200 && dl.body.data?.dosyaAdi === `${docNo}.xml` && validateDespatchXml(xml).ok && xml.includes(docNo) && xml.includes(VKN_CUSTOMER), `${dl.status}`);
  check("§3e2 indirme sayacı", (await prisma.eIrsaliye.findUniqueOrThrow({ where: { id } })).downloadCount === 1);
  const ms = await call("POST", `/api/e-irsaliye/${id}/mark-sent`, tok.admin, { confirmedNo: docNo });
  check("§3f gönderildi işaretle → GONDERILDI", ms.status === 200 && (await prisma.eIrsaliye.findUniqueOrThrow({ where: { id } })).status === "GONDERILDI", `${ms.status}`);
  const pv = await call("GET", `/api/shipping/shipments/${shipA}/undo-dispatch-preview`, tok.admin);
  const reason = String(pv.body.data?.blockReason ?? "");
  check("§3g storno önizlemesi engelli, cümle GİB'i söyler", pv.body.data?.canUndo === false && /GİB'e gönderilmiş/.test(reason) && reason.includes(docNo), reason);
  const un = await call("POST", `/api/shipping/shipments/${shipA}/undo-dispatch`, tok.admin, { reason: "E8 storno denemesi" });
  check("§3h storno 409, önizlemeyle AYNI cümle", un.status === 409 && reason !== "" && JSON.stringify(un.body).includes(reason), `${un.status}`);
  check("§3h2 sevkiyat DISPATCHED kaldı", (await prisma.shipment.findUniqueOrThrow({ where: { id: shipA } })).status === "DISPATCHED");
  const resp = await call("POST", `/api/e-irsaliye/${id}/response`, tok.write, { durum: "KABUL", not: "Teslim alındı" });
  check("§3i yanıt KABUL (write yeter)", resp.status === 200 && (await prisma.eIrsaliye.findUniqueOrThrow({ where: { id } })).status === "KABUL", `${resp.status}`);
  const u1 = await call("POST", `/api/e-irsaliye/${id}/undo-response`, tok.write);
  check("§3j yanıtı geri al: eirsaliye:undo'suz 403", u1.status === 403, `${u1.status}`);
  const u2 = await call("POST", `/api/e-irsaliye/${id}/undo-response`, tok.admin);
  const ev = await prisma.eIrsaliyeEvent.findMany({ where: { eIrsaliyeId: id }, select: { type: true } });
  check("§3k undo yetkilisi geri alır → GONDERILDI; ileri olay duruyor", u2.status === 200 && (await prisma.eIrsaliye.findUniqueOrThrow({ where: { id } })).status === "GONDERILDI" && ev.length >= 5, `${u2.status} olay=${ev.length}`);
  const ls = await call("GET", `/api/e-irsaliye?filter[status]=GONDERILDI&search=${encodeURIComponent(docNo)}`, tok.admin);
  check("§3l kayıtlar listesi süzgeci kaydı bulur", ls.status === 200 && ((ls.body.data ?? []) as Array<{ id: string }>).some((x) => x.id === id), `${ls.status}`);
}

async function s4(shipC: string, shipA: string) {
  console.log("\n§4 simülasyon bağdaştırıcısı");
  await patchFlags({ eIrsaliyeConfig: { adapter: "simulasyon", yururlukTarihi: "2026-01-01" } });
  const p = await call("POST", `/api/e-irsaliye/by-shipment/${shipC}`, tok.admin, { clientToken: randomUUID(), ...DRIVER });
  const id = String(p.body.data?.kayit?.id ?? randomUUID());
  const g = await call("POST", `/api/e-irsaliye/${id}/generate`, tok.admin);
  check("§4a simülasyon kaydı her yüzeyde işaretli", g.status === 200 && g.body.data?.kayit?.simulasyon === true, `${g.status}`);
  const ms = await call("POST", `/api/e-irsaliye/${id}/mark-sent`, tok.admin, {});
  check("§4b simülasyonda elle işaret 400", ms.status === 400 && codeOf(ms) === "EIRSALIYE_MANUAL_ONLY", `${ms.status} ${codeOf(ms)}`);
  const sd = await call("POST", `/api/e-irsaliye/${id}/send`, tok.admin);
  check("§4c gönder → GONDERILDI (ağ yok)", sd.status === 200 && sd.body.data?.status === "GONDERILDI", `${sd.status}`);
  const pl = await call("POST", `/api/e-irsaliye/${id}/poll`, tok.admin);
  const want = simulatedOutcome(String(g.body.data?.kayit?.ettn));
  check("§4d sorgu belirlenimli (ETTN kuralı)", pl.status === 200 && pl.body.data?.status === want, `${pl.body.data?.status} beklenen ${want}`);
  const { row } = await listRow(shipC, "&filter[eIrsaliye]=SIMULASYON");
  const { row: rowA } = await listRow(shipA, "&filter[eIrsaliye]=SIMULASYON");
  check("§4e sevkiyat süzgeci SIMULASYON: simülasyonlu satır var, dışa aktarılan yok", !!row && row.eIrsaliyeSimulasyon === true && !rowA);
}

async function s5(shipB: string) {
  console.log("\n§5 storno + kapat → kayıt IPTAL, numara boşluğu önizlemede");
  const p = await call("POST", `/api/e-irsaliye/by-shipment/${shipB}`, tok.admin, { clientToken: randomUUID(), ...DRIVER });
  const id = String(p.body.data?.kayit?.id ?? randomUUID());
  await call("POST", `/api/e-irsaliye/${id}/generate`, tok.admin);
  const pv = await call("GET", `/api/shipping/shipments/${shipB}/undo-dispatch-preview`, tok.admin);
  const row = pv.body.data?.eIrsaliye as { id?: string; numaraBosaDuser?: boolean; yerelIptalEdilebilir?: boolean } | null;
  check("§5a önizleme etkilenen kaydı listeler: numara boşa düşer, yerel iptal edilebilir", pv.body.data?.canUndo === true && row?.id === id && row?.numaraBosaDuser === true && row?.yerelIptalEdilebilir === true);
  const un = await call("POST", `/api/shipping/shipments/${shipB}/undo-dispatch`, tok.admin, { reason: "E8 storno kapat", releaseSacks: true });
  const rec = await prisma.eIrsaliye.findUniqueOrThrow({ where: { id } });
  const ev = await prisma.eIrsaliyeEvent.count({ where: { eIrsaliyeId: id, type: "IPTAL_EDILDI" } });
  check("§5b storno+kapat 200 → kayıt IPTAL + IPTAL_EDILDI olayı", un.status === 200 && rec.status === "IPTAL" && ev === 1, `${un.status} ${rec.status}`);
}

async function s6(shipA: string) {
  console.log("\n§6 izin matrisi");
  const n1 = await call("GET", "/api/e-irsaliye", tok.none);
  const n2 = await call("GET", `/api/e-irsaliye/by-shipment/${shipA}`, tok.none);
  check("§6a eirsaliye:read'siz → liste ve sevkiyat görünümü 403", n1.status === 403 && n2.status === 403, `${n1.status} ${n2.status}`);
  const r1 = await call("GET", `/api/e-irsaliye/by-shipment/${shipA}`, tok.read);
  const r2 = await call("POST", `/api/e-irsaliye/by-shipment/${shipA}`, tok.read, { clientToken: randomUUID() });
  check("§6b read'li görür (200), write'sız hazırlayamaz (403)", r1.status === 200 && r2.status === 403, `${r1.status} ${r2.status}`);
  const live = await prisma.eIrsaliye.findFirstOrThrow({ where: { sourceId: shipA, status: { not: "IPTAL" } } });
  const r3 = await call("GET", `/api/e-irsaliye/${live.id}/undo-preview`, tok.read);
  check("§6c undo önizlemesi eirsaliye:undo ister (403)", r3.status === 403, `${r3.status}`);
}

async function main() {
  const admin = await ensureTestAdmin();
  for (const k of [SETTING_KEYS.COMPANY_LEGAL_IDENTITY, SETTING_KEYS.EIRSALIYE_CONFIG]) {
    savedSettings.set(k, (await prisma.systemSetting.findUnique({ where: { key: k } }))?.value ?? null);
    await prisma.systemSetting.deleteMany({ where: { key: k } }); // varsayılan = bugünkü davranış
  }
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    tok.admin = await login(admin.username, admin.password);
    tok.none = await makeUser("none", ["shipping:read"]);
    tok.read = await makeUser("read", ["eirsaliye:read"]);
    tok.write = await makeUser("write", ["eirsaliye:read", "eirsaliye:write"]);
    customerId = (await prisma.customer.create({
      data: { code: `${P}-C`, name: `${P} MUSTERI`, taxNumber: VKN_CUSTOMER, city: "İstanbul", district: "Kadıköy", address: "Moda Cad. 1", country: "Türkiye" },
      select: { id: true },
    })).id;
    const A = await makeShipment("A");
    const B = await makeShipment("B");
    const C = await makeShipment("C");
    const X = await makeShipment("X", "EXPORT");
    await s1(A);
    await s2(A);
    await s3(A);
    await s4(C, A);
    await s5(B);
    await s6(A);
    console.log("\n§7 ihracat");
    const x = await call("POST", `/api/e-irsaliye/by-shipment/${X}`, tok.admin, { clientToken: randomUUID(), ...DRIVER });
    check("§7 EXPORT sevkiyat → 400 EIRSALIYE_EXPORT", x.status === 400 && codeOf(x) === "EIRSALIYE_EXPORT", `${x.status} ${codeOf(x)}`);
    console.log("\n§8 eski istemci");
    if (!passwordFallback) {
      const old = await call("PATCH", "/api/feature-flags", tok.admin, {});
      check("§8 e-İrsaliye alanı göndermeyen ayar kaydı yapılandırmayı bozmaz", (await readiness()).durum === "HAZIR", `${old.status}`);
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function temizlik(): Promise<void> {
  const ids = (await prisma.eIrsaliye.findMany({ where: { sourceId: { in: shipmentIds } }, select: { id: true } })).map((r) => r.id);
  await prisma.eIrsaliye.updateMany({ where: { id: { in: ids } }, data: { replacesId: null } });
  await prisma.eIrsaliye.deleteMany({ where: { id: { in: ids } } });
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentIds } } });
  await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
  if (customerId) await cleanupTestCustomers([customerId]);
  await prisma.systemLog.deleteMany({ where: { userId: { in: userIds } } }); // _test DB fikstürü; kullanıcının audit izi
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } }); // login oturumları
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  for (const [key, value] of savedSettings) {
    if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
    else await setSetting(key, value);
  }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    try { await temizlik(); } catch (e) { console.error("❌ temizlik düştü:", e); fail++; }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
