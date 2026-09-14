// =============================================================================
// Test: KİMLİK DEFTERİ — bir kimlik kümesi ile gerçek kaynağı ayrışamaz
// =============================================================================
// TEK CÜMLE: *bir kimlik kümesi ile onun gerçek kaynağı ayrışamaz; ayrışma ya
// arşivde gerekçelidir ya KIRMIZIDIR.*
//
// İki yön, aynı hastalığın iki ucu (belge ile ölçümün ayrışması):
//
//   YÖN A — kümeden üye DÜŞTÜ. Düşen üyenin ADI `CLAUDE-NOT-ARSIVI.md`de
//     geçmelidir. Silme YASAK DEĞİL, **SESSİZ** silme yasak.
//     ⚠️ Gerekçe COMMIT MESAJINDA DEĞİL DEFTERDE yaşar: rebase/squash mesajı
//     değiştirir, ağacın içeriğini değiştirmez. Kimlik kaldırmak bir DURUM
//     GEÇİŞİDİR, o hâlde defterine satır yazar — ve o defter zaten arşivdir
//     (`karar-notu` kuralı). Kapı yeni bir tören icat etmez, var olanı zorlar.
//
//   YÖN B — gerçekte VAR olan üye kümede YOK. Ters yön, aynı ayrışma.
//     B-a alan listesindeki ad gerçekte yok · B-b haritada yok
//     B-c gerçek bekçi haritada hiç anılmıyor
//     B-d HARİTA bir bekçiyi alana atamış ama ALAN LİSTESİNDE yok  ← asıl sınıf
//
// ⭐ NEGATİF SONDA ENVANTERİ (2026-09-13) — BEŞ SINIFIN BEŞİ DE ISIRDI.
//   Bu kapı dört kez YORUMLANDI ama hiç SONDALANMAMIŞTI. Her sonda ayrı, geri
//   alma `cp` + sha256 (`git checkout --` izlenmeyen dosyada no-op'tur).
//     S1  parti.md listesine OLMAYAN ad          → 1 B-a  (+1 B-b, doğru)
//     S2  haritadan bir adı sil (listede kalsın) → 2 B-b  (+1 B-c, doğru)
//     S3  haritanın ATADIĞI alanın listesinden sil → 1 B-d
//     S4  arşivden bir BAŞLIK sil                → "ARŞİVDEN 1 BAŞLIK DÜŞTÜ"
//     M13 `Backend:` desenini boz                → 0 B-a/0 B-b + BEYAN satırı
//   ⚠️ S1 ve S3 ilk denemede YANLIŞ NEGATİF verdi: `sed` çapası tutmamıştı ve
//   mutasyon HİÇ UYGULANMAMIŞTI. ⇒ ***Bir negatif sonda, mutasyonun UYGULANDIĞINI
//   de ölçmelidir — uygulanmamış bir mutasyonun yeşili, kapının yeşili sanılır.***
//   (S3 ikinci kez de tutmadı: `test_batch_number` diye bir bekçi yok, adı
//   `test_batch_number_format`. Çapa ELLE değil PROGRAMLA seçildi.)
//
// ⚠️ MANDAL DEĞİL TARAYICI — ama BİR İSTİSNAYLA, ve istisna CI'da ÖLÜ:
//   Taban dosyası YOK (`*-baseline.json` aranmadı, hiç doğmadı) ⇒ B-a/B-b/B-c/B-d
//   saf DURUM tutarlılığıdır: doğduğu gün ısırabilir, bir kümeyi dondurmaz.
//   §1 YÖN A ise bir MANDAL: tabanı `merge-base HEAD origin/main`.
//   ⭐ ÖLÇÜLDÜ 2026-09-13: CI'da `HEAD == origin/main` ⇒ merge-base = HEAD'in
//   KENDİSİ ⇒ `git show HEAD:ARŞİV` çalışma ağacıyla BİREBİR ⇒ düşen başlık
//   kümesi HER ZAMAN boş. **YÖN A CI'da VAKUMEN YEŞİLDİR ve orada hiç ısıramaz.**
//   Yalnız bir ÖZELLİK DALINDA (taban gerçek bir ata) anlamlıdır — S4 bunu izole
//   ağaçta kanıtladı. ⇒ *Bir mandalın tabanı dinamikse, tabanın HEAD'e eşitlendiği
//   ortamda mandal yoktur; yeşili "korundu" değil "karşılaştıracak şey yoktu" der.*
//
// GÜN-BİR ÖLÇÜM (2026-09-12): B-a 0 · B-b 0 · B-c 2 · B-d 13. Taban dosyası
// GEREKMEDİ. B-d'nin 13'ünün beşi bu haftanın defter turunda yazılıp haritaya
// girmiş ama alan koşum listesine bağlanmamış bekçiler — yani fasona dokunan
// kişi `test_roll_operation_revoke`u KOŞMUYOR. Kapının varlık sebebi budur.
//
// EŞİK: düzyazı başlıklarında yeniden adlandırma yeşil geçsin diye yakın-eşleşme
// var. Eşik TAHMİN DEĞİL ÖLÇÜM: `docs/design/KIMLIK-KAPISI-OLCUM-2026-09-12.md`
// (55 commit / 40 olay). Ham eğri 0.80 diyordu; 40 olayın 40'ı **başlığa gömülü
// elle sayaç** çıktı, yani eşiği 0.80'e çekmek kapıyı gürültüye uydurmak olurdu.
// Sayaçların başlıktan ÇIKARILMASINA karar verildi (var olmayan sayı bayatlamaz)
// ama HENÜZ UYGULANMADI — 2026-09-12 gecesi ölçüldü, üç yüzeyde de duruyorlar.
// ⚠️ BU KAPI ONU ÖLÇEMEZ: `normBaslik` parantezli sayıyı atar, yani sayaç dursa
// da silinse de aynı yeşil döner. Başlıktaki iddianın doğruluğu kapının kapsamı
// DIŞINDADIR; kaldırma inince bu yorum da güncellenecek.
// Eşik 0.95'te kaldı — gürültüye ödün değil, gelecekteki yazım düzeltmesi için sigorta.
// Normalizasyon yine de duruyor: yarın başka bir türetilmiş parça başlığa girerse.
//
// KOD KİMLİĞİNDE TOLERANS YOKTUR (izin/ekran anahtarı · model/alan · bekçi adı ·
// sürüm notu madde id): bir harf farkı yanlış şeyi işaret eder, sözleşme kırar.
//
// ⚠️ KÖRLÜK ZEMİNİ — YÖN A yalnız HENÜZ İTİLMEMİŞ işi ölçer. Taban
// `merge-base HEAD origin/main`dir; push'tan sonra taban HEAD'e eşitlenir ve
// YÖN A boş kümeyle YEŞİL döner. Yani A'nın penceresi "push öncesi"dir — ki
// `npm test` zaten orada koşar (kök CLAUDE.md § Bekçiler). Bir kez itilmiş
// sessiz düşme bu kapıyla bir daha YAKALANMAZ. Taban dosyası açmadık çünkü
// ölçüm 55 committe SIFIR gerçek düşme buldu; o sayı bir gün sıfırdan çıkarsa
// çözüm taban dosyasıdır, eşiği oynatmak değil.
//
// ⚠️ HOOK'TA DEĞİL `npm test`te koşar: commit kapısında koşsaydı
// `TEKSERP_HOOK_SKIP=1` onu kalıcı olarak kör ederdi — bugün
// `test_module_flag_off.ts`in düştüğü çukurun aynısı.
//
// Çalıştır: npx tsx scripts/test_identity_ledger.ts
// =============================================================================
import { execFileSync } from "child_process";
import { git } from "./lib/git";
import { readFileSync, existsSync, readdirSync } from "fs";
import path from "path";
import { editRatio, tokenize } from "../src/utils/string-similarity";
import { foldSearchText } from "../src/utils/search-fold";

const REPO = path.join(__dirname, "..", "..");
const ARSIV = "docs/history/CLAUDE-NOT-ARSIVI.md";
const HARITA = "Teks-Erp/docs/BEKCI-HARITASI.md";
const ESIK = 0.95;
const ESIK_KAYNAK = "2026-09-12 ölçümü, 55 commit / 40 olay, normalizasyon sonrası kırmızı 0";

let pass = 0;
let fail = 0;
const ok = (m: string) => { pass++; console.log(`  ✅ ${m}`); };
const no = (m: string) => { fail++; console.log(`  ❌ ${m}`); };
const ok2 = (m: string, k: boolean) => (k ? ok(m) : no(m));

const oku = (rel: string) => (existsSync(path.join(REPO, rel)) ? readFileSync(path.join(REPO, rel), "utf8") : "");
const g = (...a: string[]) => git(a, { cwd: REPO });

/** Kimlik = başlık eksi SAYAÇ. Parantezli sayı kimlik değil TÜRETİLMİŞ veridir. */
const normBaslik = (h: string) => foldSearchText(h.replace(/\(\s*\d+[^)]*\)/g, "")).trim();

/** Düşen başlık yeniden adlandırma mı? İki ayak, OR'lu. */
function yenidenAdlandirma(dusen: string, yeniler: string[]): boolean {
  const d = normBaslik(dusen);
  // ① yazım hatası ayağı
  if (yeniler.some((y) => editRatio(d, normBaslik(y)) >= ESIK)) return true;
  // ② kapsanma ayağı — başlık GENİŞLETİLMİŞ olabilir ("Sevkiyat" → "Sevkiyat ve iade").
  //    `alignedTokenScore` burada YANLIŞ araçtır: tam da "fazladan anlamlı kelimeyi"
  //    cezalandırmak için yazıldı (mükerrer turu, "BOYER EMRE" ↔ "BOYER" dersi).
  const td = tokenize(d);
  return td.length > 0 && yeniler.some((y) => { const s = new Set(tokenize(normBaslik(y))); return td.every((t) => s.has(t)); });
}

const basliklar = (s: string) => [...s.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1].trim());
const bekciAdlari = (s: string) => [...new Set(s.match(/\btest_[a-z0-9_]+\b/g) ?? [])];

// =============================================================================
// YÖN A — kümeden üye düştüyse arşivde adı geçmeli
// =============================================================================
function yonA(taban: string) {
  console.log("\n§1 YÖN A — düşen kimliğin arşivde gerekçesi var mı");

  // ① Arşiv SALT-EKLEMEDİR: başlık kümesi KÜÇÜLEMEZ, gerekçe kabul edilmez.
  //    Geçersiz not bile silinmez, altına `> ⚠️ GEÇERSİZ/KISMEN (tarih)` konur.
  const eski = basliklar(g("show", `${taban}:${ARSIV}`));
  const yeni = basliklar(oku(ARSIV));
  const dusenArsiv = eski.filter((h) => !yeni.includes(h));
  if (dusenArsiv.length === 0) ok(`arşiv salt-ekleme korundu (${yeni.length} başlık)`);
  else no(`ARŞİVDEN ${dusenArsiv.length} BAŞLIK DÜŞTÜ — arşiv salt-eklemedir, gerekçe kabul edilmez:\n      ${dusenArsiv.join("\n      ")}`);

  // ② Düzyazı kümeleri: düşen başlık ya yeniden adlandırmadır ya arşivde adı geçer.
  const arsivMetni = oku(ARSIV);
  const duzyaziDosyalar = [
    ...readdirSync(path.join(REPO, "docs/kurallar")).filter((f) => f.endsWith(".md")).map((f) => `docs/kurallar/${f}`),
    HARITA,
  ];
  let ihlal = 0;
  for (const rel of duzyaziDosyalar) {
    let oncekiMetin = "";
    try { oncekiMetin = g("show", `${taban}:${rel}`); } catch { continue; } // yeni doğan dosya
    const yeniB = basliklar(oku(rel));
    for (const d of basliklar(oncekiMetin)) {
      if (yeniB.includes(d)) continue;
      if (yenidenAdlandirma(d, yeniB)) continue;
      if (arsivMetni.includes(d)) continue;
      no(`${rel}: "${d}" başlığı düştü, arşivde adı GEÇMİYOR`);
      ihlal++;
    }
  }
  if (ihlal === 0) ok(`düzyazı kümelerinden sessiz düşme yok (eşik=${ESIK} · kaynak: ${ESIK_KAYNAK})`);
}

// =============================================================================
/**
 * (BÖLÜM, bekçi) çifti başına HARİTA SATIRI sayısı.
 *
 * ⚠️ `Set` DEĞİL, ve körlük tam oradaydı: §2'nin kendi `haritaBolum` yapısı bölüm
 * başına bir `Set` tutuyor ⇒ aynı bölümde aynı bekçi iki kez yazılırsa ikinci
 * satır HİÇBİR kontrole ulaşmadan silinir. `test_weaving_order` `## dokuma`
 * bölümünde iki kez kayıtlıydı ve hizalama sayısını ("549 = 549") hiç bozmadı;
 * elle bulundu (d9, 2026-09-14). *Bir kapının kör noktası yükleminde değil,
 * VERİ YAPISI seçiminde olabilir.*
 *
 * ⛔ YÜKLEM "ad başına ≤1" DEĞİL: bir bekçinin İKİ AYRI bölümde satırı olması
 * BİLİNÇLİDİR (0c ölçtü: `test_dokuma_regime_gate` `## modul-bayrak` + `## dokuma`).
 * Ad bazlı yüklem bugün **373 yanlış pozitif** üretirdi (ölçüldü 2026-09-14:
 * 373 bekçi birden çok bölümde geçiyor, `test_audit_followups` altı bölümde).
 * ⇒ Yüklemin ilk hâli ÇÜRÜTÜLDÜ ve kapsam bölüme daraltıldı.
 */
export function bolumSatirSayilari(haritaMetni: string): Map<string, number> {
  const say = new Map<string, number>();
  let bolum: string | null = null;
  for (const line of haritaMetni.split("\n")) {
    const m = /^##\s+([a-z0-9-]+)\s*(\(\d+\))?\s*$/.exec(line);
    if (m) { bolum = m[1]; continue; }
    if (!bolum || !line.startsWith("|")) continue;
    const ad = /\bscripts\/(test_[a-z0-9_]+)\.ts\b/.exec(line)?.[1];
    if (!ad) continue;
    const k = `${bolum}::${ad}`;
    say.set(k, (say.get(k) ?? 0) + 1);
  }
  return say;
}

// YÖN B — gerçekte var olan üye kümede yok
// =============================================================================
function yonB() {
  console.log("\n§2 YÖN B — bekçi kümesi gerçek kaynağıyla hizalı mı");

  const gercek = new Set(
    readdirSync(path.join(REPO, "Teks-Erp/scripts"))
      .filter((f) => f.startsWith("test_") && f.endsWith(".ts"))
      .map((f) => f.slice(0, -3)),
  );
  const haritaMetni = oku(HARITA);
  const haritaAdlar = new Set(bekciAdlari(haritaMetni));

  // Harita bölümleri: `## <alan>` → o alana atanmış bekçiler
  const haritaBolum = new Map<string, Set<string>>();
  let cur: string | null = null;
  for (const line of haritaMetni.split("\n")) {
    const m = /^##\s+([a-z0-9-]+)\s*(\(\d+\))?\s*$/.exec(line);
    if (m) { cur = m[1]; haritaBolum.set(cur, new Set()); continue; }
    if (cur) for (const n of line.match(/\btest_[a-z0-9_]+\b/g) ?? []) haritaBolum.get(cur)!.add(n);
  }

  // Alan dosyasının KOŞUM listesi (kural çapası `· bekçi:` DEĞİL — koşum listesi).
  function alanListesi(alan: string): Set<string> | null | "bicimsiz" {
    const s = oku(`docs/kurallar/${alan}.md`);
    if (!s) return null;
    const bas = /^##\s*Bekçiler/m.exec(s);
    if (!bas) return null;
    const mb = /^Backend:\s*([\s\S]+?)(?:\n\n|$)/m.exec(s.slice(bas.index + bas[0].length));
    // ⚠️ ÜÇ SONUÇ, İKİ DEĞİL (2026-09-13, 01'in ölçümü): eskiden burada BOŞ KÜME
    // dönülüyordu ve "## Bekçiler bölümü YOK" ile "bölüm DOLU ama `Backend:`
    // biçiminde değil" AYNI şeye çıkıyordu. `dokuma.md` bölümü madde imli liste
    // kullanıyor ⇒ bölüm dolu, kapı BOŞ görüyor ve o alanın bekçileri B-d diye
    // raporlanıyor — oysa tarif YAZILMIŞ, yalnız kapının OKUDUĞU BİÇİMDE değil.
    // ⇒ ***Bir belge bölümünü doldurmak, o bölümü okuyan kapıyı BESLEMEK değildir
    //   — kapı bölümü değil BİÇİMİ okur.***
    // ⚠️ Ve sessiz boş küme ikinci bir kayba yol açıyordu: B-a/B-b o alan için
    //   HİÇ koşmuyor ⇒ alan KISMEN ölçülmüyor, ama çıktı bunu söylemiyor.
    // Ölçüldü: ~30 alan dosyasından YALNIZ `dokuma` bu biçimi tutmuyor.
    if (!mb) return "bicimsiz";
    return new Set([...mb[1].matchAll(/`([^`]+?)`/g)].map((m) => m[1].replace(/⚠️/g, "").trim()));
  }

  const hatalar: string[] = [];
  const uyarilar: string[] = [];
  // B-a/B-b: ALAN DOSYALARI üzerinden dön — haritada bölümü olmayan bir alan
  // atlanmamalı, yoksa kapı kendi kör noktasını üretir.
  const alanlar = readdirSync(path.join(REPO, "docs/kurallar"))
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => f.slice(0, -3));
  for (const alan of alanlar) {
    const liste = alanListesi(alan);
    // ⚠️ `"bicimsiz"` bir STRING ve TRUTHY'dir — `!liste` onu ELEMEZ ve aşağıdaki
    // `for…of` onun KARAKTERLERİNİ gezer (8 harf × alan sayısı kadar sahte B-a/B-b).
    // Ölçüldü 2026-09-13: bu tam olarak benim yaptığım hataydı ve ürettiği 216+216
    // sayısını bir BULGU sanıp raporladım. ⇒ Sentinel değer eklerken her tüketiciyi
    // ADIYLA ele: `!x` bir sentinel'i elemez, `x === SENTINEL` eler.
    if (!liste || liste === "bicimsiz") continue;
    for (const n of liste) if (!gercek.has(n)) hatalar.push(`B-a ${alan}.md listesinde "${n}" var, DOSYA YOK`);
    for (const n of liste) if (!haritaAdlar.has(n)) hatalar.push(`B-b ${alan}.md listesinde "${n}" var, HARİTADA yok`);
  }
  // B-d: HARİTA bölümleri üzerinden dön — asıl sınıf.
  //
  // ⚠️ Harita bölüm adı ile alan dosyası adı HER ZAMAN eşleşmez: haritada `audit`
  // bölümü var ama `docs/kurallar/audit.md` YOK (audit'i `genel.md` kapsıyor,
  // kök CLAUDE.md alan dizini). Bu durumda "alan dosyası yok → yükümlülük yok"
  // demek, bekçiyi HİÇBİR koşum listesinde olmayan bir yere koymak olurdu —
  // kapatmaya çalıştığımız sınıfın bir başka hâli: "haritada var, kimse koşmuyor".
  // Bu yüzden eşleşme bulunamadığında ad TÜM koşum listelerinde aranır; hiçbirinde
  // yoksa bildirilir. Eşleme tablosu tutmuyoruz — elle tutulan tablo bayatlar,
  // arama bayatlamaz.
  //
  // ⚠️ Bu dal [ADVISORY], [GATE] DEĞİL (ölçüm 2026-09-12: 41 ad — `diger` 18 ·
  // `depo` 7 · `surum-deploy` 5 · `cuval` 4 …). `diger` gibi kovalar tanımı gereği
  // hiçbir alanın koşum listesine ait değildir; bunları kırmızı saymak kapıyı ilk
  // gün 41 kırmızıyla doğurur ve kapı kapatılır. Sayı BİLİNEN BORÇTUR, raporlanır
  // ve küçülmesi beklenir; sıfırlandığı gün [GATE]'e çevrilir. `check-docs.mjs`
  // aynı ayrımı kullanıyor (ölü-link GATE, kaldırılmış-sembol ADVISORY).
  const tumListeler = new Set<string>();
  const bicimsizAlanlar = new Set<string>();
  const bicimsizBeyan: string[] = [];
  for (const alan of alanlar) {
    const l = alanListesi(alan);
    if (l && l !== "bicimsiz") for (const n of l) tumListeler.add(n);
  }
  for (const [alan, atanan] of haritaBolum) {
    const liste = alanListesi(alan);
    if (liste === "bicimsiz") {
      if (!bicimsizAlanlar.has(alan)) {
        bicimsizAlanlar.add(alan);
        // ⚠️ BEYAN, KIRMIZI DEĞİL (1e hükmü 2026-09-13). Biçim borcu BELGE
        // SAHİBİNDEDİR; kapıyı kırmızıya boğmak ölüm biçimi ③ (sürekli kırmızı =
        // sessiz) üretirdi — ve bu kapı zaten bir KUYRUK göstergesi.
        // ⇒ Kapı KENDİ KAPSAM KAYBINI ilan eder ama commit'i durdurmaz.
        bicimsizBeyan.push(alan);
      }
      continue;
    }
    for (const n of atanan) {
      if (liste) { if (!liste.has(n)) hatalar.push(`B-d harita "${n}"yi ${alan} alanına atamış, ALAN KOŞUM LİSTESİNDE yok`); }
      else if (!tumListeler.has(n)) uyarilar.push(`${alan}/${n}`);
    }
  }
  for (const n of gercek) if (!haritaAdlar.has(n)) hatalar.push(`B-c "${n}" gerçek bekçi, HARİTADA hiç anılmıyor`);

  // ⚠️ KAPI KENDİ KAPSAM KAYBINI İLAN EDER — ve kaybın YÖNÜ ölçüldü, DEVRALINMADI.
  //
  // ⚠️ İLK TARİF DOĞRUYDU, BENİM "DÜZELTMEM" YANLIŞTI (2026-09-13):
  // *"biçimi tutmayan alanda B-a/B-b HİÇ KOŞMAZ, alan kısmen ÖLÇÜLMEZ"* — DOĞRU.
  // Eski kod boş küme dönüyordu, boş küme üzerinde `for…of` hiçbir şey yapmaz.
  // Ben "yönü ters" deyip **216 B-a + 216 B-b** rapor ettim; o sayı ÖLÇÜMÜN
  // KENDİSİNDEN değil BENİM EKLEDİĞİM sentinel'den doğmuştu: `"bicimsiz"` truthy
  // bir string ve `!liste` onu elemiyordu ⇒ `for…of` 8 KARAKTERİ geziyordu
  // (8 × 27 alan = 216). ⇒ ***Bir mutasyonun ürettiği sayıyı bulgu saymadan önce,
  //   o sayının MUTASYONUN KENDİSİNDEN gelip gelmediğini ölç.*** Sonda aracı
  //   ölçtüğü şeyin içine karıştığında ürettiği sayı bir ölçüm değildir.
  // Ölçüldü 2026-09-13: 27 alan dosyasından biçimsiz **0** (tek vaka `dokuma`ydı,
  // 01 aynı turda `Backend:` satırıyla kapattı).
  if (bicimsizBeyan.length > 0) {
    console.log(
      `  ⚠️  [ADVISORY] ${bicimsizBeyan.length} alan dosyasının "## Bekçiler" bölümü DOLU ama ` +
        `\`Backend:\` biçiminde DEĞİL — koşum listesi OKUNAMADI: ${bicimsizBeyan.sort().join(", ")}`,
    );
    console.log(
      `      ⚠️ SONUÇ: o alanlarda B-a/B-b ÖLÇÜLMEDİ (liste okunamadı ⇒ karşılaştıracak ` +
        `küme yok). Kapı bu alanlar için "temiz" DEMİYOR, "BAKMADIM" diyor.`,
    );
    console.log(`      (biçim borcu BELGE SAHİBİNDE; bu satır kapıyı kırmızı YAPMAZ)`);
  }
  if (uyarilar.length > 0) {
    console.log(`  ⚠️  [ADVISORY] ${uyarilar.length} bekçi haritada bir kovada ama HİÇBİR alan koşum listesinde yok`);
    console.log(`      (alan dosyası olmayan harita bölümleri; bilinen borç, kapıyı KIRMIZI yapmaz)`);
  }
  // ── §2c (BÖLÜM, bekçi) başına ≤1 satır — SERT, taban 0 (borçsuz kapı) ──────
  const cift = bolumSatirSayilari(haritaMetni);
  const mukerrer = [...cift].filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
  if (mukerrer.length === 0) ok(`§2c (bölüm, bekçi) başına tek satır (${cift.size} çift)`);
  else no(`§2c ⭐ AYNI BÖLÜMDE MÜKERRER satır: ${mukerrer.join(" · ")} ⇒ birleştir (§2'nin \`Set\`i bunu GÖREMEZ)`);
  // Sondalar — yüklem hem ısırmalı hem BİLİNÇLİ çift satırı geçirmeli.
  const sondaKirmizi = bolumSatirSayilari("## a\n| `scripts/test_x.ts` |\n| `scripts/test_x.ts` |\n");
  ok2("§2c sonda: aynı bölümde iki kez → yakalanır", [...sondaKirmizi.values()].some((n) => n > 1));
  const sondaYesil = bolumSatirSayilari("## a\n| `scripts/test_x.ts` |\n## b\n| `scripts/test_x.ts` |\n");
  ok2("§2c sonda: İKİ AYRI bölümde aynı ad → geçer (0c'nin bilinçli çifti)", [...sondaYesil.values()].every((n) => n === 1));

  if (hatalar.length === 0) ok(`bekçi kümesi hizalı (${gercek.size} gerçek · ${haritaAdlar.size} haritada)`);
  else {
    // ⚠️ İKİ SINIF AYRI SAYILIR (2026-09-13). Tek toplam basıldığında sayı
    // DÜŞERKEN sınıf AĞIRLAŞABİLİR ve okuyan "ilerliyor" der: ölçüldü — 6 → 4
    // inişinde ikisi B-c'den B-d'ye GEÇTİ, yani daha zor fark edilir hâle geldi.
    //   B-c = ENVANTER eksiği  — "kimse bu bekçiyi TARİF etmedi"
    //   B-d = KAPSAM eksiği    — "tarif edildi ama o alana dokunan KOŞMAYACAK"
    // ⇒ B-d daha sinsidir: harita satırı VAR, bakan "tamam" der ve geçer.
    // ***Bir bekçiyi TARİF etmek onu BAĞLAMAK değildir.***
    const bc = hatalar.filter((h) => h.startsWith("B-c")).length;
    const bd = hatalar.filter((h) => h.startsWith("B-d")).length;
    const kirilim = [bc ? `${bc} B-c (envanter)` : "", bd ? `${bd} B-d (KAPSAM)` : ""]
      .filter(Boolean)
      .join(" · ");
    no(`${hatalar.length} ayrışma — ${kirilim} — bir alana dokunan kişi onu koruyan bekçiyi KOŞMUYOR:`);
    for (const h of hatalar.sort()) console.log(`      · ${h}`);
  }
}

function main() {
  console.log("=== KİMLİK DEFTERİ KAPISI ===");
  let taban = "";
  // ⚠️ ÜÇ SONUÇ, İKİ DEĞİL — ve üçüncüsü SESSİZ DEĞİL (1e hükmü 2026-09-13).
  // §1 YÖN A bir MANDALDIR ve tabanı DİNAMİK. Ölçüldü: CI'da `HEAD == origin/main`
  // ⇒ merge-base HEAD'in KENDİSİ ⇒ karşılaştırılan iki şey BİREBİR ⇒ mandal ORADA
  // YOKTUR. Eskiden bu durumda sessizce yeşil basıyordu ve *"korundu"* diye
  // okunuyordu. Artık taban ÜÇ yoldan biriyle kurulur ve hangisi olduğu BASILIR.
  let tabanKaynak = "";
  // ① özellik dalı: merge-base gerçek bir ATA (HEAD'den farklı)
  try {
    const mb = g("merge-base", "HEAD", "origin/main").trim();
    const head = g("rev-parse", "HEAD").trim();
    if (mb && mb !== head) { taban = mb; tabanKaynak = "merge-base HEAD origin/main (özellik dalı)"; }
  } catch { /* origin/main yok — ②'ye düş */ }
  // ② CI: push'tan ÖNCEKİ uç. Ölçüldü 2026-09-13: bir push 1–2 commit taşıyor,
  //    yani bu taban push'un TAMAMINI kapsar (HEAD~1 kapsamazdı).
  if (!taban) {
    const before = (process.env.CI_BEFORE_SHA ?? "").trim();
    // ⚠️ İLK PUSH / FORCE-PUSH / YENİ DAL → `000…0`; force-push sonrası sha
    // ULAŞILAMAZ olabilir. İkisi de `git show`u patlatır ⇒ ÇÖKEN SONDA olurdu.
    // Bu yüzden hem sıfır-sha elenir hem VARLIĞI `cat-file -e` ile ÖLÇÜLÜR.
    if (before && !/^0+$/.test(before)) {
      try { g("cat-file", "-e", `${before}^{commit}`); taban = before; tabanKaynak = "CI_BEFORE_SHA (push aralığı)"; }
      catch { /* çözülemedi — ③'e düş */ }
    }
  }
  // ③ taban YOK: ölçmedik ve bunu SÖYLÜYORUZ.
  if (taban) {
    console.log(`  taban: ${taban.slice(0, 8)} (${tabanKaynak})`);
    yonA(taban);
  } else {
    console.log(
      "  ⚠️  YÖN A ÖLÇÜLMEDİ — taban kurulamadı (merge-base = HEAD, ve CI_BEFORE_SHA yok/çözülemedi).",
    );
    console.log(
      "      Bu bölüm YEŞİL DEĞİL, BAKILMADI: arşivden başlık düşse bu koşum GÖRMEZDİ.",
    );
  }
  yonB();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main();
