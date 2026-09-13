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
//   §1 EVREN — her append-only model beyan tablosunda SINIFLANMIŞ mı (iki yönlü)
//   §2 "yarı" beyanı doğru mu (updatedAt gerçekten var/yok — ölü beyan kırmızı)
//   §3 Mekanizma ŞEMADA gerçek mi (kolon/enum değeri yeniden adlandırılırsa KIRMIZI)
//   §4 Ters yazan sembol var mı ve tanımı DIŞINDA referansı var mı (ölü ters yol)
//   §5 ⭐ Satır yaratan İLERİ yol kümesi beyanla BİREBİR mi (yeni yol → kırmızı,
//      ölü beyan → kırmızı). İç içe ilişki yazımı BAĞLAMSAL TİPTEN çözülür.
//   §6 Borç iki yönlü — mekanizma YOK ⇒ borç zorunlu; mekanizma BELİRDİYSE kırmızı
//   §7 Telemetri satırı KARAR UFKUNU beyan etmiş mi
//   §8 scripts/ ayrımı — fikstür KEŞİFLE muaf, diğer defter yazan script beyanlı
//   §9 Körlük zemini — kapsam DOLU mu, kaç yazım görüldü, tipi çözülemeyen kaç
//   §10 Deftere fiziksel silme — beyansız silme kırmızı (doktrin yasağı)
//   §11 "Ters yolu ebeveynindedir" çürütmesinin zayıf halkası: EBEVEYNİN ters yolu var mı
//   §12 "Saf yapılandırma pivotu" çürütmesinin zayıf halkası: miktar/para taşıyor mu
//
// DB GEREKTİRMEZ: statik analiz (AST + tip denetleyicisi). Prisma istemcisi
// açılmaz, havuz kurulmaz.
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DEFTER_BEYANI, type DefterBeyani } from "./lib/defter-beyan";
import { SILEN, defterYazimlariniTara, sembolReferanslari } from "./lib/defter-yazim-tarama";
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
const referanslar = sembolReferanslari(KOK, tsDosyalar);
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

console.log("\n=== §5 Satır yaratan İLERİ yol kümesi beyanla birebir mi ===");
const hedefler = new Map(
  DEFTER_BEYANI.filter((b) => b.yazan).map((b) => [
    b.model,
    { delegate: b.model.charAt(0).toLowerCase() + b.model.slice(1), tablo: tabloAdi.get(b.model) ?? "" },
  ]),
);
const tarama = defterYazimlariniTara(KOK, hedefler, (rel) => rel.startsWith("src/"));
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
const scriptTarama = defterYazimlariniTara(KOK, hedefler, (rel) => rel.startsWith("scripts/"));
const scriptYazanlar = [...new Set(scriptTarama.bulgular.map((b) => b.dosya))].filter((d) => !fiksturMu(d)).sort();
const beyansizScript = scriptYazanlar.filter((d) => !(d in SCRIPT_SINIFI));
check("§8a doğrudan defter yazan her script sınıflanmış", beyansizScript.length === 0,
  beyansizScript.length ? `SINIFSIZ: ${beyansizScript.join(", ")}` : `${scriptYazanlar.length} script sınıflı`);
const oluScript = Object.keys(SCRIPT_SINIFI).filter((d) => !scriptYazanlar.includes(d));
check("§8b script beyanında ölü satır yok", oluScript.length === 0,
  oluScript.length ? `artık defter yazmıyor: ${oluScript.join(", ")}` : "");

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
const silmeTarama = defterYazimlariniTara(KOK, hedefler, (rel) => rel.startsWith("src/"), "tsconfig.scripts.json", SILEN);
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

const acikBorclar = DEFTER_BEYANI.flatMap((b) => (b.borc ?? []).map((x) => ({ model: b.model, ...x })));
console.log(`\n=== AÇIK DEFTER BORÇLARI (${acikBorclar.length}) — muaf değil, GÖRÜNÜR ===`);
for (const x of acikBorclar) console.log(`  • ${x.model}: ${x.ne}\n      kanıt: ${x.kanit}\n      sahibi: ${x.sahibi}`);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
