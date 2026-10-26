// =============================================================================
// BEKÇİ: K4P sertifikaları + belge ekleri + müşteri lab spesifikasyonu + süre bildirimi (K4P-SERT)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_sertifika
// =============================================================================
// NEDEN: sertifika belgesi müşteriye/denetçiye gösterilen kanıttır — `.exe` baytı "PDF" beyanıyla
// girerse indirildiğinde çalıştırılabilir dosya dağıtırız; süresi dolan sertifika fark edilmezse
// sevkiyat geçersiz belgeyle çıkar. Bekçi kuralı servis + DB CHECK + HTTP + bildirim motorunda ölçer:
//   §1 DB CHECK'leri (OWN ⇔ partner yok · iptal ⇔ gerekçe · tarih · 5 MB · tür) + servis 400'leri
//   §2 oluştur + clientToken replay (aynı kayıt) + çarpışma 409
//   §3 belge (HTTP): PDF/JPEG/PNG kabul · `MZ` baytı `application/pdf` beyanıyla RED · 5 MB+1 RED ·
//      aynı dosya → aynı kayıt · ad temizlenir · indirme ikili + attachment · audit yükünde bayt yok
//   §4 yenile (eski etkisiz, ikinci yenileme 409) · iptal (gerekçe ≥ 3, ikinci iptal 409, iptale belge 409)
//   §5 süre yüklemi: liste süzgeci = `certificateExpiryWhere` = bellek ikizi; özet şeridi listeyle tutarlı
//   §6 müşteri spesifikasyonu: sınır dışı sonuç FAIL (müşteri sınırı snapshot) · ürün satırı geneli ezer ·
//      çift aktif 409 · PASS_FAIL türüne sınır 400
//   §7 bildirim: açılır → tek ACILDI · 3 tur sürer → yeni satır yok · yenilenir → KAPANDI · modül kapalı → boş
//   §8 HTTP kapıları: modül kapalı 403 MODULE_DISABLED · izinsiz 403 · okuma izniyle yazma 403
// Negatif sondalar (PR gövdesinde): sihirli bayt kontrolü kaldırılınca §3 `.exe` ayağı ❌ · konu anahtarına
// tur damgası eklenince §7 bastırma ayağı ❌ · müşteri spesifikasyonu çözümü kaldırılınca §6 "uygunsuz" ayağı ❌.
// =============================================================================
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as bcrypt from "bcryptjs";
import prisma, { pool } from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createCertificate, renewCertificate, revokeCertificate } from "../src/services/certificate.service";
import { listCertificates } from "../src/services/certificate-query.service";
import { certificateExpiryWhere, certificateToday, isCertificateExpiring } from "../src/services/helpers/certificate-active.helper";
import { createCustomerLabSpec } from "../src/services/customer-lab-spec.service";
import { createLabTest, upsertLabResult } from "../src/services/lab-test.service";
import { createLabTestType } from "../src/services/lab-test-type.service";
import { runConditionSourceOnce } from "../src/jobs/notification-condition.job";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { CERTIFICATE_EXPIRY_KIND, registerQualityConditionSources } from "../src/services/notification-sources/kalite";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

async function errCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    const d = (e as { details?: { code?: string } }).details;
    return d?.code ?? (e as { code?: string }).code ?? String(e);
  }
}

async function rawAttempt(sql: string, params: unknown[]): Promise<string> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(sql, params);
    return "OK";
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    return `${err.code} ${err.constraint ?? ""}`.trim();
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
}

const TAG = `SRT${Date.now().toString(36).toUpperCase()}`;
const BASLANGIC = new Date();
const DAY = 86_400_000;
const made = { customers: [] as string[], items: [] as string[], types: [] as string[], users: [] as string[], wos: [] as string[], batches: [] as string[], rolls: [] as string[] };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dayFromToday = (n: number) => ymd(new Date(certificateToday().getTime() + n * DAY));

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(`${TAG} sertifika`)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} jpeg`)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${TAG} png`)]);
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 0x90), Buffer.from(`${TAG} exe`)]);

async function ayar(key: string, v: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

async function mkCustomer(suffix: string): Promise<string> {
  const c = await prisma.customer.create({ data: { code: `${TAG}-${suffix}`, name: `${TAG} cari ${suffix}` }, select: { id: true } });
  made.customers.push(c.id);
  return c.id;
}

const base = (o: Partial<Parameters<typeof createCertificate>[0]> = {}) => ({
  holder: "OWN" as const, standard: "OEKO-TEX Standard 100", certificateNo: `${TAG}-${randomUUID().slice(0, 6)}`,
  expiresOn: dayFromToday(200), ...o,
});

// ── §1 ──────────────────────────────────────────────────────────────────────────
async function sectionChecks(adminId: string, partnerId: string) {
  console.log("§1 DB CHECK + servis doğrulaması");
  const ins = (holder: string, partner: string | null, extra = "") =>
    rawAttempt(`INSERT INTO certificates (id, holder, "partnerId", standard, "certificateNo", "expiresOn", "updatedAt"${extra ? ", " + extra.split("=")[0] : ""}) VALUES ($1, $2::"CertificateHolder", $3, 'GOTS', $4, current_date, now()${extra ? ", " + extra.split("=")[1] : ""})`,
      [randomUUID(), holder, partner, `${TAG}-RAW`]);
  check("CHECK: OWN + partnerId → 23514", (await ins("OWN", partnerId)) === "23514 certificates_holder_ck");
  check("CHECK: PARTNER partnerId'siz → 23514", (await ins("PARTNER", null)) === "23514 certificates_holder_ck");
  check("CHECK: iptal damgası gerekçesiz → 23514", (await ins("OWN", null, `"revokedAt"=now()`)) === "23514 certificates_revoked_ck");
  const cert = await createCertificate(base(), adminId);
  const f = (size: number, mime: string, bytes: number) =>
    rawAttempt(`INSERT INTO certificate_files (id, "certificateId", "fileName", "mimeType", "sizeBytes", sha256, content, "updatedAt") VALUES ($1, $2, 'x.pdf', $3, $4, repeat('a', 64), $5, now())`,
      [randomUUID(), cert.id, mime, size, Buffer.alloc(bytes, 1)]);
  check("CHECK: 5 MB + 1 bayt → 23514", (await f(5_242_881, "application/pdf", 5_242_881)) === "23514 certificate_files_size_ck");
  check("CHECK: beyan boy ≠ gerçek bayt → 23514", (await f(10, "application/pdf", 9)) === "23514 certificate_files_size_ck");
  check("CHECK: tanınmayan tür → 23514", (await f(4, "application/x-msdownload", 4)) === "23514 certificate_files_mime_ck");
  check("servis: PARTNER iş ortağısız → 400", (await errCode(createCertificate(base({ holder: "PARTNER" }), adminId))) === "CERTIFICATE_PARTNER_REQUIRED");
  check("servis: OWN + iş ortağı → 400", (await errCode(createCertificate(base({ partnerId }), adminId))) === "CERTIFICATE_PARTNER_FORBIDDEN");
  check("servis: düzenleme > geçerlilik sonu → 400", (await errCode(createCertificate(base({ issuedOn: dayFromToday(-1), expiresOn: dayFromToday(-5) }), adminId))) === "CERTIFICATE_DATE_INVALID");
  check("servis: bozuk tarih → 400", (await errCode(createCertificate(base({ expiresOn: "2026-02-30" }), adminId))) === "CERTIFICATE_DATE_INVALID");
  const partnerCert = await createCertificate(base({ holder: "PARTNER", partnerId, standard: "GOTS" }), adminId);
  check("PARTNER sertifika iş ortağıyla doğar", partnerCert.partnerId === partnerId && partnerCert.partner?.id === partnerId && partnerCert.active);
  return cert.id;
}

// ── §2 ──────────────────────────────────────────────────────────────────────────
async function sectionReplay(adminId: string) {
  console.log("§2 clientToken replay");
  const token = randomUUID();
  const input = base({ clientToken: token });
  const a = await createCertificate(input, adminId);
  const b = await createCertificate(input, adminId);
  check("aynı token → aynı kayıt (ikinci satır yok)", a.id === b.id && (await prisma.certificate.count({ where: { clientToken: token } })) === 1);
  check("aynı token, başka numara → 409 CLIENT_TOKEN_COLLISION", (await errCode(createCertificate({ ...input, certificateNo: `${TAG}-BASKA` }, adminId))) === "CLIENT_TOKEN_COLLISION");
}

// ── §3 + §8 (HTTP) ─────────────────────────────────────────────────────────────
async function sectionHttp(admin: { id: string; username: string; password: string }, certId: string, revokedLater: () => Promise<string>) {
  console.log("§3 belge ekleri + §8 HTTP kapıları");
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const login = async (username: string, password: string) => {
      const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
      return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
    };
    const call = async (method: string, path: string, token: string, body?: unknown) => {
      const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: { file?: { id: string; fileName: string; mimeType: string }; duplicate?: boolean }; details?: { code?: string } };
      return { status: r.status, code: j.details?.code, data: j.data };
    };
    const tk = await login(admin.username, admin.password);
    check("admin login", tk.length > 0);
    const up = (buf: Buffer, fileName: string, extra: Record<string, unknown> = {}) =>
      call("POST", `/api/certificates/${certId}/files`, tk, { fileName, contentBase64: buf.toString("base64"), ...extra });

    const pdf = await up(PDF, "OEKO-TEX 2026.pdf");
    check("PDF kabul → 201 + tür sihirli bayttan", pdf.status === 201 && pdf.data?.file?.mimeType === "application/pdf", `${pdf.status} ${pdf.code ?? ""}`);
    const jpg = await up(JPEG, "tarama", { mimeType: "application/pdf" });
    check("JPEG kabul — beyan edilen mime yok sayılır, uzantı eklenir", jpg.status === 201 && jpg.data?.file?.mimeType === "image/jpeg" && jpg.data.file.fileName === "tarama.jpg", `${jpg.data?.file?.mimeType} ${jpg.data?.file?.fileName}`);
    const png = await up(PNG, "../../etc/pass\u0001wd.png");
    check("PNG kabul + ad temizlenir (yol ayırıcı, kontrol karakteri)", png.status === 201 && png.data?.file?.fileName === "passwd.png", `${png.data?.file?.fileName}`);
    const exe = await up(EXE, "rapor.pdf", { mimeType: "application/pdf" });
    check("⭐ `.exe` (MZ) baytı application/pdf beyanıyla → 400 CERTIFICATE_FILE_TYPE", exe.status === 400 && exe.code === "CERTIFICATE_FILE_TYPE", `${exe.status} ${exe.code}`);
    const big = await up(Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024 + 1 - PDF.length, 0x20)]), "buyuk.pdf");
    check("5 MB + 1 bayt → 400 CERTIFICATE_FILE_TOO_LARGE", big.status === 400 && big.code === "CERTIFICATE_FILE_TOO_LARGE", `${big.status} ${big.code}`);
    const exact = await up(Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024 - PDF.length, 0x20)]), "tam5.pdf");
    check("tam 5 MB → 201 (8 MB gövde katmanından geçer)", exact.status === 201, `${exact.status} ${exact.code ?? ""}`);
    const again = await up(PDF, "baska-ad.pdf");
    check("aynı dosya → 200 + mevcut kayıt (ikinci satır yok)", again.status === 200 && again.data?.duplicate === true && again.data.file?.id === pdf.data?.file?.id
      && (await prisma.certificateFile.count({ where: { certificateId: certId } })) === 4);
    const bad = await call("POST", `/api/certificates/${certId}/files`, tk, { fileName: "x.pdf", contentBase64: "%%%bozuk" });
    check("bozuk base64 → 400", bad.status === 400 && bad.code === "CERTIFICATE_FILE_INVALID");

    const dl = await fetch(`${url}/api/certificates/${certId}/files/${pdf.data?.file?.id}`, { headers: { Authorization: `Bearer ${tk}` } });
    const dlBuf = Buffer.from(await dl.arrayBuffer());
    check("indirme: ikili + Content-Disposition attachment + bayt-eşit",
      dl.status === 200 && (dl.headers.get("content-disposition") ?? "").startsWith("attachment;") && dl.headers.get("content-type") === "application/pdf" && dlBuf.equals(PDF),
      `${dl.status} ${dl.headers.get("content-disposition")}`);
    const detail = await call("GET", `/api/certificates/${certId}`, tk);
    check("ayrıntı yanıtında bayt yok", !JSON.stringify(detail.data).includes(PDF.toString("base64")) && !JSON.stringify(detail.data).includes("\"content\""));

    const logs = await prisma.systemLog.findMany({ where: { tableName: "CERTIFICATE_FILE", recordId: { in: [pdf.data?.file?.id ?? "", jpg.data?.file?.id ?? ""] } }, select: { oldData: true, newData: true } });
    const logText = JSON.stringify(logs);
    check("⭐ audit yükünde dosya baytı yok (yalnız künye)", logs.length >= 2 && !logText.includes(PDF.toString("base64")) && !logText.includes(JPEG.toString("base64")) && !logText.includes("\"content\"") && logText.includes("sha256"), `${logs.length} satır`);

    const del = await call("DELETE", `/api/certificates/${certId}/files/${png.data?.file?.id}`, tk);
    check("etkin sertifikada belge kaldırılır", del.status === 200 && (await prisma.certificateFile.count({ where: { id: png.data?.file?.id } })) === 0);
    const revokedId = await revokedLater();
    const upRevoked = await call("POST", `/api/certificates/${revokedId}/files`, tk, { fileName: "x.pdf", contentBase64: PDF.toString("base64") });
    check("iptal edilmiş sertifikaya belge → 409", upRevoked.status === 409 && upRevoked.code === "CERTIFICATE_NOT_ACTIVE");

    // §8 kapılar
    const parola = kosumaOzguParola();
    const mk = async (suffix: string, perms: string[]) => {
      const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
      const u = await prisma.user.create({
        data: { username: `${TAG}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
        select: { id: true, username: true },
      });
      made.users.push(u.id);
      return login(u.username, parola);
    };
    const reader = await mk("okur", ["certificate:read"]);
    const none = await mk("yok", ["roll:read"]);
    await ayar(SETTING_KEYS.KALITE_GUVENCE_ENABLED, false);
    const off = await call("GET", "/api/certificates", tk);
    check("modül kapalı → 403 MODULE_DISABLED", off.status === 403 && off.code === "MODULE_DISABLED", `${off.status} ${off.code}`);
    const offSpec = await call("GET", "/api/customer-lab-specs", tk);
    check("modül kapalı (spesifikasyon) → 403 MODULE_DISABLED", offSpec.status === 403 && offSpec.code === "MODULE_DISABLED");
    await ayar(SETTING_KEYS.KALITE_GUVENCE_ENABLED, true);
    check("certificate:read ile liste 200", (await call("GET", "/api/certificates", reader)).status === 200);
    check("certificate:read ile ekleme 403", (await call("POST", "/api/certificates", reader, base())).status === 403);
    check("certificate:read ile belge yükleme 403", (await call("POST", `/api/certificates/${certId}/files`, reader, { contentBase64: PDF.toString("base64") })).status === 403);
    check("izinsiz liste 403", (await call("GET", "/api/certificates", none)).status === 403);
    check("izinsiz indirme 403", (await fetch(`${url}/api/certificates/${certId}/files/${pdf.data?.file?.id}`, { headers: { Authorization: `Bearer ${none}` } })).status === 403);
    check("tanınmayan durum süzgeci → 400", (await call("GET", "/api/certificates?status=bogus", tk)).status === 400);
    const strict = await call("POST", "/api/certificates", tk, { ...base(), bogus: 1 });
    check("strict gövde: tanınmayan alan → 400", strict.status === 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

// ── §4 ──────────────────────────────────────────────────────────────────────────
async function sectionRenewRevoke(adminId: string) {
  console.log("§4 yenile + iptal");
  const old = await createCertificate(base({ expiresOn: dayFromToday(5) }), adminId);
  const next = await renewCertificate(old.id, { ...base({ expiresOn: dayFromToday(370) }), clientToken: randomUUID() }, adminId);
  const oldAfter = await prisma.certificate.findUnique({ where: { id: old.id }, select: { expiresOn: true, revokedAt: true, renewedBy: { select: { id: true } } } });
  check("yenileme: yeni satır renewsId = eski; eski satır değişmedi ama etkin değil",
    next.renewsId === old.id && next.active && oldAfter?.renewedBy?.id === next.id && oldAfter.revokedAt === null && ymd(oldAfter.expiresOn) === dayFromToday(5));
  const activeIds = new Set((await listCertificates({ status: "active", q: TAG, limit: 200 })).items.map((i) => i.id));
  check("etkin liste eskiyi içermez, yeniyi içerir", !activeIds.has(old.id) && activeIds.has(next.id));
  check("ikinci yenileme → 409", (await errCode(renewCertificate(old.id, base(), adminId))) === "CERTIFICATE_NOT_ACTIVE");
  check("iptal gerekçe < 3 → 400", (await errCode(revokeCertificate(next.id, "ab", adminId))) === "CERTIFICATE_REASON_REQUIRED");
  const rv = await revokeCertificate(next.id, "Belge sahte çıktı", adminId);
  check("iptal: damga + gerekçe + etkin değil", rv.revokedAt !== null && rv.revokeReason === "Belge sahte çıktı" && !rv.active);
  check("ikinci iptal → 409", (await errCode(revokeCertificate(next.id, "tekrar", adminId))) === "CERTIFICATE_NOT_ACTIVE");
  check("yenilenmiş (etkisiz) sertifikanın iptali → 409", (await errCode(revokeCertificate(old.id, "eski", adminId))) === "CERTIFICATE_NOT_ACTIVE");
  return next.id;
}

// ── §5 ──────────────────────────────────────────────────────────────────────────
async function sectionExpiry(adminId: string) {
  console.log("§5 süre yüklemi (tek kaynak)");
  const soon = await createCertificate(base({ expiresOn: dayFromToday(10), standard: "GRS" }), adminId);
  const far = await createCertificate(base({ expiresOn: dayFromToday(40) }), adminId);
  const past = await createCertificate(base({ expiresOn: dayFromToday(-2) }), adminId);
  const todayCert = await createCertificate(base({ expiresOn: dayFromToday(0) }), adminId);
  check("kalan gün tam sayı (10 · 40 · -2 · 0)", soon.daysLeft === 10 && far.daysLeft === 40 && past.daysLeft === -2 && todayCert.daysLeft === 0);
  const expiring = await listCertificates({ status: "expiring", days: 30, q: TAG, limit: 200 });
  const ids = new Set(expiring.items.map((i) => i.id));
  check("süresi yaklaşan (30): 10 gün + bugün + süresi geçmiş VAR, 40 gün YOK", ids.has(soon.id) && ids.has(past.id) && ids.has(todayCert.id) && !ids.has(far.id));
  const expired = new Set((await listCertificates({ status: "expired", q: TAG, limit: 200 })).items.map((i) => i.id));
  check("süresi geçmiş: yalnız -2 gün (bugün dolan hâlâ geçerli)", expired.has(past.id) && !expired.has(todayCert.id) && !expired.has(soon.id));
  const today = certificateToday();
  const dbIds = new Set((await prisma.certificate.findMany({ where: { AND: [certificateExpiryWhere(today, 30), { certificateNo: { startsWith: TAG } }] }, select: { id: true } })).map((r) => r.id));
  const mem = await prisma.certificate.findMany({ where: { certificateNo: { startsWith: TAG } }, select: { id: true, revokedAt: true, expiresOn: true, renewedBy: { select: { id: true } } } });
  const memIds = new Set(mem.filter((c) => isCertificateExpiring(c, today, 30)).map((c) => c.id));
  check("boğaz-ikiz: Prisma parçası = bellek yüklemi = liste süzgeci",
    dbIds.size === memIds.size && [...dbIds].every((i) => memIds.has(i)) && dbIds.size === ids.size && [...ids].every((i) => dbIds.has(i)), `${dbIds.size} kayıt`);
  check("özet şeridi listeyle tutarlı (aynı taban)", expiring.summary.expiring === expiring.items.length && expiring.summary.days === 30);
  check("gün süzgeci sınır dışı → 400", (await errCode(listCertificates({ days: -1 }))) === "CERTIFICATE_FILTER_INVALID");
  return { soonId: soon.id, farId: far.id };
}

// ── §6 ──────────────────────────────────────────────────────────────────────────
async function sectionCustomerSpec(adminId: string, customerId: string) {
  console.log("§6 müşteri lab spesifikasyonu");
  const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } });
  made.items.push(item.id);
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetQuantity: 100, targetItemId: item.id }, select: { id: true } });
  made.wos.push(wo.id);
  const batch = await prisma.batch.create({ data: { batchNumber: `${TAG}-P`, workOrderId: wo.id }, select: { id: true } });
  made.batches.push(batch.id);
  const gsm = await createLabTestType({ code: `${TAG}G`, name: "Gramaj", resultKind: "NUMERIC", unit: "g/m²", specMin: 180, specMax: 260 }, adminId);
  const pf = await createLabTestType({ code: `${TAG}F`, name: "Yanmazlık", resultKind: "PASS_FAIL" }, adminId);
  const wash = await createLabTestType({ code: `${TAG}W`, name: "Yıkama", resultKind: "NUMERIC", specMin: 1 }, adminId);
  made.types.push(gsm.id, pf.id, wash.id);
  await createCustomerLabSpec({ customerId, testTypeId: gsm.id, specMin: 200, specMax: 220 }, adminId);
  check("çift aktif genel spesifikasyon → 409", (await errCode(createCustomerLabSpec({ customerId, testTypeId: gsm.id, specMin: 1 }, adminId))) === "CUSTOMER_SPEC_DUPLICATE");
  check("PASS_FAIL türüne sınır → 400", (await errCode(createCustomerLabSpec({ customerId, testTypeId: pf.id, specMin: 1 }, adminId))) === "CUSTOMER_SPEC_INVALID");
  check("sınırsız spesifikasyon → 400", (await errCode(createCustomerLabSpec({ customerId, testTypeId: wash.id }, adminId))) === "CUSTOMER_SPEC_INVALID");
  const r = await rawAttempt(`INSERT INTO customer_lab_specs (id, "customerId", "testTypeId", "specMin", "specMax", "updatedAt") VALUES ($1, $2, $3, 5, 1, now())`, [randomUUID(), customerId, wash.id]);
  check("CHECK: alt > üst → 23514", r === "23514 customer_lab_specs_bounds_ck", r);

  const withCustomer = await createLabTest({ batchId: batch.id, customerId }, adminId);
  const t1 = await upsertLabResult(withCustomer.id, { testTypeId: gsm.id, value: 240 }, adminId);
  const res1 = t1.results.find((x) => x.testTypeId === gsm.id);
  check("⭐ müşteri sınırı dışı (240 ∉ 200–220) → FAIL AUTO; tür varsayılanı (180–260) EZİLDİ",
    res1?.verdict === "FAIL" && res1.verdictSource === "AUTO" && Number(res1.specMin) === 200 && Number(res1.specMax) === 220, `${res1?.verdict} ${res1?.specMin}–${res1?.specMax}`);
  const noCustomer = await createLabTest({ batchId: batch.id }, adminId);
  const t2 = await upsertLabResult(noCustomer.id, { testTypeId: gsm.id, value: 240 }, adminId);
  check("müşterisiz test tür varsayılanıyla PASS", t2.results[0]?.verdict === "PASS" && Number(t2.results[0]?.specMax) === 260);
  await createCustomerLabSpec({ customerId, itemId: item.id, testTypeId: gsm.id, specMin: 230, specMax: 250 }, adminId);
  const t3 = await upsertLabResult(withCustomer.id, { testTypeId: gsm.id, value: 240 }, adminId);
  check("müşteri+ürün satırı müşteri genelini ezer (230–250 → PASS)", t3.results[0]?.verdict === "PASS" && Number(t3.results[0]?.specMin) === 230);
  const t4 = await upsertLabResult(withCustomer.id, { testTypeId: gsm.id, value: 240, specMin: null, specMax: 235 }, adminId);
  check("elle verilen sınır müşteri spesifikasyonunu ezer", t4.results[0]?.verdict === "FAIL" && Number(t4.results[0]?.specMax) === 235);
  check("lab testi müşteriyi taşır", t4.customer?.id === customerId);
}

// ── §7 ──────────────────────────────────────────────────────────────────────────
async function sectionNotification(adminId: string, soonId: string, farId: string) {
  console.log("§7 bildirim koşulu (sertifika süresi doluyor)");
  registerQualityConditionSources();
  const kind = CERTIFICATE_EXPIRY_KIND;
  const acildi = () => prisma.notificationOutbox.count({ where: { kind, subjectKey: soonId, phase: "ACILDI", createdAt: { gte: BASLANGIC } } });
  const acildiTur = async () => {
    const mine = new Set((await prisma.certificate.findMany({ where: { certificateNo: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id));
    const rows = await prisma.notificationOutbox.findMany({ where: { kind, phase: "ACILDI", createdAt: { gte: BASLANGIC } }, select: { subjectKey: true } });
    return rows.filter((r) => mine.has(r.subjectKey.split(":")[0]!)).length;
  };
  const kapandi = () => prisma.notificationOutbox.count({ where: { kind, subjectKey: soonId, phase: "KAPANDI", createdAt: { gte: BASLANGIC } } });
  const acik = (key: string) => prisma.notificationCondition.findFirst({ where: { kind, subjectKey: key, resolvedAt: null } });

  const r1 = await runConditionSourceOnce(kind);
  const opened = await acildiTur();
  check("açılır → konu başına tek ACILDI; 40 günlük açılmaz", typeof r1 === "object" && (await acildi()) === 1 && !!(await acik(soonId)) && !(await acik(farId)), `${JSON.stringify(r1)} benim ACILDI=${opened}`);
  const cond = await acik(soonId);
  const payload = (cond?.payload ?? {}) as Record<string, string>;
  check("payload yalnız kimlik + görüntü dizesi", payload.sertifikaId === soonId && payload.standart === "GRS" && payload.durum === "10 gün kaldı" && payload.sahip === "Fabrika", JSON.stringify(payload));
  for (let i = 0; i < 3; i++) await runConditionSourceOnce(kind);
  check("⭐ sürer (3 tur) → yeni ACILDI yok (tekrar bastırma)", (await acildiTur()) === opened, `ACILDI ${opened} → ${await acildiTur()}`);
  await renewCertificate(soonId, base({ expiresOn: dayFromToday(400), standard: "GRS" }), adminId);
  await runConditionSourceOnce(kind);
  check("yenilenir → KAPANDI (Çözüldü)", (await kapandi()) === 1 && !(await acik(soonId)));
  await ayar(SETTING_KEYS.KALITE_GUVENCE_ENABLED, false);
  await createCertificate(base({ expiresOn: dayFromToday(3) }), adminId);
  const before = await acildiTur();
  await runConditionSourceOnce(kind);
  check("modül kapalı → küme boş (yeni açılış yok)", (await acildiTur()) === before && (await prisma.notificationCondition.count({ where: { kind, resolvedAt: null, subjectKey: { in: (await prisma.certificate.findMany({ where: { certificateNo: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id) } } })) === 0);
  await ayar(SETTING_KEYS.KALITE_GUVENCE_ENABLED, true);
}

async function cleanup(): Promise<void> {
  const certs = (await prisma.certificate.findMany({ where: { certificateNo: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id);
  await prisma.notificationInbox.deleteMany({ where: { kind: CERTIFICATE_EXPIRY_KIND, createdAt: { gte: BASLANGIC } } });
  await prisma.notificationOutbox.deleteMany({ where: { kind: CERTIFICATE_EXPIRY_KIND, createdAt: { gte: BASLANGIC } } });
  await prisma.notificationCondition.deleteMany({ where: { kind: CERTIFICATE_EXPIRY_KIND, createdAt: { gte: BASLANGIC } } });
  await prisma.certificateFile.deleteMany({ where: { certificateId: { in: certs } } });
  // Yenileme zinciri (renewsId FK) — önce yenileyenler.
  for (let i = 0; i < 5; i++) await prisma.certificate.deleteMany({ where: { id: { in: certs }, renewedBy: { is: null } } });
  const tests = (await prisma.labTest.findMany({ where: { batchId: { in: made.batches } }, select: { id: true } })).map((t) => t.id);
  await prisma.labTestResult.deleteMany({ where: { labTestId: { in: tests } } });
  await prisma.labTest.deleteMany({ where: { id: { in: tests } } });
  await prisma.customerLabSpec.deleteMany({ where: { customerId: { in: made.customers } } });
  await prisma.labTestType.deleteMany({ where: { id: { in: made.types } } });
  await prisma.batch.deleteMany({ where: { id: { in: made.batches } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: made.wos } } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } });
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => undefined);
}

async function main(): Promise<void> {
  console.log("=== K4P sertifika bekçisi ===\n");
  const keys = [SETTING_KEYS.KALITE_GUVENCE_ENABLED, SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  try {
    await ayar(SETTING_KEYS.KALITE_GUVENCE_ENABLED, true);
    await ayar(SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, true);
    const partnerId = await mkCustomer("P");
    const certId = await sectionChecks(admin.id, partnerId);
    await sectionReplay(admin.id);
    let revokedId = "";
    await sectionHttp(admin, certId, async () => (revokedId = await sectionRenewRevoke(admin.id)));
    if (!revokedId) await sectionRenewRevoke(admin.id);
    const { soonId, farId } = await sectionExpiry(admin.id);
    await sectionCustomerSpec(admin.id, await mkCustomer("M"));
    await sectionNotification(admin.id, soonId, farId);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    stopNotificationJobs();
    for (const k of keys) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => check("temizlik", false, String(e)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

void main();
