// =============================================================================
// MÜŞTERİ HIZLI KAYDI — belgeden İE formu (Gülkesim 2026-11-04)
// =============================================================================
// Gerçek DB + gerçek Express (ephemeral port) + gerçek login. Sınanan:
//   §1 okuma: okunan müşteri adı kayıtlı cariye çözülemezse `ownerUnmatched` (benzerler ≥0,80 + OCR adayları, en çok 5, puan azalan);
//      benzeri yoksa aday listesi boş; BLIND'de yok; sahip seçiliyken yok; okuma özetinde aynı alan
//   §1b kısa ad (2026-11-05): tanıtılmış şablon alanından 2 ve 1 harf → teklif var (SOR kipinde de); yalnız boşluk → yok;
//      tanıtılmamış okumada 2 harf → yok (eşik 3)
//   §2 uç `POST /customers/quick-create`: yalnız adla kart (rol Müşteri, kod dolu, cari hesap, audit kaynağı)
//   §3 izin: `gelen-belge:write` ya da `customer:write` yeter; ikisi yoksa 403
//   §4 idempotency: aynı token 2× tek kart · aynı token farklı ad 409 · pasife alınmış kartın token'ı 409
//   §5 genel PATCH gövdesi `clientToken` yazamaz
//   §6 (2026-11-10) seçicinin "Yeni ekle" formu: opsiyonel iletişim alanları karta yazılır; e-posta/vergi no kart
//      doğrulamasından geçer; aynı vergi no 409; rol/kod/finans gövdede hâlâ 400
// Negatif sonda (2026-11-04, ölçüldü; md5 ile geri): eşik 0,80→0,95 → §1 2 ❌; aday tavanı kaldırılınca §1 ❌; BLIND dalı
// silinince §1 ❌; kayda vergi no eklenince §2 ❌; izne `customer:read` eklenince §3 ❌; replay boğazı atlanınca §4 ❌;
// `alive` koşulsuz → §4 ❌; write-guard `customer` satırı silinince §5 ❌.
//   §1c kısa ad KAYITLIYSA (2026-11-05): tanıtılmış alandan 2 harf tam eşleşen karta doğrudan öneri (NORMAL+TRUSTED),
//      teklif yok; adaylar `code` taşır
// Sonda 2026-11-05: tanıtılmış eşiği 1→3 → §1b 3 ❌; tanıtım koşulu `true` → §1b 1 ❌; tanıtım okuması kaldırılınca §1b 3 ❌.
// Sonda 2026-11-05 (§1c): `rank` anahtar eşiği 2→3 → §1c 2 ❌; aday `code` eşlemesi null → §1c 1 ❌.
//   §1d OCR'a dayanıklı aday (2026-11-08): "QAB M" okuması kayıtlı "QAB"yi aday getirir; tavan 5 (`ocrNameCandidates`)
// Sonda 2026-11-08 (§1d): `ocrNameCandidates` birleştirmesi çıkarılınca §1d 1 ❌; geri alındı, 28/28.
// Sonda 2026-11-10 (§6): serviste `...extra` yayılımı kaldırılınca §6 5 ❌; gövde `.passthrough()` olunca §2 3 ❌; md5 ile geri, 36/36.
// =============================================================================
import { createHash, randomUUID } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { readOwnerForNote, unmatchedOf, UNMATCHED_MAX } from "../src/services/gelen-belge-sahip-onerisi.service";
import { getReadSummary } from "../src/services/gelen-belge-okuma-ozeti.service";
import { AuthService } from "../src/services/auth.service";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";

const blocked = hedefDbEngeli();
if (blocked) {
  console.error(`⛔ DURDURULDU — ${blocked}`);
  process.exitCode = 1;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

// Benzersiz, harf-yalnız etiket (ad benzerliği rakamları gürültü saymasın diye harf).
const TAG = Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
const made = { customers: [] as string[], notes: [] as string[], users: [] as string[], scans: [] as string[] };
const PASSWORD = "TestHizliMus2026!";

type Resp = { status: number; code?: string; data?: { id?: string; name?: string } };

async function makeCustomer(name: string): Promise<string> {
  const c = await prisma.customer.create({ data: { code: `T${TAG}${made.customers.length}`, name, isCustomerRole: true }, select: { id: true } });
  made.customers.push(c.id);
  return c.id;
}

async function makeNote(ownerText: string, suffix: string): Promise<string> {
  const n = await prisma.customerDeliveryNote.create({ data: { noteNo: `T-HMK-${TAG}-${suffix}`.slice(0, 32), sourceKind: "MANUAL", status: "DRAFT", ownerText }, select: { id: true } });
  made.notes.push(n.id);
  return n.id;
}

/** Notun okunmuş taraması; `templateId` `u-…` ise not tanıtılmış (kullanıcı şablonu), null ise tanıtılmamış (GENEL). */
async function addScan(noteId: string, templateId: string | null): Promise<void> {
  const content = Buffer.from(`${TAG}-${randomUUID()}`);
  const s = await prisma.documentScan.create({
    data: { noteId, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ",
      ocrResult: { ocr: { text: "" }, regions: [{ templateId }] } },
    select: { id: true },
  });
  made.scans.push(s.id);
}

async function makeUser(perms: string[]): Promise<string> {
  const username = `hmk${TAG.toLowerCase()}${made.users.length}`;
  const u = await prisma.user.create({ data: { username, fullName: `Hızlı müşteri test ${username}`, passwordHash: await AuthService.hashPassword(PASSWORD) }, select: { id: true } });
  made.users.push(u.id);
  const rows = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
  if (rows.length !== perms.length) throw new Error(`izin katalogda yok: ${perms.join(",")}`);
  if (rows.length) await prisma.userPermission.createMany({ data: rows.map((p) => ({ userId: u.id, permissionId: p.id })) });
  return username;
}

async function run(url: string): Promise<void> {
  const login = async (username: string, password: string) => {
    const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "mobile" }) });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
    return { status: r.status, code: j.details?.code, data: j.data };
  };

  // ── §1 okuma ───────────────────────────────────────────────────────────────
  const c1 = await makeCustomer(`MAVIDERE BOYAHANELERI ${TAG}`);
  const c2 = await makeCustomer(`MAVIDERE BOYAHANECI ${TAG}`);
  const sameNote = await makeNote(`MAVIDERE BOYAHNE ${TAG}`, "B");
  const r1 = await readOwnerForNote({ id: sameNote, status: "DRAFT", ownerCustomerId: null }, "NORMAL");
  const ids = r1.unmatched?.candidates.map((c) => c.customerId) ?? [];
  check("§1 ⭐ benzer adlı kayıtlar adaylarda (ilk ikisi, ≥0,80), öneri yok", r1.suggestion === null && ids.slice(0, 2).sort().join() === [c1, c2].sort().join()
    && (r1.unmatched?.candidates ?? []).slice(0, 2).every((c) => c.score >= 0.8), JSON.stringify(r1));

  // OCR'a dayanıklı adaylar (2026-11-08 saha: "HHL M" okundu, kayıtlı "HHL" aday çıkmıyordu).
  const ocrShort = `Q${TAG.slice(0, 2)}`;
  const cOcr = await makeCustomer(ocrShort);
  const ocrNote = await makeNote(`${ocrShort} M`, "O");
  const rOcr = await readOwnerForNote({ id: ocrNote, status: "DRAFT", ownerCustomerId: null }, "NORMAL");
  check("§1d ⭐ OCR fazladan harf: kayıtlı kısa ad aday (öneri yok, seçim operatörde)", rOcr.suggestion === null && (rOcr.unmatched?.candidates ?? []).some((c) => c.customerId === cOcr), JSON.stringify(rOcr));
  check("§1 aday metni okunan ad", r1.unmatched?.text === `MAVIDERE BOYAHNE ${TAG}`);

  const noneNote = await makeNote(`ZQKW${TAG}${[...TAG].reverse().join("")}`, "Y");
  const r2 = await readOwnerForNote({ id: noneNote, status: "DRAFT", ownerCustomerId: null }, "NORMAL");
  check("§1 ⭐ benzeri yoksa teklif var, aday listesi boş", r2.suggestion === null && r2.unmatched?.candidates.length === 0, JSON.stringify(r2));

  const blind = await readOwnerForNote({ id: sameNote, status: "DRAFT", ownerCustomerId: null }, "BLIND");
  check("§1 ⭐ BLIND kipte ownerUnmatched null", blind.unmatched === null && blind.suggestion === null, JSON.stringify(blind));
  const owned = await readOwnerForNote({ id: sameNote, status: "DRAFT", ownerCustomerId: c1 }, "NORMAL");
  check("§1 sahip seçiliyken teklif yok", owned.unmatched === null);

  const ranked = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: `id${i}`, name: `n${i}`, score: 0.8 + i / 100 }));
  const u = unmatchedOf("X", [...ranked, ranked[6]]);
  check(`§1 ⭐ en çok ${UNMATCHED_MAX} aday, puan azalan, tekil`, UNMATCHED_MAX === 5 && u.candidates.length === 5 && u.candidates.map((c) => c.customerId).join() === "id7,id6,id5,id4,id3", JSON.stringify(u));

  const summary = (await getReadSummary(sameNote)) as unknown as { ownerUnmatched?: { candidates: unknown[] } } | null;
  check("§1 okuma özeti ownerUnmatched taşır", (summary?.ownerUnmatched?.candidates.length ?? 0) >= 2, JSON.stringify(summary?.ownerUnmatched ?? null));

  // ── §1b kısa ad: tanıtılmış alan 1 harf yeter, serbest okuma 3 ister ──────
  const tpl = `u-hmk-${TAG.toLowerCase()}`;
  const short2 = TAG.slice(0, 2);
  const intro2 = await makeNote(short2, "K2");
  await addScan(intro2, tpl);
  const ri2 = await readOwnerForNote({ id: intro2, status: "DRAFT", ownerCustomerId: null }, "NORMAL");
  check("§1b ⭐ tanıtılmış alandan 2 harf → teklif var (SOR kipi, NORMAL güven)", ri2.suggestion === null && ri2.unmatched?.text === short2, JSON.stringify(ri2));
  const sum2 = (await getReadSummary(intro2)) as unknown as { ownerUnmatched?: { text: string } } | null;
  check("§1b okuma özeti kısa adla ownerUnmatched taşır", sum2?.ownerUnmatched?.text === short2, JSON.stringify(sum2?.ownerUnmatched ?? null));
  const intro1 = await makeNote(TAG.slice(2, 3), "K1");
  await addScan(intro1, tpl);
  const ri1 = await readOwnerForNote({ id: intro1, status: "DRAFT", ownerCustomerId: null }, "NORMAL");
  check("§1b ⭐ tanıtılmış alandan 1 harf → teklif var", ri1.unmatched?.text === TAG.slice(2, 3), JSON.stringify(ri1));
  const blankNote = await makeNote("   ", "KB");
  await addScan(blankNote, tpl);
  const rb = await readOwnerForNote({ id: blankNote, status: "DRAFT", ownerCustomerId: null }, "NORMAL");
  check("§1b tanıtılmış alan yalnız boşluk → teklif yok", rb.unmatched === null, JSON.stringify(rb));
  const free2 = await makeNote(short2, "F2");
  await addScan(free2, null);
  const rf2 = await readOwnerForNote({ id: free2, status: "DRAFT", ownerCustomerId: null }, "NORMAL");
  check("§1b ⭐ tanıtılmamış okumada 2 harf → teklif yok (eşik 3)", rf2.unmatched === null, JSON.stringify(rf2));

  // ── §1c kısa ad KAYITLI: tam eşleşen kart modal yerine doğrudan öneri olur (2026-11-05) ──
  check("§1c adaylar kodu taşır (modal aynı adlı carileri ayırt eder)", (r1.unmatched?.candidates ?? []).length > 0
    && (r1.unmatched?.candidates ?? []).every((x) => typeof x.code === "string" && x.code.length > 0), JSON.stringify(r1.unmatched?.candidates ?? null));
  const known2 = TAG.slice(3, 5);
  const kc = await makeCustomer(known2);
  for (const trust of ["NORMAL", "TRUSTED"] as const) {
    const kn = await makeNote(known2, `KC${trust[0]}`);
    await addScan(kn, tpl);
    const rk = await readOwnerForNote({ id: kn, status: "DRAFT", ownerCustomerId: null }, trust);
    check(`§1c ⭐ tanıtılmış alandan 2 harfli kayıtlı ad → doğrudan öneri, teklif yok (${trust})`,
      rk.suggestion?.customerId === kc && rk.suggestion.source === "OWNER_TEXT" && rk.unmatched === null, JSON.stringify(rk));
  }

  // ── §2–§4 uç ───────────────────────────────────────────────────────────────
  const gbUser = await makeUser(["gelen-belge:write"]);
  const noUser = await makeUser(["gelen-belge:read", "customer:read"]);
  const tkGb = await login(gbUser, PASSWORD);
  const tkNo = await login(noUser, PASSWORD);
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const tkAdmin = await login(admin.username, admin.password);
  check("login (3 kullanıcı)", !!tkGb && !!tkNo && !!tkAdmin);

  const newName = `KUZGUNCUK ZEYTINLIK ${TAG}`;
  const denied = await call("POST", "/api/customers/quick-create", tkNo, { name: newName, clientToken: randomUUID() });
  check("§3 ⭐ izin yoksa 403", denied.status === 403, `${denied.status} ${denied.code ?? ""}`);
  check("§3 403'te kart doğmadı", (await prisma.customer.count({ where: { name: newName } })) === 0);

  const token = randomUUID();
  const a = await call("POST", "/api/customers/quick-create", tkGb, { name: newName, clientToken: token });
  if (a.data?.id) made.customers.push(a.data.id);
  check("§3 gelen-belge:write ile 201", a.status === 201 && !!a.data?.id, `${a.status} ${a.code ?? ""}`);
  const card = a.data?.id ? await prisma.customer.findUnique({ where: { id: a.data.id }, select: { name: true, code: true, isCustomerRole: true, clientToken: true, taxNumber: true } }) : null;
  check("§2 ⭐ yeni kart yalnız adla: rol Müşteri, kod dolu, token saklı",
    !!card && card.name === newName && card.isCustomerRole && !!card.code && card.clientToken === token && card.taxNumber === null, JSON.stringify(card));
  await new Promise((r) => setTimeout(r, 300));
  const log = a.data?.id ? await prisma.systemLog.findFirst({ where: { recordId: a.data.id, action: "CREATE" }, select: { newData: true } }) : null;
  check("§2 audit CREATE (kaynak GELEN_BELGE_FORM)", JSON.stringify(log?.newData ?? null).includes("GELEN_BELGE_FORM"), JSON.stringify(log));

  const b = await call("POST", "/api/customers/quick-create", tkGb, { name: newName, clientToken: token });
  check("§4 ⭐ aynı token tekrarında aynı kart, çift kayıt yok", b.data?.id === a.data?.id && (await prisma.customer.count({ where: { name: newName } })) === 1, `${b.status} ${b.data?.id}`);
  const c = await call("POST", "/api/customers/quick-create", tkGb, { name: `${newName} BASKA`, clientToken: token });
  check("§4 aynı token farklı ad 409", c.status === 409, `${c.status} ${c.code ?? ""}`);

  const t2 = randomUUID();
  const p = await call("POST", "/api/customers/quick-create", tkAdmin, { name: `PASIFLER DOKUMA ${TAG}`, clientToken: t2 });
  if (p.data?.id) {
    made.customers.push(p.data.id);
    await prisma.customer.update({ where: { id: p.data.id }, data: { isActive: false } });
  }
  const pr = await call("POST", "/api/customers/quick-create", tkAdmin, { name: `PASIFLER DOKUMA ${TAG}`, clientToken: t2 });
  check("§4 ⭐ pasif kartın token tekrarı 409 CUSTOMER_QUICK_CREATE_GONE", pr.status === 409 && pr.code === "CUSTOMER_QUICK_CREATE_GONE", `${pr.status} ${pr.code ?? ""}`);

  const dup = await call("POST", "/api/customers/quick-create", tkGb, { name: newName, clientToken: randomUUID() });
  check("§2 aynı ad yeni token: ad seddi 409 (mükerrer kart yok)", dup.status === 409, `${dup.status} ${dup.code ?? ""}`);
  for (const bad of [{ isSupplierRole: true }, { code: `K${TAG}` }, { finance: { paymentTermDays: 30 } }]) {
    const extra = await call("POST", "/api/customers/quick-create", tkGb, { name: `EKALAN ${TAG}`, clientToken: randomUUID(), ...bad });
    check(`§2 gövde dar (.strict): rol/kod/finans 400 (${Object.keys(bad)[0]})`, extra.status === 400, `${extra.status}`);
  }

  // ── §6 seçicinin "Yeni ekle" formu: "Diğer" iletişim alanları (2026-11-10) ──
  const taxNo = `9${String(Date.now()).slice(-9)}`;
  const rich = { name: `DIGERALAN TEKSTIL ${TAG}`, clientToken: randomUUID(), taxNumber: taxNo, contactName: "Ali Veli", contactPhone: "0532 000 00 00",
    email: "ali@ornek.com", city: "Bursa", district: "Osmangazi", address: "Organize Sanayi 1. Cad.", notes: "Belgeden eklendi" };
  const r6 = await call("POST", "/api/customers/quick-create", tkGb, rich);
  if (r6.data?.id) made.customers.push(r6.data.id);
  const c6 = r6.data?.id ? await prisma.customer.findUnique({ where: { id: r6.data.id },
    select: { taxNumber: true, contactName: true, contactPhone: true, email: true, city: true, district: true, address: true, notes: true, isCustomerRole: true, isSupplierRole: true } }) : null;
  check("§6 ⭐ Diğer alanları karta yazılır (rol yine yalnız Müşteri)", r6.status === 201 && !!c6 && c6.taxNumber === taxNo && c6.contactName === "Ali Veli"
    && c6.contactPhone === "0532 000 00 00" && c6.email === "ali@ornek.com" && c6.city === "Bursa" && c6.district === "Osmangazi"
    && c6.address === "Organize Sanayi 1. Cad." && c6.notes === "Belgeden eklendi" && c6.isCustomerRole && !c6.isSupplierRole, `${r6.status} ${JSON.stringify(c6)}`);
  const badMail = await call("POST", "/api/customers/quick-create", tkGb, { name: `EPOSTA HATALI ${TAG}`, clientToken: randomUUID(), email: "ali@" });
  check("§6 geçersiz e-posta 400 (kart doğrulaması)", badMail.status === 400, `${badMail.status}`);
  const badTax = await call("POST", "/api/customers/quick-create", tkGb, { name: `VERGI HATALI ${TAG}`, clientToken: randomUUID(), taxNumber: "12AB" });
  check("§6 geçersiz vergi no 400", badTax.status === 400, `${badTax.status}`);
  const dupTax = await call("POST", "/api/customers/quick-create", tkGb, { name: `VERGI MUKERRER ${TAG}`, clientToken: randomUUID(), taxNumber: taxNo });
  check("§6 ⭐ aynı vergi no ikinci kart 409", dupTax.status === 409, `${dupTax.status}`);
  const blank = await call("POST", "/api/customers/quick-create", tkGb, { name: `BOSALAN ${TAG}`, clientToken: randomUUID(), city: "  " });
  if (blank.data?.id) made.customers.push(blank.data.id);
  const cb = blank.data?.id ? await prisma.customer.findUnique({ where: { id: blank.data.id }, select: { city: true } }) : null;
  check("§6 boş alan null yazılır", blank.status === 201 && cb?.city === null, `${blank.status} ${JSON.stringify(cb)}`);
  const n6 = await prisma.customer.count({ where: { name: { in: [`EPOSTA HATALI ${TAG}`, `VERGI HATALI ${TAG}`, `VERGI MUKERRER ${TAG}`] } } });
  check("§6 reddedilen gövdede kart doğmadı", n6 === 0, String(n6));

  // ── §5 genel gövde ─────────────────────────────────────────────────────────
  if (a.data?.id) {
    const foreign = randomUUID();
    await call("PATCH", `/api/customers/${a.data.id}`, tkAdmin, { clientToken: foreign });
    const after = await prisma.customer.findUnique({ where: { id: a.data.id }, select: { clientToken: true } });
    check("§5 ⭐ genel PATCH clientToken yazamaz", after?.clientToken === token, JSON.stringify(after));
  }
}

// Hatayı yutmaz (`test_kart_teardown_hesap` §0c): kalıntı bırakan teardown `main`deki "temizlik" kontrolüyle kırmızı verir.
async function cleanup(): Promise<void> {
  await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } });
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  await cleanupTestCustomers(made.customers);
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } });
  // Audit satırı (`system_logs`) kullanıcıya bağlı kalır; silinemeyen kullanıcı pasifleşir (`bildirim-http-fikstur` yolu).
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => prisma.user.updateMany({ where: { id: { in: made.users } }, data: { isActive: false } }));
}

async function main(): Promise<void> {
  console.log("=== Müşteri hızlı kaydı (belgeden İE formu) bekçisi ===\n");
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    server.close();
    stopNotificationJobs();
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!blocked) void main();
