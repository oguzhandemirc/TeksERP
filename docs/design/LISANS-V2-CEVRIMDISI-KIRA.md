# Lisans v2 — çevrimdışı kira, çevrimdışı kök, belirsizlik merdiveni

> **Durum:** TASARIM (2026-10-01). Kod yazılmadı. Alt kararlar §6'daki sorular cevaplanınca dilimler açılır.
> **Bağlayıcı kararlar:** kullanıcı, 2026-10-01 (dört madde): ① internet kesintisi lisansı kısaltmaz · ② lisans dosyası bozulur ya da silinirse 14 gün uyarı, sonra ek süre, sonra kısıtlı · ③ kök çevrimdışı, VDS'te süreli/sınıflı/iptal edilebilir HAK ara imzacısı (G4) · ④ kural içinde sıkılaştırma (G12).
> **Kaynak:** güvenlik denetimi G4 · G12 (G13 yalnız sınır olarak) ve karar notu §2 · §4. Açık ayrıntısı bu belgeye alınmadı.
> **Üst belge:** [LISANS-PROTOKOLU.md](LISANS-PROTOKOLU.md) (v:1). Bu belge onun EKİDİR. Kod inince protokol belgesi ve `docs/kurallar/lisans.md` güncellenir (§7), bu belge tarihçe olarak kalır. Önkoşul: G3 dalı (`guvenlik/g3-capa-ayrimi`, çapanın `uretim`/`hazirlik` kipleri) main'e inmiş olmalı.

## 0. Özet

| Konu | Bugün (v1) | v2 |
|---|---|---|
| İnternetsiz çalışma | kira ömrü (≤ 45 g) + ek süre (30 g) ⇒ ~60–75 gün | **ödenmiş tarihe (P) dek** tam; P−30 g bilgi bandı; P'den sonra 30 g ek süre; sonra kısıtlı |
| Kira bitişi | ek süre çapası | yalnız TAZELİK bilgisi (yaptırım, sürüm, belirteç); çapa değil |
| Lisans dosyası silinir/bozulur | çapa HAK verilişi + 30 g; kira+durum birlikte silinirse kip gözleme düşer | 14 g UYARI (çalışma süresi) → 30 g EK_SURE → KISITLI; kip alt sınırı HAK'ta; satıcıya "yerel müdahale şüphesi" |
| Kök anahtar | VDS'te parolalı; bütün HAK'ları ve sertifikaları imzalar; süresiz, iptalsiz | Mac'te çevrimdışı; yalnız dönemsel törende ara sertifikaları, iptal belgesini ve istisna HAK'ları imzalar |
| HAK imzacısı | kök (ya da bayi) | VDS'te **ara imzacı** (90 g, sınıflı, iptal edilebilir); portal bugünkü gibi |
| ALT / İNDİRME | 180 g / 365 g, iptalsiz | 45 g / 90 g, iptal belgesiyle |
| Belirsizlik (ölçülemedi) | yalnız UYARI; modül tavanını kaldırır | çalışma süresiyle birikir: 14 g → EK_SURE → KISITLI; tavan HAK'tan sürer |

Gerekçe: endüstriyel yazılımlarda internetsiz tesis için makineye bağlı lisans süre sonuna dek geçerlidir. Ödeme kaldıracı kiranın tazeliğinden ödenmiş tarihe taşınır.

## 1. Kira modeli v2

### 1.1 Ödenmiş tarih (P)

**Tanım.** P, satıcının imzaladığı "bu kurulumun ödemesi şu tarihe dek yapıldı" beyanıdır. Kaynak satıcıda TEK yardımcıdır: `odenmisTarihi(hak, aktifTaksitPlani)` (`cloud-entitlement.ts` emsali). Bugün satıcıda böyle bir kolon yok; değer şuradan türer:

| Müşteri | P | Bugünkü `gecerlilikBitis` (eski derlemeler için aynen sürer) |
|---|---|---|
| Peşin, vadeli | sözleşme sonu (portalda verilen tarih) | aynı tarih |
| Taksitli | sıradaki ödenmemiş kalemin vadesi (§6 S5) | vade + `uzatmaGun` (15) |
| Demo | demo bitişi | aynı |
| Kalıcı, ödemesi tamam | `null` (süresiz) | `null` |

**Formül (fabrika, saf `state-rules.ts`):**

```
ufukSonu = hak.cevrimdisiUfukGun === null ? +∞ : kira.verilis + hak.cevrimdisiUfukGun gün
P        = min( kira.odenmisTarih ?? +∞ , ufukSonu )
```

- **v2 koşulu:** kullanılabilir kira `odenmisTarih` ALANINI, ona bağlı kullanılabilir HAK `cevrimdisiUfukGun` ALANINI taşıyorsa P kullanılır. Biri yoksa bugünkü çapa (`min(kira.bitis, gecerlilikBitis)`) aynen uygulanır. Böylece yeni derleme eski belgelerle bugünkü gibi davranır.
- **Ufuk HAK'tadır, kirada değil.** Kirayı VDS'teki parolasız ALT imzalar. Ufuk ise HAK'tadır ve HAK'ı parolalı ara imzacı ya da kök imzalar. Çalınan ALT ödenmiş tarihi en çok ufuk kadar ileri yazabilir. Ara imzacı ve bayi en çok **400 gün** ufuk verebilir. Daha uzun ya da süresiz ufuk (tamamen internetsiz kalıcı müşteri, çok yıllık peşin sözleşme) yalnız KÖK imzalı HAK'ta olur ve dönemsel törende imzalanır (§6 S2).
- Varsayılan ufuk (satıcı ayarı): URETIM · DR · BAYI 400 g; DEMO · TEST 45 g.
- HAK silinir ya da doğrulanamazsa ufuk bilinmez. P uzatılmaz, eski çapaya (kira bitişi) düşülür. Silmek süreyi yalnız KISALTIR.

### 1.2 Yoklamanın rolü

Yoklama artık süreyi tazelemek için gerekmez. Kararları taşır:

| Taşıdığı | v2'de anlamı |
|---|---|
| Ödeme uzatması | yeni kira yeni `odenmisTarih` taşır; internetsiz kurulumda QR ya da dosya (§1.4) |
| Yaptırım K0–K5, dondurulan modül, `devredildi` | bugünkü gibi; yalnız fabrikaya ulaştığında işler (bilinen sınır §1.6) |
| Kopya zinciri | bugünkü üç hâl (yakala · tekrar · çatal). **Değişen:** ikinci pencerede "kira verilmez" v2'de etkisizdir, çünkü o taraf P'ye dek çalışır. Bunun yerine eşleşmeyen tarafa **imzalı kapanış kirası** gider: K3, `kisitlamaTarihi = şimdi + ekSureGun` (§6 S6). Taşınan eski anahtar ve iptal edilen kurulum da aynı kapanış kirasını alır. İmzasız 403 hiçbir süreyi kısaltmaz (araya giren biri fabrikayı durdurabilirdi). |
| Kanal güncel sürümü, indirme belirteci, modül anahtarları, destek yanıtları | bugünkü gibi |
| İptal belgesi (§2.3) | yeni |
| Sağlık ve durum özeti | yeni `belirsizlik` ve `durumKaydi` blokları (§3.1-5); satıcıda yerel müdahale tespiti |

**"İnternet VAR" tanımı:** son kabul edilen kiranın `sunucuSaati`, güvenilir saate göre 24 saatten yeni. Kaynak imzalı ve kalıcıdır; bellekteki yoklama sinyali yeniden başlatmada sıfırlanırdı. QR ya da dosyayla gelen kira da sayılır.

**Zamanın getirdiği KISITLI iki anahtarlıdır, ikinci anahtar yeniden tanımlanır:** "son 24 saatte başarısız deneme VAR" yerine **"son 24 saatte başarılı kira alışverişi YOK"**. Bugünkü tanımda hiç yoklamayan kurulum (satıcı adresi `kapali`, etkinleşmemiş) ikinci anahtarı hiç çevirmez. v2'de internetsiz kurulum P'den sonra kısıtlıya düşebilsin diye bu değişir (§6 S3). İnternet varken kademeyi yine yalnız satıcı kararı düşürür.

### 1.3 Zaman çizelgesi (`zorla`; gözlemde hepsi yalnız hesaplanır, uygulanan NORMAL)

| Güvenilir saat T | Kademe | Bant | Not |
|---|---|---|---|
| T < P − 30 g | NORMAL | — | kira bitişi geçmiş olabilir; bulgu değildir |
| P − 30 g ≤ T < P | NORMAL | **bilgi** (`ODEME_YAKLASIYOR`): kalan gün + "internet yoksa Lisans ekranından QR/dosya ile yenileyin" | uyarı kademesi DEĞİL; görünürlük §6 S1 |
| P ≤ T < P + `ekSureGun` (30) | EK_SURE | uyarı + geri sayım | modül tavanı ve yaptırım sürer |
| T ≥ P + 30, internet YOK | KISITLI | tehlike | okuma, rapor, yeniden basım, dışa aktarma, yedek açık |
| T ≥ P + 30, internet VAR | EK_SURE (0 g) | "bağlantı sürdükçe kısıtlama yok" | kısıtlamayı satıcı getirir: taksit gecikmesi K3'ü (vade + 15 + 15 = P + 30) ya da planlı eylem |

Bakım sonu (`bakimBitis`) ve bütünlük merdiveni değişmez. İkisi de aynı ikinci anahtarı kullanır.

### 1.4 Çevrimdışı yenileme

1. **QR (var):** panel istek zarfı → telefon `/q` → satıcı → yanıt QR'ı → panel ya da tablet `POST /api/license/cevrimdisi-yanit`. Değişmez.
2. **Panel aktarması (var):** internetli bir panel makinesi satıcıya aynen iletir. Değişmez.
3. **Uzatma dosyası (yeni):** ödeme gelince portaldaki "çevrimdışı uzatma dosyası" eylemi, zincir ucuna bağlı yeni kirayı (gerekirse HAK'ı) imzalı `LicenseResponse` JSON'u olarak üretir; istek gerekmez. Müşteri dosyayı e-posta ya da USB ile taşır, Lisans ekranındaki "Lisans dosyası yükle" aynı uca yollar. Eski dosyayı geri alma kapısı reddeder (`LICENSE_LEASE_STALE`); uygulanmamış dosya kalırsa sonraki yoklama zinciri "yakala" ile birleştirir. **Ölçülecek:** `acceptOfflineResponse` (`Teks-Erp/src/services/license.service.ts`) bugün bekleyen istek aramıyor; L2-5'in ilk sondası istek-siz yanıtın kabulünü ölçer.

### 1.5 Saat modeliyle etkileşim

P, güvenilir saat T ile karşılaştırılır (`Teks-Erp/src/lib/license/saat.ts`, değişmez):

- **Alt sınır:** kira `sunucuSaati` + o kiradan beri biriken çalışma süresi (monotonik, imzalı `durum.json`). v2'de tek kira aylarca kullanılabilir; birikim de aylarca büyür (sayı sınırı sorun değil).
- **Üst eşik:** alt sınır + kapalı süre kredisi + yoklama aralığı + tolerans. Kredi yalnız tutarlı saatle yazılmış kayıttan gelir. Aylarca kapalı kalan fabrika sahte `SAAT_ILERI` görmez.
- **Saat ileri:** erken bitiş yok (T = alt sınır), `SAAT_ILERI` ÖLÇÜLEMEDİ olur. Bugün bu yalnız UYARI'da takılıyordu. v2'de belirsizlik merdivenine girer (§3).
- **Saat geri:** T = alt sınır, yani yalnız çalışma süresi sayılır. `SAAT_GERI` merdivene girer.
- **Yüksek su:** son kira sunucu saati ∨ defterlerdeki en büyük `createdAt` ∨ durum kaydı. Tahmini aşan (zehirli) yüksek su alt sınır sayılmaz; kural aynen kalır.
- **Durum kaydı silinirse:** aynı kira için sıfırdan başlatılmaz (bugünkü kural). İnternetsiz kurulumda `DURUM_DOSYASI` yeni kiraya dek sürer ve merdivene girer. Dürüst arızanın çaresi tek bir QR ya da dosya yenilemesidir.
- **Bağlanınca tespit:** aylarca sapmış saat satıcıda `ISTEK_ZAMAN` + `saticiSapmaSn` olarak görünür. v2'de bu bir "yerel müdahale şüphesi" girdisidir (§3.1-5).

### 1.6 Bilinen sınırlar (kabul edilen)

- **İnternetsiz kopya:** sanal makine ya da disk kopyası internetsiz kalırsa iki kopya da P'ye dek çalışır. Kira zinciri yalnız iki taraf bağlanınca görür. Karşılık sözleşme, parmak izi (sysprep'siz VM kopyasını yakalamaz) ve filigrandır. v1'de bu pencere ≤ 60–75 gündü, v2'de P'ye (en çok ufka) uzar.
- **Yaptırımın ulaşamaması:** K0–K5, DR devri (`devredildi`) ve kapanış kirası yalnız fabrikaya ulaşınca işler. İnternetsiz fabrika P + 30 g'e dek çalışır. Kaldıraç ödenmiş tarihtir.
- **Kapanışta saat geri alma:** makine her açılışta saati alt sınırın hemen üstüne çekerse yalnız çalışma süresi sayılır ve bulgu doğmaz. Örneğin günde 8 saat çalışan fabrika yaklaşık üç kat süre kazanır. Bedeli, bütün iş kayıtlarının tarihinin (fabrika günü, belgeler, raporlar) bozulmasıdır. Tespit yalnız bağlanınca olur (§1.5). Donanım sayacı (TPM) kapsam dışıdır.
- **Üç iz birden silinirse** (kira + durum kaydı + DB izi), kip HAK'taki alt sınırdan, o da yoksa derleme varsayılanından gelir. Faz 4'e dek derleme varsayılanı gözlemdir. Bu, plan §12'de kabul edilen "Faz 1–3 kodu okunur" sınıfıdır.

## 2. G4 — anahtar hiyerarşisi

### 2.1 Hiyerarşi

| Anahtar | `kid` | Yer | İmzaladığı | Ömür | İptal |
|---|---|---|---|---|---|
| KÖK | `kok-<yıl>-<n>` | Mac, parolalı dosya, ağdan ve VDS'ten uzakta. Şifreli yedek: kullanıcının elle yüklediği Google Drive. Parola kâğıtta | ara sertifikalar (HAK · ALT · İNDİRME · BAYİ), iptal belgesi, istisna HAK'lar (§2.6) | çapada süresiz | yalnız yeni derleme (çapa) |
| HAK ara imzacısı | `ara-<yıl>-<n>` | VDS anahtar birimi, parolalı. Parola portal formu → imza alt süreci stdin; yalnız tailnet ya da geri döngü | HAK (ufuk ≤ 400 g) | **90 g** | iptal belgesi |
| ALT | `alt-…` | VDS, 0600, parolasız (otomatik) | KİRA | **45 g** (30. günde yenisi) | iptal belgesi |
| İNDİRME | `ind-…` | VDS 0600; açık yarı Worker'da | indirme belirteci | **90 g**; Worker listesi kid × kanal × pencere | iptal belgesi + Worker listesinden çıkar |
| BAYİ | `bayi-…` | VDS, bayi parolasıyla | bayi tavanı içinde HAK | 365 g (değişmez) | iptal belgesi |
| KURULUM | `kur-…` | fabrika `LICENSE_DIR` | İSTEK, `durum.json`, kabul | — | taşıma |

**Zincir iki seviyeli olur, yalnız HAK için:** kök → ara sertifika (`kullanim: HAK`) → HAK. Kira (kök → ALT → kira) ve bayi yolu aynen kalır. Kök imzalı HAK geçerli kalır. Bütün eski HAK'lar bu yoldan doğrulanır.

### 2.2 Ara imzacı sertifikası

Yapı bugünkü `CertificateSchema`dır; yeni olan yalnız kullanım değeridir:

- `kullanim: "HAK"`, `kid` öneki `ara-`.
- `siniflar`: tören parametresi. Varsayılan URETIM · DR · DEMO · TEST; BAYI ve BARINDIRILAN yok. Kökün sınıf yetkisini aşamaz (bugünkü kural).
- `baslangic` / `bitis`: 90 g. Veriliş kuralı aynen geçerlidir: `baslangic − tol ≤ hak.verilis ≤ bitis + tol`.

Ara imzacının (ve bayinin) imzaladığı HAK için iki ek kural:
1. `cevrimdisiUfukGun` ≤ 400 olmalı; `null` olamaz (`UFUK_TAVANI_ASIMI`). Yalnız kök imzalı HAK sınırsızdır.
2. HAK, sertifikayı `imzaciSertifikasi` alanında gömülü taşır (bayi yolu bugünkü `bayiSertifikasi`yle aynı). Sertifika JWS başlığına girmez, başlık allowlist'i değişmez.

### 2.3 İptal belgesi

- **Tür:** `tekserp-iptal`, yalnız KÖK imzalar. Alanlar: `iptalId` · `sira` (tekdüze artan tam sayı) · `verilis` · `iptaller[≤256]: {kid, sertifikaId, kullanim, tarih, neden ≤200}`.
- **Etkisi:** listelenen sertifika TÜMDEN geçersizdir; çocuk belgenin verilişine bakılmaz. Pencere içine geri tarihli belge basmak iptali atlatamaz. Doğrulama `verifyCertificate`'e iptal kümesi parametresiyle girer (`SERTIFIKA_IPTAL`).
- **Dağıtım kirayla olur:** satıcı güncel iptal belgesini her `LicenseResponse`a `iptal` alanında ekler (yanıt gevşektir, eski fabrika yok sayar). Fabrika en yüksek `sira`lı belgeyi `LICENSE_DIR/iptal.jws`de ve DB izinde tutar, `sira` pinini durum kaydına yazar. Daha düşük `sira` hata değildir, yok sayılır. Dosya silinirse DB izinden geri yüklenir. İkisi de yok ama pin varsa `IPTAL_BELGESI_KAYIP` (ÖLÇÜLEMEDİ) merdivene girer; sonraki yanıt belgeyi geri getirir.
- **Satıcı kapısı:** bir HAK'ı geçersiz kılacak iptal, yeniden basılmış HAK ve kira olmadan dağıtılmaz. Aynı yanıt yeni zinciri taşır, online fabrika kesintisiz geçer. Yine de geçersiz kalan HAK `HAK_GECERSIZ` (`SERTIFIKA_IPTAL`) olur ve olağan merdivene girer. Fabrika aniden durmaz.
- İnternetsiz kuruluma iptal ulaşmaz (§1.6 ile aynı sınıf). Çalınmış ara imzacının geri tarihli HAK'ı orada sınıf kümesi ve ufuk tavanıyla sınırlanır.

### 2.4 Dönemsel kök töreni

- **Sıklık:** ayda bir, Mac'te ~15 dk, `uretim-toren.mjs` için yeni `donem` alt komutu. Önerilen düzen yılda ~3 saat tutar (§6 S4).
- **Her törende:**
  - yeni ALT (45 g);
  - gerektiğinde yeni ara imzacı (90 g; üç ayda bir) ve İNDİRME (90 g);
  - değiştiyse yeni iptal belgesi (`sira + 1`);
  - kuyrukta bekleyen kök imzalı HAK'lar (§2.6).
- Çıktı tek bir paket olarak sabit yükleme betiğiyle VDS'e gider (G1/G2 erişim modeli). Kök dosyası paketin içinde değildir.
- **Tören atlanırsa:** ALT 45. günde biter. Satıcı yeni kira basamaz ve yoklama başarısız olur. Fabrikalar P'ye dek etkilenmez; yalnız bu arada P'si dolan ve ödemesi gelen müşterinin uzatması gecikir. Zarar, ancak tören 30. günden sonra ~45 gün daha atlanırsa başlar. Satıcı portalı ALT, ara imzacı ve İNDİRME bitişini 15 gün kala bildirir (yeni `ANAHTAR_SURESI_BITIYOR`).
- **Acil durum (VDS ele geçti):** olağan dışı tören yapılır: ara imzacı, ALT ve İNDİRME iptal belgesine girer, yenileri temizlenmiş sunucuya yüklenir. Fabrikalara yeni derleme gerekmez (karar notu §2 C).

### 2.5 Veriliş sınırı, yol bağı ve küçük kalemler

- `verifyEntitlement(token, roots, {nowMs, iptal})`: `hak.verilis > nowMs + tol` ise `BELGE_ILERI_TARIHLI`. `nowMs` = max(duvar, yüksek su); güvenilir saat belgelerden türediği için döngüye girmez. Kirasız HAK'ın ek süre çapası `min(hak.verilis, şimdi)` olur.
- **İSTEK `yol`:** imzalı istek uç yolunu taşır (`/v1/yokla`…). Satıcı ve patron, alan varsa gerçek yolla eşitliğini denetler (`ISTEK_YOL`). Bütün kurulumlar yeni derlemeye geçince zorunlu olur; o adım ayrı karardır.
- **Satıcı:** KDF sınırı `openSealedKey` içinde tek kaynakta olur. Parola Buffer'ı her dalda sıfırlanır. Üretimde çapa ezmesi açılışı durdurur (G3 yaptı, doğrulanır).
- **Worker:** İNDİRME anahtar listesi kid başına izinli kanal ve geçerlilik penceresi taşır (L2-8).

### 2.6 Geçiş

1. **Şimdi (A düzeni, G4 inene dek):** kök VDS'ten kaldırılır; Mac ve Drive kopyaları doğrulandıktan SONRA. HAK imzası gerekince kök dosyası yalnız imza oturumunda VDS'e konur, oturum bitince silinir.
   - Kod okuması: kök yokken yalnız HAK imzası 500 döner, kira ve indirme sürer (satıcı `entitlement.service.ts`). Hazırlıkta ölçülür.
2. **G4 satıcıya inince:** ara imzacılı yetenek bildiren kuruluma (`yetenekler ∋ "hak-ara"`) HAK ara imzacıyla basılır. Yetenek bildirmeyen eski derlemenin HAK değişikliği **"kök imzası bekliyor"** kuyruğuna girer ve sonraki dönemsel törende Mac'te imzalanır. Kök bir daha VDS'e gitmez.
3. **Eski HAK'lar** (kökle imzalı v1) süresiz geçerli kalır; kök çapada durur. Yeni alanlar bir sonraki HAK sürümüyle gelir. Yetenekli kurulumlar için portalda toplu "yeni biçimde yeniden bas" eylemi olur (tek parola).
4. **Eski derlemeler** iptal belgesini görmez. İptal edilen ALT'ın kirasını eski derleme kabul etmeye devam eder. Bu derlemeler yalnız bizim test ve demo kurulumlarımızdadır (karar notu §2); kabul edilen risktir ve yeni derlemeye geçişle kapanır.
5. Hazırlık ortamı aynı akışı hazırlık köküyle provalar: TEST/DEMO ara imzacısı, aynı tören.

### 2.7 VDS'te kalanlar

| Durur | Durmaz |
|---|---|
| ara imzacı (parolalı) · ALT · İNDİRME · bayi anahtarları · sunucu sırları · güncel iptal belgesi · kök AÇIK yarısı (çapa) | kök özel yarısı (G4'ten sonra imza anında bile) · PAKET özel yarısı (Mac) · kök parolası |

## 3. G12 — belirsizlik merdiveni

### 3.1 Kurallar (karar ④'ün uygulanabilir hâli)

1. **Depo sorunu yalnız imzayı durdurur.** `hazir` ikiye ayrılır:
   - `imzaHazir`: kurulum anahtarı okunuyor.
   - `durumHazir`: HAK ve kira gömülü çapayla doğrulanabiliyor.

   Kapı, modül tavanı ve yaptırım `durumHazir`a bakar. Anahtar okunamazsa yoklama ve durum kaydı yazımı durur; `DEPO_OKUNAMADI` merdivene girer, kararlar uygulanmaya devam eder.
2. **HAK doğrulanabildikçe modül tavanı uygulanır.** Saat ve durum kaydı belirsizliği tavanı kaldırmaz. `production.enabled` her hâlde açıktır (`CEKIRDEK_MODULLER`). HAK etkin kurulumda doğrulanamazsa **son bilinen tavan** uygulanır: durum kaydındaki HAK pinine eklenen `moduller`, o da yoksa DB izi. Hiçbiri yoksa ham değer kullanılır.
3. **Süren ölçülemedi çalışma süresiyle birikir.** ÖLÇÜLEMEDİ geçen çalışma süresi `belirsizlikMs` olarak durum kaydında ve DB izinde birikir; büyük olan geçerlidir.
   - 14 g → `BELIRSIZLIK_SURUYOR` (UYARI) → 30 g EK_SURE → KISITLI.
   - Birikim YALNIZ yeni kira kabulünde sıfırlanır (bütünlük çapası emsali); aç-kapa sıfırlamaz.
   - İnternet varken (§1.2) süre dolması kısıtlı getirmez.
4. **Kira ve durum kaydı birlikte yoksa bulgudur.** Etkinleşmiş kurulumda `LISANS_IZI_KAYIP` (ÖLÇÜLEMEDİ) yazılır. Birikim (çapa U) durum kaydından, o yoksa DB izinden okunur. İkisi de yoksa birikim, imzalı en eski olgudan (HAK verilişi; HAK da yoksa DB ilk açılışı) bu yana geçen güvenilir süre sayılır: silmek merdiveni yalnız öne alır (§6 S7).
   - Kip: kira → durum kaydı → DB izi → derleme varsayılanı. **HAK'taki `kipAltSiniri: "zorla"` her zaman alt sınırdır.**
5. **Yoklama birikimi taşır.** `belirsizlik` ve `durumKaydi` blokları gider. Satıcı şu durumlarda `YEREL_MUDAHALE` uyarısı ve `YEREL_MUDAHALE_SUPHESI` bildirimi açar:
   - durum kaydı `sira`sı geriledi ya da sıfırlandı;
   - `LISANS_IZI_KAYIP` var;
   - belirsizlik 7 günü aştı;
   - saat sapması büyük.

   Yalnız uyarıdır; kira reddi doğurmaz.

**DB izi:** fabrika DB'sinde ayrılmış bir sistem ayarıdır (`license.trace`; panelden ve `PUT /api/admin/settings`ten yazılamaz, `system.installationId` emsali). İçeriği: `{kurulumId, hakId, kipAltSiniri, moduller, belirsizlikIlk, belirsizlikMs, sonDurumSirasi, iptal (JWS)}`. Belirsizlik sürerken saatte bir, aksi hâlde yalnız değişimde yazılır. Lisans kimliğiyle anahtarlıdır; DB kopyası başka kuruluma taşınırsa yok sayılır. Silinemez değildir, savunma derinliğidir. Silinemeyen alt sınır HAK'tadır: HAK'ı silen şifreli modüllerini de (Faz 2d) kaybeder.

### 3.2 Durum ve geçiş tablosu

Girdiler:
- **İnternet:** §1.2'deki tanım.
- **Dosya SAĞLAM:** kira kullanılabilir (geçerli, bağlı, geri alınmamış) ve durum kaydı geçerli.
- **HAK ✓:** imza, kurulum bağı ve iptal denetiminden geçti.

**Gözlem kipi (bütün satırlar):** her şey hesaplanır ve yoklamayla raporlanır. Uygulanan etki NORMAL, bant yok, tavan yok, merdiven yok (sıfır fark). Aşağıdaki tablo `zorla` kipi içindir.

| # | İnternet | Dosya | HAK | Süre çapası | Kademe yolu | Modül tavanı | Yaptırım kaynağı |
|---|---|---|---|---|---|---|---|
| Z1 | VAR | sağlam | ✓ | P | NORMAL → (bilgi bandı, S1) → EK_SURE → EK_SURE(0); kısıtlı yalnız satıcı kararıyla | HAK | kira |
| Z2 | YOK | sağlam | ✓ | P | NORMAL → bilgi bandı → EK_SURE 30 → KISITLI | HAK | kira (donuk) |
| Z3 | VAR | bozuk | ✓ | — | geçici: sonraki başarılı yoklama yeni kira getirir (Z1); yoklama düşerse Z4 | HAK | durum kaydı → DB izi |
| Z4 | YOK | bozuk | ✓ | U | UYARI 14 g (çalışma) → EK_SURE 30 → KISITLI; bağlanınca yerel müdahale bildirimi | HAK | durum kaydı → DB izi → yok |
| Z5 | VAR | sağlam | ✗ | eski çapa (kira bitişi) | UYARI; satıcı yanıtta HAK'ı yeniden verir (yoklama `hak: null` bildirir) → Z1 | son bilinen | kira |
| Z6 | YOK | sağlam | ✗ | eski çapa (ufuk bilinmez) | UYARI → kira bitişi → EK_SURE 30 → KISITLI | son bilinen | kira |
| Z7 | VAR | bozuk | ✗ | — | yanıt HAK ve kira getirir → Z1 | son bilinen | durum kaydı → DB izi |
| Z8 | YOK | bozuk | ✗ | U, yoksa DB ilk açılışı | UYARI 14 → EK_SURE 30 → KISITLI | son bilinen, yoksa ham (üretim açık) | durum kaydı → DB izi |
| Z9 | (imza yok) | anahtar okunamaz | ✓/✗ | Z2/Z4/Z6/Z8 ile aynı | `DEPO_OKUNAMADI` merdivene girer; yoklama yapılamaz (İnternet YOK sayılır) | Z2…Z8'deki gibi | aynı |

Her satırda yaptırım (K3 tarihi, K4, K5, `devredildi`) tek anahtarlıdır ve kalıcıdır (bugünkü kural). Ek süre ve belirsizlik bu kararları gevşetmez.

### 3.3 Etkinleşmemiş kurulum ve ikincil kalemler

- **Etkinleşmemiş kurulum:** `zorla` derlemesinde (Faz 4 sonrası) ilk açılış + 30 g sonra KISITLI'ya iner, çünkü ikinci anahtar artık "başarılı alışveriş yok"tur. Plan §4'ün niyeti budur; bugünkü kod bunu hiç uygulamıyordu (§6 S3).
- **Rapor §6'nın ikincil kalemleri G12 dilimine girer:**
  - native çağrı istisnası "çekirdek yok" sonucuna döner;
  - modül bağımlılığı tavan katmanında uygulanır;
  - imza listesindeki okunamayan dosya zorunlu kipte "değişmiş" sayılır.
- **Parmak izi:** "değeri olan etkenin kaybolması uyuşmazlıktır" kuralı ÇEKİRDEK bir kuralı değiştirir. Bu yüzden yalnız onayla girer (§6 S8).
- **Faz 4 sırası:** G12 iner → testfabrika'da `zorla` ölçümü (yanlış pozitif 0) → Faz 4. Bu dilimler inmeden varsayılan `zorla` açılmaz.

## 4. Protokol değişiklikleri

### 4.1 Alanlar (hepsi isteğe bağlı; `v` artmaz)

| Belge / gövde | Ekleme | Eski doğrulayıcı (TS + native) ne yapar |
|---|---|---|
| SERTİFİKA | `kullanim: "HAK"`, `kid` öneki `ara-` | enum dışı değer: `BELGE_SEMA`. Eski kurulum bu sertifikayı ancak HAK içinde görür ve o HAK'ı zaten `KOK_BILINMIYOR` ile reddeder. Bu yüzden yalnız yetenekli kuruluma gider |
| HAK | `imzaciSertifikasi?` (JWS) | alanı okumaz → `KOK_BILINMIYOR` (yalnız yetenekli kuruluma) |
| HAK | `cevrimdisiUfukGun?` (1–1830 \| null) · `kipAltSiniri?` (`"zorla"`) | tanımadığı alanı atar (TS `z.object`, native `strict=false`) |
| KİRA | `odenmisTarih?` (ISO \| null) | atar; eski çapa (kira bitişi, vade) sürer |
| İPTAL (yeni `typ`) | §2.3 | hiç görmez |
| İSTEK | `yol?` | eski satıcı atar (`RequestSchema` gevşek) |
| `PollRequestSchema` · `ActivateRequestSchema` (KATI) | `yetenekler?: string[] ≤ 16` · `belirsizlik?` · `durumKaydi?` | eski satıcı `GOVDE_GECERSIZ` (400) döner ⇒ **satıcı fabrikadan ÖNCE** yayınlanır (bugünkü kural) |
| `LicenseResponseSchema` (gevşek) | `iptal?` (JWS) | eski fabrika atar |
| Doğrulama arayüzü | `verifyEntitlement(…, {nowMs, iptal})` · `verifyCertificate(…, iptal)` · `verifyRevocation` | — (native ABI değişir, §4.3) |
| Hata kodları | `SERTIFIKA_IPTAL` · `BELGE_ILERI_TARIHLI` · `UFUK_TAVANI_ASIMI` · `ISTEK_YOL` | kod eklemek kırıcı değildir (protokol §9) |

**`v` neden artmıyor?** Protokol §9'a göre anlam daraltan alan `v`yi artırır. Bu tasarımda daraltan alan (`kipAltSiniri`, ara imzacı zinciri) yalnız `yetenekler` bildiren kuruluma gider; satıcı kapısı yeteneksiz kuruluma kök imzalı ve yeni alansız HAK basar. Eski doğrulayıcının yok sayacağı her alan ise ya bilgidir (`yol`, `iptal`) ya da yalnız GENİŞLETİR (`odenmisTarih`); yok sayılınca eski, daha sıkı davranış sürer.

### 4.2 Uyumluluk yönleri

| Yön | Ne olur |
|---|---|
| Yeni satıcı ↔ eski fabrika | HAK kök imzalı ve yeni alansız kalır (değişiklik kuyrukta, törende imzalanır). Kira yeni alanları taşır, eski fabrika atar: bugünkü ~60–75 g internetsiz zarf. İptal belgesi yok sayılır (§2.6-4) |
| Eski satıcı ↔ yeni fabrika | yasak sıra. Olursa yoklama 400 alır; kira `odenmisTarih` taşımadığından eski çapa işler, davranış bugünkü gibidir |
| Yeni fabrika + v1 belge | eski çapa. Yeni kurallardan yalnız merdiven ve ikinci anahtar işler; gözlemde sıfır fark |
| Yeni fabrika + v2 belge | P çapası, iptal, ufuk, kip alt sınırı |
| Panel / tablet (eski) | `detay`'ın yeni alanlarını (`odenmisTarih`, `belirsizlik`, imzacı zinciri) yok sayar. Bant metni backend'den gelir, değişmeden gösterilir. Yeni neden kodları ham kod olarak görünür; Electron `labels.ts` sözlüğü L2-5'te güncellenir |
| Patron sunucusu | ayna güncellenir; `yol` taşıyan eşitleme isteğinde yolu denetler |
| CF Worker | yeni İNDİRME listesi biçimi; eski biçim bir sürüm daha tanınır (L2-8) |

### 4.3 Test vektörü etkisi

- **TS kâhin** (`test_lisans_native_kahin`, `--vektor-yaz`) yeni vektör aileleri alır:
  - ara imzacı zinciri: geçerli · sınıf dışı · pencere dışı veriliş · iptalli · ufuk aşımı · `null` ufuk;
  - iptal belgesi: imza · şema · düşük `sira`;
  - ileri tarihli veriliş (`nowMs`);
  - yeni HAK ve kira alanlarının şema çıktısında KORUNDUĞU (atılmadığı) vektör;
  - İSTEK `yol`.

  Gömülü çapa vektörleri G3'ün `kiplere()` yardımcısıyla iki kipe çoğaltılır.
- **Rust:**
  - `schema.rs`: yeni alanlar, `CERT_USAGES`, `tekserp-iptal`;
  - `chain.rs`: iki seviyeli HAK zinciri, iptal kümesi, `nowMs`;
  - `api.rs` ve napi imzaları;
  - `tests/vektorler.rs` yeniden üretilen dosyayla.
- **ABI:** G3 ABI'yi 3'e çıkardı. G3 ve G4 aynı derlemeye bindiği için G4 de **ABI 3** altında birleşir (kural: yayınlanmamış değişiklik tek ABI numarası). G3 G4'ten önce yayınlanırsa ABI 4 olur. `VEKTOR_BICIMI` aynı ilkeyle yönetilir. Vektörler birleşimden sonra yeniden üretilir.
- **Aynalar:** protokol klasöründe değişen dosyalar satıcı ve patron aynasına bayt-eşit kopyalanır (`test_lisans_protokol_aynasi`, patron `test_patron_kapilari` §7a). G13 aynı dalgadadır ve native ABI'yi paylaşır; iki dal tek ABI numarasında buluşur.

## 5. Uygulama dilimleri

Bağımlılık: **L2-0 (cevaplar) · G3 main'de → L2-1 → (L2-2 ‖ L2-3 ‖ L2-4 ‖ L2-5) → L2-6 · L2-7 · L2-8 → L2-9**. Geliştirme paralel, YAYIN sırası: satıcı → fabrika → istemci. Süreler ajan-günüdür, tahmindir (ölçülmedi). Her dilim kendi worktree'sinde, kendi `_test` DB'siyle; yalnız hedefli bekçiler koşulur, tam paket inişte bir kez.

| # | Dilim | Ana dosyalar | Bekçiler (yeni + mevcut) | Süre |
|---|---|---|---|---|
| L2-0 | Alt kararlar + kural uyumu | bu belge, `docs/kurallar/lisans.md`, arşiv notu, protokol belgesi | `check-docs` | 0,5 |
| L2-1 | Protokol (TS tek kaynak) | `protocol/belgeler.ts` · `anahtar-zinciri.ts` · `uclar.ts` · `istek.ts` · `ortak.ts` + satıcı/patron aynası | `test_lisans_protokol` (yeni bölümler: ara zincir, iptal, ufuk, `yol`, ileri tarih) · `test_lisans_protokol_aynasi` · `test_lisans_yoklama_allowlist` (beyan kümesi) | 2–3 |
| L2-2 | Native ayna | `chain.rs` · `schema.rs` · `api.rs` · `napi_api.rs` · vektör dosyası | `test_lisans_native_kahin` · cargo `vektorler.rs` · `test_guven_capasi_ekle` | 2 |
| L2-3 | Satıcı: ara imzacı, tören, iptal | `keys/key-store.ts` · `keys/signing-scope.ts` · `keys/signer.ts` · `scripts/anahtar.ts` (`ara-uret`, `iptal-uret`) · `deploy/satici/uretim-toren.mjs donem` · `entitlement.service.ts` (yetenek kapısı + kök kuyruğu) · iptal defteri (ekleyen migration) | yeni `test_ara_imzaci` · yeni `test_iptal_belgesi` · `test_imza_parolasi` · `test_uretim_toren` · `test_kok_parola_argv` · `test_erisim_kapisi` (yeni imza rotası ERİŞİM'e giremez) | 3–4 |
| L2-4 | Satıcı: ödenmiş tarih, kapanış kirası, yerel müdahale | `lease.service.ts` · yeni `odenmisTarihi` yardımcısı · `sanction.service.ts` · `renewal.service.ts` + `lease-chain.ts` (kapanış kirası) · portal uzatma dosyası · `Kurulum.yetenekler` / `sonDurumSirasi` + iki enum değeri (reçeteli) · `satici/web` görünüm | yeni `test_odenmis_tarih` · `test_kira_zinciri` (kapanış kirası, yerel müdahale) · `test_yaptirim_kira` · `test_planli_eylem_taksit` · `test_portal_taksit_planli` · `test_bildirim_tarama` · `test_qr_sayfasi` · web `mirrors.test.ts` | 3–4 |
| L2-5 | Fabrika: P modeli | `Teks-Erp/src/lib/license/state-rules.ts` (çapa v2, `ODEME_YAKLASIYOR`, ikinci anahtar) · `Teks-Erp/src/lib/license/state.ts` · `Teks-Erp/src/services/license.service.ts` (`detay`) · Electron Lisans ekranı (`LicenseLeaseCard`, `labels.ts`, dosya yükle) | `test_lisans_durumu` (yeni: P, bilgi bandı, iki anahtar v2, eski belgeyle sıfır fark) · `test_lisans_motoru` (istek-siz dosya kabulü) · Electron `licenseService.test.ts` | 2 |
| L2-6 | Fabrika: G12 merdiveni | `store.ts` · `runtime.ts` (`imzaHazir`/`durumHazir`) · `module-ceiling.ts` · `accumulation.ts` + `saat.ts` (belirsizlik birikimi, HAK pini `moduller`) · DB izi (ayrılmış ayar) · `license.middleware.ts` · `native-adapter.ts` · yoklama gövdesi | `test_lisans_durumu` · `test_lisans_motoru` · `test_lisans_kapisi` · `test_lisans_modul_tavani` · `test_lisans_butunluk` · `test_audit_muafiyeti` · `test_lisans_yoklama_allowlist` | 4–5 |
| L2-7 | Fabrika: G4 tüketimi | iptal deposu + pin · `verifyEntitlement` `nowMs` · istekte `yetenekler` ve `yol` · `detay`'da imzacı zinciri | `test_lisans_motoru` · `test_lisans_protokol` · `test_lisans_native_kahin` | 1–2 |
| L2-8 | Worker İNDİRME listesi | `deploy/guncelleme-sunucusu/worker/indirme-kapisi.js` · `protocol/indirme.ts` kâhini | `test_indirme_kapisi` | 1 |
| L2-9 | Entegrasyon + Senaryo L | L31'den başlayan senaryolar: internetsiz 400 g (saat ilerletme) · dosya silme üçlüsü · uzatma dosyası · iptal turu · tören atlanması · kapanış kirası | `senaryo-ly.ts` · tam paket (bir kez) | 2 |

Toplam ~22–26 ajan-günü; paralel yürütmede takvimde ~2–2,5 hafta. G13 (paket bütünlüğü) aynı dalgada ayrı dilimdir; native ABI'yi paylaşır.

### 5.1 Canlıya çıkış sırası (takvim kapısı yok; her adımın kapısı ölçüm ya da kullanıcı cümlesidir)

1. **A düzeni (şimdi):** kök VDS'ten kaldırılır; kopyalar doğrulanınca, kullanıcının "uygula" cümlesiyle.
2. **Satıcı hazırlık** (`lisans-test`): L2-3 · L2-4 · L2-1 aynası. Hazırlık kökünün ara imzacı töreni.
3. **testfabrika** (hazırlık çapası, thinkpad-1): L2-5…L2-7 derlemesi. Uçtan uca senaryolar (internetli · internetsiz · QR · dosya · üçlü silme · iptal · tören atlanması) önce gözlemde, sonra `zorla`da (yanlış pozitif 0).
4. **İlk üretim dönemsel töreni** (Mac): ara imzacı · ALT 45 · İNDİRME 90 · iptal `sira` 1 → üretim satıcısının yeni sürümü.
5. **demofabrika** (üretim çapası, DEMO): yeni derleme.
6. **adnansahin:** yalnız kullanıcı cümlesiyle (Faz 4 sırası: gözlem → ölçüm → `zorla`).

## 6. Açık sorular (sohbette sırayla, şıklı sorulacak)

- **S1 — Hatırlatma bandının görünürlüğü.** Aylık taksitte sıradaki vade hep 30 günün içinde kalır, bant sürekli açık olur.
  - (A) Bant yalnız bağlantısızken (son başarılı alışveriş 7 günden eski) ya da P sözleşme sonuyken görünür. **Önerilen.**
  - (B) Her zaman son 30 gün.
  - (C) Son 30 gün, ama taksit aralığının yarısıyla sınırlı.
- **S2 — 400 günü aşan ya da süresiz ufuk** (tamamen internetsiz kalıcı müşteri, çok yıllık peşin sözleşme).
  - (A) Yalnız kök imzalı HAK'ta, dönemsel törende. **Önerilen.**
  - (B) Ara imzacı da verebilir. VDS ele geçerse süresiz korsan lisans üretilebilir.
  - (C) Uzun ufuk yok; yılda bir QR ya da dosya yenilemesi.
- **S3 — İkinci anahtar "son 24 saatte başarılı alışveriş yok" olsun mu?** Satıcı adresi kapalı olan ve etkinleşmemiş kurulum da `zorla` derlemesinde merdivene girer.
  - (A) Evet. **Önerilen.**
  - (B) Evet, ama etkinleşmemiş kurulum muaf olsun.
- **S4 — Tören sıklığı.**
  - (A) Aylık: ALT 45 g, ara imzacı ve İNDİRME 90 g; yılda ~3 saat. **Önerilen.**
  - (B) Üç ayda bir: ALT 120 g, ara imzacı ve İNDİRME 180 g. Sızıntı penceresi üç kat büyür.
- **S5 — Taksitte P.**
  - (A) Sıradaki vade; karara harfiyen uyar, ek süre 30 g. **Önerilen.**
  - (B) Vade + `uzatmaGun`; bugünkü geçerlilik bitişi, 15 g daha geç.
- **S6 — Kopya şüphesinin ikinci penceresi ve taşınan eski anahtar.**
  - (A) İmzalı kapanış kirası: K3, ek süre kadar gün sonra kısıtlı. **Önerilen.**
  - (B) Bugünkü gibi kira verilmez. v2'de o taraf P'ye dek çalışır.
- **S7 — Kira, durum kaydı ve DB izi üçü birden yoksa.**
  - (A) Çapa imzalı en eski olgudur, merdiven hemen ilerler. **Önerilen.**
  - (B) Yine 14 gün. Dürüst arızaya eşit davranır, ama tekrarlanan silme merdiveni sıfırlar.
- **S8 — Parmak izinde "değeri olan etkenin kaybolması uyuşmazlıktır"** (bugünkü ÇEKİRDEK kuralı değiştirir).
  - (A) G12 dalgasında, testfabrika ölçümünden sonra.
  - (B) Ertelensin; v2'nin kapsamı dışında kalır. **Önerilen.**

## 7. Kural uyumu (dilimlerle birlikte; bu belge kural yazmaz)

- **`docs/kurallar/lisans.md` değişmezleri:** "aniden durdurmaz" merdivenine P, bilgi bandı ve 14 günlük belirsizlik girer · "Ek süre İMZALI tarihten türer"in v2 çapası P olur · "iki anahtarlı" kuralının ikinci anahtarı yeniden tanımlanır · "tavanın fail-open'ı yalnız belirsizlik içindir" ile "Modül tavanı YALNIZ kullanılabilir bir HAK varken" §3.1-2'yle değişir · güven çapası satırına ara imzacı girer.
- **Kararlar ve yasaklar:** kira zincirinin (c) maddesi kapanış kirası olur (S6) · kök parolası satırına "kök VDS'te durmaz; ara imzacı parolası aynı stdin kuralına tabi" eklenir.
- **Protokol belgesi:** §2'deki "tek seviye" ve §11'deki iki bilinen sınır.
- **Plan:** §3 tablosu (kök VDS'te, ALT 180 g) ve §12'deki "kök VDS'te" riski arşivde GEÇERSİZ işaretlenir; §4'teki "çevrimdışı kopya ≤ 60 gün" zarfının yerini §1.6 alır.
