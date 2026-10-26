// =============================================================================
// Test: e-İrsaliye KAYIT MOTORU (E5-MOTOR, plan §3.2–§3.7) — servis düzeyi, test DB
// =============================================================================
// §1 YAPILANDIRILMAMIS → 409 + eksikler · §2 hazırla → TASLAK; aynı token replay → aynı kayıt;
// farklı token → 409 · §3 üret → GİB numarası + ETTN + XML v1 + olay · §4 eşzamanlı iki üret →
// biri 409, tek numara, sırada boşluk yok · §5 yeniden üret: indirilmişse onaysız 409, onaylı
// v+1 aynı no/ETTN · §6 elle gönderildi → GONDERILDI, yeni XML sürümü DB'de yazılamaz · §7 geri al
// → OLUSTURULDU + karşı olay, ileri olay duruyor; yanıt kaydı + geri alma · §8 simülasyon
// gönder + sorgula belirlenimli (KABUL/RED/HATA), RED yerine yeni kayıt `replacesId` · §9 iptal →
// IPTAL, aynı kaynağa yeni kayıt, numara yeniden kullanılmaz · §10 EXPORT → 400, sevk edilmemiş →
// 409 · §11 audit yükünde TCKN ve XML yok · §12 başlangıç değeri kilidi (8041) üretimden sonra 409 ·
// §13 kayıtlar listesi + özet şeridi TEK where (E7): her süzgeçte liste adedi = özet toplamı.
//
// NEGATİF SONDALAR (2026-10-25, cp+md5 ile geri alındı; 51/0 yeşilken):
//   (a) `transitionEIrsaliyeTx` claim'i `findUnique → update({where:{id}})`a çevrildi → 3 ❌
//       (§4a/§4b/§7e: ikinci üretim de "başarılı", ikinci numara tüketildi).
//   (b) `prepare` içinde `requireReady(gate)` kaldırıldı → 4 ❌ (§1a/§1b/§1c: TASLAK doğdu).
//   (c) `transitionEIrsaliyeTx`ten `writeEIrsaliyeEventTx` çıkarıldı → 5 ❌ (§3d/§3f/§7b/§7d/§9b).
//   (d) `codeCountsForCounter` E2 düzeltmesi geri alındı → §12a ❌ (başlangıç kilidi fail-open).
//   (e) 2026-10-25 E7: `summarizeEIrsaliyeRecords` süzgeçsiz where'le koşuldu → 3 ❌ (§13a: özet 6 ↔ liste 2/1/4).
//
// Çalıştır: npx tsx scripts/test_e_irsaliye_flow.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { DEFAULT_COMPANY_LEGAL_IDENTITY } from "../src/services/e-irsaliye/e-irsaliye-settings";
import * as eirs from "../src/services/e-irsaliye/e-irsaliye.service";
import { simulatedOutcome } from "../src/services/e-irsaliye/adapters/simulasyon.adapter";
import { validateDespatchXml } from "../src/services/e-irsaliye/despatch-advice.validate";
import { sha256Hex } from "../src/services/e-irsaliye/e-irsaliye-common.helper";
import { listEIrsaliyeRecords, summarizeEIrsaliyeRecords } from "../src/services/e-irsaliye/e-irsaliye-list.helper";
import { updateSeriesCounter } from "../src/services/helpers/series-write.helper";
import { dispatchDoc, envelope } from "./fixture-e-irsaliye";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const P = `E5T${Date.now().toString(36).toUpperCase()}`;
// Sağlaması tutan KURGU kimlikler (gerçek kişi/firma değil): NVİ test TCKN'si ve tax-id altın VKN'si.
const TCKN = "10000000146";
const VKN_SUPPLIER = "4721003456";
const VKN_CUSTOMER = "1234567890".slice(0, 9) + vknCheck("123456789");
const FULL_ID = { ...DEFAULT_COMPANY_LEGAL_IDENTITY, kimlikNo: VKN_SUPPLIER, unvan: "Örnek Dokuma A.Ş.", vergiDairesi: "Uludağ", il: "Bursa", ilce: "Nilüfer" };

function vknCheck(nine: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (Number(nine[i]) + 9 - i) % 10;
    sum += t === 9 ? 9 : (t * 2 ** (9 - i)) % 9;
  }
  return String((10 - (sum % 10)) % 10);
}

type Err = { statusCode?: number; details?: Record<string, unknown> };
async function errOf(fn: () => Promise<unknown>): Promise<Err | null> {
  try { await fn(); return null; } catch (e) { return e as Err; }
}
const codeOf = (e: Err | null) => String(e?.details?.code ?? "");

let customerId = "";
let userId: string | null = null;
const shipmentIds: string[] = [];
const savedSettings = new Map<string, unknown>();

async function setSetting(key: string, value: unknown) {
  await prisma.systemSetting.upsert({ where: { key }, update: { value: value as object }, create: { key, value: value as object } });
}

async function makeShipment(tag: string, over: { destination?: "DOMESTIC" | "EXPORT"; status?: "DISPATCHED" | "PLANNED" } = {}) {
  const s = await prisma.shipment.create({
    data: {
      shipmentNo: `${P}-${tag}`, customerId, status: over.status ?? "DISPATCHED", destination: over.destination ?? "DOMESTIC",
      dispatchedAt: (over.status ?? "DISPATCHED") === "DISPATCHED" ? new Date() : null,
      plateNumber: "16 abc 123", driverName: "Ali Veli", carrier: null,
    },
    select: { id: true },
  });
  shipmentIds.push(s.id);
  const doc = dispatchDoc({
    customerName: `${P} MUSTERI`, taxNumber: VKN_CUSTOMER,
    products: [{ name: "Ham bez 120", customerName: null, rollCount: 3, totalMeters: 300.5 } as never],
    totalKg: 75, sackCount: 1,
  });
  await prisma.printedDocument.create({
    data: { docType: "SHIPMENT_DISPATCH", sourceId: s.id, version: 1, status: "ACTIVE", documentNo: `${P}-${tag}`, snapshot: envelope(doc) as never },
  });
  return s.id;
}

const tok = () => randomUUID();
const withDriver = { driverNationalId: TCKN };

async function main() {
  userId = await testActorId();
  for (const k of [SETTING_KEYS.COMPANY_LEGAL_IDENTITY, SETTING_KEYS.EIRSALIYE_CONFIG]) {
    savedSettings.set(k, (await prisma.systemSetting.findUnique({ where: { key: k } }))?.value ?? null);
  }
  customerId = (await prisma.customer.create({
    data: { code: `${P}-C`, name: `${P} MUSTERI`, taxNumber: VKN_CUSTOMER, city: "İstanbul", district: "Kadıköy", address: "Moda Cad. 1", country: "Türkiye" },
    select: { id: true },
  })).id;
  const A = await makeShipment("A");

  console.log("\n§1 yapılandırılmamış → 409 + eksikler");
  await setSetting(SETTING_KEYS.EIRSALIYE_CONFIG, { adapter: "yok", yururlukTarihi: null });
  await setSetting(SETTING_KEYS.COMPANY_LEGAL_IDENTITY, FULL_ID);
  const e1 = await errOf(() => eirs.prepare(A, {}, tok(), userId));
  check("§1a hazırla 409 EIRSALIYE_NOT_CONFIGURED", e1?.statusCode === 409 && codeOf(e1) === "EIRSALIYE_NOT_CONFIGURED", codeOf(e1));
  check("§1b eksikler Türkçe listede", Array.isArray(e1?.details?.eksikler) && (e1!.details!.eksikler as string[]).some((m) => /yöntemi/.test(m)));
  check("§1c kayıt doğmadı", (await prisma.eIrsaliye.count({ where: { sourceId: A } })) === 0);
  await setSetting(SETTING_KEYS.EIRSALIYE_CONFIG, { adapter: "disaAktar", yururlukTarihi: "2026-01-01" });
  check("§1d tam yapılandırma HAZIR", (await eirs.getReadiness()).durum === "HAZIR", (await eirs.getReadiness()).eksikler.join(" | "));

  console.log("\n§2 hazırla → TASLAK · idempotency");
  const t1 = tok();
  const p1 = await eirs.prepare(A, {}, t1, userId);
  const a = p1.kayit;
  check("§2a TASLAK doğdu, numara yok", a.status === "TASLAK" && a.documentNo === null && a.adapter === "disaAktar");
  check("§2b taşıma önerisi: plaka normalleşti, şoför bölündü", a.licensePlate === "16ABC123" && a.driverFirstName === "Ali" && a.driverFamilyName === "Veli", `${a.licensePlate} ${a.driverFirstName} ${a.driverFamilyName}`);
  const ev2 = await prisma.eIrsaliyeEvent.findMany({ where: { eIrsaliyeId: a.id } });
  check("§2c HAZIRLANDI doğuş olayı", ev2.length === 1 && ev2[0]!.type === "HAZIRLANDI" && ev2[0]!.fromStatus === null);
  const p1b = await eirs.prepare(A, {}, t1, userId);
  check("§2d aynı token replay → aynı kayıt", p1b.kayit.id === a.id && (await prisma.eIrsaliye.count({ where: { sourceId: A } })) === 1);
  const e2 = await errOf(() => eirs.prepare(A, {}, tok(), userId));
  check("§2e farklı token → 409 EIRSALIYE_ALREADY_EXISTS", e2?.statusCode === 409 && codeOf(e2) === "EIRSALIYE_ALREADY_EXISTS", codeOf(e2));
  const e2f = await errOf(() => eirs.updateFields(a.id, { driverNationalId: "12345678901" }, userId));
  check("§2f geçersiz TCKN 400", e2f?.statusCode === 400 && codeOf(e2f) === "EIRSALIYE_FIELD_INVALID");
  await eirs.updateFields(a.id, withDriver, userId);
  const eVal = await errOf(() => eirs.updateFields(a.id, { carrierTaxId: "1111111111" }, userId));
  check("§2g geçersiz taşıyıcı VKN 400", eVal?.statusCode === 400);

  console.log("\n§3 üret → numara + ETTN + XML v1");
  const g1 = await eirs.generate(a.id, userId);
  const year = g1.kayit.documentNo?.slice(3, 7) ?? "";
  check("§3a OLUSTURULDU + GİB biçimli numara", g1.kayit.status === "OLUSTURULDU" && /^EIR20\d{2}\d{9}$/.test(g1.kayit.documentNo ?? ""), g1.kayit.documentNo ?? "");
  check("§3b ETTN UUID", /^[0-9a-f-]{36}$/.test(g1.kayit.ettn ?? ""));
  const x1 = await prisma.eIrsaliyeXml.findUnique({ where: { id: g1.kayit.currentXmlId! } });
  check("§3c XML v1 yazıldı, sha tutarlı, yapısal doğrulama geçer", !!x1 && x1.version === 1 && x1.sha256 === sha256Hex(x1.xml) && validateDespatchXml(x1.xml).ok && x1.xml.includes(g1.kayit.documentNo!));
  const ev3 = await prisma.eIrsaliyeEvent.findMany({ where: { eIrsaliyeId: a.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  check("§3d OLUSTURULDU olayı XML'e bağlı", ev3.some((e) => e.type === "OLUSTURULDU" && e.xmlId === x1?.id && e.fromStatus === "TASLAK"));
  check("§3e yanıtta XML gövdesi yok", !("xml" in (g1.kayit as object)) && !JSON.stringify(g1).includes("<DespatchAdvice"));
  const view = await eirs.getForShipment(A);
  check("§3f sevkiyat görünümü: canlı kayıt + olaylar, kaynak değişmedi", view.canli?.id === a.id && view.canli.olaylar.length === 2 && view.canli.kaynakDegisti === false && view.ihracat === false);

  console.log("\n§4 eşzamanlı iki üretim");
  const B = await makeShipment("B");
  const b = (await eirs.prepare(B, withDriver, tok(), userId)).kayit;
  const race = await Promise.allSettled([eirs.generate(b.id, userId), eirs.generate(b.id, userId)]);
  const ok4 = race.filter((r) => r.status === "fulfilled");
  const bad4 = race.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  check("§4a biri başarılı, biri 409", ok4.length === 1 && bad4.length === 1 && (bad4[0]!.reason as Err).statusCode === 409, race.map((r) => r.status).join(","));
  const bRec = await prisma.eIrsaliye.findUniqueOrThrow({ where: { id: b.id } });
  const bXml = await prisma.eIrsaliyeXml.count({ where: { eIrsaliyeId: b.id } });
  const seqA = Number(g1.kayit.documentNo!.slice(7));
  check("§4b tek XML, numara A+1 (boşluk yok)", bXml === 1 && Number(bRec.documentNo!.slice(7)) === seqA + 1, `${bRec.documentNo} xml=${bXml}`);

  console.log("\n§5 yeniden üret + indirme onayı");
  const r1 = await eirs.regenerate(a.id, {}, userId);
  check("§5a indirilmemiş → onaysız v2, aynı no + ETTN", r1.xmlVersion === 2 && r1.kayit.documentNo === g1.kayit.documentNo && r1.kayit.ettn === g1.kayit.ettn);
  const d1 = await eirs.download(a.id, undefined, userId);
  check("§5b indirme: dosya adı + XML + sayaç", d1.dosyaAdi === `${g1.kayit.documentNo}.xml` && d1.xml.startsWith("<?xml") && d1.version === 2);
  const aAfterDl = await prisma.eIrsaliye.findUniqueOrThrow({ where: { id: a.id } });
  check("§5c lastDownloadedAt + downloadCount", aAfterDl.lastDownloadedAt !== null && aAfterDl.downloadCount === 1);
  await eirs.download(a.id, 1, userId);
  check("§5d eski sürüm indirmesi sayacı artırmaz", (await prisma.eIrsaliye.findUniqueOrThrow({ where: { id: a.id } })).downloadCount === 1);
  const e5 = await errOf(() => eirs.regenerate(a.id, {}, userId));
  check("§5e indirilmiş → onaysız 409 EIRSALIYE_ALREADY_DOWNLOADED", e5?.statusCode === 409 && codeOf(e5) === "EIRSALIYE_ALREADY_DOWNLOADED");
  const r2 = await eirs.regenerate(a.id, { onay: true }, userId);
  check("§5f onaylı → v3 aynı no + ETTN, indirme bayrağı sıfır", r2.xmlVersion === 3 && r2.kayit.documentNo === g1.kayit.documentNo && r2.kayit.ettn === g1.kayit.ettn && r2.kayit.lastDownloadedAt === null);

  console.log("\n§6 elle gönderildi");
  const s6 = await eirs.markSent(a.id, {}, userId);
  check("§6a GONDERILDI, gönderilen XML = güncel", s6.status === "GONDERILDI" && s6.sentXmlId === r2.kayit.currentXmlId && s6.sentAt !== null);
  const trig = await prisma.eIrsaliyeXml
    .create({ data: { eIrsaliyeId: a.id, version: 99, ettn: s6.ettn!, xml: "<x/>", sha256: "0".repeat(64), validation: {} } })
    .then(() => "yazıldı", (e: Error) => e.message);
  check("§6b DB trigger gönderilmiş kayda yeni XML sürümünü reddeder", /yeni XML sürümü yazılamaz/.test(trig), trig.slice(0, 80));
  const e6 = await errOf(() => eirs.regenerate(a.id, { onay: true }, userId));
  check("§6c gönderilmiş kayıt yeniden üretilemez (409)", e6?.statusCode === 409);
  const e6d = await errOf(() => eirs.updateFields(a.id, { licensePlate: "34XYZ99" }, userId));
  check("§6d gönderilmiş kaydın alanları değişmez (409)", e6d?.statusCode === 409);

  console.log("\n§7 geri al — karşı olay");
  const pv = await eirs.getUndoPreview(a.id);
  check("§7a önizleme: işlem undo-sent, etkiler somut, engel yok", pv.islem === "undo-sent" && pv.etkiler.length >= 2 && pv.engel === null);
  const u7 = await eirs.undoSent(a.id, userId);
  const ev7 = await prisma.eIrsaliyeEvent.findMany({ where: { eIrsaliyeId: a.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  check("§7b OLUSTURULDU + GONDERIM_GERI_ALINDI, ileri GONDERILDI olayı duruyor",
    u7.status === "OLUSTURULDU" && u7.sentXmlId === null && ev7.some((e) => e.type === "GONDERILDI") && ev7.at(-1)?.type === "GONDERIM_GERI_ALINDI");
  await eirs.markSent(a.id, { confirmedNo: g1.kayit.documentNo }, userId);
  const k7 = await eirs.recordResponse(a.id, { durum: "KABUL", not: "Teslim alındı" }, userId);
  check("§7c elle yanıt KABUL", k7.status === "KABUL" && k7.responseNote === "Teslim alındı");
  const u7b = await eirs.undoResponse(a.id, userId);
  const ev7b = await prisma.eIrsaliyeEvent.findMany({ where: { eIrsaliyeId: a.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  check("§7d yanıt geri alındı → GONDERILDI, YANIT_KAYDEDILDI duruyor", u7b.status === "GONDERILDI" && u7b.responseAt === null && ev7b.some((e) => e.type === "YANIT_KAYDEDILDI") && ev7b.at(-1)?.type === "YANIT_GERI_ALINDI");
  const e7 = await errOf(() => eirs.cancel(a.id, userId));
  check("§7e gönderilmiş kayıt iptal edilemez (409)", e7?.statusCode === 409);

  console.log("\n§8 simülasyon bağdaştırıcısı");
  const rule = ["0", "6", "7", "8", "9", "a", "f"].map((d) => simulatedOutcome(`00000000-0000-0000-0000-00000000000${d}`));
  check("§8a kural: 0,6→KABUL · 7,8→RED · 9→HATA · a,f→KABUL", rule.join(",") === "KABUL,KABUL,REDDEDILDI,REDDEDILDI,HATA,KABUL,KABUL", rule.join(","));
  const e8b = await errOf(() => eirs.send(b.id, userId));
  check("§8b dışa aktar kaydında send → 400 yetenek yok", e8b?.statusCode === 400 && codeOf(e8b) === "EIRSALIYE_ADAPTER_CAPABILITY");
  await setSetting(SETTING_KEYS.EIRSALIYE_CONFIG, { adapter: "simulasyon", yururlukTarihi: "2026-01-01" });
  const D = await makeShipment("D");
  const d = (await eirs.prepare(D, withDriver, tok(), userId)).kayit;
  const gd = await eirs.generate(d.id, userId);
  check("§8c simülasyon kaydı işaretli", gd.kayit.adapter === "simulasyon" && gd.kayit.simulasyon === true);
  const e8d = await errOf(() => eirs.markSent(d.id, {}, userId));
  check("§8d simülasyonda elle işaret 400", e8d?.statusCode === 400 && codeOf(e8d) === "EIRSALIYE_MANUAL_ONLY");
  const sd = await eirs.send(d.id, userId);
  check("§8e gönder → GONDERILDI (ağ yok)", sd.status === "GONDERILDI" && sd.simulasyon === true);
  const pd = await eirs.poll(d.id, userId);
  const want = simulatedOutcome(gd.kayit.ettn!);
  check("§8f sorgu belirlenimli", pd.status === want && pd.sorguSonucu === want, `${pd.status} beklenen ${want}`);
  // RED yolu: ETTN'i kurala göre RED veren değerle yazıp (yalnız test verisi) sorgula.
  const E = await makeShipment("E");
  const e = (await eirs.prepare(E, withDriver, tok(), userId)).kayit;
  await eirs.generate(e.id, userId);
  await prisma.eIrsaliye.update({ where: { id: e.id }, data: { ettn: randomUUID().slice(0, 35) + "7" } });
  await eirs.send(e.id, userId);
  const pe = await eirs.poll(e.id, userId);
  check("§8g ETTN son hanesi 7 → REDDEDILDI", pe.status === "REDDEDILDI");
  const eNew = (await eirs.prepare(E, withDriver, tok(), userId)).kayit;
  check("§8h RED sonrası aynı sevkiyata yeni kayıt, replacesId bağlı", eNew.status === "TASLAK" && eNew.replacesId === e.id);

  console.log("\n§9 iptal");
  const cp = await eirs.getCancelPreview(b.id);
  check("§9a önizleme numara boşluğunu söyler", cp.engel === null && cp.etkiler.some((m) => m.includes(bRec.documentNo!) && /boşta kalacak/.test(m)));
  const c9 = await eirs.cancel(b.id, userId);
  check("§9b IPTAL + IPTAL_EDILDI", c9.status === "IPTAL" && (await prisma.eIrsaliyeEvent.count({ where: { eIrsaliyeId: b.id, type: "IPTAL_EDILDI" } })) === 1);
  const b2 = (await eirs.prepare(B, withDriver, tok(), userId)).kayit;
  const gb2 = await eirs.generate(b2.id, userId);
  const maxSeq = Number((await prisma.eIrsaliye.findFirst({ where: { documentNo: { startsWith: `EIR${year}` }, id: { not: b2.id } }, orderBy: { documentNo: "desc" } }))!.documentNo!.slice(7));
  check("§9c aynı kaynağa yeni kayıt; iptal edilen numara yeniden kullanılmaz", gb2.kayit.documentNo !== bRec.documentNo && Number(gb2.kayit.documentNo!.slice(7)) === maxSeq + 1, gb2.kayit.documentNo ?? "");

  console.log("\n§10 uygunsuz sevkiyat");
  const X = await makeShipment("X", { destination: "EXPORT" });
  const e10 = await errOf(() => eirs.prepare(X, {}, tok(), userId));
  check("§10a EXPORT → 400 EIRSALIYE_EXPORT", e10?.statusCode === 400 && codeOf(e10) === "EIRSALIYE_EXPORT");
  check("§10b görünüm ihracat bayrağı", (await eirs.getForShipment(X)).ihracat === true);
  const Pl = await makeShipment("P", { status: "PLANNED" });
  const e10c = await errOf(() => eirs.prepare(Pl, {}, tok(), userId));
  check("§10c sevk edilmemiş → 409", e10c?.statusCode === 409 && codeOf(e10c) === "EIRSALIYE_SHIPMENT_NOT_DISPATCHED");

  console.log("\n§11 audit yükü");
  const ids = (await prisma.eIrsaliye.findMany({ where: { sourceId: { in: shipmentIds } }, select: { id: true } })).map((r) => r.id);
  const logs = await prisma.systemLog.findMany({ where: { tableName: "E_IRSALIYE", recordId: { in: ids } }, select: { oldData: true, newData: true, changes: true } });
  const blob = JSON.stringify(logs);
  check("§11a her eylem audit'te", logs.length >= 15, `${logs.length} satır`);
  check("§11b yükte TCKN yok, XML yok", !blob.includes(TCKN) && !blob.includes("<DespatchAdvice") && !blob.includes("driverNationalId\":\""));

  console.log("\n§13 kayıtlar listesi ↔ özet şeridi");
  const listAll = async (filters: Record<string, string>) => {
    const out: { status: string }[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const r = await listEIrsaliyeRecords({ search: P, filters, cursor, limit: 3, withTotal: false });
      out.push(...r.items);
      if (!r.pagination.nextCursor) break;
      cursor = r.pagination.nextCursor;
    }
    return out;
  };
  for (const filters of [{}, { status: "IPTAL,OLUSTURULDU" }, { status: "REDDEDILDI" }, { adapter: "simulasyon" }] as Record<string, string>[]) {
    const rows = await listAll(filters);
    const sum = await summarizeEIrsaliyeRecords({ search: P, filters });
    const perStatus = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
    check(`§13a süzgeç ${JSON.stringify(filters)}: liste adedi = özet toplamı, durum dağılımı eşit`,
      rows.length > 0 && rows.length === sum.total && JSON.stringify(Object.entries(perStatus).sort()) === JSON.stringify(Object.entries(sum.byStatus).sort()),
      `${rows.length} ↔ ${sum.total}`);
  }
  const e13 = await errOf(() => listEIrsaliyeRecords({ filters: { status: "YOK_BOYLE" }, limit: 5, withTotal: false }));
  check("§13b tanınmayan durum → 400", e13?.statusCode === 400 && codeOf(e13) === "EIRSALIYE_FILTER_INVALID");

  console.log("\n§12 başlangıç değeri ↔ üretim kilidi");
  savedSeriesStart = await prisma.numberSeries.findUnique({ where: { key: "eIrsaliye" }, select: { startValue: true, startValueYear: true } });
  const e12 = await errOf(() => updateSeriesCounter("eIrsaliye", { startValue: 500, step: null, maxValue: 999_999_999, wrap: false }, userId ?? undefined));
  check("§12a bu yıl numara üretildi → başlangıç 409", e12?.statusCode === 409 && codeOf(e12) === "NUMBER_SERIES_START_LOCKED", `${e12?.statusCode} ${codeOf(e12)} ${(e12 as Error | null)?.message ?? ""}`);
}

// Kilit açık kalırsa (regresyon) §12'nin yazdığı başlangıç geri alınır — sonraki koşumu kirletmesin.
let savedSeriesStart: { startValue: number | null; startValueYear: number | null } | null = null;

async function temizlik(): Promise<void> {
  if (savedSeriesStart) {
    await prisma.numberSeries.update({ where: { key: "eIrsaliye" }, data: { startValue: savedSeriesStart.startValue, startValueYear: savedSeriesStart.startValueYear } });
  }
  const ids = (await prisma.eIrsaliye.findMany({ where: { sourceId: { in: shipmentIds } }, select: { id: true } })).map((r) => r.id);
  // `replacesId` NoAction: yeni kayıtlar önce.
  await prisma.eIrsaliye.updateMany({ where: { id: { in: ids } }, data: { replacesId: null } });
  await prisma.eIrsaliye.deleteMany({ where: { id: { in: ids } } });
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentIds } } });
  await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
  if (customerId) await cleanupTestCustomers([customerId]);
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
