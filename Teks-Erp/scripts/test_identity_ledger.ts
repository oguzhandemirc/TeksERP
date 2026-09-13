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

const oku = (rel: string) => (existsSync(path.join(REPO, rel)) ? readFileSync(path.join(REPO, rel), "utf8") : "");
const git = (...a: string[]) => execFileSync("git", a, { cwd: REPO, encoding: "utf8" });

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
  const eski = basliklar(git("show", `${taban}:${ARSIV}`));
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
    try { oncekiMetin = git("show", `${taban}:${rel}`); } catch { continue; } // yeni doğan dosya
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
    if (!liste) continue;
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
  // İlk tarif (bana iletilen): *"biçimi tutmayan alanda B-a/B-b HİÇ KOŞMAZ,
  // alan kısmen ÖLÇÜLMEZ ve kapı bunu söylemez."* ⇒ ÖLÇTÜM, **YÖNÜ TERS**:
  // `alanListesi` boş küme dönünce B-a/B-b susmaz, o alana dokunan HER dosya
  // için *"bekçi koşulmadı"* der. Sonda (M13, tüm alanlar biçimsiz): **216 B-a +
  // 216 B-b** yanlış kırmızı. ⇒ Kayıp EKSİK ÖLÇÜM değil **YANLIŞ ÖLÇÜM**.
  // Sahada görünmemesinin sebebi: B-a/B-b yalnız DEĞİŞEN dosyalar için konuşur ve
  // tek biçimsiz alan (`dokuma`) fark kümesine nadiren giriyordu.
  // ⇒ ***Bir kapsam kaybının yönünü ölçmeden ilan etme: "ölçmedi" ile "yanlış
  //   ölçtü" farklı kalemlerdir ve farklı kişileri arattırır.***
  // Ölçüldü 2026-09-13: 27 alan dosyasından biçimsiz **0** (tek vaka `dokuma`ydı,
  // 01 aynı turda `Backend:` satırıyla kapattı).
  if (bicimsizBeyan.length > 0) {
    console.log(
      `  ⚠️  [ADVISORY] ${bicimsizBeyan.length} alan dosyasının "## Bekçiler" bölümü DOLU ama ` +
        `\`Backend:\` biçiminde DEĞİL — koşum listesi OKUNAMADI: ${bicimsizBeyan.sort().join(", ")}`,
    );
    console.log(
      `      ⚠️ SONUÇ: o alanlar BOŞ LİSTEYLE ölçülür ⇒ alana dokunan her dosya için ` +
        `B-a/B-b YANLIŞ KIRMIZI verebilir (eksik ölçüm DEĞİL, yanlış ölçüm).`,
    );
    console.log(`      (biçim borcu BELGE SAHİBİNDE; bu satır kapıyı kırmızı YAPMAZ)`);
  }
  if (uyarilar.length > 0) {
    console.log(`  ⚠️  [ADVISORY] ${uyarilar.length} bekçi haritada bir kovada ama HİÇBİR alan koşum listesinde yok`);
    console.log(`      (alan dosyası olmayan harita bölümleri; bilinen borç, kapıyı KIRMIZI yapmaz)`);
  }
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
  try { taban = git("merge-base", "HEAD", "origin/main").trim(); } catch { taban = ""; }
  if (taban) { console.log(`  taban: ${taban.slice(0, 8)} (merge-base HEAD origin/main)`); yonA(taban); }
  else console.log("  ⚠️  origin/main okunamadı → YÖN A ATLANDI (ölçülmedi, yeşil değil)");
  yonB();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main();
