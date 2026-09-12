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

// --- Yayın kapısı (argümanla) -------------------------------------------
const panelSurum = arg("panel");
const tabletSurum = arg("tablet");
if (panelSurum || tabletSurum) {
  console.log("\n§6 — Yayın kapısı");
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
