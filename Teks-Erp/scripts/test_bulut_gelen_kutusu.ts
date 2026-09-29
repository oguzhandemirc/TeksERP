// =============================================================================
// BEKÇİ — PATRON BULUTU GELEN KUTUSU (fabrika tarafı; `PATRON-BULUTU-ESITLEME.md` §8)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bulut_gelen_kutusu   (kendi _test DB'si; ~15 sn)
//
// NE ÖLÇER (gerçek servisler; audit bellekte yakalanır; bulut SAHTE — süreç içi taşıyıcı, imzayı
// protokolün kendi doğrulayıcısıyla denetler):
//   §1 tel → fabrika eşlemesinin hedefleri yazılabilir kümelerin İÇİNDE (sipariş başlık/kalem
//      allowlist'i, Customer skaler kolonu); her tel alanının eşlemesi var
//   §2 teknik kullanıcı: yalnız order:write + customer:write; mobil kimliği yok; etkinleştirme
//      idempotent; kayıt ham ayar ucundan yazılamaz
//   §3 ⭐ CARİ mesajı → ISLENDI; AYNI mesaj ikinci kez → AYNI sonuç, ikinci kart yok; eşzamanlı iki
//      deneme → tek kart, tek makbuz
//   §4 ⭐ makbuz ile kart AYNI tx'te: makbuz yazımı düşerse kart da doğmaz (sonuç belirsiz → null)
//   §5 ⭐ aynı ad → REDDEDILDI `CARI_AD_MUKERRER`, Türkçe mesaj; tekrarında aynı ret, makbuzdan
//   §6 ⭐ SİPARİŞ mesajı → ISLENDI (normal yol: aktör teknik kullanıcı, audit'te kaynak künyesi,
//      clientToken = mesajId); tekrarında aynı sipariş no; eşzamanlı iki deneme → tek sipariş
//   §7 aynı mesajId + başka gövde → `MESAJ_CAKISMASI`, ikinci makbuz yok
//   §8 gövde KATI (tanınmayan anahtar `GOVDE_GECERSIZ`) · olmayan ürün `URUN_BULUNAMADI`
//   §9 ⭐ teknik kullanıcı kimliksiz `mobile-users` listesinde görünmez (mobil izin verilse bile),
//      `login-methods` yanıtında yok; parolası bilinse de oturum AÇILMAZ
//   §10 ⭐ iş: ön koşul yoksa HİÇ dış istek yok · imzalı `al` → işle → `sonuc` · zorla+KISITLI'da
//      `al` çağrılmaz (kayıt bulutta BEKLIYOR kalır) · bulut hesap listesi durum özetine düşer
//
// NEGATİF SONDA — dosya DIŞI mutasyon (cp + shasum ile birebir geri alındı; sonuçlar commit
// mesajında): N1 kart makbuzu ayrı tx'e taşınır (§4) · N2 mobil liste süzgeci kaldırılır (§9) ·
// N3 `issueToken` reddi kaldırılır (§9) · N4 kalem eşlemesinde hedef yazılabilir küme dışına (§1) ·
// N5 lisans yazma yüklemi atlanır (§10).
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { AuthService } from "../src/services/auth.service";
import { AuthController } from "../src/controllers/auth.controller";
import { ORDER_HEADER_WRITABLE, ORDER_LINE_WRITABLE } from "../src/services/order.service";
import { CARD_ROLE_WIRE_MAP, CARD_WIRE_MAP, ORDER_HEADER_WIRE_MAP, ORDER_LINE_WIRE_MAP, orderWireToFactory } from "../src/cloud-sync/inbox-wire";
import { CustomerMessageSchema, OrderMessageSchema, SYNC_PATHS, type InboxMessage, type InboxOutcome } from "../src/cloud-sync/wire";
import { processInboxMessage } from "../src/services/cloud-inbox.service";
import {
  PATRON_CLOUD_PERMISSIONS,
  activatePatronCloud,
  getPatronCloudStatus,
  readPatronCloudUserId,
  __resetPatronCloudStateForTests,
} from "../src/services/patron-cloud.service";
import { PATRON_CLOUD_USER_SETTING_KEY, isReservedSettingKey } from "../src/constants/reserved-settings";
import { runCloudInboxOnce, __resetCloudInboxJobForTests } from "../src/jobs/cloud-inbox.job";
import { setCloudUrlForTests } from "../src/cloud-sync/cloud-url";
import { PATRON_CLOUD_ENTITLEMENT } from "../src/cloud-sync/eligibility";
import { REQUEST_HEADER, verifyRequest, readRequestIdentity, DAY_MS, msToIso } from "../src/lib/license/protocol";
import type { VendorHttpRequest, VendorHttpResponse } from "../src/services/helpers/license-wire.helper";
import { lisansKipKur, temizleLisansKipDizini } from "./lib/lisans-kip-fikstur";
import { ensureTestAdmin } from "./fixture-test-user";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

type AuditParams = Parameters<typeof AuditService.log>[0];
const auditlar: AuditParams[] = [];
AuditService.log = async (p) => {
  auditlar.push(p);
};
AuditService.logEvent = async () => {};

const DAMGA = Date.now().toString(36).toUpperCase();
const yaratilan = { siparis: new Set<string>(), kart: new Set<string>(), mesaj: new Set<string>() };
/** Kendi fikstürü (iş anahtarıyla) — ortamdaki "herhangi bir ürün"e yaslanmaz. */
const fikstur = { urunId: "", renkId: "" };
let onceTeknikKullaniciId: string | null = null;
let onceAyarVar = false;

function mesaj(tur: "SIPARIS" | "CARI", govde: unknown, ek: Partial<InboxMessage> = {}): InboxMessage {
  const m: InboxMessage = {
    mesajId: randomUUID(),
    tur,
    govde,
    hesapId: "7d4b1f1e-2f44-4c2a-9a55-3f9d8f0a1b2c",
    hesapAdi: "Bulut Patron",
    olusturulma: new Date().toISOString(),
    ...ek,
  };
  yaratilan.mesaj.add(m.mesajId);
  return m;
}

function kaydet(o: InboxOutcome | null, tur: "SIPARIS" | "CARI"): void {
  if (o?.durum === "ISLENDI" && o.varlikId) (tur === "SIPARIS" ? yaratilan.siparis : yaratilan.kart).add(o.varlikId);
}

async function isle(m: InboxMessage, aktor: string): Promise<InboxOutcome | null> {
  const o = await processInboxMessage(m, aktor);
  kaydet(o, m.tur);
  return o;
}

function turkceMi(s: string | null | undefined): boolean {
  return typeof s === "string" && s.length > 10 && /[çğıöşüÇĞİÖŞÜ]/.test(s);
}

// ── §1 ──────────────────────────────────────────────────────────────────────────────────────────
function bolum1(): void {
  console.log("\n§1 tel eşlemesi yazılabilir kümelerin içinde");
  const baslik = Object.values(ORDER_HEADER_WIRE_MAP).filter((k) => !ORDER_HEADER_WRITABLE.has(k));
  check("sipariş başlık eşlemesi ⊂ ORDER_HEADER_WRITABLE", baslik.length === 0, baslik.join(", "));
  const kalem = Object.values(ORDER_LINE_WIRE_MAP).filter((k) => !ORDER_LINE_WRITABLE.has(k));
  check("sipariş kalem eşlemesi ⊂ ORDER_LINE_WRITABLE", kalem.length === 0, kalem.join(", "));
  const customer = Prisma.dmmf.datamodel.models.find((m) => m.name === "Customer");
  const skaler = new Set((customer?.fields ?? []).filter((f) => f.kind === "scalar" || f.kind === "enum").map((f) => f.name));
  const yasak = new Set(["id", "code", "type", "isSubcontractorRole", "isActive", "nameFold", "createdAt", "updatedAt", "createdById", "updatedById", "mergedIntoId", "mergedAt", "mergedById"]);
  const kart = [...Object.values(CARD_WIRE_MAP), ...Object.values(CARD_ROLE_WIRE_MAP)].filter((k) => !skaler.has(k) || yasak.has(k));
  check("cari eşlemesi Customer skaler kolonu ve kod/tür/fason rolü DEĞİL", kart.length === 0, kart.join(", "));
  const telBaslik = Object.keys(OrderMessageSchema.shape).filter((k) => k !== "kalemler" && !(k in ORDER_HEADER_WIRE_MAP));
  const telKalem = Object.keys(OrderMessageSchema.shape.kalemler.element.shape).filter((k) => !(k in ORDER_LINE_WIRE_MAP));
  const telKart = Object.keys(CustomerMessageSchema.shape).filter((k) => k !== "roller" && !(k in CARD_WIRE_MAP));
  check("her tel alanının eşlemesi var (sessiz düşen alan yok)", telBaslik.length + telKalem.length + telKart.length === 0, [...telBaslik, ...telKalem, ...telKart].join(", "));
}

// ── §2 ──────────────────────────────────────────────────────────────────────────────────────────
async function bolum2(adminId: string): Promise<string> {
  console.log("\n§2 teknik kullanıcı");
  const a = await activatePatronCloud(adminId);
  const b = await activatePatronCloud(adminId);
  check("etkinleştirme idempotent (ikinci çağrı aynı kullanıcı, yeni hesap yok)", a.userId === b.userId && !b.created, JSON.stringify({ a, b }));
  const u = await prisma.user.findUnique({
    where: { id: a.userId },
    select: { fullName: true, quickPin: true, isActive: true, permissions: { select: { permission: { select: { code: true } } } } },
  });
  const kodlar = (u?.permissions ?? []).map((p) => p.permission.code).sort();
  check("izinler TAM OLARAK order:write + customer:write", JSON.stringify(kodlar) === JSON.stringify([...PATRON_CLOUD_PERMISSIONS].sort()), kodlar.join(","));
  check("mobil kimliği yok (hızlı PIN üretilmedi)", u?.quickPin === null || u?.quickPin === undefined);
  check("ad 'Patron Bulutu', aktif", u?.fullName === "Patron Bulutu" && u?.isActive === true);
  check("kimlik kaydı ham ayar ucundan yazılamaz (ayrılmış anahtar)", isReservedSettingKey(PATRON_CLOUD_USER_SETTING_KEY));
  check("etkinleştirme audit'li (SYSTEM_SETTING satırı)", auditlar.some((x) => x.tableName === "SYSTEM_SETTING" && x.recordId === PATRON_CLOUD_USER_SETTING_KEY) || !a.created);
  return a.userId;
}

// ── §3–§5 ─────────────────────────────────────────────────────────────────────────────────────────
async function bolum3ile5(aktor: string): Promise<string> {
  console.log("\n§3 CARİ mesajı — tek sonuç");
  const ad = `Bulut Cari ${DAMGA}`;
  const m = mesaj("CARI", { ad, roller: { musteri: true, tedarikci: false }, il: "Bursa", telefon: "0224 000 00 00" });
  const o1 = await isle(m, aktor);
  check("ISLENDI + varlık + kod fabrikada doğdu", o1?.durum === "ISLENDI" && !!o1.varlikId && /^MUS/.test(o1.belgeNo ?? ""), JSON.stringify(o1));
  const kart = o1?.varlikId ? await prisma.customer.findUnique({ where: { id: o1.varlikId }, select: { name: true, createdById: true, isCustomerRole: true } }) : null;
  // Ad normal yolun normalizasyonundan geçer (büyük harf) — kanıt odur.
  check("kart normal yoldan: aktör teknik kullanıcı, rol bayrağı, ad normalize", kart?.createdById === aktor && kart?.isCustomerRole === true && kart?.name !== ad && (kart?.name ?? "").endsWith(DAMGA), JSON.stringify(kart));
  const aud = auditlar.find((x) => x.tableName === "CUSTOMER" && x.recordId === o1?.varlikId);
  check("audit'te kaynak künyesi (PATRON_BULUTU + bulut hesabı)", (aud?.newData as Record<string, unknown> | undefined)?.kaynak === "PATRON_BULUTU" && (aud?.newData as Record<string, unknown>)?.bulutHesapAdi === "Bulut Patron");
  const o2 = await isle(m, aktor);
  check("AYNI mesaj ikinci kez → AYNI sonuç", JSON.stringify(o1) === JSON.stringify(o2), JSON.stringify(o2));
  const say = await prisma.customer.count({ where: { name: kart?.name ?? "?" } });
  const makbuz = await prisma.cloudInboxReceipt.count({ where: { messageId: m.mesajId } });
  check("tek kart, tek makbuz", say === 1 && makbuz === 1, `kart=${say} makbuz=${makbuz}`);

  const ad2 = `Bulut Esz ${DAMGA}`;
  const m2 = mesaj("CARI", { ad: ad2, roller: { musteri: true, tedarikci: true } });
  const onceSay = await prisma.customer.count({ where: { createdById: aktor } });
  const [e1, e2] = await Promise.all([isle(m2, aktor), isle(m2, aktor)]);
  const say2 = (await prisma.customer.count({ where: { createdById: aktor } })) - onceSay;
  check("eşzamanlı iki deneme → tek kart, iki cevap aynı", say2 === 1 && e1?.varlikId === e2?.varlikId && e1?.durum === "ISLENDI", `kart=${say2} ${e1?.varlikId}/${e2?.varlikId}`);

  console.log("\n§4 makbuz ve kart AYNI tx");
  const ad3 = `Bulut Atomik ${DAMGA}`;
  // hesapAdi kolon sınırını (200) aşar → makbuz INSERT'i düşer; kart aynı tx'te olduğu için geri alınmalı.
  const m3 = mesaj("CARI", { ad: ad3, roller: { musteri: true, tedarikci: false } }, { hesapAdi: "x".repeat(250) });
  const onceSay3 = await prisma.customer.count({ where: { createdById: aktor } });
  const o3 = await isle(m3, aktor);
  const say3 = (await prisma.customer.count({ where: { createdById: aktor } })) - onceSay3;
  check("makbuz düşünce kart da yok, sonuç belirsiz (null — bulut yeniden dener)", o3 === null && say3 === 0, `sonuc=${JSON.stringify(o3)} kart=${say3}`);

  console.log("\n§5 aynı ad → REDDEDILDI");
  const m4 = mesaj("CARI", { ad: ` ${ad.toLowerCase()} `, roller: { musteri: true, tedarikci: false } });
  const r1 = await isle(m4, aktor);
  check("REDDEDILDI · CARI_AD_MUKERRER · Türkçe mesaj", r1?.durum === "REDDEDILDI" && r1.kod === "CARI_AD_MUKERRER" && turkceMi(r1.mesaj), JSON.stringify(r1));
  const r2 = await isle(m4, aktor);
  const retMakbuz = await prisma.cloudInboxReceipt.findUnique({ where: { messageId: m4.mesajId } });
  check("tekrarında aynı ret, makbuzdan (REDDEDILDI, varlık yok)", JSON.stringify(r1) === JSON.stringify(r2) && retMakbuz?.outcome === "REDDEDILDI" && retMakbuz.entityId === null);
  return o1?.varlikId ?? "";
}

// ── §6–§8 ─────────────────────────────────────────────────────────────────────────────────────────
async function bolum6ile8(aktor: string, kartId: string): Promise<void> {
  console.log("\n§6 SİPARİŞ mesajı — normal yol");
  const govde = { cariKartId: kartId, doviz: "TRY", kalemler: [{ urunId: fikstur.urunId, renkId: fikstur.renkId, miktar: "125.5" }] };
  const m = mesaj("SIPARIS", govde);
  const o1 = await isle(m, aktor);
  check("ISLENDI + sipariş no", o1?.durum === "ISLENDI" && !!o1.varlikId && !!o1.belgeNo, JSON.stringify(o1));
  const sip = o1?.varlikId
    ? await prisma.order.findUnique({ where: { id: o1.varlikId }, select: { createdById: true, clientToken: true, customerId: true, lines: { select: { quantity: true } } } })
    : null;
  check("clientToken = mesajId · cari · kalem", sip?.clientToken === m.mesajId && sip?.customerId === kartId && Number(sip?.lines[0]?.quantity) === 125.5, JSON.stringify(sip));
  // Sipariş doğuş yolu `createdById` yazmaz (panel siparişiyle aynı); aktör audit'te ve makbuzda.
  const aud = auditlar.find((x) => x.recordId === o1?.varlikId && x.action === "CREATE" && x.tableName !== "CLOUD_INBOX_RECEIPT");
  const yuk = aud?.newData as Record<string, unknown> | undefined;
  check("audit: aktör teknik kullanıcı + kaynak künyesi", aud?.userId === aktor && yuk?.kaynak === "PATRON_BULUTU" && yuk?.mesajId === m.mesajId);
  const o2 = await isle(m, aktor);
  check("AYNI mesaj ikinci kez → AYNI sipariş no", JSON.stringify(o1) === JSON.stringify(o2));
  const m2 = mesaj("SIPARIS", govde);
  const [e1, e2] = await Promise.all([isle(m2, aktor), isle(m2, aktor)]);
  const say = await prisma.order.count({ where: { clientToken: m2.mesajId } });
  check("eşzamanlı iki deneme → tek sipariş", say === 1 && e1?.varlikId === e2?.varlikId && e1?.durum === "ISLENDI", `siparis=${say}`);

  console.log("\n§7 aynı mesajId, başka gövde");
  const c = await isle({ ...m, govde: { ...govde, doviz: "USD" } }, aktor);
  const makbuz = await prisma.cloudInboxReceipt.count({ where: { messageId: m.mesajId } });
  check("MESAJ_CAKISMASI, ikinci makbuz yok, ilk sonuç bozulmadı", c?.kod === "MESAJ_CAKISMASI" && makbuz === 1 && turkceMi(c?.mesaj), JSON.stringify(c));

  console.log("\n§8 gövde katı · olmayan referans");
  const g = await isle(mesaj("SIPARIS", { ...govde, gizliAlan: 1 }), aktor);
  check("tanınmayan anahtar → GOVDE_GECERSIZ", g?.durum === "REDDEDILDI" && g.kod === "GOVDE_GECERSIZ" && turkceMi(g.mesaj), JSON.stringify(g));
  const k = await isle(mesaj("CARI", { ad: `Kod ${DAMGA}`, roller: { musteri: true, tedarikci: false }, kod: "MUS1" }), aktor);
  check("cari gövdesinde kod verilemez → GOVDE_GECERSIZ", k?.kod === "GOVDE_GECERSIZ");
  const u = await isle(mesaj("SIPARIS", { ...govde, kalemler: [{ urunId: randomUUID(), miktar: "1" }] }), aktor);
  check("olmayan ürün → URUN_BULUNAMADI", u?.durum === "REDDEDILDI" && u.kod === "URUN_BULUNAMADI", JSON.stringify(u));
  const sayi = await isle(mesaj("SIPARIS", { ...govde, kalemler: [{ urunId: fikstur.urunId, miktar: 1 }] }), aktor);
  check("miktar SAYI gelirse (tel ondalık DİZİ ister) → GOVDE_GECERSIZ", sayi?.kod === "GOVDE_GECERSIZ", JSON.stringify(sayi));
  const aciklama = await isle(mesaj("SIPARIS", { ...govde, aciklama: "not" }), aktor);
  check("aciklama tel sözleşmesinde yok (S27) → GOVDE_GECERSIZ", aciklama?.kod === "GOVDE_GECERSIZ");
  const daire = await isle(mesaj("CARI", { ad: `Daire ${DAMGA}`, roller: { musteri: true, tedarikci: false }, vergiDairesi: "Merkez" }), aktor);
  check("vergiDairesi tel sözleşmesinde yok (S27) → GOVDE_GECERSIZ", daire?.kod === "GOVDE_GECERSIZ");
  const esleme = orderWireToFactory({ ...govde, termin: "2026-10-15", kalemler: [{ urunId: fikstur.urunId, miktar: "125.5", birimFiyat: "12.25" }] }, randomUUID());
  const satir = (esleme.lines as Record<string, unknown>[])[0];
  check("termin takvim günü → fabrika günü başı (Europe/Istanbul, 21:00Z)", esleme.deadline === "2026-10-14T21:00:00.000Z", String(esleme.deadline));
  check("ondalık DİZİ → sayı (miktar, birim fiyat)", satir?.quantity === 125.5 && satir?.unitPrice === 12.25, JSON.stringify(satir));
}

// ── §9 ──────────────────────────────────────────────────────────────────────────────────────────
async function bolum9(aktor: string): Promise<void> {
  console.log("\n§9 teknik kullanıcı kimliksiz listelerde yok, giriş yok");
  const mobilIzin = await prisma.permission.findFirst({ where: { code: { startsWith: "mobile:" } }, select: { id: true } });
  if (mobilIzin) await prisma.userPermission.create({ data: { userId: aktor, permissionId: mobilIzin.id } });
  try {
    const liste = await AuthService.listMobileUsers();
    check("mobile-users: mobil izin verilse bile listede YOK", mobilIzin !== null && !liste.some((x) => x.id === aktor), `mobil izin ${mobilIzin ? "verildi" : "YOK"}`);
  } finally {
    if (mobilIzin) await prisma.userPermission.deleteMany({ where: { userId: aktor, permissionId: mobilIzin.id } });
  }
  let govde = "";
  const res = { status: () => res, json: (b: unknown) => ((govde = JSON.stringify(b)), res) } as unknown as Parameters<typeof AuthController.loginMethods>[1];
  await AuthController.loginMethods({} as Parameters<typeof AuthController.loginMethods>[0], res, () => {});
  check("login-methods yanıtında teknik kullanıcı yok", govde.length > 0 && !govde.includes(aktor) && !govde.includes("patronbulutu"));
  const parola = `Bilinen-${DAMGA}-parola`;
  await prisma.user.update({ where: { id: aktor }, data: { passwordHash: await AuthService.hashPassword(parola) } });
  let kod = "";
  try {
    await AuthService.login("patronbulutu", parola, { clientType: "electron" });
    kod = "GIRDI";
  } catch (e) {
    kod = String((e as { statusCode?: number }).statusCode ?? "?");
  }
  check("parolası bilinse de oturum açılmaz (401)", kod === "401", kod);
}

// ── §10 ─────────────────────────────────────────────────────────────────────────────────────────
interface SahteBulut {
  cagrilar: Array<{ yol: string; govde: Record<string, unknown>; imzaGecerli: boolean }>;
  kuyruk: InboxMessage[];
  tasiyici: (req: VendorHttpRequest) => Promise<VendorHttpResponse>;
}

function sahteBulut(kurulumX: string, kurulumId: string): SahteBulut {
  const b: SahteBulut = {
    cagrilar: [],
    kuyruk: [],
    tasiyici: async (req) => {
      const yol = new URL(req.url).pathname;
      const token = req.headers[REQUEST_HEADER];
      const kimlik = readRequestIdentity(token);
      const v = verifyRequest(token, { publicKeyX: kurulumX, body: req.body ?? "", nowMs: Date.now(), purposes: ["esitle"], installationId: kurulumId });
      const govde = JSON.parse(req.body ?? "{}") as Record<string, unknown>;
      b.cagrilar.push({ yol, govde, imzaGecerli: kimlik.ok && v.ok });
      if (!v.ok) return { status: 401, body: JSON.stringify({ success: false, message: "imza", details: { code: "ISTEK_IMZA" } }) };
      if (yol === SYNC_PATHS.ACCOUNTS) {
        return { status: 200, body: JSON.stringify({ v: 1, hesaplar: [{ id: randomUUID(), ad: "Ayşe Patron", eposta: "ayse@example.com", durum: "AKTIF", sonGiris: null, gizli: "düşer" }] }) };
      }
      if (yol === SYNC_PATHS.INBOX_CLAIM) {
        const kayitlar = b.kuyruk.splice(0, 20);
        return { status: 200, body: JSON.stringify({ v: 1, kayitlar }) };
      }
      if (yol === SYNC_PATHS.INBOX_RESULT) return { status: 200, body: JSON.stringify({ v: 1, kabul: (govde.sonuclar as { mesajId: string }[]).map((x) => x.mesajId), ret: [] }) };
      return { status: 404, body: "{}" };
    },
  };
  return b;
}

async function bolum10(aktor: string, kartId: string): Promise<void> {
  console.log("\n§10 gelen kutusu işi (sahte bulut)");
  setCloudUrlForTests("https://patron-bulut.test");
  const bulutEk = { esitlemeAraligiDk: 5, patronBulutBitis: msToIso(Date.now() + 30 * DAY_MS) };
  const tamModul = ["production.enabled", "finance.enabled", "ticaret.enabled", PATRON_CLOUD_ENTITLEMENT];

  // Ön koşul yok (HAK'ta patron-bulut yok) → hiç dış istek.
  let kur = lisansKipKur({ zorlama: false, kiraEk: bulutEk });
  let bulut = sahteBulut(kur.f.kurulum.x, kur.f.kurulumId);
  __resetCloudInboxJobForTests();
  let r = await runCloudInboxOnce(bulut.tasiyici);
  check("HAK'ta patron-bulut yok → KAPALI, sıfır dış istek", r.outcome === "KAPALI" && r.reason === "PATRON_BULUT_HAKKI_YOK" && bulut.cagrilar.length === 0, `${r.outcome}:${r.reason ?? ""} çağrı=${bulut.cagrilar.length}`);

  // Abonelik yok (kira patronBulutBitis null) → fail-closed.
  kur = lisansKipKur({ zorlama: false, moduller: tamModul, kiraEk: { esitlemeAraligiDk: 5 } });
  bulut = sahteBulut(kur.f.kurulum.x, kur.f.kurulumId);
  r = await runCloudInboxOnce(bulut.tasiyici);
  check("abonelik bitişi yok → KAPALI (ABONELIK_YOK), sıfır dış istek", r.outcome === "KAPALI" && r.reason === "ABONELIK_YOK" && bulut.cagrilar.length === 0, `${r.outcome}:${r.reason ?? ""}`);

  // Uygun, gözlem kipi → al → işle → sonuç.
  kur = lisansKipKur({ zorlama: false, moduller: tamModul, kiraEk: bulutEk });
  bulut = sahteBulut(kur.f.kurulum.x, kur.f.kurulumId);
  const yeniKart = mesaj("CARI", { ad: `Bulut İş ${DAMGA}`, roller: { musteri: true, tedarikci: false } }, { olusturulma: new Date(Date.now() - 2000).toISOString() });
  const siparis = mesaj("SIPARIS", { cariKartId: kartId, doviz: "TRY", kalemler: [{ urunId: fikstur.urunId, miktar: "10" }] }, { olusturulma: new Date(Date.now() - 1000).toISOString() });
  bulut.kuyruk.push(siparis, yeniKart);
  r = await runCloudInboxOnce(bulut.tasiyici);
  for (const o of r.outcomes) kaydet(o, o.mesajId === siparis.mesajId ? "SIPARIS" : "CARI");
  const yollar = bulut.cagrilar.map((c) => c.yol);
  check("sıra: hesaplar → al → sonuç; hepsi kurulum anahtarıyla imzalı", JSON.stringify(yollar) === JSON.stringify([SYNC_PATHS.ACCOUNTS, SYNC_PATHS.INBOX_CLAIM, SYNC_PATHS.INBOX_RESULT]) && bulut.cagrilar.every((c) => c.imzaGecerli), yollar.join(" → "));
  const sonuclar = (bulut.cagrilar[2]?.govde.sonuclar ?? []) as InboxOutcome[];
  check("iki kayıt ISLENDI, olusturma sırasıyla (önce cari)", r.outcome === "BASARILI" && sonuclar.length === 2 && sonuclar.every((s) => s.durum === "ISLENDI") && sonuclar[0]?.mesajId === yeniKart.mesajId, JSON.stringify(sonuclar.map((s) => [s.durum, s.kod])));
  const durum = await getPatronCloudStatus();
  check("bulut hesapları durum özetinde (bilinmeyen alan düşer)", durum.hesaplar.length === 1 && durum.hesaplar[0]?.ad === "Ayşe Patron" && !("gizli" in (durum.hesaplar[0] as object)) && durum.etkin);

  // Aynı mesaj bulut claim süresi dolup yeniden verilirse → aynı sonuç, yeni sipariş yok.
  bulut.cagrilar.length = 0;
  bulut.kuyruk.push(siparis);
  const once = await prisma.order.count({ where: { clientToken: siparis.mesajId } });
  r = await runCloudInboxOnce(bulut.tasiyici);
  const sonra = await prisma.order.count({ where: { clientToken: siparis.mesajId } });
  const tekrar = (bulut.cagrilar.find((c) => c.yol === SYNC_PATHS.INBOX_RESULT)?.govde.sonuclar ?? []) as InboxOutcome[];
  check("yeniden verilen mesaj → aynı sonuç, ikinci sipariş yok", once === 1 && sonra === 1 && tekrar[0]?.varlikId === sonuclar.find((s) => s.mesajId === siparis.mesajId)?.varlikId);

  // zorla + K4 (KISITLI): hesap listesi tazelenir ama `al` ÇAĞRILMAZ.
  kur = lisansKipKur({ zorlama: true, kademe: "K4", moduller: tamModul, kiraEk: bulutEk });
  bulut = sahteBulut(kur.f.kurulum.x, kur.f.kurulumId);
  bulut.kuyruk.push(mesaj("CARI", { ad: `Kısıtlı ${DAMGA}`, roller: { musteri: true, tedarikci: false } }));
  r = await runCloudInboxOnce(bulut.tasiyici);
  check(
    "zorla+KISITLI → LISANS_KISITLI, `al` çağrılmaz (kayıt bulutta BEKLIYOR)",
    kur.snap.state.uygulananKademe === "KISITLI" && r.outcome === "LISANS_KISITLI" && !bulut.cagrilar.some((c) => c.yol === SYNC_PATHS.INBOX_CLAIM) && bulut.kuyruk.length === 1,
    `kademe=${kur.snap.state.uygulananKademe} ${r.outcome} yollar=${bulut.cagrilar.map((c) => c.yol).join(",")}`,
  );
  setCloudUrlForTests(null);
  temizleLisansKipDizini();
}

// ── teardown ────────────────────────────────────────────────────────────────────────────────────
async function temizlik(): Promise<void> {
  const siparisler = [...yaratilan.siparis];
  const kartlar = [...yaratilan.kart];
  await prisma.orderLine.deleteMany({ where: { orderId: { in: siparisler } } });
  await prisma.order.deleteMany({ where: { id: { in: siparisler } } });
  await prisma.cloudInboxReceipt.deleteMany({ where: { messageId: { in: [...yaratilan.mesaj] } } });
  await prisma.customerItemAlias.deleteMany({ where: { customerId: { in: kartlar } } });
  await prisma.customerColorAlias.deleteMany({ where: { customerId: { in: kartlar } } });
  await prisma.cariAccount.deleteMany({ where: { customerId: { in: kartlar } } });
  await prisma.customer.deleteMany({ where: { id: { in: kartlar } } });
  if (fikstur.urunId) await prisma.item.deleteMany({ where: { id: fikstur.urunId } });
  if (fikstur.renkId) await prisma.color.deleteMany({ where: { id: fikstur.renkId } });
  const simdiki = await readPatronCloudUserId();
  if (simdiki && simdiki !== onceTeknikKullaniciId) {
    // Sonda koşumunda (kapı delinmişken) makbuzsuz kart ve oturum satırı doğabilir — teardown yine de temiz bitsin.
    const artik = (await prisma.customer.findMany({ where: { createdById: simdiki }, select: { id: true } })).map((c) => c.id);
    await prisma.cariAccount.deleteMany({ where: { customerId: { in: artik } } });
    await prisma.customer.deleteMany({ where: { id: { in: artik } } });
    await prisma.session.deleteMany({ where: { userId: simdiki } });
    await prisma.userPermission.deleteMany({ where: { userId: simdiki } });
    await prisma.user.deleteMany({ where: { id: simdiki } });
  }
  if (!onceAyarVar) await prisma.systemSetting.deleteMany({ where: { key: PATRON_CLOUD_USER_SETTING_KEY } });
  __resetPatronCloudStateForTests();
  __resetCloudInboxJobForTests();
}

async function main(): Promise<void> {
  onceTeknikKullaniciId = await readPatronCloudUserId();
  onceAyarVar = onceTeknikKullaniciId !== null;
  const admin = await ensureTestAdmin();
  try {
    fikstur.urunId = (await prisma.item.create({ data: { code: `BGK-${DAMGA}`, name: `BGK URUN ${DAMGA}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
    fikstur.renkId = (await prisma.color.create({ data: { code: `BGK-${DAMGA}`, name: `BGK RENK ${DAMGA}` }, select: { id: true } })).id;
    bolum1();
    const aktor = await bolum2(admin.id);
    const kartId = await bolum3ile5(aktor);
    await bolum6ile8(aktor, kartId);
    await bolum9(aktor);
    await bolum10(aktor, kartId);
  } finally {
    await temizlik();
  }
}

main()
  .catch((e: unknown) => {
    fail++;
    console.error("❌ beklenmeyen hata:", e);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail === 0 ? 0 : 1);
  });
