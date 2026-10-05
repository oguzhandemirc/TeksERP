// =============================================================================
// PATRON BULUTU ÇEKİRDEK KAPILARI (statik, DB'siz, taban 0):
//   §1 advisory kilit envanteri: `LOCK_NAMESPACES` ↔ `patron/sunucu/CLAUDE.md` tablosu İKİ YÖNLÜ birebir
//      (ad + numara) · uzay 92xx (backend 80xx, satıcı 91xx ile çakışmaz)
//   §2 tek yazar: `set_config` · `pg_advisory` · `$transaction` YALNIZ `src/lib/tenant.ts`te
//      (kiracı ayarı + kilit her tx'in İLK ifadesi; başka yol RLS kapsamını atlayamaz)
//   §3 kapsamsız sorgu yok: istemci (`ctx.app` · `ctx.sync` · `this.db` · `db`) üzerinden doğrudan model
//      ya da ham sorgu çağrısı YOK — hepsi `withTesis/withLookup/withMaintenanceList` tx'inde
//   §4 silme beyanı: `src`teki HER silme (`deleteMany`/`.delete(`/`DELETE FROM`) iki beyanlı dosyadan birinde:
//      `maintenance.ts` (yaşa göre; hedef `PRUNED_TABLES`ta, ölü beyan da KIRMIZI) · `facility-destruction.ts`
//      (tesis imhası; hedef kümesi = TESIS_TABLES − RETAINED_TABLES İKİ YÖNLÜ — yeni tablo imhadan kaçamaz)
//   §5 rota tablosu: yöntem+yol tekil · her yazma rotası işlem kimliği ya da GEREKÇELİ muafiyet beyan
//      eder, her okuma rotası OKUMA · muafiyet gerekçesi boş olamaz
//   §6 katalog: izin kodları tekil · her okuma izni en az bir projeksiyon/rapor açar · yazma ve
//      yönetim izinleri kodda kullanılır (ölü izin yok) · hata kodları tekil
//   §7 protokol aynası: `src/lisans-protokol/` ↔ `Teks-Erp/src/lib/license/protocol/` bayt-eşit
//   §8 yaşa göre silinen ALAN beyanı (`AGED_FIELDS`, IP 30 gün): denetim satırı YALNIZ `maintenance.ts`te güncellenir
//      ve güncellenen her alan beyanda, beyandaki her alanın silme yeri var (iki yönlü) · istemci adresi
//      (`clientAddress(`) yalnız HTTP katmanında okunur · işlem makbuzu da YALNIZ `maintenance.ts`te (kimlik silmesi)
//      güncellenir · uygulama rolünün denetim UPDATE'i yalnız kolon düzeyinde ve AGED_FIELDS kolonlarında (§8g)
// ⭐ KALICI SONDA (her koşumda): §4 ve §5 yüklemleri sentetik girdide ısırır, temiz girdide susar.
// Koşum: npx tsx scripts/test_patron_kapilari.ts   (DB GEREKMEZ)
// =============================================================================
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { CLOUD_PERMISSIONS } from "../src/catalog/permissions";
import { PROJECTION_CATALOG } from "../src/catalog/projections";
import { REPORT_KEY_PERMISSION } from "../src/catalog/reports";
import { API_ROUTES, type ApiRouteDef } from "../src/http/api-routes";
import { CLOUD_ERROR_CODES } from "../src/lib/errors";
import { APP_COLUMN_GRANTS, APP_GRANTS, CLOUD_TABLES, TESIS_TABLES } from "../src/lib/db-grants";
import { LOCK_NAMESPACES } from "../src/lib/locks";
import { DESTRUCTION_STEPS, RETAINED_TABLES } from "../src/services/facility-destruction";
import { AGED_FIELDS, PRUNED_TABLES } from "../src/services/maintenance";

const KOK = path.resolve(__dirname, "..");
let gecti = 0;
let kaldi = 0;
function kontrol(ad: string, kosul: boolean, ayrinti = ""): void {
  if (kosul) gecti++;
  else kaldi++;
  console.log(`  ${kosul ? "✅" : "❌"} ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

function dosyalar(dizin: string): string[] {
  const out: string[] = [];
  for (const ad of readdirSync(dizin)) {
    const p = path.join(dizin, ad);
    if (statSync(p).isDirectory()) out.push(...dosyalar(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Yorum satırları (// ve * ile başlayan) kod sayılmaz — belge cümlesi yasak kelimeyi anabilir. */
function kod(metin: string): string {
  return metin
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

const SRC = path.join(KOK, "src");
const kaynaklar = dosyalar(SRC).filter((f) => !f.includes(`${path.sep}lisans-protokol${path.sep}`));
const goreli = (f: string) => path.relative(KOK, f);

function envanter(): void {
  console.log("\n§1 advisory kilit envanteri ↔ CLAUDE.md");
  const md = readFileSync(path.join(KOK, "CLAUDE.md"), "utf8");
  const tablo = new Map([...md.matchAll(/^\|\s*(\d{4})\s*\|\s*`([A-Z_]+)`\s*\|/gm)].map((m) => [m[2]!, Number(m[1])]));
  const kodda = new Map(Object.entries(LOCK_NAMESPACES));
  const esit = tablo.size === kodda.size && [...kodda].every(([ad, n]) => tablo.get(ad) === n);
  kontrol("§1a LOCK_NAMESPACES = CLAUDE.md tablosu (iki yönlü, ad + numara)", esit, `kod ${kodda.size} · belge ${tablo.size}`);
  kontrol("§1b uzay 92xx (backend 80xx · satıcı 91xx ile çakışmaz)", [...kodda.values()].every((n) => n >= 9200 && n < 9300));
  kontrol("§1c numaralar tekil", new Set(kodda.values()).size === kodda.size);
}

function tekYazar(): void {
  console.log("\n§2 tek yazar: set_config · pg_advisory · $transaction");
  for (const [desen, ad] of [
    [/set_config\s*\(/, "set_config"],
    [/pg_(try_)?advisory/, "pg_advisory"],
    [/\$transaction\s*\(/, "$transaction"],
  ] as const) {
    // Tek beyanlı istisna: göç koşucusu Prisma şema motorunun OTURUM kilidini alır (uygulama kilit uzayı değil).
    const muaf = (f: string): boolean => f.endsWith(path.join("lib", "tenant.ts")) || (ad === "pg_advisory" && f.endsWith(path.join("lib", "tesis-goc.ts")));
    const disarida = kaynaklar.filter((f) => !muaf(f) && desen.test(kod(readFileSync(f, "utf8")))).map(goreli);
    kontrol(`§2 ${ad} yalnız src/lib/tenant.ts`, disarida.length === 0, disarida.join(", ") || "temiz");
  }
}

const DOGRUDAN = /\b(?:ctx\.(?:app|sync)|this\.db|db)\.(?:\$queryRaw|\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe|[a-z][A-Za-z]+\.(?:find\w*|create\w*|update\w*|upsert|delete\w*|count|aggregate|groupBy))\s*\(/;

export function dogrudanCagrilar(metin: string): number {
  return kod(metin)
    .split("\n")
    .filter((l) => DOGRUDAN.test(l)).length;
}

function kapsamsiz(): void {
  console.log("\n§3 kapsamsız sorgu yok");
  const ihlal = kaynaklar.filter((f) => !/lib[/\\](tenant|db)\.ts$/.test(f) && dogrudanCagrilar(readFileSync(f, "utf8")) > 0).map(goreli);
  kontrol("§3a istemci üzerinden doğrudan model/ham sorgu çağrısı 0", ihlal.length === 0, ihlal.join(", ") || "temiz");
  kontrol("§3b ✓K sonda: `ctx.app.account.findMany(` ısırır", dogrudanCagrilar("await ctx.app.account.findMany({})") === 1);
  kontrol("§3c ✓K sonda: tx içindeki `tx.account.findMany(` susar", dogrudanCagrilar("await tx.account.findMany({})") === 0);
}

function modelTablolari(): Map<string, string> {
  const sema = readFileSync(path.join(KOK, "prisma", "schema.prisma"), "utf8");
  const out = new Map<string, string>();
  for (const m of sema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const tablo = /@@map\("([a-z_]+)"\)/.exec(m[2]!)?.[1];
    if (tablo) out.set(m[1]!.charAt(0).toLowerCase() + m[1]!.slice(1), tablo);
  }
  return out;
}

export function silmeHedefleri(metin: string, modeller: ReadonlyMap<string, string>): { tablolar: Set<string>; bilinmeyen: string[] } {
  const tablolar = new Set<string>();
  const bilinmeyen: string[] = [];
  const k = kod(metin);
  for (const m of k.matchAll(/\b(?:tx|db|prisma)\.([a-z][A-Za-z]+)\.(?:deleteMany|delete)\s*\(/g)) {
    const t = modeller.get(m[1]!);
    if (t) tablolar.add(t);
    else bilinmeyen.push(m[1]!);
  }
  for (const m of k.matchAll(/DELETE\s+FROM\s+"?([a-z_]+)"?/gi)) tablolar.add(m[1]!);
  return { tablolar, bilinmeyen };
}

function budama(): void {
  console.log("\n§4 silme beyanı (budama + imha)");
  const modeller = modelTablolari();
  const beyan = new Set(Object.keys(PRUNED_TABLES));
  const bakim = path.join(SRC, "services", "maintenance.ts");
  const imha = path.join(SRC, "services", "facility-destruction.ts");
  const baskaYer = kaynaklar.filter((f) => f !== bakim && f !== imha && silmeHedefleri(readFileSync(f, "utf8"), modeller).tablolar.size > 0).map(goreli);
  kontrol("§4a silme YALNIZ services/maintenance.ts ve services/facility-destruction.ts'te", baskaYer.length === 0, baskaYer.join(", ") || "temiz");
  const h = silmeHedefleri(readFileSync(bakim, "utf8"), modeller);
  const beyansiz = [...h.tablolar].filter((t) => !beyan.has(t));
  const olu = [...beyan].filter((t) => !h.tablolar.has(t));
  kontrol("§4b her silme hedefi PRUNED_TABLES beyanında", beyansiz.length === 0 && h.bilinmeyen.length === 0, beyansiz.concat(h.bilinmeyen).join(",") || `${h.tablolar.size} tablo`);
  kontrol("§4c beyanda olup silme yeri olmayan tablo YOK (ölü beyan)", olu.length === 0, olu.join(",") || "temiz");
  const sonda = silmeHedefleri("await tx.account.deleteMany({})", modeller);
  kontrol("§4d ✓K sonda: hesap silmesi `accounts` olarak ısırır (beyan dışı)", sonda.tablolar.has("accounts") && !beyan.has("accounts"));
  const imhaHedef = silmeHedefleri(readFileSync(imha, "utf8"), modeller);
  const kalan = new Set(Object.keys(RETAINED_TABLES));
  const beklenen = TESIS_TABLES.filter((t) => !kalan.has(t)).sort();
  const bulunan = [...imhaHedef.tablolar].sort();
  kontrol("§4e imha silme kümesi = TESIS_TABLES − RETAINED_TABLES (iki yönlü)", JSON.stringify(bulunan) === JSON.stringify(beklenen) && imhaHedef.bilinmeyen.length === 0, `${bulunan.length}/${beklenen.length}${imhaHedef.bilinmeyen.length ? ` bilinmeyen ${imhaHedef.bilinmeyen.join(",")}` : ""}`);
  kontrol("§4f imha adım listesi = silinen tablolar (DESTRUCTION_STEPS birebir)", JSON.stringify(DESTRUCTION_STEPS.map((st) => st.table).sort()) === JSON.stringify(beklenen));
  kontrol("§4g kalan tablo CLOUD_TABLES'ta ve imhada silinmiyor", [...kalan].every((t) => CLOUD_TABLES.includes(t) && !imhaHedef.tablolar.has(t)));
  const eksikSonda = TESIS_TABLES.filter((t) => !kalan.has(t) && t !== "sessions").sort();
  kontrol("§4h ✓K sonda: bir tablo eksik silinirse küme eşitliği bozulur", JSON.stringify(eksikSonda) !== JSON.stringify(beklenen));
}

export function rotaIhlalleri(rotalar: readonly Pick<ApiRouteDef, "method" | "path" | "kimlik">[]): string[] {
  const out: string[] = [];
  const gorulen = new Set<string>();
  for (const r of rotalar) {
    const anahtar = `${r.method} ${r.path}`;
    if (gorulen.has(anahtar)) out.push(`tekrar: ${anahtar}`);
    gorulen.add(anahtar);
    if (r.method === "get" && r.kimlik !== "OKUMA") out.push(`okuma rotası OKUMA değil: ${anahtar}`);
    if (r.method !== "get" && r.kimlik === "OKUMA") out.push(`yazma rotası kimlik beyansız: ${anahtar}`);
    if (typeof r.kimlik === "object" && r.kimlik.muaf.trim().length < 10) out.push(`muafiyet gerekçesiz: ${anahtar}`);
  }
  return out;
}

function rotalar(): void {
  console.log("\n§5 rota tablosu");
  const ihlal = rotaIhlalleri(API_ROUTES);
  kontrol(`§5a ${API_ROUTES.length} rota: tekil, yazma kimlik/muafiyet beyanlı, okuma OKUMA`, ihlal.length === 0, ihlal.join(" · ") || "temiz");
  kontrol("§5b ✓K sonda: beyansız yazma rotası ısırır", rotaIhlalleri([{ method: "post", path: "/x", kimlik: "OKUMA" }]).length === 1);
  kontrol("§5c ✓K sonda: gerekçesiz muafiyet ısırır", rotaIhlalleri([{ method: "post", path: "/y", kimlik: { muaf: "" } }]).length === 1);
  kontrol("§5d ✓K sonda: temiz tablo susar", rotaIhlalleri([{ method: "get", path: "/z", kimlik: "OKUMA" }, { method: "post", path: "/z", kimlik: "ISLEM_KIMLIGI" }]).length === 0);
  const isk = API_ROUTES.filter((r) => r.kimlik === "ISLEM_KIMLIGI").map((r) => `${r.method} ${r.path}`);
  kontrol("§5e kayıt yaratan uçlar işlem kimliği taşır (gelen kutusu · rapor · hesap)", ["post /gelen-kutusu", "post /raporlar", "post /hesaplar"].every((x) => isk.includes(x)), isk.join(", "));
}

function katalog(): void {
  console.log("\n§6 izin + hata kataloğu");
  kontrol("§6a izin kodları tekil", new Set(CLOUD_PERMISSIONS).size === CLOUD_PERMISSIONS.length);
  const acilan = new Set<string>();
  for (const d of PROJECTION_CATALOG.values()) for (const p of d.permissions) acilan.add(p);
  for (const p of Object.values(REPORT_KEY_PERMISSION)) acilan.add(p);
  acilan.add("bulut:rapor:oku");
  const tumKod = kaynaklar.filter((f) => !f.endsWith(path.join("catalog", "permissions.ts"))).map((f) => readFileSync(f, "utf8")).join("\n");
  const olu = CLOUD_PERMISSIONS.filter((p) => !acilan.has(p) && !tumKod.includes(`"${p}"`));
  kontrol("§6b her izin bir projeksiyon/rapor açar ya da kodda kapı olarak kullanılır (ölü izin yok)", olu.length === 0, olu.join(",") || "temiz");
  kontrol("§6c hata kodları tekil", new Set(CLOUD_ERROR_CODES).size === CLOUD_ERROR_CODES.length);
}

/** Denetim satırını güncelleyen ifadeler → güncellenen alan anahtarı (`account_audit.summary.<anahtar>`). */
export function denetimGuncellemeleri(metin: string): { alanlar: Set<string>; prisma: number } {
  const k = kod(metin);
  const alanlar = new Set<string>();
  for (const m of k.matchAll(/UPDATE\s+"?account_audit"?\s+SET\s+summary\s*=\s*summary\s*-\s*'([a-zA-Z]+)'/gi)) alanlar.add(`account_audit.summary.${m[1]}`);
  const prisma = [...k.matchAll(/\b(?:tx|db|prisma)\.accountAudit\.(?:update|updateMany|upsert)\s*\(/g)].length;
  const genel = [...k.matchAll(/UPDATE\s+"?account_audit"?/gi)].length;
  return { alanlar, prisma: prisma + genel - alanlar.size };
}

function alanBeyani(): void {
  console.log("\n§8 yaşa göre silinen alan beyanı (IP 30 gün)");
  const bakim = path.join(SRC, "services", "maintenance.ts");
  const baskaYer = kaynaklar.filter((f) => f !== bakim && /UPDATE\s+"?account_audit|accountAudit\.(?:update|updateMany|upsert)\s*\(/i.test(kod(readFileSync(f, "utf8")))).map(goreli);
  kontrol("§8a denetim satırı YALNIZ services/maintenance.ts'te güncellenir", baskaYer.length === 0, baskaYer.join(", ") || "temiz");
  const g = denetimGuncellemeleri(readFileSync(bakim, "utf8"));
  const beyan = new Set(Object.keys(AGED_FIELDS));
  kontrol("§8b güncellenen her alan AGED_FIELDS'ta, beyandaki her alanın silme yeri var (iki yönlü)", g.prisma === 0 && [...g.alanlar].every((a) => beyan.has(a)) && [...beyan].every((a) => g.alanlar.has(a)), [...g.alanlar].join(",") || "yok");
  const okuyan = kaynaklar.filter((f) => !/http[/\\]/.test(f) && /\bclientAddress\(/.test(kod(readFileSync(f, "utf8")))).map(goreli);
  kontrol("§8c istemci adresi yalnız HTTP katmanında okunur", okuyan.length === 0, okuyan.join(", ") || "temiz");
  const sonda = denetimGuncellemeleri("await tx.$executeRaw`UPDATE account_audit SET summary = summary - 'eposta' WHERE x`; await tx.accountAudit.updateMany({});");
  kontrol("§8d ✓K sonda: beyansız alan silmesi ve Prisma güncellemesi ısırır", sonda.alanlar.has("account_audit.summary.eposta") && !beyan.has("account_audit.summary.eposta") && sonda.prisma === 1);
  const makbuzYazan = kaynaklar.filter((f) => f !== bakim && makbuzGuncellemesi(readFileSync(f, "utf8"))).map(goreli);
  kontrol("§8e işlem makbuzu YALNIZ services/maintenance.ts'te (kimlik silmesi) güncellenir — tekrar yanıtı başka yolda değişmez", makbuzYazan.length === 0, makbuzYazan.join(", ") || "temiz");
  const kolonlar = denetimKolonlari(AGED_FIELDS);
  kontrol(
    "§8g uygulama rolünün account_audit UPDATE'i tablo düzeyinde YOK, kolon düzeyinde = AGED_FIELDS kolonları (iki yönlü)",
    !APP_GRANTS.account_audit?.includes("UPDATE") && JSON.stringify([...(APP_COLUMN_GRANTS.account_audit?.UPDATE ?? [])].sort()) === JSON.stringify(kolonlar),
    `tablo ${APP_GRANTS.account_audit?.join("/") ?? "yok"} · kolon ${(APP_COLUMN_GRANTS.account_audit?.UPDATE ?? []).join(",") || "yok"} · beyan ${kolonlar.join(",")}`,
  );
  kontrol(
    "§8f ✓K sonda: makbuz güncellemesi (Prisma + ham SQL) ısırır, yaratma ve okuma susar",
    makbuzGuncellemesi("await tx.operationReceipt.updateMany({})") && makbuzGuncellemesi("await tx.$executeRaw`UPDATE operation_receipts SET response = '{}'`") && !makbuzGuncellemesi("await tx.operationReceipt.create({}); await tx.operationReceipt.findUnique({})"),
  );
}

/** `account_audit.<kolon>.<alan>` beyanlarının kolonları (tekil, sıralı). */
export function denetimKolonlari(beyan: Readonly<Record<string, string>>): string[] {
  return [...new Set(Object.keys(beyan).filter((k) => k.startsWith("account_audit.")).map((k) => k.split(".")[1]!))].sort();
}

/** Makbuzu güncelleyen ifade var mı (yorum satırı sayılmaz). */
export function makbuzGuncellemesi(metin: string): boolean {
  return /UPDATE\s+"?operation_receipts|\boperationReceipt\.(?:update|updateMany|upsert)\s*\(/i.test(kod(metin));
}

function ayna(): void {
  console.log("\n§7 protokol aynası");
  const ozet = (d: string) =>
    new Map(
      readdirSync(d)
        .sort()
        .map((f) => [f, createHash("sha256").update(readFileSync(path.join(d, f))).digest("hex")]),
    );
  const kaynak = ozet(path.join(KOK, "..", "..", "Teks-Erp", "src", "lib", "license", "protocol"));
  const aynaDizin = ozet(path.join(SRC, "lisans-protokol"));
  const esit = kaynak.size >= 5 && kaynak.size === aynaDizin.size && [...kaynak].every(([f, h]) => aynaDizin.get(f) === h);
  kontrol("§7a src/lisans-protokol kaynakla BAYT-EŞİT", esit, `${kaynak.size} dosya`);
}

envanter();
tekYazar();
kapsamsiz();
budama();
rotalar();
katalog();
ayna();
alanBeyani();
console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
process.exit(kaldi > 0 ? 1 : 0);
