// =============================================================================
// GELEN BELGE — D4 onay → giriş motoru bekçisi (HTTP, gerçek DB)
// =============================================================================
// Karar belgesi TASARIM-KARARI-2026-10-28 §3 adım 6 + §6 D4 satırı. Sınanan:
//   §1 16 satırlı DRAFT onay → 16 Roll (STOCK · SEMI_FINISHED · ownerCustomerId dolu · entryReasonCode GELEN_BELGE)
//      + 16 WarehouseMovement ENTRY; başlık APPROVED; satırlar ENTERED + rollId; renkli satır da STOCK (forcedStatus)
//   §2 iki ayrı 200 m satır → iki top (duplicateGuard GEÇİLMEZ — `kk1.duplicateGuardEnabled` AÇIKKEN bile)
//   §3 replay: satır token'ı (uuidv5) ile ikinci giriş idempotent → ikinci top YOK; onaylıyı yeniden onay → 409 NO_OPEN_LINES
//   §4 eşzamanlı iki onay → biri 200, biri 409 DELIVERY_NOTE_NOT_APPROVABLE; top sayısı = satır sayısı
//   §5 emanet kapalı → 403 MODULE_DISABLED ve SIFIR top; taslak DRAFT kalır
//   §6 toplam uyuşmazlığı → 409 TOTAL_MISMATCH; varianceReason ile ikinci deneme 200 + gerekçe başlıkta; saf `totalMismatches`
//   §7 bir satır bilinçli bozuk (iplik kalemi) → o satır FAILED + Türkçe sebep, başlık PARTIAL; düzeltip yeniden onay YALNIZ onu işler → APPROVED
//   §8 sayfa kapısı: pageCount 2, yalnız sayfa 1 taranmış → 409 DELIVERY_NOTE_PAGES_MISSING
//   §9 ürünü çözülmemiş satır → 400 DELIVERY_NOTE_LINE_UNRESOLVED, sıfır top
//   §10 alias öğrenme: ITEM/COLOR/SENDER sözlüğe; ikinci onayda hitCount artar
//   §11 audit: satır/başlık audit yükünde ocrRaw/sourceRects/content yok
// Emsal: scripts/test_gelen_belge_taslak.ts (app.listen(0) + ensureTestAdmin + ayar()).
// =============================================================================
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { InventoryService } from "../src/services/inventory.service";
import { lineRollToken, totalMismatches } from "../src/services/gelen-belge-onay.service";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

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

const TAG = `GBO${Date.now().toString(36).toUpperCase()}`;
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], colors: [] as string[], scans: [] as string[] };

type Line = { id: string; lineNo: number; status: string; rollId: string | null; failReason: string | null };
type NoteData = { id: string; noteNo: string; status: string; varianceReason: string | null; lines: Line[] };
type Resp = { status: number; code?: string; details?: Record<string, unknown>; data?: Record<string, unknown> & { note?: NoteData; summary?: { entered: number; failed: number; replayed: number; rollIds: string[] }; lines?: Line[] } };

async function ayar(key: string, v: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}
async function mkCustomer(suffix: string): Promise<string> {
  const c = await prisma.customer.create({ data: { code: `${TAG}-${suffix}`, name: `${TAG} cari ${suffix}` }, select: { id: true } });
  made.customers.push(c.id);
  return c.id;
}
const rollsOf = (noteId: string) => prisma.customerDeliveryNoteLine.findMany({ where: { noteId, rollId: { not: null } }, select: { rollId: true } }).then((r) => r.map((x) => x.rollId!));

async function main(): Promise<void> {
  console.log("=== Gelen belge D4 onay bekçisi ===\n");
  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.KK1_DUPLICATE_GUARD_ENABLED];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await ayar(SETTING_KEYS.EMANET_ENABLED, true);
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
    await ayar(SETTING_KEYS.KK1_DUPLICATE_GUARD_ENABLED, true);
    const login = async (username: string, password: string) => {
      const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
      return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
    };
    const call = async (method: string, path: string, token: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } & Record<string, unknown> };
      return { status: r.status, code: j.details?.code, details: j.details, data: j.data };
    };
    const tk = await login(admin.username, admin.password);
    check("admin login", tk.length > 0);
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
    const writer = await mk("W", ["gelen-belge:read", "gelen-belge:write"]);
    const owner = await mkCustomer("OWN");
    const sender = await mkCustomer("SND");
    const fabric = await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} pamuklu`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
    made.items.push(fabric.id, yarn.id);
    const color = await prisma.color.create({ data: { code: `${TAG}-K`, name: `${TAG} EKRU` }, select: { id: true } });
    made.colors.push(color.id);

    const L = (n: number, extra: Record<string, unknown> = {}) => ({ senderRollNo: `${TAG}-R${n}`, meters: 100 + n, weightKg: 20 + n, itemText: "Pamuklu 30/1", itemId: fabric.id, ...extra });
    const mkNote = async (lines: unknown[], header: Record<string, unknown> = {}) => {
      const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", ownerCustomerId: owner, senderCustomerId: sender, senderText: "GÜLEÇSOY TEKSTİL", lines, ...header });
      const id = (r.data as { id?: string })?.id ?? "";
      if (id) made.notes.push(id);
      return { id, r };
    };
    const onay = (id: string, body: Record<string, unknown> = {}, token = tk) => call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, token, body);

    // §1 + §2 — 16 satır (5 ve 6 ikisi de 200 m; 3 renkli)
    console.log("§1 16 satırlı onay");
    const lines16 = Array.from({ length: 16 }, (_, i) => L(i + 1, i === 4 || i === 5 ? { meters: 200, weightKg: 40 } : i === 2 ? { colorText: "Ekru", colorId: color.id } : {}));
    const n1 = await mkNote(lines16, { declaredTopCount: 16 });
    check("16 satırlı taslak açıldı", n1.r.status === 201, `${n1.r.status} ${n1.r.code ?? ""}`);
    check("yazma izniyle onay → 403", (await onay(n1.id, {}, writer)).status === 403);
    const a1 = await onay(n1.id);
    check("onay 200", a1.status === 200, `${a1.status} ${a1.code ?? ""} ${JSON.stringify(a1.details ?? {}).slice(0, 200)}`);
    check("summary.entered 16 / failed 0", a1.data?.summary?.entered === 16 && a1.data?.summary?.failed === 0, JSON.stringify(a1.data?.summary));
    check("başlık APPROVED", a1.data?.note?.status === "APPROVED", a1.data?.note?.status);
    const rl1 = await rollsOf(n1.id);
    const rolls1 = await prisma.roll.findMany({ where: { id: { in: rl1 } }, select: { id: true, status: true, entrySource: true, ownerCustomerId: true, entryReasonCode: true, colorId: true, initialQty: true, clientToken: true } });
    check("16 Roll doğdu", rolls1.length === 16, String(rolls1.length));
    check("hepsi STOCK · SEMI_FINISHED · sahipli · GELEN_BELGE", rolls1.every((r) => r.status === "STOCK" && r.entrySource === "SEMI_FINISHED" && r.ownerCustomerId === owner && r.entryReasonCode === "GELEN_BELGE"), JSON.stringify(rolls1.map((r) => [r.status, r.entrySource, r.entryReasonCode]).slice(0, 3)));
    const colored = rolls1.find((r) => r.colorId === color.id);
    check("⭐ renkli satırın topu da STOCK (forcedStatus; sezgi WAREHOUSE'a düşürürdü)", colored?.status === "STOCK", colored?.status ?? "renkli top yok");
    const entries = await prisma.warehouseMovement.count({ where: { rollId: { in: rl1 }, eventType: "ENTRY" } });
    check("16 giriş defter satırı (WarehouseMovement ENTRY)", entries === 16, String(entries));
    const ls1 = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: n1.id }, select: { id: true, status: true, rollId: true, meters: true } }));
    check("satırlar ENTERED + rollId", ls1.every((l) => l.status === "ENTERED" && l.rollId), "");
    check("satır token'ı = uuidv5(lineId)", ls1.every((l) => rolls1.find((r) => r.id === l.rollId)?.clientToken === lineRollToken(l.id)));
    const twoHundred = ls1.filter((l) => Number(l.meters) === 200);
    check("§2 iki ayrı 200 m satır → iki ayrı top (duplicateGuard AÇIKKEN bile düşürmedi)", twoHundred.length === 2 && twoHundred[0]!.rollId !== twoHundred[1]!.rollId && twoHundred.every((l) => l.rollId));

    // §3 replay
    console.log("§3 replay");
    const inv = new InventoryService();
    const l0 = ls1[0]!;
    const rep = await inv.createInitialEntry({ itemId: fabric.id, colorId: null, initialQty: Number(l0.meters), clientToken: lineRollToken(l0.id) }, admin.id, null, false, { forcedEntrySource: "SEMI_FINISHED", forcedStatus: "STOCK", ownerCustomerId: owner, skipKk1WeightPolicy: true });
    check("aynı satır token'ı ile giriş → idempotent, aynı top", rep.idempotent === true && (rep.data as { id: string }).id === l0.rollId);
    check("ikinci top YOK", (await prisma.roll.count({ where: { ownerCustomerId: owner } })) === 16);
    const again = await onay(n1.id);
    // Ön kontrol claim'den önce koşar: tüm satırları girilmiş belge "açık satır yok" ile 409 (claim'e hiç gelmez).
    check("onaylı belgeyi yeniden onay → 409 DELIVERY_NOTE_NO_OPEN_LINES", again.status === 409 && again.code === "DELIVERY_NOTE_NO_OPEN_LINES", `${again.status} ${again.code}`);

    // §4 eşzamanlı iki onay
    console.log("§4 eşzamanlı onay");
    const n4 = await mkNote(Array.from({ length: 8 }, (_, i) => L(20 + i)));
    const [c1, c2] = await Promise.all([onay(n4.id), onay(n4.id)]);
    const codes = [c1, c2].map((r) => `${r.status}${r.code ? ":" + r.code : ""}`).sort();
    check("biri 200, biri 409 DELIVERY_NOTE_NOT_APPROVABLE", codes[0] === "200" && codes[1] === "409:DELIVERY_NOTE_NOT_APPROVABLE", codes.join(" | "));
    check("top sayısı = 8 (ikilenmedi)", (await rollsOf(n4.id)).length === 8 && (await prisma.roll.count({ where: { ownerCustomerId: owner } })) === 24);

    // §5 emanet kapalı
    console.log("§5 emanet kapalı");
    const n5 = await mkNote([L(30), L(31)]);
    await ayar(SETTING_KEYS.EMANET_ENABLED, false);
    const e5 = await onay(n5.id);
    await ayar(SETTING_KEYS.EMANET_ENABLED, true);
    check("emanet kapalı → 403 MODULE_DISABLED", e5.status === 403 && e5.code === "MODULE_DISABLED", `${e5.status} ${e5.code}`);
    const s5 = await prisma.customerDeliveryNote.findUnique({ where: { id: n5.id }, select: { status: true } });
    check("SIFIR top, taslak DRAFT kaldı", (await rollsOf(n5.id)).length === 0 && s5?.status === "DRAFT", s5?.status);

    // §6 toplam uyuşmazlığı
    console.log("§6 toplam kapısı");
    const n6 = await mkNote([L(40), L(41), L(42)], { declaredTopCount: 5, totalsDeclared: { blocks: [{ blockNo: 1, count: 3, m: 500 }] } });
    const t6 = await onay(n6.id);
    check("Σ satır ≠ beyan → 409 TOTAL_MISMATCH", t6.status === 409 && t6.code === "TOTAL_MISMATCH" && Array.isArray(t6.details?.mismatches), `${t6.status} ${t6.code}`);
    check("sıfır top", (await rollsOf(n6.id)).length === 0);
    const t6b = await onay(n6.id, { varianceReason: "Belgede 5 yazıyor, 3 top geldi (eksik teslim)" });
    check("varianceReason ile ikinci deneme 200 + gerekçe başlıkta", t6b.status === 200 && t6b.data?.note?.varianceReason?.includes("eksik teslim") === true, `${t6b.status} ${t6b.code ?? ""}`);
    const pure = totalMismatches({ declaredTopCount: 2, totalsDeclared: { blocks: [{ blockNo: 1, count: 2, m: 300.5, kg: 50 }] } }, [
      { blockNo: 1, meters: 150, weightKg: 25, status: "PENDING" }, { blockNo: 1, meters: 150.5, weightKg: 25, status: "PENDING" }, { blockNo: 1, meters: 999, weightKg: 1, status: "SKIPPED" },
    ]);
    check("saf totalMismatches: tutan beyan (SKIPPED sayılmaz, %0,5 hoşgörü) → boş", pure.length === 0, pure.join(" "));
    check("saf totalMismatches: adet hoşgörüsüz", totalMismatches({ declaredTopCount: 3, totalsDeclared: null }, [{ blockNo: 1, meters: 1, weightKg: null, status: "PENDING" }]).length === 1);

    // §7 bozuk satır → PARTIAL → yeniden onay yalnız onu işler
    console.log("§7 kısmi onay");
    const n7 = await mkNote([L(50), L(51, { itemId: yarn.id, itemText: "İplik" }), L(52)]);
    const p7 = await onay(n7.id);
    const bad = p7.data?.note?.lines.find((l) => l.lineNo === 2);
    check("bozuk satır FAILED + Türkçe sebep", p7.status === 200 && bad?.status === "FAILED" && /iplik/i.test(bad.failReason ?? ""), `${bad?.status} ${bad?.failReason}`);
    check("başlık PARTIAL, 2 top", p7.data?.note?.status === "PARTIAL" && p7.data?.summary?.entered === 2 && p7.data?.summary?.failed === 1, JSON.stringify(p7.data?.summary));
    const before7 = await rollsOf(n7.id);
    // Düzeltme: PARTIAL belgede satır PATCH'i D2 kuralıyla kapalı (yalnız DRAFT) — D5 panel yolu açılana dek DB'den düzeltilir.
    await prisma.customerDeliveryNoteLine.update({ where: { id: bad!.id }, data: { itemId: fabric.id } });
    const p7b = await onay(n7.id);
    check("yeniden onay YALNIZ bozuk satırı işler → entered 1, APPROVED", p7b.status === 200 && p7b.data?.summary?.entered === 1 && p7b.data?.note?.status === "APPROVED", JSON.stringify(p7b.data?.summary));
    const after7 = await rollsOf(n7.id);
    check("önceki iki top aynı kaldı, toplam 3", before7.every((r) => after7.includes(r)) && after7.length === 3);

    // §8 sayfa kapısı
    console.log("§8 sayfa kapısı");
    const n8 = await mkNote([L(60)], { pageCount: 2 });
    const scan = await call("POST", "/api/gelen-belge/taramalar", tk, { contentBase64: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} sayfa 1`)]).toString("base64"), noteId: n8.id, pageNo: 1 });
    const scanId = ((scan.data as { scan?: { id?: string } })?.scan?.id ?? (scan.data as { id?: string })?.id) as string | undefined;
    if (scanId) made.scans.push(scanId);
    check("sayfa 1 taraması bağlandı", scan.status === 201 && !!scanId, `${scan.status} ${scan.code ?? ""}`);
    const g8 = await onay(n8.id);
    check("1/2 eksik → 409 DELIVERY_NOTE_PAGES_MISSING, sıfır top", g8.status === 409 && g8.code === "DELIVERY_NOTE_PAGES_MISSING" && (await rollsOf(n8.id)).length === 0, `${g8.status} ${g8.code}`);

    // §9 çözülmemiş ürün
    console.log("§9 çözülmemiş ürün");
    const n9 = await mkNote([L(70), L(71, { itemId: null })]);
    const u9 = await onay(n9.id);
    check("ürünsüz satır → 400 DELIVERY_NOTE_LINE_UNRESOLVED (lineNos [2]), sıfır top", u9.status === 400 && u9.code === "DELIVERY_NOTE_LINE_UNRESOLVED" && JSON.stringify(u9.details?.lineNos) === "[2]" && (await rollsOf(n9.id)).length === 0, `${u9.status} ${u9.code}`);

    // §10 alias öğrenme
    console.log("§10 alias");
    const aliases = await prisma.deliveryNoteAlias.findMany({ where: { OR: [{ targetId: fabric.id }, { targetId: color.id }, { targetId: sender }] }, select: { scope: true, senderCustomerId: true, rawKey: true, targetId: true, hitCount: true } });
    const itemAlias = aliases.find((a) => a.scope === "ITEM" && a.targetId === fabric.id);
    check("ITEM alias (gönderene bağlı) + COLOR + SENDER öğrenildi", !!itemAlias && itemAlias.senderCustomerId === sender && aliases.some((a) => a.scope === "COLOR") && aliases.some((a) => a.scope === "SENDER" && a.senderCustomerId === null), JSON.stringify(aliases.map((a) => [a.scope, a.rawKey, a.hitCount])));
    // n7'nin ikinci onayı yalnız "İplik" metinli satırı girdi → pamuklu alias'ı o turda öğrenilmez (yalnız GİREN satır öğretir).
    const senderAlias = aliases.find((a) => a.scope === "SENDER");
    check("hitCount giren onay sayısı kadar arttı (ITEM 4 · SENDER 5)", itemAlias?.hitCount === 4 && senderAlias?.hitCount === 5, `${itemAlias?.hitCount} ${senderAlias?.hitCount}`);

    // §11 audit yükü
    console.log("§11 audit");
    const logs = await prisma.systemLog.findMany({ where: { tableName: { in: ["CUSTOMER_DELIVERY_NOTE", "CUSTOMER_DELIVERY_NOTE_LINE", "DELIVERY_NOTE_ALIAS"] }, recordId: { in: [...made.notes, ...ls1.map((l) => l.id)] } }, select: { newData: true, oldData: true } });
    const dump = JSON.stringify(logs);
    check("onay audit'i var ve yükte ocrRaw/sourceRects/content yok", logs.length > 0 && !/ocrRaw|sourceRects|"content"/.test(dump), String(logs.length));
  } finally {
    stopNotificationJobs();
    await new Promise<void>((r) => server.close(() => r()));
    for (const k of keys) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

async function cleanup(): Promise<void> {
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  await prisma.documentScan.updateMany({ where: { noteId: { in: made.notes } }, data: { noteId: null } });
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.deliveryNoteAlias.deleteMany({ where: { OR: [{ targetId: { in: [...made.items, ...made.colors, ...made.customers] } }] } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } });
  await prisma.color.deleteMany({ where: { id: { in: made.colors } } });
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => undefined);
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...made.notes, ...rollIds] } } });
}

if (!engel) void main();
