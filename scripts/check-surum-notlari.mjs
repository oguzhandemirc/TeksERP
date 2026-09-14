#!/usr/bin/env node
// =============================================================================
// Sürüm notları bekçisi
// =============================================================================
// Notlar operatöre gösterilen tek yüzeydir ve YAYIN KAPISIDIR: not yazılmadan
// sürüm çıkmaz. Bu script hem şemayı hem dili hem de kopyaların tazeliğini
// denetler; `--panel=` / `--tablet=` argümanıyla çağrıldığında o sürüm için
// kayıt olup olmadığını da kontrol eder (yayın kapısının kendisi).
//
// Kullanım:
//   node scripts/check-surum-notlari.mjs                 # şema + dil + kopya
//   node scripts/check-surum-notlari.mjs --panel=2.8.3   # + o sürüm için kayıt var mı
//   node scripts/check-surum-notlari.mjs --tablet=2.9.10
//   node scripts/check-surum-notlari.mjs --kunyeden   # sürümleri PAKET KÜNYELERİNDEN oku
//
// `--kunyeden` CI ve APK yayın yolu içindir: panel sürümü `Electron/package.json`,
// tablet sürümü `mobil/app.json` (`expo.version`) — yani paketin SAHAYA GİDEN
// künyesi. Bu dairesel DEĞİLDİR: künye notu üretmez, not künyeyi üretmez; kapı
// "sahaya gidecek sürümün notu var mı" diye sorar. Yasak olan, bir script'in
// `surumler.*` alanını künyeden okuyup not dosyasına YAZMASIDIR.
//
// ⚠️ KAPI DAİRESEL DEĞİLDİR: beklenen sürüm ARGÜMANDAN gelir, notun kendisi
// onu üretmez yalnız doğrular. Hiçbir script `surumler.*` alanını package.json
// / app.json'dan okuyup YAZMAMALIDIR — yazsaydı kapı kendi yazdığını doğrular,
// yani hiçbir şey doğrulamazdı.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kok = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KAYNAK = path.join(kok, "surum-notlari.json");
const KOPYALAR = [
  path.join(kok, "Electron", "src", "data", "surum-notlari.json"),
  path.join(kok, "mobil", "src", "data", "surum-notlari.json"),
];

const KAPSAMLAR = new Set(["panel", "tablet", "her-ikisi"]);
const TIPLER = new Set(["yeni", "duzeltme", "iyilestirme"]);
const ID_RE = /^\d{4}-\d{2}-\d{2}[a-z]?$/;
const SURUM_RE = /^\d+\.\d+\.\d+$/;

/**
 * Operatör diline sızan teknik terimler. Metnin DOĞRULUĞU denetlenemez ama
 * teknik terim VARLIĞI denetlenebilir — kullanıcı kararı "operatör dili".
 */
const TEKNIK_TERIMLER = [
  "api", "endpoint", "migration", "refactor", "commit", "backend", "frontend",
  "cache", "deploy", "null", "tx", "prop", "component", "hook", "schema",
  "query", "service", "enum", "json", "sql", "dto", "regex", "index",
  "repository", "middleware", "payload", "guard", "mutation",
];

let gecti = 0;
let kaldi = 0;
/**
 * @param yesildeDeBas Detayı yeşilde de göster. Varsayılan KAPALI: "şunu yap"
 * biçimindeki bir düzeltme tarifi yeşil satırda okuyucuyu yapılacak iş olduğuna
 * inandırır. Ölçüm bildiren detaylarda (kaç yayın, kaç madde) açılır.
 */
function check(etiket, ok, detay = "", yesildeDeBas = false) {
  if (ok) gecti++;
  else kaldi++;
  const goster = detay && (!ok || yesildeDeBas);
  console.log(`${ok ? "✅" : "❌"} ${etiket}${goster ? ` — ${detay}` : ""}`);
}

const KUNYEDEN = process.argv.includes("--kunyeden");

const arg = (ad) => {
  const p = process.argv.find((a) => a.startsWith(`--${ad}=`));
  return p ? p.slice(ad.length + 3) : null;
};

// --- Dosya --------------------------------------------------------------
if (!fs.existsSync(KAYNAK)) {
  console.error(`❌ Kaynak yok: ${KAYNAK}`);
  process.exit(1);
}
let veri;
try {
  veri = JSON.parse(fs.readFileSync(KAYNAK, "utf8"));
} catch (e) {
  console.error(`❌ surum-notlari.json okunamadı: ${e.message}`);
  process.exit(1);
}
const yayinlar = Array.isArray(veri.yayinlar) ? veri.yayinlar : [];

console.log("\n§0 — Körlük zemini");
// "Sapma yok" ile "hiçbir şeye bakmadım" aynı yeşile çıkmasın.
check("dosyada en az bir yayın var", yayinlar.length > 0, `${yayinlar.length} yayın`, true);
const toplamMadde = yayinlar.reduce((n, y) => n + (y.maddeler?.length ?? 0), 0);
check("en az bir madde çözümlendi", toplamMadde > 0, `${toplamMadde} madde`, true);

console.log("\n§1 — Kimlik (id)");
const idler = yayinlar.map((y) => y.id);
check("hepsi YYYY-AA-GG biçiminde", idler.every((i) => ID_RE.test(String(i))),
  idler.filter((i) => !ID_RE.test(String(i))).join(", "));
check("benzersiz", new Set(idler).size === idler.length);
// ⚠️ Sıra load-bearing: gösterim mantığı `id > isaret` ile çalışıyor.
const azalan = idler.every((v, i) => i === 0 || idler[i - 1] > v);
check("EN YENİ ÖNCE sıralı (gösterim mantığı buna dayanıyor)", azalan);
// ⚠️ ASCII zorunlu: çıktı kapıları id'yi Hermes/asar ikilisinde arayacak;
// Türkçe karakterli dizeler UTF-16 tablosuna gidip BULUNAMAZ hale gelir.
check("salt ASCII (paket içi arama için şart)",
  idler.every((i) => /^[\x20-\x7E]+$/.test(String(i))));

console.log("\n§2 — Şema");
let semaOk = true;
let dilOk = true;
const dilIhlalleri = [];
for (const y of yayinlar) {
  if (!y.baslik || typeof y.baslik !== "string") semaOk = false;
  if (!Array.isArray(y.maddeler) || y.maddeler.length === 0) semaOk = false;
  for (const m of y.maddeler ?? []) {
    if (!KAPSAMLAR.has(m.kapsam)) semaOk = false;
    if (!TIPLER.has(m.tip)) semaOk = false;
    if (typeof m.metin !== "string" || m.metin.trim().length < 10) semaOk = false;
    const alt = String(m.metin ?? "").toLowerCase();
    for (const t of TEKNIK_TERIMLER) {
      if (new RegExp(`(^|[^a-zçğıöşü])${t}([^a-zçğıöşü]|$)`, "i").test(alt)) {
        dilOk = false;
        dilIhlalleri.push(`${y.id}: "${t}"`);
      }
    }
    if (/\.tsx?\b|\bsrc\//.test(String(m.metin ?? ""))) {
      dilOk = false;
      dilIhlalleri.push(`${y.id}: dosya yolu`);
    }
  }
}
check("kapsam ∈ {panel, tablet, her-ikisi} · tip geçerli · metin ≥10 karakter", semaOk);
// "sunucu" kapsamı BİLEREK yok: backend değişikliği operatöre ya panelde ya
// tablette görünür, operatör sunucuyu hiç görmez (kullanıcı kararı).
check('"sunucu" kapsamı REDDEDİLİYOR',
  !yayinlar.some((y) => (y.maddeler ?? []).some((m) => m.kapsam === "sunucu")));

console.log("\n§3 — Operatör dili");
check("teknik terim / dosya yolu yok", dilOk, dilIhlalleri.slice(0, 5).join(" · "));

console.log("\n§4 — Sürüm alanları");
let surumOk = true;
let tutarliOk = true;
for (const y of yayinlar) {
  const s = y.surumler ?? {};
  for (const v of [s.panel, s.tablet]) {
    if (v != null && !SURUM_RE.test(String(v))) surumOk = false;
  }
  // Çift yönlü tutarlılık: "notu yazdım sürümü yazmadım" (kayıt hiç
  // gösterilmez) ve "sürümü yazdım notu yazmadım" (boş modal) — ikisi de sessiz.
  const panelMadde = (y.maddeler ?? []).some((m) => m.kapsam === "panel" || m.kapsam === "her-ikisi");
  const tabletMadde = (y.maddeler ?? []).some((m) => m.kapsam === "tablet" || m.kapsam === "her-ikisi");
  if (panelMadde !== Boolean(s.panel)) tutarliOk = false;
  if (tabletMadde !== Boolean(s.tablet)) tutarliOk = false;
}
check("sürümler MAJOR.MINOR.PATCH", surumOk);
check("kapsam ↔ sürüm çift yönlü tutarlı", tutarliOk,
  tutarliOk ? "" : "panel/tablet maddesi varsa o sürüm DOLU olmalı ve tersi");

console.log("\n§5 — Kopya tazeliği");
const icerik = fs.readFileSync(KAYNAK, "utf8");
for (const k of KOPYALAR) {
  const ad = path.relative(kok, k);
  const var_ = fs.existsSync(k);
  // Kırmızı satır NE BULUNDUĞUNU söylemeli: etiket bir İDDİA ("… aynı") ve
  // detay boş kalırsa `❌ … kaynakla aynı` iddianın kendisini yalanlar.
  const bayat = var_ && fs.readFileSync(k, "utf8") !== icerik;
  check(`${ad} kaynakla aynı`, var_ && !bayat,
    !var_ ? "dosya YOK — node scripts/surum-notlari-kopyala.mjs"
      : bayat ? "kopya BAYAT (kaynaktan farklı) — node scripts/surum-notlari-kopyala.mjs" : "");
}

console.log("\n§7 — Modal tavanı tek kaynak");
// Üç sabit aynı olmalı: paketleme uyarısı istemcinin gerçek tavanını söylesin.
{
  const tavanOku = (rel) => {
    const m = /MODAL_TAVAN = (\d+)/.exec(fs.readFileSync(path.join(kok, rel), "utf8"));
    return m ? Number(m[1]) : null;
  };
  const degerler = {
    "scripts/lib/surum-notu-tavan.mjs": tavanOku("scripts/lib/surum-notu-tavan.mjs"),
    "Electron/src/lib/surum-notlari.ts": tavanOku("Electron/src/lib/surum-notlari.ts"),
    "mobil/src/services/surumNotlari.ts": tavanOku("mobil/src/services/surumNotlari.ts"),
  };
  const kume = new Set(Object.values(degerler));
  check("MODAL_TAVAN üç dosyada aynı ve okunabilir", kume.size === 1 && !kume.has(null),
    Object.entries(degerler).map(([k, v]) => `${k}=${v}`).join(" · "), true);
}

console.log("\n§8 — \"Sonraki sürümde\" vaadi");
// Bir madde "panel ekranı sonraki sürümde" diye söz verdiğinde ve o dilim AYNI
// yayına inerse, madde geri güncellenmez — çünkü kimse onu okumaz (ölçüldü
// 2026-09-14: 2026-09-13 turunda #58 "panel ekranı sonraki sürümde" derken #60
// aynı yayında panel Tezgah Duruşları ekranını duyuruyordu). Bu bölüm o çifti
// arar: vaat cümlesi yüzeyini ADIYLA söylemek zorundadır (söylemezse çelişki
// ölçülemez) ve aynı yayında o yüzeye ait, konu kökleri örtüşen bir madde
// bulunursa kırmızıdır. Örtüşme KÖK bazlıdır (Türkçe ekleri kırpar).
{
  const VAAT_RE = /sonraki sürüm/i;
  const YUZEYLER = ["panel", "tablet"];
  const KOK_UZUNLUK = 5;
  const MIN_ORTAK_KOK = 4;
  /** Her dokuma/devere maddesinde geçen kalıp sözler konu SAYILMAZ. */
  const KALIP_KOK = new Set([
    "dokum", "modül", "kurul", "değiş", "sürüm", "ekran", "görün", "hiçbi",
    "artık", "önced", "yalnı", "şimdi", "sonra", "gerek", "olara", "yüzey",
    "panel", "table", "açıks", "sayfa", "liste", "kayde", "kayıt", "yazıl",
  ]);
  /** Kapalı küme: muafiyet ancak bu sınıflardan biriyle yazılır. */
  const MUAF_SINIFLARI = new Set(["AYRI_YAYIN", "BASKA_KONU"]);
  /**
   * Beyanlı muafiyet — BOŞ DOĞAR. Her satır: hangi yayının hangi maddesi
   * (metnin ilk 40 karakteriyle çapalı), sınıfı ve gerekçesi.
   */
  const MUAF_VAATLER = [];

  const koklestir = (metin) => {
    const set = new Set();
    for (const ham of String(metin).toLowerCase().split(/[^a-zçğıöşü]+/)) {
      if (ham.length < KOK_UZUNLUK) continue;
      const kok = ham.slice(0, KOK_UZUNLUK);
      if (KALIP_KOK.has(kok)) continue;
      set.add(kok);
    }
    return set;
  };
  const vaatCumlesi = (metin) =>
    String(metin).split(/(?<=[.;])\s+/).find((c) => VAAT_RE.test(c)) ?? "";

  const vaatler = [];
  for (const y of yayinlar) {
    (y.maddeler ?? []).forEach((m, i) => {
      if (VAAT_RE.test(String(m.metin ?? ""))) vaatler.push({ y, m, i });
    });
  }
  // ÜÇ SONUÇ: kapsam 0 bir ölçüm DEĞİLDİR, beyan edilir.
  check("körlük zemini: vaat taraması koştu", true,
    `${yayinlar.length} yayın · ${toplamMadde} madde tarandı · ${vaatler.length} vaat maddesi`
      + (vaatler.length === 0 ? " (kapsam 0 — bugün vaat eden madde YOK, kapı ölçmedi)" : ""), true);

  const yuzeysiz = [];
  const celiskiler = [];
  for (const { y, m, i } of vaatler) {
    const cumle = vaatCumlesi(m.metin).toLowerCase();
    const yuzeyler = YUZEYLER.filter((s) => cumle.includes(s));
    if (yuzeyler.length === 0) {
      yuzeysiz.push(`${y.id}#${i}: "${vaatCumlesi(m.metin).trim().slice(0, 60)}"`);
      continue;
    }
    const konu = koklestir(m.metin);
    const muaf = MUAF_VAATLER.find(
      (x) => x.yayin === y.id && String(m.metin).startsWith(x.metinBasi),
    );
    for (const yuzey of yuzeyler) {
      // Aday SIRALANIR, ilk eşleşen değil EN ÇOK örtüşen bildirilir: eşik tek
      // başına "hangi madde" sorusunu cevaplamaz ve yanlış maddeyi gösteren bir
      // kırmızı, okuyucuyu kapıyı susturmaya iter (ölçüldü: eşik 2'de aynı
      // yayının 25 panel maddesi eşleşti, ilki konuyla ilgisizdi).
      const adaylar = (y.maddeler ?? [])
        .map((o, j) => {
          if (j === i) return null;
          if (o.kapsam !== yuzey && o.kapsam !== "her-ikisi") return null;
          let ortak = 0;
          for (const k of koklestir(o.metin)) if (konu.has(k)) ortak++;
          return ortak >= MIN_ORTAK_KOK ? { j, o, ortak } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.ortak - a.ortak);
      if (adaylar.length > 0 && !muaf) {
        const en = adaylar[0];
        celiskiler.push(
          `${y.id}#${i} "${yuzey} … sonraki sürümde" diyor ama aynı yayında `
            + `#${en.j} (${yuzey}) aynı konuyu duyuruyor [${en.ortak} ortak kök]: `
            + `"${String(en.o.metin).slice(0, 70)}…"`
            + (adaylar.length > 1 ? ` (+${adaylar.length - 1} aday daha)` : ""),
        );
      }
    }
  }
  check("vaat cümlesi yüzeyini ADIYLA söylüyor (panel/tablet)", yuzeysiz.length === 0,
    `${yuzeysiz.length} yüzeysiz vaat — çelişki ölçülemez, cümleye yüzeyi yaz: ${yuzeysiz.slice(0, 3).join(" · ")}`);
  check("⭐ vaat AYNI YAYINDA çürütülmemiş", celiskiler.length === 0,
    celiskiler.slice(0, 3).join(" · ")
      + " — dilim aynı yayına indiyse maddeyi güncelle, gerçekten sonraki yayındaysa MUAF_VAATLER'e sınıfıyla yaz");
  // İKİ YÖNLÜ: beyan edilmiş ama artık eşleşmeyen muafiyet, gerçek bir çelişkiyi
  // sessizce kapsam dışında tutar.
  const oluMuaf = MUAF_VAATLER.filter(
    (x) => !vaatler.some(({ y, m }) => y.id === x.yayin && String(m.metin).startsWith(x.metinBasi)),
  );
  check("ölü muafiyet yok (beyan ↔ madde iki yönlü)", oluMuaf.length === 0,
    oluMuaf.map((x) => `${x.yayin} "${x.metinBasi.slice(0, 40)}…"`).join(" · "));
  check("muafiyet sınıfları kapalı kümede", MUAF_VAATLER.every((x) => MUAF_SINIFLARI.has(x.sinif)),
    MUAF_VAATLER.filter((x) => !MUAF_SINIFLARI.has(x.sinif)).map((x) => String(x.sinif)).join(" · "));
}

console.log("\n§9 — Tırnaklı ETİKET ADI koddan mı");
// Notta tırnaklanan bir ekran/ayar/sekme adı ARAMA ANAHTARIDIR: operatör onu
// ekranda arar. Hatırlanarak yazıldığında sessizce kayar — ölçüldü 2026-09-15:
// 65 etiket adayının 6'sı koddaki yazımından farklıydı ("levent yuvası sayısı"
// ↔ "Levent yuva sayısı" AYNI YAYINDA iki maddede iki türlü; "Levent dip iadesi"
// ↔ "Levent Dibi İadesi"). Küçük/büyük harf farkı da kayıştır: operatör için
// "Dokuma tezgahı" ile "Dokuma Tezgahı" aynı şey DEĞİLDİR.
{
  const KAYNAK_DIZINLER = ["Electron/src", "mobil/src", "Teks-Erp/src"];
  const KAYNAK_UZANTI = new Set([".ts", ".tsx"]);
  const EN_AZ_DOSYA = 500; // altına düşerse tarama BOZUK demektir, "hepsi bulunamadı" değil
  /** Kapalı küme: muafiyet ancak bu iki sınıftan biriyle yazılır. */
  const MUAF_SINIFLARI = new Set(["ALAN_ADI", "RAPOR_BOLUMU", "ORNEK_METIN", "DINAMIK", "ALINTI"]);
  /**
   * Beyanlı muafiyet — tırnak içinde olup da EKRAN ADI OLMAYAN dizeler.
   * Yeni satır, sınıfı ve gerekçesiyle gelir; ölü satır da kırmızıdır.
   */
  const MUAF_ETIKETLER = [
    // --- ALAN_ADI: literal ekran etiketi değil, konuşulan alan adı
    { etiket: "Depo Hareketleri", sinif: "ALAN_ADI", gerekce: "Paneldeki gerçek yol 2026-09-13#15'te veriliyor: Depolar → bir depo → Hareketler." },
    // --- RAPOR_BOLUMU: `scripts/consistency-check.sql` bölüm başlıkları (bu kapının evreni .ts/.tsx)
    { etiket: "29) Deposuz top", sinif: "RAPOR_BOLUMU", gerekce: "Tutarlılık kontrolü bölüm başlığı (consistency-check.sql)." },
    { etiket: "30) Defter ufku", sinif: "RAPOR_BOLUMU", gerekce: "Tutarlılık kontrolü bölüm başlığı (consistency-check.sql)." },
    { etiket: "30b) Defter ufku öncesi", sinif: "RAPOR_BOLUMU", gerekce: "Tutarlılık kontrolü bölüm başlığı (consistency-check.sql)." },
    { etiket: "31) Yarım geri alınmış kesim", sinif: "RAPOR_BOLUMU", gerekce: "Tutarlılık kontrolü bölüm başlığı (consistency-check.sql)." },
    // --- ORNEK_METIN: kullanıcının/kurulumcunun yazdığı örnek değer
    { etiket: "Birim: g", sinif: "ORNEK_METIN", gerekce: "Kurulumcunun kutuya yazdığı örnek değer (cihaz ölçeği anlatımı)." },
    { etiket: "üretilen/giriş", sinif: "ORNEK_METIN", gerekce: "İş emri metrajının konuşulan adı, ekranda bu dizeyle yazmıyor." },
    // --- DINAMIK: kodda şablonla kurulur, sabit dize olarak aranamaz
    { etiket: "+N m müşteriye", sinif: "DINAMIK", gerekce: "Hücre metni şablonla kurulur (`+{sayı} m müşteriye`), sabit dize yok." },
    // --- ALINTI: operatöre söylenen cümle / anlatı, ekran etiketi DEĞİL
    { etiket: "bu mal hiç çıkmadı", sinif: "ALINTI", gerekce: "Sevk stornosunun anlamını anlatan cümle." },
    { etiket: "mal çıktı, müşteri geri gönderdi", sinif: "ALINTI", gerekce: "İadenin anlamını anlatan cümle." },
    { etiket: "sevk edilmiş durumda depoya girdi", sinif: "ALINTI", gerekce: "Olmayan bir olayın tarifi (sayım stornosu anlatımı)." },
    { etiket: "ne zaman, kim, hangi gerekçeyle", sinif: "ALINTI", gerekce: "Saklanan bilginin tarifi, ekranda bu sırayla yazmıyor." },
    { etiket: "kim, ne zaman, neden", sinif: "ALINTI", gerekce: "Değişiklik defterinin tarifi; kodda farklı sırayla geçiyor." },
    { etiket: "işlenen metre başına kayıp", sinif: "ALINTI", gerekce: "Fire oranının tanımı." },
    { etiket: "bunun yerine pasife alın", sinif: "ALINTI", gerekce: "Onay penceresinin verdiği öğüdün özeti." },
    { etiket: "bunlar kalacak", sinif: "ALINTI", gerekce: "Geri sarma penceresindeki listenin konuşulan adı." },
    { etiket: "bu rakam neden böyle", sinif: "ALINTI", gerekce: "Sonradan bakan kişinin sorusu." },
  ];

  let dosyaSayisi = 0;
  let govde = "";
  const tara = (d) => {
    let girisler;
    try { girisler = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of girisler) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { tara(p); continue; }
      if (!KAYNAK_UZANTI.has(path.extname(e.name))) continue;
      if (p.includes("surum-notlari")) continue; // notun kendi kopyası kaynak DEĞİL
      govde += fs.readFileSync(p, "utf8") + "\n";
      dosyaSayisi++;
    }
  };
  for (const d of KAYNAK_DIZINLER) tara(path.join(kok, d));

  // ÜÇ SONUÇ: kaynak okunamadıysa "hiçbir etiket bulunamadı" DEĞİL, ÖLÇÜLEMEDİ.
  const kaynakOk = dosyaSayisi >= EN_AZ_DOSYA;
  check("körlük zemini: istemci + sunucu kaynağı okundu", kaynakOk,
    `${dosyaSayisi} dosya · ${(govde.length / 1e6).toFixed(1)} MB`
      + (kaynakOk ? "" : ` — ÖLÇÜLEMEDİ: kaynak dizinleri okunamadı, etiket araması YAPILMADI (${KAYNAK_DIZINLER.join(" · ")})`), true);

  if (kaynakOk) {
    // ETİKET ADAYI: tırnaklı ve ≤5 kelime. **Case ŞARTI YOK** — ölçüldü 2026-09-15:
    // ilk tasarımda "büyük harfle başlayan" şartı vardı, negatif sonda YEŞİL kaldı
    // çünkü kayışın en sık biçimi harfi KÜÇÜLTMEKTİR (#63 "levent yuvası sayısı").
    // Şartı taşıyan kapı, kendisini doğuran kusuru göremiyordu.
    //
    // Yüklem TEK ve serttir: aday kodda BİREBİR geçecek ya da BEYANLI muaf olacak.
    // Alıntı cümleler de aday olur ve muafiyete yazılır — "ekran adı mı alıntı mı"
    // kararını kapı VERMEZ, yazarın BEYANINA bırakır ve beyanı sınıfa bağlar.
    const adaylar = new Map();
    for (const y of yayinlar) {
      (y.maddeler ?? []).forEach((m, i) => {
        for (const e of String(m.metin ?? "").matchAll(/“([^”]{3,60})”/g)) {
          const s2 = e[1];
          if (s2.split(/\s+/).length > 5) continue;
          adaylar.set(s2, (adaylar.get(s2) ?? []).concat(`${y.id}#${i}`));
        }
      });
    }
    const govdeKucuk = govde.toLocaleLowerCase("tr");
    const muafAdlar = new Set(MUAF_ETIKETLER.map((x) => x.etiket));
    const cozulmeyen = [];
    for (const [s2, yerler] of adaylar) {
      if (muafAdlar.has(s2) || govde.includes(s2)) continue;
      // Kodda yalnız YAZIMI farklı duruyorsa kusur ADIYLA söylenir: düzeltme
      // "muafiyete yaz" değil "harfi düzelt"tir.
      const kayisMi = govdeKucuk.includes(s2.toLocaleLowerCase("tr"));
      cozulmeyen.push(`${JSON.stringify(s2)}${kayisMi ? " [YAZIM KAYIŞI — kodda farklı harfle var]" : ""} (${yerler.join(", ")})`);
    }
    check("körlük zemini: etiket adayı çıkarıldı", adaylar.size > 0,
      `${adaylar.size} aday · ${MUAF_ETIKETLER.length} beyanlı muaf`, true);
    check("⭐ tırnaklı ad kodda BİREBİR var ya da BEYANLI muaf", cozulmeyen.length === 0,
      `${cozulmeyen.length} çözülmeyen: ${cozulmeyen.slice(0, 4).join(" · ")}`
        + " — ekran adıysa koddan KOPYALA (harf harf), değilse MUAF_ETIKETLER'e sınıfıyla + gerekçesiyle yaz");
    const oluMuaf = MUAF_ETIKETLER.filter((x) => !adaylar.has(x.etiket));
    check("ölü ETİKET muafiyeti yok (beyan ↔ madde iki yönlü)", oluMuaf.length === 0,
      oluMuaf.map((x) => JSON.stringify(x.etiket)).join(" · "));
    check("etiket muafiyet sınıfları kapalı kümede", MUAF_ETIKETLER.every((x) => MUAF_SINIFLARI.has(x.sinif)),
      MUAF_ETIKETLER.filter((x) => !MUAF_SINIFLARI.has(x.sinif)).map((x) => String(x.sinif)).join(" · "));
  }
}

// --- Yayın kapısı (argümanla ya da künyeden) -----------------------------
// ÜÇ SONUÇ, İKİ DEĞİL: kapı yeşil · kapı kırmızı · **ÖLÇÜLEMEDİ** (künye okunamadı
// ya da sürüm alanı biçimsiz). Üçüncüsü sessizce ATLANMAZ — atlansaydı bozuk bir
// `package.json`, kapıyı hiç koşmamış hâle getirir ve yeşil görünürdü.
const KUNYELER = [
  { ad: "panel", rel: "Electron/package.json", oku: (j) => j?.version },
  { ad: "tablet", rel: path.join("mobil", "app.json"), oku: (j) => j?.expo?.version },
];
let panelSurum = arg("panel");
let tabletSurum = arg("tablet");
const kunyeHatalari = [];
const kunyeKaynaklari = [];
if (KUNYEDEN) {
  for (const k of KUNYELER) {
    const tam = path.join(kok, k.rel);
    let surum = null;
    try {
      surum = k.oku(JSON.parse(fs.readFileSync(tam, "utf8")));
    } catch (e) {
      kunyeHatalari.push(`${k.rel}: okunamadı (${e.message})`);
      continue;
    }
    if (typeof surum !== "string" || !SURUM_RE.test(surum)) {
      kunyeHatalari.push(`${k.rel}: sürüm alanı biçimsiz (${JSON.stringify(surum)})`);
      continue;
    }
    kunyeKaynaklari.push(`${k.ad}=${surum} (${k.rel})`);
    if (k.ad === "panel") panelSurum = surum;
    else tabletSurum = surum;
  }
}
if (panelSurum || tabletSurum || KUNYEDEN) {
  console.log("\n§6 — Yayın kapısı");
  if (KUNYEDEN) {
    check("künyeler okundu (sürüm ARGÜMANDAN değil künyeden, ikisi de notu üretmez)",
      kunyeHatalari.length === 0,
      kunyeHatalari.join(" · ") || kunyeKaynaklari.join(" · "), true);
  }
  if (panelSurum) {
    check(`panel ${panelSurum} için not kaydı var`,
      yayinlar.some((y) => y.surumler?.panel === panelSurum),
      "surum-notlari.json'a bu sürüm için kayıt ekle");
  }
  if (tabletSurum) {
    check(`tablet ${tabletSurum} için not kaydı var`,
      yayinlar.some((y) => y.surumler?.tablet === tabletSurum),
      "surum-notlari.json'a bu sürüm için kayıt ekle");
  }
}

console.log(`\n${kaldi === 0 ? "✅ TÜMÜ GEÇTİ" : "❌ BAŞARISIZ"} — ${gecti} geçti, ${kaldi} kaldı\n`);
process.exit(kaldi === 0 ? 0 : 1);
