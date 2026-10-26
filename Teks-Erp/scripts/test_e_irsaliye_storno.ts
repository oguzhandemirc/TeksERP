// =============================================================================
// Test: e-İrsaliye ↔ SEVKİYAT çekirdeği (E6-SEVK, plan §1.4 · §3.8) — servis düzeyi, test DB
// =============================================================================
// §0 E5 kapıları sevk tarafından görünür: yapılandırılmamışta üretim yok (409 Türkçe), çift üretim 409
// §1 kayıtsız sevkiyat storno serbest (sıfır fark) · §2 OLUSTURULDU → storno serbest, kayıt kalır,
// yeniden sevkte `kaynakDegisti` · §3 GONDERILDI/KABUL/REDDEDILDI → önizleme = mutasyon cümlesi, 409
// §4 storno+kapat / PLANNED iptal → kayıt IPTAL + olay, önizleme listeler · §5 GONDERILDI iken iptal
// gövdesi doğrudan → 409 (ikinci sed) · §6 liste süzgeci EKSIK/GONDERILDI/SIMULASYON + özet + cursor
// §7 YAPILANDIRILMAMIS'ta süzgeç 400 · §8 eşzamanlı storno ↔ gönderildi işareti: ikisi birden olmaz
// §9 gönderilmiş e-İrsaliyede kâğıt irsaliye revizyonu 409; gönderilmemişte serbest.
//
// NEGATİF SONDALAR (2026-10-25, cp+md5 ile geri alındı; 42/0 yeşilken):
//   (a) `resolveUndoBlockReason`ten e-İrsaliye engel satırı kaldırıldı → 10 ❌ (§3 ×9, §8a both=2).
//   (b) `cancelPlannedShipmentTx`ten `voidLocalEIrsaliyeTx` çağrısı kaldırıldı → 5 ❌ (§4b/§4c/§4e/§5b/§5c).
//   (c) `reissue`den `assertPaperReissueAllowedTx` kaldırıldı → §9b ❌.
//   (d) EKSIK yüklemi `none: {}`a gevşetildi → 4 ❌ (§6a/§6d/§6e/§6f).
//   (e) `markSent` claim'inden `SHIPMENT_STILL_DISPATCHED` kaldırıldı → §8a ❌ (both=4).
//
// Çalıştır: npx tsx scripts/test_e_irsaliye_storno.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { DEFAULT_COMPANY_LEGAL_IDENTITY } from "../src/services/e-irsaliye/e-irsaliye-settings";
import * as eirs from "../src/services/e-irsaliye/e-irsaliye.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import { shippingService } from "../src/services/shipping.service";
import { dispatchDoc, envelope } from "./fixture-e-irsaliye";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const P = `E6T${Date.now().toString(36).toUpperCase()}`;
const TCKN = "10000000146"; // NVİ test TCKN'si (kurgu)
const VKN_SUPPLIER = "4721003456"; // tax-id altın VKN'si (kurgu)
const VKN_CUSTOMER = "1234567890".slice(0, 9) + vknCheck("123456789");
const FULL_ID = { ...DEFAULT_COMPANY_LEGAL_IDENTITY, kimlikNo: VKN_SUPPLIER, unvan: "Örnek Dokuma A.Ş.", vergiDairesi: "Uludağ", il: "Bursa", ilce: "Nilüfer" };
const READY = { adapter: "disaAktar", yururlukTarihi: "2026-01-01" };

function vknCheck(nine: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (Number(nine[i]) + 9 - i) % 10;
    sum += t === 9 ? 9 : (t * 2 ** (9 - i)) % 9;
  }
  return String((10 - (sum % 10)) % 10);
}

type Err = { statusCode?: number; message?: string; details?: Record<string, unknown> };
async function errOf(fn: () => Promise<unknown>): Promise<Err | null> {
  try { await fn(); return null; } catch (e) { return e as Err; }
}
const codeOf = (e: Err | null) => String(e?.details?.code ?? "");

let customerId = "";
let userId = "";
const shipmentIds: string[] = [];
const savedSettings = new Map<string, unknown>();

async function setSetting(key: string, value: unknown) {
  await prisma.systemSetting.upsert({ where: { key }, update: { value: value as object }, create: { key, value: value as object } });
}

async function makeShipment(tag: string, status: "DISPATCHED" | "PLANNED" = "DISPATCHED") {
  const s = await prisma.shipment.create({
    data: {
      shipmentNo: `${P}-${tag}`, customerId, status, destination: "DOMESTIC",
      dispatchedAt: status === "DISPATCHED" ? new Date() : null, plateNumber: "16 abc 123", driverName: "Ali Veli",
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

/** TASLAK → (üret) OLUSTURULDU → (işaretle) GONDERILDI → (yanıt) …; `upTo` aşamasında durur. */
async function eIrsaliyeFor(shipmentId: string, upTo: "TASLAK" | "OLUSTURULDU" | "GONDERILDI" | "KABUL" | "REDDEDILDI") {
  const p = await eirs.prepare(shipmentId, { driverNationalId: TCKN }, randomUUID(), userId);
  if (upTo === "TASLAK") return p.kayit;
  const g = await eirs.generate(p.kayit.id, userId);
  if (upTo === "OLUSTURULDU") return g.kayit;
  const s = await eirs.markSent(p.kayit.id, {}, userId);
  if (upTo === "GONDERILDI") return s;
  return eirs.recordResponse(p.kayit.id, { durum: upTo, not: "test" }, userId);
}

type UndoPreview = { canUndo: boolean; blockReason: string | null; eIrsaliye: { documentNo: string | null; status: string; numaraBosaDuser: boolean } | null };
type CancelPreview = { canCancel: boolean; reason: string | null; eIrsaliye: { documentNo: string | null; status: string; numaraBosaDuser: boolean } | null };
const undoPreview = async (id: string) => (await shippingService.getUndoDispatchPreview(id)).data as UndoPreview;
const cancelPreview = async (id: string) => (await shippingService.getCancelPreview(id)).data as CancelPreview;
const recOf = (id: string) => prisma.eIrsaliye.findUniqueOrThrow({ where: { id } });
const lastEvent = async (id: string) =>
  (await prisma.eIrsaliyeEvent.findFirst({ where: { eIrsaliyeId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }))?.type;

type ListRes = { data: Array<{ id: string; eIrsaliyeStatus?: string | null; eIrsaliyeSimulasyon?: boolean }>; summary?: { shipmentCount: number }; nextCursor?: string | null; hasMore?: boolean };
const list = (q: Record<string, string>) =>
  shippingService.listShipments({ query: { customerId, ...q } } as unknown as Request) as unknown as Promise<ListRes>;
const idsOf = (r: ListRes) => r.data.map((x) => x.id).sort();

async function sections0to3() {
  console.log("\n§0 E5 kapıları (sevk tarafı)");
  const Z = await makeShipment("Z");
  await setSetting(SETTING_KEYS.EIRSALIYE_CONFIG, { adapter: "yok", yururlukTarihi: null });
  const e0 = await errOf(() => eirs.prepare(Z, {}, randomUUID(), userId));
  check("§0a yapılandırılmamış → üretim yok, 409 Türkçe", e0?.statusCode === 409 && codeOf(e0) === "EIRSALIYE_NOT_CONFIGURED" && /yapılandırılmamış/.test(e0?.message ?? ""));
  check("§0b kayıt doğmadı", (await prisma.eIrsaliye.count({ where: { sourceId: Z } })) === 0);
  await setSetting(SETTING_KEYS.EIRSALIYE_CONFIG, READY);
  const z = await eIrsaliyeFor(Z, "OLUSTURULDU");
  const e0c = await errOf(() => eirs.generate(z.id, userId));
  check("§0c çift üretim → 409, numara değişmedi", e0c?.statusCode === 409 && (await recOf(z.id)).documentNo === z.documentNo);

  console.log("\n§1 kayıtsız sevkiyat → storno serbest (sıfır fark)");
  const A = await makeShipment("A");
  const pa = await undoPreview(A);
  check("§1a önizleme canUndo, e-İrsaliye satırı yok", pa.canUndo && pa.blockReason === null && pa.eIrsaliye === null);
  await shippingService.undoDispatch(A, "E6 test storno", userId);
  check("§1b storno geçti", (await prisma.shipment.findUniqueOrThrow({ where: { id: A } })).status === "PLANNED");

  console.log("\n§2 OLUSTURULDU → storno serbest, kayıt kalır, yeniden sevkte kaynakDegisti");
  const B = await makeShipment("B");
  const b = await eIrsaliyeFor(B, "OLUSTURULDU");
  const pb = await undoPreview(B);
  check("§2a önizleme canUndo + kaydı listeler", pb.canUndo && pb.eIrsaliye?.documentNo === b.documentNo && pb.eIrsaliye?.numaraBosaDuser === true);
  await shippingService.undoDispatch(B, "E6 test storno", userId);
  const b2 = await recOf(b.id);
  check("§2b kayıt OLUSTURULDU kaldı, numara aynı", b2.status === "OLUSTURULDU" && b2.documentNo === b.documentNo);
  // Yeniden sevk: sevkiyat DISPATCHED + kâğıt irsaliye v2 (freeze yolunun DB izi).
  await prisma.shipment.update({ where: { id: B }, data: { status: "DISPATCHED", dispatchedAt: new Date() } });
  const v1 = await prisma.printedDocument.findFirstOrThrow({ where: { sourceId: B, version: 1 } });
  await prisma.printedDocument.create({ data: { docType: "SHIPMENT_DISPATCH", sourceId: B, version: 2, status: "ACTIVE", documentNo: v1.documentNo, snapshot: v1.snapshot as never } });
  const fb = await eirs.getForShipment(B);
  check("§2c yeniden sevkte kaynakDegisti türetilir", fb.canli?.id === b.id && fb.canli?.kaynakDegisti === true);

  console.log("\n§3 GİB'e gitmiş kayıt → storno 409, önizleme = mutasyon");
  for (const st of ["GONDERILDI", "KABUL", "REDDEDILDI"] as const) {
    const S = await makeShipment(`S${st}`);
    const r = await eIrsaliyeFor(S, st);
    const ps = await undoPreview(S);
    const e = await errOf(() => shippingService.undoDispatch(S, "E6 test storno", userId));
    check(`§3 ${st}: önizleme engelli`, !ps.canUndo && (ps.blockReason ?? "").includes("GİB'e gönderilmiş") && (ps.blockReason ?? "").includes(String(r.documentNo)));
    check(`§3 ${st}: mutasyon 409, AYNI cümle`, e?.statusCode === 409 && e?.message === ps.blockReason, e?.message ?? "");
    check(`§3 ${st}: sevkiyat DISPATCHED kaldı`, (await prisma.shipment.findUniqueOrThrow({ where: { id: S } })).status === "DISPATCHED");
  }
}

async function sections4to5() {
  console.log("\n§4 storno+kapat / PLANNED iptal → kayıt IPTAL + olay");
  const C = await makeShipment("C");
  const c = await eIrsaliyeFor(C, "OLUSTURULDU");
  const pc = await undoPreview(C);
  check("§4a storno önizlemesi kaydı listeler", pc.eIrsaliye?.documentNo === c.documentNo && pc.eIrsaliye?.status === "OLUSTURULDU");
  await shippingService.undoDispatch(C, "E6 test kapat", userId, { releaseSacks: true });
  check("§4b storno+kapat → IPTAL + IPTAL_EDILDI olayı", (await recOf(c.id)).status === "IPTAL" && (await lastEvent(c.id)) === "IPTAL_EDILDI");
  const auditC = await prisma.systemLog.findFirst({ where: { tableName: "E_IRSALIYE", recordId: c.id }, orderBy: { createdAt: "desc" } });
  check("§4c audit izi (IPTAL_EDILDI)", JSON.stringify(auditC?.newData ?? {}).includes("IPTAL_EDILDI"));

  const D = await makeShipment("D");
  const d = await eIrsaliyeFor(D, "TASLAK");
  await shippingService.undoDispatch(D, "E6 test storno", userId);
  const pd = await cancelPreview(D);
  check("§4d iptal önizlemesi taslağı listeler (numara boşluğu yok)", pd.canCancel && pd.eIrsaliye?.status === "TASLAK" && pd.eIrsaliye?.numaraBosaDuser === false);
  await shippingService.cancelShipment(D, userId);
  check("§4e PLANNED iptal → kayıt IPTAL + olay", (await recOf(d.id)).status === "IPTAL" && (await lastEvent(d.id)) === "IPTAL_EDILDI");
  check("§4f sevkiyat CANCELLED", (await prisma.shipment.findUniqueOrThrow({ where: { id: D } })).status === "CANCELLED");

  console.log("\n§5 GONDERILDI iken iptal gövdesi doğrudan → 409 (ikinci sed)");
  const E = await makeShipment("E");
  const e = await eIrsaliyeFor(E, "GONDERILDI");
  await prisma.shipment.update({ where: { id: E }, data: { status: "PLANNED" } }); // kapıyı atlatan durum (yalnız test)
  const pe = await cancelPreview(E);
  check("§5a iptal önizlemesi engelli", !pe.canCancel && (pe.reason ?? "").includes("GİB'e gönderilmiş"));
  const e5 = await errOf(() => shippingService.cancelShipment(E, userId));
  check("§5b iptal → 409 EIRSALIYE_SENT, aynı cümle", e5?.statusCode === 409 && codeOf(e5) === "EIRSALIYE_SENT" && e5?.message === pe.reason);
  const svc = shippingService as unknown as { cancelPlannedShipmentTx: (tx: unknown, id: string, st: string, o: unknown) => Promise<unknown> };
  const e5c = await errOf(() => prisma.$transaction((tx) => svc.cancelPlannedShipmentTx(tx, E, "PLANNED", { userId })));
  check("§5c gövde doğrudan → 409, sevkiyat geri sarıldı", e5c?.statusCode === 409 && (await prisma.shipment.findUniqueOrThrow({ where: { id: E } })).status === "PLANNED");
  check("§5d kayıt GONDERILDI kaldı", (await recOf(e.id)).status === "GONDERILDI");
}

async function sections6to7() {
  console.log("\n§6 liste süzgeci (sunucuda; özet + cursor aynı where)");
  // Önceki bölümlerin sevkiyatları da bu müşteride; beklenen kümeler canlı veriden kurulur.
  const F = await makeShipment("F"); // EKSIK
  const G = await makeShipment("G");
  await eIrsaliyeFor(G, "GONDERILDI");
  await setSetting(SETTING_KEYS.EIRSALIYE_CONFIG, { adapter: "simulasyon", yururlukTarihi: "2026-01-01" });
  const H = await makeShipment("H");
  const h = await eirs.prepare(H, { driverNationalId: TCKN }, randomUUID(), userId);
  await eirs.generate(h.kayit.id, userId);
  await setSetting(SETTING_KEYS.EIRSALIYE_CONFIG, READY);
  const live = await prisma.eIrsaliye.findMany({ where: { sourceId: { in: shipmentIds }, status: { notIn: ["IPTAL", "REDDEDILDI"] } }, select: { sourceId: true, status: true, adapter: true } });
  const ships = await prisma.shipment.findMany({ where: { id: { in: shipmentIds } }, select: { id: true, status: true } });
  const withLive = new Set(live.map((l) => l.sourceId));
  const expEksik = ships.filter((s) => s.status === "DISPATCHED" && !withLive.has(s.id)).map((s) => s.id).sort();
  const expSent = [...new Set((await prisma.eIrsaliye.findMany({ where: { sourceId: { in: shipmentIds }, status: "GONDERILDI" }, select: { sourceId: true } })).map((r) => r.sourceId))].sort();
  const expSim = live.filter((l) => l.adapter === "simulasyon").map((l) => l.sourceId).sort();

  const eksik = await list({ "filter[eIrsaliye]": "EKSIK" });
  check("§6a EKSIK kümesi doğru", JSON.stringify(idsOf(eksik)) === JSON.stringify(expEksik) && idsOf(eksik).includes(F), `${idsOf(eksik).length}/${expEksik.length}`);
  const sent = await list({ "filter[eIrsaliye]": "GONDERILDI" });
  check("§6b GONDERILDI kümesi doğru + satır alanı", JSON.stringify(idsOf(sent)) === JSON.stringify(expSent) && sent.data.every((r) => r.eIrsaliyeStatus === "GONDERILDI") && idsOf(sent).includes(G));
  const sim = await list({ "filter[eIrsaliye]": "SIMULASYON" });
  check("§6c SIMULASYON kümesi doğru + işaret", JSON.stringify(idsOf(sim)) === JSON.stringify(expSim) && sim.data.every((r) => r.eIrsaliyeSimulasyon === true) && idsOf(sim).includes(H));
  const multi = await list({ "filter[eIrsaliye]": "EKSIK,SIMULASYON" });
  check("§6d çoklu seçim VEYA", idsOf(multi).length === expEksik.length + expSim.length);
  const sum = await list({ "filter[eIrsaliye]": "EKSIK", mode: "cursor", limit: "2", withSummary: "true" });
  check("§6e özet şeridi aynı sayı", sum.summary?.shipmentCount === expEksik.length, `${sum.summary?.shipmentCount}`);
  const seen: string[] = [...sum.data.map((r) => r.id)];
  let cur = sum.nextCursor ?? null;
  for (let i = 0; cur && i < 20; i++) {
    const page = await list({ "filter[eIrsaliye]": "EKSIK", mode: "cursor", limit: "2", cursor: cur });
    seen.push(...page.data.map((r) => r.id));
    cur = page.nextCursor ?? null;
  }
  check("§6f cursor sayfalama aynı küme, tekrar yok", JSON.stringify([...seen].sort()) === JSON.stringify(expEksik) && new Set(seen).size === seen.length);
  const bad = await errOf(() => list({ "filter[eIrsaliye]": "UYDURMA" }));
  check("§6g tanınmayan değer 400", bad?.statusCode === 400 && codeOf(bad) === "EIRSALIYE_FILTER_INVALID");
  const plain = await list({});
  check("§6h süzgeçsiz liste satırı e-İrsaliye durumunu taşır", plain.data.find((r) => r.id === G)?.eIrsaliyeStatus === "GONDERILDI" && plain.data.find((r) => r.id === F)?.eIrsaliyeStatus === null);

  console.log("\n§7 YAPILANDIRILMAMIS → süzgeç 400 (fail-closed), süzgeçsiz liste aynı");
  await setSetting(SETTING_KEYS.EIRSALIYE_CONFIG, { adapter: "yok", yururlukTarihi: null });
  const e7 = await errOf(() => list({ "filter[eIrsaliye]": "EKSIK" }));
  check("§7a süzgeç 400 EIRSALIYE_NOT_CONFIGURED", e7?.statusCode === 400 && codeOf(e7) === "EIRSALIYE_NOT_CONFIGURED");
  check("§7b süzgeçsiz liste değişmedi", JSON.stringify(idsOf(await list({}))) === JSON.stringify(idsOf(plain)));
  await setSetting(SETTING_KEYS.EIRSALIYE_CONFIG, READY);
}

async function sections8to9() {
  console.log("\n§8 eşzamanlı storno ↔ gönderildi işareti — kilit serileştirir");
  let both = 0;
  let neither = 0;
  for (let i = 0; i < 4; i++) {
    const S = await makeShipment(`R${i}`);
    const r = await eIrsaliyeFor(S, "OLUSTURULDU");
    const [u, m] = await Promise.allSettled([
      shippingService.undoDispatch(S, "E6 yarış", userId),
      eirs.markSent(r.id, {}, userId),
    ]);
    if (u.status === "fulfilled" && m.status === "fulfilled") both++;
    if (u.status === "rejected" && m.status === "rejected") neither++;
  }
  check("§8a ikisi birden başarılı olmadı", both === 0, `both=${both}`);
  check("§8b her yarışta biri kazandı", neither === 0, `neither=${neither}`);

  console.log("\n§9 kâğıt irsaliye revizyonu: gönderimden sonra KİLİTLİ");
  const K = await makeShipment("K");
  const k = await eIrsaliyeFor(K, "OLUSTURULDU");
  // Fikstür sevkiyatı içeriksiz: builder başka sebeple reddedebilir — ölçülen yalnız kilidin OLMAMASI.
  const e9a = await errOf(() => printedDocumentService.reissue("SHIPMENT_DISPATCH", K, "E6 test revizyon", userId));
  check("§9a gönderilmemiş kayıtta revizyon kilitli DEĞİL", codeOf(e9a) !== "EIRSALIYE_PAPER_LOCKED", e9a ? `başka sebep: ${e9a.message}` : "revize edildi");
  await eirs.markSent(k.id, {}, userId);
  const e9 = await errOf(() => printedDocumentService.reissue("SHIPMENT_DISPATCH", K, "E6 test revizyon", userId));
  check("§9b gönderilmişte revizyon 409 EIRSALIYE_PAPER_LOCKED Türkçe", e9?.statusCode === 409 && codeOf(e9) === "EIRSALIYE_PAPER_LOCKED" && /revize edilemez/.test(e9?.message ?? ""), e9?.message ?? "");
  check("§9c kâğıt belge sürümü değişmedi", (await prisma.printedDocument.count({ where: { sourceId: K, status: "ACTIVE" } })) === 1);
}

async function main() {
  userId = await testActorId();
  for (const k of [SETTING_KEYS.COMPANY_LEGAL_IDENTITY, SETTING_KEYS.EIRSALIYE_CONFIG]) {
    savedSettings.set(k, (await prisma.systemSetting.findUnique({ where: { key: k } }))?.value ?? null);
  }
  customerId = (await prisma.customer.create({
    data: { code: `${P}-C`, name: `${P} MUSTERI`, taxNumber: VKN_CUSTOMER, city: "İstanbul", district: "Kadıköy", address: "Moda Cad. 1", country: "Türkiye" },
    select: { id: true },
  })).id;
  await setSetting(SETTING_KEYS.COMPANY_LEGAL_IDENTITY, FULL_ID);
  await setSetting(SETTING_KEYS.EIRSALIYE_CONFIG, READY);
  await sections0to3();
  await sections4to5();
  await sections6to7();
  await sections8to9();
}

async function temizlik(): Promise<void> {
  const ids = (await prisma.eIrsaliye.findMany({ where: { sourceId: { in: shipmentIds } }, select: { id: true } })).map((r) => r.id);
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
