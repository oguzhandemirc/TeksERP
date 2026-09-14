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
//   §3 Mekanizma ŞEMADA gerçek mi (kolon/enum değeri yeniden adlandırılırsa KIRMIZI);
//      §3k KARŞI KAYIT: yön kolonları şemada · ters yazan İLERİ yazan dosyada
//      §3e ⭐ İKİNCİ YÖN: enum mekanizmasında ŞEMADAKİ her değer bir çiftte ya da
//          gerekçeli çift-dışı listesinde (ölü/gereksiz muaf da kırmızı)
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
//      kodun yazarı var mı · §13f her bağlı/karşı çiftin ters yazanı kodda ÇAPALI mı —
//      KARSI_OLAY da simetrik denetlenir). ⚠️ Kapsamı SEBEP KODU TAŞIYAN satırlardır.
//
// DB GEREKTİRMEZ: statik analiz (AST + tip denetleyicisi). Prisma istemcisi
// açılmaz, havuz kurulmaz.
// =============================================================================
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CIFT_DISI_DEGERLER, DEFTER_BEYANI, STOK_OLAY_BEYANI, type CiftDisiDeger, type DefterBeyani } from "./lib/defter-beyan";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";
import { SILEN, defterYazimlariniTara, sembolReferanslari, tipliProgram } from "./lib/defter-yazim-tarama";
import { TEARDOWN_ADLARI, TEMIZLIK_SCRIPTI_ISARETI, silmeleriTara, sondaSinifla, temizlikScriptiMi } from "./lib/silme-bagi";
import { atlamaDefteri } from "./lib/atlama";
import { curumeKolu } from "./lib/circir-kolu";
import { semaAlanlari } from "./revoke-ast-tarama";
import { walkTs } from "./lib/ts-tarama";

const KOK = join(__dirname, "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

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
  "scripts/audit_repro_KYY-2-26.ts": "DENETIM_REPRO",
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
  } else if (m.tur === "KARSI_KAYIT") {
    // KARŞI KAYIT iki iddia taşır ve İKİSİ DE ölçülür. ① Tersliği taşıyan şey yön
    // KOLONLARIDIR (enum değil) — kolon yeniden adlandırılırsa kapı susamaz.
    const eksik = m.ciftler.flat().filter((k) => !alan.has(k));
    check(`§3k1 ${b.model} yön kolonları şemada`, m.ciftler.length > 0 && eksik.length === 0,
      eksik.length ? `eksik kolon: ${eksik.join(", ")}` : `${m.ciftler.length} yön çifti`);
    // ② "Ters yol ileri yolun KENDİSİDİR" — yanlışlanabilir hâli: ters yazan, ileri
    // yazan dosyalardan birinde yaşar. Ayrı dosyadaysa mekanizma karşı kayıt DEĞİL,
    // ayrı bir geri alma ucudur (damga/ters bağ) ve SINIF yanlıştır.
    const tersler = b.tersYazan ?? [];
    const disarida = tersler.filter((t) => !(b.yazan ?? []).includes(t.dosya));
    check(`§3k2 ${b.model} karşı kaydı İLERİ yol yazıyor`, tersler.length > 0 && disarida.length === 0,
      tersler.length === 0 ? "ters yazan beyan edilmemiş — karşı kaydın yazarı ileri yoldur, boş kalamaz"
        : disarida.length ? `ileri yazan kümesinde YOK: ${disarida.map((t) => `${t.sembol}@${t.dosya}`).join(" · ")}`
          : `${tersler.map((t) => t.sembol).join(", ")} — ileri yazan dosyada`);
  }
}

// §3e — İKİNCİ YÖN. §3 beyandan şemaya bakar; bu kol ŞEMADAN BEYANA bakar: enum'un
// HER değeri ya bir çiftte ya da gerekçeli çift-dışı listesindedir. Kör olduğu yön,
// kuralın ihlal edildiği yöndü — enum'a yeni bir İLERİ değer eklemek kapıyı hiç
// uyandırmıyordu.
interface CiftDisiOlcum { beyansiz: string[]; oluMuaf: string[]; gereksizMuaf: string[]; sahipsizBorc: string[] }
function ciftDisiOlcum(degerler: string[], ciftler: [string, string][], muaflar: CiftDisiDeger[]): CiftDisiOlcum {
  const ciftte = new Set(ciftler.flat());
  const muafKume = new Set(muaflar.map((m) => m.deger));
  return {
    beyansiz: degerler.filter((v) => !ciftte.has(v) && !muafKume.has(v)),
    // ÖLÜ MUAF: şemadan düşmüş değeri muaf tutmak, kapanmış sanılan bir borçtan kötüdür.
    oluMuaf: muaflar.filter((m) => !degerler.includes(m.deger)).map((m) => m.deger),
    // GEREKSİZ MUAF: değer artık bir çiftte — beyan kendi kendisiyle çelişiyor.
    gereksizMuaf: muaflar.filter((m) => ciftte.has(m.deger)).map((m) => m.deger),
    sahipsizBorc: muaflar.filter((m) => m.sinif === "BORC" && !m.sahibi?.trim()).map((m) => m.deger),
  };
}
{
  const enumluMekanizmalar = defterler
    .map((b) => ({ b, m: b.mekanizma! }))
    .filter((x): x is { b: DefterBeyani; m: { tur: "ENUM_CIFTI" | "KARSI_OLAY"; enumAdi: string; ciftler: [string, string][] } } =>
      x.m.tur === "ENUM_CIFTI" || x.m.tur === "KARSI_OLAY");
  check("§3e0 körlük zemini: enum mekanizmalı defter var", enumluMekanizmalar.length > 0,
    `${enumluMekanizmalar.length} defter · ${CIFT_DISI_DEGERLER.length} çift-dışı beyan`);
  const gorulenEnumlar = new Set<string>();
  for (const { b, m } of enumluMekanizmalar) {
    gorulenEnumlar.add(m.enumAdi);
    const degerler = enumDegerleri.get(m.enumAdi) ?? [];
    const muaflar = CIFT_DISI_DEGERLER.filter((x) => x.enumAdi === m.enumAdi);
    const o = ciftDisiOlcum(degerler, m.ciftler, muaflar);
    check(`§3e ${b.model} ${m.enumAdi} her değer çiftte ya da gerekçeli`, o.beyansiz.length === 0,
      o.beyansiz.length
        ? `BEYANSIZ değer: ${o.beyansiz.join(", ")} — ileri yol eklendi, ters mekanizması beyan edilmedi (çift kur ya da CIFT_DISI_DEGERLER'e GEREKÇEYLE yaz)`
        : `${degerler.length} değer · ${m.ciftler.length} çift · ${muaflar.length} gerekçeli çift-dışı`);
    if (o.oluMuaf.length || o.gereksizMuaf.length) {
      check(`§3e2 ${b.model} ${m.enumAdi} çift-dışı beyanı BAYAT DEĞİL`, false,
        [o.oluMuaf.length ? `şemada YOK: ${o.oluMuaf.join(", ")}` : "", o.gereksizMuaf.length ? `artık ÇİFTTE: ${o.gereksizMuaf.join(", ")}` : ""].filter(Boolean).join(" · "));
    }
    if (o.sahipsizBorc.length) check(`§3e3 ${b.model} ${m.enumAdi} BORC sınıfının sahibi var`, false, o.sahipsizBorc.join(", "));
  }
  // Sahipsiz beyan: hiçbir mekanizmanın konuşmadığı enum için çift-dışı satır yazmak,
  // ölçülmeyen bir muafiyettir.
  const sahipsizEnum = [...new Set(CIFT_DISI_DEGERLER.map((x) => x.enumAdi))].filter((e) => !gorulenEnumlar.has(e));
  check("§3e4 çift-dışı beyanı olan her enum bir mekanizmaya ait", sahipsizEnum.length === 0,
    sahipsizEnum.length ? `mekanizmasız enum: ${sahipsizEnum.join(", ")}` : `${gorulenEnumlar.size} enum`);
  // YEŞİLKEN DE BORÇ GÖRÜNÜR — sayı değil ADRES basılır.
  const borclar = CIFT_DISI_DEGERLER.filter((x) => x.sinif === "BORC");
  if (borclar.length) {
    console.log(`   ⓘ çift-dışı BORÇ (${borclar.length}) — ileri yol var, geri yol yok:`);
    for (const x of borclar) console.log(`      • ${x.enumAdi}.${x.deger} [${x.sahibi}] → ${x.gerekce}`);
  }
}

// §3e SONDALARI — ölçüm aracının kendisi yanlışlanır (fonksiyon saf, girdiler sentetik).
{
  const D2 = (deger: string, sinif: CiftDisiDeger["sinif"], sahibi?: string): CiftDisiDeger =>
    ({ enumAdi: "X", deger, sinif, gerekce: "sonda", ...(sahibi ? { sahibi } : {}) });
  const ciftler: [string, string][] = [["A", "A_CANCEL"]];
  // ① Enum'a YENİ değer eklendi, beyan edilmedi → yakalanır.
  check("§3e-s1 ⭐ beyansız yeni enum değeri YAKALANIR",
    ciftDisiOlcum(["A", "A_CANCEL", "B"], ciftler, []).beyansiz.join() === "B",
    `gelen: ${ciftDisiOlcum(["A", "A_CANCEL", "B"], ciftler, []).beyansiz.join() || "(boş)"}`);
  // ② Aynı değer gerekçeli listeye yazıldı → susar (muafiyet ÇALIŞIYOR; yoksa kapı
  //    kapatılamaz bir kırmızı üretir ve ilk sıkışmada susturulur).
  check("§3e-s2 ⭐ gerekçeli çift-dışı beyan SUSTURUR",
    ciftDisiOlcum(["A", "A_CANCEL", "B"], ciftler, [D2("B", "TERMINAL")]).beyansiz.length === 0);
  // ③ Beyan bayatlarsa iki yönden de kırmızı.
  check("§3e-s3 şemadan düşen muaf değer → ÖLÜ MUAF",
    ciftDisiOlcum(["A", "A_CANCEL"], ciftler, [D2("B", "TERMINAL")]).oluMuaf.join() === "B");
  check("§3e-s4 çifte giren muaf değer → GEREKSİZ MUAF",
    ciftDisiOlcum(["A", "A_CANCEL"], ciftler, [D2("A_CANCEL", "TERMINAL")]).gereksizMuaf.join() === "A_CANCEL");
  check("§3e-s5 sahipsiz BORC yakalanır",
    ciftDisiOlcum(["A", "A_CANCEL", "B"], ciftler, [D2("B", "BORC")]).sahipsizBorc.join() === "B"
    && ciftDisiOlcum(["A", "A_CANCEL", "B"], ciftler, [D2("B", "BORC", "9b")]).sahipsizBorc.length === 0);
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

console.log("\n=== §10b scripts/ SİLME BAĞI — muafiyet DOSYAYA değil YÜKLEME bakar ===");
// NEDEN: §10 yalnız `src/`e bakıyordu; `scripts/` altındaki teardown defter satırı
// siler ve bu MEŞRUDUR. Ama muafiyeti DOSYA düzeyinde vermek evreni yutar — kapı
// "scripts/i yürüdüm" der, hiçbir şey ölçmez. Ölçüt YÜKLEMDİR: silme dosyanın KENDİ
// ürettiği kimliklere bağlıysa muaf, ada/öneke dayanıyorsa değil.
// KAPSAM: audit/telemetri sınıfı DIŞARIDA — doktrin onları "ne oldu asla değişmez"in
// KAPSAMI dışında sayar, teardown'da test audit satırı silmek meşrudur.
const SILME_KAPSAM_DISI = new Set(["TELEMETRI"]);
const silmeDelegeleri = new Map(
  DEFTER_BEYANI.filter((b) => !SILME_KAPSAM_DISI.has(b.sinif)).map((b) => [
    b.model.charAt(0).toLowerCase() + b.model.slice(1),
    b.model,
  ]),
);
const scriptSilme = silmeleriTara(PROGRAM.program, PROGRAM.checker, KOK, (rel) => rel.startsWith("scripts/"), silmeDelegeleri);
const bagsiz = scriptSilme.filter((x) => x.bag === "SINIRSIZ" || x.bag === "BOS");
const bagOlculemedi = scriptSilme.filter((x) => x.bag === "OLCULEMEDI");
const teardownDisi = scriptSilme.filter((x) => x.teardown === null);
// ⚠️ CIRCIR TABANLARI — oturum DOKUNMAZ, entegratör trende ölçüp düşürür.
const SINIRSIZ_TABAN = 0;
const TEARDOWN_DISI_TABAN = 61;

check("§10b0 körlük zemini: kapsam dolu", scriptSilme.length > 0,
  `${scriptSilme.length} silme çağrısı · ${silmeDelegeleri.size} model (audit/telemetri hariç)`);
check("§10b1 ⭐ ADA/ÖNEKE dayanan silme ARTMADI", bagsiz.length <= SINIRSIZ_TABAN,
  bagsiz.length <= SINIRSIZ_TABAN
    ? `${bagsiz.length} ≤ ${SINIRSIZ_TABAN}`
    : `${bagsiz.length} > ${SINIRSIZ_TABAN} ⇒ YENİ sınırsız silme yüklemi:\n      ` +
        bagsiz.map((x) => `${x.dosya}:${x.satir} ${x.model}.${x.metod} → ${x.not}`).join("\n      "));
curumeKolu(check, ATLAMA.atla, "§10b1b ⭐ sınırsız silme tabanı ÇÜRÜMEDİ", bagsiz.length, SINIRSIZ_TABAN);
if (bagsiz.length > 0 && bagsiz.length <= SINIRSIZ_TABAN) {
  // YEŞİLKEN DE BORÇ GÖRÜNÜR: taban sıfır değilse kapı "temiz" demiyor, "arttırmadın"
  // diyor. Üyeler basılmazsa borç bir SAYIYA dönüşür ve adresi kaybolur.
  console.log(`   ⓘ duran borç (${bagsiz.length}) — ada/öneke dayanan silme:`);
  for (const x of bagsiz) console.log(`      • ${x.dosya}:${x.satir} ${x.model}.${x.metod} → ${x.not}`);
}
check("§10b2 teardown DIŞINDA defter silme ARTMADI", teardownDisi.length <= TEARDOWN_DISI_TABAN,
  `${teardownDisi.length} ≤ ${TEARDOWN_DISI_TABAN}`);
curumeKolu(check, ATLAMA.atla, "§10b2b teardown-dışı tabanı ÇÜRÜMEDİ", teardownDisi.length, TEARDOWN_DISI_TABAN);
// ÜÇÜNCÜ SONUÇ: çözülemeyen yüklem SESSİZCE MUAF SAYILMAZ — sayılır ve adlanır.
if (bagOlculemedi.length > 0) {
  ATLAMA.atla("§10b3 silme yüklemi AST'den çözülemedi", `${bagOlculemedi.length} çağrı — sessiz muaf DEĞİL`, bagOlculemedi.length);
  for (const x of bagOlculemedi.slice(0, 8)) console.log(`      ⏭ ${x.dosya}:${x.satir} ${x.model}.${x.metod} — ${x.not}`);
}
// §10b5 — DOSYA DÜZEYİ TEMİZLİK BEYANI: görünür, sayılı, İKİ YÖNLÜ.
// Beyan yalnız "teardown bağlamı mı" sorusunu cevaplar; §10b1 (yüklem) beyanla
// DEĞİŞMEZ — işaretli dosyada sınırsız yüklem yine kırmızıdır. Beyanın bedeli
// GÖRÜNÜRLÜKTÜR: sayı basılır ve kendi cırcırını taşır.
{
  const TEMIZLIK_SCRIPTI_TABAN = 6;
  const beyanliSilme = [...new Set(scriptSilme.filter((x) => x.teardown === TEMIZLIK_SCRIPTI_ISARETI).map((x) => x.dosya))].sort();
  // ÖLÜ BEYAN: işaret taşıyıp hiç defter silmeyen dosya — okuyucuya var olmayan bir
  // gerekçe gösterir ve bir sonraki eklemeyi bedava yapar.
  const isaretli = [...walkTs(join(KOK, "scripts"))]
    .map((f) => relative(KOK, f))
    .filter((rel) => fiksturMu(rel) || rel.startsWith("scripts/"))
    .filter((rel) => temizlikScriptiMi(readFileSync(join(KOK, rel), "utf8")));
  const oluBeyanDosya = isaretli.filter((rel) => !beyanliSilme.includes(rel));
  check("§10b5a ⭐ temizlik beyanı olan dosya gerçekten defter siliyor", oluBeyanDosya.length === 0,
    oluBeyanDosya.length ? `ÖLÜ BEYAN: ${oluBeyanDosya.join(" · ")}` : `${isaretli.length} beyanlı dosya`);
  check("§10b5b ⭐ temizlik BEYANI sayısı ARTMADI", beyanliSilme.length <= TEMIZLIK_SCRIPTI_TABAN,
    beyanliSilme.length <= TEMIZLIK_SCRIPTI_TABAN
      ? `${beyanliSilme.length} ≤ ${TEMIZLIK_SCRIPTI_TABAN} dosya`
      : `${beyanliSilme.length} > ${TEMIZLIK_SCRIPTI_TABAN} ⇒ YENİ temizlik beyanı:\n      ` + beyanliSilme.join("\n      "));
  curumeKolu(check, ATLAMA.atla, "§10b5c ⭐ temizlik beyanı tabanı ÇÜRÜMEDİ", beyanliSilme.length, TEMIZLIK_SCRIPTI_TABAN);
  if (beyanliSilme.length > 0) {
    console.log(`   ⓘ dosya düzeyi temizlik beyanı (${beyanliSilme.length}) — silmeleri teardown SAYILIR, yüklemleri SAYILMAZ:`);
    for (const f of beyanliSilme) console.log(`      • ${f}`);
  }
}

// Teardown ad listesi BEYANDIR: ölü ad, kapıyı sessizce gevşetir.
{
  const kullanilan = new Set(scriptSilme.map((x) => x.teardown).filter((t): t is string => t !== null && !t.startsWith(".") && t !== "finally"));
  const olu = TEARDOWN_ADLARI.filter((ad) => ![...kullanilan].some((k) => k.toLowerCase().startsWith(ad)));
  check("§10b4 teardown ad beyanında ölü satır yok", olu.length === 0,
    olu.length ? `hiçbir silmeyi muaf kılmayan ad(lar): ${olu.join(", ")} — ya yeniden adlandırıldı ya hiç kullanılmadı` : `${kullanilan.size} adlandırılmış teardown`);
}

console.log("\n=== §10c SONDALAR — kural sentetik vakalarla ısırıyor mu (kontrol grubu) ===");
{
  const sonda = (kaynak: string) => sondaSinifla(kaynak);
  const kimlikKaynak = [
    "const ids: string[] = [];",
    "async function t() {",
    "  try { } finally { await prisma.rollMovement.deleteMany({ where: { id: { in: ids } } }); }",
    "}",
  ].join("\n");
  const r1 = sonda(kimlikKaynak);
  check("§10c1 ⭐ yerel kimliğe bağlı silme → KİMLİK (muaf)", r1[0]?.bag === "KIMLIK", `gelen: ${r1[0]?.bag}`);
  check("§10c2 `finally` teardown olarak tanınıyor", r1[0]?.teardown === "finally", `gelen: ${r1[0]?.teardown}`);

  const onekKaynak = [
    "const STAMP = \"TST-X\";",
    "async function t() {",
    "  try { } finally { await prisma.rollMovement.deleteMany({ where: { roll: { barcode: { startsWith: STAMP } } } }); }",
    "}",
  ].join("\n");
  const r2 = sonda(onekKaynak);
  check("§10c3 ⭐ ÖNEK yüklemi → SINIRSIZ (cb4c8ac8'in kusuru)", r2[0]?.bag === "SINIRSIZ", `gelen: ${r2[0]?.bag} · ${r2[0]?.not}`);

  const zincirKaynak = [
    "const woIds: string[] = [];",
    "async function t() {",
    "  try { } finally { await prisma.rollMovement.deleteMany({ where: { step: { workOrderId: { in: woIds } } } }); }",
    "}",
  ].join("\n");
  check("§10c4 ⭐ İLİŞKİ ZİNCİRİ yerel kimliğe bağlıysa → KİMLİK", sonda(zincirKaynak)[0]?.bag === "KIMLIK");

  const kapKaynak = [
    "let woId = \"\";",
    "async function t() {",
    "  try { } finally { await prisma.rollMovement.deleteMany({ where: { workOrderId: woId } }); }",
    "}",
  ].join("\n");
  check("§10c5 `let x = \"\"` bir AD DEĞİL, id KABIdır → KİMLİK", sonda(kapKaynak)[0]?.bag === "KIMLIK",
    "aksi hâlde her fikstür yanlışlıkla sınırsız sayılırdı");

  const literalKaynak = "async function t() { await prisma.rollMovement.deleteMany({ where: { note: \"TEST\" } }); }";
  check("§10c6 ⭐ çıplak LİTERAL yüklem → SINIRSIZ", sonda(literalKaynak)[0]?.bag === "SINIRSIZ");
  check("§10c7 ⭐ teardown DIŞINDAKİ silme tanınıyor", sonda(literalKaynak)[0]?.teardown === null);

  const bosKaynak = "async function t() { await prisma.rollMovement.deleteMany({}); }";
  check("§10c8 ⭐ boş `deleteMany({})` → BOŞ (tüm tabloyu hedefler)", sonda(bosKaynak)[0]?.bag === "BOS");

  const degiskenKaynak = [
    "declare const w: object;",
    "async function t() { await prisma.rollMovement.deleteMany({ where: w }); }",
  ].join("\n");
  check("§10c9 ⭐ çözülemeyen `where` → ÖLÇÜLEMEDİ (sessiz muaf DEĞİL)", sonda(degiskenKaynak)[0]?.bag === "OLCULEMEDI",
    `gelen: ${sonda(degiskenKaynak)[0]?.bag}`);

  const adliKaynak = [
    "const ids: string[] = [];",
    "async function temizlikYap() { await prisma.rollMovement.deleteMany({ where: { id: { in: ids } } }); }",
  ].join("\n");
  check("§10c10 adlandırılmış teardown tanınıyor", sonda(adliKaynak)[0]?.teardown === "temizlikYap", `gelen: ${sonda(adliKaynak)[0]?.teardown}`);

  const notKaynak = [
    "async function t() { await prisma.rollMovement.deleteMany({ where: { reversesId: { not: null } } }); }",
  ].join("\n");
  // ── §10c12–§10c16 — ÇÖZÜNÜRLÜK İKİ YÖNLÜ (2026-09-14, §10b3 18 → 0) ──────────
  // İki kör nokta kapandı: SHORTHAND yaprak (`where: { itemId }`) ve DESTRUCTURE kap
  // (`const { rollIds } = await fikstür()`). Her ikisinde de kural DAR olmalı — bir
  // çözünürlük düzeltmesi, ad bazlı yüklemi sessizce KİMLİK'e çevirirse kapı körelir;
  // bu yüzden her "artık çözülüyor" sondasının yanında bir "hâlâ sınırsız" sondası var.
  {
    const kapKaynak = [
      "async function t() {",
      "  let itemId: string | null = null;",
      "  try { } finally { await prisma.rollMovement.deleteMany({ where: { itemId } }); }",
      "}",
    ].join("\n");
    check("§10c12 ⭐ SHORTHAND yaprak artık çözülüyor (kap → KİMLİK)", sonda(kapKaynak)[0]?.bag === "KIMLIK",
      `gelen: ${sonda(kapKaynak)[0]?.bag}`);

    const adKaynak = [
      "const barcode = \"TST-X\";",
      "async function t() {",
      "  try { } finally { await prisma.rollMovement.deleteMany({ where: { barcode } }); }",
      "}",
    ].join("\n");
    check("§10c13 ⭐ SHORTHAND ad sabiti HÂLÂ SINIRSIZ (kural sızmıyor)", sonda(adKaynak)[0]?.bag === "SINIRSIZ",
      `gelen: ${sonda(adKaynak)[0]?.bag} · ${sonda(adKaynak)[0]?.not}`);

    const parKaynak = [
      "async function t(dispatchId: string) {",
      "  try { } finally { await prisma.rollMovement.deleteMany({ where: { dispatchId } }); }",
      "}",
    ].join("\n");
    check("§10c14 SHORTHAND parametre → KİMLİK", sonda(parKaynak)[0]?.bag === "KIMLIK", `gelen: ${sonda(parKaynak)[0]?.bag}`);

    const destKaynak = [
      "async function t() {",
      "  const fx = await kur();",
      "  const { rollIds } = fx;",
      "  try { } finally { await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }); }",
      "}",
    ].join("\n");
    check("§10c15 ⭐ DESTRUCTURE + çalışma anı kaynağı → KİMLİK (bir sıçrama)", sonda(destKaynak)[0]?.bag === "KIMLIK",
      `gelen: ${sonda(destKaynak)[0]?.bag}`);

    // KURALIN SINIRI: kaynak çalışma anında üretilmiyorsa destructure hiçbir şey
    // kanıtlamaz — ÖLÇÜLEMEDİ kalır, sessizce KİMLİK sayılmaz.
    const sabitDestKaynak = [
      "const SABIT = { rollIds: [\"TST-1\"] };",
      "async function t() {",
      "  const { rollIds } = SABIT;",
      "  try { } finally { await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }); }",
      "}",
    ].join("\n");
    check("§10c16 ⭐ DESTRUCTURE sabit kaynaktan → ÖLÇÜLEMEDİ (kural sızmıyor)",
      sabitDestKaynak.length > 0 && sonda(sabitDestKaynak)[0]?.bag !== "KIMLIK",
      `gelen: ${sonda(sabitDestKaynak)[0]?.bag}`);
  }

  // §10c17–§10c19 — TEMİZLİK BEYANI işareti (saf yüklem, dosya metni)
  check("§10c17 ⭐ başta işaret → temizlik script'i", temizlikScriptiMi("// @temizlik-scripti: gerekçe\nconst x = 1;"));
  check("§10c18 ⭐ işaret YOKSA temizlik script'i DEĞİL (kural işarete bağlı)",
    !temizlikScriptiMi("// sıradan bir script\nconst x = 1;"));
  check("§10c19 ⭐ 30. satırdan SONRAKİ işaret SAYILMAZ (gömülü beyan, beyan değildir)",
    !temizlikScriptiMi("x\n".repeat(40) + "// @temizlik-scripti: geç kalmış"));

  check("§10c11 `not:` bir AD yüklemi DEĞİL (yanlış pozitif sondası)", notKaynak.length > 0 && sonda(notKaynak)[0]?.bag !== "SINIRSIZ",
    `gelen: ${sonda(notKaynak)[0]?.bag}`);
}

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
    const hedefler: string[] = b.tur === "BAGLI_TERS" ? [b.kod] : b.tur === "KARSI_OLAY" ? ([] as string[]).concat(b.kod) : b.tur === "TERS_KODU" ? ([] as string[]).concat(b.ileri) : [];
    for (const hedef of hedefler) if (!kodlar.includes(hedef)) oluAtif.push(`${kod} → ${hedef}`);
  }
  check("§13c ters yol atıfları katalogda var", oluAtif.length === 0,
    oluAtif.length ? `ÖLÜ ATIF: ${oluAtif.join(" · ")}` : "tüm atıflar çözüldü");

  // §13d SİMETRİ — "A'nın tersi B" diyorsan B de "ben A'nın tersiyim" demeli.
  // Tek yönlü beyan, ters yolun yanlış koda bağlanmasını SESSİZCE geçirir.
  const asimetri: string[] = [];
  for (const [kod, b] of Object.entries(STOK_OLAY_BEYANI)) {
    if (b.tur === "BAGLI_TERS" && b.kod !== kod) {
      const karsi = STOK_OLAY_BEYANI[b.kod];
      // `ileri` tek kod ya da küme: bir ters kod birden çok ileriyi tersleyebilir (TAMBUR_UNDO).
      if (!karsi || karsi.tur !== "TERS_KODU" || !([] as string[]).concat(karsi.ileri).includes(kod)) {
        asimetri.push(`${kod} → ${b.kod} (karşı beyan: ${karsi ? karsi.tur : "YOK"})`);
      }
    }
    // KARSI_OLAY da simetriktir: A'nın karşısı B ise B ya "karşım A" der (KARSI_OLAY) ya A'nın
    // bağlı tersidir (TERS_KODU) ya da kendi ters yolu olan bir ileri olaydır (BAGLI_TERS —
    // ENTRY_RECEIPT → ROLL_CANCEL: iptalin kendi tersi CANCEL_RESTORE). BORC/TERMINAL/
    // BASKA_DEFTER bir karşı olay olamaz: yolu olmayan bir şeye "karşı yön" demek boş atıftır.
    if (b.tur === "KARSI_OLAY") {
      // `kod` küme olabilir — her karşı kod ayrı ayrı simetrik olmalı.
      for (const karsiKod of ([] as string[]).concat(b.kod)) {
        const karsi = STOK_OLAY_BEYANI[karsiKod];
        const uygun = karsi && (
          (karsi.tur === "KARSI_OLAY" && ([] as string[]).concat(karsi.kod).includes(kod)) ||
          (karsi.tur === "TERS_KODU" && ([] as string[]).concat(karsi.ileri).includes(kod)) ||
          karsi.tur === "BAGLI_TERS");
        if (!uygun) asimetri.push(`${kod} ⇄ ${karsiKod} (karşı olay beyanı: ${karsi ? karsi.tur : "YOK"})`);
      }
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
  // §13f OLAY DÜZEYİ TERS YAZAN — beyan ile kod arasındaki BAĞ. 1c ölçtü: bir kodu
  // BAGLI_TERS kümesine kod yokken eklemek kapıyı yeşil bırakıyordu (yalan söyleyen
  // yeşil). Her BAGLI_TERS ve KARSI_OLAY çifti ters/karşı satırı YAZAN fonksiyonu adıyla
  // beyan eder; sembol o dosyada tanımlı ve tanımı dışında çağrılıyor olmalı.
  const olayTersYazanEksik: string[] = [];
  for (const [kod, b] of Object.entries(STOK_OLAY_BEYANI)) {
    if (b.tur !== "BAGLI_TERS" && b.tur !== "KARSI_OLAY") continue;
    if (b.tersYazan.length === 0) { olayTersYazanEksik.push(`${kod}: tersYazan BOŞ`); continue; }
    for (const ty of b.tersYazan) {
      const kayit = referanslar.get(ty.sembol);
      const tanimli = kayit?.tanim.some((x) => x.dosya === ty.dosya) ?? false;
      if (!tanimli) { olayTersYazanEksik.push(`${kod}: \`${ty.sembol}\` ${ty.dosya} içinde YOK`); continue; }
      if ((kayit!.disReferans + kayit!.icReferans) === 0) olayTersYazanEksik.push(`${kod}: \`${ty.sembol}\` hiç çağrılmıyor`);
    }
  }
  check("§13f her bağlı/karşı çiftin ters yazanı kodda var ve çağrılıyor", olayTersYazanEksik.length === 0,
    olayTersYazanEksik.length ? olayTersYazanEksik.join(" · ") : `${Object.values(STOK_OLAY_BEYANI).filter((b) => b.tur === "BAGLI_TERS" || b.tur === "KARSI_OLAY").length} çift, hepsi çapalı`);

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

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
process.exit(fail > 0 ? 1 : 0);
