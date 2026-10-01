// =============================================================================
// PATRON BULUTU TEL AYNASI — `patron/sunucu/src/wire/esitleme.ts` TEK KAYNAKTIR; fabrika aynı dosyayı
// `Teks-Erp/src/cloud-sync/wire/esitleme.ts` olarak BAYT-EŞİT taşır. Ayna bozulursa iki uç aynı paketi farklı
// doğrular ve hata sessizdir (fabrika "gönderdim", bulut 400 der ya da alanı düşürür) — I3-1b'de ölçülen yedi
// uyuşmazlığın hepsi bu sınıftandı (`PATRON-BULUTU-ESITLEME.md` §14 S37…).
//   §1 ayna bayt-eşit (sha256); iki dosya da ZORUNLU — yokluk "eşit" sayılmaz
//   §2 sözleşme dosyası yalnız `zod` içe aktarır (iki projede de derlenmeli)
//   §3 tel yolu literali (`/v1/esitle` · `/v1/gelen-kutusu/…` · `/v1/rapor/…` · `/v1/hesaplar`) sözleşme dışında YOK
//      (fabrika `src/` + bulut `src/`) — uçlar yalnız `SYNC_PATHS`ten okunur
//   §4 sözleşmenin dışa aktardığı ad iki projede İKİNCİ KEZ tanımlanmaz (elle kopya şema yok)
//   §5 katalog çapraz ölçümü: fabrika kataloğu ↔ bulut kataloğu — ad/tür, alt satır, FINANS/KİŞİSEL alanın kökte
//      yasağı (S34 ikinci seddi), saklama alanları ve üstten saklama (S23) birebir
//   §6 uzlaştırma ebeveyn bağı (S45): sözleşmedeki her kalem → üst belge bağı iki katalogda çözülür (fabrikada alan
//      kolon, bulutta `parent` aynı), fabrikanın üstten saklamalı kalemi sözleşmede
//   §7 fabrika projesi patron kaynağını içe aktarmaz (statik/dinamik); bulut kataloğu yalnız ÜRETİLMİŞ özetten
//      (`patron/sunucu/src/catalog/katalog-ozeti.json`) dosya olarak okunur — özetin canlı katalogla eşitliğini
//      patron işinde `patron/sunucu/scripts/test_katalog_ozeti.ts` ölçer (sunucu bağımlılığı orada kurulu)
//   §8 uzak rapor eşlemesi: fabrikanın `REMOTE_REPORTS` (anahtar → izin, kaynaktan AST ile okunur — modül yüklenmez,
//      DB gerekmez) ↔ bulutun `REPORT_KEY_PERMISSION`ı iki yönlü birebir: aynı anahtar kümesi, aynı izin
// ⭐ KALICI SONDA ✓K1–✓K6 (her koşumda): karşılaştırıcılar sentetik girdide ısırır, temiz girdide susar.
// NEGATİF SONDA (dosya dışı, cp + shasum geri): T1 bulut `cek-hareketi` bağı elle `cekNo` → özet bayat (patron
//   `test_katalog_ozeti` §1b), `--yaz` sonrası §6b · T2 fabrika tel alanı `cekId` → `cekNo` → §6a · T3 bulut
//   kataloğu yeniden dinamik içe aktarıldı → §7a (ve patron bağımlılığı yoksa çöküş).
// Düzeltme: değişiklik ÖNCE kaynakta, sonra `cp -p patron/sunucu/src/wire/esitleme.ts Teks-Erp/src/cloud-sync/wire/`.
// Koşum: npx tsx scripts/test_bulut_tel_aynasi.ts   (DB GEREKMEZ)
// =============================================================================
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { RECORD_PROJECTIONS, SNAPSHOT_PROJECTIONS } from "../src/cloud-sync/projections";
import { RECONCILE_PARENTS } from "../src/cloud-sync/wire";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const KOK = path.resolve(__dirname, "..", "..");
export const KAYNAK = "patron/sunucu/src/wire/esitleme.ts";
export const AYNA = "Teks-Erp/src/cloud-sync/wire/esitleme.ts";
export const BULUT_OZETI = "patron/sunucu/src/catalog/katalog-ozeti.json";
export const UZAK_RAPORLAR = "Teks-Erp/src/cloud-sync/report-requests.ts";
const TARANAN: readonly string[] = ["Teks-Erp/src", "patron/sunucu/src"];

const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

function tsDosyalari(dizin: string): string[] {
  const out: string[] = [];
  for (const ad of readdirSync(dizin)) {
    const p = path.join(dizin, ad);
    if (statSync(p).isDirectory()) out.push(...tsDosyalari(p));
    else if (/\.tsx?$/.test(ad)) out.push(p);
  }
  return out;
}

/** İçe aktarılan modül adları (tip içe aktarımı dahil). */
export function iceAktarimlar(src: string): string[] {
  return [...src.matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"/gm), ...src.matchAll(/^\s*import\s+"([^"]+)"/gm)].map((m) => m[1]!);
}

const TEL_YOLU = /["'`]\/v1\/(esitle|gelen-kutusu\/(al|sonuc)|rapor\/(al|sonuc)|hesaplar)["'`]/g;
/** Tel yolu literalleri (satır no + metin). */
export function telYollari(src: string): string[] {
  const out: string[] = [];
  src.split("\n").forEach((satir, i) => {
    for (const m of satir.matchAll(TEL_YOLU)) out.push(`${i + 1}:${m[0]}`);
  });
  return out;
}

/** Dosyanın TANIMLADIĞI dışa açık adlar (`export const|type|interface|function|class <Ad>`). */
export function tanimlananAdlar(src: string): string[] {
  return [...src.matchAll(/^export\s+(?:declare\s+)?(?:const|let|type|interface|function|class|enum)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]!);
}

interface FabrikaKaydi {
  readonly ad: string;
  readonly tur: string;
  readonly alanlar: readonly { readonly tel: string; readonly sinif: string }[];
  readonly saklama: readonly string[];
  readonly usttenSaklama: string | null;
}
interface BulutKaydi {
  readonly ad: string;
  readonly tur: string;
  readonly altSatirlar: readonly string[];
  readonly kokteYasak: readonly string[];
  readonly saklama: readonly string[];
  readonly usttenSaklama: string | null;
  /** Kalem → üst belge bağı `ebeveyn.alan` (yoksa null). */
  readonly ebeveyn?: string | null;
}

/** Katalog çapraz farkı — saf fonksiyon (sondalar sentetik girdiyle çağırır). */
export function katalogFarki(fabrika: readonly FabrikaKaydi[], anliklar: readonly string[], bulut: readonly BulutKaydi[]): string[] {
  const out: string[] = [];
  const b = new Map(bulut.map((x) => [x.ad, x]));
  const fabrikaAdlari = new Set<string>(anliklar);
  for (const f of fabrika) {
    fabrikaAdlari.add(f.ad);
    const k = b.get(f.ad);
    if (!k) {
      out.push(`bulutta yok: ${f.ad}`);
      continue;
    }
    if (k.tur !== f.tur) out.push(`tür: ${f.ad} fabrika ${f.tur} ↔ bulut ${k.tur}`);
    const gizli = f.alanlar.filter((a) => a.sinif !== "ISLEM");
    const alt = new Set<string>(gizli.map((a) => (a.sinif === "FINANS" ? "finans" : "kisisel")));
    for (const s of alt) if (!k.altSatirlar.includes(s)) out.push(`alt satır bulutta tanımsız: ${f.ad}.${s}`);
    for (const s of k.altSatirlar) if (!alt.has(s)) out.push(`bulutta fazla alt satır: ${f.ad}.${s}`);
    for (const a of gizli) if (!k.kokteYasak.includes(a.tel)) out.push(`bulut kökte yasaklamıyor: ${f.ad}.${a.tel} (${a.sinif})`);
    for (const y of k.kokteYasak) if (!gizli.some((a) => a.tel === y)) out.push(`bulut yasağı fabrikada gizli alan değil: ${f.ad}.${y}`);
    if (JSON.stringify(f.saklama) !== JSON.stringify(k.saklama)) out.push(`saklama alanı: ${f.ad} fabrika ${JSON.stringify(f.saklama)} ↔ bulut ${JSON.stringify(k.saklama)}`);
    if (f.usttenSaklama !== k.usttenSaklama) out.push(`üstten saklama: ${f.ad} fabrika ${String(f.usttenSaklama)} ↔ bulut ${String(k.usttenSaklama)}`);
  }
  for (const a of anliklar) {
    const k = b.get(a);
    if (!k) out.push(`bulutta yok (anlık): ${a}`);
    else if (k.tur !== "ANLIK") out.push(`tür: ${a} fabrika ANLIK ↔ bulut ${k.tur}`);
  }
  for (const k of bulut) if (!fabrikaAdlari.has(k.ad)) out.push(`fabrikada yok: ${k.ad}`);
  return out;
}

function fabrikaKatalogu(): { kayitlar: FabrikaKaydi[]; anliklar: string[] } {
  const kayitlar = RECORD_PROJECTIONS.map((p) => ({
    ad: p.name,
    tur: p.role,
    alanlar: [...p.columns, ...p.derived].map((c) => ({ tel: c.wire, sinif: c.dataClass })),
    saklama: p.retention?.wireFields ?? [],
    usttenSaklama: p.retention?.parent?.projection ?? null,
  }));
  const anliklar = SNAPSHOT_PROJECTIONS.flatMap((s) => (s.sections && s.sections.length > 0 ? s.sections.map((x) => x.name) : [s.name]));
  return { kayitlar, anliklar };
}

const kayit = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const metinler = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Bulut kataloğu ÜRETİLMİŞ özetten DOSYA olarak okunur: patron kaynağı içe aktarılmaz (bağımlılığı bu işte kurulu değil). */
function bulutKatalogu(): BulutKaydi[] {
  const p = path.join(KOK, BULUT_OZETI);
  const ozet: unknown = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
  const liste = kayit(ozet) ? ozet.ROOT_PROJECTIONS : undefined;
  if (!Array.isArray(liste)) return [];
  return liste.filter(kayit).map((p) => {
    const ust = kayit(p.parent) && typeof p.parent.projection === "string" ? p.parent.projection : null;
    const alan = kayit(p.parent) && typeof p.parent.field === "string" ? p.parent.field : null;
    return {
      ad: String(p.name),
      tur: String(p.kind),
      altSatirlar: metinler(p.subRows),
      kokteYasak: metinler(p.forbiddenRootFields),
      saklama: metinler(p.retentionFields),
      usttenSaklama: p.retentionFromParent === true ? ust : null,
      ebeveyn: ust && alan ? `${ust}.${alan}` : null,
    };
  });
}

/**
 * `REMOTE_REPORTS` dizi literalinden anahtar → izin (kaynak metni; modül yüklenmez — rapor servisleri DB ister).
 * Literal olmayan `key`/`permission` ya da bulunamayan dizi BOŞ eşleme döner: karşılaştırıcı onu kırmızı sayar.
 */
export function uzakRaporIzinleri(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const sf = ts.createSourceFile("report-requests.ts", src, ts.ScriptTarget.Latest, true);
  const ziyaret = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "REMOTE_REPORTS" && n.initializer && ts.isArrayLiteralExpression(n.initializer)) {
      for (const el of n.initializer.elements) {
        if (!ts.isObjectLiteralExpression(el)) {
          out["?"] = "literal olmayan girdi";
          continue;
        }
        const alan = (ad: string): string | null => {
          const p = el.properties.find((x): x is ts.PropertyAssignment => ts.isPropertyAssignment(x) && ts.isIdentifier(x.name) && x.name.text === ad);
          return p && ts.isStringLiteral(p.initializer) ? p.initializer.text : null;
        };
        const key = alan("key");
        out[key ?? "?"] = alan("permission") ?? "?";
      }
      return;
    }
    ts.forEachChild(n, ziyaret);
  };
  ziyaret(sf);
  return out;
}

/** Uzak rapor eşleme farkı (iki yönlü) — saf. Boş eşleme de fark sayılır (ölçülemedi ≠ uyumlu). */
export function raporIzinFarki(fabrika: Readonly<Record<string, string>>, bulut: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  if (Object.keys(fabrika).length === 0) out.push("fabrika eşlemesi okunamadı");
  if (Object.keys(bulut).length === 0) out.push("bulut eşlemesi okunamadı");
  for (const [k, p] of Object.entries(fabrika)) {
    if (!(k in bulut)) out.push(`bulutta yok: ${k}`);
    else if (bulut[k] !== p) out.push(`izin: ${k} fabrika ${p} ↔ bulut ${bulut[k]}`);
  }
  for (const k of Object.keys(bulut)) if (!(k in fabrika)) out.push(`fabrikada yok: ${k}`);
  return out;
}

/** Bulutun rapor anahtarı → izin eşlemesi, üretilmiş özetten DOSYA olarak. */
function bulutRaporIzinleri(): Record<string, string> {
  const p = path.join(KOK, BULUT_OZETI);
  const ozet: unknown = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
  const e = kayit(ozet) ? ozet.REPORT_KEY_PERMISSION : undefined;
  return kayit(e) ? Object.fromEntries(Object.entries(e).filter((x): x is [string, string] => typeof x[1] === "string")) : {};
}

/** Patron projesinin kaynağını içe aktaran satırlar (statik `import … from` · `require(` · dinamik `import(`). */
export function patronIceAktarimi(src: string): string[] {
  return src.split("\n").filter((s) => /\b(import|require)\b[^\n]*patron\/(sunucu|uygulama)\//.test(s) && !/readFileSync/.test(s));
}

function main(): void {
  console.log("§1 ayna bayt-eşit");
  const kaynak = path.join(KOK, KAYNAK);
  const ayna = path.join(KOK, AYNA);
  check(`§1a kaynak var (${KAYNAK})`, existsSync(kaynak));
  check(`§1b ayna var (${AYNA})`, existsSync(ayna));
  if (existsSync(kaynak) && existsSync(ayna)) {
    check("§1c ⭐ ayna sha256 kaynakla aynı", sha(kaynak) === sha(ayna), `cp -p ${KAYNAK} ${path.dirname(AYNA)}/`);
    const src = readFileSync(kaynak, "utf8");
    check("§1d kaynak boş değil (≥ 20 dışa aktarım)", tanimlananAdlar(src).length >= 20, String(tanimlananAdlar(src).length));

    console.log("\n§2 yalnız zod");
    const yabanci = iceAktarimlar(src).filter((m) => m !== "zod");
    check("§2a ⭐ sözleşme dosyası yalnız `zod` içe aktarır", yabanci.length === 0, yabanci.join(", "));

    console.log("\n§3–§4 sözleşme dışında tel yolu / kopya tanım");
    const adlar = new Set(tanimlananAdlar(src));
    const yolIhlali: string[] = [];
    const kopya: string[] = [];
    for (const kok of TARANAN) {
      for (const p of tsDosyalari(path.join(KOK, kok))) {
        const rel = path.relative(KOK, p);
        if (rel === KAYNAK || rel === AYNA) continue;
        const icerik = readFileSync(p, "utf8");
        for (const y of telYollari(icerik)) yolIhlali.push(`${rel}:${y}`);
        for (const ad of tanimlananAdlar(icerik)) if (adlar.has(ad)) kopya.push(`${rel}: ${ad}`);
      }
    }
    check("§3a ⭐ tel yolu literali yalnız sözleşmede (uçlar SYNC_PATHS'ten)", yolIhlali.length === 0, yolIhlali.slice(0, 5).join(" · "));
    check("§4a ⭐ sözleşmenin adı başka dosyada yeniden tanımlanmıyor", kopya.length === 0, kopya.slice(0, 5).join(" · "));
  }

  console.log("\n§5 katalog çapraz ölçümü (fabrika ↔ bulut özeti)");
  const ozetVar = existsSync(path.join(KOK, BULUT_OZETI));
  check(`§5 bulut özeti var (${BULUT_OZETI})`, ozetVar, ozetVar ? "" : "cd patron/sunucu && npx tsx scripts/test_katalog_ozeti.ts --yaz");
  const f = fabrikaKatalogu();
  const b = bulutKatalogu();
  check("§5a iki katalog da boş değil", f.kayitlar.length >= 20 && b.length >= 20, `${f.kayitlar.length} ↔ ${b.length}`);
  const fark = katalogFarki(f.kayitlar, f.anliklar, b);
  check("§5b ⭐ ad · tür · alt satır · kökte yasak alan · saklama alanı birebir", fark.length === 0, fark.slice(0, 6).join(" · "));
  check("§5c üstten saklamalı kalem ölçüldü (fatura-kalemi)", f.kayitlar.some((k) => k.usttenSaklama !== null));

  console.log("\n§6 uzlaştırma ebeveyn bağı (sözleşme ↔ iki katalog)");
  const bag = Object.entries(RECONCILE_PARENTS);
  const fabrikaBag = bag.filter(([c, r]) => {
    const p = RECORD_PROJECTIONS.find((x) => x.name === c);
    return !p || !RECORD_PROJECTIONS.some((x) => x.name === r.parent) || !p.columns.some((col) => col.wire === r.field);
  });
  check("§6a ⭐ her ebeveyn bağı fabrika kataloğunda çözülür (çocuk + üst belge + alan kolon)", bag.length >= 3 && fabrikaBag.length === 0, fabrikaBag.map(([c]) => c).join(","));
  const bulutBag = bag.filter(([c, r]) => {
    const k = b.find((x) => x.ad === c);
    return !k || k.ebeveyn !== `${r.parent}.${r.field}`;
  });
  const fazla = b.filter((k) => k.ebeveyn && !(k.ad in RECONCILE_PARENTS)).map((k) => k.ad);
  check("§6b ⭐ bulut kataloğunun kalem → üst belge bağı sözleşmeyle aynı (fazlası da yok)", bulutBag.length === 0 && fazla.length === 0, [...bulutBag.map(([c]) => c), ...fazla].join(","));
  const ustten = f.kayitlar.filter((k) => k.usttenSaklama && RECONCILE_PARENTS[k.ad]?.parent !== k.usttenSaklama).map((k) => k.ad);
  check("§6c fabrikanın üstten saklamalı kalemi sözleşmedeki ebeveynle aynı", ustten.length === 0, ustten.join(","));

  console.log("\n§7 fabrika projesi patron kaynağını içe aktarmaz");
  const patronIhlal: string[] = [];
  for (const kok of ["Teks-Erp/src", "Teks-Erp/scripts"]) {
    for (const p of tsDosyalari(path.join(KOK, kok))) {
      if (p === __filename) continue;
      for (const s of patronIceAktarimi(readFileSync(p, "utf8"))) patronIhlal.push(`${path.relative(KOK, p)}: ${s.trim()}`);
    }
  }
  check("§7a ⭐ Teks-Erp/src + scripts patron/sunucu|uygulama kaynağını içe aktarmaz (yalnız dosya okuması)", patronIhlal.length === 0, patronIhlal.slice(0, 3).join(" · "));

  console.log("\n§8 uzak rapor eşlemesi (fabrika REMOTE_REPORTS ↔ bulut REPORT_KEY_PERMISSION)");
  const uzakYol = path.join(KOK, UZAK_RAPORLAR);
  const fabrikaRapor = existsSync(uzakYol) ? uzakRaporIzinleri(readFileSync(uzakYol, "utf8")) : {};
  const bulutRapor = bulutRaporIzinleri();
  check("§8a iki eşleme de okundu (≥ 1 rapor)", Object.keys(fabrikaRapor).length >= 1 && Object.keys(bulutRapor).length >= 1, `${Object.keys(fabrikaRapor).length} ↔ ${Object.keys(bulutRapor).length}`);
  const raporFark = raporIzinFarki(fabrikaRapor, bulutRapor);
  check("§8b ⭐ aynı rapor kümesi, rapor başına aynı izin (iki yönlü)", raporFark.length === 0, raporFark.slice(0, 6).join(" · "));

  console.log("\n✓K kalıcı sondalar (sentetik)");
  check("✓K1 zod dışı içe aktarım ısırır · zod susar", iceAktarimlar('import { z } from "zod";\nimport x from "../lib/db";').join() === "zod,../lib/db" && iceAktarimlar('import { z } from "zod";').join() === "zod");
  check("✓K2 tel yolu literali ısırır · SYNC_PATHS kullanımı susar", telYollari('post(base + "/v1/gelen-kutusu/al")').length === 1 && telYollari("post(SYNC_PATHS.INBOX_CLAIM)").length === 0);
  check("✓K3 kopya tanım ısırır", tanimlananAdlar("export const OrderMessageSchema = z.object({});\nconst ic = 1;").join() === "OrderMessageSchema");
  const temizF: FabrikaKaydi[] = [{ ad: "cari-kart", tur: "BOYUT", alanlar: [{ tel: "ad", sinif: "ISLEM" }, { tel: "telefon", sinif: "KISISEL" }], saklama: [], usttenSaklama: null }];
  const temizB: BulutKaydi[] = [{ ad: "cari-kart", tur: "BOYUT", altSatirlar: ["kisisel"], kokteYasak: ["telefon"], saklama: [], usttenSaklama: null }];
  const yasakYok: BulutKaydi[] = [{ ...temizB[0]!, kokteYasak: [] }];
  const saklamaFarki: BulutKaydi[] = [{ ...temizB[0]!, saklama: ["olusturulma"] }];
  check(
    "✓K4 katalog: kökte yasak eksik ısırır · saklama farkı ısırır · eksik projeksiyon ısırır · özdeş susar",
    katalogFarki(temizF, [], yasakYok).length > 0 &&
      katalogFarki(temizF, [], saklamaFarki).length > 0 &&
      katalogFarki(temizF, ["ozet.stok"], temizB).length > 0 &&
      katalogFarki(temizF, [], temizB).length === 0,
  );
  check(
    "✓K5 patron içe aktarımı ısırır (dinamik · statik) · dosya okuması susar",
    patronIceAktarimi('const m = await import(path.join(KOK, "patron/sunucu/src/wire/esitleme.ts"));').length === 1 &&
      patronIceAktarimi('import { x } from "../../patron/uygulama/src/api/wire";').length === 1 &&
      patronIceAktarimi('JSON.parse(readFileSync(path.join(KOK, "patron/sunucu/src/wire/esitleme.ts"), "utf8"));').length === 0,
  );
  const ornek = 'export const REMOTE_REPORTS: readonly RemoteReport[] = [\n  { key: "a/b", permission: "bulut:x:oku", run: () => 1 },\n];';
  check(
    "✓K6 rapor eşlemesi: AST okur · izin farkı ısırır · eksik/fazla anahtar ısırır · boş eşleme ısırır · özdeş susar",
    JSON.stringify(uzakRaporIzinleri(ornek)) === JSON.stringify({ "a/b": "bulut:x:oku" }) &&
      raporIzinFarki({ "a/b": "bulut:x:oku" }, { "a/b": "bulut:y:oku" }).length === 1 &&
      raporIzinFarki({ "a/b": "bulut:x:oku" }, { "a/b": "bulut:x:oku", "a/c": "bulut:x:oku" }).length === 1 &&
      raporIzinFarki({}, { "a/b": "bulut:x:oku" }).length > 0 &&
      raporIzinFarki({ "a/b": "bulut:x:oku" }, { "a/b": "bulut:x:oku" }).length === 0,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

try {
  main();
} catch (err) {
  console.error(`❌ bekçi çöktü: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
}
