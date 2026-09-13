#!/usr/bin/env node
// =============================================================================
// Doküman bayatlık bekçisi (zero-dep, Node ESM) — CI'da koşar.
// =============================================================================
// AMAÇ: Dokümantasyonun koda karşı sessizce bayatlamasını önlemek. Bu proje hızlı
// redesign'lar geçirdi (çuval/parti/kart/rota-final); docs kolayca kaldırılmış
// dosya/sembollere atıf yapar hâle gelir ve yapay zekayı / yeni geliştiriciyi
// yanlış yönlendirir. İki mekanik kontrol (prose doğruluğu makineyle denetlenemez):
//
//   [GATE] ÖLÜ DOKÜMAN-LİNK: bir doküman repo-içi dosyaya (docs/... , Teks-Erp/src/...)
//     atıf yapıyor ama dosya YOKSA → CI FAIL. Hassas, ~sıfır false-positive.
//     (Bu oturumda bir doküman taşındığında referanslar kırıldı — tam bu senaryo.)
//
//   [ADVISORY] KALDIRILMIŞ-SEMBOL: docs kaldırılmış bir sembolü (batchSplitId,
//     MachineLog, packedQty...) anıyorsa listeler. CI'ı FAIL ETMEZ — tasarım
//     dokümanları doğası gereği "X'ten Y'ye geçtik" anlatır (tarihsel bağlam
//     meşrudur), bu yüzden gürültülüdür; periyodik insan-incelemesi için rapor.
//
// Çalıştır: node scripts/check-docs.mjs           (npm run check:docs)
// Çıkış kodu: ölü-link varsa 1, yoksa 0 (advisory çıkışı etkilemez).
// =============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Redesign'larda KALDIRILAN semboller (advisory). `word:true` → kelime-sınırı ile
// eşleş (uzun tanımlayıcıların içinde yanlış eşleşmesin, ör. writeShipmentAllocationsTx).
const REMOVED_SYMBOLS = [
  { sym: "batchSplitId", word: false },
  { sym: "MachineLog", word: true },
  { sym: "packedQty", word: false },
  { sym: "rebalanceCustomerPool", word: false },
  { sym: "sealSack", word: false },
  { sym: "sealedAt", word: false },
  { sym: "sealedById", word: false },
  { sym: "markReady", word: false },
  { sym: "readyById", word: false },
  { sym: "ShipmentAllocation", word: true },
  { sym: "manualCode", word: false },
  { sym: "recover-to-production", word: false },
  { sym: "Durum Düzelt", word: false },
  { sym: "PRODUCED", word: true },
  { sym: "AT_DOOR", word: true },
];

// "Bu kaldırıldı/tarihsel" bağlam işaretçileri — satırda VEYA ±2 komşu satırda
// varsa advisory listesine ALINMAZ (meşru "we removed X" / "eski model" açıklaması).
const REMOVAL_MARKER = /(kalk|kaldır|removed|supersed|süpersed|\beski\b|önceki|YOK|artık|DROP|drop|DEĞİL|değil|terk edil|silin|çıkar|söker|değişti|legacy|deprecated|~~|→)/i;

// tsx, ts'ten ÖNCE denenmeli (tsx? ile) yoksa 'foo.tsx' → 'foo.ts' yanlış eşleşir.
const PATH_RE = /(docs|Teks-Erp|Electron|mobil)\/[A-Za-z0-9._/-]+\.(md|tsx?|sql|mjs)/g;

const SKIP_DIRS = new Set(["node_modules", ".git", ".expo", "dist", "build", ".next"]);
const SKIP_PATHS = ["docs/history/", "docs/akademik/"];
const SKIP_FILES = new Set(["GEREKSIZ-ADAYLAR.md"]); // geçici karar-aidi (bilerek bayat-sembol tartışır)

function walkMd(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const rel = relative(REPO_ROOT, full).replace(/\\/g, "/");
    if (SKIP_PATHS.some((p) => rel.startsWith(p))) continue;
    const st = statSync(full);
    if (st.isDirectory()) walkMd(full, out);
    else if (name.endsWith(".md") && !SKIP_FILES.has(name)) out.push(full);
  }
  return out;
}

function symMatches(line, sym, word) {
  if (!word) return line.includes(sym);
  const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${esc}([^A-Za-z0-9_]|$)`).test(line);
}

// [İLERİ REFERANS] Bir spec "## 4) YENİ DOSYA `x/y.tsx`" diyorsa o dosyanın HENÜZ
// OLMAMASI normaldir — gate'in amacı TAŞINMIŞ/SİLİNMİŞ dosyaya atıf yakalamak, henüz
// yazılmamış dosyayı planlamak değil. Bu, gerçek bir yanlış-pozitif SINIFI.
//
// Kapsam BİLEREK dar tutuldu (her genişletme gate'i deler):
//   • YALNIZ AYNI SATIR — ±1 satır penceresi muafiyet yüzeyini üçe katlar ve tipik
//     spec düzeninde "YENİ DOSYA" başlığının hemen altındaki açıklama satırı MEVCUT
//     dosyalara atıf yapar (ölçüldü: bedava genişleyen kör nokta).
//   • YALNIZ BÜYÜK HARF "YENİ/YENI DOSYA" — küçük harfe ya da "eklenecek/oluşturulacak"
//     gibi ifadelere açılırsa VAR OLAN 6 dosya atfı da kalıcı muafiyete girer (ölçüldü:
//     Teks-Erp/CLAUDE.md:125, docs/design/CUVAL-HAVUZU-TASARIM.md:117,
//     docs/fason-envanter-gorunurluk-spec.md:161/170/591).
//   • YALNIZ MARKDOWN BAŞLIĞINDA — kırık bir linki "YENİ DOSYA" yazarak susturma
//     yüzeyini daraltır.
//   • Sentinel yolun ÖNÜNDE olmalı (aynı satırda sonradan gelen atıf muaf değil).
//
// ⚠️ BİLİNEN KÖR NOKTA: ileri referans GERÇEKLEŞİP dosya sonradan taşınırsa gate
// sessiz kalır. Bu yüzden muafiyet SESSİZCE ATLANMAZ — INFO olarak listelenir ve
// hedef ARTIK VARSA "başlık fosilleşti" uyarısı basılır (kör nokta kendini tasfiye eder).
const PLANNED_SENTINEL = /^#{1,6}\s.*\bYEN[İI] DOSYA\b/;
const plannedLinks = [];

const deadLinks = [];
const advisories = [];
const mdFiles = walkMd(REPO_ROOT);

for (const file of mdFiles) {
  const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  // ±2 satır penceresinde removal-marker var mı?
  const nearMarker = (i) =>
    [lines[i - 2], lines[i - 1], lines[i], lines[i + 1], lines[i + 2]]
      .some((l) => l && REMOVAL_MARKER.test(l));

  lines.forEach((rawLine, i) => {
    // Sentinel araması ve PATH_RE eşleşmesi AYNI string üzerinde olmalı: biri
    // normalize edilip diğeri edilmezse NFD girdide index'ler kayar ve aşağıdaki
    // "sentinel yoldan ÖNCE mi" kontrolü sessizce yanlış sonuç verir.
    const line = rawLine.normalize("NFC");
    const plannedAt = line.search(PLANNED_SENTINEL) === 0 ? line.search(/YEN[İI] DOSYA/) : -1;

    // [GATE] Ölü doküman-link
    for (const m of line.matchAll(PATH_RE)) {
      const p = m[0];
      if (p.includes("*") || p.includes("...") || p.includes("<")) continue;
      if (existsSync(join(REPO_ROOT, p))) continue;
      // İleri referans: "YENİ DOSYA" başlığı, atfın ÖNÜNDE.
      if (plannedAt >= 0 && plannedAt < (m.index ?? 0)) {
        plannedLinks.push({ file: rel, line: i + 1, path: p });
        continue;
      }
      deadLinks.push({ file: rel, line: i + 1, path: p, text: line.trim().slice(0, 130) });
    }
    // İleri referans GERÇEKLEŞMİŞ mi (dosya artık var) — başlık fosilleşmiş demektir;
    // muafiyet o satırda artık kör nokta yaratıyor, bakım sinyali olarak bildir.
    if (plannedAt >= 0) {
      for (const m of line.matchAll(PATH_RE)) {
        const p = m[0];
        if (p.includes("*") || p.includes("...") || p.includes("<")) continue;
        if (plannedAt < (m.index ?? 0) && existsSync(join(REPO_ROOT, p))) {
          plannedLinks.push({ file: rel, line: i + 1, path: p, materialized: true });
        }
      }
    }
    // [ADVISORY] Kaldırılmış-sembol (removal-context'siz)
    if (!nearMarker(i)) {
      for (const { sym, word } of REMOVED_SYMBOLS) {
        if (symMatches(line, sym, word)) {
          advisories.push({ file: rel, line: i + 1, sym, text: line.trim().slice(0, 110) });
        }
      }
    }
  });
}

// --- INFO: ileri referans muafiyetleri (CI'ı etkilemez, ama SESSİZ DEĞİL) ---
if (plannedLinks.length) {
  const fossils = plannedLinks.filter((p) => p.materialized);
  const pending = plannedLinks.filter((p) => !p.materialized);
  if (pending.length) {
    console.log(`ℹ️  İLERİ REFERANS — ${pending.length} "YENİ DOSYA" atfı muaf tutuldu (henüz yazılmamış, beklenen):`);
    for (const p of pending) console.log(`    ${p.file}:${p.line}  ${p.path}`);
    console.log("");
  }
  if (fossils.length) {
    console.log(`ℹ️  FOSİLLEŞMİŞ BAŞLIK — ${fossils.length} "YENİ DOSYA" atfının hedefi ARTIK VAR:`);
    for (const p of fossils) console.log(`    ${p.file}:${p.line}  ${p.path}`);
    console.log("    → Başlıktaki 'YENİ DOSYA' ibaresini kaldırın; o satır artık gate'in KÖR NOKTASI");
    console.log("      (dosya sonradan taşınırsa/silinirse ölü link yakalanmaz).\n");
  }
}

// --- ADVISORY (CI'ı etkilemez) ---
if (advisories.length) {
  console.log(`⚠️  ADVISORY — ${advisories.length} kaldırılmış-sembol atfı (removal-marker'sız; tarihsel bağlam meşru olabilir, insan incelemesi):`);
  for (const a of advisories) console.log(`    ${a.file}:${a.line}  '${a.sym}'  → ${a.text}`);
  console.log("");
}


// --- GATE: belge boyut tavanı (2026-09-05 — kök 42k token'dan ~6k'ya indi; geri şişmesin) ---
// Ölçü BAYT (token ≈ bayt/3). Tavanlar bilinçli gevşek: kök 36 KB (~12k tok), alt dosyalar 24 KB.
const CLAUDE_MD_SIZE_CAPS = { "CLAUDE.md": 36 * 1024, "Teks-Erp/CLAUDE.md": 24 * 1024, "Electron/CLAUDE.md": 24 * 1024, "mobil/CLAUDE.md": 24 * 1024 };

// `docs/standart/*.md` aynı tavana bağlanır: standart dosyaları da "her yeni
// bulguyu buraya da yazayım" baskısı altındadır ve şişince okunmaz olurlar.
// Dosya listesi SABİT DEĞİL taranır — yeni bir standart dosyası tavansız doğmasın.
// Advisory eşiği ÖLÇÜLDÜ, seçilmedi: uyarının işe yaraması için TEK BİR düzenlemeden
// büyük olması gerekir, yoksa kıran ekleme uyarı hiç görünmeden gelir. 2026-09-13'te
// ölçülen tek-commit büyümeleri: +310 · ~1.600 · ~2.500 · +2.726 bayt (en büyüğü
// TEST-VE-DERLEME.md). 3 KB bu en büyük tek adımdan geniştir ve bugün 20 tavanlı
// dosyanın yalnız 3'ünü işaretler — uyarı gürültüye dönüşmez.
// ÖNCELİKLENDİRME ÖLÇÜTÜ (ölçüldü 2026-09-13): bu listedeki bir dosyayı BÖLMEK
// otomatik değildir. Duvara dayanan dört dosyanın dördü de AKTİF YAZILANDI;
// BACKEND.md ve MOBIL.md 8 gündür dokunulmamıştı. Bir tavana olan UZAKLIK bir risk
// değildir; ona doğru giden HIZ risktir — durgun bir dosya dar olabilir ve hiç kırılmaz.
// ⛔ `Teks-Erp/docs/BEKCI-HARITASI.md` BİLEREK kapsam DIŞINDA (1e kararı 2026-09-14):
// 475 KB / 2.073 satır, %97'si tablo — bir ENVANTER, bir kural belgesi değil. Tavana
// almak CI'ı 19 katıyla kırar; bölmek ise hem çizgisiz (ayrılacak kural yarısı yok) hem
// pahalı (bir kod okuyucusu + 40 belge atfı). Gerçek maliyeti boyut değil BAĞLAM ve
// ÇAKIŞMA; ikisi de dosyanın kendi başlığındaki kapsam beyanıyla yönetilir.
const NEAR_CAP_BYTES = 3 * 1024;

const STANDART_DIR = "docs/standart";
if (existsSync(join(REPO_ROOT, STANDART_DIR))) {
  for (const name of readdirSync(join(REPO_ROOT, STANDART_DIR))) {
    if (name.endsWith(".md")) CLAUDE_MD_SIZE_CAPS[`${STANDART_DIR}/${name}`] = 24 * 1024;
  }
}

// --- GATE: kural KİMLİĞİ tekil (2026-09-13) ---
// SORUSU: "bu COMMIT yeni bir çakışma GETİRİYOR mu" — "ağaç temiz mi" DEĞİL.
// İki taraf da okunur (ağaç ↔ `git show HEAD:`) ve yalnız ARTIŞ kırmızıdır. Sebep
// ölçüldü: kapı yalnız ağacı okusaydı, bir eş oturumun commit EDİLMEMİŞ düzeltmesi
// sahte yeşil üretirdi; yalnız HEAD'i okusaydı bu commit'in GETİRDİĞİ çakışmayı bir
// commit geç yakalardı. HEAD'de DURAN çakışma advisory kalır — yoksa kapı, ihlali
// yapanı değil ondan sonra commit atan herkesi cezalandırır.
// Kimlik çakışmasının bedeli özel: ona yapılan HER ATFI belirsizleştirir ("BE-41
// gereği" diyen commit mesajı yarın hangi kuralı kastettiğini söyleyemez).
// ⚠️ `README.md` KAPSAM DIŞI ve bu bir muafiyet değil TANIM GEREĞİ: orası kural
//    BİÇİMİNİ tarif eder (`- **[BE-07]** <emir kipi…>`); orada duran şey bir kural
//    değil, kuralın resmidir. (5e teşhis · d5 formülasyon, 2026-09-13)
const ID_RE = /^- \*\*\[([A-ZÇĞİÖŞÜ]{2,3}-[0-9]+[a-z]?)\]\*\*/;
function idCakismalari(oku) {
  const gorulen = new Map(), dupes = new Map();
  if (!existsSync(join(REPO_ROOT, STANDART_DIR))) return dupes;
  for (const name of readdirSync(join(REPO_ROOT, STANDART_DIR))) {
    if (!name.endsWith(".md") || name === "README.md") continue;
    const rel = `${STANDART_DIR}/${name}`;
    (oku(rel) ?? "").split("\n").forEach((ln, i) => {
      const m = ID_RE.exec(ln);
      if (!m) return;
      if (gorulen.has(m[1])) dupes.set(m[1], `ilk: ${gorulen.get(m[1])} · tekrar: ${rel}:${i + 1}`);
      else gorulen.set(m[1], `${rel}:${i + 1}`);
    });
  }
  return dupes;
}
const agacDupes = idCakismalari((rel) => readFileSync(join(REPO_ROOT, rel), "utf8"));
const headDupes = idCakismalari((rel) => {
  try { return execFileSync("git", ["show", `HEAD:${rel}`], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return ""; }
});
const yeniDupes = [...agacDupes].filter(([id]) => !headDupes.has(id));
const duranDupes = [...agacDupes].filter(([id]) => headDupes.has(id));
if (duranDupes.length) {
  console.log(`⚠️  ADVISORY — ${duranDupes.length} kural kimliği çakışması HEAD'de DURUYOR (bu commit getirmedi, CI'ı etkilemez):`);
  for (const [id, yer] of duranDupes) console.log(`    [${id}]  ${yer}`);
  console.log("    → Sahibi YENİ olanı boştaki bir kimliğe taşımalı; ESKİ kimlik yerinde kalır.\n");
}
if (yeniDupes.length) {
  console.error(`❌ Bu commit ${yeniDupes.length} YENİ kural kimliği çakışması getiriyor: bir kimlik tek kurala aittir ve çakışma ona yapılan HER atfı belirsizleştirir.`);
  for (const [id, yer] of yeniDupes) console.error(`    [${id}]  ${yer}`);
  console.error("    → YENİ olanı kaydır (boştaki bir kimliğe), eskiyi YERİNDE BIRAK.");
  console.error("      Sebep: bir kimliğin değiştirilme maliyeti GÖREBİLDİĞİN atıflarla değil");
  console.error("      GÖREMEDİĞİN atıflarla ölçülür — arşiv, commit mesajları, eş oturumların");
  console.error("      defterleri grep'lenebilir ama DÜZELTİLEMEZ.");
  process.exit(1);
}

const sizeFails = [];
const sizeNear = [];
for (const [rel, cap] of Object.entries(CLAUDE_MD_SIZE_CAPS)) {
  const p = join(REPO_ROOT, rel);
  if (!existsSync(p)) continue;
  const size = statSync(p).size;
  if (size > cap) sizeFails.push({ rel, size, cap });
  else if (cap - size < NEAR_CAP_BYTES) sizeNear.push({ rel, kalan: cap - size });
}

// --- ADVISORY: tavana yaklaşan dosyalar (CI'ı ETKİLEMEZ) ---
// Kapı bugüne kadar yalnız İHLAL ANINDA konuşuyordu; kalan boşluğu kimse göremiyordu.
// 2026-09-13'te DÖRT dosya aynı gün duvara dayandı (23 · 1 · 168 · 745 bayt kala) ve
// hiçbiri bilerek yapılmadı — birini büyüten oturumun kalan boşluğu görmesinin yolu yoktu.
if (sizeNear.length) {
  console.log(`⚠️  ADVISORY — ${sizeNear.length} dosya boyut tavanına yaklaştı (CI'ı etkilemez):`);
  for (const n of sizeNear.sort((x, y) => x.kalan - y.kalan)) {
    console.log(`    ${n.rel}: ${n.kalan} bayt kaldı`);
  }
  console.log("    → Bir sonraki ekleme kapıyı kırabilir ve BAŞKASININ commit'ini durdurur.");
  console.log("    → Çare tavanı yükseltmek DEĞİL, dosyayı bölmektir: kural kalır, ENVANTER ayrılır");
  console.log("      (emsal: VERITABANI/ESZAMANLILIK/TEST-VE-DERLEME/KUTUPHANELER bölmeleri, arşiv 2026-09-13).\n");
}
if (sizeFails.length) {
  console.error(`❌ Belge boyut tavanı aşıldı (${sizeFails.length}): yeni karar notu ARŞİVE, kural docs/kurallar/<alan>.md'ye yazılır; standart dosyası büyüyorsa kanıt ölçüm dosyasına iner.`);
  for (const f of sizeFails) console.error(`    ${f.rel}: ${(f.size / 1024).toFixed(1)} KB > ${(f.cap / 1024).toFixed(0)} KB`);
  process.exit(1);
}

// --- GATE: TARİHSİZ BEKÇİ SAYISI (2026-09-13) ---
// "Sayı taşıyan her belge satırı bir bakım borcudur" kuralı BEYAN EDİLMİŞTİ ama
// ÖLÇÜLMÜYORDU: `docs/SOZLUK.md` ve `docs/GELISTIRME-DONGUSU.md` "455 dosya" derken
// gerçek 502'ydi (ölçüldü 2026-09-13). Sayıyı yasaklamıyoruz — TARİHSİZİNİ
// yasaklıyoruz: tarihli bir sayı ÖLÇÜMDÜR ve paydası okunur, tarihsiz bir sayı
// bugüne dair bir İDDİADIR ve sessizce bayatlar.
//
// ⚠️ KAPSAM DAR VE BİLİNÇLİ: yalnız "<N> ... (test_*.ts|bekçi|test) dosya" kalıbı.
// Genel bir "sayı arama" yanlış pozitif patlatırdı (sürüm numarası, port, eşik).
// `docs/history/` ve `docs/akademik/` zaten SKIP_PATHS'te — arşiv donuk olmalıdır.
//
// NEGATİF SONDA (ölçüldü 2026-09-13): canlı bir belgeye tarihsiz "455 test_*.ts
// dosyası" satırı konunca KIRMIZI; aynı satıra "ölçüldü 2026-09-05" eklenince yeşil.
const SAYI_RE = /\b(\d{3,4})\s*(?:adet\s+)?`?(?:test_\*\.ts|bekçi|test)`?\s*dosya/i;
const TARIH_RE = /\b20\d{2}-\d{2}-\d{2}\b/;
const tarihsizSayilar = [];
for (const file of mdFiles) {
  const rel = file.replace(`${REPO_ROOT}/`, "");
  if (SKIP_PATHS.some((p) => rel.startsWith(p)) || SKIP_FILES.has(rel.split("/").pop())) continue;
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (SAYI_RE.test(line) && !TARIH_RE.test(line)) {
      tarihsizSayilar.push({ rel, line: i + 1, text: line.trim().slice(0, 120) });
    }
  });
}
if (tarihsizSayilar.length) {
  console.error(
    `❌ Doküman bekçisi ${tarihsizSayilar.length} TARİHSİZ bekçi sayısı buldu — sayı bugüne dair bir\n` +
      `   iddiadır ve sessizce bayatlar. Ya sayıyı KALDIR (koşucu her koşumda kendisi basar:\n` +
      `   '=== Backend test suite — N dosya ==='), ya da ÖLÇÜM olarak tarihlendir:\n`,
  );
  for (const t of tarihsizSayilar) console.error(`  ${t.rel}:${t.line}\n      ${t.text}\n`);
  process.exit(1);
}

// --- GATE: KODDAN BELGEYE ÇAPA (2026-09-13) ---
// VAKA (5e): `KUTUPHANELER.md §2` bölündü, bir bekçi o tabloyu DOSYADAN okuyordu
// ve kırıldı — `check-docs` GÖRMEDİ. Belge kapısı yalnız `.md → dosya` linklerine
// bakıyordu; oysa BİR KODUN OKUDUĞU BELGE YOLU DA BİR ÇAPADIR ve belge taşınınca
// sessizce kopar. Eksik olan yön KODDAN BELGEYE.
//
// ⚠️ KAPSAM DAR VE ÖLÇÜLMÜŞ: yalnız bir DOSYA SİSTEMİ çağrısında kullanılan yollar.
// Ağaçta ölçüldü — yorumlarda geçen ~20 belge atfı (prose) KAPSAM DIŞI: onlar
// koparsa belge bayatlar, kod ÇALIŞMAYA DEVAM EDER. Gerçekten okuyan: 3 bekçi.
// Bu ayrım olmasaydı kapı 20 yanlış pozitifle doğardı.
//
// İki yazım biçimi de tanınır (ölçüldü, ikisi de ağaçta var):
//   readFileSync("docs/x/y.md")                    → tek literal
//   readFileSync(join(REPO, "docs", "standart", "y.md"))  → parçalı join
// Parçalı biçimde `docs`tan SONRAKİ her parça literal olmalı; değilse yol
// DİNAMİKTİR ve sessizce atlanır (uydurma bir yol üretip yanlış kırmızı vermeyiz).
const KOD_UZANTI = /\.(ts|tsx|mjs|cjs|js)$/;
const FS_CAGRISI = /\b(readFileSync|readFile|existsSync|statSync|createReadStream)\s*\(/;
const TEK_LITERAL = /["'`](docs\/[A-Za-z0-9._/-]+\.(?:md|json))["'`]/g;
const JOIN_PARCALI = /join\s*\(([^()]*)\)/g;

function kodDosyalari(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) kodDosyalari(full, out);
    else if (KOD_UZANTI.test(name)) out.push(full);
  }
  return out;
}

const kodCapalari = [];
for (const file of kodDosyalari(REPO_ROOT)) {
  const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
  // ⚠️ YORUMLAR ELENİR — bu kapı İLK KOŞUMDA KENDİNİ yakaladı: başlığındaki
  // `join(REPO, "docs", "standart", "y.md")` ÖRNEĞİ gerçek bir çağrı sanıldı.
  // Bugün DÖRDÜNCÜ kez aynı sınıf: bir tarayıcının ilk kurbanı kendi belgesidir.
  const src = readFileSync(file, "utf8")
    .split("\n")
    // `/**` ile BAŞLAYAN tek satırlık JSDoc de yorumdur: eski hâl yalnız `//` ve
    // devam satırı `*` eliyordu, `/** … */` koddan sayılıp yanlış kırmızı veriyordu.
    .map((l) => {
      const t = l.trim();
      return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") ? "" : l;
    })
    .join("\n");
  if (!FS_CAGRISI.test(src)) continue; // dosya hiç okuma yapmıyorsa atıfları prose'dur
  const aday = new Set();
  for (const m of src.matchAll(TEK_LITERAL)) aday.add(m[1]);
  for (const m of src.matchAll(JOIN_PARCALI)) {
    const parcalar = m[1].split(",").map((x) => x.trim());
    const i = parcalar.findIndex((p) => /^["'`]docs["'`]$/.test(p));
    if (i < 0) continue;
    const kuyruk = parcalar.slice(i);
    if (!kuyruk.every((p) => /^["'`][A-Za-z0-9._-]+["'`]$/.test(p))) continue; // dinamik
    aday.add(kuyruk.map((p) => p.slice(1, -1)).join("/"));
  }
  for (const p of aday) {
    if (!/\.(md|json)$/.test(p)) continue;
    if (!existsSync(join(REPO_ROOT, p))) kodCapalari.push({ rel, path: p });
  }
}
if (kodCapalari.length) {
  console.error(
    `❌ Doküman bekçisi ${kodCapalari.length} ÖLÜ KOD→BELGE ÇAPASI buldu — bir kod bu belgeyi\n` +
      `   OKUYOR ama dosya YOK. Belge taşındıysa kodu güncelle; bölündüyse yeni dosyayı göster.\n`,
  );
  for (const c of kodCapalari) console.error(`  ${c.rel}\n      okur: '${c.path}' — MEVCUT DEĞİL\n`);
  process.exit(1);
}

// --- GATE: ölü-link (CI FAIL) ---
if (deadLinks.length === 0) {
  console.log(`✅ Doküman bekçisi: ölü doküman-link yok (${mdFiles.length} .md tarandı).`);
  process.exit(0);
}

console.error(`❌ Doküman bekçisi ${deadLinks.length} ÖLÜ LİNK buldu (${mdFiles.length} .md tarandı):\n`);
for (const d of deadLinks) {
  console.error(`  ${d.file}:${d.line}`);
  console.error(`      '${d.path}' mevcut değil (taşınmış/yeniden-adlandırılmış?)`);
  console.error(`      → ${d.text}\n`);
}
console.error("Düzelt: yolu güncelle (dosya taşındıysa yeni yerine), ya da atfı kaldır.");
process.exit(1);
