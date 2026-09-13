// =============================================================================
// BEKÇİ — SNAPSHOT KOLONLARI: ŞEMADAN TÜREYEN BEYAN KAPISI + YAZICI KÜMESİ (DB'siz)
// =============================================================================
// `docs/kurallar/defter.md` ÜÇÜNCÜ SINIF (SNAPSHOT) kuralının statik yarısı. Sorular:
//   §1 Şemada şerhi "olay anı kopyası" ilan eden her skaler alan BEYANDA mı?
//      (yeni snapshot kolonu beyansız gelirse kırmızı — elle liste bunu göremezdi)
//   §2 Beyandaki her kolon şemada skaler olarak VAR mı? (bayat beyan kırmızı)
//   §3 Sınıf alanları tutarlı mı: (a) tüketen + DB ayağı · MUAF kapalı gerekçe · adayDegil ⇔ türemedi
//   §4 Kolonu YAZAN dosya kümesi beyanla İKİ YÖNLÜ eşit mi — (a)'da yazan/tüketen ayrı.
//      Bu, "geri alma donmuş kolona dokunmaz / girdiyi yalnız tüketen null'lar"ın
//      statik ölçüsüdür: beyansız yeni yazıcı (ör. bir undo yolu) KIRMIZI.
//   §5 Başka bekçiye verilen ayak atıfları çözülüyor mu (dosya + bölüm gerçekten var).
//   §6 SONDALAR — kapı kendi yüklemini iki yönde dener (aşağıda).
// DB ayağı (drift 0) `test_consistency_derived` §27/§28'de; SQL tek kaynak beyan dosyası.
//
// SINIR BEYANI: aday türetme bir AĞDIR, ispat değil — imza şerhin İLK cümlesinde aranır
// (ölçüldü 2026-09-13: tüm şerhte 37 aday / 13'ü atıf, ilk cümlede 23 aday / 4'ü atıf);
// imzası ilk cümlede olmayan gerçek snapshot beyana `adayDegil` ile elle girer. Yazıcı
// taraması tip denetleyicisiz AST: `data:`/`create:`/`update:` altındaki atama en yakın
// `<x>.<delegate>.<yazan metod>` çağrısına, iç içe ilişki yazımı şemadaki ilişki tipine
// bağlanır; çözülemeyen yazım SAYILIR ve kırmızıdır (sessiz yutma yok).
//
// NEGATİF SONDA (2026-09-13, üçü de bu dosyada `--sonda` ile koşar, her koşumda DEĞİL):
//   (i)  şemaya beyansız `/// Olay anındaki foo` alanı eklenir → §1 yüklemi kırmızı
//   (ii) beyanlı bir adayın şerh imzası silinir → aday listesinden DÜŞER (yüklem duyarlı;
//        "mutasyon uygulanmadı" sessizliğine karşı)
//   (iii) geçici dizine `tx.roll.updateMany({ data: { preShipStatus: null } })` yazan
//        beyansız dosya konur → §4 yüklemi o dosyayı "eksik tüketen" olarak kırmızı verir
// =============================================================================
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SNAPSHOT_KOLONLARI,
  BACKEND_KOK,
  anahtar,
  beyanSemaFarki,
  kolonYazicilari,
  semaAlanlari,
  snapshotAdaylari,
  yaziciFarki,
  type SnapshotBeyan,
} from "./lib/snapshot-kolonlari";

let pass = 0;
let fail = 0;
let atlanan = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function info(label: string, detail = ""): void {
  console.log(`ℹ  ${label}${detail ? ` — ${detail}` : ""}`);
}

const SONDA = process.argv.includes("--sonda");
/** Körlük zemini — "0 aday" ile "şema okunamadı" aynı yeşile inmesin (bugün 23 aday · 504 dosya). */
const EN_AZ_ADAY = 15;
const EN_AZ_DOSYA = 300;

function main(): void {
  console.log("\n=== Snapshot kolonları — beyan ↔ şema ↔ yazıcı kümesi ===\n");
  const semaMetni = readFileSync(join(BACKEND_KOK, "prisma", "schema.prisma"), "utf8");
  const alanlar = semaAlanlari(semaMetni);
  const adaylar = snapshotAdaylari(semaMetni);
  const beyan = SNAPSHOT_KOLONLARI;

  // ── §1 / §2 / adayDegil ────────────────────────────────────────────────
  const fark = beyanSemaFarki(adaylar, alanlar, beyan);
  check("§0 körlük zemini — şemadan aday türedi", adaylar.length >= EN_AZ_ADAY, `${adaylar.length} aday (taban ${EN_AZ_ADAY})`);
  check("§1 her şerh-imzalı aday BEYANDA", fark.beyansizAday.length === 0, fark.beyansizAday.length === 0 ? `${adaylar.length} aday` : `beyansız: ${fark.beyansizAday.join(" · ")}`);
  check("§2 her beyan ŞEMADA skaler", fark.semasizBeyan.length === 0, fark.semasizBeyan.length === 0 ? `${beyan.length} beyan` : `şemasız: ${fark.semasizBeyan.join(" · ")}`);
  check("§2b adayDegil ⇔ türemedi", fark.adayDegilCelisik.length === 0, fark.adayDegilCelisik.length === 0 ? "" : `çelişik: ${fark.adayDegilCelisik.join(" · ")}`);

  // ── §3 sınıf tutarlılığı ───────────────────────────────────────────────
  const beyanMap = new Map(beyan.map((b) => [anahtar(b), b]));
  const bozuk: string[] = [];
  for (const b of beyan) {
    const k = anahtar(b);
    if (!b.neden) bozuk.push(`${k}: neden yok`);
    if (b.sinif === "MUAF") {
      if (!b.muaf) bozuk.push(`${k}: MUAF ama gerekçe yok`);
      if (b.tuketen || b.sql || b.bekci) bozuk.push(`${k}: MUAF'ta ayak olmaz`);
    } else if (b.sinif === "GERI_ALMA_GIRDISI") {
      if (!b.tuketen || b.tuketen.length === 0) bozuk.push(`${k}: (a) ama tüketen yok`);
      const ortak = b.ayakOrtak ? beyanMap.get(b.ayakOrtak) : undefined;
      if (!(b.sql && b.sql.length > 0) && !(ortak && ortak.sql && ortak.sql.length > 0)) bozuk.push(`${k}: (a) ama DB ayağı yok (sql ya da ayakOrtak)`);
      if (b.muaf) bozuk.push(`${k}: (a) ama muaf dolu`);
    } else {
      if (b.tuketen) bozuk.push(`${k}: (b) tüketen taşımaz — donmuş değer null'lanmaz`);
      if (b.muaf) bozuk.push(`${k}: (b) ama muaf dolu`);
    }
  }
  const sqlIdler = beyan.flatMap((b) => (b.sql ?? []).map((q) => q.id));
  const tekrar = sqlIdler.filter((id, i) => sqlIdler.indexOf(id) !== i);
  if (tekrar.length > 0) bozuk.push(`sql id tekrarı: ${tekrar.join(", ")}`);
  const sinifSayisi = { a: 0, b: 0, muaf: 0 };
  for (const b of beyan) sinifSayisi[b.sinif === "GERI_ALMA_GIRDISI" ? "a" : b.sinif === "DONMUS_ILERI" ? "b" : "muaf"]++;
  check("§3 sınıf alanları tutarlı", bozuk.length === 0, bozuk.length === 0 ? `(a) ${sinifSayisi.a} · (b) ${sinifSayisi.b} · MUAF ${sinifSayisi.muaf} · DB ayağı ${sqlIdler.length}` : bozuk.join(" | "));
  const muafSayim = new Map<string, number>();
  for (const b of beyan) if (b.muaf) muafSayim.set(b.muaf.gerekce, (muafSayim.get(b.muaf.gerekce) ?? 0) + 1);
  info("§3 MUAF gerekçe dağılımı", [...muafSayim].map(([g, n]) => `${g} ${n}`).join(" · "));

  // ── §4 yazıcı kümesi ───────────────────────────────────────────────────
  const olculen = beyan.filter((b) => b.sinif !== "MUAF");
  const hedefler = olculen.map((b) => ({ model: b.model, alan: b.alan, tablo: alanlar.find((a) => a.model === b.model && a.alan === b.alan)?.tablo ?? b.model }));
  const t0 = Date.now();
  const { yazimlar, cozulemeyen, taranan } = kolonYazicilari(hedefler, alanlar);
  check("§4 körlük zemini — src tarandı", taranan >= EN_AZ_DOSYA, `${taranan} dosya · ${yazimlar.length} yazım · ${Date.now() - t0} ms`);
  check("§4a çözülemeyen yazım 0", cozulemeyen.length === 0, cozulemeyen.length === 0 ? "" : cozulemeyen.join(" | "));
  let yaziciBozuk = 0;
  for (const b of olculen) {
    const f = yaziciFarki(b, yazimlar);
    const sorun: string[] = [];
    if (f.eksikYazan.length) sorun.push(`beyansız yazan: ${f.eksikYazan.join(", ")}`);
    if (f.fazlaYazan.length) sorun.push(`bayat yazan: ${f.fazlaYazan.join(", ")}`);
    if (f.eksikTuketen.length) sorun.push(`beyansız TÜKETEN (null'layan): ${f.eksikTuketen.join(", ")}`);
    if (f.fazlaTuketen.length) sorun.push(`bayat tüketen: ${f.fazlaTuketen.join(", ")}`);
    if (sorun.length) {
      yaziciBozuk++;
      console.log(`   ❌ ${anahtar(b)} — ${sorun.join(" | ")}`);
    }
  }
  check("§4b yazıcı kümesi beyanla eşit (iki yönlü, dosya düzeyi)", yaziciBozuk === 0, `${olculen.length} kolon`);

  // ── §5 bekçi atıfları ──────────────────────────────────────────────────
  const kirikAtif: string[] = [];
  for (const b of beyan) {
    for (const r of b.bekci ?? []) {
      const yol = join(__dirname, r.dosya);
      if (!existsSync(yol)) { kirikAtif.push(`${anahtar(b)} → ${r.dosya} YOK`); continue; }
      const metin = readFileSync(yol, "utf8");
      const bolumVar = new RegExp(`id:\\s*"${r.bolum}"|§${r.bolum}(?![\\w])`).test(metin);
      if (!bolumVar) kirikAtif.push(`${anahtar(b)} → ${r.dosya} §${r.bolum} bulunamadı`);
    }
  }
  check("§5 bekçi ayak atıfları çözülüyor", kirikAtif.length === 0, kirikAtif.length === 0 ? `${beyan.reduce((n, b) => n + (b.bekci?.length ?? 0), 0)} atıf` : kirikAtif.join(" | "));

  // ── §6 sondalar ────────────────────────────────────────────────────────
  if (SONDA) {
    // (i) beyansız yeni snapshot kolonu
    const mutant = semaMetni.replace(/^model Roll \{$/m, "model Roll {\n  /// Olay anındaki foo — sonda\n  sondaFooAnindaki String?");
    const mAdaylar = snapshotAdaylari(mutant);
    const mFark = beyanSemaFarki(mAdaylar, semaAlanlari(mutant), beyan);
    check("§6i sonda — beyansız snapshot kolonu eklenince §1 KIRMIZI", mFark.beyansizAday.includes("Roll.sondaFooAnindaki"), `beyansız: ${mFark.beyansizAday.join(", ") || "∅"}`);
    // (ii) imza silinince aday düşer (yüklem duyarlı)
    const hedef = adaylar.find((a) => a.model === "RollReturn" && a.alan === "qty");
    check("§6ii sonda ön koşul — RollReturn.qty bugün aday", hedef != null);
    if (hedef) {
      const satirlar = semaMetni.split("\n");
      satirlar[hedef.satir - 1] = satirlar[hedef.satir - 1]!.replace(/\/\/.*$/, "// sonda: imzasız");
      const dusen = snapshotAdaylari(satirlar.join("\n"));
      check("§6ii sonda — şerh imzası silinince aday DÜŞER", !dusen.some((a) => anahtar(a) === "RollReturn.qty"), `${adaylar.length} → ${dusen.length}`);
    }
    // (iii) beyansız tüketen dosya
    const dir = mkdtempSync(join(tmpdir(), "snapshot-sonda-"));
    try {
      writeFileSync(join(dir, "sonda.service.ts"), "export async function s(tx: any) { await tx.roll.updateMany({ where: { id: 'x' }, data: { preShipStatus: null } }); }\n");
      const b = beyan.find((x) => anahtar(x) === "Roll.preShipStatus") as SnapshotBeyan;
      const m = kolonYazicilari([{ model: "Roll", alan: "preShipStatus", tablo: "rolls" }], alanlar, dir, dir);
      const f = yaziciFarki(b, m.yazimlar);
      check("§6iii sonda — beyansız null'layan dosya §4'te 'beyansız tüketen'", f.eksikTuketen.length === 1 && f.eksikTuketen[0]!.endsWith("sonda.service.ts"), `eksik tüketen: ${f.eksikTuketen.join(", ") || "∅"}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else {
    atlanan += 3;
    info("§6 sondalar KAPALI", "npx tsx scripts/test_snapshot_kolonlari.ts --sonda");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${atlanan ? `, ${atlanan} atlandı` : ""} ===`);
  if (fail > 0) {
    console.log(
      "\nDÜŞTÜYSE: (§1) yeni snapshot kolonu → scripts/lib/snapshot-kolonlari.ts beyanına sınıfıyla gir;\n" +
        "(§4) yeni yazıcı/tüketen → önce SOR: bu yol donmuş değeri değiştiriyor mu, girdiyi tüketmeden null'luyor mu?\n" +
        "Meşruysa beyana ekle; değilse yol yanlış — defter.md ÜÇÜNCÜ SINIF."
    );
  }
  process.exit(fail > 0 ? 1 : 0);
}

main();
