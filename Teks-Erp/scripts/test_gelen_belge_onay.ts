// =============================================================================
// GELEN BELGE — D4 onay → giriş motoru bekçisi (HTTP, gerçek DB)
// =============================================================================
// Karar belgesi TASARIM-KARARI-2026-10-28 §3 adım 6 + §6 D4 satırı. Sınanan:
//   §1 16 satırlı DRAFT onay → 16 Roll (STOCK · SEMI_FINISHED · ownerCustomerId dolu · entryReasonCode GELEN_BELGE)
//      + 16 WarehouseMovement ENTRY; başlık APPROVED; satırlar ENTERED + rollId; renkli satır da STOCK (forcedStatus)
//   §2 iki ayrı 200 m satır → iki top (onay `opts.duplicateGuard` GEÇMEZ; motor bayrağı yalnız o verilirse okur —
//      `kk1.duplicateGuardEnabled` açık tutulur ki geçilirse kırmızıya dönsün)
//   §3 replay: satır token'ı (uuidv5) ile ikinci giriş idempotent → ikinci top YOK; onaylıyı yeniden onay → 409 NO_OPEN_LINES
//   §4 eşzamanlı iki onay → biri 200, biri 409 DELIVERY_NOTE_NOT_APPROVABLE; top sayısı = satır sayısı
//   §5 emanet kapalı → 403 MODULE_DISABLED ve SIFIR top; taslak DRAFT kalır
//   §6 blok toplamı uyuşmazlığı → 409 TOTAL_MISMATCH; varianceReason ile ikinci deneme 200 + gerekçe başlıkta;
//      başlık top adedi farkı YALNIZ uyarı (200 + warnings); saf `totalMismatches` / `totalWarnings`
//   §7 bir satır bilinçli bozuk (iplik kalemi) → o satır FAILED + Türkçe sebep, başlık PARTIAL; API'den (PATCH) düzeltip
//      yeniden onay YALNIZ onu işler → APPROVED; ENTERED satır PATCH'i 409; FAILED satırı skip → SKIPPED + başlık APPROVED
//   §8 sayfa kapısı: pageCount 2, yalnız sayfa 1 taranmış → 409 DELIVERY_NOTE_PAGES_MISSING; gerekçeyle 200 + uyarı
//   §9 ürünü çözülmemiş satır → 400 DELIVERY_NOTE_LINE_UNRESOLVED, sıfır top
//   §10 alias öğrenme: ITEM/COLOR/SENDER sözlüğe; ikinci onayda hitCount artar
//   §11 audit: satır/başlık audit yükünde ocrRaw/sourceRects/content yok
//   §12 TOCTOU: ön kontrolden sonra, claim'den önce sahip PATCH'i → 409 DELIVERY_NOTE_CHANGED, sıfır top
//   §13 yarıda kalan onay: ENTERING satır + doğmuş top + 11 dk bayat APPROVING → onay 200, replayed 1, ek top YOK
//   §14 HİZMET EKSENİ (E3) varsayılan ürün: ayar boş → §9 aynen; iplik/pasif ürün ayara yazılamaz (400
//       GELEN_BELGE_DEFAULT_ITEM_INVALID), ham ayar ucu 400 SETTING_KEY_RESERVED; ayar dolu → ürünsüz 3 satır 3 top
//       (itemId = ayar ürünü, satır itemId boş + itemText yerinde, alias öğrenilmez) + ürünü seçili satır kendi ürünüyle;
//       onay anında ayar ürünü pasifleşmişse 409 GELEN_BELGE_DEFAULT_ITEM_UNUSABLE ve SIFIR top
//   §15 inceleme kapısı: needsReview satır — ayar kaydı yokken ve WARN'da 200 + uyarı; BLOCK 409 DELIVERY_NOTE_REVIEW_PENDING, SIFIR top
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
import { lineRollToken, totalMismatches, totalWarnings } from "../src/services/gelen-belge-onay.service";
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
type Resp = { status: number; code?: string; warnings?: string[]; details?: Record<string, unknown>; data?: Record<string, unknown> & { note?: NoteData; summary?: { entered: number; failed: number; replayed: number; rollIds: string[] }; lines?: Line[] } };

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
  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.KK1_DUPLICATE_GUARD_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await ayar(SETTING_KEYS.EMANET_ENABLED, true);
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
    await ayar(SETTING_KEYS.KK1_DUPLICATE_GUARD_ENABLED, true);
    // E3 ayarları BUGÜNKÜ davranışta başlar (kayıt yok) — §1–§13 varsayılanı ölçer.
    await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL] } } });
    const login = async (username: string, password: string) => {
      const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
      return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
    };
    const call = async (method: string, path: string, token: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; warnings?: string[]; details?: { code?: string } & Record<string, unknown> };
      return { status: r.status, code: j.details?.code, details: j.details, data: j.data, warnings: j.warnings };
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
    check("§2 iki ayrı 200 m satır → iki ayrı top (onay duplicateGuard geçmez; bayrak açık)", twoHundred.length === 2 && twoHundred[0]!.rollId !== twoHundred[1]!.rollId && twoHundred.every((l) => l.rollId));

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
    const pure = totalMismatches({ totalsDeclared: { blocks: [{ blockNo: 1, count: 2, m: 300.5, kg: 50 }] } }, [
      { blockNo: 1, meters: 150, weightKg: 25, status: "PENDING" }, { blockNo: 1, meters: 150.5, weightKg: 25, status: "PENDING" }, { blockNo: 1, meters: 999, weightKg: 1, status: "SKIPPED" },
    ]);
    check("saf totalMismatches: tutan beyan (SKIPPED sayılmaz, %0,5 hoşgörü) → boş", pure.length === 0, pure.join(" "));
    // OCR beyanı sayıları METİN yazar; "2" ile 2 satır tutar (panel şeridiyle aynı ölçüt).
    const ocrText = totalMismatches({ totalsDeclared: { blocks: [{ blockNo: 1, count: "2", m: "300.5" }] } }, [
      { blockNo: 1, meters: 150, weightKg: null, status: "PENDING" }, { blockNo: 1, meters: 150.5, weightKg: null, status: "PENDING" },
    ]);
    check("saf totalMismatches: OCR metin count (\"2\") tutan beyan → boş", ocrText.length === 0, ocrText.join(" "));
    check("saf totalMismatches: blok adedi hoşgörüsüz", totalMismatches({ totalsDeclared: { blocks: [{ blockNo: 1, count: 3 }] } }, [{ blockNo: 1, meters: 1, weightKg: null, status: "PENDING" }]).length === 1);
    check("saf: başlık top adedi farkı SERT DEĞİL (totalMismatches boş, totalWarnings 1)", totalMismatches({ totalsDeclared: null }, [{ blockNo: 1, meters: 1, weightKg: null, status: "PENDING" }]).length === 0 && totalWarnings({ declaredTopCount: 3 }, [{ blockNo: 1, meters: 1, weightKg: null, status: "PENDING" }]).length === 1);
    check("blok farkı geçildiğinde başlık adedi farkı uyarı olarak döner", (t6b.warnings ?? []).some((w) => w.includes("5 top")), JSON.stringify(t6b.warnings));
    const n6w = await mkNote([L(43), L(44)], { declaredTopCount: 3 });
    const t6w = await onay(n6w.id);
    check("yalnız başlık adedi farkı → gerekçesiz 200 + warnings (tasarım §4: declaredTopCount yalnız uyarı)", t6w.status === 200 && (t6w.warnings ?? []).some((w) => w.includes("3 top")), `${t6w.status} ${t6w.code ?? ""} ${JSON.stringify(t6w.warnings)}`);

    // §7 bozuk satır → PARTIAL → yeniden onay yalnız onu işler
    console.log("§7 kısmi onay");
    const n7 = await mkNote([L(50), L(51, { itemId: yarn.id, itemText: "İplik" }), L(52)]);
    const p7 = await onay(n7.id);
    const bad = p7.data?.note?.lines.find((l) => l.lineNo === 2);
    check("bozuk satır FAILED + Türkçe sebep", p7.status === 200 && bad?.status === "FAILED" && /iplik/i.test(bad.failReason ?? ""), `${bad?.status} ${bad?.failReason}`);
    check("başlık PARTIAL, 2 top", p7.data?.note?.status === "PARTIAL" && p7.data?.summary?.entered === 2 && p7.data?.summary?.failed === 1, JSON.stringify(p7.data?.summary));
    const before7 = await rollsOf(n7.id);
    const good = p7.data?.note?.lines.find((l) => l.lineNo === 1);
    const e7 = await call("PATCH", `/api/gelen-belge/irsaliyeler/${n7.id}/satirlar/${good!.id}`, writer, { meters: 1 });
    check("PARTIAL'da ENTERED satır PATCH'i → 409 (yalnız topsuz FAILED açılır)", e7.status === 409, `${e7.status} ${e7.code}`);
    const fix7 = await call("PATCH", `/api/gelen-belge/irsaliyeler/${n7.id}/satirlar/${bad!.id}`, writer, { itemId: fabric.id });
    check("PARTIAL'da FAILED satır API'den düzeltildi (PATCH 200)", fix7.status === 200, `${fix7.status} ${fix7.code ?? ""}`);
    const p7b = await onay(n7.id);
    check("yeniden onay YALNIZ bozuk satırı işler → entered 1, APPROVED", p7b.status === 200 && p7b.data?.summary?.entered === 1 && p7b.data?.note?.status === "APPROVED", JSON.stringify(p7b.data?.summary));
    const after7 = await rollsOf(n7.id);
    check("önceki iki top aynı kaldı, toplam 3", before7.every((r) => after7.includes(r)) && after7.length === 3);

    const n7s = await mkNote([L(53), L(54, { itemId: yarn.id, itemText: "İplik" })]);
    const p7s = await onay(n7s.id);
    const bad7s = p7s.data?.note?.lines.find((l) => l.lineNo === 2);
    check("ikinci kısmi belge PARTIAL", p7s.data?.note?.status === "PARTIAL" && bad7s?.status === "FAILED", p7s.data?.note?.status);
    const skip7 = await call("PATCH", `/api/gelen-belge/irsaliyeler/${n7s.id}/satirlar/${bad7s!.id}`, writer, { skip: true });
    const st7s = await prisma.customerDeliveryNote.findUnique({ where: { id: n7s.id }, select: { status: true } });
    check("FAILED satır skip → SKIPPED; açık satır kalmadı → başlık APPROVED, top 1", skip7.status === 200 && (skip7.data as { status?: string })?.status === "SKIPPED" && st7s?.status === "APPROVED" && (await rollsOf(n7s.id)).length === 1, `${skip7.status} ${skip7.code ?? ""} ${st7s?.status}`);
    const n7d = await mkNote([L(55)]);
    const d7 = await call("PATCH", `/api/gelen-belge/irsaliyeler/${n7d.id}/satirlar/${(await prisma.customerDeliveryNoteLine.findFirst({ where: { noteId: n7d.id }, select: { id: true } }))!.id}`, writer, { skip: true });
    check("taslakta skip → 400 DELIVERY_NOTE_LINE_SKIP_DRAFT", d7.status === 400 && d7.code === "DELIVERY_NOTE_LINE_SKIP_DRAFT", `${d7.status} ${d7.code}`);

    // §8 sayfa kapısı
    console.log("§8 sayfa kapısı");
    const n8 = await mkNote([L(60)], { pageCount: 2 });
    const scan = await call("POST", "/api/gelen-belge/taramalar", tk, { contentBase64: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} sayfa 1`)]).toString("base64"), noteId: n8.id, pageNo: 1 });
    const scanId = ((scan.data as { scan?: { id?: string } })?.scan?.id ?? (scan.data as { id?: string })?.id) as string | undefined;
    if (scanId) made.scans.push(scanId);
    check("sayfa 1 taraması bağlandı", scan.status === 201 && !!scanId, `${scan.status} ${scan.code ?? ""}`);
    const g8 = await onay(n8.id);
    check("1/2 eksik → 409 DELIVERY_NOTE_PAGES_MISSING, sıfır top", g8.status === 409 && g8.code === "DELIVERY_NOTE_PAGES_MISSING" && (await rollsOf(n8.id)).length === 0, `${g8.status} ${g8.code}`);

    const g8b = await onay(n8.id, { varianceReason: "Sayfa 2 boş arka yüz" });
    check("gerekçeyle eksik sayfa geçilir → 200 + uyarı", g8b.status === 200 && (g8b.warnings ?? []).some((w) => w.includes("Eksik sayfa")), `${g8b.status} ${g8b.code ?? ""}`);

    // §9 çözülmemiş ürün
    console.log("§9 çözülmemiş ürün");
    const n9 = await mkNote([L(70), L(71, { itemId: null })]);
    const u9 = await onay(n9.id);
    check("ürünsüz satır → 400 DELIVERY_NOTE_LINE_UNRESOLVED (lineNos [2]), sıfır top", u9.status === 400 && u9.code === "DELIVERY_NOTE_LINE_UNRESOLVED" && JSON.stringify(u9.details?.lineNos) === "[2]" && (await rollsOf(n9.id)).length === 0, `${u9.status} ${u9.code}`);

    // §10 alias öğrenme
    console.log("§10 alias");
    const aliases = await prisma.deliveryNoteAlias.findMany({ where: { OR: [{ targetId: fabric.id }, { targetId: color.id }, { targetId: sender }] }, select: { scope: true, senderCustomerId: true, rawKey: true, targetId: true, hitCount: true } });
    // Fabric'e iki ITEM anahtarı öğrenilir ("Pamuklu 30/1" ve §7'de düzeltilen "İplik"); pamuklu olanı en çok vurulandır.
    const itemAlias = aliases.filter((a) => a.scope === "ITEM" && a.targetId === fabric.id).sort((x, y) => y.hitCount - x.hitCount)[0];
    check("ITEM alias (gönderene bağlı) + COLOR + SENDER öğrenildi", !!itemAlias && itemAlias.senderCustomerId === sender && aliases.some((a) => a.scope === "COLOR") && aliases.some((a) => a.scope === "SENDER" && a.senderCustomerId === null), JSON.stringify(aliases.map((a) => [a.scope, a.rawKey, a.hitCount])));
    // n7'nin ikinci onayı yalnız "İplik" metinli satırı girdi → pamuklu alias'ı o turda öğrenilmez (yalnız GİREN satır öğretir).
    const senderAlias = aliases.find((a) => a.scope === "SENDER");
    // Pamuklu giren onaylar: n1 n4 n6 n6w n7 n7s n8 = 7; gönderen her giren onayda: + n7 ikinci tur = 8.
    check("hitCount giren onay sayısı kadar arttı (ITEM 7 · SENDER 8)", itemAlias?.hitCount === 7 && senderAlias?.hitCount === 8, `${itemAlias?.hitCount} ${senderAlias?.hitCount}`);

    // §11 audit yükü
    console.log("§11 audit");
    const logs = await prisma.systemLog.findMany({ where: { tableName: { in: ["CUSTOMER_DELIVERY_NOTE", "CUSTOMER_DELIVERY_NOTE_LINE", "DELIVERY_NOTE_ALIAS"] }, recordId: { in: [...made.notes, ...ls1.map((l) => l.id)] } }, select: { newData: true, oldData: true } });
    const dump = JSON.stringify(logs);
    check("onay audit'i var ve yükte ocrRaw/sourceRects/content yok", logs.length > 0 && !/ocrRaw|sourceRects|"content"/.test(dump), String(logs.length));

    // §12 TOCTOU — ön kontrolün okuması döndükten SONRA (claim'den önce) sahip değişir; claim updatedAt eşitliğiyle düşmeli.
    console.log("§12 ön kontrol ↔ claim yarışı");
    const owner2 = await mkCustomer("OWN2");
    const n12 = await mkNote([L(80), L(81)]);
    const delegate = prisma.customerDeliveryNote as unknown as { findUnique: (a: { where: { id: string }; select?: Record<string, unknown> }) => Promise<unknown> };
    const origFind = delegate.findUnique;
    let armed = true;
    delegate.findUnique = async (a) => {
      const r = await origFind.call(prisma.customerDeliveryNote, a);
      if (armed && a.where.id === n12.id && a.select && "scans" in a.select) {
        armed = false;
        await call("PATCH", `/api/gelen-belge/irsaliyeler/${n12.id}`, tk, { ownerCustomerId: owner2 });
      }
      return r;
    };
    let r12: Resp;
    try { r12 = await onay(n12.id); } finally { delegate.findUnique = origFind; }
    check("kanca tetiklendi (sahip PATCH'i ön kontrolle claim arasına girdi)", !armed);
    check("ön kontrolden sonra sahip değişti → 409 DELIVERY_NOTE_CHANGED, sıfır top", r12.status === 409 && r12.code === "DELIVERY_NOTE_CHANGED" && (await rollsOf(n12.id)).length === 0, `${r12.status} ${r12.code}`);
    const r12b = await onay(n12.id);
    const own12 = await prisma.roll.findMany({ where: { id: { in: await rollsOf(n12.id) } }, select: { ownerCustomerId: true } });
    check("yeniden deneme 200 ve toplar YENİ sahiple doğdu", r12b.status === 200 && own12.length === 2 && own12.every((x) => x.ownerCustomerId === owner2), `${r12b.status} ${JSON.stringify(own12)}`);

    // §13 yarıda kalan onay — süreç ölmüş: satır ENTERING, top doğmuş ama bağlanmamış, başlık 11 dk bayat APPROVING.
    console.log("§13 bayat APPROVING devralma");
    const n13 = await mkNote([L(90), L(91)]);
    const l13 = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: n13.id }, select: { id: true, meters: true }, orderBy: { lineNo: "asc" } });
    await prisma.customerDeliveryNoteLine.update({ where: { id: l13[0]!.id }, data: { status: "ENTERING" } });
    const born = await inv.createInitialEntry({ itemId: fabric.id, colorId: null, initialQty: Number(l13[0]!.meters), clientToken: lineRollToken(l13[0]!.id) }, admin.id, null, false, { forcedEntrySource: "SEMI_FINISHED", forcedStatus: "STOCK", ownerCustomerId: owner, skipKk1WeightPolicy: true });
    const bornId = (born.data as { id: string }).id;
    await prisma.customerDeliveryNote.update({ where: { id: n13.id }, data: { status: "APPROVING", updatedAt: new Date(Date.now() - 11 * 60 * 1000) } });
    const r13 = await onay(n13.id);
    const rl13 = await rollsOf(n13.id);
    check("bayat APPROVING devralındı → 200, replayed 1 · entered 1, APPROVED", r13.status === 200 && r13.data?.summary?.replayed === 1 && r13.data?.summary?.entered === 1 && r13.data?.note?.status === "APPROVED", `${r13.status} ${r13.code ?? ""} ${JSON.stringify(r13.data?.summary)}`);
    check("yarıda doğan top bağlandı, ek top YOK (2 satır = 2 top)", rl13.length === 2 && rl13.includes(bornId) && (await prisma.roll.count({ where: { clientToken: lineRollToken(l13[0]!.id) } })) === 1, JSON.stringify(rl13));

    // §14 hizmet ekseni — varsayılan ürün
    console.log("§14 varsayılan ürün (hizmet ekseni)");
    const g14 = await call("GET", "/api/gelen-belge/ayarlar", writer);
    check("ayar okuma (gelen-belge:read) 200; varsayılan boş, kip WARN", g14.status === 200 && (g14.data as { defaultItem?: unknown })?.defaultItem === null && (g14.data as { unreviewedApproval?: string })?.unreviewedApproval === "WARN", `${g14.status} ${JSON.stringify(g14.data)}`);
    check("ayar yazma admin:settings ister (yazıcı → 403)", (await call("PUT", "/api/gelen-belge/ayarlar", writer, { defaultItemId: fabric.id })).status === 403);
    const yarnSet = await call("PUT", "/api/gelen-belge/ayarlar", tk, { defaultItemId: yarn.id });
    check("iplik ürünü ayara yazılamaz → 400 GELEN_BELGE_DEFAULT_ITEM_INVALID", yarnSet.status === 400 && yarnSet.code === "GELEN_BELGE_DEFAULT_ITEM_INVALID", `${yarnSet.status} ${yarnSet.code}`);
    const passive = await prisma.item.create({ data: { code: `${TAG}-PAS`, name: `${TAG} pasif kumaş`, itemType: "FABRIC", unit: "MT", isActive: false, lifecycleStatus: "ARCHIVED" }, select: { id: true } });
    made.items.push(passive.id);
    const pasSet = await call("PUT", "/api/gelen-belge/ayarlar", tk, { defaultItemId: passive.id });
    check("pasif ürün ayara yazılamaz → 400 GELEN_BELGE_DEFAULT_ITEM_INVALID", pasSet.status === 400 && pasSet.code === "GELEN_BELGE_DEFAULT_ITEM_INVALID", `${pasSet.status} ${pasSet.code}`);
    const rawSet = await call("PUT", `/api/admin/settings/${SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID}`, tk, { value: passive.id });
    check("ham ayar ucu bu anahtarı yazamaz → 400 SETTING_KEY_RESERVED", rawSet.status === 400 && rawSet.code === "SETTING_KEY_RESERVED", `${rawSet.status} ${rawSet.code}`);
    const n14a = await mkNote([L(100, { itemId: null, itemText: "Müşteri kumaşı A" })]);
    const u14 = await onay(n14a.id);
    check("ayar BOŞ → ürünsüz satır 400 DELIVERY_NOTE_LINE_UNRESOLVED (bugünkü davranış), sıfır top", u14.status === 400 && u14.code === "DELIVERY_NOTE_LINE_UNRESOLVED" && (await rollsOf(n14a.id)).length === 0, `${u14.status} ${u14.code}`);
    const service = await prisma.item.create({ data: { code: `${TAG}-HZM`, name: `${TAG} fason emanet kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    made.items.push(service.id);
    const okSet = await call("PUT", "/api/gelen-belge/ayarlar", tk, { defaultItemId: service.id });
    check("aktif kumaş ayara yazıldı → 200, GET adıyla döner", okSet.status === 200 && (okSet.data as { defaultItem?: { id?: string; problem?: unknown } })?.defaultItem?.id === service.id && (okSet.data as { defaultItem?: { problem?: unknown } })?.defaultItem?.problem === null, `${okSet.status} ${okSet.code ?? ""}`);
    const auditSet = await prisma.systemLog.count({ where: { tableName: "SYSTEM_SETTING", recordId: SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID } });
    check("ayar yazımı audit'li", auditSet > 0, String(auditSet));
    const n14 = await mkNote([
      L(101, { itemId: null, itemText: "Müşteri kumaşı A" }),
      L(102, { itemId: null, itemText: "Müşteri kumaşı B", colorText: "Lacivert" }),
      L(103, { itemId: null, itemText: "Müşteri kumaşı C" }),
      L(104),
    ]);
    const a14 = await onay(n14.id);
    check("ayar DOLU → onay 200, 4 top", a14.status === 200 && a14.data?.summary?.entered === 4, `${a14.status} ${a14.code ?? ""} ${JSON.stringify(a14.data?.summary)}`);
    check("uyarıda varsayılan ürünle giren satır sayısı", (a14.warnings ?? []).some((w) => w.includes("3 satır varsayılan ürünle")), JSON.stringify(a14.warnings));
    const l14 = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: n14.id }, select: { lineNo: true, itemId: true, itemText: true, roll: { select: { itemId: true } } }, orderBy: { lineNo: "asc" } });
    const def14 = l14.filter((l) => l.lineNo <= 3);
    check("⭐ ürünsüz 3 satır → 3 top, Roll.itemId = ayar ürünü", def14.length === 3 && def14.every((l) => l.roll?.itemId === service.id), JSON.stringify(def14.map((l) => l.roll?.itemId)));
    check("satırın itemId'si boş kaldı, itemText yerinde", def14.every((l) => l.itemId === null) && def14.map((l) => l.itemText).join("|") === "Müşteri kumaşı A|Müşteri kumaşı B|Müşteri kumaşı C");
    check("ürünü seçilmiş satır kendi ürünüyle doğdu", l14[3]?.roll?.itemId === fabric.id, l14[3]?.roll?.itemId ?? "yok");
    const learned = await prisma.deliveryNoteAlias.count({ where: { scope: "ITEM", targetId: service.id } });
    check("varsayılanla giren satır alias öğretmez (sözlük zehirlenmez)", learned === 0, String(learned));
    // Onay ANINDA ayar ürünü pasifleşti (ayar yazıldıktan sonra) → fail-closed.
    await prisma.item.update({ where: { id: service.id }, data: { isActive: false, lifecycleStatus: "ARCHIVED" } });
    const n14p = await mkNote([L(105, { itemId: null, itemText: "Müşteri kumaşı D" })]);
    const p14 = await onay(n14p.id);
    check("ayar ürünü pasifleşmiş → 409 GELEN_BELGE_DEFAULT_ITEM_UNUSABLE, SIFIR top, taslak DRAFT", p14.status === 409 && p14.code === "GELEN_BELGE_DEFAULT_ITEM_UNUSABLE" && (await rollsOf(n14p.id)).length === 0 && (await prisma.customerDeliveryNote.findUnique({ where: { id: n14p.id }, select: { status: true } }))?.status === "DRAFT", `${p14.status} ${p14.code}`);
    const g14p = await call("GET", "/api/gelen-belge/ayarlar", writer);
    check("GET pasif ürünün sorununu söyler (problem dolu)", typeof (g14p.data as { defaultItem?: { problem?: unknown } })?.defaultItem?.problem === "string");
    const clr = await call("PUT", "/api/gelen-belge/ayarlar", tk, { defaultItemId: null });
    check("ayar temizlenir (null) → bugünkü davranış", clr.status === 200 && (clr.data as { defaultItem?: unknown })?.defaultItem === null && (await onay(n14p.id)).code === "DELIVERY_NOTE_LINE_UNRESOLVED", `${clr.status}`);

    // §15 inceleme kapısı
    console.log("§15 gözden geçirilmemiş hücre kapısı");
    // Kabuldeki "UYAR varsayılan" iddiası: ayar SATIRI HİÇ YOKKEN needsReview satır geçer (kip açıkça yazılmadan).
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL } });
    const n15d = await mkNote([L(112, { needsReview: true })]);
    const d15 = await onay(n15d.id);
    check("⭐ ayar kaydı YOK + needsReview satır → 200 + uyarı (varsayılan WARN), 1 top", d15.status === 200 && (await rollsOf(n15d.id)).length === 1 && (d15.warnings ?? []).some((w) => w.includes("Gözden geçirilmemiş")), `${d15.status} ${d15.code ?? ""} ${JSON.stringify(d15.warnings)}`);
    const n15 = await mkNote([L(110), L(111, { needsReview: true })]);
    const blk = await call("PUT", "/api/gelen-belge/ayarlar", tk, { unreviewedApproval: "BLOCK" });
    check("kip BLOCK yazıldı", blk.status === 200 && (blk.data as { unreviewedApproval?: string })?.unreviewedApproval === "BLOCK", `${blk.status} ${blk.code ?? ""}`);
    const b15 = await onay(n15.id);
    check("⭐ BLOCK + needsReview satır → 409 DELIVERY_NOTE_REVIEW_PENDING (lineNos [2]), SIFIR top", b15.status === 409 && b15.code === "DELIVERY_NOTE_REVIEW_PENDING" && JSON.stringify(b15.details?.lineNos) === "[2]" && (await rollsOf(n15.id)).length === 0, `${b15.status} ${b15.code}`);
    const bad15 = await call("PUT", "/api/gelen-belge/ayarlar", tk, { unreviewedApproval: "SESSIZ" });
    check("tanınmayan kip → 400", bad15.status === 400, `${bad15.status}`);
    await call("PUT", "/api/gelen-belge/ayarlar", tk, { unreviewedApproval: "WARN" });
    const w15 = await onay(n15.id);
    check("WARN (varsayılan) → onay geçer, 2 top + uyarı", w15.status === 200 && (await rollsOf(n15.id)).length === 2 && (w15.warnings ?? []).some((w) => w.includes("Gözden geçirilmemiş")), `${w15.status} ${w15.code ?? ""} ${JSON.stringify(w15.warnings)}`);
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
