// =============================================================================
// BEKÇİ — DEFTERE YAZAN HER YOLUN TERS YOLU BEYAN EDİLMİŞ Mİ
// Çalıştır: npx tsx scripts/run-all-tests.ts defter_ters_yol
// =============================================================================
// NEDEN: kural yazılıydı, KAPISI YOKTU. "Deftere yazan her ileri kaynağın ters
// yolu olmalı" cümlesi 2026-09-13'e kadar hiçbir şey tarafından ölçülmüyordu —
// kapısız bir kural bir niyet beyanıdır ([DB-35]).
//
// NEDEN BEYAN, NEDEN ÇIKARIM DEĞİL: ters yolun TEK biçimi yok. Dört mekanizma
// ölçüldü (damga · ters bağ · tipli enum çifti · net karşı olay) ve "her ileriye
// `*_CANCEL`" gibi tek kurallı bir kapı EN AZ ALTI yanlış kırmızı üretir:
// `ADJUST`ın tersi net ters `ADJUST`, `TRANSFORM`un tersi karşı grup,
// `RollVariance`ın tersi damga. Dahası `WarehouseEventType.*_REVERSAL` değerleri
// BETİMLEYİCİDİR — "bu satır ters kayıt mı" sorusunun tek cevabı
// `reversesMovementId IS NOT NULL` (helper şerhi, tasarım §D2a). Enum adına bakan
// bir ölçüm 13 değerin 9'una "tersi yok" der ve altısında YANILIR.
//
// KAPI NE YAPAR: beyanı ŞEMAYA ve KODA karşı doğrular. Beyan tek başına bir
// iddiadır; burada her satırı yanlışlanabilir bir ölçüm karşılar.
//
// ÖLÇÜLENLER
//   §1 EVREN — her append-only model beyan tablosunda SINIFLANMIŞ mı (iki yönlü);
//      §1d beyanda model TEKİL mi (mükerrer satır sessiz sınıf değişimidir)
//   §2 "yarı" beyanı doğru mu (updatedAt gerçekten var/yok — ölü beyan kırmızı)
//   §3 Mekanizma ŞEMADA gerçek mi (kolon/enum değeri yeniden adlandırılırsa KIRMIZI)
//   §4 Ters yazan sembol var mı ve tanımı DIŞINDA referansı var mı (ölü ters yol);
//      §4c yazıcısı olan defterin ters yazıcısı da beyanlı mı (boş liste sessiz yeşildir)
//   §5 ⭐ Satır yaratan İLERİ yol kümesi beyanla BİREBİR mi (yeni yol → kırmızı,
//      ölü beyan → kırmızı). İç içe ilişki yazımı BAĞLAMSAL TİPTEN çözülür.
//   §6 Borç iki yönlü — mekanizma YOK ⇒ borç zorunlu; mekanizma BELİRDİYSE kırmızı
//   §7 Telemetri satırı KARAR UFKUNU beyan etmiş mi
//   §8 scripts/ ayrımı — fikstür KEŞİFLE muaf, diğer defter yazan script beyanlı
//   §9 Körlük zemini — kapsam DOLU mu, kaç yazım görüldü, tipi çözülemeyen kaç
//   §10 Deftere fiziksel silme — beyansız silme kırmızı (doktrin yasağı)
//   §11 "Ters yolu ebeveynindedir" çürütmesinin zayıf halkası: EBEVEYNİN ters yolu var mı
//   §12 "Saf yapılandırma pivotu" çürütmesinin zayıf halkası: miktar/para taşıyor mu
//   §13 ⭐ OLAY DÜZEYİ — §6'nın TANECİK ikizi. §1–§12 MODELİ ölçer; bir defterin
//      ters yolu olması HER OLAYININ ters yolu olduğunu söylemez. Bu kol her
//      `STOCK_MOVE_REASON` kodunun ters yolunu beyana karşı doğrular (evren iki
//      yönlü · atıflar katalogda gerçek mi · ileri↔ters SİMETRİK mi · beyanlı
//      kodun yazarı var mı). ⚠️ Kapsamı SEBEP KODU TAŞIYAN satırlardır.
//
// DB GEREKTİRMEZ: statik analiz (AST + tip denetleyicisi). Prisma istemcisi
// açılmaz, havuz kurulmaz.
// =============================================================================
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DEFTER_BEYANI, STOK_OLAY_BEYANI, type DefterBeyani } from "./lib/defter-beyan";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";
import { SILEN, defterYazimlariniTara, sembolReferanslari, tipliProgram } from "./lib/defter-yazim-tarama";
import { semaAlanlari } from "./revoke-ast-tarama";
import { walkTs } from "./lib/ts-tarama";

const KOK = join(__dirname, "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

/**
 * Fikstür muafiyeti KEŞİFLE kurulur: `run-all-tests.ts` `scripts/` KÖKÜNDEKİ
 * `test_*.ts`i koşar (özyinelemesiz) — yani muafiyetin ölçütü koşucunun kendi
 * süzgecidir, elle tutulan bir liste değil. `scripts/out/` koşucunun görmediği
 * iniş bekleyen sondalardır; `scripts/lib/` kütüphanedir.
 */
function fiksturMu(rel: string): boolean {
  return /^scripts\/test_[^/]+\.ts$/.test(rel) || rel.startsWith("scripts/out/") || rel.startsWith("scripts/lib/");
}

/** Doğrudan (funnel'ı atlayarak) defter yazan script'lerin SINIFI. */
const SCRIPT_SINIFI: Record<string, "SEED" | "DEMO" | "DENETIM_REPRO"> = {
  "scripts/seed-demo-shipments.ts": "SEED",
  "scripts/seed-kk2-test.ts": "SEED",
  "scripts/seed-load-scale.ts": "SEED",
  "scripts/seed-tambur-test-roll.ts": "SEED",
  "scripts/seed-test-full.ts": "SEED",
  "scripts/demo_kursun_planlama.ts": "DEMO",
  "scripts/demo_tambur_3parti.ts": "DEMO",
  "scripts/audit_repro_D-A-02.ts": "DENETIM_REPRO",
  "scripts/audit_repro_KYY-1-01.ts": "DENETIM_REPRO",
  "scripts/audit_repro_KYY-3-01.ts": "DENETIM_REPRO",
  "scripts/audit_repro_KYY-3-03.ts": "DENETIM_REPRO",
  "scripts/audit_repro_S-3-02.ts": "DENETIM_REPRO",
};

// ── şema okumaları ───────────────────────────────────────────────────────────
const semaMetni = readFileSync(join(KOK, "prisma", "schema.prisma"), "utf8");
const modelAlanlari = semaAlanlari(KOK);

/** Model → `@@map` tablo adı. */
const tabloAdi = new Map<string, string>();
/** Enum adı → değerler. */
const enumDegerleri = new Map<string, string[]>();
{
  let model: string | null = null;
  let enumAdi: string | null = null;
  for (const raw of semaMetni.split("\n")) {
    const l = raw.replace(/\/\/.*$/, "");
    const mm = /^model\s+(\w+)\s*\{/.exec(l);
    const me = /^enum\s+(\w+)\s*\{/.exec(l);
    if (mm) { model = mm[1]; continue; }
    if (me) { enumAdi = me[1]; enumDegerleri.set(enumAdi, []); continue; }
    if (/^\}/.test(l)) { model = null; enumAdi = null; continue; }
    if (model) { const mp = /@@map\("([^"]+)"\)/.exec(l); if (mp) tabloAdi.set(model, mp[1]); }
    if (enumAdi) { const v = l.trim(); if (/^[A-Z0-9_]+$/.test(v)) enumDegerleri.get(enumAdi)!.push(v); }
  }
}

const beyanMap = new Map(DEFTER_BEYANI.map((b) => [b.model, b]));
const defterler = DEFTER_BEYANI.filter((b) => b.sinif === "DEFTER");

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== §1 EVREN — her append-only model sınıflanmış mı ===");
const appendOnly = [...modelAlanlari]
  .filter(([, alan]) => alan.has("createdAt") && !alan.has("updatedAt"))
  .map(([m]) => m);
const yariBeyanlar = DEFTER_BEYANI.filter((b) => b.yari).map((b) => b.model);
const evren = new Set([...appendOnly, ...yariBeyanlar]);

const sinifsiz = [...evren].filter((m) => !beyanMap.has(m));
check("§1a her append-only model beyan tablosunda", sinifsiz.length === 0,
  sinifsiz.length ? `SINIFSIZ: ${sinifsiz.join(", ")} — yeni model defter mi pivot mu telemetri mi, BEYAN ET` : `${evren.size} model sınıflı`);

const oluBeyan = DEFTER_BEYANI.filter((b) => !modelAlanlari.has(b.model)).map((b) => b.model);
check("§1b beyandaki her model şemada var (ölü beyan yok)", oluBeyan.length === 0,
  oluBeyan.length ? `ŞEMADA YOK: ${oluBeyan.join(", ")}` : `${DEFTER_BEYANI.length} beyan satırı`);

const fazlaBeyan = DEFTER_BEYANI.filter((b) => modelAlanlari.has(b.model) && !evren.has(b.model)).map((b) => b.model);
check("§1c beyanda evren dışı model yok", fazlaBeyan.length === 0,
  fazlaBeyan.length ? `append-only DEĞİL ve "yarı" da denmemiş: ${fazlaBeyan.join(", ")}` : "");

// §1d — BEYANDA MODEL TEKİL. Kör nokta 01 tarafından ölçüldü (2026-09-13): 3-way
// apply aynı modeli İKİ KEZ beyana soktu, `new Map(DEFTER_BEYANI.map(...))`
// sonuncuyu aldı, öncekiler SESSİZ kaldı ve kapı 165/0 YEŞİL verdi. İki satır
// çelişirse (biri DEFTER biri PIVOT) hangisinin okunduğu DİZİ SIRASINA bağlıdır —
// sessiz sınıf değişimi. Tekillik beyanın kendisinin bir değişmezidir.
{
  const sayim = new Map<string, number>();
  for (const b of DEFTER_BEYANI) sayim.set(b.model, (sayim.get(b.model) ?? 0) + 1);
  const mukerrer = [...sayim].filter(([, n]) => n > 1).map(([m, n]) => `${m}×${n}`);
  check("§1d beyanda her model TEK satır", mukerrer.length === 0,
    mukerrer.length ? `MÜKERRER: ${mukerrer.join(", ")} — Map sonuncuyu alır, öncekiler SESSİZ; sınıf dizi sırasına bağlı kalır` : `${DEFTER_BEYANI.length} satır, ${sayim.size} model`);
}

console.log("\n=== §2 \"yarı\" beyanı iki yönlü ===");
for (const b of DEFTER_BEYANI) {
  const alan = modelAlanlari.get(b.model);
  if (!alan) continue;
  const updatedAtVar = alan.has("updatedAt");
  if (b.yari) check(`§2 ${b.model} "yarı" beyanı doğru`, updatedAtVar, updatedAtVar ? "updatedAt var" : "updatedAt YOK — beyan BAYAT, `yari` kaldırılmalı");
  else if (updatedAtVar) check(`§2 ${b.model} "yarı" beyanı eksik`, false, "updatedAt VAR ama beyanda `yari` yok");
}

console.log("\n=== §3 Mekanizma ŞEMADA gerçek mi ===");
for (const b of defterler) {
  const m = b.mekanizma!;
  const alan = modelAlanlari.get(b.model)!;
  if (m.tur === "DAMGA" || m.tur === "TERS_BAG" || m.tur === "DURUM_IPTAL") {
    check(`§3 ${b.model} ${m.tur} kolonu şemada`, alan.has(m.kolon),
      alan.has(m.kolon) ? m.kolon : `"${m.kolon}" YOK — kolon yeniden adlandırıldıysa kapı SESSİZ KALAMAZ`);
  } else if (m.tur === "ENUM_CIFTI" || m.tur === "KARSI_OLAY") {
    const degerler = enumDegerleri.get(m.enumAdi) ?? [];
    const eksik = m.ciftler.flat().filter((v) => !degerler.includes(v));
    check(`§3 ${b.model} ${m.enumAdi} çiftleri şemada`, degerler.length > 0 && eksik.length === 0,
      eksik.length ? `eksik değer: ${eksik.join(", ")}` : `${m.ciftler.length} çift`);
  }
}

console.log("\n=== §4 Ters yazan sembol var mı ve çağrılıyor mu ===");
const tsDosyalar = [...walkTs(join(KOK, "src")), ...walkTs(join(KOK, "scripts"))];
// TEK PROGRAM, DÖRT TÜKETİCİ — §4 (sembol referansları) · §5 (src yaratan) · §8 (scripts yaratan)
// · §10 (src silen). Programı her seferinde kurmak ve dosyaları yeniden parse etmek
// koşumu katlıyordu (ölçüldü 2026-09-13, yüklü makinede 52 sn → tek program 38 sn).
const PROGRAM = tipliProgram(KOK, "tsconfig.scripts.json");
const referanslar = sembolReferanslari(KOK, tsDosyalar, PROGRAM);
for (const b of defterler) {
  for (const t of b.tersYazan ?? []) {
    const kayit = referanslar.get(t.sembol);
    const tanimDogruDosyada = kayit?.tanim.some((x) => x.dosya === t.dosya) ?? false;
    check(`§4a ${b.model} ters yazan \`${t.sembol}\` tanımlı`, tanimDogruDosyada,
      tanimDogruDosyada ? t.dosya : `${t.dosya} içinde bulunamadı — yeniden adlandırıldıysa BEYAN da güncellenir`);
    if (!tanimDogruDosyada) continue;
    const toplam = (kayit!.disReferans ?? 0) + (kayit!.icReferans ?? 0);
    check(`§4b ${b.model} \`${t.sembol}\` tanımı dışında çağrılıyor`, toplam > 0,
      toplam > 0 ? `${toplam} referans (${kayit!.disReferans} dosya dışı)` : "SIFIR referans — YAZILMIŞ AMA ÇAĞRILMAYAN ters yol");
  }
}

// §4c — YAZAN bir defterin ters YAZANI da olmalı. Tezgah defterleri (2026-09-13)
// yazma yüzeyi olmadan indi ve `tersYazan: []` ile beyan edildi; bu DOĞRU (ters
// yazılacak bir şey yok) ama ilk yazıcı doğduğu gün `yazan` güncellenir ve
// `tersYazan` boş KALIRSA §4 hiçbir şey ölçmez — boş liste sessiz yeşildir.
// Kural: mekanizması olan DEFTER'in yazıcısı varsa ters yazıcısı da beyan edilir.
for (const b of defterler) {
  if (b.mekanizma!.tur === "YOK") continue;           // borçlu defter §6'da görünür
  const yazici = (b.yazan ?? []).length;
  const ters = (b.tersYazan ?? []).length;
  if (yazici === 0 && ters === 0) continue;           // yazma yüzeyi yok — sessizlik meşru
  check(`§4c ${b.model} yazıcısı varsa ters yazıcısı da beyanlı`, ters > 0,
    ters > 0 ? `${yazici} yazıcı · ${ters} ters yazıcı` : `${yazici} yazıcı dosya beyanlı ama ters yazan YOK — ileri yol yazılıp geri yol yazılmadı, ya da beyan eksik`);
}

console.log("\n=== §5 Satır yaratan İLERİ yol kümesi beyanla birebir mi ===");
const hedefler = new Map(
  DEFTER_BEYANI.filter((b) => b.yazan).map((b) => [
    b.model,
    { delegate: b.model.charAt(0).toLowerCase() + b.model.slice(1), tablo: tabloAdi.get(b.model) ?? "" },
  ]),
);
const tarama = defterYazimlariniTara(KOK, hedefler, (rel) => rel.startsWith("src/"), "tsconfig.scripts.json", undefined, PROGRAM);
const kesfedilen = new Map<string, Set<string>>();
for (const y of tarama.bulgular) {
  if (!kesfedilen.has(y.model)) kesfedilen.set(y.model, new Set());
  kesfedilen.get(y.model)!.add(y.dosya);
}
for (const b of DEFTER_BEYANI.filter((x) => x.yazan)) {
  const bulunan = kesfedilen.get(b.model) ?? new Set<string>();
  const beyan = new Set(b.yazan!);
  const yeni = [...bulunan].filter((d) => !beyan.has(d));
  const olu = [...beyan].filter((d) => !bulunan.has(d));
  check(`§5 ${b.model} ileri yol kümesi`, yeni.length === 0 && olu.length === 0,
    yeni.length || olu.length
      ? `${yeni.length ? `YENİ YOL (ters yolu beyan edilmedi): ${yeni.join(", ")}` : ""}${yeni.length && olu.length ? " · " : ""}${olu.length ? `ÖLÜ BEYAN: ${olu.join(", ")}` : ""}`
      : `${bulunan.size} dosya`);
}

console.log("\n=== §6 Borç iki yönlü ===");
for (const b of defterler) {
  const m = b.mekanizma!;
  if (m.tur === "YOK") {
    check(`§6a ${b.model} mekanizması yok ⇒ borç beyan edilmiş`, (b.borc?.length ?? 0) > 0,
      b.borc?.length ? b.borc.map((x) => `${x.ne} [${x.sahibi}]`).join(" · ") : "ters yolu YOK ama borç satırı da yok — muafiyet DEĞİL, borç yazılır");
    const alan = modelAlanlari.get(b.model)!;
    const belirenler = ["revokedAt", "reversedAt", "revertedAt", "reversesMovementId", "reversesTxnId"].filter((k) => alan.has(k));
    check(`§6b ${b.model} borcu hâlâ açık mı`, belirenler.length === 0,
      belirenler.length ? `MEKANİZMA BELİRMİŞ (${belirenler.join(", ")}) — borç kapanmış olabilir, BEYANI GÜNCELLE` : "mekanizma hâlâ yok");
  }
}

console.log("\n=== §7 Telemetri KARAR UFKUNU beyan etmiş mi ===");
for (const b of DEFTER_BEYANI.filter((x) => x.sinif === "TELEMETRI")) {
  check(`§7 ${b.model} karar ufku beyan edilmiş`, !!b.kararUfku && b.kararUfku.length > 40,
    b.kararUfku ? "beyan var" : "budanabilir bir satır HANGİ KARARI beslediğini beyan etmeli — budama o kararı sessizce serbest bırakır");
}

console.log("\n=== §8 scripts/ ayrımı — fikstür keşifle muaf ===");
const scriptTarama = defterYazimlariniTara(KOK, hedefler, (rel) => rel.startsWith("scripts/"), "tsconfig.scripts.json", undefined, PROGRAM);
const scriptYazanlar = [...new Set(scriptTarama.bulgular.map((b) => b.dosya))].filter((d) => !fiksturMu(d)).sort();
const beyansizScript = scriptYazanlar.filter((d) => !(d in SCRIPT_SINIFI));
check("§8a doğrudan defter yazan her script sınıflanmış", beyansizScript.length === 0,
  beyansizScript.length ? `SINIFSIZ: ${beyansizScript.join(", ")}` : `${scriptYazanlar.length} script sınıflı`);
const oluScript = Object.keys(SCRIPT_SINIFI).filter((d) => !scriptYazanlar.includes(d));
check("§8b script beyanında ölü satır yok", oluScript.length === 0,
  oluScript.length ? `artık defter yazmıyor: ${oluScript.join(", ")}` : "");

// Tasarım atfı ÖLÜ olmamalı: belgesi silinmiş/taşınmış bir "çözüm tasarlandı"
// beyanı, borcun üzerinde çalışıldığı izlenimini kanıtsız bırakır.
for (const b of DEFTER_BEYANI) {
  for (const x of b.borc ?? []) {
    if (!x.tasarim) continue;
    const varMi = existsSync(join(KOK, "..", x.tasarim));
    check(`§6c ${b.model} tasarım atfı yaşıyor`, varMi, varMi ? x.tasarim : `BELGE YOK: ${x.tasarim}`);
  }
}

// Borç notunun kendisi bayatlayabilir: "şu değer yazılmıyor" iddiası, değer
// yazılmaya başlayınca SESSİZCE yanlışa düşer. Sonda iki yönlüdür — iddia
// doğruyken yeşil, iddia çürüdüğünde KIRMIZI ("borç notu bayat").
const srcDosyalari = walkTs(join(KOK, "src"));
for (const b of DEFTER_BEYANI) {
  for (const x of b.borc ?? []) {
    if (!x.kanitSondasi) continue;
    const { enumAdi, deger } = x.kanitSondasi;
    const kalip = new RegExp(`\\b${enumAdi}\\.${deger}\\b`);
    const gecen = srcDosyalari.filter((f) => kalip.test(readFileSync(f, "utf8")));
    check(`§6d ${b.model} borç notu hâlâ doğru (${enumAdi}.${deger} yazılmıyor)`, gecen.length === 0,
      gecen.length
        ? `BORÇ NOTU BAYAT — değer artık ${gecen.length} dosyada kullanılıyor: ${gecen.slice(0, 3).map((f) => f.replace(KOK + "/", "")).join(", ")}`
        : `src/ içinde sıfır kullanım (${srcDosyalari.length} dosya tarandı)`);
  }
}

console.log("\n=== §11 \"Ters yolu ebeveynindedir\" çürütmesinin zayıf halkası ===");
// Bir satır modelini "ebeveyninden gider" diye sınıflamak bir ÇÜRÜTMEDİR
// ("bunun kendi ters yolu gerekmez, çünkü…") ve her çürütmenin en zayıf halkası
// ÖLÇÜLMEMİŞ olanıdır: EBEVEYNİN ters yolu var mı? Yoksa satır da ters yolsuzdur
// ve çürütme güven üretmiş olur, koruma değil.
const TERS_DAMGALAR = ["cancelledAt", "revokedAt", "reversedAt", "revertedAt", "voidedAt"];
for (const b of DEFTER_BEYANI.filter((x) => x.sinif === "SATIR_EBEVEYN")) {
  const ebeveynBeyani = beyanMap.get(b.ebeveyn!);
  const ebeveynAlan = modelAlanlari.get(b.ebeveyn!);
  const defterOlarakBeyanli = ebeveynBeyani?.sinif === "DEFTER" && ebeveynBeyani.mekanizma?.tur !== "YOK";
  const damga = ebeveynAlan ? TERS_DAMGALAR.filter((k) => ebeveynAlan.has(k)) : [];
  check(`§11 ${b.model} → ebeveyn ${b.ebeveyn} ters yollu`, !!ebeveynAlan && (defterOlarakBeyanli || damga.length > 0),
    !ebeveynAlan ? `ebeveyn "${b.ebeveyn}" ŞEMADA YOK — beyan bayat`
      : defterOlarakBeyanli ? "ebeveyn beyanlı DEFTER"
      : damga.length ? `ebeveyn damgası: ${damga.join(", ")}`
      : "EBEVEYNİN DE TERS YOLU YOK — \"ebeveyninden gider\" çürütmesi boş küme üzerinde çalışıyor");
}

console.log("\n=== §12 \"Saf yapılandırma pivotu\" çürütmesinin zayıf halkası ===");
// ③b'nin gerekçesi "parasal/ticari/kalite sonucu YOK"tur. Ölçülebilir vekili:
// miktar/para taşıyan bir pivot saf ayar DEĞİLDİR (③a'ya girer, versiyonlanır).
for (const b of DEFTER_BEYANI.filter((x) => x.sinif === "PIVOT_YAPILANDIRMA")) {
  const alan = modelAlanlari.get(b.model);
  const decimal = alan ? [...alan].filter(([, tip]) => tip === "Decimal").map(([ad]) => ad) : [];
  check(`§12 ${b.model} miktar/para taşımıyor`, decimal.length === 0,
    decimal.length ? `Decimal kolon(lar) VAR: ${decimal.join(", ")} — saf ayar pivotu değil, ③a TİCARİ pivot olabilir` : "");
}

console.log("\n=== §10 Deftere fiziksel silme — doktrin YASAKLAR, beyansız silme kırmızı ===");
const silmeTarama = defterYazimlariniTara(KOK, hedefler, (rel) => rel.startsWith("src/"), "tsconfig.scripts.json", SILEN, PROGRAM);
const silenDosyalar = new Map<string, Set<string>>();
for (const y of silmeTarama.bulgular) {
  if (!silenDosyalar.has(y.model)) silenDosyalar.set(y.model, new Set());
  silenDosyalar.get(y.model)!.add(y.dosya);
}
for (const b of DEFTER_BEYANI.filter((x) => x.yazan)) {
  const bulunan = silenDosyalar.get(b.model) ?? new Set<string>();
  const beyan = new Set(b.silen ?? []);
  const beyansiz = [...bulunan].filter((d) => !beyan.has(d));
  const olu = [...beyan].filter((d) => !bulunan.has(d));
  if (bulunan.size === 0 && beyan.size === 0) continue;   // temiz defter — satır basma
  check(`§10 ${b.model} silme yolu`, beyansiz.length === 0 && olu.length === 0,
    beyansiz.length || olu.length
      ? `${beyansiz.length ? `BEYANSIZ SİLME (defter satırı silinemez): ${beyansiz.join(", ")}` : ""}${beyansiz.length && olu.length ? " · " : ""}${olu.length ? `ÖLÜ SİLME BEYANI — borç kapanmış olabilir: ${olu.join(", ")}` : ""}`
      : `${bulunan.size} dosya, beyanlı borç`);
}
check("§10z silme taraması bir şey gördü (kör değil)", silmeTarama.bulgular.length > 0,
  `${silmeTarama.bulgular.length} silme çağrısı (defter modellerinde)`);

console.log("\n=== §9 Körlük zemini ===");
check("§9a src kapsamı dolu", tarama.taranan.length > 0, `${tarama.taranan.length} dosya tarandı`);
check("§9b scripts kapsamı dolu", scriptTarama.taranan.length > 0, `${scriptTarama.taranan.length} dosya tarandı`);
check("§9c yazım bulundu (fikstür körlüğü değil)", tarama.bulgular.length > 0,
  `src: ${tarama.bulgular.length} yaratan yazım (${tarama.bulgular.filter((b) => b.icIce).length} iç içe) · scripts: ${scriptTarama.bulgular.length}`);
const cozulemeyen = [...new Set([...tarama.cozulemeyen, ...scriptTarama.cozulemeyen])];
console.log(`ℹ️  tipi çözülemeyen iç içe yazım: ${cozulemeyen.length}${cozulemeyen.length ? ` → ${cozulemeyen.slice(0, 8).join(" · ")}` : ""}`);
console.log("ℹ️  (çözülemeyen satırlar Prisma yazımı OLMAYABİLİR — `summary: { create: n }` gibi sayaç nesneleri de bu kalıba düşer; sıfırdan farklıysa GÖZLE bakılır, sessizce geçilmez)");

console.log("\n=== §13 OLAY DÜZEYİ — her sebep kodunun ters yolu beyanlı mı ===");
{
  const kodlar = Object.values(STOCK_MOVE_REASON) as string[];
  const beyanlilar = Object.keys(STOK_OLAY_BEYANI);
  // Kullanım taraması KATALOĞUN KENDİSİNİ dışlar — tanım bir kullanım değildir
  // (aksi hâlde her kod "kullanılıyor" görünür ve §13e hiçbir şey ölçmez).
  const katalogYolu = join(KOK, "src/constants/stock-move-reasons.ts");
  const kodKullanimi = new Set<string>();
  for (const dosya of tsDosyalar) {
    if (dosya === katalogYolu) continue;
    const metin = readFileSync(dosya, "utf8");
    for (const k of kodlar) if (metin.includes(`STOCK_MOVE_REASON.${k}`)) kodKullanimi.add(k);
  }
  // §13a/§13b EVREN İKİ YÖNLÜ — yeni kod beyansız kalamaz, ölü beyan da duramaz.
  const beyansiz = kodlar.filter((k) => !(k in STOK_OLAY_BEYANI));
  check("§13a her sebep kodu beyanlı", beyansiz.length === 0,
    beyansiz.length ? `BEYANSIZ: ${beyansiz.join(", ")} — yeni sebep kodu ters yolunu da beyan eder` : `${kodlar.length} kod`);
  const hayalet = beyanlilar.filter((k) => !kodlar.includes(k));
  check("§13b beyanda hayalet kod yok", hayalet.length === 0,
    hayalet.length ? `katalogda YOK: ${hayalet.join(", ")}` : `${beyanlilar.length} beyan`);

  // §13c ATIFLAR GERÇEK Mİ — kod yeniden adlandırılırsa kapı sessiz kalamaz.
  const oluAtif: string[] = [];
  for (const [kod, b] of Object.entries(STOK_OLAY_BEYANI)) {
    // TERS_KODU.ileri tek kod ya da küme — her üye ayrı atıftır, hepsi katalogda olmalı.
    const hedefler: string[] = b.tur === "BAGLI_TERS" || b.tur === "KARSI_OLAY" ? [b.kod] : b.tur === "TERS_KODU" ? ([] as string[]).concat(b.ileri) : [];
    for (const hedef of hedefler) if (!kodlar.includes(hedef)) oluAtif.push(`${kod} → ${hedef}`);
  }
  check("§13c ters yol atıfları katalogda var", oluAtif.length === 0,
    oluAtif.length ? `ÖLÜ ATIF: ${oluAtif.join(" · ")}` : "tüm atıflar çözüldü");

  // §13d SİMETRİ — "A'nın tersi B" diyorsan B de "ben A'nın tersiyim" demeli.
  // Tek yönlü beyan, ters yolun yanlış koda bağlanmasını SESSİZCE geçirir.
  const asimetri: string[] = [];
  for (const [kod, b] of Object.entries(STOK_OLAY_BEYANI)) {
    if (b.tur !== "BAGLI_TERS" || b.kod === kod) continue;
    const karsi = STOK_OLAY_BEYANI[b.kod];
    // `ileri` tek kod ya da küme: bir ters kod birden çok ileriyi tersleyebilir (TAMBUR_UNDO).
    if (!karsi || karsi.tur !== "TERS_KODU" || !([] as string[]).concat(karsi.ileri).includes(kod)) {
      asimetri.push(`${kod} → ${b.kod} (karşı beyan: ${karsi ? karsi.tur : "YOK"})`);
    }
  }
  check("§13d ileri ↔ ters simetrik", asimetri.length === 0,
    asimetri.length ? `TEK YÖNLÜ: ${asimetri.join(" · ")}` : "her bağlı çift iki yönlü beyanlı");

  // §13e ÖLÜ BEYAN — borç/başka-defter DIŞINDA beyan edilen kodun yazarı olmalı.
  // (Borç zaten "yazarı yok" diyebilir; BASKA_DEFTER'in yazarı tanımı gereği yok.)
  const yazarsiz = Object.entries(STOK_OLAY_BEYANI)
    .filter(([, b]) => b.tur !== "BORC" && b.tur !== "BASKA_DEFTER")
    .map(([k]) => k)
    .filter((k) => !kodKullanimi.has(k));
  check("§13e beyanlı kodun yazarı var", yazarsiz.length === 0,
    yazarsiz.length ? `YAZARI YOK: ${yazarsiz.join(", ")} — kod ölü mü, yazarı mı? (ikisi ayrı sonuç)` : "hepsi kullanılıyor");
}

const olayBorclari = Object.entries(STOK_OLAY_BEYANI).filter(([, b]) => b.tur === "BORC");
console.log(`\n=== AÇIK OLAY BORÇLARI (${olayBorclari.length}/${Object.keys(STOK_OLAY_BEYANI).length}) — sebep kodu düzeyi ===`);
console.log("ℹ️  ⚠️ KAPSAM: bu kol yalnız SEBEP KODU TAŞIYAN satırları konuşur. Fabrika yedeğinde");
console.log("ℹ️  (fabrikanın dev kopyası, ölçüm 2026-09-13) 778 satırın 721'i sebep kodsuzdur — ufuk öncesi");
console.log("ℹ️  eski küme, kullanıcı kararıyla ONARILMAYACAK. Buradaki yeşil o satırlar hakkında");
console.log("ℹ️  hiçbir şey söylemez. (Sayı DAMGALIDIR: kapı statiktir, DB'ye bakmaz.)");
for (const [kod, b] of olayBorclari) {
  if (b.tur !== "BORC") continue;
  console.log(`  • ${kod}: ${b.ne}\n      kanıt: ${b.kanit}\n      sahibi: ${b.sahibi}`);
}

const acikBorclar = DEFTER_BEYANI.flatMap((b) => (b.borc ?? []).map((x) => ({ model: b.model, ...x })));
console.log(`\n=== AÇIK DEFTER BORÇLARI (${acikBorclar.length}) — muaf değil, GÖRÜNÜR ===`);
for (const x of acikBorclar) {
  const durum = x.tasarim ? `TASARLANDI → ${x.tasarim}` : "TASARIM YOK";
  console.log(`  • ${x.model} [${durum}]: ${x.ne}\n      kanıt: ${x.kanit}\n      sahibi: ${x.sahibi}`);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
