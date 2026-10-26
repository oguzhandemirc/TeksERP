// =============================================================================
// BEKÇİ — S5 kumaş adı ayıklama: saf kurallar + betik kapıları (DB'siz)
// =============================================================================
// Ölçtüğü: `scripts/lib/kumas-adi-ayiklama.ts` plan vektörlerini doğru ayıklar ve
// fabrikanın 145 aktif kumaş adında (2026-10-21 prova kopyası) sınıf dağılımı
// araştırma tablosuyla (veri.md §3) BİREBİR aynıdır; kart önerisi, CSV gidiş-dönüşü ve S5c
// uygulama planı (DOKUNULMAZ / iplik kalemi atlaması). `dokuma-urun-adi-ayikla.ts`
// kapıları DB'ye BAĞLANMADAN durur: DATABASE_URL yok · üretim adı · tanınmayan
// argüman · `--apply` `_test` dışı ad · `--apply` `--kabul`süz. Betik `.env` yükleyen
// `src/lib/prisma`yı içe aktarmaz.
//
// Ölçmediği: gerçek DB okuması (S5b prova koşumu) ve S2 yazımı (TODO(S2)).
//
// NEGATİF SONDA (2026-10-21): ① lib'de parantezli çözgü kalıbı etkisizleştirildi →
// §1 1015 vektörü + §2 dağılım ❌ · ② betikte `_test` kapısı silindi → §6c ❌.
// =============================================================================
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cocukOrtami } from "./lib/hedef-db-kapisi";
import {
  atkiKartiOner, ayikla, csvOku, csvYaz, kabulKimlikleri, kokNormal, uygulamaPlani,
  type OneriSatiri,
} from "./lib/kumas-adi-ayiklama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

// Fabrika yedeğinin prova kopyasındaki 145 AKTİF FABRIC kalem adı (2026-10-21, veri.md).
const AKTIF_ADLAR: readonly string[] = [
  "300TXTR NEGATİF", "1015 ALTIN SİMLİ (SİYAH ÇÖZGÜ)", "1015 GÜMÜŞ SİMLİ (BEYAZ ÇÖZGÜ)",
  "1015-ALTIN SİMLİ (BEYAZ ÇÖZGÜ)", "1015-BEYAZ SADE ÇELİK SİMSİZ (SİYAH ÇÖZGÜ)",
  "1015-BEYAZ SİMSİZ (BEYAZ ÇÖZGÜ)", "1015-GÜMÜŞ SİMLİ (SİYAH ÇÖZGÜ)", "1059", "1093", "2024", "3017",
  "7231", "7308", "8147", "18152", "20011", "318980", "ACTIVO", "ACTİVO BEYAZ -(BEYAZ GÜMÜŞ)",
  "ACTİVO BEYAZ-(BEYAZ ALTIN)", "ACTİVO BEYAZ-(KREM ALTIN )", "ACTİVO BEYAZ-(KREM GÜMÜŞ)",
  "ACTİVO SİYAH-( KREM GÜMÜŞ)", "ACTİVO SİYAH-(BEYAZ ALTIN)", "ACTİVO SİYAH-(BEYAZ GÜMÜŞ)",
  "ACTİVO SİYAH-(KREM ALTIN)", "ACTİVO SİYAH-EKRU ALTIN", "ADEL", "ALP", "ALP ALTIN", "ALP GÜMÜŞ",
  "ALP SEDEF", "ALP SİMLİ ŞEFFAF SİM", "ALP SİMLİ ŞEFFAF SİM ALTIN", "ALP SİMLİ ŞEFFAF SİM GÜMÜŞ",
  "ALP ŞEFFAF", "ANNA", "ARTEMİS", "ASAL", "ASANTE", "ASC 01 ALTIN", "ASC 01 GÜMÜŞ", "ASC-01", "BAMBU",
  "BAMBU SİMLİ", "BAYRO FLAM", "BAYRO SİMLİ", "BELARUS", "BELLE", "BERMUDA", "BGR 150 ALTIN",
  "BGR 150 GÜMÜŞ", "BGR 150 KREM", "BGR 150 SEDEF", "BGR 150 ŞEFFAF", "BORANCIK", "CANVAS", "CLASSİC VOİLE",
  "ÇELIK", "DNR-9000", "DOMAS", "EDOL ALTIN", "EDOL GÜMÜŞ", "EDOL ŞEFFAF", "EGE", "ELİSADO", "ELİSADO-NOPE",
  "GALİNA", "GENİŞ ALP SADE", "GENİŞ KREP", "GENİŞ NEPS VUAL", "GENİŞ TTM", "GENİŞ TURLU", "GRANADA", "HERA",
  "HERA -GÜMÜŞ", "HERA -SEDEF", "HERA -ŞEFFAF", "HERA-ALTIN", "HERMES", "İPEK KREP", "İROLANA", "JUSTE",
  "KREP", "KRİSTAL", "KRİSTAL -ALTIN", "KRİSTAL -GÜMÜŞ", "KRİSTAL ALTIN -BEJ", "KRİSTAL ALTIN -EKRU",
  "KRİSTAL GÜMÜŞ -EKRU", "KRİSTAL GÜMÜŞ -GRİ", "KRİSTAL GÜMÜŞ-BEYAZ", "KRİSTAL-ŞEFFAF", "LENA", "LENOR",
  "LİNA", "LİNEN", "LİNEN FOLDET", "LİNUS", "MABEL", "MAT DÖNER", "MC-157", "MC-158", "MC-159", "MC-165",
  "MİKRO CANVAS", "MİTRA", "MONİCA", "MRT04", "NEPS VUAL", "NUMUNE", "OSLO", "OSLO ALTIN", "OSLO GÜMÜŞ",
  "PANDORA", "PANOS", "PERA", "PIRILTI KREP", "PİRAMİT- ALTIN", "PİRAMİT-GÜMÜŞ", "PİRAMİT-ŞEFFAF",
  "POPERMAN", "POPERMAN SİMLİ", "ROMA", "ROSİN", "SABLE", "SAHARİNKA", "SAMARA", "SAMARA ALTIN",
  "SAMARA GÜMÜŞ", "SAMARA ŞEFFAF", "SEFA", "SİMLİ LİNEN FOLDET", "SİMLİ NEPS VUAL", "STELLA", "ŞANTUK",
  "TAY BAMBU", "TEDY", "TERAS", "TERGAL", "TOROS", "TTM BAMBU", "TTM PİRAMİT", "VİCTORİA", "ZELLA",
];

/** veri.md §3 — aktif sütun. */
const BEKLENEN_DAGILIM: Readonly<Record<string, number>> = {
  KOK: 62,
  "KOK+ATKI/SIM": 42,
  "KOK+COZGU+ATKI/SIM": 15,
  "EN+KOK": 4,
  "EN+KOK+ATKI/SIM": 1,
  "YALNIZ-KOD": 17,
  OZEL: 1,
  "?": 3,
};

function vektor(ad: string, beklenen: Partial<ReturnType<typeof ayikla>>): void {
  const a = ayikla(ad);
  const farklar = Object.entries(beklenen).filter(([k, v]) => a[k as keyof typeof a] !== v);
  check(
    `"${ad}" → ${Object.entries(beklenen).map(([k, v]) => `${k}=${String(v)}`).join(" · ")}`,
    farklar.length === 0,
    farklar.map(([k]) => `${k}=${String(a[k as keyof typeof a])}`).join(" · "),
  );
}

const BETIK = join(__dirname, "dokuma-urun-adi-ayikla.ts");
const TSX = join(__dirname, "..", "node_modules", "tsx", "dist", "cli.mjs");
/** Betiği DB'siz koşturur; host:1 — kapı DB'den önce durmazsa bağlantı hatası farklı metin basar. */
function kos(argv: string[], dbUrl: string | null): { kod: number | null; cikti: string } {
  const env = cocukOrtami(dbUrl ? { DATABASE_URL: dbUrl } : {});
  if (!dbUrl) delete env.DATABASE_URL;
  delete env.NODE_ENV;
  delete env.APP_ENV;
  const r = spawnSync(process.execPath, [TSX, BETIK, ...argv], {
    cwd: join(__dirname, ".."), env, encoding: "utf8", timeout: 60_000,
  });
  return { kod: r.status, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function main(): void {
  console.log("=== S5 KUMAŞ ADI AYIKLAMA ===\n");

  console.log("§1 plan vektörleri");
  vektor("1015-GÜMÜŞ SİMLİ (SİYAH ÇÖZGÜ)", { sinif: "KOK+COZGU+ATKI/SIM", kok: "1015", cozguRengi: "SİYAH", atkiSim: "GÜMÜŞ SİMLİ", oneriCozguKarti: "ÇÖZGÜ SİYAH", oneriAtkiKarti: "GÜMÜŞ SİM" });
  vektor("ACTİVO SİYAH-(BEYAZ GÜMÜŞ)", { sinif: "KOK+COZGU+ATKI/SIM", kok: "ACTİVO", cozguRengi: "SİYAH", atkiSim: "BEYAZ GÜMÜŞ" });
  vektor("ACTİVO BEYAZ-(KREM ALTIN )", { kok: "ACTİVO", cozguRengi: "BEYAZ", atkiSim: "KREM ALTIN", oneriAtkiKarti: "ALTIN SİM" });
  vektor("GENİŞ ALP SADE", { sinif: "EN+KOK+ATKI/SIM", en: "GENİŞ", kok: "ALP", atkiSim: "SADE", oneriAtkiKarti: "SADE" });
  vektor("TERAS V-06", { sinif: "KOK+VARYANT", kok: "TERAS", varyant: "V-06", dokunulmaz: true, oneriAtkiKarti: "" });
  vektor("MRT04 V-ALTIN", { sinif: "KOK+VARYANT", kok: "MRT 04", varyant: "V-ALTIN", dokunulmaz: true });
  vektor("BGR150", { sinif: "YALNIZ-KOD", kok: "BGR 150" });
  vektor("BGR 150 KREM", { sinif: "KOK+ATKI/SIM", kok: "BGR 150", atkiSim: "KREM", oneriAtkiKarti: "" });
  vektor("HERA -GÜMÜŞ", { sinif: "KOK+ATKI/SIM", kok: "HERA", atkiSim: "GÜMÜŞ" });
  vektor("PİRAMİT- ALTIN", { kok: "PİRAMİT", atkiSim: "ALTIN" });
  vektor("KRİSTAL ALTIN -BEJ", { sinif: "KOK+ATKI/SIM", kok: "KRİSTAL", atkiSim: "ALTIN-BEJ", oneriAtkiKarti: "ALTIN SİM" });
  vektor("20011", { sinif: "YALNIZ-KOD", kok: "20011" });
  vektor("QUALİTY 07", { sinif: "YALNIZ-KOD", kok: "QUALİTY 07" });
  vektor("ALP-6150", { sinif: "KOK+KOD", kok: "ALP-6150" });
  vektor("BEYAZ GÜMÜŞ", { sinif: "RENK-ADI", atkiSim: "BEYAZ GÜMÜŞ", dokunulmaz: true });
  vektor("NUMUNE", { sinif: "OZEL", oneriAtkiKarti: "" });
  vektor("BAYRO FLAM", { sinif: "?", oneriAtkiKarti: "" });
  vektor("SİMLİ NEPS VUAL", { sinif: "KOK+ATKI/SIM", kok: "NEPS VUAL", atkiSim: "SİMLİ" });
  vektor("1015-BEYAZ SADE ÇELIK SİMSİZ (SİYAH ÇÖZGÜ)", { kok: "1015", atkiSim: "BEYAZ SADE ÇELİK SİMSİZ", oneriAtkiKarti: "SADE" });
  vektor("ÇELIK", { sinif: "KOK", kok: "ÇELİK" });
  vektor("ACTIVO", { sinif: "KOK", kok: "ACTİVO" });
  vektor("MIKROCANVAS", { sinif: "KOK", kok: "MİKRO CANVAS" });
  vektor("PIRILTI KREP", { sinif: "KOK", kok: "PIRILTI KREP", atkiSim: "" });
  check("kokNormal: ASC-01 → ASC 01", kokNormal("ASC-01") === "ASC 01");
  check("atkı kartı: çoklu işaret → boş + not", (() => { const o = atkiKartiOner("SİMLİ ŞEFFAF SİM ALTIN"); return o.kart === "" && o.not.includes("çoklu"); })());

  console.log("\n§2 145 aktif adda sınıf dağılımı = veri.md §3");
  const dag: Record<string, number> = {};
  for (const ad of AKTIF_ADLAR) {
    const s = ayikla(ad).sinif;
    dag[s] = (dag[s] ?? 0) + 1;
  }
  check("körlük zemini: 145 ad", AKTIF_ADLAR.length === 145, String(AKTIF_ADLAR.length));
  const anahtarlar = new Set([...Object.keys(dag), ...Object.keys(BEKLENEN_DAGILIM)]);
  for (const k of anahtarlar) {
    check(`sınıf ${k}: ${BEKLENEN_DAGILIM[k] ?? 0}`, (dag[k] ?? 0) === (BEKLENEN_DAGILIM[k] ?? 0), `ölçülen ${dag[k] ?? 0}`);
  }
  check(
    "KARAR BEKLER (?) = BAYRO FLAM · 300TXTR NEGATİF · ELİSADO-NOPE",
    AKTIF_ADLAR.filter((a) => ayikla(a).sinif === "?").sort().join("|") === ["300TXTR NEGATİF", "BAYRO FLAM", "ELİSADO-NOPE"].join("|"),
  );

  console.log("\n§3 CSV gidiş-dönüş + kabul");
  const satir = (id: string, ad: string, top = 0): OneriSatiri => ({
    itemId: id, code: `K-${id}`, name: ad, isActive: true, lifecycleStatus: "ACTIVE",
    topSayisi: top, renkSayisi: 0, ayiklama: ayikla(ad),
  });
  const satirlar = [
    satir("a1", "1015-GÜMÜŞ SİMLİ (SİYAH ÇÖZGÜ)", 41), satir("a2", "HERA -GÜMÜŞ"),
    satir("a3", "TERAS V-06"), satir("a4", "BAYRO FLAM", 457), satir("a5", 'TEST "TIRNAK", VİRGÜL'),
  ];
  const csv = csvYaz(satirlar);
  const geri = csvOku(csv);
  check("başlık sütunları sözleşmedeki sırada", csv.split("\n")[0] === "itemId,code,name,isActive,lifecycleStatus,topSayisi,renkSayisi,sinif,kok,cozguRengi,atkiSim,varyant,en,oneriCozguKarti,oneriAtkiKarti,KARAR");
  check("tırnak/virgüllü ad gidiş-dönüşte bozulmaz", geri[4]?.name === 'TEST "TIRNAK", VİRGÜL');
  check("KARAR sütunu boş doğar", geri.every((r) => r.KARAR === ""));
  const kabulCsv = csv.split("\n").map((l, i) => (i === 0 || !l ? l : l.replace(/,$/, i <= 4 ? ",KABUL" : ",RED"))).join("\n");
  const kabul = kabulKimlikleri(kabulCsv);
  check("yalnız KARAR=KABUL satırları seçilir", [...kabul].sort().join(",") === "a1,a2,a3,a4", [...kabul].join(","));
  let hata = "";
  try { kabulKimlikleri("code,name\nx,y\n"); } catch (e) { hata = (e as Error).message; }
  check("KARAR/itemId sütunsuz kabul CSV reddedilir", hata.includes("zorunlu"));

  console.log("\n§4 S5c uygulama planı");
  const plan = uygulamaPlani(satirlar, new Set([...kabul, "yok-id"]));
  check("atkı kartı olan KABUL yazılır (a1, a2)", plan.yazilacak.map((p) => p.satir.itemId).sort().join(",") === "a1,a2");
  check("çözgü kartı → 'iplik kalemi yok' diye atlanır (a1)", plan.atlanan.some((a) => a.satir.itemId === "a1" && a.sebep.includes("iplik kalemi yok")));
  check("DOKUNULMAZ varyant KABUL'de bile atlanır (a3)", plan.atlanan.some((a) => a.satir.itemId === "a3" && a.sebep.includes("DOKUNULMAZ")));
  check("KARAR BEKLER (?) atlanır (a4)", plan.atlanan.some((a) => a.satir.itemId === "a4"));
  check("hedefte olmayan itemId listelenir", plan.bulunamayan.join(",") === "yok-id");

  console.log("\n§5 statik: `.env` yükleyen prisma içe aktarılmaz, ad/kod yazılmaz");
  const kod = readFileSync(BETIK, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  check("betik `src/lib/prisma` içe aktarmıyor", !/src\/lib\/prisma["']/.test(kod));
  check("betikte UPDATE/INSERT/DELETE SQL'i yok (yazım yalnız S2 servis dalında)", !/\b(UPDATE|INSERT INTO|DELETE FROM)\b/.test(kod));
  check("S2 yazım dalı TODO(S2) ile kapalı ve 'S2 inmedi' ile duruyor", readFileSync(BETIK, "utf8").includes("TODO(S2)") && kod.includes("S2 inmedi"));

  console.log("\n§6 betik kapıları DB'ye bağlanmadan durur");
  const URL_TEST = "postgresql://x:y@localhost:1/tekserp_s5sonda_test";
  const URL_DEV = "postgresql://x:y@localhost:1/tekserp_s5sonda_dev";
  const r1 = kos([], null);
  check("6a DATABASE_URL yok → exit 1 'DATABASE_URL ver'", r1.kod === 1 && r1.cikti.includes("DATABASE_URL ver"), `kod ${r1.kod}`);
  const r2 = kos(["--apply"], URL_TEST);
  check("6b --apply --kabul'süz → exit 1", r2.kod === 1 && r2.cikti.includes("--kabul"), `kod ${r2.kod}`);
  const r3 = kos(["--apply", "--kabul=/yok/kabul.csv"], URL_DEV);
  check("6c --apply '_test' dışı ad → exit 1 (prova kapısı)", r3.kod === 1 && r3.cikti.includes("'_test' ile biten"), `kod ${r3.kod}`);
  const r4 = kos(["--apply", '--canli-onay=sabah onayliyorum uygula'], URL_DEV);
  check("6d --canli-onay prova kapısını açar, kabul kapısı yine durur", r4.kod === 1 && r4.cikti.includes("PROVA DIŞI") && r4.cikti.includes("--kabul"), `kod ${r4.kod}`);
  const r5 = kos([], "postgresql://x:y@localhost:1/tekserp");
  check("6e üretim adı (tekserp) → exit 1, kuru koşumda bile", r5.kod === 1 && r5.cikti.includes("ÜRETİM"), `kod ${r5.kod}`);
  const r6 = kos([], "postgresql://x:y@localhost:1/tekserp_fabrika_0923");
  check("6f fabrika yedeği adı → exit 1 (geliştirme kapısı)", r6.kod === 1 && r6.cikti.includes("TANINMAYAN AD"), `kod ${r6.kod}`);
  const r7 = kos(["--uygula"], URL_TEST);
  check("6g tanınmayan argüman → exit 1", r7.kod === 1 && r7.cikti.includes("tanınmayan argüman"), `kod ${r7.kod}`);
  check("6h hiçbir kapı DB'ye bağlanmayı denemedi", ![r1, r2, r3, r4, r5, r6, r7].some((r) => r.cikti.includes("HATA:")));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
