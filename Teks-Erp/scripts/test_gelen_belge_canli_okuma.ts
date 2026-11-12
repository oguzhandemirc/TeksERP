// =============================================================================
// BEKÇİ — GELEN BELGE CANLI OKUMA (L1 sunucu): `POST /api/gelen-belge/canli-okuma` kare → belge türü + başlık alanları
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts gelen_belge_canli_okuma   (gerçek DB + HTTP; okuma servisi GEREKMEZ)
// Fikstür SENTETİK: tanıtılmış kullanıcı şablonu (benzersiz başlık) + elle kurulmuş ML Kit kelime listesi; gerçek belge yok.
//   §a ⭐ tanıtılmış şablon → template {code,name,version}, şablonun TÜM alanları; bulunan dolu + kutu = değer kelimelerinin
//      birleşimi (kare çerçevesi), bulunamayan `value:null` + `not-found`
//   §b ⭐ tanınmayan kare → template null, alan yok (GENEL yedek sözlük "tanındı" sayılmaz)
//   §c şema dışı (fazla alan · 4001 kelime · motor adı) → 400 `details.code` LIVE_FRAME_INVALID
//   §d ⭐ YAZMAZ: DocumentScan · CustomerDeliveryNote · SenderTemplate sayısı + hitCount toplamı · SystemLog · RequestTrace değişmez
//   §e modül kapalı → 403 MODULE_DISABLED
//   §g ⭐ biçim kuralına (pattern) uymayan değer → value null + `pattern-mismatch` issues'ta (tablet oylamaz); uyan değer dolu
//   §f süre: 4000 kelimelik kare `engineMs` (ölçüldü 2026-11-05: medyan ~133 ms, M serisi Mac; eşik değil, rapora yazılır)
// ⭐ NEGATİF SONDA (2026-11-05, elle, md5 ile geri alındı): servisteki GENEL filtresi (`t.id !== FALLBACK_TEMPLATE_CODE`)
//    kaldırılınca §b2 düşer; servise şablon isabeti artırımı (`senderTemplate.updateMany … hitCount increment`) eklenince §d düşer; `REQUEST_TRACE_EXCLUSIONS`ten canlı okuma satırı silinince §d düşer (§c'nin 400'leri izlenir, 2026-11-06); kutu `toFrameBox` yerine undefined
//    dönünce §a kutu kontrolü düşer. (2026-11-09) `LIVE_FORMAT_ISSUES` süzgeci etkisizleşince §g1 düşer.
// =============================================================================
import type { AddressInfo } from "net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { flushRequestTraces } from "../src/services/request-trace.service";
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

const TAG = `GBL${Date.now().toString(36).toUpperCase()}`;
const KEYWORD = `CANLI${TAG}`;
type Q = [number, number][];
type Word = { t: string; c: Q; l: number; p: number };
const quad = (x: number, y: number, w: number, h: number): Q => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const anchor = (labels: string[]) => [{ kind: "anchor", labels, direction: "right" }];
const TEMPLATE = {
  identifiers: { keywords: [KEYWORD, "EVRAK NO", "MUSTERI"], minScore: 0.6 },
  fields: [
    { key: "evrakNo", label: "Evrak no", type: "alnum", strategies: anchor(["EVRAK NO"]) },
    { key: "musteri", label: "Müşteri", type: "text", strategies: anchor(["MUSTERI"]) },
    { key: "partiNo", label: "Parti no", type: "alnum", strategies: anchor(["PARTI NO"]) },
    { key: "siparisNo", label: "Sipariş no", type: "text", pattern: "^SP-\\d{3}$", strategies: anchor(["SIPARIS NO"]) },
  ],
};

/** Satır listesi → ML Kit tel biçimi; her satır ayrı `l`, kelime genişliği harf × 18, aralık 20 px. */
function frame(rows: Array<{ x: number; y: number; text: string }>, size = { width: 1000, height: 1400 }) {
  const words: Word[] = [];
  const lines: { c: Q; p: number }[] = [];
  rows.forEach((r, l) => {
    let x = r.x;
    for (const t of r.text.split(" ")) {
      words.push({ t, c: quad(x, r.y, t.length * 18, 30), l, p: 0.95 });
      x += t.length * 18 + 20;
    }
    lines.push({ c: quad(r.x, r.y, x - 20 - r.x, 30), p: 0.95 });
  });
  return { engine: "mlkit", ...size, rotation: 0, ms: 50, words, lines };
}
const KNOWN_ROWS = [
  { x: 40, y: 40, text: KEYWORD },
  { x: 40, y: 120, text: "EVRAK NO" }, { x: 300, y: 120, text: "A12345" },
  { x: 40, y: 200, text: "MUSTERI" }, { x: 300, y: 200, text: "ORNEK TEKSTIL" },
];
const KNOWN = frame(KNOWN_ROWS);
const UNKNOWN = frame([{ x: 40, y: 40, text: "ALAKASIZ BIR KAGIT" }, { x: 40, y: 120, text: "SADECE NOT" }]);
/** Yalnız GENEL yedeğin anahtar sözcüklerini taşıyan kare (Tarih · Metre · Kilo · Top No ≥ 0.3): motor GENEL'e düşerdi. */
const GENERIC = frame([{ x: 40, y: 40, text: "TARIH" }, { x: 300, y: 40, text: "05.11.2026" }, { x: 40, y: 120, text: "TOP NO" }, { x: 300, y: 120, text: "METRE" }, { x: 500, y: 120, text: "KILO" }]);

type Field = { key: string; label: string; value: string | null; needsReview: boolean; issues?: string[]; box?: { x: number; y: number; w: number; h: number } };
type Live = { template: { code: string; name: string; version: number } | null; score: number; fields: Field[]; engineMs: number };
type Resp = { status: number; code?: string; data?: unknown };
const LIVE_ROUTE = "/api/gelen-belge/canli-okuma";

async function snapshot() {
  await new Promise((r) => setTimeout(r, 400)); // audit best-effort, tx dışında
  // Trace kuyruğu ~1 sn'de boşalır: login + şablon kaydının izi "önce" ile "sonra" arasına düşüyordu (CI 28→30).
  // Kuyruk elle boşaltılır, sayım yalnız canlı okuma ucunun izi — ölçülen şey bu uç.
  await flushRequestTraces();
  const [scans, notes, tpls, hits, logs, traces] = await Promise.all([
    prisma.documentScan.count(), prisma.customerDeliveryNote.count(), prisma.senderTemplate.count(),
    prisma.senderTemplate.aggregate({ _sum: { hitCount: true } }), prisma.systemLog.count(),
    prisma.requestTrace.count({ where: { routeKey: LIVE_ROUTE } }),
  ]);
  return { scans, notes, tpls, hits: hits._sum.hitCount ?? 0, logs, traces };
}

async function run(call: (method: string, path: string, body?: unknown) => Promise<Resp>, made: { templates: string[] }): Promise<void> {
  const tpl = await call("POST", "/api/gelen-belge/sablonlar/ozel", { name: `TEST-${TAG} canli`, template: TEMPLATE, clientToken: randomUUID() });
  const code = (tpl.data as { code?: string } | undefined)?.code ?? "";
  const row = await prisma.senderTemplate.findUnique({ where: { code }, select: { id: true } });
  if (row) made.templates.push(row.id);
  check("kullanıcı şablonu kaydedildi (u-…)", tpl.status === 201 && code.startsWith("u-"), `${tpl.status} ${tpl.code ?? ""} ${code}`);

  const live = (body: unknown) => call("POST", "/api/gelen-belge/canli-okuma", body);
  const before = await snapshot();

  console.log("§a tanıtılmış şablon");
  const a = await live(KNOWN);
  const d = a.data as Live | undefined;
  const by = (k: string) => d?.fields.find((f) => f.key === k);
  check("§a1 ⭐ 200, şablon tanındı (kod/ad/sürüm 1)", a.status === 200 && d?.template?.code === code && d.template.name === `TEST-${TAG} canli` && d.template.version === 1, `${a.status} ${a.code ?? ""} ${JSON.stringify(d?.template)}`);
  check("§a2 şablonun TÜM alanları sırasıyla döner", JSON.stringify(d?.fields.map((f) => f.key)) === JSON.stringify(["evrakNo", "musteri", "partiNo", "siparisNo"]), JSON.stringify(d?.fields.map((f) => f.key)));
  check("§a3 ⭐ bulunan alanlar dolu (A12345 · ORNEK TEKSTIL)", by("evrakNo")?.value === "A12345" && by("musteri")?.value === "ORNEK TEKSTIL", `${by("evrakNo")?.value} | ${by("musteri")?.value}`);
  const evBox = by("evrakNo")?.box;
  const muBox = by("musteri")?.box;
  check("§a4 ⭐ kutu = değer kelimelerinin birleşimi, kare çerçevesinde",
    JSON.stringify(evBox) === JSON.stringify({ x: 300, y: 120, w: 108, h: 30 }) && JSON.stringify(muBox) === JSON.stringify({ x: 300, y: 200, w: 236, h: 30 }),
    `${JSON.stringify(evBox)} ${JSON.stringify(muBox)}`);
  const pn = by("partiNo");
  check("§a5 bulunamayan alan value null + not-found, kutusuz", pn !== undefined && pn.value === null && pn.box === undefined && (pn.issues ?? []).includes("not-found"), JSON.stringify(pn));
  check("§a6 engineMs sayı", typeof d?.engineMs === "number" && d.engineMs >= 0, String(d?.engineMs));

  console.log("§b tanınmayan kare");
  const b = await live(UNKNOWN);
  const bd = b.data as Live | undefined;
  check("§b1 tanınmayan kare → 200, template null, alan yok", b.status === 200 && bd?.template === null && bd.fields.length === 0, `${b.status} ${JSON.stringify(bd?.template)} ${bd?.fields.length}`);
  const g = await live(GENERIC);
  const gd = g.data as Live | undefined;
  check("§b2 ⭐ yalnız GENEL sözcükleri → template null (GENEL yedek canlı okumada tanındı sayılmaz)", g.status === 200 && gd?.template === null && gd.fields.length === 0, `${g.status} ${JSON.stringify(gd?.template)} ${gd?.fields.length}`);

  console.log("§c şema dışı");
  const c1 = await live({ ...KNOWN, extra: 1 });
  const c2 = await live({ ...KNOWN, words: Array.from({ length: 4001 }, () => KNOWN.words[0]) });
  const c3 = await live({ ...KNOWN, engine: "paddle" });
  check("§c ⭐ fazla alan · 4001 kelime · motor adı → 400 LIVE_FRAME_INVALID", [c1, c2, c3].every((r) => r.status === 400 && r.code === "LIVE_FRAME_INVALID"), [c1, c2, c3].map((r) => `${r.status}/${r.code ?? ""}`).join(" "));

  console.log("§g biçim kuralı");
  const gBad = await live(frame([...KNOWN_ROWS, { x: 40, y: 280, text: "SIPARIS NO" }, { x: 300, y: 280, text: "TARIHSIZ" }]));
  const gOk = await live(frame([...KNOWN_ROWS, { x: 40, y: 280, text: "SIPARIS NO" }, { x: 300, y: 280, text: "SP-123" }]));
  const sp = (r: Resp) => (r.data as Live | undefined)?.fields.find((f) => f.key === "siparisNo");
  check("§g1 ⭐ pattern'e uymayan değer → value null + pattern-mismatch", gBad.status === 200 && sp(gBad)?.value === null && (sp(gBad)?.issues ?? []).includes("pattern-mismatch") && sp(gBad)?.box === undefined, JSON.stringify(sp(gBad)));
  check("§g2 pattern'e uyan değer dolu", gOk.status === 200 && sp(gOk)?.value === "SP-123", JSON.stringify(sp(gOk)));

  console.log("§d yazmaz");
  const after = await snapshot();
  check("§d ⭐ tarama · taslak · şablon sayısı · hitCount · SystemLog · RequestTrace değişmedi", JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

  console.log("§f süre (4000 kelime)");
  const rows: Array<{ x: number; y: number; text: string }> = [{ x: 40, y: 40, text: KEYWORD }, { x: 40, y: 100, text: "EVRAK NO" }, { x: 600, y: 100, text: "A12345" }];
  const filler = Array.from({ length: 4000 - 4 }, (_, i) => `K${i}`); // başlık satırları 4 kelime; toplam tam 4000 (şema tavanı)
  for (let i = 0; i * 10 < filler.length; i++) rows.push({ x: 40, y: 160 + i * 38, text: filler.slice(i * 10, i * 10 + 10).join(" ") });
  const big = frame(rows, { width: 3000, height: 4000 + rows.length * 38 > 10000 ? 10000 : 4000 + rows.length * 38 });
  const times: number[] = [];
  const wall: number[] = [];
  let bigOk = true;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const r = await live(big);
    wall.push(Math.round(performance.now() - t0));
    const rd = r.data as Live | undefined;
    bigOk &&= r.status === 200 && rd?.template?.code === code;
    times.push(rd?.engineMs ?? -1);
  }
  const med = [...times].sort((x, y) => x - y)[1];
  console.log(`   ⏱ ${big.words.length} kelime · engineMs ${times.join("/")} (medyan ${med}) · HTTP duvar ${wall.join("/")} ms · hedef < ~150 ms ${med! < 150 ? "TUTTU" : "AŞILDI"}`);
  check("§f 4000 kelimelik kare 200 + tanındı (süre ölçümü yukarıda)", big.words.length === 4000 && bigOk, `${big.words.length} kelime`);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge canlı okuma bekçisi ===\n");
  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const made = { templates: [] as string[] };
  const setGb = (v: boolean) => prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.GELEN_BELGE_ENABLED }, create: { key: SETTING_KEYS.GELEN_BELGE_ENABLED, value: v }, update: { value: v } });
  try {
    for (const k of keys) await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: true }, update: { value: true } });
    const lr = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: admin.password, clientType: "electron" }) });
    const tk = ((await lr.json()) as { data?: { token?: string } }).data?.token ?? "";
    check("admin login", tk.length > 0);
    const call = async (method: string, path: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: unknown; details?: { code?: string } };
      return { status: r.status, code: j.details?.code, data: j.data };
    };
    await run(call, made);
    console.log("§e modül kapalı");
    await setGb(false);
    const e = await call("POST", "/api/gelen-belge/canli-okuma", KNOWN);
    await setGb(true);
    check("§e ⭐ gelen belge modülü kapalı → 403 MODULE_DISABLED", e.status === 403 && e.code === "MODULE_DISABLED", `${e.status} ${e.code ?? ""}`);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    stopNotificationJobs();
    await new Promise<void>((r) => server.close(() => r()));
    for (const k of keys) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await prisma.senderTemplateVersion.deleteMany({ where: { templateId: { in: made.templates } } }).catch((e) => check("temizlik", false, String(e)));
    await prisma.senderTemplate.deleteMany({ where: { id: { in: made.templates } } }).catch((e) => check("temizlik", false, String(e)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
