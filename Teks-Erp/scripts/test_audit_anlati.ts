// =============================================================================
// BEKÇİ — audit ANLATICI: satır → Türkçe cümle, tek "Kaydet" = tek iş eylemi (izlenebilirlik B2)
// Çalıştır: npx tsx scripts/run-all-tests.ts audit_anlati
// =============================================================================
// Kural (docs/kurallar/defter.md, audit): cümle OKUMA ANINDA backend anlatıcısında kurulur,
// hiçbir yere yazılmaz; sır alanının değeri cümleye girmez; hiçbir satır yalnız UUID kalmaz.
//   §1 altın cümleler (şablon başına) · §2 yer tutucu ↔ satır alanı (her şablon)
//   §3 yedek: rastgele 20 tablo, numara görünür, UUID-yalnız yok · §4 sır sondası
//   §5 kapsama cırcırı (kodda yazılan tablo:olay/işlem çifti ↔ şablon; artış sert, çürüme kolu)
//   §6 performans (1.000 satır) · §7 Electron sözlük aynası bayt-eşit
//   §8 DB: q çözümü (SP/CV/CL/barkod) + kardeşler · işlem gruplaması eski/yeni dönem aynı ·
//      409 trace "çalıştı — reddedildi" · findIslem uç/süre/cihaz/kayıtlar ·
//      §8l "Reddedilenler" süzgeci (reddedilen=1) yalnız status ≥ 400 döndürür (SUNUCUDA)
//   §9 kapsama-uç cırcırı (B4): route envanteri mutasyon uçları ↔ route-eylem-katalogu anahtarları;
//      eksik artışı sert, çürüme kolu, katalogda olup route'ta olmayan (ölü) anahtar sert
// NEGATİF SONDA (2026-10-25, izole ağaç, md5 ile geri yüklendi; tam koşum 42/0):
//   P1 anlatıcıdan numara çözümü kaldırıldı (hep kısa kimlik) → 11 ❌ (§1 ×7, §2, §3, §8a, §8f)
//   P2 sır yüklemi devre dışı → 2 ❌ (§4)
//   P3 cırcır artış: src'ye şablonsuz `SONDA_TABLO:UPDATE` audit çağrısı → 1 ❌ (§5 155 > 154)
//   P4 cırcır çürüme: iki şablonsuz çifte şablon → 1 ❌ (§5 153 < 154; commit kapısında ⏭)
//   P5 (2026-10-25) canlı referans kodları ERROR_CODE_REASONS'tan çıkarıldı → 2 ❌ (§1 ⭐ 409 …LIVE_REFERENCES)
// B4 (2026-10-26, izole ağaç, md5 geri; tam koşum 52/0):
//   P6 katalogdan "DELETE /api/orders/:id" silindi → 1 ❌ (§9 artış 618 > 617)
//   P7 eksik "POST /api/auth/logout" kataloğa eklendi → 1 ❌ (§9 çürüme 616 < 617; commit kapısında ⏭)
//   P8 kataloğa route'suz anahtar → 1 ❌ (§9 ölü anahtar) · P9 servis reddedilen dalı kaldırıldı → 1 ❌ (§8l)
// =============================================================================
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { atlamaDefteri } from "./lib/atlama";
import { curumeKolu } from "./lib/circir-kolu";
import { narrateRow, type NarrativeRow, type Cozulmus } from "../src/services/audit-narrative";
import { SABLONLAR } from "../src/services/audit-narrative/sablonlar";
import { TABLE_LABELS } from "../src/constants/audit-tablo-etiketleri";
import { recordKey } from "../src/services/helpers/audit-record-resolver.helper";
import { redNedeni } from "../src/constants/route-eylem-katalogu";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

/** Kodda şablonsuz kalan (tablo, olay|işlem) çifti sayısı — yalnız DÜŞER (çürüme kolu). */
const ANLATI_KAPSAMA_TABANI = 154;
/** Mutasyon ucu olup ROUTE_EYLEM_KATALOGU'nda cümlesi olmayan uç sayısı (B4, 2026-10-26) — yalnız DÜŞER. */
const UC_KATALOG_TABANI = 617;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const AHMET = { fullName: "Ahmet Yılmaz", username: "ahmet" };
const BOS: Cozulmus = { numaralar: new Map(), degerler: new Map() };

function satir(p: Partial<NarrativeRow> & Pick<NarrativeRow, "tableName" | "action">): NarrativeRow {
  return { id: randomUUID(), recordId: randomUUID(), user: AHMET, changes: null, event: null, ...p };
}
function numarali(s: NarrativeRow, no: string): Cozulmus {
  return { numaralar: new Map([[recordKey(s.tableName, s.recordId), no]]), degerler: new Map() };
}

// ── §1 altın cümleler ─────────────────────────────────────────────────────────
function altin(): void {
  console.log("\n=== §1 Altın cümleler ===");
  const durumlar: Array<[string, NarrativeRow, string]> = [];
  const o = satir({ tableName: "ORDER", action: "UPDATE", changes: [{ field: "dueDate", old: "2026-10-18T00:00:00.000Z", new: "2026-10-25T00:00:00.000Z" }] });
  durumlar.push(["SP-2026-0148", o, "Ahmet Y., SP-2026-0148 siparişinin Termin alanını 18.10.2026 → 25.10.2026 yaptı"]);
  durumlar.push(["T-1001", satir({ tableName: "ROLL", action: "CREATE" }), "Ahmet Y., T-1001 topunu oluşturdu"]);
  durumlar.push(["SV-7", satir({ tableName: "SHIPMENT", action: "DELETE" }), "Ahmet Y., SV-7 sevkiyatını sildi"]);
  durumlar.push(["TIE-12", satir({ tableName: "WORK_ORDER", action: "UPDATE", event: "SPLIT_SOURCE" }), "Ahmet Y., TIE-12 terbiye iş emrini böldü"]);
  durumlar.push(["ÇK-3", satir({ tableName: "CHEQUE", action: "UPDATE", event: "COLLECT" }), "Ahmet Y., ÇK-3 çekini tahsil etti"]);
  durumlar.push(["CV1207260001", satir({ tableName: "SACK", action: "UPDATE", changes: [{ field: "status", old: "OPEN", new: "CLOSED" }, { field: "notes", old: "a", new: "b" }] }),
    "Ahmet Y., CV1207260001 çuvalında 2 alanı değiştirdi: Durum, Not"]);
  durumlar.push(["T-9", satir({ tableName: "ROLL", action: "UPDATE", event: "UYDURMA_OLAY" }), "Ahmet Y., T-9 topunu düzenledi (olay: UYDURMA_OLAY)"]);
  for (const [no, s, beklenen] of durumlar) {
    const a = narrateRow(s, numarali(s, no));
    check(`§1 ${s.tableName}:${s.event ?? s.action}`, a.metin === beklenen, a.metin);
  }
  const sis = narrateRow(satir({ tableName: "AUTH", action: "LOGIN_SUCCESS", recordId: "" }), BOS);
  check("§1 sistem olayı: \"kişi: olay\"", sis.metin.startsWith("Ahmet Y.: ") && !sis.metin.includes("LOGIN_SUCCESS"), sis.metin);
  const sistem = narrateRow(satir({ tableName: "ROLL", action: "CREATE", user: null }), BOS);
  check("§1 kullanıcısız satır \"Sistem\" der", sistem.metin.startsWith("Sistem, "), sistem.metin);
  // Canlı referans reddi 409'dur ama "başka biri değiştirmiş" DEĞİLDİR (B3 bulgusu).
  for (const kod of ["MASTER_DATA_HAS_LIVE_REFERENCES", "ITEM_HAS_LIVE_REFERENCES"]) {
    const n = redNedeni(409, kod);
    check(`§1 ⭐ 409 ${kod} → "canlı referansı olduğu için pasife alınamadı"`, n === "canlı referansı olduğu için pasife alınamadı", n);
  }
}

// ── §2 her şablon: yer tutucu ↔ satır alanı ───────────────────────────────────
function yerTutucu(): void {
  console.log("\n=== §2 Her şablon: parçalar dolu, metin = parçalar ===");
  const bozuk: string[] = [];
  for (const anahtar of Object.keys(SABLONLAR)) {
    const [tableName, ek] = anahtar.split(":") as [string, string];
    const cud = ["CREATE", "UPDATE", "DELETE"].includes(ek);
    for (const changes of [null, [{ field: "status", old: "OPEN", new: "CLOSED" }]]) {
      const s = satir({ tableName, action: cud ? ek : "UPDATE", event: cud ? null : ek, changes });
      const a = narrateRow(s, numarali(s, "NO-42"));
      const sorun = /undefined|null|\[object|\$\{|NaN/.test(a.metin) || a.metin !== a.parcalar.map((p) => p.text).join("")
        || !a.parcalar.some((p) => p.t === "kisi") || (tableName !== "LABEL_PRINT_EVENT" && !a.metin.includes("NO-42")) || UUID_RE.test(a.metin);
      if (sorun) bozuk.push(`${anahtar} → "${a.metin}"`);
    }
  }
  check(`§2 ⭐ ${Object.keys(SABLONLAR).length} şablonun hepsi temiz cümle kurar (kişi + numara, UUID/undefined yok)`, bozuk.length === 0, bozuk.slice(0, 4).join(" | "));
  check("§2 körlük zemini: ≥ 30 şablon", Object.keys(SABLONLAR).length >= 30, `${Object.keys(SABLONLAR).length}`);
}

// ── §3 yedek ──────────────────────────────────────────────────────────────────
function yedek(): void {
  console.log("\n=== §3 Yedek cümle (şablonsuz tablolar) ===");
  const sablonsuz = Object.keys(TABLE_LABELS).filter((t) => !Object.keys(SABLONLAR).some((k) => k.startsWith(`${t}:`)));
  const secim = [...sablonsuz].sort(() => Math.random() - 0.5).slice(0, 20);
  const sorunlu: string[] = [];
  for (const t of secim) {
    for (const action of ["CREATE", "UPDATE", "DELETE"]) {
      const s = satir({ tableName: t, action, changes: action === "UPDATE" ? [{ field: "notes", old: "a", new: "b" }] : null });
      const cipla = narrateRow(s, BOS).metin;
      const no = narrateRow(s, numarali(s, "YD-77")).metin;
      if (UUID_RE.test(cipla) || !cipla.includes(TABLE_LABELS[t]!) || cipla.replace(/#[0-9a-f]{8}/, "").trim().length < 12) sorunlu.push(`${t}: ${cipla}`);
      if (!no.includes("YD-77")) sorunlu.push(`${t} numara görünmüyor: ${no}`);
    }
  }
  check(`§3 ⭐ rastgele ${secim.length} tablo: modül adı + kısa kimlik/numara, UUID-yalnız satır yok`, secim.length >= 20 && sorunlu.length === 0, sorunlu.slice(0, 3).join(" | "));
  const tek = satir({ tableName: "ROLL_RETURN", action: "UPDATE", event: "RETURN", changes: [{ field: "notes", old: "a", new: "b" }] });
  const m = narrateRow(tek, BOS).metin;
  check("§3 yedek: olay + tek alan farkı", m.includes("(olay: ") && m.includes("Not: a → b"), m);
}

// ── §4 sır sondası ────────────────────────────────────────────────────────────
function sir(): void {
  console.log("\n=== §4 Sır alanı anlatıya girmez ===");
  const gizli = `gizli-${randomUUID().slice(0, 6)}`;
  const alanlar = ["password", "passwordHash", "pin", "quickPin", "totpSecret", "token", "settingsPassword", "cardTokenHash"];
  const sizan: string[] = [];
  for (const f of alanlar) {
    for (const tableName of ["users", "USER_QUICK_PIN"]) {
      const s = satir({ tableName, action: "UPDATE", changes: [{ field: f, old: `${gizli}-o`, new: `${gizli}-n` }] });
      const a = narrateRow(s, BOS);
      if (a.metin.includes(gizli)) sizan.push(`${tableName}.${f}: ${a.metin}`);
    }
  }
  const karisik = narrateRow(satir({ tableName: "users", action: "UPDATE", changes: [{ field: "fullName", old: "A", new: "B" }, { field: "password", old: gizli, new: gizli }] }), BOS);
  if (karisik.metin.includes(gizli)) sizan.push(karisik.metin);
  check("§4 ⭐ parola/PIN/TOTP/token değeri hiçbir cümlede yok", sizan.length === 0, sizan.slice(0, 2).join(" | "));
  const tek = narrateRow(satir({ tableName: "users", action: "UPDATE", changes: [{ field: "passwordHash", old: gizli, new: gizli }] }), BOS);
  check("§4 sır alanı yine de ADIYLA anılır (değersiz)", tek.metin.includes("Parola alanını değiştirdi"), tek.metin);
}

// ── §5 kapsama cırcırı ────────────────────────────────────────────────────────
/** src'deki AuditService.log/logMany çağrılarından (tablo, olay|işlem) çiftleri — literal + dosya sabiti. */
export function kodCiftleri(kaynaklar: ReadonlyArray<{ dosya: string; metin: string }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const { metin } of kaynaklar) {
    const sabit = new Map([...metin.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*"([A-Za-z_]+)"/g)].map((m) => [m[1]!, m[2]!]));
    for (const m of metin.matchAll(/AuditService\.log(?:Many)?\(/g)) {
      let w = metin.slice(m.index!, m.index! + 1500);
      const n = w.indexOf("AuditService.", 10);
      if (n > 0) w = w.slice(0, n);
      const t = /tableName:\s*(?:"([A-Za-z_]+)"|([A-Z][A-Z0-9_]*)\b)/.exec(w);
      const tablo = t ? (t[1] ?? sabit.get(t[2]!)) : undefined;
      const islem = /action:\s*"(CREATE|UPDATE|DELETE)"/.exec(w)?.[1];
      if (!tablo || !islem) continue;
      const olaylar = [...w.matchAll(/event:\s*"([A-Z][A-Z0-9_]*)"/g)].map((x) => x[1]!);
      for (const k of olaylar.length ? olaylar.map((e) => `${tablo}:${e}`) : [`${tablo}:${islem}`]) out.set(k, (out.get(k) ?? 0) + 1);
    }
  }
  return out;
}
function kapsanan(anahtar: string): boolean {
  return anahtar in SABLONLAR;
}
function kapsama(): void {
  console.log("\n=== §5 Kapsama cırcırı ===");
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []);
  const kaynak = walk(path.join(__dirname, "../src")).map((dosya) => ({ dosya, metin: fs.readFileSync(dosya, "utf8") }));
  const ciftler = kodCiftleri(kaynak);
  check("§5 körlük zemini: kodda ≥ 150 çift bulundu", ciftler.size >= 150, `${ciftler.size} çift`);
  const sik = [...ciftler.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 30);
  const sikEksik = sik.filter(([k]) => !kapsanan(k)).map(([k]) => k);
  check("§5 ⭐ en sık 30 çiftin HEPSİ şablonlu", sikEksik.length === 0, sikEksik.join(", ") || sik.map(([k]) => k).slice(0, 6).join(", ") + " …");
  const eksik = [...ciftler.keys()].filter((k) => !kapsanan(k)).sort();
  const oran = Math.round((100 * (ciftler.size - eksik.length)) / Math.max(1, ciftler.size));
  console.log(`   kapsama: ${ciftler.size - eksik.length}/${ciftler.size} (%${oran}) · şablonsuz ${eksik.length} (yedek cümleye düşer)`);
  // Taban ŞABLONSUZ çift sayısıdır: artış (yeni şablonsuz çift) sert; düşüş tabanı indirmeyi ister.
  check("§5 ⭐ ARTIŞ yok — yeni audit çifti şablonsuz eklenmedi (sablonlar.ts'e ekle)", eksik.length <= ANLATI_KAPSAMA_TABANI,
    `gerçek ${eksik.length} · taban ${ANLATI_KAPSAMA_TABANI}`);
  curumeKolu(check, ATLAMA.atla, "§5 taban ÇÜRÜMEDİ (kapanan çift tabandan düştü)", eksik.length, ANLATI_KAPSAMA_TABANI);
  const sonda = kodCiftleri([{ dosya: "x.ts", metin: 'const TABLE = "ROLL"; AuditService.log({ tableName: TABLE, action: "UPDATE", newData: { event: "SONDA_OLAY" } }); AuditService.log({ tableName: "ORDER", action: "CREATE" })' }]);
  check("§5 sonda: sabit tablo adı + olay + düz işlem okunur", sonda.get("ROLL:SONDA_OLAY") === 1 && sonda.get("ORDER:CREATE") === 1, [...sonda.keys()].join(","));
}

// ── §9 kapsama-uç: uç → eylem kataloğu ────────────────────────────────────────
// Envanter TEK KAYNAK `scripts/lib/rota-envanteri` (kopya yürüyücü yok); anahtar trace'in
// `resolveTraceRouteKey`i gibi kurulur: "/" route'u sondaki eğik çizgiyi taşımaz.
async function kapsamaUc(): Promise<void> {
  console.log("\n=== §9 Kapsama-uç cırcırı (uç → eylem kataloğu) ===");
  const { default: app } = await import("../src/app");
  const { rotaEnvanteri } = await import("./lib/rota-envanteri");
  const { normalizeKeyPath } = await import("../src/middlewares/latency.middleware");
  const { isRequestTraceExcluded } = await import("../src/constants/request-trace-haric");
  const { ROUTE_EYLEM_KATALOGU, ucAnahtari } = await import("../src/constants/route-eylem-katalogu");
  const { routes, cozulemeyen } = rotaEnvanteri(app);
  const MUTASYON = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  const uclar = new Set<string>();
  for (const r of routes) {
    const key = normalizeKeyPath(r.path.replace(/\/+$/, "")) || "/";
    for (const m of r.methods) if (MUTASYON.has(m) && !isRequestTraceExcluded(m, key)) uclar.add(ucAnahtari(m, key));
  }
  check("§9 körlük zemini: envanter tam (çözülemeyen mount 0, ≥ 400 mutasyon ucu)", cozulemeyen === 0 && uclar.size >= 400, `${uclar.size} uç · çözülemeyen ${cozulemeyen}`);
  const katalog = Object.keys(ROUTE_EYLEM_KATALOGU);
  const olu = katalog.filter((k) => !uclar.has(k));
  check("§9 ⭐ katalogda ölü anahtar yok (her anahtar gerçek bir mutasyon ucu)", olu.length === 0, olu.join(", ") || `${katalog.length} anahtar`);
  const eksik = [...uclar].filter((k) => !(k in ROUTE_EYLEM_KATALOGU)).length;
  console.log(`   kapsama: ${uclar.size - eksik}/${uclar.size} uç cümleli · eksik ${eksik} (kök kaydın anlatısına düşer)`);
  check("§9 ⭐ ARTIŞ yok — eksik uç tabanı aşmadı (yeni uç için route-eylem-katalogu'na satır ekle)", eksik <= UC_KATALOG_TABANI, `gerçek ${eksik} · taban ${UC_KATALOG_TABANI}`);
  curumeKolu(check, ATLAMA.atla, "§9 taban ÇÜRÜMEDİ (kataloğa eklenen uç tabandan düştü)", eksik, UC_KATALOG_TABANI);
}

// ── §6 performans ─────────────────────────────────────────────────────────────
function performans(): void {
  console.log("\n=== §6 Performans ===");
  const tablolar = ["ORDER", "ROLL", "SACK", "SHIPMENT", "WORK_ORDER", "ROLL_RETURN", "devices"];
  const rows = Array.from({ length: 1000 }, (_, i) => satir({ tableName: tablolar[i % tablolar.length]!, action: "UPDATE", changes: [{ field: "status", old: "OPEN", new: "CLOSED" }] }));
  for (const r of rows.slice(0, 50)) narrateRow(r, BOS);
  const t0 = performance.now();
  for (const r of rows) narrateRow(r, BOS);
  const ms = performance.now() - t0;
  check("§6 ⭐ 1.000 satır anlatı < 200 ms (saf şablon)", ms < 200, `${ms.toFixed(1)} ms`);
}

// ── §7 Electron sözlük aynası ─────────────────────────────────────────────────
function ayna(): void {
  console.log("\n=== §7 Electron sözlük aynası ===");
  for (const ad of ["audit-tablo-etiketleri.ts", "audit-enum-etiketleri.ts", "audit-enum-etiketleri-ek.ts", "audit-enum-paylasim.ts"]) {
    const oz = (f: string) => (fs.existsSync(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") : "yok");
    const k = oz(path.join(__dirname, "../src/constants", ad));
    const a = oz(path.join(__dirname, "../../Electron/src/lib", ad));
    check(`§7 ${ad} bayt-eşit`, k !== "yok" && k === a, `${k.slice(0, 10)} · ${a.slice(0, 10)}`);
  }
}

async function main(): Promise<void> {
  altin();
  yerTutucu();
  yedek();
  sir();
  kapsama();
  await kapsamaUc();
  performans();
  ayna();
  await dbBolumu();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

// ── §8 DB ─────────────────────────────────────────────────────────────────────
async function dbBolumu(): Promise<void> {
  console.log("\n=== §8 DB: arama, işlem gruplaması, reddedilen istek ===");
  const { default: prisma } = await import("../src/lib/prisma");
  const { AuditService } = await import("../src/services/audit.service");
  const { SystemLogService } = await import("../src/services/system-log.service");
  const { runWithRequestContext } = await import("../src/lib/request-context");
  const { recordTrace, flushRequestTraces } = await import("../src/services/request-trace.service");
  const ek = randomUUID().slice(0, 6).toUpperCase();
  const olusan: { userId?: string; orderId?: string; sackId?: string; manifestId?: string; rollId?: string; traceIds: string[] } = { traceIds: [] };
  try {
    const customer = await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } });
    const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
    if (!customer || !item) { ATLAMA.atla("§8", "fikstür yok (müşteri/kumaş) — seed:fixtures", "?"); return; }
    const user = await prisma.user.create({ data: { username: `bekci_anlati_${ek.toLowerCase()}`, passwordHash: "x", fullName: "Ahmet Yılmaz" } });
    olusan.userId = user.id;
    const order = await prisma.order.create({ data: { orderNumber: `SP-BKC-${ek}`, customerId: customer.id } });
    olusan.orderId = order.id;
    const sack = await prisma.sack.create({ data: { sackNo: `CVBKC${ek}` } });
    olusan.sackId = sack.id;
    const manifest = await prisma.manifest.create({ data: { manifestNo: `CLBKC${ek}`, snapshot: {}, sourceKind: "SACK_SELECTION", contentKey: `bekci-anlati-${ek}` } });
    olusan.manifestId = manifest.id;
    const roll = await prisma.roll.create({ data: { itemId: item.id, initialQty: 10, currentQty: 10, barcode: `BKC${ek}` } });
    olusan.rollId = roll.id;

    // Bir "Kaydet": aynı istek bağlamında iki audit satırı (sipariş + top).
    let reqId = "";
    await new Promise<void>((resolve, reject) => {
      runWithRequestContext({ headers: {}, ip: "127.0.0.1" } as unknown as Request, () => {
        (async () => {
          const { currentTraceContext } = await import("../src/lib/request-context");
          reqId = currentTraceContext()!.requestId;
          await AuditService.log({ userId: user.id, action: "UPDATE", tableName: "ORDER", recordId: order.id, changes: [{ field: "dueDate", old: "2026-10-18T00:00:00.000Z", new: "2026-10-25T00:00:00.000Z" }] });
          await AuditService.log({ userId: user.id, action: "UPDATE", tableName: "ROLL", recordId: roll.id, changes: [{ field: "notes", old: "a", new: "b" }] });
        })().then(resolve, reject);
      });
    });
    // İstek dışı (job) satırı: requestId null → tek başına grup.
    await AuditService.log({ userId: user.id, action: "UPDATE", tableName: "SACK", recordId: sack.id, changes: [{ field: "notes", old: "x", new: "y" }] });
    await new Promise((r) => setTimeout(r, 300)); // audit best-effort yazımı

    // q çözümü
    const sp = await SystemLogService.listByRecordQuery(`sp-bkc-${ek.toLowerCase()}`);
    const spTablolar = sp.data.map((r) => `${r.tableName}${r.kardes ? "*" : ""}`).sort().join(",");
    check("§8a ⭐ q=SP… kaydı ve aynı istekteki kardeşi getirir (küçük harf de)", spTablolar === "ORDER,ROLL*", spTablolar);
    check("§8a anlatı numarayla konuşur", sp.data.some((r) => r.anlati.metin.includes(`SP-BKC-${ek}`) && r.anlati.metin.includes("siparişinin Termin")), sp.data[0]?.anlati.metin);
    const cv = await SystemLogService.listByRecordQuery(`CVBKC${ek}`);
    check("§8b q=CV… çuvalı bulur", cv.kayitlar.some((k) => k.tableName === "SACK" && k.recordId === sack.id) && cv.data.length === 1, `${cv.data.length}`);
    const cl = await SystemLogService.listByRecordQuery(`CLBKC${ek}`);
    check("§8c q=CL… çeki listesini bulur (audit satırı yok → boş veri, uyarısız)", cl.kayitlar.some((k) => k.tableName === "MANIFEST") && !("warnings" in cl && cl.warnings), JSON.stringify(cl.kayitlar.map((k) => k.tableName)));
    const bc = await SystemLogService.listByRecordQuery(`BKC${ek}`);
    check("§8d q=barkod topu bulur", bc.kayitlar.some((k) => k.tableName === "ROLL" && k.recordId === roll.id), `${bc.data.length}`);
    const yok = await SystemLogService.listByRecordQuery(`YOK-${ek}-YOK`);
    check("§8e ⭐ bulunamayan numara: 200 + boş + uyarı", yok.success && yok.data.length === 0 && (yok as { warnings?: string[] }).warnings?.[0] === "Bu numarada kayıt bulunamadı");

    // İşlem gruplaması — eski dönem (trace yok)
    const imza = (d: Array<{ id: string; kayitSayisi: number }>) => d.map((x) => `${x.id}:${x.kayitSayisi}`).join("|");
    const eski = await SystemLogService.listIslemler({ userId: user.id });
    const eskiGrup = eski.data.filter((x) => !x.reddedildi);
    check("§8f ⭐ eski dönem: tek Kaydet tek satır (2 kayıt) + istek dışı satır ayrı grup", eskiGrup.length === 2 && eskiGrup.some((x) => x.id === reqId && x.kayitSayisi === 2) && eskiGrup.some((x) => x.requestId === null && x.kayitSayisi === 1), imza(eskiGrup));
    check("§8f başlık kök kayıttan: sipariş + \"ve 1 kayıt daha\"", eskiGrup.find((x) => x.id === reqId)?.anlati.metin.includes(`SP-BKC-${ek}`) === true && eskiGrup.find((x) => x.id === reqId)!.anlati.metin.endsWith("ve 1 kayıt daha etkilendi"), eskiGrup.find((x) => x.id === reqId)?.anlati.metin);

    // Yeni dönem: aynı isteğin başlığı + reddedilen (409) istek
    const sablon = { deviceRefId: null, panelInstanceId: null, deviceLocalId: null, clientType: "electron", appVersion: "9.9.9", ip: "127.0.0.1", audit: { count: 2 }, createdAt: new Date() };
    recordTrace({ ...sablon, id: reqId, userId: user.id, method: "PATCH", routeKey: "/api/orders/:id", status: 200, durationMs: 42, errorCode: null });
    const red = randomUUID();
    recordTrace({ ...sablon, id: red, userId: user.id, method: "POST", routeKey: "/api/shipping/shipments/:id/dispatch", status: 409, durationMs: 7, errorCode: "CONFLICT", audit: { count: 0 } });
    olusan.traceIds.push(reqId, red);
    await flushRequestTraces();
    const yeni = await SystemLogService.listIslemler({ userId: user.id });
    const yeniGrup = yeni.data.filter((x) => !x.reddedildi);
    check("§8g ⭐ yeni dönem (trace'li) AYNI grupları verir", imza(yeniGrup) === imza(eskiGrup), `${imza(yeniGrup)} ≟ ${imza(eskiGrup)}`);
    const bas = yeniGrup.find((x) => x.id === reqId);
    check("§8g başlık uç kataloğundan (\"siparişi düzenledi\") + iz", !!bas?.iz && bas.anlati.metin.startsWith("Ahmet Y. siparişi düzenledi"), bas?.anlati.metin);
    const r409 = yeni.data.find((x) => x.id === red);
    check("§8h ⭐ 409 trace \"…çalıştı — reddedildi\" cümlesi", !!r409 && r409.reddedildi && r409.anlati.metin.includes("sevkiyatı onaylamaya çalıştı — reddedildi: ") && r409.anlati.metin.endsWith("(CONFLICT)"), r409?.anlati.metin);
    check("§8h reddedilen istek tablo süzgecinde görünmez", !(await SystemLogService.listIslemler({ userId: user.id, tableName: "ORDER" })).data.some((x) => x.id === red));

    // Sayfalama: limit=1 ile üç grup tekrarsız gezilir
    const gezilen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 6; i++) {
      const s = await SystemLogService.listIslemler({ userId: user.id, limit: 1, cursor });
      gezilen.push(...s.data.map((x) => x.id));
      if (!s.pagination.nextCursor) break;
      cursor = s.pagination.nextCursor;
    }
    check("§8i sayfalama: 3 grup, tekrarsız, sırası korunur", gezilen.length === 3 && new Set(gezilen).size === 3 && gezilen.join() === yeni.data.map((x) => x.id).join(), gezilen.join(","));

    const ayr = await SystemLogService.findIslem(reqId);
    check("§8j ⭐ findIslem: uç/süre/istemci + 2 etkilenen kayıt + alan farkı + ham", ayr.success && ayr.data!.iz?.routeKey === "/api/orders/:id" && ayr.data!.iz?.durationMs === 42
      && ayr.data!.kayitlar.length === 2 && ayr.data!.kayitlar.some((k) => k.modul === "Sipariş" && Array.isArray(k.changes)) && ayr.data!.ham.length === 2, ayr.data?.anlati.metin);
    const ayrRed = await SystemLogService.findIslem(red);
    check("§8j findIslem: audit'siz reddedilen istek de açılır", ayrRed.success && ayrRed.data!.kayitlar.length === 0 && ayrRed.data!.anlati.metin.includes("reddedildi"));
    check("§8j geçersiz kimlik 404", !(await SystemLogService.findIslem("islem")).success);

    // "Reddedilenler" süzgeci (B4): 403 (GET) + 409 + audit'li 422 → yalnız onlar; başarılı grup yok.
    const r403 = randomUUID();
    const r422 = randomUUID();
    recordTrace({ ...sablon, id: r403, userId: user.id, method: "GET", routeKey: "/api/admin/system-logs", status: 403, durationMs: 3, errorCode: "FORBIDDEN", audit: { count: 0 } });
    recordTrace({ ...sablon, id: r422, userId: user.id, method: "PATCH", routeKey: "/api/orders/:id", status: 422, durationMs: 5, errorCode: "VALIDATION_ERROR", audit: { count: 1 } });
    olusan.traceIds.push(r403, r422);
    await flushRequestTraces();
    const sz = await SystemLogService.listIslemler({ userId: user.id, reddedilen: "1" });
    const szIds = sz.data.map((x) => x.id).sort().join(",");
    check("§8l ⭐ reddedilen=1 yalnız status ≥ 400 grupları döndürür (403 + 409 + audit'li 422; başarılı yok)", szIds === [r403, red, r422].sort().join(",") && sz.data.every((x) => x.reddedildi && (x.iz?.status ?? 0) >= 400), szIds);
    check("§8l yanıt `reddedilenSuzgeci: true` taşır (panel çip kapısı); düz işlem yanıtı da", sz.reddedilenSuzgeci === true && yeni.reddedilenSuzgeci === true);
    const sz1 = await SystemLogService.listIslemler({ userId: user.id, reddedilen: "1", limit: 2 });
    const sz2 = sz1.pagination.nextCursor ? await SystemLogService.listIslemler({ userId: user.id, reddedilen: "1", limit: 2, cursor: sz1.pagination.nextCursor }) : null;
    check("§8l imleç: 2 + 1, tekrar/eksik yok", sz1.data.length === 2 && sz2?.data.length === 1 && new Set([...sz1.data, ...sz2.data].map((x) => x.id)).size === 3, `${sz1.data.length}+${sz2?.data.length}`);
    check("§8l tablo süzgeciyle reddedilen yok → boş", (await SystemLogService.listIslemler({ userId: user.id, reddedilen: "1", tableName: "ORDER" })).data.length === 0);

    const liste = await SystemLogService.list({ userId: user.id, category: "DOMAIN" });
    check("§8k ⭐ satır görünümü: her satırda EK alan anlati (eski alanlar yerinde)", liste.data.length === 3 && liste.data.every((r) => typeof r.anlati?.metin === "string" && "tableName" in r && "recordId" in r && !UUID_RE.test(r.anlati.metin)), liste.data.map((r) => r.anlati.metin).join(" | "));
  } finally {
    // Audit satırları append-only ayak izidir: SİLİNMEZ. Yalnız iş fikstürleri ve telemetri temizlenir.
    const adim = async (f: () => Promise<unknown>) => { try { await f(); } catch { /* temizlik best-effort */ } };
    await adim(() => prisma.requestTrace.deleteMany({ where: { id: { in: olusan.traceIds } } }));
    if (olusan.rollId) await adim(() => prisma.roll.delete({ where: { id: olusan.rollId } }));
    if (olusan.manifestId) await adim(() => prisma.manifest.delete({ where: { id: olusan.manifestId } }));
    if (olusan.sackId) await adim(() => prisma.sack.delete({ where: { id: olusan.sackId } }));
    if (olusan.orderId) await adim(() => prisma.order.delete({ where: { id: olusan.orderId } }));
    await prisma.$disconnect();
  }
}

void main();
