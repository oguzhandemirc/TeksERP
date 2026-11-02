// =============================================================================
// GELEN BELGE — gözden geçirme yüzeyi bekçisi (toplam şeridi + sorunlu satır süzgeci; HTTP, gerçek DB)
// =============================================================================
// Panel şeridi/süzgeci onay kapısının hükmünü OKUR, yeniden hesaplamaz: detay yanıtı `totalsCheck` + satır
// `problems` alanlarını onay ön kontrolüyle AYNI yüklemlerden (`gelen-belge-kontrol.service.ts`) üretir.
//   §1 saf `totalsCheck`: `mismatches` ≡ `totalMismatches` (SKIPPED, %0,5, adet hoşgörüsüz, OCR metni, okunamaz beyan),
//      blok yapısı (beyanlı/beyansız, fark işareti), ok üç değerli; §1h mesaj sayısı Türkçe ("241", "241,5", "1.234,25")
//   §2 saf `lineProblems`: FAILED · ITEM_UNRESOLVED · NEEDS_REVIEW; ENTERED/SKIPPED açık değildir
//   §3 ⭐ HTTP: detay `totalsCheck.ok=false` ↔ onay 409 TOTAL_MISMATCH ve `details.mismatches` bayt-aynı; satır PATCH'i
//      sonrası detay tutuyor (ok=true) ↔ onay toplam kapısından geçer; GET YAZMAZ (updatedAt + audit sayısı sabit)
//   §4 ⭐ HTTP: satır `problems` ↔ onayın 400 UNRESOLVED / 409 REVIEW_PENDING `lineNos` kümesi birebir
//   §5 kaynak taraması: panelde toplam hoşgörüsü/yeniden hesap yok; onay servisinde yerel kapı kopyası yok
//   §6 saf okuma uyarıları (`noteNotices`): kod/bölge ayrıştırma, canlı toplam kodları gizli, tekrar tek, kodsuz → OTHER;
//      `lineProblems` SUSPECT_VALUE yalnız needsReview + `_suspect` işaretiyle
//   §7 HTTP: detay `notices` (ikinci okumada birikse de ikilenmez) + satır SUSPECT_VALUE (ocrRaw yanıta çıkmaz) · ayar `handwritingOutlierFactor` (varsayılan 4,
//      2–20 dışı 400, null temizler) · istemci uyarı METNİ ayrıştırmaz (kaynak taraması)
//   §8 S4 inceleme kapısı `reviewGate` (saf matris) + HTTP: BLOCK_SUSPECT → 409 DELIVERY_NOTE_SUSPECT_PENDING lineNos ≡ detay
//      SUSPECT_VALUE satırları; şüpheli düzeltilince kapı geçer (sonraki kapıda durur); WARN şüpheliyle de geçer; ayar ucu üç değer
//   §9 aynı müşteri partisi (`sameBatch`): aynı sahip + trim'li parti no, iptal ve kendisi hariç; başka sahip/partisiz → null
//   §10 demo 2. tur: varsayılan ürünle girecek satır ITEM_UNRESOLVED DEĞİL (saf + HTTP; `itemFallback` bilgisi; kullanılamaz
//      varsayılan / varsayılansız → sorunlu kalır; müşteri varsayılanı fabrikayı ezer; onay kapısı aynı kümeyle geçer)
//   §11 demo 2. tur: belge geneli başlık beyanı ("Müşteri MT 238" ↔ satır 241), kip `gelenBelge.documentTotalCheck`: INFO (varsayılan)
//      fark uyarı + gerekçesiz onay geçer (gerçek top doğar); REQUIRE_REASON 409 TOTAL_MISMATCH (saf + HTTP + okuma özeti + ayar ucu)
// NEGATİF SONDA (2026-11-02): `lineProblems` SUSPECT_VALUE kapatılınca §6e + §7b; `noteNotices` tekrar süzgeci
//   kapatılınca §6a + §6c + §7a2 (ikinci okuma ikilemesi) düşer. `reviewGate` BLOCK_SUSPECT dalı kapatılınca §8a + §8c;
//   precheck `ocrRaw` seçimi kaldırılınca §8c; `sameBatchNotes` iptal süzgeci kaldırılınca §9a düşer.
//   (demo 2. tur 2026-11-02) `lineProblems` varsayılan dalı kapatılınca §10a–c + §10e; `checkDocument` kapatılınca §11a–d;
//   okuma özetinde belge beyanı sayılmayınca §11d düşer — ÖLÇÜLDÜ, geri alındı. (ayar) `readDocumentTotalCheck` sabit "INFO"
//   dönünce §11f–h; precheck kip okumayı kaldırınca §11f + §11h — ÖLÇÜLDÜ, geri alındı.
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
import { lineItemFallback, lineProblems, reviewGate, totalMismatches, totalsCheck, type ItemFallback, type TotalLine } from "../src/services/gelen-belge-kontrol.service";
import { noteNotices } from "../src/lib/gelen-belge/uyari";
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
type Resp = { status: number; code?: string; details?: Record<string, unknown>; data?: unknown; warnings?: string[] };

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
  // Operatör metni Türkçe sayı: "241.000" (toFixed) "241 bin" okunur → tam sayı sıfırsız, ondalık virgül, binlik nokta
  const msg = (m: number | string, kg: number | null, meters: number[]) => totalMismatches({ totalsDeclared: { blocks: [{ blockNo: 1, m, ...(kg === null ? {} : { kg }) }] } }, meters.map((x) => L(1, x, "PENDING", kg === null ? null : 1)));
  check("§1h ⭐ Türkçe sayı: 241 → \"241\", 241.5 → \"241,5\", 1234.25 → \"1.234,25\" (ondalık virgül, gereksiz sıfır yok)",
    same(msg(200, null, [241]), ["Blok 1: beyan 200 m, satır toplamı 241 m."])
      && same(msg("238", null, [120, 121.5]), ["Blok 1: beyan 238 m, satır toplamı 241,5 m."])
      && same(msg(1000.5, null, [1234.25]), ["Blok 1: beyan 1.000,5 m, satır toplamı 1.234,25 m."])
      && same(msg(1, 2000.75, [1, 1]), ["Blok 1: beyan 1 m, satır toplamı 2 m.", "Blok 1: beyan 2.000,75 kg, satır toplamı 2 kg."])
      && same(msg("abc", null, [10]), ["Blok 1: beyan abc m, satır toplamı 10 m."]),
    JSON.stringify([msg(200, null, [241]), msg("238", null, [120, 121.5]), msg(1000.5, null, [1234.25]), msg(1, 2000.75, [1, 1])]));
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

function section6(): void {
  console.log("§6 saf noteNotices + SUSPECT_VALUE");
  const n = noteNotices([
    "GRID_SUSPECT_VALUES: 1, 4 numaralı hücre(ler)in metresi şüpheli",
    "R2: TABLE_TOTALS_AMBIGUOUS blok 3: 2 toplam satırı, ilki alındı",
    "DECLARED_TOP_COUNT_DIFF blok 1: başlıkta 4 top yazıyor, 5 satır okundu",
    "TOTAL_MISMATCH blok 1: m 500 ≠ 426",
    "GRID_SUSPECT_VALUES: 1, 4 numaralı hücre(ler)in metresi şüpheli",
    "islem: regex derlenemedi (x)",
    "YENI_BIR_KOD: ileride eklenen uyarı",
    42,
  ]);
  check("§6a sıra korunur, tekrar tek, canlı toplam kodları (TOTAL_MISMATCH/DECLARED_TOP_COUNT_DIFF) gizli", same(n.map((x) => x.code), ["GRID_SUSPECT_VALUES", "TABLE_TOTALS_AMBIGUOUS", "OTHER", "YENI_BIR_KOD"]), JSON.stringify(n));
  check("§6b başlık Türkçe, ayrıntı kod sonrası + büyük harf; bölge öneki 'Bölge 2:'", n[0]?.title === "Şüpheli el yazısı değerler" && n[0]?.detail.startsWith("1, 4 numaralı") && n[1]?.detail === "Bölge 2: Blok 3: 2 toplam satırı, ilki alındı", JSON.stringify(n.slice(0, 2)));
  check("§6c kodsuz metin → OTHER + tam metin; tanınmayan kod → genel başlık", n[2]?.detail === "islem: regex derlenemedi (x)" && n[3]?.title === "Okuma uyarısı");
  check("§6d JSON dizisi değilse boş", noteNotices(null).length === 0 && noteNotices({ a: 1 }).length === 0);
  const p = (needsReview: boolean, ocrRaw: unknown) => lineProblems({ status: "PENDING", itemId: "x", needsReview, ocrRaw });
  check("§6e SUSPECT_VALUE yalnız needsReview + `_suspect` metni ile; işaretsiz/gözden geçirilmiş/elle satır temiz",
    same(p(true, { metre: "1370", _suspect: "YUKSEK" }), ["NEEDS_REVIEW", "SUSPECT_VALUE"]) && same(p(false, { _suspect: "YUKSEK" }), []) && same(p(true, { metre: "137" }), ["NEEDS_REVIEW"]) && same(p(true, null), ["NEEDS_REVIEW"]) && same(p(true, ["_suspect"]), ["NEEDS_REVIEW"]));
}

async function section7(call: (method: string, p: string, body?: unknown) => Promise<Resp>, mkNote: (lines: unknown[]) => Promise<string>, fabricId: string): Promise<void> {
  console.log("§7 detay notices + SUSPECT_VALUE + oran ayarı");
  const id = await mkNote([{ senderRollNo: `${TAG}-S1`, meters: 1370, itemText: "x", itemId: fabricId }, { senderRollNo: `${TAG}-S2`, meters: 137, itemText: "x", itemId: fabricId }]);
  await prisma.customerDeliveryNote.update({ where: { id }, data: { warnings: ["GRID_SUSPECT_VALUES: 1 numaralı hücre şüpheli", "SECOND_DOCUMENT_TRACE: bu sayfada ikinci bir belge izi var: Ürün sevk fişi (Sevk No 1) — ayrı fotoğrafla yükleyin", "TOTAL_MISMATCH blok 1: eski"] } });
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: id, lineNo: 1 }, data: { needsReview: true, ocrRaw: { metre: "1370", _suspect: "YUKSEK" } } });
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: id, lineNo: 2 }, data: { needsReview: true, ocrRaw: { metre: "137" } } });
  const d = (await call("GET", `/api/gelen-belge/irsaliyeler/${id}`)).data as { notices?: Array<{ code: string }>; lines: Array<{ lineNo: number; problems: string[] } & Record<string, unknown>> };
  check("§7a ⭐ detay notices ≡ noteNotices(warnings) (canlı toplam kodu gizli)", same(d.notices?.map((x) => x.code), ["GRID_SUSPECT_VALUES", "SECOND_DOCUMENT_TRACE"]), JSON.stringify(d.notices));
  check("§7b satır 1 SUSPECT_VALUE, satır 2 yalnız NEEDS_REVIEW; ocrRaw yanıtta yok", same(d.lines.find((l) => l.lineNo === 1)?.problems, ["NEEDS_REVIEW", "SUSPECT_VALUE"]) && same(d.lines.find((l) => l.lineNo === 2)?.problems, ["NEEDS_REVIEW"]) && d.lines.every((l) => !("ocrRaw" in l)), JSON.stringify(d.lines.map((l) => l.problems)));
  // İkinci okuma (yeniden okuma / aynı sayfa tekrar) okuma işinde `[...önceki, ...yeni]` diye EKLER; şerit ikilenmemeli.
  const w0 = (await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id }, select: { warnings: true } })).warnings as string[];
  await prisma.customerDeliveryNote.update({ where: { id }, data: { warnings: [...w0, ...w0] } });
  const twice = (await call("GET", `/api/gelen-belge/irsaliyeler/${id}`)).data as { notices?: unknown[] };
  const twiceOz = (await call("GET", `/api/gelen-belge/irsaliyeler/${id}/okuma-ozeti`)).data as { notices?: unknown[] };
  check("§7a2 ⭐ ikinci okuma uyarıları ikilemez: warnings iki kez birikse de detay + okuma özeti notices bir kez", JSON.stringify(twice.notices) === JSON.stringify(d.notices) && JSON.stringify(twiceOz.notices) === JSON.stringify(d.notices), JSON.stringify({ twice: twice.notices, oz: twiceOz.notices }));
  const g0 = (await call("GET", "/api/gelen-belge/ayarlar")).data as { handwritingOutlierFactor?: number; defaultHandwritingOutlierFactor?: number };
  check("§7c ayar boşken oran = varsayılan 4", g0.handwritingOutlierFactor === 4 && g0.defaultHandwritingOutlierFactor === 4, JSON.stringify(g0));
  const bad = await Promise.all([1, 25, "5"].map((v) => call("PUT", "/api/gelen-belge/ayarlar", { handwritingOutlierFactor: v })));
  check("§7d aralık dışı / sayı olmayan oran 400 (1, 25, \"5\")", bad.every((r) => r.status === 400), bad.map((r) => `${r.status}`).join(","));
  const okSet = await call("PUT", "/api/gelen-belge/ayarlar", { handwritingOutlierFactor: 6 });
  const raw = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.GELEN_BELGE_OUTLIER_FACTOR }, select: { value: true } });
  check("§7e oran 6 yazılır, geri okunur", okSet.status === 200 && (okSet.data as { handwritingOutlierFactor?: number }).handwritingOutlierFactor === 6 && raw?.value === 6, `${okSet.status} ${JSON.stringify(raw)}`);
  const clr = await call("PUT", "/api/gelen-belge/ayarlar", { handwritingOutlierFactor: null });
  check("§7f null temizler → varsayılan 4", clr.status === 200 && (clr.data as { handwritingOutlierFactor?: number }).handwritingOutlierFactor === 4);
  await prisma.systemSetting.update({ where: { key: SETTING_KEYS.GELEN_BELGE_OUTLIER_FACTOR }, data: { value: "çöp" } });
  check("§7g çöp kayıt varsayılana düşer", ((await call("GET", "/api/gelen-belge/ayarlar")).data as { handwritingOutlierFactor?: number }).handwritingOutlierFactor === 4);
  const raw2 = await call("PUT", `/api/admin/settings/${SETTING_KEYS.GELEN_BELGE_OUTLIER_FACTOR}`, { value: 3 });
  check("§7h ham ayar ucu bu anahtarı yazamaz (400 SETTING_KEY_RESERVED)", raw2.status === 400 && raw2.code === "SETTING_KEY_RESERVED", `${raw2.status} ${raw2.code}`);
  const root = path.resolve(__dirname, "..", "..");
  const clientDirs = ["Electron/src/pages/Operations/GelenBelgeler", "mobil/src/screens/Modules/GelenBelge"].map((d) => path.join(root, d));
  const parsers = clientDirs.flatMap((dir) => fs.readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)).filter((f) => /GRID_SUSPECT_VALUES|SECOND_DOCUMENT_TRACE|note\.warnings|\.warnings\s+as\s+string/.test(fs.readFileSync(path.join(dir, f), "utf8"))).map((f) => f));
  check("§7i istemci (panel + tablet) uyarı metni/kodunu ayrıştırmaz — yalnız `notices`", parsers.length === 0, parsers.join(", "));
}

async function main(): Promise<void> {
  console.log("=== Gelen belge gözden geçirme bekçisi ===\n");
  section1();
  section2();
  section6();
  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_OUTLIER_FACTOR, SETTING_KEYS.GELEN_BELGE_DOCUMENT_TOTAL_CHECK];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED]) await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: true }, update: { value: true } });
    await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_DOCUMENT_TOTAL_CHECK] } } });
    const r0 = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: admin.password, clientType: "electron" }) });
    const tk = ((await r0.json()) as { data?: { token?: string } }).data?.token ?? "";
    check("admin login", tk.length > 0);
    const call = async (method: string, p: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${url}${p}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: unknown; warnings?: string[]; details?: { code?: string } & Record<string, unknown> };
      return { status: r.status, code: j.details?.code, details: j.details, data: j.data, warnings: j.warnings };
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

    await section7(call, (lines) => mkNote(lines), fabric.id);
    await section8(call, mkNote, Ln);
    await section9(call, mkNote, Ln, owner.id);
    await section10(call, mkNote, Ln, owner.id);
    await section11(call, mkNote, Ln);
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

type MkNote = (lines: unknown[], header?: Record<string, unknown>) => Promise<string>;
type MkLine = (n: number, meters: number, extra?: Record<string, unknown>) => Record<string, unknown>;

async function section8(call: (method: string, p: string, body?: unknown) => Promise<Resp>, mkNote: MkNote, mkLine: MkLine): Promise<void> {
  console.log("§8 S4 inceleme kapısı (BLOCK_SUSPECT)");
  const row = (lineNo: number, needsReview: boolean, suspect: boolean) => ({ lineNo, status: "PENDING" as const, itemId: "x", needsReview, ocrRaw: suspect ? { metre: "1370", _suspect: "YUKSEK" } : { metre: "137" } });
  const rows = [row(1, true, true), row(2, true, false), row(3, false, false)];
  const g = (m: "WARN" | "BLOCK_SUSPECT" | "BLOCK", r = rows) => reviewGate(r, m);
  check("§8a saf matris: WARN geçer (uyarı 1,2) · BLOCK_SUSPECT yalnız 1 · BLOCK 1,2 · şüphesiz BLOCK_SUSPECT geçer (uyarı 2)",
    same(g("WARN"), { blocked: [], code: null, warned: [1, 2] }) && same(g("BLOCK_SUSPECT"), { blocked: [1], code: "DELIVERY_NOTE_SUSPECT_PENDING", warned: [] })
      && same(g("BLOCK"), { blocked: [1, 2], code: "DELIVERY_NOTE_REVIEW_PENDING", warned: [] }) && same(g("BLOCK_SUSPECT", [rows[1]!, rows[2]!]), { blocked: [], code: null, warned: [2] }),
    JSON.stringify([g("WARN"), g("BLOCK_SUSPECT"), g("BLOCK")]));
  const put = await call("PUT", "/api/gelen-belge/ayarlar", { unreviewedApproval: "BLOCK_SUSPECT" });
  const badMode = await call("PUT", "/api/gelen-belge/ayarlar", { unreviewedApproval: "SUSPECT" });
  check("§8b ayar BLOCK_SUSPECT yazılır, geri okunur; tanınmayan kip 400", put.status === 200 && (put.data as { unreviewedApproval?: string }).unreviewedApproval === "BLOCK_SUSPECT" && badMode.status === 400, `${put.status} ${badMode.status}`);
  // Toplam beyanı bilerek tutmaz: inceleme kapısını geçen onay bir SONRAKİ kapıda (TOTAL_MISMATCH) durur — top doğmaz.
  const id = await mkNote([mkLine(1, 1370), mkLine(2, 137), mkLine(3, 140)], { totalsDeclared: { blocks: [{ blockNo: 1, m: "1" }] } });
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: id, lineNo: 1 }, data: { needsReview: true, ocrRaw: { metre: "1370", _suspect: "YUKSEK" } } });
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: id, lineNo: 2 }, data: { needsReview: true, ocrRaw: { metre: "137" } } });
  const d = (await call("GET", `/api/gelen-belge/irsaliyeler/${id}`)).data as Detail;
  const suspectNos = d.lines.filter((l) => l.problems?.includes("SUSPECT_VALUE")).map((l) => l.lineNo);
  const a1 = await call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, {});
  check("§8c ⭐ BLOCK_SUSPECT: 409 DELIVERY_NOTE_SUSPECT_PENDING, lineNos ≡ detay SUSPECT_VALUE satırları ([1]); Türkçe metin",
    a1.status === 409 && a1.code === "DELIVERY_NOTE_SUSPECT_PENDING" && same(a1.details?.lineNos, suspectNos) && same(suspectNos, [1]), `${a1.status} ${a1.code} ${JSON.stringify(a1.details?.lineNos)}`);
  const l1 = d.lines.find((l) => l.lineNo === 1)!;
  const fix = await call("PATCH", `/api/gelen-belge/irsaliyeler/${id}/satirlar/${l1.id}`, { meters: 137 });
  const a2 = await call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, {});
  check("§8d şüpheli düzeltilince (satır 2 hâlâ gözden geçirilmemiş) inceleme kapısı geçer → sonraki kapı TOTAL_MISMATCH", fix.status === 200 && a2.status === 409 && a2.code === "TOTAL_MISMATCH", `${fix.status} ${a2.status} ${a2.code}`);
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: id, lineNo: 1 }, data: { needsReview: true, ocrRaw: { metre: "1370", _suspect: "YUKSEK" } } });
  await call("PUT", "/api/gelen-belge/ayarlar", { unreviewedApproval: "WARN" });
  const a3 = await call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, {});
  check("§8e WARN (varsayılan, bugünkü): şüpheli satırla da inceleme kapısı geçer → TOTAL_MISMATCH", a3.status === 409 && a3.code === "TOTAL_MISMATCH", `${a3.status} ${a3.code}`);
  await call("PUT", "/api/gelen-belge/ayarlar", { unreviewedApproval: "BLOCK" });
  const a4 = await call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, {});
  check("§8f BLOCK (bugünkü): gözden geçirilmemiş her satır 409 REVIEW_PENDING [1,2]", a4.status === 409 && a4.code === "DELIVERY_NOTE_REVIEW_PENDING" && same(a4.details?.lineNos, [1, 2]), `${a4.status} ${a4.code} ${JSON.stringify(a4.details?.lineNos)}`);
}

async function section9(call: (method: string, p: string, body?: unknown) => Promise<Resp>, mkNote: MkNote, mkLine: MkLine, ownerId: string): Promise<void> {
  console.log("§9 aynı müşteri partisi (sameBatch)");
  type SB = { batchNo: string; total: number; notes: Array<{ id: string; noteNo: string }> } | null | undefined;
  const sb = async (id: string) => ((await call("GET", `/api/gelen-belge/irsaliyeler/${id}`)).data as { sameBatch?: SB }).sameBatch;
  const batch = `${TAG}-P1`;
  const a = await mkNote([mkLine(91, 10)], { customerBatchNo: batch });
  const b = await mkNote([mkLine(92, 10)], { customerBatchNo: `  ${batch} ` });
  const c = await mkNote([mkLine(93, 10)], { customerBatchNo: batch });
  await prisma.customerDeliveryNote.update({ where: { id: c }, data: { status: "CANCELLED" } });
  const other = await prisma.customer.create({ data: { code: `${TAG}-OWN2`, name: `${TAG} ikinci sahip` }, select: { id: true } });
  made.customers.push(other.id);
  const otherNote = await mkNote([mkLine(94, 10)], { customerBatchNo: batch, ownerCustomerId: other.id });
  const none = await mkNote([mkLine(95, 10)]);
  const sa = await sb(a);
  check("§9a ⭐ aynı sahip + trim'li parti no: 1 başka belge (b); iptal (c), başka sahip ve kendisi sayılmaz", sa?.total === 1 && sa.batchNo === batch && same(sa.notes.map((n) => n.id), [b]), JSON.stringify(sa));
  check("§9b başka sahibin aynı parti no'lu belgesi kendi partisinde yalnız → null; partisiz belge → null", (await sb(otherNote)) === null && (await sb(none)) === null);
  const own = await call("PATCH", `/api/gelen-belge/irsaliyeler/${none}`, { customerBatchNo: batch, ownerCustomerId: ownerId });
  const after = await sb(none);
  check("§9c sahip/parti girilince detay hemen gösterir (a + b)", own.status === 200 && after?.total === 2, `${own.status} ${JSON.stringify(after)}`);
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
  check("§5c onay ön kontrolü sorun kümelerini lineProblems'ten okur, inceleme kapısını `reviewGate`ten", (onay.match(/lineProblems\(l\)\.includes\("(ITEM_UNRESOLVED|NEEDS_REVIEW)"\)/g) ?? []).length === 2 && /reviewGate\(open,/.test(onay) && !/=== "BLOCK"/.test(onay));
  const note = fs.readFileSync(path.join(root, "Teks-Erp/src/services/gelen-belge-note.service.ts"), "utf8");
  check("§5d varsayılan ürün aynası: onay ve detay `lineProblems(l, <varsayılan>)` + `usableDefaultItem`; yerel `!l.itemId` kapısı yok",
    /lineProblems\(l, defaultItem\)\.includes\("ITEM_UNRESOLVED"\)/.test(onay) && /usableDefaultItem\(await resolveEffectiveDefaultItem/.test(note) && /lineProblems\(\{ \.\.\.l, ocrRaw \}, fallback\)/.test(note) && !/!l\.itemId/.test(onay));
}

async function section10(call: (method: string, p: string, body?: unknown) => Promise<Resp>, mkNote: MkNote, mkLine: MkLine, ownerId: string): Promise<void> {
  console.log("§10 varsayılan ürün ↔ ITEM_UNRESOLVED (gözden geçirme onay kapısını aynalar)");
  const fb: ItemFallback = { id: "x", name: "MK", source: "FACTORY" };
  const p = (status: "PENDING" | "FAILED" | "ENTERED", itemId: string | null) => ({ status, itemId, needsReview: false });
  check("§10a saf: ürünsüz açık satır + kullanılabilir varsayılan → [] ve itemFallback; varsayılansız ITEM_UNRESOLVED; FAILED yalnız FAILED; girilmiş satıra fallback yok",
    same(lineProblems(p("PENDING", null), fb), []) && lineItemFallback(p("PENDING", null), fb) === fb && same(lineProblems(p("PENDING", null), null), ["ITEM_UNRESOLVED"])
      && same(lineProblems(p("FAILED", null), fb), ["FAILED"]) && lineItemFallback(p("ENTERED", null), fb) === null && lineItemFallback(p("PENDING", "i"), fb) === null);
  const svc = await prisma.item.create({ data: { code: `${TAG}-HIZ`, name: `${TAG} kurşun hizmeti`, itemType: "SERVICE", unit: "MT" }, select: { id: true } });
  made.items.push(svc.id);
  const mk = await prisma.item.create({ data: { code: `${TAG}-MK`, name: `${TAG} MÜŞTERİ KUMAŞI`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  made.items.push(mk.id);
  const setFactory = (v: string | null) => v === null
    ? prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID } })
    : prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID }, create: { key: SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, value: v }, update: { value: v } });
  type FL = DLine & { itemFallback?: { id: string; name: string; source: string } | null };
  const get = async (id: string) => ((await call("GET", `/api/gelen-belge/irsaliyeler/${id}`)).data as { lines: FL[] }).lines.sort((a, b) => a.lineNo - b.lineNo);
  const id = await mkNote([mkLine(1, 100, { itemId: null }), mkLine(2, 100, { itemId: null }), mkLine(3, 100)], { totalsDeclared: { blocks: [{ blockNo: 1, m: "1" }] } });
  await setFactory(mk.id);
  const d1 = await get(id);
  check("§10b ⭐ fabrika varsayılanı: ürünsüz 1,2 sorunsuz + itemFallback (FACTORY, ad); ürünlü 3'te fallback yok",
    d1.every((l) => same(l.problems, [])) && d1[0]?.itemFallback?.id === mk.id && d1[0]?.itemFallback?.source === "FACTORY" && d1[0]?.itemFallback?.name === `${TAG} MÜŞTERİ KUMAŞI` && d1[2]?.itemFallback === null,
    JSON.stringify(d1.map((l) => [l.lineNo, l.problems, l.itemFallback?.source ?? null])));
  const a1 = await call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, {});
  check("§10c ⭐ onay ürün kapısını AYNI kümeyle geçer (sonraki kapı TOTAL_MISMATCH; top doğmaz)", a1.status === 409 && a1.code === "TOTAL_MISMATCH", `${a1.status} ${a1.code}`);
  await setFactory(svc.id);
  const d2 = await get(id);
  const a2 = await call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, {});
  check("§10d kullanılamaz fabrika varsayılanı: satır yine ITEM_UNRESOLVED, fallback yok ↔ onay 409 DEFAULT_ITEM_UNUSABLE",
    same(d2.filter((l) => l.problems?.includes("ITEM_UNRESOLVED")).map((l) => l.lineNo), [1, 2]) && d2.every((l) => !l.itemFallback) && a2.status === 409 && a2.code === "GELEN_BELGE_DEFAULT_ITEM_UNUSABLE",
    `${a2.status} ${a2.code} ${JSON.stringify(d2.map((l) => l.problems))}`);
  await prisma.deliveryNoteCustomerDefault.create({ data: { customerId: ownerId, defaultItemId: mk.id } });
  const d3 = await get(id);
  check("§10e müşteri varsayılanı fabrikayı ezer: sorunsuz + itemFallback CUSTOMER", d3[0]?.itemFallback?.source === "CUSTOMER" && same(d3[0]?.problems, []), JSON.stringify([d3[0]?.problems, d3[0]?.itemFallback?.source]));
  await prisma.deliveryNoteCustomerDefault.deleteMany({ where: { customerId: ownerId } });
  await setFactory(null);
  const d4 = await get(id);
  const a4 = await call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, {});
  check("§10f varsayılansız (bugünkü): ITEM_UNRESOLVED [1,2] ≡ onay 400 lineNos", same(d4.filter((l) => l.problems?.includes("ITEM_UNRESOLVED")).map((l) => l.lineNo), [1, 2]) && a4.status === 400 && same(a4.details?.lineNos, [1, 2]), `${a4.status} ${JSON.stringify(a4.details?.lineNos)}`);
}

async function section11(call: (method: string, p: string, body?: unknown) => Promise<Resp>, mkNote: MkNote, mkLine: MkLine): Promise<void> {
  console.log("§11 belge geneli beyan (Müşteri MT) ↔ toplam kapısı — fabrika ayarı documentTotalCheck");
  const doc = (m: string) => ({ blocks: [{ blockNo: 1, m: "241", kg: "734" }], document: { count: null, m, kg: null, labels: { m: "Müşteri MT" } } });
  const lines = [L(1, 241, "PENDING", 734)];
  const MSG = "Belge geneli (Müşteri MT): beyan 238 m, satır toplamı 241 m.";
  const t = totalsCheck({ totalsDeclared: doc("238"), declaredTopCount: null }, lines, { documentMode: "REQUIRE_REASON" });
  check("§11a ⭐ saf REQUIRE_REASON: 238 ↔ 241 → ok=false, blok 1 tutuyor, belge farkı +3, blocking, mesaj etiketli; totalMismatches ≡",
    t.ok === false && t.blocks[0]?.ok === true && t.document?.diffs[0]?.diff === 3 && t.document.blocking === true && same(t.mismatches, [MSG])
      && same(t.mismatches, totalMismatches({ totalsDeclared: doc("238") }, lines, { documentMode: "REQUIRE_REASON" })), JSON.stringify(t));
  const info = totalsCheck({ totalsDeclared: doc("238"), declaredTopCount: null }, lines);
  check("§11a2 ⭐ saf INFO (varsayılan): fark uyarıda, mismatches boş, ok=true (kapı geçer), document.ok=false + blocking=false",
    info.ok === true && same(info.mismatches, []) && same(info.warnings, [MSG]) && info.document?.ok === false && info.document.blocking === false && same(totalMismatches({ totalsDeclared: doc("238") }, lines), []), JSON.stringify(info));
  const onlyDoc = totalsCheck({ totalsDeclared: { document: doc("238").document }, declaredTopCount: null }, lines);
  check("§11a3 INFO yalnız belge beyanı: ok=true (beyan var, geçer; null 'beyan yok' DEĞİL)", onlyDoc.ok === true && same(onlyDoc.warnings, [MSG]), JSON.stringify(onlyDoc));
  const ok = totalsCheck({ totalsDeclared: doc("240"), declaredTopCount: null }, lines, { documentMode: "REQUIRE_REASON" });
  const none = totalsCheck({ totalsDeclared: { blocks: [] }, declaredTopCount: null }, lines);
  check("§11b %0,5 içinde (240 ↔ 241) geçer; beyansız belge document=null (bugünkü)", ok.ok === true && ok.document?.ok === true && none.document === null && none.ok === null);
  await section11Settings(call);
  type DocTC = TC & { warnings?: string[]; document?: { ok: boolean | null; blocking?: boolean } | null };
  type Oz = { totals?: { declared: boolean; ok: boolean | null; mismatches: string[] }; warnings?: string[] };
  const id = await mkNote([mkLine(1, 241, { weightKg: 734 })], { totalsDeclared: { document: { count: null, m: "238", kg: null, labels: { m: "Müşteri MT" } } } });
  const detail = async () => ((await call("GET", `/api/gelen-belge/irsaliyeler/${id}`)).data as { totalsCheck?: DocTC }).totalsCheck;
  const ozet = async () => (await call("GET", `/api/gelen-belge/irsaliyeler/${id}/okuma-ozeti`)).data as Oz;
  const di = await detail();
  const oi = await ozet();
  check("§11c ⭐ HTTP INFO (ayar yok): detay document.ok=false blocking=false, şerit ok=true, mismatches boş, uyarıda fark",
    di?.document?.ok === false && di.document.blocking === false && di.ok === true && same(di.mismatches, []) && same(di.warnings, [MSG]), JSON.stringify(di));
  check("§11d INFO tablet okuma özeti: beyan var, ok=true, fark uyarıda", oi?.totals?.declared === true && oi.totals.ok === true && same(oi.totals.mismatches, []) && same(oi.warnings, [MSG]), JSON.stringify(oi));
  check("§11e ayar REQUIRE_REASON yazılır", (await call("PUT", "/api/gelen-belge/ayarlar", { documentTotalCheck: "REQUIRE_REASON" })).status === 200);
  const dr = await detail();
  const a = await call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, {});
  check("§11f ⭐ HTTP REQUIRE_REASON: detay document blocking ↔ onay 409 TOTAL_MISMATCH, mismatches bayt-aynı", dr?.document?.ok === false && dr.document.blocking === true && dr.ok === false && a.status === 409 && a.code === "TOTAL_MISMATCH" && same(a.details?.mismatches, dr.mismatches) && same(dr.mismatches, [MSG]), `${a.status} ${a.code} ${JSON.stringify(a.details?.mismatches)}`);
  const or = await ozet();
  check("§11g REQUIRE_REASON tablet okuma özeti: ok=false, fark mismatches'te", or?.totals?.declared === true && or.totals.ok === false && same(or.totals.mismatches, [MSG]), JSON.stringify(or?.totals));
  await call("PUT", "/api/gelen-belge/ayarlar", { documentTotalCheck: "INFO" });
  const ai = await call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, {});
  check("§11h ⭐ HTTP INFO: gerekçesiz onay GEÇER (200), fark onay uyarısında", ai.status === 200 && (ai.warnings ?? []).includes(MSG), `${ai.status} ${ai.code} ${JSON.stringify(ai.warnings)}`);
}

/** Ayar ucu: varsayılan INFO; çöp 400; ham uç SETTING_KEY_RESERVED; çöp DB kaydı INFO'ya düşer. */
async function section11Settings(call: (method: string, p: string, body?: unknown) => Promise<Resp>): Promise<void> {
  const g = (await call("GET", "/api/gelen-belge/ayarlar")).data as { documentTotalCheck?: string; defaultDocumentTotalCheck?: string };
  check("§11i ayar yokken documentTotalCheck = varsayılan INFO", g.documentTotalCheck === "INFO" && g.defaultDocumentTotalCheck === "INFO", JSON.stringify(g));
  const bad = await call("PUT", "/api/gelen-belge/ayarlar", { documentTotalCheck: "BLOCK" });
  const raw = await call("PUT", `/api/admin/settings/${SETTING_KEYS.GELEN_BELGE_DOCUMENT_TOTAL_CHECK}`, { value: "REQUIRE_REASON" });
  check("§11j geçersiz seçenek 400; ham ayar ucu yazamaz (400 SETTING_KEY_RESERVED)", bad.status === 400 && raw.status === 400 && raw.code === "SETTING_KEY_RESERVED", `${bad.status} ${raw.status} ${raw.code}`);
  const key = SETTING_KEYS.GELEN_BELGE_DOCUMENT_TOTAL_CHECK;
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: "çöp" }, update: { value: "çöp" } });
  check("§11k çöp kayıt INFO'ya düşer", ((await call("GET", "/api/gelen-belge/ayarlar")).data as { documentTotalCheck?: string }).documentTotalCheck === "INFO");
  await prisma.systemSetting.deleteMany({ where: { key } });
}

async function cleanup(): Promise<void> {
  // §11h onayı gerçek top doğurur — `test_gelen_belge_onay.ts` temizlik deseni.
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((x) => x.rollId!);
  await prisma.documentScan.updateMany({ where: { noteId: { in: made.notes } }, data: { noteId: null } });
  await prisma.deliveryNoteCustomerDefault.deleteMany({ where: { OR: [{ customerId: { in: made.customers } }, { defaultItemId: { in: made.items } }] } });
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
