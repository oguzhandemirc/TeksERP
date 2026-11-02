// =============================================================================
// GELEN BELGE — gözden geçirme yüzeyi bekçisi (toplam şeridi + sorunlu satır süzgeci; HTTP, gerçek DB)
// =============================================================================
// Panel şeridi/süzgeci onay kapısının hükmünü OKUR, yeniden hesaplamaz: detay yanıtı `totalsCheck` + satır
// `problems` alanlarını onay ön kontrolüyle AYNI yüklemlerden (`gelen-belge-kontrol.service.ts`) üretir.
//   §1 saf `totalsCheck`: `mismatches` ≡ `totalMismatches` (SKIPPED, %0,5, adet hoşgörüsüz, OCR metni, okunamaz beyan),
//      blok yapısı (beyanlı/beyansız, fark işareti), ok üç değerli
//   §2 saf `lineProblems`: FAILED · ITEM_UNRESOLVED · NEEDS_REVIEW; ENTERED/SKIPPED açık değildir
//   §3 ⭐ HTTP: detay `totalsCheck.ok=false` ↔ onay 409 TOTAL_MISMATCH ve `details.mismatches` bayt-aynı; satır PATCH'i
//      sonrası detay tutuyor (ok=true) ↔ onay toplam kapısından geçer; GET YAZMAZ (updatedAt + audit sayısı sabit)
//   §4 ⭐ HTTP: satır `problems` ↔ onayın 400 UNRESOLVED / 409 REVIEW_PENDING `lineNos` kümesi birebir
//   §5 kaynak taraması: panelde toplam hoşgörüsü/yeniden hesap yok; onay servisinde yerel kapı kopyası yok
// Emsal: scripts/test_gelen_belge_onay.ts (app.listen(0) + ensureTestAdmin).
// =============================================================================
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as fs from "node:fs";
import * as path from "node:path";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { lineProblems, totalMismatches, totalsCheck, type TotalLine } from "../src/services/gelen-belge-kontrol.service";
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

const TAG = `TEST-GBG${Date.now().toString(36).toUpperCase()}`;
const made = { customers: [] as string[], notes: [] as string[], items: [] as string[] };

type DLine = { id: string; lineNo: number; problems?: string[] };
type TC = { ok: boolean | null; mismatches: string[]; blocks: Array<{ blockNo: number; ok: boolean | null; diffs: Array<{ field: string; diff: number | null }> }> };
type Detail = { id: string; updatedAt: string; lines: DLine[]; totalsCheck?: TC };
type Resp = { status: number; code?: string; details?: Record<string, unknown>; data?: unknown };

const L = (blockNo: number, meters: number, status: TotalLine["status"] = "PENDING", weightKg: number | null = null): TotalLine => ({ blockNo, meters, weightKg, status });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function section1(): void {
  console.log("§1 saf totalsCheck");
  const cases: Array<{ name: string; declared: unknown; lines: TotalLine[] }> = [
    { name: "tutan beyan (SKIPPED sayılmaz, %0,5 içinde)", declared: { blocks: [{ blockNo: 1, count: 2, m: 300.5, kg: 50 }] }, lines: [L(1, 150, "PENDING", 25), L(1, 151, "PENDING", 25), L(1, 99, "SKIPPED", 9)] },
    { name: "OCR metni beyan", declared: { blocks: [{ blockNo: 1, count: "2", m: "300.5" }] }, lines: [L(1, 150), L(1, 151)] },
    { name: "adet hoşgörüsüz + iki blok", declared: { blocks: [{ blockNo: 1, count: 3, m: 200 }, { blockNo: 2, count: 1, m: 80, kg: 10 }] }, lines: [L(1, 100), L(1, 100), L(2, 76, "PENDING", 10)] },
    { name: "%0,5 sınırı dışı", declared: { blocks: [{ blockNo: 1, m: 1000 }] }, lines: [L(1, 1006)] },
    { name: "okunamaz beyan metni", declared: { blocks: [{ blockNo: 1, m: "abc" }] }, lines: [L(1, 10)] },
    { name: "beyan yok", declared: null, lines: [L(1, 10)] },
  ];
  for (const c of cases) {
    const t = totalsCheck({ totalsDeclared: c.declared, declaredTopCount: null }, c.lines);
    check(`§1a ${c.name}: mismatches ≡ totalMismatches`, same(t.mismatches, totalMismatches({ totalsDeclared: c.declared }, c.lines)), t.mismatches.join(" "));
    check(`§1b ${c.name}: ok ↔ mismatches tutarlı`, (t.ok === false) === (t.mismatches.length > 0));
  }
  const two = totalsCheck({ totalsDeclared: cases[2]!.declared, declaredTopCount: 4 }, cases[2]!.lines);
  const b2 = two.blocks.find((b) => b.blockNo === 2);
  check("§1c blok 1 adet farkı (beyan 3, satır 2 → −1), blok 2 metre farkı −4", two.blocks[0]?.diffs[0]?.field === "count" && two.blocks[0]?.diffs[0]?.diff === -1 && b2?.diffs.length === 1 && b2.diffs[0]?.field === "m" && b2.diffs[0]?.diff === -4, JSON.stringify(two.blocks));
  check("§1d başlık top adedi yalnız uyarı", two.warnings.length === 1 && two.mismatches.length === 2);
  const ok = totalsCheck({ totalsDeclared: cases[0]!.declared, declaredTopCount: null }, cases[0]!.lines);
  check("§1e tutan beyan → ok=true, blok ok=true, fark yok", ok.ok === true && ok.blocks.length === 1 && ok.blocks[0]?.ok === true && ok.blocks[0]?.diffs.length === 0);
  const none = totalsCheck({ totalsDeclared: null, declaredTopCount: null }, [L(1, 10), L(3, 5)]);
  check("§1f beyansız → ok=null, satırlı bloklar doğrulanamaz", none.ok === null && same(none.blocks.map((b) => [b.blockNo, b.ok, b.declared]), [[1, null, null], [3, null, null]]));
  const nan = totalsCheck({ totalsDeclared: cases[4]!.declared, declaredTopCount: null }, cases[4]!.lines);
  check("§1g okunamaz beyan → uyuşmazlık, beyan/fark null", nan.ok === false && nan.blocks[0]?.diffs[0]?.declared === null && nan.blocks[0]?.diffs[0]?.diff === null);
}

function section2(): void {
  console.log("§2 saf lineProblems");
  const p = (status: "PENDING" | "FAILED" | "ENTERED" | "SKIPPED" | "ENTERING", itemId: string | null, needsReview: boolean) => lineProblems({ status, itemId, needsReview });
  check("§2a temiz açık satır → []", same(p("PENDING", "x", false), []));
  check("§2b ürünsüz → ITEM_UNRESOLVED", same(p("PENDING", null, false), ["ITEM_UNRESOLVED"]));
  check("§2c gözden geçirilmemiş → NEEDS_REVIEW", same(p("PENDING", "x", true), ["NEEDS_REVIEW"]));
  check("§2d düşmüş ürünsüz → FAILED + ITEM_UNRESOLVED", same(p("FAILED", null, false), ["FAILED", "ITEM_UNRESOLVED"]));
  check("§2e girilmiş/atlanmış satır sorunsuz (açık değil)", same(p("ENTERED", null, true), []) && same(p("SKIPPED", null, true), []));
}

async function main(): Promise<void> {
  console.log("=== Gelen belge gözden geçirme bekçisi ===\n");
  section1();
  section2();
  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED]) await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: true }, update: { value: true } });
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID } });
    const r0 = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: admin.password, clientType: "electron" }) });
    const tk = ((await r0.json()) as { data?: { token?: string } }).data?.token ?? "";
    check("admin login", tk.length > 0);
    const call = async (method: string, p: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${url}${p}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: unknown; details?: { code?: string } & Record<string, unknown> };
      return { status: r.status, code: j.details?.code, details: j.details, data: j.data };
    };
    const owner = await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} sahip` }, select: { id: true } });
    made.customers.push(owner.id);
    const fabric = await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} pamuklu`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    made.items.push(fabric.id);
    const mkNote = async (lines: unknown[], header: Record<string, unknown> = {}) => {
      const r = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", ownerCustomerId: owner.id, senderText: `${TAG} gönderen`, lines, ...header });
      const id = (r.data as { id?: string })?.id ?? "";
      if (id) made.notes.push(id);
      return id;
    };
    const detail = async (id: string) => (await call("GET", `/api/gelen-belge/irsaliyeler/${id}`)).data as Detail;
    const Ln = (n: number, meters: number, extra: Record<string, unknown> = {}) => ({ senderRollNo: `${TAG}-R${n}`, meters, itemText: "Pamuklu", itemId: fabric.id, ...extra });

    // §3 toplam şeridi ↔ kapı
    console.log("§3 detay totalsCheck ↔ onay toplam kapısı");
    const n3 = await mkNote([Ln(1, 141), Ln(2, 142), Ln(3, 143)], { totalsDeclared: { blocks: [{ blockNo: 1, count: "3", m: "500" }] } });
    const d3 = await detail(n3);
    const tc = d3?.totalsCheck;
    check("§3a detay totalsCheck taşır: ok=false, blok 1 metre farkı −74", tc?.ok === false && tc.blocks[0]?.diffs.some((d) => d.field === "m" && d.diff === -74) === true, JSON.stringify(tc));
    const logsBefore = await prisma.systemLog.count({ where: { recordId: n3 } });
    const d3b = await detail(n3);
    check("§3b GET yazmaz (updatedAt + audit sayısı sabit)", d3b.updatedAt === d3.updatedAt && (await prisma.systemLog.count({ where: { recordId: n3 } })) === logsBefore);
    const a3 = await call("POST", `/api/gelen-belge/irsaliyeler/${n3}/onay`, {});
    check("§3c ⭐ onay 409 TOTAL_MISMATCH ve details.mismatches ≡ detay totalsCheck.mismatches", a3.status === 409 && a3.code === "TOTAL_MISMATCH" && same(a3.details?.mismatches, tc?.mismatches), `${a3.status} ${a3.code} ${JSON.stringify(a3.details?.mismatches)}`);
    const third = d3.lines.find((l) => l.lineNo === 3)!;
    const p3 = await call("PATCH", `/api/gelen-belge/irsaliyeler/${n3}/satirlar/${third.id}`, { meters: 217 });
    check("§3d satır düzeltildi (Σ = 500)", p3.status === 200, `${p3.status} ${p3.code ?? ""}`);
    const d3c = await detail(n3);
    check("§3e satır düzenlenince detay tutuyor: ok=true, mismatches []", d3c.totalsCheck?.ok === true && d3c.totalsCheck.mismatches.length === 0, JSON.stringify(d3c.totalsCheck));
    // Kapıdan geçtiği, sonraki (izin/BLOCK dışı) kapıda durmasıyla ölçülür: BLOCK + needsReview → toplam kapısı ÖNCE değilse 409 TOTAL_MISMATCH olurdu.
    await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: n3 }, data: { needsReview: true } });
    await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL }, create: { key: SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, value: "BLOCK" }, update: { value: "BLOCK" } });

    // §4 satır problems ↔ onay kapılarının lineNos kümesi
    console.log("§4 satır problems ↔ onay kapıları");
    const n4 = await mkNote([Ln(1, 100), Ln(2, 100, { itemId: null }), Ln(3, 100), Ln(4, 100, { itemId: null })]);
    await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: n4, lineNo: { in: [3, 4] } }, data: { needsReview: true } });
    const d4 = await detail(n4);
    const byNo = (code: string) => d4.lines.filter((l) => l.problems?.includes(code)).map((l) => l.lineNo).sort();
    check("§4a problems: 2,4 ürünsüz · 3,4 gözden geçirilmemiş · 1 temiz", same(byNo("ITEM_UNRESOLVED"), [2, 4]) && same(byNo("NEEDS_REVIEW"), [3, 4]) && same(d4.lines.find((l) => l.lineNo === 1)?.problems, []), JSON.stringify(d4.lines.map((l) => [l.lineNo, l.problems])));
    const a4 = await call("POST", `/api/gelen-belge/irsaliyeler/${n4}/onay`, {});
    check("§4b ⭐ onay 400 UNRESOLVED lineNos ≡ ITEM_UNRESOLVED satırları", a4.status === 400 && a4.code === "DELIVERY_NOTE_LINE_UNRESOLVED" && same(a4.details?.lineNos, byNo("ITEM_UNRESOLVED")), `${a4.status} ${a4.code} ${JSON.stringify(a4.details?.lineNos)}`);
    await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: n4 }, data: { itemId: fabric.id } });
    const a4b = await call("POST", `/api/gelen-belge/irsaliyeler/${n4}/onay`, {});
    check("§4c ⭐ BLOCK: 409 REVIEW_PENDING lineNos ≡ NEEDS_REVIEW satırları", a4b.status === 409 && a4b.code === "DELIVERY_NOTE_REVIEW_PENDING" && same(a4b.details?.lineNos, byNo("NEEDS_REVIEW")), `${a4b.status} ${a4b.code} ${JSON.stringify(a4b.details?.lineNos)}`);
    const a3b = await call("POST", `/api/gelen-belge/irsaliyeler/${n3}/onay`, {});
    check("§3f tutan belge toplam kapısını geçer (sonraki kapıda durur: REVIEW_PENDING)", a3b.status === 409 && a3b.code === "DELIVERY_NOTE_REVIEW_PENDING", `${a3b.status} ${a3b.code}`);
    await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: n4, lineNo: 1 }, data: { status: "FAILED", failReason: "test" } });
    const d4b = await detail(n4);
    check("§4d FAILED satır problems'te FAILED taşır", d4b.lines.find((l) => l.lineNo === 1)?.problems?.includes("FAILED") === true);

    section5();
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

function section5(): void {
  console.log("§5 kaynak taraması — tek kaynak");
  const root = path.resolve(__dirname, "..", "..");
  const panelDir = path.join(root, "Electron/src/pages/Operations/GelenBelgeler");
  const files = fs.readdirSync(panelDir).filter((f) => /\.(ts|tsx)$/.test(f));
  const offenders = files.filter((f) => /TOLERANCE|0\.005|totalsDeclared\?*\.blocks/.test(fs.readFileSync(path.join(panelDir, f), "utf8")));
  check("§5a panel toplam hoşgörüsünü/beyan bloğunu kendisi işlemez", files.length > 10 && offenders.length === 0, offenders.join(", "));
  const onay = fs.readFileSync(path.join(root, "Teks-Erp/src/services/gelen-belge-onay.service.ts"), "utf8");
  check("§5b onay servisinde yerel toplam kapısı/hoşgörü kopyası yok", !/TOTAL_TOLERANCE|function totalMismatches|const near\b/.test(onay));
  check("§5c onay ön kontrolü sorun kümelerini lineProblems'ten okur", (onay.match(/lineProblems\(l\)\.includes\("(ITEM_UNRESOLVED|NEEDS_REVIEW)"\)/g) ?? []).length === 2);
}

async function cleanup(): Promise<void> {
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } });
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: made.notes } } });
}

if (!engel) void main();
