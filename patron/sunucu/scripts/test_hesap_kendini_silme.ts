// =============================================================================
// KENDİ HESABINI SİLME BEKÇİSİ (Google Play hesap silme politikası) — saat ENJEKTE, gerçek HTTP `POST /api/oturum/hesap-sil`:
//   §1 yanlış faktör: yanlış TOTP · yanlış parola → 400 GIRIS_BASARISIZ, hiçbir şey değişmez, ayak izi · gövdesiz 400
//   §2 mutlu yol (tek tesis): 200 · hesap PASİF + kapanış anı · merkez kimlik PASİF + kapanış anı · bütün oturumlar 401 ·
//      cihaz pasif · ayak izi HESAP_KENDINI_SILDI · aynı üçlüyle giriş 401
//   §3 ikinci çağrı: aynı belirteç 401 OTURUM_YOK, durum ve kapanış anı değişmez (idempotent, zararsız)
//   §4 son yönetici: 409 SON_YONETICI (`details.tesisler`), hesap/kimlik/oturum aynen · ikinci yönetici varken silinir
//   §5 çok tesisli kimlik: başka tesiste son yöneticiyse HİÇBİR tesis değişmez · değilse A + C (AKTİF) + D (KİLİTLİ)
//      üyelikleri PASİF, öteki tesisteki oturum da 401, kimlik PASİF · başka kimlik etkilenmez
//   §6 tek kaynak: 30. günde bakımın MEVCUT silmesi hesabı ve kimliği tombstone'a çeker (29. günde dokunmaz)
//   §7 geri alma yolu: silmeden sonra yönetici aynı e-postayı yeniden davet edebilir (201)
// Koşum: npx tsx scripts/test_hesap_kendini_silme.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { withCentral, withTesis } from "../src/lib/tenant";
import { IDENTITY_PURGE_DAYS, purgeCentralIdentities, purgeClosedIdentities, tombstoneEmail } from "../src/services/maintenance";
import type { AccountDeletion } from "../src/wire/api";
import { TEST_PAROLASI, api, hesapKur, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, totpKodu, type Ortam, type TestHesabi, type Yanit } from "./lib/test-ortam";

const GUN = 86_400_000;
const OKUMA = ["bulut:siparis:oku"];
const YONETICI = ["bulut:hesap:yonet", "bulut:siparis:oku"];

const kimlik = (o: Ortam, eposta: string) => withCentral(o.goc, {}, (tx) => tx.identity.findUnique({ where: { emailDigest: o.anahtar.emailDigest(eposta) } }));
const kimlikId = (o: Ortam, id: string) => withCentral(o.goc, {}, (tx) => tx.identity.findUnique({ where: { id } }));
const hesap = (o: Ortam, tesisId: string, id: string) => withTesis(o.goc, { tesisId }, (tx) => tx.account.findUnique({ where: { id } }));
const olaylar = (o: Ortam, tesisId: string, entityId: string) =>
  withTesis(o.goc, { tesisId }, (tx) => tx.accountAudit.findMany({ where: { tesisId, entityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).then((r) => r.map((x) => x.event));
const oturum = async (o: Ortam, belirtec: string): Promise<number> => (await api(o, "GET", "/api/oturum", { belirtec })).status;

async function sil(o: Ortam, h: Pick<TestHesabi, "sir" | "belirtec">, g: { parola?: string; totp?: string; belirtec?: string } = {}): Promise<Yanit> {
  o.saat.ilerlet(31_000);
  return api(o, "POST", "/api/oturum/hesap-sil", { belirtec: g.belirtec ?? h.belirtec, govde: { parola: g.parola ?? TEST_PAROLASI, totp: g.totp ?? totpKodu(h.sir, o.saat.simdi()) } });
}

async function giris(o: Ortam, h: Pick<TestHesabi, "eposta" | "sir">, tesisId?: string): Promise<Yanit> {
  o.saat.ilerlet(31_000);
  return api(o, "POST", "/api/oturum/ac", { govde: { eposta: h.eposta, parola: TEST_PAROLASI, totp: totpKodu(h.sir, o.saat.simdi()), ...(tesisId ? { tesisId } : {}) } });
}
const belirtecOf = (r: Yanit): string => (r.json.data as { belirtec: string }).belirtec;

/** Kimliğin başka tesise üyeliği (göç rolüyle — `test_coklu_tesis` kalıbı). */
async function uyeEkle(o: Ortam, tesisId: string, h: TestHesabi, g: { status: "AKTIF" | "KILITLI"; izinler: readonly string[] }): Promise<string> {
  const k = await kimlik(o, h.eposta);
  const a = await withTesis(o.goc, { tesisId }, (tx) => tx.account.create({ data: { tesisId, email: h.eposta, name: "Ortak Patron", permissions: [...g.izinler], status: g.status, identityId: k!.id } }));
  await withCentral(o.goc, {}, (tx) => tx.loginRoute.create({ data: { identityId: k!.id, tesisId, accountId: a.id } }));
  return a.id;
}

async function yanlisFaktor(o: Ortam, a: string, k: TestHesabi): Promise<void> {
  console.log("\n§1 yanlış faktör");
  const eskiKod = totpKodu(k.sir, o.saat.simdi() - 10 * 60_000);
  const r1 = await sil(o, k, { totp: eskiKod });
  const r2 = await sil(o, k, { parola: "yanlis-parola-yanlis-parola" });
  const r3 = await api(o, "POST", "/api/oturum/hesap-sil", { belirtec: k.belirtec, govde: {} });
  const h = await hesap(o, a, k.accountId);
  kontrol("§1a yanlış TOTP → 400 GIRIS_BASARISIZ (details.code)", r1.status === 400 && r1.json.details?.code === "GIRIS_BASARISIZ", `${r1.status} ${r1.json.details?.code}`);
  kontrol("§1b yanlış parola → 400 GIRIS_BASARISIZ", r2.status === 400 && r2.json.details?.code === "GIRIS_BASARISIZ", `${r2.status} ${r2.json.details?.code}`);
  kontrol("§1c gövdesiz istek → 400 GOVDE_GECERSIZ", r3.status === 400 && r3.json.details?.code === "GOVDE_GECERSIZ");
  kontrol("§1d hiçbir şey değişmez: hesap + kimlik AKTİF, oturum açık", h?.status === "AKTIF" && (await kimlik(o, k.eposta))?.status === "AKTIF" && (await oturum(o, k.belirtec)) === 200);
  kontrol("§1e ayak izi: GIRIS_BASARISIZ ×2", (await olaylar(o, a, k.accountId)).filter((e) => e === "GIRIS_BASARISIZ").length === 2);
}

async function mutluYol(o: Ortam, a: string, k: TestHesabi): Promise<{ kapanis: number; ikinci: string }> {
  console.log("\n§2 mutlu yol (tek tesis)");
  const ikinci = belirtecOf(await giris(o, k));
  const cihaz = await api(o, "POST", "/api/cihazlar", { belirtec: k.belirtec, govde: { platform: "android", belirtec: `ExponentPushToken[${randomUUID()}]`, ad: "Telefon" } });
  const r = await sil(o, k);
  const kapanis = o.saat.simdi();
  const d = r.json.data as AccountDeletion;
  kontrol("§2a 200 · tesisSayisi 1 · silinme = kapanış + 30 gün", cihaz.status === 201 && r.status === 200 && d.tesisSayisi === 1 && Date.parse(d.kapanis) === kapanis && Date.parse(d.silinme) === kapanis + IDENTITY_PURGE_DAYS * GUN, JSON.stringify(r.json).slice(0, 200));
  const h = await hesap(o, a, k.accountId);
  const i = await kimlik(o, k.eposta);
  kontrol("§2b hesap PASİF, kapanış anı AYNI claim'de", h?.status === "PASIF" && h.closedAt?.getTime() === kapanis, `${h?.status} ${h?.closedAt?.toISOString()}`);
  kontrol("§2c merkez kimlik PASİF, kapanış anı dolu", i?.status === "PASIF" && i.closedAt?.getTime() === kapanis, `${i?.status}`);
  kontrol("§2d bütün oturumlar düşer (iki belirteç 401)", (await oturum(o, k.belirtec)) === 401 && (await oturum(o, ikinci)) === 401);
  const aktifCihaz = await withTesis(o.goc, { tesisId: a }, (tx) => tx.pushDevice.count({ where: { tesisId: a, accountId: k.accountId, active: true } }));
  kontrol("§2e cihaz kaydı pasif", aktifCihaz === 0, String(aktifCihaz));
  kontrol("§2f ayak izi HESAP_KENDINI_SILDI", (await olaylar(o, a, k.accountId)).includes("HESAP_KENDINI_SILDI"));
  const g = await giris(o, k);
  kontrol("§2g aynı üçlüyle giriş 401 GIRIS_BASARISIZ", g.status === 401 && g.json.details?.code === "GIRIS_BASARISIZ", String(g.status));
  return { kapanis, ikinci };
}

async function ikinciCagri(o: Ortam, a: string, k: TestHesabi, kapanis: number): Promise<void> {
  console.log("\n§3 ikinci çağrı");
  const r = await sil(o, k);
  const h = await hesap(o, a, k.accountId);
  const i = await kimlik(o, k.eposta);
  kontrol("§3a aynı belirteç → 401 OTURUM_YOK", r.status === 401 && r.json.details?.code === "OTURUM_YOK", `${r.status} ${r.json.details?.code}`);
  kontrol("§3b durum ve kapanış anı değişmez", h?.status === "PASIF" && h.closedAt?.getTime() === kapanis && i?.closedAt?.getTime() === kapanis);
  kontrol("§3c ayak izi tek HESAP_KENDINI_SILDI", (await olaylar(o, a, k.accountId)).filter((e) => e === "HESAP_KENDINI_SILDI").length === 1);
}

async function sonYonetici(o: Ortam, b: string): Promise<void> {
  console.log("\n§4 son yönetici");
  const y = await hesapKur(o, b, YONETICI);
  const r = await sil(o, y);
  const tesisler = (r.json.details?.tesisler ?? []) as { id: string }[];
  kontrol("§4a tek aktif yönetici → 409 SON_YONETICI, details.tesisler bu tesis", r.status === 409 && r.json.details?.code === "SON_YONETICI" && tesisler.length === 1 && tesisler[0]!.id === b, `${r.status} ${JSON.stringify(r.json.details)}`);
  kontrol("§4b ileti Türkçe ve yolu söyler", typeof r.json.message === "string" && r.json.message.includes("hesap yöneticisi"), r.json.message);
  kontrol("§4c hesap + kimlik AKTİF, oturum açık", (await hesap(o, b, y.accountId))?.status === "AKTIF" && (await kimlik(o, y.eposta))?.status === "AKTIF" && (await oturum(o, y.belirtec)) === 200);
  await hesapKur(o, b, YONETICI);
  const r2 = await sil(o, y);
  kontrol("§4d ikinci aktif yönetici varken yönetici kendini silebilir", r2.status === 200 && (await hesap(o, b, y.accountId))?.status === "PASIF", String(r2.status));
}

async function cokTesis(o: Ortam, t: { a: string; c: string; d: string }, baskasi: TestHesabi): Promise<void> {
  console.log("\n§5 çok tesisli kimlik");
  const m = await hesapKur(o, t.a, OKUMA);
  const mC = await uyeEkle(o, t.c, m, { status: "AKTIF", izinler: YONETICI });
  const mD = await uyeEkle(o, t.d, m, { status: "KILITLI", izinler: OKUMA });
  const r1 = await sil(o, m);
  kontrol("§5a C'de son yönetici → 409 SON_YONETICI, A'daki oturumdan da", r1.status === 409 && r1.json.details?.code === "SON_YONETICI" && ((r1.json.details?.tesisler ?? []) as { id: string }[]).map((x) => x.id).join() === t.c, JSON.stringify(r1.json.details));
  kontrol("§5b HİÇBİR tesis değişmez (A AKTİF, C AKTİF, D KİLİTLİ, kimlik AKTİF)", (await hesap(o, t.a, m.accountId))?.status === "AKTIF" && (await hesap(o, t.c, mC))?.status === "AKTIF" && (await hesap(o, t.d, mD))?.status === "KILITLI" && (await kimlik(o, m.eposta))?.status === "AKTIF");
  await withTesis(o.goc, { tesisId: t.c }, (tx) => tx.account.update({ where: { id: mC }, data: { permissions: OKUMA } }));
  const cOturum = belirtecOf(await giris(o, m, t.c));
  const r2 = await sil(o, m);
  const durumlar = [(await hesap(o, t.a, m.accountId))?.status, (await hesap(o, t.c, mC))?.status, (await hesap(o, t.d, mD))?.status].join(",");
  kontrol("§5c 200 · tesisSayisi 3 · A + C + D (KİLİTLİ dahil) PASİF", r2.status === 200 && (r2.json.data as AccountDeletion).tesisSayisi === 3 && durumlar === "PASIF,PASIF,PASIF", `${r2.status} ${durumlar}`);
  kontrol("§5d öteki tesisteki oturum da düşer (C 401)", (await oturum(o, cOturum)) === 401 && (await oturum(o, m.belirtec)) === 401);
  kontrol("§5e kimlik PASİF; her tesiste ayak izi", (await kimlik(o, m.eposta))?.status === "PASIF" && (await olaylar(o, t.c, mC)).includes("HESAP_KENDINI_SILDI") && (await olaylar(o, t.d, mD)).includes("HESAP_KENDINI_SILDI"));
  kontrol("§5f başka kimlik etkilenmez", (await kimlik(o, baskasi.eposta))?.status === "AKTIF" && (await oturum(o, baskasi.belirtec)) === 200);
}

async function otuzGun(o: Ortam, a: string, k: TestHesabi, kapanis: number): Promise<void> {
  console.log("\n§6 30. gün: mevcut silme düzeneği");
  const id = (await withTesis(o.goc, { tesisId: a }, (tx) => tx.account.findUnique({ where: { id: k.accountId }, select: { identityId: true } })))?.identityId ?? "";
  const erken = kapanis + (IDENTITY_PURGE_DAYS - 1) * GUN;
  await purgeClosedIdentities(o.ctx, a, erken);
  await purgeCentralIdentities(o.ctx, erken);
  kontrol("§6a 29. gün: hesap ve kimlik durur", (await hesap(o, a, k.accountId))?.identityPurgedAt === null && (await kimlikId(o, id))?.passwordHash !== null);
  const sinir = kapanis + IDENTITY_PURGE_DAYS * GUN;
  await purgeClosedIdentities(o.ctx, a, sinir);
  await purgeCentralIdentities(o.ctx, sinir);
  const h = await hesap(o, a, k.accountId);
  const i = await kimlikId(o, id);
  kontrol("§6b 30. gün: hesap tombstone (ad/e-posta), kimlik sırsız", h?.email === tombstoneEmail(k.accountId) && h.identityPurgedAt !== null && i?.passwordHash === null && i.totpSecretSealed === null && i.identityPurgedAt !== null, `${h?.email} ${i?.status}`);
}

async function geriAlma(o: Ortam, a: string, yonetici: TestHesabi, eposta: string): Promise<void> {
  console.log("\n§7 geri alma yolu: yeniden davet");
  const r = await api(o, "POST", "/api/hesaplar", { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID(), eposta, ad: "Geri Dönen", sablon: "PATRON" } });
  kontrol("§7a silinen e-posta aynı tesiste yeniden davet edilebilir (201)", r.status === 201, `${r.status} ${r.json.details?.code}`);
}

async function main(): Promise<void> {
  const o = await ortamKur();
  const t = { a: (await tesisKur(o)).tesisId, b: (await tesisKur(o)).tesisId, c: (await tesisKur(o)).tesisId, d: (await tesisKur(o)).tesisId };
  try {
    const yonA = await hesapKur(o, t.a, YONETICI);
    const k = await hesapKur(o, t.a, OKUMA);
    await yanlisFaktor(o, t.a, k);
    const { kapanis } = await mutluYol(o, t.a, k);
    await ikinciCagri(o, t.a, k, kapanis);
    await sonYonetici(o, t.b);
    await cokTesis(o, t, yonA);
    await geriAlma(o, t.a, yonA, k.eposta);
    await otuzGun(o, t.a, k, kapanis);
  } finally {
    for (const id of Object.values(t)) await temizleTesis(o, id);
    await o.kapat();
  }
  sonuc();
}

void main();
