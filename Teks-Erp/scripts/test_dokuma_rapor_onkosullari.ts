// =============================================================================
// DOKUMA RAPOR SÖZLEŞMESİNİN ÖN KOŞULLARI
//
// ⚠️ BU BEKÇİ RAPORU ÖLÇMEZ — RAPORUN ÖLÇÜLEBİLİR OLMASINI ÖLÇER. Fark önemli:
// `docs/kurallar/dokuma.md`'deki üç rapor cümlesi (① randıman üç oran ·
// ② Pareto iki eksen · ③ kaynak kırılımı) raporun ÇIKTISI üzerinde mandaldır ve
// o çıktı bugün YOKTUR — ne rapor servisi ne de sözleşmenin adıyla andığı
// taşıyıcı (`MachineShiftStat`) indi (ölçüldü 2026-09-13). Çıktı bekçisini
// bugün yazmak, HİÇ BASILMAYAN BİR DALIN YEŞİLİNİ üretirdi.
//
// ⇒ Bu dosya üç cümlenin ÖNCÜLLERİNİ ölçer. Öncüller SESSİZCE ölebilir ve
// öldüklerinde gelecekteki çıktı bekçisi YEŞİL ama BOŞ olur:
//   ① `targetPicksPerMin` NOT NULL ya da DEFAULT'lu olursa rapor "P: ölçülemedi"
//      dalına HİÇ giremez ve UYDURULMUŞ bir performans basar.
//   ② `lossClass` NOT NULL ya da DEFAULT'lu olursa "KARAR YOK" temsil edilemez;
//      her duruş doğuşta sınıflanmış görünür ve Pareto'nun kayıp ekseni yalan söyler.
//   ③ `SIMULATED` ile `OPERATOR` ayrı iki etiket olmazsa, ③'ün (b) sondasının
//      ÖNCÜLÜ ölür — "birleştirilirse kırmızı" diyen kural ölçülemez hâle gelir.
//
// ÜÇ SONUÇ, İKİ DEĞİL: `uyumlu` · `ihlal` · `ölçülemedi`. §4 bugün ÖLÇÜLEMEDİ
// basar ve neyin beklendiğini ADIYLA yazar — boş hücre değil BEYAN.
//
// ⭐ MANDAL KENDİ UYANIR (§3c + §4): rapor taşıyıcısı indiği gün bu bekçi
// KIRMIZI verir ve sahibini adıyla çağırır. Tetik bir AD TAHMİNİ değil bir
// DAVRANIŞTIR: kaynak kırılımı raporun satırında yaşar, yani `MachineDataSource`
// tipinde envanter-dışı bir kolonun doğması taşıyıcının geldiğini söyler — adı
// ne olursa olsun. (`test_db_invariants` `checkNoExtras()` idiomu.)
//
// Salt-okunur: hiçbir yazma/fixture yok.
// Koşum: npx tsx scripts/test_dokuma_rapor_onkosullari.ts
// =============================================================================
import prisma from "../src/lib/prisma";
// ⛔ ELECTRON MODÜLÜ İMPORT EDİLMEZ, METİN OLARAK OKUNUR — ve bu bir tercih
// değil İKİ ÖLÇÜMÜN sonucu: ① `tsc` TS6059 verir (dosya Teks-Erp'in `rootDir`ı
// dışında) ② `audit-labels.ts` `date-fns` çeker ve o paket Teks-Erp'in
// bağımlılığı DEĞİL ⇒ CI'ın Backend job'ı yalnız Teks-Erp'te `npm ci` koştuğu
// için import ORADA çözülmezdi. Çöken bir sonda, sonda değildir.
// (`test_audit_labels` aynı dosyayı aynı sebeple metin okur.)
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// ⚠️ ATLAMA DEFTERİ ORTAK ALTYAPIDIR, kopyası açılmaz: "ölçemedim" ile "ölçtüm,
// geçti" aynı sayıya çıkmasın diye. §4 sınıf ④'tür (erken dönüş gibi: kaç
// kontrol düştüğü YAPISAL OLARAK bilinemez) ⇒ adet `"?"`, ve `TEKSERP_STRICT=1`
// altında KIRMIZI — paket kararı raporu ölçmemiş bir koşumdan verilemez.
import { atlamaDefteri } from "./lib/atlama";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const atlama = atlamaDefteri((mesaj) => {
  fail++;
  console.log(`❌ ${mesaj}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SAF YÜKLEMLER — okuyucular ENJEKTE edilir, böylece §5 sondaları DB'ye
// dokunmadan yüklemin ısırdığını ölçer. (Canlı DB'yi mutasyona uğratan bir
// sonda, ölçtüğünün içine karışırdı.)
// ─────────────────────────────────────────────────────────────────────────────
export type Kolon = { tablo: string; kolon: string; nullable: boolean; varsayilan: string | null };

/**
 * "ÖLÇÜLEMEDİ" / "KARAR YOK" DALI TEMSİL EDİLEBİLİR Mİ?
 * İki koşul birlikte: kolon NULL alabilmeli VE varsayılanı olmamalı.
 * ⚠️ Yalnız `nullable` yetmez — DEFAULT'lu nullable bir kolon pratikte hiç
 * NULL doğmaz ve dal ERİŞİLEMEZ olur.
 */
export function bosDalTemsilEdilebilir(k: Kolon | undefined): { ok: boolean; neden: string } {
  if (!k) return { ok: false, neden: "kolon YOK" };
  if (!k.nullable) return { ok: false, neden: "NOT NULL — dal hiç doğmaz" };
  if (k.varsayilan !== null) return { ok: false, neden: `DEFAULT ${k.varsayilan} — nullable ama hiç NULL doğmaz` };
  return { ok: true, neden: "nullable ve DEFAULT'suz" };
}

/** BEYAN ZORUNLU: değeri yazan her yol kaynağını AÇIKÇA söyler ⇒ DEFAULT YASAK. */
export function beyanZorunlu(k: Kolon | undefined): { ok: boolean; neden: string } {
  if (!k) return { ok: false, neden: "kolon YOK" };
  if (k.varsayilan !== null) return { ok: false, neden: `DEFAULT ${k.varsayilan} — beyan sessizce DOLDURULUR` };
  return { ok: true, neden: "DEFAULT'suz" };
}

/** ENUM İKİ YÖNLÜ: eksik değer kadar FAZLA değer de sözleşmeyi bozar. */
export function enumTam(
  gercek: string[] | undefined,
  beklenen: string[],
): { ok: boolean; neden: string } {
  if (!gercek || gercek.length === 0) return { ok: false, neden: "enum tipi YOK" };
  const eksik = beklenen.filter((x) => !gercek.includes(x));
  const fazla = gercek.filter((x) => !beklenen.includes(x));
  if (eksik.length === 0 && fazla.length === 0) return { ok: true, neden: gercek.join(" · ") };
  const parcalar: string[] = [];
  if (eksik.length) parcalar.push(`EKSİK: ${eksik.join(", ")}`);
  if (fazla.length) parcalar.push(`FAZLA: ${fazla.join(", ")}`);
  return { ok: false, neden: parcalar.join(" | ") };
}

/**
 * İKİ ETİKET AYRI MI DURUYOR?
 * ③'ün (b) sondası — *"`SIMULATED` `OPERATOR`a katılırsa kırmızı"* — ancak ikisi
 * AYRI iki enum değeriyse ölçülebilir. Biri silinirse kural ölçülemez hâle gelir.
 */
export function ayriDuruyor(gercek: string[] | undefined, a: string, b: string): { ok: boolean; neden: string } {
  if (!gercek) return { ok: false, neden: "enum tipi YOK" };
  const varA = gercek.includes(a);
  const varB = gercek.includes(b);
  if (varA && varB) return { ok: true, neden: `${a} ≠ ${b}, ikisi de var` };
  return { ok: false, neden: `${a}:${varA ? "var" : "YOK"} · ${b}:${varB ? "var" : "YOK"} — ayrım ölçülemez` };
}

const AUDIT_LABELS_YOLU = path.resolve(__dirname, "../../Electron/src/lib/audit-labels.ts");

/** `const <ad> … = {` ile `\n};` arasındaki gövde. Bulunamazsa `null` — ve `null` KIRMIZIDIR. */
export function bloguCikar(kaynak: string, ad: string): string | null {
  const bas = kaynak.search(new RegExp(`const ${ad}\\b[^=]*=\\s*\\{`));
  if (bas < 0) return null;
  const son = kaynak.indexOf("\n};", bas);
  return son < 0 ? null : kaynak.slice(bas, son);
}

/** `FIELD_ENUM_OVERRIDES` içindeki `"<kapsam>": { <değer>: "…" }`. */
export function kapsamliEtiket(blok: string | null, kapsam: string, deger: string): string | null {
  if (!blok) return null;
  const m = blok.match(new RegExp(`"${kapsam}"\\s*:\\s*\\{([^}]*)\\}`));
  if (!m) return null;
  const d = m[1].match(new RegExp(`\\b${deger}\\s*:\\s*"([^"]*)"`));
  return d ? d[1] : null;
}

/** `ENUM_LABELS` içindeki düz `<değer>: "…"`. */
export function genelEtiket(blok: string | null, deger: string): string | null {
  if (!blok) return null;
  const d = blok.match(new RegExp(`^\\s*${deger}\\s*:\\s*"([^"]*)"`, "m"));
  return d ? d[1] : null;
}

/**
 * ② PARETO'NUN ÖNCÜLÜ — `MINOR` bir SÜRE sınıfıdır, kusur ŞİDDETİ değil.
 * Denetim ekranı düz `değer → Türkçe` haritasıyla çalışır ve `MINOR` global
 * cevabı `DefectSeverity` dilinde yazılmıştır ("Küçük"). Ayrım bir override'la
 * kurulur; override silinirse ekran duruşa "Küçük" der, Pareto'nun kayıp ekseni
 * bir ŞİDDET gibi okunur ve HİÇBİR test kırmızı vermez (ölçüldü 2026-09-13:
 * override silinince Electron 75/75, backend 22/0 yeşil kaldı).
 * ⚠️ İKİ YÖNLÜ: eşitlik hem override YOKKEN hem de override global cevapla AYNI
 * yazıldığında doğar; ikisi de bu yüklemle reddedilir.
 */
export function ayrimKorunuyor(kapsamli: string | null, genel: string | null): { ok: boolean; neden: string } {
  // ⚠️ AYRIŞTIRICI SESSİZCE BOŞ DÖNEBİLİR (dosya taşınır, biçim değişir) ve o
  // boşluk "ikisi farklı" gibi okunurdu. `null` bir SONUÇ DEĞİL, bir ARIZADIR.
  if (kapsamli === null) return { ok: false, neden: "kapsamlı etiket OKUNAMADI — ayrıştırıcı mı bozuk, satır mı yok?" };
  if (genel === null) return { ok: false, neden: "global etiket OKUNAMADI — ayrıştırıcı bozuk" };
  if (kapsamli === genel) return { ok: false, neden: `ikisi de "${genel}" — ayrım YOK` };
  return { ok: true, neden: `"${kapsamli}" ≠ "${genel}"` };
}

/**
 * §4'ÜN KARARI — saf. Ayrı bir yüklem olmasının tek sebebi ÖLÇÜLEBİLİRLİK:
 * "mandal uyandı" dalı, taşıyıcı inene kadar CI'da HİÇ BASILMAZ ve basılmayan
 * bir dalın yeşili kapsam değildir (§5l onu burada basar).
 */
export function tasiyiciKarari(varMi: boolean): "olculemedi" | "mandal-uyandi" {
  return varMi ? "mandal-uyandi" : "olculemedi";
}

/**
 * MANDAL UYANDIKTAN SONRAKİ KARAR — saf (2026-09-14, 01 Dilim 1: taşıyıcı İNDİ).
 * Taşıyıcı tablo ile rapor YÜZEYİ ayrı dilimlerde iner (özet §8: şema Dilim 1, uçlar
 * Dilim 4). Ölçülecek ÇIKTI rapor ucuyla doğar ⇒ çıktı bekçisi de onunla (aynı commit).
 *   · rapor ucu YOK ∧ çıktı bekçisi YOK → "yuzey-bekleniyor" (⏭ beyan, yeşil DEĞİL)
 *   · rapor ucu VAR ∧ çıktı bekçisi YOK → "bekci-eksik" (❌ — mandalın asıl ısırığı)
 *   · çıktı bekçisi VAR              → "tamam" (uç olmasa bile bekçi erken gelebilir)
 * ⚠️ "Taşıyıcı var ⇒ hemen kırmızı" eski hâli Dilim 1–3 arasında CI'ı kırmızı tutardı ve
 * susturulurdu; kapı gerçek ısırığını (uç var, bekçi yok) sessizce kaybederdi.
 */
export function ciktiKarari(raporUcuVar: boolean, ciktiBekcisiVar: boolean): "tamam" | "bekci-eksik" | "yuzey-bekleniyor" {
  if (ciktiBekcisiVar) return "tamam";
  return raporUcuVar ? "bekci-eksik" : "yuzey-bekleniyor";
}

/** ENVANTER İKİ YÖNLÜ — kaybolan kadar DOĞAN kolon da bir olaydır. */
export function envanterFarki(
  gercek: string[],
  beklenen: string[],
): { eksik: string[]; fazla: string[] } {
  return {
    eksik: beklenen.filter((x) => !gercek.includes(x)),
    fazla: gercek.filter((x) => !beklenen.includes(x)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENVANTER — elle tutulur ve BU DOSYADA yaşar (test_db_invariants emsali).
// ⚠️ Yeni bir `MachineDataSource` kolonu eklendiğinde buraya da yazılır; o an
// §3c kırmızı verir ve yazan kişiyi tek soruyla yüzleştirir:
// *bu kolon raporun KAYNAK KIRILIMINI mı taşıyor? Öyleyse ③'ün çıktı bekçisi.*
// ─────────────────────────────────────────────────────────────────────────────
const KAYNAK_KOLONLARI_BEKLENEN = [
  // Doff'taki SAYAÇ OKUMASININ kökeni (`counterAtDoff` ile çift). `NOT NULL`,
  // `@default` YOK — tasarımın kendi cümlesi: "`SIMULATED` beyanı burada doğar".
  // ⚠️ Bu bir OLAY kolonudur, raporun taşıyıcısı DEĞİL (2026-09-13'te mandal
  // uyanınca şemadan OKUNARAK sınıflandırıldı, varsayılmadı).
  "doff_events.counterSource",
  "machine_stop_events.reasonSource",
  "machine_stop_events.source",
  // (a) sınıfı — RAPORUN SATIRINDA yaşayan TAŞIYICI (2026-09-14, 01 Dilim 1): karnenin
  // kaynak kırılımı bu kolondan basılır; `SIMULATED` `OPERATOR`a katılmaz, `INFERRED`
  // boş tezgah beyanıdır. `@default` YOK — her yazım `resolveShiftSource` ile beyan eder.
  "machine_shift_stats.source",
];

const LOSS_CLASS_BEKLENEN = ["UNPLANNED", "SETUP", "PLANNED", "NON_SCHEDULED", "MINOR"];
const DATA_SOURCE_BEKLENEN = ["MACHINE", "INFERRED", "OPERATOR", "SUPERVISOR", "SIMULATED"];

/** Raporun sözleşmede ADIYLA anılan taşıyıcısı (`dokuma.md` § kaynak kırılımı). */
const TASIYICI_TABLO = "machine_shift_stats";
/** Rapor YÜZEYİ (özet §5) ve ÇIKTI bekçisi (özet §7) — ikisi Dilim 4'te aynı commit'te doğar. */
const RAPOR_UCU_YOLU = path.resolve(__dirname, "../src/routes/reports/dokuma.report.routes.ts");
const CIKTI_BEKCISI_YOLU = path.resolve(__dirname, "test_dokuma_rapor_cikti.ts");

async function kolonlariOku(): Promise<Map<string, Kolon>> {
  const satirlar = await prisma.$queryRawUnsafe<
    { table_name: string; column_name: string; is_nullable: string; column_default: string | null }[]
  >(`SELECT table_name, column_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'`);
  const m = new Map<string, Kolon>();
  for (const s of satirlar) {
    m.set(`${s.table_name}.${s.column_name}`, {
      tablo: s.table_name,
      kolon: s.column_name,
      nullable: s.is_nullable === "YES",
      varsayilan: s.column_default,
    });
  }
  return m;
}

async function enumOku(tip: string): Promise<string[] | undefined> {
  const satirlar = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = $1 ORDER BY e.enumsortorder`,
    tip,
  );
  return satirlar.length ? satirlar.map((s) => s.enumlabel) : undefined;
}

async function kaynakKolonlariOku(): Promise<string[]> {
  const satirlar = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND udt_name = 'MachineDataSource'
      ORDER BY table_name, column_name`,
  );
  return satirlar.map((s) => `${s.table_name}.${s.column_name}`);
}

async function tabloVarMi(ad: string): Promise<boolean> {
  const satirlar = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT count(*)::bigint AS c FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`,
    ad,
  );
  return Number(satirlar[0]?.c ?? 0) > 0;
}

async function main(): Promise<void> {
  console.log("=== Dokuma rapor sözleşmesinin ÖN KOŞULLARI ===");
  console.log("    (raporun ÇIKTISI ölçülmez — ölçülebilir OLMASI ölçülür)\n");

  const kolonlar = await kolonlariOku();
  const lossClass = await enumOku("MachineStopLossClass");
  const dataSource = await enumOku("MachineDataSource");

  // ── §1 — ① RANDIMAN: "P: ölçülemedi" dalı temsil edilebilir mi ────────────
  console.log("§1 — ① randıman: 'P: ölçülemedi' dalı TEMSİL EDİLEBİLİR mi");
  for (const yol of ["machine_runs.targetPicksPerMin", "machine_specs.nominalPicksPerMin"]) {
    const r = bosDalTemsilEdilebilir(kolonlar.get(yol));
    check(`§1 ${yol} boş dalı taşıyabilir`, r.ok, r.neden);
  }
  console.log("");

  // ── §2 — ② PARETO: kayıp sınıfı ekseni ────────────────────────────────────
  console.log("§2 — ② Pareto: KAYIP SINIFI ekseni");
  const e2 = enumTam(lossClass, LOSS_CLASS_BEKLENEN);
  check("§2a MachineStopLossClass tam (iki yönlü)", e2.ok, e2.neden);
  const k2 = bosDalTemsilEdilebilir(kolonlar.get("machine_stop_events.lossClass"));
  check("§2b lossClass 'KARAR YOK'u taşıyabilir", k2.ok, k2.neden);
  console.log("");

  // ── §3 — ③ KAYNAK KIRILIMI ────────────────────────────────────────────────
  console.log("§3 — ③ kaynak kırılımı");
  const e3 = enumTam(dataSource, DATA_SOURCE_BEKLENEN);
  check("§3a MachineDataSource tam (iki yönlü)", e3.ok, e3.neden);
  const a3 = ayriDuruyor(dataSource, "SIMULATED", "OPERATOR");
  check("§3b ⭐ SIMULATED ile OPERATOR AYRI durur", a3.ok, a3.neden);

  const kaynakKolonlari = await kaynakKolonlariOku();
  for (const yol of kaynakKolonlari) {
    const r = beyanZorunlu(kolonlar.get(yol));
    check(`§3c ${yol} @default ALMAZ`, r.ok, r.neden);
  }
  const fark = envanterFarki(kaynakKolonlari, KAYNAK_KOLONLARI_BEKLENEN);
  check(
    "§3d ⭐ kaynak kolonu envanteri tam (iki yönlü)",
    fark.eksik.length === 0 && fark.fazla.length === 0,
    fark.eksik.length === 0 && fark.fazla.length === 0
      ? `${kaynakKolonlari.length} kolon`
      : `EKSİK: ${fark.eksik.join(", ") || "—"} | FAZLA: ${fark.fazla.join(", ") || "—"}` +
          "  ⇒ YENİ bir kaynak kolonu doğdu; SINIFLANDIR (şemadan OKU, varsayma): " +
          "(a) raporun SATIRINDA yaşıyorsa taşıyıcı gelmiştir ⇒ ③'ün ÇIKTI bekçisi yazılmalı (sahibi: d9) · " +
          "(b) bir OLAYIN kökenini taşıyorsa envantere gerekçesiyle eklenir (emsal: doff_events.counterSource). " +
          "⚠️ Bu satır önce (a)yı KESİN söylüyordu ve ilk uyanışında YANILDI.",
  );
  console.log("");

  // ── §4 — ÖLÇÜLEMEDİ + MANDALIN UYANMASI ───────────────────────────────────
  console.log("§4 — raporun ÇIKTISI");
  const tasiyiciVar = await tabloVarMi(TASIYICI_TABLO);
  if (tasiyiciKarari(tasiyiciVar) === "olculemedi") {
    atlama.atla(
      "3 BÖLÜM: ① randıman üç oran · ② Pareto iki eksen · ③ kaynak kırılımı — ÇIKTI bekçileri",
      `rapor taşıyıcısı '${TASIYICI_TABLO}' YOK ve rapor servisi inmedi — ölçülecek ÇIKTI yok. ` +
        "NE atlandığı BELLİ (üç bölüm, adıyla); KAÇ KONTROL atlandığı bilinemez çünkü o " +
        "kontroller henüz YAZILMADI — sayı uydurmak ölçüm değil beyan olurdu",
      "?",
    );
    console.log(
      "      gelince: ① üç oran AYRI basılır, ÇARPILMAZ, targetPicksPerMin ve nominalPicksPerMin\n" +
        "               ikisi de NULL ise 'P: ölçülemedi' basılır · ② SEBEP × KAYIP SINIFI iki\n" +
        "               ekseni AYRI, beamSlot NULL olan 'atanmamış' kovasında AYRI · ③ toplam =\n" +
        "               Σkırılım, kırılım BASILIR + İKİ YÖNLÜ sonda: (a) kırılım basılmazsa\n" +
        "               kırmızı (b) SIMULATED OPERATOR'a katılırsa kırmızı",
    );
  } else {
    // Mandal UYANDI (taşıyıcı 2026-09-14'te indi, migration 20260914130000). Isırık rapor
    // YÜZEYİYLE gelir: uç var, bekçi yok → kırmızı; uç yok → ⏭ beyan (yeşil değil).
    const raporUcuVar = existsSync(RAPOR_UCU_YOLU);
    const ciktiBekcisiVar = existsSync(CIKTI_BEKCISI_YOLU);
    const karar = ciktiKarari(raporUcuVar, ciktiBekcisiVar);
    if (karar === "yuzey-bekleniyor") {
      atlama.atla(
        "3 BÖLÜM: ① randıman üç oran · ② Pareto iki eksen · ③ kaynak kırılımı — ÇIKTI bekçileri",
        `taşıyıcı '${TASIYICI_TABLO}' İNDİ ama rapor ucu (${path.basename(RAPOR_UCU_YOLU)}) inmedi — ` +
          "ölçülecek ÇIKTI yok; çıktı bekçisi rapor ucuyla AYNI commit'te doğar (özet §8 Dilim 4). " +
          "Uç inip bekçi gelmezse bu dal KIRMIZIDIR.",
        "?",
      );
    } else {
      check(
        "§4 ⭐ rapor yüzeyi indi ⇒ ÇIKTI bekçisi yazılmış olmalı",
        karar === "tamam",
        karar === "tamam"
          ? `${path.basename(CIKTI_BEKCISI_YOLU)} var`
          : `${path.basename(RAPOR_UCU_YOLU)} VAR ama ${path.basename(CIKTI_BEKCISI_YOLU)} YOK — ` +
            "①②③ çıktı bekçisi rapor ucuyla aynı commit'te iner (sahibi: 01/d9). Mandal ısırdı.",
      );
    }
  }
  console.log("");

  // ── §6 — ② PARETO'NUN ÖNCÜLÜ: MINOR SÜRE sınıfıdır, ŞİDDET değil ─────────
  console.log("§6 — ② Pareto öncülü: MINOR bir SÜRE sınıfı, kusur ŞİDDETİ değil");
  const kaynak = readFileSync(AUDIT_LABELS_YOLU, "utf8");
  const overrideBlok = bloguCikar(kaynak, "FIELD_ENUM_OVERRIDES");
  const genelBlok = bloguCikar(kaynak, "ENUM_LABELS");
  check("§6a0 ayrıştırıcı iki bloğu da buldu", overrideBlok !== null && genelBlok !== null);
  // ⚠️ KIRMIZI KENDİ TEŞHİSİNİ TAŞIR: "okunamadı" üç ayrı sebepten doğar ve
  // düzeltmeleri FARKLIDIR — (A) kapsam satırı silindi · (B) kapsam duruyor ama
  // değer düştü · (C) ayrıştırıcı bozuk (§6a0 bunu zaten eler).
  const KAPSAM = "MACHINE_STOP_EVENT.lossClass";
  const kapsamVar = overrideBlok !== null && overrideBlok.includes(`"${KAPSAM}"`);
  const a6 = ayrimKorunuyor(kapsamliEtiket(overrideBlok, KAPSAM, "MINOR"), genelEtiket(genelBlok, "MINOR"));
  const teshis = a6.ok ? "" : kapsamVar ? " [(B) kapsam VAR, MINOR düşmüş]" : " [(A) kapsam satırı YOK]";
  check("§6a ⭐ MINOR'un duruş etiketi global (şiddet) cevaptan AYRI", a6.ok, a6.neden + teshis);
  for (const v of LOSS_CLASS_BEKLENEN) {
    const etiket = kapsamliEtiket(overrideBlok, "MACHINE_STOP_EVENT.lossClass", v) ?? genelEtiket(genelBlok, v);
    check(`§6b ${v} Türkçeye çevrilir`, etiket !== null && etiket !== v, etiket ?? "OKUNAMADI");
  }
  console.log("");

  // ── §5 — SONDALAR: yüklemler gerçekten ısırıyor mu ────────────────────────
  console.log("§5 — sondalar (yüklemler enjekte edilmiş satırlarla ölçülür)");
  const sahte = (o: Partial<Kolon>): Kolon => ({ tablo: "t", kolon: "c", nullable: true, varsayilan: null, ...o });
  check("§5a ⭐ NOT NULL kolon boş dalı TAŞIYAMAZ", !bosDalTemsilEdilebilir(sahte({ nullable: false })).ok);
  check("§5b ⭐ DEFAULT'lu nullable kolon boş dalı TAŞIYAMAZ", !bosDalTemsilEdilebilir(sahte({ varsayilan: "0" })).ok);
  check("§5c nullable + DEFAULT'suz TAŞIR", bosDalTemsilEdilebilir(sahte({})).ok);
  check("§5d ⭐ olmayan kolon TAŞIYAMAZ", !bosDalTemsilEdilebilir(undefined).ok);
  check("§5e ⭐ enum'da EKSİK değer reddedilir", !enumTam(["UNPLANNED"], LOSS_CLASS_BEKLENEN).ok);
  check("§5f ⭐ enum'da FAZLA değer de reddedilir", !enumTam([...LOSS_CLASS_BEKLENEN, "SAHTE"], LOSS_CLASS_BEKLENEN).ok);
  check("§5g ⭐ SIMULATED silinirse ayrım ÖLÇÜLEMEZ", !ayriDuruyor(["OPERATOR", "MACHINE"], "SIMULATED", "OPERATOR").ok);
  check("§5h ⭐ envanterde FAZLA kolon yakalanır", envanterFarki(["a.b", "c.d"], ["a.b"]).fazla.length === 1);
  check("§5i ⭐ envanterde EKSİK kolon yakalanır", envanterFarki([], ["a.b"]).eksik.length === 1);
  check("§5j ⭐ DEFAULT'lu kolon beyan zorunluluğunu İHLAL eder", !beyanZorunlu(sahte({ varsayilan: "'MACHINE'" })).ok);

  // ⚠️ §4'ÜN ZİNCİRİ HALKALARINDAN ÖLÇÜLÜR. `tabloVarMi` hep `false` dönseydi
  // §4 sonsuza dek "ÖLÇÜLEMEDİ" basar, mandal HİÇ uyanmazdı ve bunu kimse
  // görmezdi: bekçi yeşil, kapı ölü. Okuyucu VAR OLAN bir tabloyla ölçülür.
  check("§5k ⭐ tabloVarMi VAR OLAN tabloyu görür", await tabloVarMi("machine_stop_events"));
  check("§5l ⭐ tabloVarMi OLMAYAN tabloyu görmez", !(await tabloVarMi("__yok_boyle_bir_tablo__")));
  check("§5m ⭐ taşıyıcı VARSA mandal UYANIR", tasiyiciKarari(true) === "mandal-uyandi");
  check("§5n taşıyıcı YOKSA ölçülemedi", tasiyiciKarari(false) === "olculemedi");
  // ⚠️ İKİNCİ HALKA: uyanan mandalın kararı da halkalarından ölçülür — "uç var, bekçi yok"
  // dalı bugün BASILMIYOR (uç Dilim 4'te); basılmayan dalın kırmızısı burada kanıtlanır.
  check("§5n2 ⭐ rapor ucu VAR ∧ çıktı bekçisi YOK → KIRMIZI", ciktiKarari(true, false) === "bekci-eksik");
  check("§5n3 rapor ucu YOK ∧ bekçi YOK → yüzey bekleniyor (⏭, yeşil değil)", ciktiKarari(false, false) === "yuzey-bekleniyor");
  check("§5n4 çıktı bekçisi VARSA tamam", ciktiKarari(true, true) === "tamam" && ciktiKarari(false, true) === "tamam");
  // ⚠️ İKİ ÖLÜM YOLU TEK GÖZLEMDE BİRLEŞİR: override silinse de, global cevapla
  // AYNI yazılsa da yüklem aynı eşitliği görür — bu yüzden TEK sonda yeter.
  check("§5o ⭐ eşit etiket (override yok VEYA globalle aynı) reddedilir", !ayrimKorunuyor("Küçük", "Küçük").ok);
  check("§5p farklı iki etiket kabul edilir", ayrimKorunuyor("Mikro duruş", "Küçük").ok);
  // ⚠️ AYRIŞTIRICININ KENDİSİ DE ÖLÇÜLÜR: sessizce boş dönerse §6a "ayrım var"
  // sanılırdı. `null` KIRMIZIYA gider, farka değil.
  check("§5r ⭐ okunamayan kapsamlı etiket KIRMIZI (fark sanılmaz)", !ayrimKorunuyor(null, "Küçük").ok);
  check("§5s ⭐ okunamayan global etiket KIRMIZI", !ayrimKorunuyor("Mikro duruş", null).ok);
  check("§5t ⭐ olmayan blok null döner", bloguCikar("hiç yok", "FIELD_ENUM_OVERRIDES") === null);
  check("§5u ⭐ olmayan kapsam null döner", kapsamliEtiket("{}", "YOK.alan", "MINOR") === null);
  console.log("");

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız${atlama.ozetEki()} ===`);
  if (atlama.bilinmeyenVar) {
    console.log("⚠️  Bu yeşil 'rapor doğru' DEMEZ: raporun ÇIKTISI bu koşumda ÖLÇÜLMEDİ.");
  }
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

void main();
