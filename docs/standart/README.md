# TeksERP Kod Yazım Standardı

Bu dizin **rutin** soruların cevabıdır: bir servis metodu nasıl yazılır, model nasıl tanımlanır, hangi katman neyi içerir, dosya ne kadar uzun olabilir, kütüphane nasıl seçilir, test ne zaman koşar.

Repo belgeleri bugüne kadar **olay-türevliydi**: her kural bir arızadan doğdu ("2026-08-15 saha çökmesi → `notIn: []` yasak"). Bu iyi bir refleks ama bir boşluk bıraktı — hiç arızalanmamış rutin konvansiyonlar hiç yazılmadı ve her yeni kod onları koddan yeniden çıkarsadı. Bu dizin o boşluğu kapatır.

## Üç belge katmanı — hangisi neyi söyler

| Katman | Soru | Nerede |
|---|---|---|
| **Standart** (bu dizin) | "Nasıl yazılır?" — rutin, tekrarlanan, her gün geçerli | `docs/standart/*.md` |
| **Kod kuralları** | "Bu tuzak neden var?" — olaydan doğan desen ve yasaklar | `docs/KOD-KURALLARI.md` |
| **Alan kuralları** | "Bu alanda hangi kararlar alındı?" | `docs/kurallar/<alan>.md` |

Üçü birbirine **bağlanır, kopyalanmaz**. Standart bir yasağı tekrar etmez; ona işaret eder. Bir cümle iki yerde yaşıyorsa biri bayatlayacak demektir.

Karar hikâyeleri (tarih, ölçüm, hangi alternatif neden reddedildi) `docs/history/CLAUDE-NOT-ARSIVI.md`'de. Standart dosyaları **hikâye taşımaz**: kural tek cümle, emir kipi.

## Dosyalar

| Dosya | İçerik |
|---|---|
| [`ILKELER.md`](ILKELER.md) | Katman-üstü ilkeler, isimlendirme, boyut felsefesi, kural yazma ölçütü |
| [`BACKEND.md`](BACKEND.md) | Route / controller / service / helper / reports / jobs — ne içerir, servis metodu anatomisi, hata ve yanıt şekli |
| [`VERITABANI.md`](VERITABANI.md) | Model şablonu (§1), model sınıfları (§2), künye FK (§3), index (§4), enum (§5), `///` gerekçe (§6), soft delete (§9), Decimal/zaman (§10), boyut (§13) |
| [`VERITABANI-MIGRATION.md`](VERITABANI-MIGRATION.md) | Migration yazımı (§7) ve şema-dışı nesne envanteri (§8) — 2026-09-13'te `VERITABANI.md`'den bölündü, §7/§8 numaraları çapalar kopmasın diye korundu |
| [`ELECTRON.md`](ELECTRON.md) | Panel: sayfa kalıbı, servis/şema/kolon dosyaları, izin aynası, boyut |
| [`MOBIL.md`](MOBIL.md) | Tablet: ekran kalıbı (kabuk + görünüm + hook + saf mantık), offline kuyruk, OTA/APK sınırı |
| [`KUTUPHANELER.md`](KUTUPHANELER.md) | Katman × ihtiyaç → kütüphane tablosu, yeni bağımlılık karar kaydı, ölü paket teşhisi |
| [`ESZAMANLILIK.md`](ESZAMANLILIK.md) | Yarış ve idempotency tutumu (§1), karar tablosu (§2), bekçi yazımı (§4), istemci tarafı (§5), yanlış refleks listesi (§7), beklenen uyarı (§8) |
| [`ESZAMANLILIK-ENVANTER.md`](ESZAMANLILIK-ENVANTER.md) | Kilit uzayı envanteri (§3) ve bilinen boşluklar (§6) — 2026-09-13'te `ESZAMANLILIK.md`'den bölündü, §3/§6 numaraları çapalar kopmasın diye korundu |
| [`TEST-VE-DERLEME.md`](TEST-VE-DERLEME.md) | Ne zaman ne koşar, hangi kapı nerede (§1–§6) |
| [`TEST-VE-DERLEME-SINIRLAR.md`](TEST-VE-DERLEME-SINIRLAR.md) | Bilinen sınırlar (§7) ve **bilerek kırmızı bekçiler** (§8) — paket kırmızı verdiğinde ilk bakılacak liste; her satır "kim kapatabilir" taşır |
| [`OLCUM-DISIPLINI.md`](OLCUM-DISIPLINI.md) | Ölçüm YÖNTEMİ: pozitif kontrol ↔ örnekle doğrulama, teşhis mesajı da bir yüklemdir, atıfta eşik, yapısal sonda, sayı yazma, **kapının ölüm biçimleri** |
| [`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md) | KATMAN 1b — ölçümün **KURGUSU**: soru, kontrol grubu, ortam, deneyin kurulumu |
| [`OLCUM-DISIPLINI-ARAC.md`](OLCUM-DISIPLINI-ARAC.md) | KATMAN 1a — ölçümün **ARACI**: desen, komut, ayrıştırıcı, aracın varsayılanı ve kapsamı |
| [`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md) | Arıza sınıfı kataloğu **KATMAN 2** — ölçümden sonraki adım (*sayı doğru; ondan ÇIKARILAN ne?*); hiçbir pozitif kontrol bu katmanı yakalamaz |

## Kural biçimi

Her kural tek satır ve şu şablondadır:

```
- **[BE-07]** <emir kipi, tek cümle> · zorlama: <etiket> · kanıt: <dosya:satır | ölçüm> [· devralınan: <N (tavan) | yok>]
```

`devralınan:` **opsiyoneldir** ve yalnız kuralın SAYILABİLİR bir kod yüzeyi varsa yazılır: `N` ölçülmüş devralınan ihlaldir (mekanik kuralda `lint-baseline.json` tavanı), `yok` ise "ölçüldü, sıfır" beyanıdır. Alanın hiç yazılmaması "sayılacak bir yüzey yok" demektir — katman-üstü ilkeler (`ILKELER.md`) ve kadans kuralları (`TEST-VE-DERLEME.md`) bir dosya kümesini değil bir DAVRANIŞI tarif eder, orada `devralınan: yok` yazmak ölçülmemiş bir sayıyı ölçülmüş gibi gösterirdi. Bugünkü dağılım (ölçüm 2026-09-06): 278 kuralın 218'i alanı taşır; taşımayan 60 kural `ILKELER.md` (28), `TEST-VE-DERLEME.md` (31) ve `VERITABANI.md` (1) içindedir.

**Zorlama etiketi** kuralın nasıl korunduğunu söyler. Etiketsiz kural yazılmaz:

| Etiket | Anlamı |
|---|---|
| `eslint:<kural>` | Lint kapısı; ihlal commit'te ve CI'da kırmızı |
| `bekçi:<dosya>` | Bir `test_*.ts` / `*.test.ts` bunu ölçer |
| `tsc` | Derleyici zorlar (tip, `satisfies`, eksik alan) |
| `hook` | Commit kapısı (`.githooks/pre-commit`) |
| `insan:<neden>` | Mekanik değil — **gerekçesi zorunlu**. "Henüz yazmadım" gerekçe değildir; "AST'den güvenilir yakalanamaz" gerekçedir. |

**Kanıtsız kural yazılmaz.** Her kural ya kodda gösterilebilen bir emsale ya da bir ölçüme dayanır. "Böyle olsa iyi olur" cümleleri buraya girmez — çünkü okuyan (insan ya da ajan) onları uygulanan kurallardan ayırt edemez ve belgenin tamamına güveni düşer.

## Yeni kodda zorunlu · devralınan baseline'da donar

Bu standardın en önemli cümlesi budur ve ölçümden doğar. Kod tabanı 2026-05'ten beri hızlı büyüdü; bugünkü kalıp son altı haftada oturdu. Yani:

- **Yeni ve dokunulan kodda** kurallar ZORUNLUDUR.
- **Devralınan kod sınır dışıdır** ve toplu kampanyayla düzeltilmez.

Bunun mekanik karşılığı `lint-baseline.json`'dur: ihlali sıfır olmayan bir kural `warn` olarak yazılır, bugünkü sayı **tavan** olarak dondurulur ve **tavan yalnız düşer**.

```bash
node scripts/check-lint-baseline.mjs              # üç projede tavan kontrolü
node scripts/check-lint-baseline.mjs --yaz        # tavanı bugünkü sayıya sabitle
node scripts/check-lint-baseline.mjs --proje=mobil
```

Kapı commit'te (`.githooks/pre-commit`) ve CI'da koşar. Bir kural tavanı aşarsa mesaj şunu söyler: devralınan kodu düzeltmen gerekmiyor, **eklediğin yeri sınıra çek**.

Tavanı yükseltmek bir karardır ve gerekçesiyle yapılır. Baseline dosyası commit edilir; CI'ın kendi kendine indirmesi o kaydı görünmez kılardı.

## Kural yazma ölçütü — ne buraya girer

Bir cümle standarda girer eğer:

1. **Mekanik olarak zorlanabiliyorsa** (eslint / bekçi / tsc / hook), ya da
2. **Bir karar noktasıysa** — yanlış seçim pahalıysa ve kod okuyarak anlaşılmıyorsa.

İkisi de değilse yazılmaz. Yazılırsa iki zarar verir: okuyanın bütçesini yer, ve uygulanmayan bir kural belgenin tamamını "tavsiye" seviyesine indirir.

**ESLint'e kural ekleme ölçütü ayrıca ölçüme bağlıdır** (`Teks-Erp/eslint.config.mjs` başlığı): kural ancak AST'den kesin yakalanabiliyorsa girer. Ölçülen ihlal sıfırsa `error`; azsa (≤15) ihlaller düzeltilir ve `error` olur; çoksa `warn` + baseline. Ölçüm kuralı çürütüyorsa **kural yazılmaz ve gerekçe config başlığına yazılır** (emsal: `toLocaleUpperCase("tr")` yasağı dar okunmuştu, 56 meşru kullanım ölçüldü, kural reddedildi).

Her yeni ESLint kuralı **negatif sondayla** doğrulanır: kasıtlı ihlal ekle → lint kırmızı → geri al. Sonda koşulmadan kural yazılmaz; koşulmamış bir kural, kapsamı yanlış okuduğunu ancak sahada gösterir.

## Bu standardın kapsamı dışında (bilinen borç)

Bunlar bilinçli olarak ertelendi; her biri ayrı bir karar ve iştir:

- Beş mega backend servisini bölmek (`subcontractor` 7.143 · `workorder` 6.847 · `inventory` 5.421 · `system-setting` 5.022 · `shipping` 4.861 satır).
- Beş dev mobil ekranı bölmek (`TamburScreen` 9.386 · `FasonKabul` 4.679 · `KK1` 4.204 · `KursunQc` 3.192 · `FasonSevk` 2.401 — bölme planı `docs/history/standart-2026-09-05/kesif/mobil-ekran.json`).
- Bekçi paketini paralelleştirmek — şema izolasyonu **YETMEZ**: `pg_advisory_xact_lock` veritabanı kapsamlıdır. DB-per-worker gerekir.
- Devralınan kodda toplu kampanyalar: yorum kısaltma, class→fonksiyon, `include`→`select`, ham hex → token.
- Araç zinciri hizalama (üç TypeScript ve iki ESLint ana sürümü).
- Backend'de yapılandırılmış logger (bugün 137 `console` çağrısı fiilen tek kanal).
- Mobilde şema doğrulama katmanı (`zod` yok) — `ESZAMANLILIK-ENVANTER.md` §6 bilinen boşluklar.

## Bu standart nereden çıktı

2026-09-05'te on salt-okunur ajan üç projenin fiilî konvansiyonlarını, sapmalarını ve ihlal sayılarını ölçtü. Buradaki hemen her kural **uydurulmadı, ölçüldü**: kod zaten öyle yazılıyordu, yazılı karşılığı ve mekanik kapısı yoktu.

Ham bulgular ve sayılar: [`docs/history/standart-2026-09-05/`](../history/standart-2026-09-05/) (`kesif/OZET.md` özet, `kesif/KESIF-TAM.json` tam metin, `olcum/` ESLint ve paket ölçümleri, `UYGULAMA-OZETI.md` bu turda ne yapıldı).
