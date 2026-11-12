// =============================================================================
// GELEN BELGE — belge başına tek kayıt (`gelenBelge.entryMode=PER_DOCUMENT`) + parti no/kurşun metresi PATCH + hatırlama
// =============================================================================
// Tasarım ~/.tekserp/gulkesim/PARTI-METRE-TASARIM-2026-11-02.md §2.3–§2.5, §3 B. HTTP + gerçek DB. Sınanan:
//   §1 varsayılan (PER_LINE): detay satır problems + totalsCheck kip anahtarı yokken ve PER_LINE yazılıyken bayt-aynı; perDocument yok
//   §2 başlık PATCH: ourBatchNo (+anahtar / anahtarsız → MANUAL), anahtar tek başına 400, MANUAL anahtarı 400, kursunMeters → MANUAL +
//      review false, kursunMetersReviewed (metre yokken 400), null temizler; audit yükünde yeni alanlar
//   §3 PER_DOCUMENT: kurşun metresi boş → 409 KURSUN_METERS_REQUIRED + sıfır top; review açık + BLOCK → 409 KURSUN_METERS_REVIEW_PENDING;
//      WARN → 200 + uyarı; ürünsüz/inceleme bekleyen satır kapı DEĞİL
//   §4 21 satırlı belge → 1 top, currentQty = kurşun metresi, 21 satır INFO, 1 özet satırı (son no + 1, ARABA, sabit kimlik);
//      başlık APPROVED; detayda INFO satırının problems'i boş ve toplam kıyası özet satırını saymaz; INFO satır PATCH 409
//   §5 yarıda kalan onay: özet satırı ENTERING + top doğmuş + bayat APPROVING → ikinci onay replayed, yine 1 top
//   §6 PARTIAL: özet satırı FAILED → yeniden onay yalnız onu işler → APPROVED; karışık kip → 409 DELIVERY_NOTE_ENTRY_MODE_MIXED
//   §7 hatırlama: DOCUMENT kipinde onay şablona batchNoKey yazar (+audit); MANUAL hatırlanmaz; SERIES'te yazılmaz;
//      PATCH /sablonlar batchNoKey yazar/temizler, geçersiz anahtar 400
// =============================================================================
import type { AddressInfo } from "net";
import type { Server } from "http";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { InventoryService } from "../src/services/inventory.service";
import { lineRollToken, summaryLineId } from "../src/services/gelen-belge-onay.service";
import { ensureSenderTemplate } from "../src/services/gelen-belge-sablon.service";
import { lineProblems } from "../src/services/gelen-belge-kontrol.service";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testSablonlariniKaydet } from "./lib/gelen-belge-test-sablonlar";

// Gönderen şablonları pakette yok (2026-11-09): bekçi onları süreç içi dosya şablonu olarak kaydeder.
testSablonlariniKaydet();

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exitCode = 1;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `GBT${Date.now().toString(36).toUpperCase()}`;
const made = { customers: [] as string[], notes: [] as string[], items: [] as string[] };
const TEMPLATE_CODE = "cikis-ceki-listesi";

type Line = { id: string; lineNo: number; lineKind: string; status: string; rollId: string | null; problems: string[]; meters: string };
type Note = { id: string; status: string; ourBatchNo: string | null; ourBatchNoKey: string | null; kursunMeters: string | null; kursunMetersSource: string | null; kursunMetersReview: boolean; lines: Line[]; totalsCheck: unknown; perDocument?: { code: string | null }; kursunMeterCandidates?: { lineSum: string | null } };
type Resp = { status: number; code?: string; warnings?: string[]; data?: Record<string, unknown> };

async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function main(): Promise<void> {
  console.log("=== Gelen belge belge başına tek kayıt bekçisi ===\n");
  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const tplPrior = await prisma.senderTemplate.findUnique({ where: { code: TEMPLATE_CODE }, select: { id: true, batchNoKey: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.EMANET_ENABLED }, create: { key: SETTING_KEYS.EMANET_ENABLED, value: true }, update: { value: true } });
    await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.GELEN_BELGE_ENABLED }, create: { key: SETTING_KEYS.GELEN_BELGE_ENABLED, value: true }, update: { value: true } });
    for (const k of [SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER]) await setSetting(k, null);
    const r0 = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: admin.password, clientType: "electron" }) });
    const tk = ((await r0.json()) as { data?: { token?: string } }).data?.token ?? "";
    check("admin login", tk.length > 0);
    const call = async (method: string, path: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; warnings?: string[]; details?: { code?: string } };
      return { status: r.status, code: j.details?.code, data: j.data, warnings: j.warnings };
    };
    const owner = (await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} sahip` }, select: { id: true } })).id;
    made.customers.push(owner);
    const fabric = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} Müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
    made.items.push(fabric);
    const tpl = (await ensureSenderTemplate(TEMPLATE_CODE, admin.id, "PANEL"))!;
    await prisma.senderTemplate.update({ where: { id: tpl.id }, data: { batchNoKey: null } });

    const L = (n: number, extra: Record<string, unknown> = {}) => ({ senderRollNo: `${TAG}-R${n}`, meters: 200 + n, itemText: "Kumaş", ...extra });
    const mkNote = async (lines: unknown[], header: Record<string, unknown> = {}) => {
      const r = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", ownerCustomerId: owner, senderText: "GÜLEÇSOY", lines, ...header });
      const id = (r.data as { id?: string })?.id ?? "";
      if (id) made.notes.push(id);
      return id;
    };
    const detail = async (id: string) => (await call("GET", `/api/gelen-belge/irsaliyeler/${id}`)).data as unknown as Note;
    const patch = (id: string, body: Record<string, unknown>) => call("PATCH", `/api/gelen-belge/irsaliyeler/${id}`, body);
    const onay = (id: string, body: Record<string, unknown> = {}) => call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, body);
    const rollsOf = async (id: string) => (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: id, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);

    // §1 PER_LINE bayt-aynı
    console.log("§1 varsayılan kip");
    const n1 = await mkNote([L(1, { itemId: null }), L(2, { needsReview: true })], { totalsDeclared: { blocks: [{ blockNo: 1, m: "999" }] } });
    const d1a = await detail(n1);
    await setSetting(SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, "PER_LINE");
    const d1b = await detail(n1);
    check("§1 PER_LINE: satır problems + totalsCheck kayıtsız ayarla bayt-aynı", JSON.stringify(d1a.lines.map((l) => l.problems)) === JSON.stringify(d1b.lines.map((l) => l.problems)) && JSON.stringify(d1a.totalsCheck) === JSON.stringify(d1b.totalsCheck));
    check("§1 PER_LINE'da perDocument anahtarı YOK", !("perDocument" in d1a) && !("perDocument" in d1b));
    check("§1 PER_LINE satır kapıları bugünkü gibi (ITEM_UNRESOLVED + NEEDS_REVIEW)", d1a.lines[0]!.problems.includes("ITEM_UNRESOLVED") && d1a.lines[1]!.problems.includes("NEEDS_REVIEW"));

    // §2 başlık PATCH
    console.log("§2 başlık PATCH");
    const p2a = await patch(n1, { ourBatchNo: "ISM1439770", ourBatchNoKey: "isEmriNo" });
    const d2a = p2a.data as unknown as Note;
    check("§2a parti no + aday anahtarı yazılır", p2a.status === 200 && d2a.ourBatchNo === "ISM1439770" && d2a.ourBatchNoKey === "isEmriNo", `${p2a.status} ${p2a.code ?? ""}`);
    const p2b = await patch(n1, { ourBatchNo: "  elle 7  " });
    check("§2b anahtarsız parti no → MANUAL (trim)", (p2b.data as unknown as Note)?.ourBatchNoKey === "MANUAL" && (p2b.data as unknown as Note)?.ourBatchNo === "elle 7");
    check("§2c anahtar tek başına → 400 DELIVERY_NOTE_BATCH_NO_KEY_WITHOUT_VALUE", (await patch(n1, { ourBatchNoKey: "isEmriNo" })).code === "DELIVERY_NOTE_BATCH_NO_KEY_WITHOUT_VALUE");
    check("§2d MANUAL anahtarı istemciden → 400", (await patch(n1, { ourBatchNo: "X", ourBatchNoKey: "MANUAL" })).status === 400);
    check("§2e kurşun metresi yokken onay işareti → 400 KURSUN_METERS_REQUIRED", (await patch(n1, { kursunMetersReviewed: true })).code === "KURSUN_METERS_REQUIRED");
    check("§2f kurşun metresi 0 → 400", (await patch(n1, { kursunMeters: 0 })).status === 400);
    await prisma.customerDeliveryNote.update({ where: { id: n1 }, data: { kursunMeters: 241, kursunMetersSource: "OUTPUT", kursunMetersReview: true } });
    const p2g = await patch(n1, { kursunMetersReviewed: true });
    const d2g = p2g.data as unknown as Note;
    check("§2g onay işareti → MANUAL + review false, metre aynen", p2g.status === 200 && d2g.kursunMetersSource === "MANUAL" && d2g.kursunMetersReview === false && Number(d2g.kursunMeters) === 241, `${p2g.status} ${JSON.stringify([d2g?.kursunMetersSource, d2g?.kursunMetersReview, d2g?.kursunMeters])}`);
    await prisma.customerDeliveryNote.update({ where: { id: n1 }, data: { kursunMetersSource: "LINE_SUM", kursunMetersReview: true } });
    const d2h = (await patch(n1, { kursunMeters: 238.5 })).data as unknown as Note;
    check("§2h metre düzeltme → MANUAL + review false", Number(d2h.kursunMeters) === 238.5 && d2h.kursunMetersSource === "MANUAL" && d2h.kursunMetersReview === false);
    const d2i = (await patch(n1, { kursunMeters: null, ourBatchNo: null })).data as unknown as Note;
    check("§2i null temizler (metre + kaynak + parti no + anahtar)", d2i.kursunMeters === null && d2i.kursunMetersSource === null && d2i.ourBatchNo === null && d2i.ourBatchNoKey === null);
    const aud = await prisma.systemLog.findFirst({ where: { tableName: "CUSTOMER_DELIVERY_NOTE", recordId: n1, action: "UPDATE", newData: { path: ["kursunMetersSource"], equals: "MANUAL" } }, select: { id: true } });
    check("§2j audit yükünde kurşun metresi kaynağı", !!aud);

    // §3 PER_DOCUMENT kapıları
    console.log("§3 PER_DOCUMENT kapıları");
    await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
    await setSetting(SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, "PER_DOCUMENT");
    const n3 = await mkNote([L(1, { itemId: null }), L(2, { needsReview: true })]);
    const d3 = await detail(n3);
    check("§3a detayda perDocument kapısı KURSUN_METERS_REQUIRED", d3.perDocument?.code === "KURSUN_METERS_REQUIRED", JSON.stringify(d3.perDocument));
    const a3 = await onay(n3);
    check("§3a kurşun metresi boş → 409 KURSUN_METERS_REQUIRED, sıfır top", a3.status === 409 && a3.code === "KURSUN_METERS_REQUIRED" && (await rollsOf(n3)).length === 0, `${a3.status} ${a3.code}`);
    await prisma.customerDeliveryNote.update({ where: { id: n3 }, data: { kursunMeters: 1775, kursunMetersSource: "OUTPUT", kursunMetersReview: true } });
    await setSetting(SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, "BLOCK");
    check("§3b detay kapısı review BLOCK'ta KURSUN_METERS_REVIEW_PENDING", (await detail(n3)).perDocument?.code === "KURSUN_METERS_REVIEW_PENDING");
    const a3b = await onay(n3);
    check("§3b review açık + BLOCK → 409 KURSUN_METERS_REVIEW_PENDING, sıfır top", a3b.status === 409 && a3b.code === "KURSUN_METERS_REVIEW_PENDING" && (await rollsOf(n3)).length === 0, `${a3b.status} ${a3b.code}`);
    await patch(n3, { kursunMetersReviewed: true });
    const a3c = await onay(n3);
    check("⭐ §3c operatör onaylayınca geçer; ürünsüz/incelenmemiş satır kapı DEĞİL → 1 top", a3c.status === 200 && (await rollsOf(n3)).length === 1, `${a3c.status} ${a3c.code ?? ""}`);
    const n3d = await mkNote([L(3)]);
    await prisma.customerDeliveryNote.update({ where: { id: n3d }, data: { kursunMeters: 50, kursunMetersSource: "OUTPUT", kursunMetersReview: true } });
    await setSetting(SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, "WARN");
    const a3d = await onay(n3d);
    check("§3d WARN → 200 + kurşun metresi uyarısı", a3d.status === 200 && (a3d.warnings ?? []).some((w) => w.includes("Kurşun metresi")), `${a3d.status} ${JSON.stringify(a3d.warnings)}`);

    // §4 21 satır → 1 top
    console.log("§4 21 satırlı belge");
    const n4 = await mkNote(Array.from({ length: 21 }, (_, i) => L(i + 1, i === 0 ? { needsReview: true } : {})), { totalsDeclared: { blocks: [{ blockNo: 1, count: 21, m: "4521" }] } });
    await prisma.customerDeliveryNote.update({ where: { id: n4 }, data: { kursunMeters: 4521, kursunMetersSource: "OUTPUT" } });
    const a4 = await onay(n4);
    check("§4 onay 200 (toplam farkı kaynak OUTPUT'ta uyarı, kapı değil)", a4.status === 200 && (a4.warnings ?? []).some((w) => w.startsWith("Toplam farkı")), `${a4.status} ${a4.code ?? ""}`);
    const r4 = await rollsOf(n4);
    const roll4 = r4[0] ? await prisma.roll.findUnique({ where: { id: r4[0] }, select: { currentQty: true, itemId: true, ownerCustomerId: true } }) : null;
    check("⭐ §4 TEK top, currentQty = kurşun metresi, varsayılan ürün, sahipli", r4.length === 1 && Number(roll4?.currentQty) === 4521 && roll4?.itemId === fabric && roll4?.ownerCustomerId === owner, `${r4.length} ${String(roll4?.currentQty)}`);
    const l4 = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: n4 }, select: { id: true, lineNo: true, lineKind: true, status: true, rollId: true } });
    const sum4 = l4.find((l) => l.id === summaryLineId(n4));
    check("§4 21 satır INFO + topsuz", l4.filter((l) => l.status === "INFO" && !l.rollId).length === 21);
    check("§4 özet satırı: sabit kimlik, son satırdan sonra (no 22), ARABA, ENTERED", sum4?.lineNo === 22 && sum4.lineKind === "ARABA" && sum4.status === "ENTERED" && sum4.rollId === r4[0]);
    const d4 = await detail(n4);
    const tc4 = d4.totalsCheck as { blocks: Array<{ lines: { count: number; m: number } }> };
    check("§4 başlık APPROVED; INFO satırı problems boş; toplam kıyası özet satırını saymaz (21 satır)", d4.status === "APPROVED" && d4.lines.filter((l) => l.status === "INFO").every((l) => l.problems.length === 0) && tc4.blocks[0]?.lines.count === 21, `${d4.status} ${tc4.blocks[0]?.lines.count}`);
    const m4 = d4.kursunMeterCandidates;
    const lineSum4 = l4.length === 22 ? (await prisma.customerDeliveryNoteLine.aggregate({ where: { noteId: n4, status: "INFO" }, _sum: { meters: true } }))._sum.meters : null;
    check("§4 onaydan sonra satır toplamı = INFO belge satırları (özet satırı sayılmaz)", m4?.lineSum !== undefined && lineSum4 !== null && Number(m4.lineSum) === Number(lineSum4) && Number(m4.lineSum) !== 4521, `${m4?.lineSum} ↔ ${String(lineSum4)}`);
    check("§4 saf: INFO satırı canlı değil (ürünsüz + incelenmemiş olsa da sorunsuz)", lineProblems({ status: "INFO", itemId: null, needsReview: true }).length === 0);
    const info4 = l4.find((l) => l.status === "INFO")!;
    check("§4 INFO satır PATCH → 409 DELIVERY_NOTE_LINE_INFO", (await call("PATCH", `/api/gelen-belge/irsaliyeler/${n4}/satirlar/${info4.id}`, { meters: 5 })).code === "DELIVERY_NOTE_LINE_INFO");
    check("§4 onaylıyı yeniden onay → 409 DELIVERY_NOTE_NO_OPEN_LINES, top 1", (await onay(n4)).code === "DELIVERY_NOTE_NO_OPEN_LINES" && (await rollsOf(n4)).length === 1);

    // §5 yarıda kalan onay
    console.log("§5 yarıda kalan onay");
    const n5 = await mkNote([L(1), L(2)]);
    await prisma.customerDeliveryNote.update({ where: { id: n5 }, data: { kursunMeters: 300, kursunMetersSource: "OUTPUT" } });
    const sid5 = summaryLineId(n5);
    await prisma.customerDeliveryNoteLine.create({ data: { id: sid5, noteId: n5, lineNo: 3, lineKind: "ARABA", meters: 300, status: "ENTERING" } });
    await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: n5, lineNo: { lt: 3 } }, data: { status: "INFO" } });
    const pre5 = await new InventoryService().createInitialEntry({ itemId: fabric, colorId: null, initialQty: 300, clientToken: lineRollToken(sid5) }, admin.id, null, false, { forcedEntrySource: "SEMI_FINISHED", forcedStatus: "STOCK", ownerCustomerId: owner, entryReasonCode: "GELEN_BELGE", entryReason: "yarıda", skipKk1WeightPolicy: true });
    const preId5 = (pre5.data as { id: string }).id;
    await prisma.customerDeliveryNote.update({ where: { id: n5 }, data: { status: "APPROVING", updatedAt: new Date(Date.now() - 11 * 60 * 1000) } });
    const a5 = await onay(n5);
    const s5 = (a5.data as { summary?: { replayed: number } })?.summary;
    check("⭐ §5 ikinci onay replayed 1, yine TEK top (token + sabit özet kimliği)", a5.status === 200 && s5?.replayed === 1 && (await rollsOf(n5)).length === 1 && (await rollsOf(n5))[0] === preId5, `${a5.status} ${a5.code ?? ""} ${JSON.stringify(s5)}`);

    // §6 PARTIAL + karışık kip
    console.log("§6 PARTIAL + karışık kip");
    const n6 = await mkNote([L(1), L(2)]);
    await prisma.customerDeliveryNote.update({ where: { id: n6 }, data: { kursunMeters: 120, kursunMetersSource: "OUTPUT" } });
    // Düşmüş özet satırı kurgusu (giriş motorunun düşme yolu satır kipinde test_gelen_belge_onay §7'de): özet FAILED, belge satırları INFO, PARTIAL.
    await prisma.customerDeliveryNoteLine.create({ data: { id: summaryLineId(n6), noteId: n6, lineNo: 3, lineKind: "ARABA", meters: 120, status: "FAILED", failReason: "kurgu" } });
    await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: n6, lineNo: { lt: 3 } }, data: { status: "INFO" } });
    await prisma.customerDeliveryNote.update({ where: { id: n6 }, data: { status: "PARTIAL" } });
    const d6 = await detail(n6);
    check("§6a PARTIAL detayında yalnız özet satırı FAILED sorunlu, INFO satırları sorunsuz", d6.lines.filter((l) => l.problems.length > 0).map((l) => l.id).join() === summaryLineId(n6));
    const a6b = await onay(n6);
    check("§6b yeniden onay yalnız özet satırını işler → APPROVED, 1 top", a6b.status === 200 && (await rollsOf(n6)).length === 1 && (await prisma.customerDeliveryNote.findUnique({ where: { id: n6 }, select: { status: true } }))?.status === "APPROVED", `${a6b.status} ${a6b.code ?? ""}`);
    await setSetting(SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, "PER_LINE");
    const n6c = await mkNote([L(1), L(2, { itemId: null, itemText: null })]);
    await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, null);
    await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: n6c, lineNo: 1 }, data: { itemId: fabric } });
    await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: n6c, lineNo: 2 }, data: { status: "FAILED" } });
    // Satır kipinde yarıda kalmış belge kurgusu: satır 1'in topu doğmuş (ENTERED), satır 2 FAILED, başlık PARTIAL.
    const pre6 = await new InventoryService().createInitialEntry({ itemId: fabric, colorId: null, initialQty: 201 }, admin.id, null, false, { forcedEntrySource: "SEMI_FINISHED", forcedStatus: "STOCK", ownerCustomerId: owner, entryReasonCode: "GELEN_BELGE", entryReason: "karışık", skipKk1WeightPolicy: true });
    await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: n6c, lineNo: 1 }, data: { status: "ENTERED", rollId: (pre6.data as { id: string }).id } });
    await prisma.customerDeliveryNote.update({ where: { id: n6c }, data: { status: "PARTIAL", kursunMeters: 400, kursunMetersSource: "OUTPUT" } });
    await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
    await setSetting(SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, "PER_DOCUMENT");
    const a6c = await onay(n6c);
    check("§6c satır kipinde top doğmuş belge → 409 DELIVERY_NOTE_ENTRY_MODE_MIXED, ek top yok", a6c.status === 409 && a6c.code === "DELIVERY_NOTE_ENTRY_MODE_MIXED" && (await rollsOf(n6c)).length === 1, `${a6c.status} ${a6c.code}`);

    // §7 hatırlama
    console.log("§7 parti no hatırlama");
    const tplBatch = async () => (await prisma.senderTemplate.findUnique({ where: { id: tpl.id }, select: { batchNoKey: true } }))?.batchNoKey ?? null;
    const n7 = await mkNote([L(1)]);
    await prisma.customerDeliveryNote.update({ where: { id: n7 }, data: { templateId: tpl.id, kursunMeters: 90, kursunMetersSource: "OUTPUT" } });
    await patch(n7, { ourBatchNo: "ISM1", ourBatchNoKey: "musteriPartiNo" });
    check("§7a SERIES kipinde onay şablona YAZMAZ", (await onay(n7)).status === 200 && (await tplBatch()) === null);
    await setSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, "DOCUMENT");
    const n7b = await mkNote([L(2)]);
    await prisma.customerDeliveryNote.update({ where: { id: n7b }, data: { templateId: tpl.id, kursunMeters: 90, kursunMetersSource: "OUTPUT" } });
    await patch(n7b, { ourBatchNo: "ISM2", ourBatchNoKey: "isEmriNo" });
    check("⭐ §7b DOCUMENT kipinde onay şablona batchNoKey yazar (onayda öğrenilir)", (await tplBatch()) === null && (await onay(n7b)).status === 200 && (await tplBatch()) === "isEmriNo");
    check("§7b hatırlama audit'li (source APPROVAL)", (await prisma.systemLog.count({ where: { tableName: "SENDER_TEMPLATE", recordId: tpl.id, newData: { path: ["source"], equals: "APPROVAL" } } })) >= 1);
    const n7c = await mkNote([L(3)]);
    await prisma.customerDeliveryNote.update({ where: { id: n7c }, data: { templateId: tpl.id, kursunMeters: 90, kursunMetersSource: "OUTPUT" } });
    await patch(n7c, { ourBatchNo: "elle" });
    check("§7c MANUAL parti no hatırlanmaz (şablon anahtarı korunur)", (await onay(n7c)).status === 200 && (await tplBatch()) === "isEmriNo");
    const t7 = await call("PATCH", `/api/gelen-belge/sablonlar/${TEMPLATE_CODE}`, { batchNoKey: "musteriPartiNo" });
    check("§7d PATCH /sablonlar batchNoKey yazar + görünümde döner", t7.status === 200 && (t7.data as { batchNoKey?: string })?.batchNoKey === "musteriPartiNo" && (await tplBatch()) === "musteriPartiNo", `${t7.status} ${t7.code ?? ""}`);
    check("§7e PATCH /sablonlar batchNoKey null temizler", (await call("PATCH", `/api/gelen-belge/sablonlar/${TEMPLATE_CODE}`, { batchNoKey: null })).status === 200 && (await tplBatch()) === null);
    check("§7f geçersiz anahtar (boşluk / MANUAL) → 400", (await call("PATCH", `/api/gelen-belge/sablonlar/${TEMPLATE_CODE}`, { batchNoKey: "is emri" })).status === 400 && (await call("PATCH", `/api/gelen-belge/sablonlar/${TEMPLATE_CODE}`, { batchNoKey: "MANUAL" })).status === 400);
  } finally {
    stopNotificationJobs();
    await new Promise<void>((r) => server.close(() => r()));
    for (const k of keys) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    if (tplPrior) await prisma.senderTemplate.updateMany({ where: { id: tplPrior.id }, data: { batchNoKey: tplPrior.batchNoKey } });
    else await prisma.senderTemplate.deleteMany({ where: { code: TEMPLATE_CODE } }).catch(() => undefined);
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

async function cleanup(): Promise<void> {
  const rollIds = (await prisma.roll.findMany({ where: { ownerCustomerId: { in: made.customers } }, select: { id: true } })).map((r) => r.id);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers] } } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } });
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...made.notes, ...rollIds] } } });
}

if (!engel) void main();
