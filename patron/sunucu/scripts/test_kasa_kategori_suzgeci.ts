// =============================================================================
// KASA KATEGORİ SÜZGECİ BEKÇİSİ (D4-KUC3c; DALGA4 §9.8) — patron kasa listesi `GET /api/veri/kasa-hareketi?kategoriAnahtari=`:
//   §1 ⭐ süzgeç SUNUCUDA, fabrikanın anahtarıyla birebir eşitlik: yalnız o kategorinin satırları; benzer yazım
//      (boşluklu/küçük harf) ve anahtarsız ESKİ satır gelmez; kategorisiz anahtar (`CAT:`) ayrı süzülür
//   §2 kapılar: beyansız projeksiyon 400 · azamiden uzun değer 400 (sessiz kırpma yok) · başka tesis sızmaz
//   §3 imleç süzgeçle devam eder (sayfalar kesişmez, eşleşmeyen sızmaz)
//   §4 ⭐ bulut hesap yapmaz: anahtar ifadesi yalnız `r.data->>'<anahtar>'` (kırpma/katlama/aritmetik YOK) ·
//      anahtar adı patron/sunucu `src/`inde yalnız tel + veri servisinde · beyan ↔ fabrika kataloğu türetilmiş alanı
//   §5 `/oturum` liste yeteneği `anahtarSuzgecleri` beyanın kendisi
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31): KEY_FIELD_SQL'e `btrim(...)` → §4a ❌; keyFilters çağrısı listeden
//    çıkarıldı (süzgeç yok sayılır) → §1a/§1b/§1d/§2a/§2b/§3a ❌; geri alındı → yeşil.
// Koşum: npx tsx scripts/test_kasa_kategori_suzgeci.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROLE_TEMPLATES } from "../src/catalog/permissions";
import { ANAHTAR_SUZGEC_AZAMI, LIST_KEY_FILTER_KEYS, LIST_KEY_FILTERS, type FacilityStatus } from "../src/wire/api";
import { api, girdi, hesapKur, imzali, kontrol, ortamKur, paket, sonuc, temizleTesis, tesisKur, type Ortam, type TestHesabi, type TestKurulumu } from "./lib/test-ortam";

type Liste = { kayitlar: { id: string }[]; sonraki: string | null };
const P = "kasa-hareketi";
const MAAS = "CAT:Maaş";
const SUNUCU = join(__dirname, "..");

interface Ids {
  readonly maas: readonly string[];
  readonly kira: string;
  readonly kucuk: string;
  readonly eski: string;
  readonly kategorisiz: string;
}

async function fikstur(o: Ortam, k: TestKurulumu): Promise<Ids> {
  const w = { t: new Date(o.saat.simdi() - 60_000).toISOString(), k: "000000000001" };
  const ids = { maas: [randomUUID(), randomUUID(), randomUUID()], kira: randomUUID(), kucuk: randomUUID(), eski: randomUUID(), kategorisiz: randomUUID() };
  const gun = (i: number) => new Date(o.saat.simdi() - (i + 1) * 86_400_000).toISOString();
  const satir = (id: string, i: number, kategori: string | null, anahtar?: string) => ({
    id, belgeNo: `KH-${i}`, tur: "EXPENSE", yon: "OUT", durum: "ACTIVE", doviz: "TRY", tarih: gun(i), kategori, olusturulma: gun(i),
    ...(anahtar !== undefined ? { kategoriAnahtari: anahtar } : {}),
  });
  const yaz = [
    ...ids.maas.map((id, i) => satir(id, i, i === 1 ? "  Maaş " : "Maaş", MAAS)),
    satir(ids.kira, 5, "Kira", "CAT:Kira"),
    satir(ids.kucuk, 6, "maaş", "CAT:maaş"),
    satir(ids.eski, 7, "Maaş"), // eski fabrika satırı: anahtar yok
    satir(ids.kategorisiz, 8, null, "CAT:"),
  ];
  const r = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(o.saat.simdi() - 60_000), kayitlar: [girdi(P, { yaz, yeni: w, katalogSurum: 2 })] }) });
  if (r.status !== 200 || (r.json as unknown as { ret: unknown[] }).ret.length > 0) throw new Error(`fikstür: ${r.status} ${JSON.stringify(r.json)}`);
  return ids;
}

async function liste(o: Ortam, h: TestHesabi, p: string, sorgu: Record<string, string>) {
  const r = await api(o, "GET", `/api/veri/${p}?${new URLSearchParams(sorgu).toString()}`, { belirtec: h.belirtec });
  const d = r.json.data as Liste | undefined;
  return { status: r.status, kod: r.json.details?.code, ids: new Set((d?.kayitlar ?? []).map((x) => x.id)), sonraki: d?.sonraki ?? null };
}

const ayni = (a: Set<string>, b: readonly string[]): boolean => a.size === b.length && b.every((x) => a.has(x));

async function suzme(o: Ortam, h: TestHesabi, ids: Ids, yabanci: Ids): Promise<void> {
  console.log("\n§1 süzgeç sunucuda · §2 kapılar");
  const maas = await liste(o, h, P, { kategoriAnahtari: MAAS });
  kontrol("§1a ⭐ kategoriAnahtari=CAT:Maaş → yalnız o anahtarın 3 satırı (boşluklu yazım fabrikada aynı anahtar)", maas.status === 200 && ayni(maas.ids, ids.maas), `${maas.status} ${maas.ids.size}`);
  kontrol("§1b ⭐ küçük harfli başka anahtar, anahtarsız eski satır ve başka kategori gelmez",
    !maas.ids.has(ids.kucuk) && !maas.ids.has(ids.eski) && !maas.ids.has(ids.kira));
  const tum = await liste(o, h, P, {});
  kontrol("§1c süzgeçsiz liste hepsini döker (eski satır dahil)", tum.status === 200 && tum.ids.size === 7 && tum.ids.has(ids.eski), `${tum.ids.size}`);
  const bos = await liste(o, h, P, { kategoriAnahtari: "CAT:" });
  kontrol("§1d kategorisiz anahtar (CAT:) yalnız kategorisiz satırı süzer", ayni(bos.ids, [ids.kategorisiz]), `${bos.ids.size}`);
  const beyansiz = await liste(o, h, "kasa", { kategoriAnahtari: MAAS });
  kontrol("§2a ⭐ beyansız projeksiyonda kategoriAnahtari → 400", beyansiz.status === 400 && beyansiz.kod !== undefined, `${beyansiz.status}`);
  const uzun = await liste(o, h, P, { kategoriAnahtari: `CAT:${"x".repeat(ANAHTAR_SUZGEC_AZAMI)}` });
  kontrol("§2b azamiden uzun anahtar → 400 (sessiz kırpma yok)", uzun.status === 400, `${uzun.status}`);
  kontrol("§2c ⭐ başka tesisin aynı anahtarlı satırı görünmez (tesis yalıtımı)", !yabanci.maas.some((x) => maas.ids.has(x)));
}

async function imlec(o: Ortam, h: TestHesabi, ids: Ids): Promise<void> {
  console.log("\n§3 imleç");
  const gorulen = new Set<string>();
  let sonraki: string | null = null;
  let kesisme = false;
  let sayfa = 0;
  do {
    const r = await liste(o, h, P, { kategoriAnahtari: MAAS, limit: "1", ...(sonraki ? { imlec: sonraki } : {}) });
    for (const x of r.ids) {
      if (gorulen.has(x)) kesisme = true;
      gorulen.add(x);
    }
    sonraki = r.sonraki;
    sayfa++;
  } while (sonraki && sayfa < 10);
  kontrol("§3a ⭐ imleç süzgeçle devam eder: 3 sayfa, kesişmez, eşleşmeyen sızmaz", sayfa === 3 && !kesisme && ayni(gorulen, ids.maas), `${sayfa} sayfa ${gorulen.size}`);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : /\.tsx?$/.test(n) ? [f] : [];
  });
}

function statik(): void {
  console.log("\n§4 bulut hesap yapmaz (statik)");
  const servis = readFileSync(join(SUNUCU, "src/services/data.service.ts"), "utf8");
  const blok = /const KEY_FIELD_SQL[^{]*\{([\s\S]*?)\n\};/.exec(servis)?.[1] ?? "";
  const satirlar = blok.split("\n").map((x) => x.trim()).filter(Boolean);
  const bozuk = satirlar.filter((x) => {
    const m = /^(\w+): Prisma\.sql`r\.data->>'(\w+)'`,$/.exec(x);
    return !m || m[1] !== m[2];
  });
  kontrol("§4a ⭐ anahtar ifadesi yalnız saklı alanın kendisi (kırpma/katlama/aritmetik YOK), anahtar = alan adı",
    satirlar.length === LIST_KEY_FILTER_KEYS.length && bozuk.length === 0, bozuk.join(" | ") || `${satirlar.length} ifade`);
  const izinli = new Set(["src/wire/api.ts", "src/services/data.service.ts"]);
  const disari = walk(join(SUNUCU, "src")).filter((f) => LIST_KEY_FILTER_KEYS.some((k) => readFileSync(f, "utf8").includes(k))).map((f) => relative(SUNUCU, f)).filter((f) => !izinli.has(f));
  kontrol("§4b anahtar adları patron/sunucu src'de yalnız tel + veri servisinde", disari.length === 0, disari.join(", ") || "temiz");
  const fabrika = readFileSync(join(SUNUCU, "..", "..", "Teks-Erp", "src", "cloud-sync", "catalog-facts.ts"), "utf8");
  const eksik = LIST_KEY_FILTER_KEYS.flatMap((k) => LIST_KEY_FILTERS[k].filter((p) => {
    const b = fabrika.split(/\bname: "/).find((x) => x.startsWith(`${p}"`)) ?? "";
    return !b.includes(`derived("${k}",`);
  }).map((p) => `${k}:${p}`));
  kontrol("§4c ⭐ beyanlı her projeksiyonda alan FABRİKADA türetilir (catalog-facts derived)", eksik.length === 0, eksik.join(", ") || "temiz");
}

async function yetenek(o: Ortam, h: TestHesabi): Promise<void> {
  console.log("\n§5 /oturum yeteneği");
  const r = await api(o, "GET", "/api/oturum", { belirtec: h.belirtec });
  const l = (r.json.data as FacilityStatus | undefined)?.liste;
  kontrol("§5a `/oturum` anahtarSuzgecleri beyanın kendisi", r.status === 200 && JSON.stringify(l?.anahtarSuzgecleri) === JSON.stringify(LIST_KEY_FILTERS), `${r.status} ${JSON.stringify(l?.anahtarSuzgecleri)}`);
}

async function main(): Promise<void> {
  statik();
  const o = await ortamKur();
  const k = await tesisKur(o);
  const k2 = await tesisKur(o);
  try {
    const ids = await fikstur(o, k);
    const yabanci = await fikstur(o, k2);
    const h = await hesapKur(o, k.tesisId, ROLE_TEMPLATES.PATRON);
    await suzme(o, h, ids, yabanci);
    await imlec(o, h, ids);
    await yetenek(o, h);
  } finally {
    await temizleTesis(o, k.tesisId);
    await temizleTesis(o, k2.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
