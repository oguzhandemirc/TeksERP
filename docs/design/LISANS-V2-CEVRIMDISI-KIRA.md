# Lisans v2 — çevrimdışı kira, çevrimdışı kök, belirsizlik merdiveni

> **Durum:** TASARIM — kararlar verildi (2026-10-01, §6). Kod yazılmadı.
> **Bağlayıcı kararlar:** kullanıcı, 2026-10-01. Dört temel madde: ① internet kesintisi lisansı kısaltmaz · ② lisans dosyası bozulur ya da silinirse 14 gün uyarı, sonra ek süre, sonra kısıtlı · ③ kök çevrimdışı, VDS'te süreli/sınıflı/iptal edilebilir HAK ara imzacısı (G4) · ④ kural içinde sıkılaştırma (G12). Bunlara ek olarak §6'daki sekiz alt karar (K1–K8).
> **Kaynak:** güvenlik denetimi G4 · G12 (G13 yalnız sınır olarak) ve karar notu §2 · §4. Açık ayrıntısı bu belgeye alınmadı.
> **Üst belge:** [LISANS-PROTOKOLU.md](LISANS-PROTOKOLU.md) (v:1). Bu belge onun EKİDİR. Kod inince protokol belgesi ve `docs/kurallar/lisans.md` güncellenir (§7), bu belge tarihçe olarak kalır.
> **Önkoşul:** G3 (çapanın `uretim`/`hazirlik` kipleri, native ABI 3). G3 iniş dalı `inis/guvenlik-g` üzerinden main'e inmiş olmalı.

## 0. Özet

| Konu | Bugün (v1) | v2 |
|---|---|---|
| İnternetsiz çalışma | kira ömrü (≤ 45 g) + ek süre (30 g) ⇒ ~60–75 gün | **ödenmiş tarihe (P) dek** tam çalışır. P'den sonra 30 g ek süre, sonra kısıtlı. P−30 g bilgi bandı yalnız internetsizken ya da P sözleşme sonuyken çıkar |
| Kira bitişi | ek süre çapası | yalnız TAZELİK bilgisi (yaptırım, sürüm, belirteç); çapa değil |
| Lisans dosyası silinir/bozulur | çapa HAK verilişi + 30 g; kira ve durum birlikte silinirse kip gözleme düşer | 14 g UYARI (çalışma süresi) → 30 g EK_SURE → KISITLI. Üç iz birden silinirse hemen EK_SURE. Kip alt sınırı HAK'ta. Satıcıya "yerel müdahale şüphesi" gider |
| Kök anahtar | VDS'te parolalı; bütün HAK'ları ve sertifikaları imzalar; süresiz, iptalsiz | Mac'te çevrimdışı. Üç ayda bir törende ara sertifikaları, iptal belgesini ve eski derleme HAK'larını imzalar |
| HAK imzacısı | kök (ya da bayi) | VDS'te **ara imzacı**: 120 g, sınıflı, iptal edilebilir; portal bugünkü gibi çalışır. Süresiz ufuk verebilir; bu bilinçli kabul edilen bir risktir (K2) |
| ALT / İNDİRME | 180 g / 365 g, iptalsiz | 120 g / 120 g (üç aylık tören + 30 g örtüşme), iptal belgesiyle |
| Belirsizlik (ölçülemedi) | yalnız UYARI; modül tavanını kaldırır | çalışma süresiyle birikir: 14 g → EK_SURE → KISITLI; tavan HAK'tan sürer |
| Parmak izi | okunamayan etken sayılmaz; ≥ 3 eşleşme yeter | etken birden çok yoldan okunur. 24 saat okunamayan etken "kayıp" sayılır ve uyuşmazlıktır. Eşik: ≥ 3 eşleşme ve güçlü etkenlerden ≥ 2. Eşiğin altı: 14 g → EK_SURE → KISITLI. Zayıf tanınan kurulum satıcı onayıyla etkinleşir |

Gerekçe: endüstriyel yazılımlarda internetsiz tesis için makineye bağlı lisans, süre sonuna dek geçerlidir. Ödeme kaldıracı kiranın tazeliğinden ödenmiş tarihe taşınır.

## 1. Kira modeli v2

### 1.1 Ödenmiş tarih (P)

P, satıcının imzaladığı "bu kurulumun ödemesi şu tarihe dek yapıldı" beyanıdır. Satıcıda tek kaynağı vardır: `odenmisTarihi(hak, aktifTaksitPlani)` yardımcısı (`cloud-entitlement.ts` emsali). Bugün satıcıda böyle bir kolon yok; değer aşağıdaki gibi türetilir.

| Müşteri | P | Bugünkü `gecerlilikBitis` (eski derlemeler için aynen sürer) |
|---|---|---|
| Peşin, vadeli | sözleşme sonu | aynı tarih |
| Taksitli | sıradaki ödenmemiş taksitin vadesi (K5) | vade + `uzatmaGun` (15) |
| Demo | demo bitişi | aynı |
| Kalıcı, ödemesi tamam | `null` (süresiz) | `null` |

**Formül** (fabrika tarafı, saf `state-rules.ts`):

```
ufukSonu = hak.cevrimdisiUfukGun === null ? +∞ : kira.verilis + hak.cevrimdisiUfukGun gün
P        = min( kira.odenmisTarih ?? +∞ , ufukSonu )
```

- **v2 koşulu:** P yalnız kullanılabilir kira `odenmisTarih` alanını, ona bağlı kullanılabilir HAK da `cevrimdisiUfukGun` alanını taşıyorsa kullanılır. Biri yoksa bugünkü çapa (`min(kira.bitis, gecerlilikBitis)`) aynen uygulanır. Böylece yeni derleme eski belgelerle bugünkü gibi davranır.
- **Ufuk HAK'tadır, kirada değil.** Kirayı VDS'teki parolasız ALT imzalar; ufku ise HAK'ı imzalayan parolalı anahtar verir. Bu yüzden çalınan ALT, P'yi en çok ufuk kadar ileri yazabilir.
  - Ufku ara imzacı ya da kök verir. Varsayılan 400 gündür.
  - 400 günü aşan ya da süresiz ufuk ara imzacıyla da verilebilir (K2). Önlemleri §2.2'de.
  - Bayi en çok 400 gün verebilir.
  - DEMO ve TEST sınıflarında ufuk en çok 45 gündür.
- **HAK silinir ya da doğrulanamazsa** ufuk bilinmez. P uzatılmaz, eski çapaya (kira bitişi) düşülür. Silmek süreyi yalnız KISALTIR.

### 1.2 Yoklamanın rolü

Yoklama artık süreyi tazelemek için gerekmez; kararları taşır.

| Taşıdığı | v2'de anlamı |
|---|---|
| Ödeme uzatması | yeni kira yeni `odenmisTarih` taşır; internetsiz kurulumda QR ya da dosyayla (§1.4) |
| Yaptırım K0–K5, dondurulan modül, `devredildi` | bugünkü gibi; yalnız fabrikaya ulaşınca işler (§1.6) |
| Kopya zinciri | bugünkü üç hâl aynen kalır (yakala · tekrar · çatal). Değişen tek şey ikinci penceredir; ayrıntı aşağıda (K6) |
| Parmak izi öğrenme | meşru donanım değişikliğini satıcı yoklamayla öğrenir (§3.1-6) |
| Kanal güncel sürümü, indirme belirteci, modül anahtarları, destek yanıtları | bugünkü gibi |
| İptal belgesi (§2.3) | yeni |
| Durum özeti | yeni `belirsizlik`, `durumKaydi` ve `parmakIziKayip` alanları; satıcı bunlarla yerel müdahale şüphesini tespit eder |

**Kopya zinciri, ikinci pencere (K6):** v1'de eşleşmeyen tarafa kira verilmiyordu. v2'de bu etkisizdir, çünkü o taraf P'ye dek çalışmaya devam eder. Bunun yerine eşleşmeyen tarafa **imzalı kapanış kirası** gider: K3, `kisitlamaTarihi = şimdi + ekSureGun`. Taşınan eski anahtar ve iptal edilen kurulum da aynı kapanış kirasını alır. İmzasız 403 hiçbir süreyi kısaltmaz; kısaltsaydı araya giren biri fabrikayı durdurabilirdi.

**"İnternet VAR" tanımı:** son kabul edilen kiranın `sunucuSaati`, güvenilir saate göre 24 saatten yenidir. Bu kaynak imzalı ve kalıcıdır; bellekteki yoklama sinyali ise yeniden başlatmada sıfırlanırdı. QR ya da dosyayla gelen kira da sayılır.

**İkinci anahtar (K3):** zamanın getirdiği KISITLI iki anahtarlıdır. Birinci anahtar sürenin dolmasıdır. İkinci anahtar artık "son 24 saatte başarısız deneme VAR" değil, **"son 24 saatte başarılı kira alışverişi YOK"**tur. Bu sayede satıcı adresi `kapali` olan kurulum, internetsiz kurulum ve etkinleşmemiş kurulum da merdivene girer. İnternet varken kademeyi yine yalnız satıcı kararı düşürür.

### 1.3 Zaman çizelgesi

Tablo `zorla` kipi içindir. Gözlem kipinde hepsi yalnız hesaplanır, uygulanan kademe NORMAL kalır.

| Güvenilir saat T | Kademe | Bant | Not |
|---|---|---|---|
| T < P − 30 g | NORMAL | — | kira bitişi geçmiş olabilir; bu bir bulgu değildir |
| P − 30 g ≤ T < P | NORMAL | **bilgi** (`ODEME_YAKLASIYOR`) | bant yalnız internetsizken (son başarılı alışveriş 7 günden eski) ya da P sözleşme sonuyken görünür (K1). Metin: kalan gün + "Lisans ekranından QR/dosya ile yenileyin". Uyarı kademesi DEĞİLDİR |
| P ≤ T < P + `ekSureGun` (30) | EK_SURE | uyarı + geri sayım | modül tavanı ve yaptırım sürer |
| T ≥ P + 30, internet YOK | KISITLI | tehlike | okuma, rapor, yeniden basım, dışa aktarma ve yedek açık kalır |
| T ≥ P + 30, internet VAR | EK_SURE (0 g) | "bağlantı sürdükçe kısıtlama yok" | kısıtlamayı satıcı getirir: taksit gecikmesi K3'ü (vade + 15 + 15 = P + 30) ya da planlı eylem |

Bakım sonu ve bütünlük merdiveni değişmez; ikisi de aynı ikinci anahtarı kullanır.

### 1.4 Çevrimdışı yenileme

1. **QR (var, değişmez):** panel istek zarfı → telefon `/q` → satıcı → yanıt QR'ı → `POST /api/license/cevrimdisi-yanit`.
2. **Panel aktarması (var, değişmez).**
3. **Uzatma dosyası (yeni):**
   - Portaldaki "çevrimdışı uzatma dosyası" eylemi, zincir ucuna bağlı yeni kirayı (gerekirse HAK'ı) imzalı `LicenseResponse` JSON'u olarak üretir. İstek gerekmez.
   - Müşteri dosyayı e-posta ya da USB ile taşır; Lisans ekranındaki "Lisans dosyası yükle" düğmesi aynı uca yollar.
   - Eski dosyayı geri alma kapısı reddeder (`LICENSE_LEASE_STALE`).
   - **Ölçülecek:** `acceptOfflineResponse` (`Teks-Erp/src/services/license.service.ts`) bugün bekleyen istek aramıyor. L2-5'in ilk sondası istek-siz yanıtın kabul edildiğini ölçer.

### 1.5 Saat modeliyle etkileşim

P, güvenilir saat T ile karşılaştırılır (`Teks-Erp/src/lib/license/saat.ts`; saat modeli değişmez).

- **Alt sınır:** kira `sunucuSaati` + o kiradan beri biriken çalışma süresi (imzalı `durum.json`). v2'de tek kira aylarca kullanılabilir, birikim de aylarca büyür.
- **Üst eşik:** alt sınır + kapalı süre kredisi + yoklama aralığı + tolerans. Kredi yalnız tutarlı saatle yazılmış kayıttan gelir; aylarca kapalı kalan fabrika sahte `SAAT_ILERI` görmez.
- **Saat ileri ya da geri:** erken bitiş yoktur. Güvenilir saat alt sınıra tutturulur, yani yalnız çalışma süresi sayılır. `SAAT_ILERI` ve `SAAT_GERI` ÖLÇÜLEMEDİ bulgusudur ve belirsizlik merdivenine girer (§3.1-3). Bugün bu bulgular yalnız UYARI'da takılıyordu.
- **Yüksek su:** zehirli yüksek su (tahmini aşan değer) alt sınır sayılmaz; bu kural aynen kalır.
- **Durum kaydı silinirse:** aynı kira için sıfırdan başlatılmaz (bugünkü kural). İnternetsiz kurulumda `DURUM_DOSYASI` bulgusu yeni kira gelene dek sürer ve merdivene girer. Dürüst arızanın çaresi tek bir QR ya da dosya yenilemesidir.
- **Bağlanınca:** aylarca kaymış saat satıcıda `ISTEK_ZAMAN` ve `saticiSapmaSn` olarak görünür; bu, yerel müdahale şüphesi girdisidir.

### 1.6 Bilinen sınırlar (bilinçli kabul)

- **İnternetsiz kopya:** sanal makine ya da disk kopyası internetsiz kalırsa iki kopya da P'ye dek çalışır. Kira zinciri bunu ancak iki taraf da bağlanınca görür. Karşılıklar: sözleşme, güçlü etken şartı (§3.1-6) ve filigran. Bu pencere v1'de ≤ 60–75 gündü, v2'de P'ye (en çok ufka) dek uzar.
- **Yaptırımın ulaşamaması:** K0–K5, DR devri ve kapanış kirası yalnız fabrikaya ulaşınca işler. İnternetsiz fabrika P + 30 g'e dek çalışır.
- **Çalınan ara imzacı (K2):** internetsiz kuruluma iptal belgesi ulaşmaz. Bu yüzden çalınan ara imzacının bastığı sahte HAK, süresiz ufukla, orada süresiz çalışır. Önlemler §2.2'dedir.
- **Kapanışta saat geri alma:** makine her açılışta saati alt sınırın hemen üstüne çekerse yalnız çalışma süresi sayılır ve bulgu doğmaz. Örneğin günde 8 saat çalışan fabrika yaklaşık üç kat süre kazanır. Bedeli, bütün iş kayıtlarının tarihinin bozulmasıdır. Tespit yalnız bağlanınca mümkündür. Donanım sayacı (TPM) kapsam dışıdır.
- **Üç iz birden silinirse** (kira + durum kaydı + DB izi): hemen EK_SURE başlar (K7). Silme tekrarlanırsa ek süre yeniden başlar; bu, bağlanınca görünür. Kip HAK'taki alt sınırdan, o da yoksa derleme varsayılanından gelir. Faz 4'e dek derleme varsayılanı gözlemdir.

## 2. G4 — anahtar hiyerarşisi

### 2.1 Hiyerarşi

| Anahtar | `kid` | Yer | İmzaladığı | Ömür | İptal |
|---|---|---|---|---|---|
| KÖK | `kok-<yıl>-<n>` | Mac, parolalı dosya, VDS'ten uzakta. Şifreli yedek: kullanıcının elle yüklediği Google Drive. Parola kâğıtta | ara sertifikalar (HAK · ALT · İNDİRME · BAYİ), iptal belgesi, eski derleme HAK'ları (§2.6) | çapada süresiz | yalnız yeni derleme |
| HAK ara imzacısı | `ara-<yıl>-<n>` | VDS anahtar birimi, parolalı. Parola portal formu → alt süreç stdin yoluyla gelir; yalnız tailnet ya da geri döngü | HAK | **120 g** | iptal belgesi |
| ALT | `alt-…` | VDS, 0600, parolasız | KİRA | **120 g** | iptal belgesi |
| İNDİRME | `ind-…` | VDS 0600; açık yarı Worker'da | indirme belirteci | **120 g**; Worker listesi kid × kanal × pencere | iptal belgesi + Worker listesinden çıkarma |
| BAYİ | `bayi-…` | VDS, bayi parolasıyla | bayi tavanı içinde HAK (ufuk ≤ 400) | 365 g | iptal belgesi |
| KURULUM | `kur-…` | fabrika `LICENSE_DIR` | İSTEK, `durum.json`, kabul | — | taşıma |

**Zincir yalnız HAK için iki seviyeli olur:** kök → ara sertifika (`kullanim: HAK`) → HAK. Kira yolu (kök → ALT → kira) ve bayi yolu aynen kalır. Kök imzalı HAK geçerli kalır; bütün eski HAK'lar bu yoldan doğrulanır.

### 2.2 Ara imzacı sertifikası ve uzun ufuk

Yapı bugünkü `CertificateSchema`dır. Yeni olan yalnız kullanım değeridir:

- `kullanim: "HAK"`, `kid` öneki `ara-`.
- `siniflar` tören parametresidir. Varsayılan: URETIM · DR · DEMO · TEST. Kökün sınıf yetkisini aşamaz.
- Veriliş kuralı aynen geçerlidir: `baslangic − tol ≤ hak.verilis ≤ bitis + tol`.

HAK, sertifikayı `imzaciSertifikasi` alanında gömülü taşır (bayi yolundaki `bayiSertifikasi` gibi). JWS başlığı değişmez.

**Uzun ufuk (K2) — ara imzacının 400 günü aşan ya da süresiz ufuk vermesi bilinçli kabuldür.** Önlemler:

1. **Sınıf kısıtı.** Kriptografik olarak doğrulanır, aşan değer `UFUK_TAVANI_ASIMI` alır.
   - DEMO ve TEST: ufuk ≤ 45 g.
   - Bayi imzalı HAK: ≤ 400 g.
   - Süresiz ya da 400 günü aşan ufuk yalnız URETIM ve DR sınıfında.
2. **Portalda ikinci onay ve defter.** Uzun ufuk yalnız yönetici rolüne açıktır ve lisans numarası yazılarak ikinci kez onaylanır (ağır K3 emsali). HAK sürüm defterine `uzunUfuk` işaretiyle yazılır ve `UZUN_UFUK_VERILDI` bildirimi çıkar.
3. **Satıcı dışında basılan HAK'ın tespiti.** Fabrika bağlandığında sunduğu HAK satıcının defterinde yoksa `YABANCI_HAK` uyarısı açılır (`YABANCI_KIRA` emsali).
4. **İptal kirayla yayılır** (§2.3). Çevrimiçi kurulumdaki sahte HAK ilk yoklamada düşer.
5. **Kısa ömür ve özel yarının silinmesi.** Ara imzacı 120 gün geçerlidir; törende yenisi gelince eskisinin özel yarısı VDS'ten silinir.

Kalan risk: çalınan ara imzacının internetsiz kuruluma bastığı süresiz HAK (§1.6).

### 2.3 İptal belgesi

- **Tür:** `tekserp-iptal`; yalnız KÖK imzalar. Alanlar: `iptalId` · `sira` (tekdüze artan) · `verilis` · `iptaller[≤256]: {kid, sertifikaId, kullanim, tarih, neden ≤200}`.
- **Etkisi:** listelenen sertifika TÜMDEN geçersizdir. Geri tarihli belge basmak iptali atlatamaz. Doğrulamada `verifyCertificate`'e iptal kümesi parametresi eklenir; hata kodu `SERTIFIKA_IPTAL`.
- **Dağıtım:**
  - Satıcı güncel belgeyi her `LicenseResponse`a `iptal` alanında ekler. Yanıt gevşek olduğundan eski fabrika bu alanı yok sayar.
  - Fabrika en yüksek `sira`lı belgeyi `LICENSE_DIR/iptal.jws`de ve DB izinde tutar; `sira` pinini durum kaydına yazar.
  - Daha düşük `sira`lı belge yok sayılır.
  - Dosya silinirse DB izinden geri gelir. İkisi de yok ama pin varsa `IPTAL_BELGESI_KAYIP` (ÖLÇÜLEMEDİ) bulgusu merdivene girer.
- **Satıcı kapısı:** bir HAK'ı geçersiz kılacak iptal, yeniden basılmış HAK ve kira olmadan dağıtılmaz. Yine de geçersiz kalan HAK olağan merdivene girer; fabrika aniden durmaz.

### 2.4 Dönemsel kök töreni (K4)

- **Sıklık:** üç ayda bir (90 g), Mac'te ~20 dk. `uretim-toren.mjs` dosyasına yeni `donem` alt komutu eklenir. Yıllık maliyet ~1–1,5 saat.
- **Her törende:**
  - yeni ALT, ara imzacı ve İNDİRME (her biri 120 g, yani 30 g örtüşme);
  - değiştiyse yeni iptal belgesi (`sira + 1`);
  - kuyrukta bekleyen kök imzalı HAK'lar (§2.6).

  Paket sabit yükleme betiğiyle VDS'e gider. Paket kök dosyasını içermez. Yükleme bitince eski özel yarılar VDS'ten silinir; sertifikaları kalır, çünkü eski belgeler onlarla doğrulanır.
- **Önceden uyarı:** satıcı portalı ve bildirim (`ANAHTAR_SURESI_BITIYOR`) kullanım başına en yeni sertifikanın bitişine 30 gün kaldığında uyarır (bu, tören günüdür). Uyarı 15, 7 ve 1 gün kala tekrarlanır.
- **Tören atlanırsa:**
  - 120. günde yeni kira, HAK ve indirme belirteci basılamaz.
  - Fabrikalar P'ye dek etkilenmez; yalnız güncelleme indirilemez.
  - İlk zarar, ödemesi gelmiş ama uzatması ulaşamamış bir müşterinin P + 30'da kısıtlıya düşmesidir. Bu en erken 150. gündür, yani kaçırılan tören tarihinden 60 gün sonra.
- **Acil durum (VDS ele geçti):** olağan dışı tören yapılır. Ara imzacı, ALT ve İNDİRME iptal belgesine girer; yenileri temizlenmiş sunucuya yüklenir. Fabrikalara yeni derleme gerekmez.

### 2.5 Veriliş sınırı, yol bağı ve küçük kalemler

- **Veriliş sınırı:** `verifyEntitlement(token, roots, {nowMs, iptal})` imzası kullanılır. `hak.verilis > nowMs + tol` ise `BELGE_ILERI_TARIHLI` döner.
  - `nowMs` = max(duvar saati, yüksek su). Güvenilir saat belgelerden türediği için onu kullanmak döngü olurdu.
  - Kirasız HAK'ın ek süre çapası `min(hak.verilis, şimdi)` olur.
- **İSTEK `yol` alanı:** imzalı istek uç yolunu taşır. Satıcı ve patron, alan varsa yolun eşit olduğunu denetler (`ISTEK_YOL`). Alanın zorunlu olması ayrı bir karardır.
- **Satıcı:**
  - KDF sınırı `openSealedKey` içinde tek kaynağa iner.
  - Parola Buffer'ı her dalda sıfırlanır.
  - Üretimde çapa ezmesi açılışı durdurur (G3'te yapıldı; doğrulanacak).
- **Worker:** İNDİRME listesi kid başına izinli kanal ve pencere taşır (L2-8).

### 2.6 Geçiş

1. **Şimdi (A düzeni, G4 inene dek):** kök VDS'ten kaldırılır; Mac ve Drive kopyaları doğrulandıktan SONRA. HAK imzası gerekirse kök yalnız imza oturumunda VDS'e konur. Kod okumasına göre kök yokken yalnız HAK imzası 500 döner; kira ve indirme sürer. Bu, hazırlıkta ölçülür.
2. **G4 satıcıya inince:**
   - `yetenekler ∋ "hak-ara"` bildiren kuruluma HAK ara imzacıyla basılır.
   - Eski derlemenin HAK değişikliği **"kök imzası bekliyor"** kuyruğuna girer ve sonraki törende Mac'te imzalanır; gerekirse ara tören yapılır.
   - Kök bir daha VDS'e gitmez.
3. **Eski HAK'lar** süresiz geçerlidir. Yeni alanlar bir sonraki HAK sürümüyle gelir. Yetenekli kurulumlar için toplu "yeni biçimde yeniden bas" eylemi vardır (tek parola).
4. **Eski derlemeler** iptal belgesini görmez. Bunlar yalnız bizim test ve demo kurulumlarımızdır; risk yeni derlemeye geçişle kapanır.
5. Hazırlık ortamı aynı akışı hazırlık köküyle provalar.

### 2.7 VDS'te kalanlar

| Durur | Durmaz |
|---|---|
| ara imzacı (parolalı) · ALT · İNDİRME (yalnız güncel özel yarılar) · bayi anahtarları · sunucu sırları · iptal belgesi · eski sertifikalar · kök AÇIK yarısı | kök özel yarısı · PAKET özel yarısı · kök parolası |

## 3. G12 — belirsizlik merdiveni

### 3.1 Kurallar

1. **Depo sorunu yalnız imzayı durdurur.** Bugünkü `hazir` bayrağı ikiye ayrılır: `imzaHazir` (kurulum anahtarı okunuyor) ve `durumHazir` (HAK ve kira gömülü çapayla doğrulanıyor). Kapı, tavan ve yaptırım `durumHazir`a bakar. Anahtar okunamazsa yoklama ve kayıt yazımı durur, `DEPO_OKUNAMADI` merdivene girer, kararlar uygulanmaya devam eder.
2. **HAK doğrulanabildikçe modül tavanı uygulanır.** Saat ve durum kaydı belirsizliği tavanı kaldırmaz. `production.enabled` her hâlde açıktır (`CEKIRDEK_MODULLER`). Etkin kurulumda HAK doğrulanamazsa **son bilinen tavan** uygulanır: önce durum kaydındaki HAK pininin `moduller` alanı, o yoksa DB izi.
3. **Süren ölçülemedi çalışma süresiyle birikir.** Birikim (`belirsizlikMs`) durum kaydında ve DB izinde tutulur; ikisinden büyük olan geçerlidir.
   - 14 g dolunca `BELIRSIZLIK_SURUYOR` (UYARI), ardından 30 g EK_SURE, sonra KISITLI.
   - Birikim yalnız yeni kira kabulünde sıfırlanır.
   - İnternet varken süre dolması kısıtlı getirmez.
4. **İzlerin kaybı:**
   - **Kira ve durum kaydı birlikte yoksa:** `LISANS_IZI_KAYIP` (ÖLÇÜLEMEDİ). Birikim DB izinden sürer.
   - **Üç iz birden yoksa (K7):** 14 günlük UYARI atlanır, hemen 30 g EK_SURE başlar. Ek sürenin çapası tespit anıdır ve DB izine yeniden yazılır.
   - **Kip sırası:** kira → durum kaydı → DB izi → derleme varsayılanı. HAK'taki `kipAltSiniri: "zorla"` her zaman alt sınırdır.
5. **Yoklama birikimi taşır.** Satıcı aşağıdakilerden biri olursa `YEREL_MUDAHALE` uyarısı ve `YEREL_MUDAHALE_SUPHESI` bildirimi açar; bunlar yalnız uyarıdır:
   - `sira` geriledi ya da sıfırlandı;
   - `LISANS_IZI_KAYIP` var;
   - belirsizlik 7 günü aştı;
   - saat sapması büyük;
   - `YABANCI_HAK` var.
6. **Parmak izi v2 (K8).**
   - **Çok yollu okuma:** her etken sabit öncelik sırasıyla birden çok yoldan okunur:

     | Etken | Okuma yolları |
     |---|---|
     | f1 makine kimliği | iki kayıt defteri görünümü |
     | f2 SMBIOS UUID | CIM · eski WMI · `HardwareConfig` kaydı |
     | f3 sistem diski | `Get-Disk` · `Win32_DiskDrive` (önyükleme bölümü ilişkisi) · depolama WMI ad alanı |
     | f4 anakart/BIOS serisi | `Win32_BIOS` · `Win32_BaseBoard` · CIM |
     | f5 PG kimliği | `pg_control_system()` · `pg_controldata` |

     Linux'ta her etkenin iki dosya ya da komut karşılığı vardır. İlk başarılı yol kazanır; yollar arası çelişki yalnız bilgi olarak raporlanır. `Get-PhysicalDisk` ve `Get-NetAdapter -IncludeHidden` yasağı sürer, her yol zaman aşımlıdır. TS ve native toplayıcı aynı sondayı aynı sırayla koşar. Kesin yol listesi L2-10'da thinkpad-1 ve VM üzerinde ölçülerek donar.
   - **Kayıp:** son başarılı okumanın özeti 24 saate dek kullanılır (önbellek imzalı durum kaydında ve DB izinde). Kabul edilen kümede değeri olan bir etken 24 saat üst üste hiçbir yoldan okunamazsa "kayıp" sayılır. Kayıp etken uyuşmazlıktır ama tek başına iptal sebebi değildir.
   - **Karar:** geçerli = eşleşen ≥ 3 ∧ güçlü etkenlerden (f2 · f3 · f4) eşleşen ≥ 2. f1 ve f5 güçlü sayılmaz, çünkü VM ve disk kopyası bu ikisini taşır. DR'de f5 hariç tutulur (bugünkü kural).
     - Kayıp etken varken eşik tutuyorsa sonuç GEÇERLİ olur ve portala not düşer.
     - Eşiğin altında `PARMAK_IZI_UYUSMAZ` merdiveni işler: 14 g UYARI → 30 g EK_SURE → KISITLI.
     - Eşik yeniden tutunca bu merdiven kapanır (belirsizlik birikiminden farklı olarak).
     - İnternet varken satıcı karar verene dek kademe EK_SURE(0)'da kalır.
   - **Meşru değişiklik:**
     - Çevrimiçiyken güçlü etkenler tutuyorsa satıcı yeni kümeyi kendiliğinden öğrenir; yeni kira yeni kümeyi taşır.
     - Çevrimdışıyken bunu QR ya da dosya yenilemesi öğretir.
     - Panelde "Donanım değişikliğini bildir" düğmesi vardır: imzalı istek (`amac: donanim`, zarfla QR'dan da gider). Güçlüler tutuyorsa satıcı otomatik kabul eder, tutmuyorsa portal onay kuyruğuna düşer.
   - **Zayıf tanıma:** etkinleştirmede okunabilen etken < 3 ya da okunabilen güçlü etken < 2 ise kurulum "zayıf tanıma" sayılır. Satıcı `ZAYIF_TANIMA_ONAY_BEKLIYOR` (409) döner; ucuz ön denetim olduğu için kod ve nonce tüketilmez.
     - Portal onayından sonra kira `parmakIziKurali: "zayif"` taşır. Bu kuralda güçlü etken şartı yoktur; eşleşen ≥ min(3, n), kayıp yine uyuşmazlıktır.
     - v2'ye geçen mevcut zayıf kurulum durmaz: satıcı "zayif" kuralıyla devam eder ve kurulumu onay listesine düşürür.

**DB izi:** fabrika DB'sinde ayrılmış bir sistem ayarıdır (`license.trace`). Panel ve `PUT /api/admin/settings` ile yazılamaz (`system.installationId` emsali).

- **İçeriği:** `{kurulumId, hakId, kipAltSiniri, moduller, belirsizlikIlk, belirsizlikMs, ekSureCapasi, parmakIziOnbellegi, sonDurumSirasi, iptal}`.
- **Yazım:** belirsizlik sürerken saatte bir, aksi hâlde yalnız değişimde.
- Lisans kimliğiyle anahtarlıdır; DB kopyası başka kuruluma taşınırsa yok sayılır.
- Silinemez değildir; yalnız savunma derinliğidir. Silinemeyen alt sınır HAK'tadır: HAK'ı silen, şifreli modüllerini de kaybeder.

### 3.2 Durum ve geçiş tablosu

Girdiler:
- **İnternet:** §1.2'deki tanım.
- **Dosya SAĞLAM:** kira kullanılabilir ve durum kaydı geçerli.
- **HAK ✓:** imza, bağ ve iptal denetiminden geçti.
- **Parmak izi** ayrı bir eksendir (§3.1-6); merdiveni aşağıdakilere paralel işler ve en şiddetlisi kazanır.

Gözlem kipinde bütün satırlar yalnız hesaplanır ve raporlanır; uygulanan etki NORMAL'dir (sıfır fark). Tablo `zorla` içindir.

| # | İnternet | Dosya | HAK | Süre çapası | Kademe yolu | Modül tavanı | Yaptırım kaynağı |
|---|---|---|---|---|---|---|---|
| Z1 | VAR | sağlam | ✓ | P | NORMAL → EK_SURE → EK_SURE(0); kısıtlı yalnız satıcı kararıyla | HAK | kira |
| Z2 | YOK | sağlam | ✓ | P | NORMAL → bilgi bandı → EK_SURE 30 → KISITLI | HAK | kira (donuk) |
| Z3 | VAR | bozuk | ✓ | — | geçici: sonraki başarılı yoklama Z1'e döndürür; yoklama düşerse Z4 | HAK | durum kaydı → DB izi |
| Z4 | YOK | bozuk (DB izi var) | ✓ | birikim | UYARI 14 g (çalışma süresi) → EK_SURE 30 → KISITLI | HAK | durum kaydı → DB izi |
| Z5 | VAR | sağlam | ✗ | eski çapa | UYARI; yanıt HAK'ı yeniden verir → Z1 | son bilinen | kira |
| Z6 | YOK | sağlam | ✗ | eski çapa (kira bitişi) | UYARI → EK_SURE 30 → KISITLI | son bilinen | kira |
| Z7 | VAR | bozuk | ✗ | — | yanıt HAK ve kira getirir → Z1 | son bilinen | durum kaydı → DB izi |
| Z8 | YOK | üç iz birden yok | ✓/✗ | tespit anı | **hemen** EK_SURE 30 → KISITLI (K7) | son bilinen, yoksa ham (üretim açık) | yok |
| Z9 | imza yok | anahtar okunamaz | ✓/✗ | Z2/Z4/Z6 gibi | `DEPO_OKUNAMADI` merdivene girer; İnternet YOK sayılır | aynı | aynı |

Yaptırım (K3 tarihi, K4, K5, `devredildi`) her satırda tek anahtarlı ve kalıcıdır; ek süre ve belirsizlik onu gevşetmez.

### 3.3 Etkinleşmemiş kurulum ve ikincil kalemler

- **Etkinleşmemiş kurulum (K3):** `zorla` derlemesinde (Faz 4 sonrası) ilk açılış + 30 g sonunda KISITLI'ya iner. Plan §4'ün niyeti buydu; bugünkü kod bunu hiç uygulamıyordu.
- **İkincil kalemler (rapor §6):** native çağrı istisnası "çekirdek yok" sonucuna döner; modül bağımlılığı tavan katmanında uygulanır; zorunlu kipte imza listesinde okunamayan dosya "değişmiş" sayılır.
- **Faz 4 sırası:** G12 + parmak izi v2 iner → testfabrika'da `zorla` ölçümü (yanlış pozitif 0) → Faz 4. Bu adımlar bitmeden varsayılan `zorla` açılmaz.

## 4. Protokol değişiklikleri

### 4.1 Alanlar (hepsi isteğe bağlı; `v` artmaz)

| Belge / gövde | Ekleme | Eski doğrulayıcı (TS + native) ne yapar |
|---|---|---|
| SERTİFİKA | `kullanim: "HAK"`, `kid` öneki `ara-` | enum dışı değer → `BELGE_SEMA`. Eski kurulum bu sertifikayı yalnız HAK içinde görür ve o HAK'ı zaten `KOK_BILINMIYOR` ile reddeder. Bu yüzden yalnız yetenekli kuruluma gider |
| HAK | `imzaciSertifikasi?` | okumaz → `KOK_BILINMIYOR` (yalnız yetenekli kuruluma gider) |
| HAK | `cevrimdisiUfukGun?` (1–3650 \| null) · `kipAltSiniri?` (`"zorla"`) | tanımadığı alanı atar (TS `z.object`, native `strict=false`) |
| KİRA | `odenmisTarih?` (ISO \| null) · `parmakIziKurali?` (`standart` · `zayif`) | atar; eski çapa ve eski parmak izi kuralı sürer |
| İPTAL (yeni `typ`) | §2.3 | hiç görmez |
| İSTEK | `yol?` · `amac` enum'una `donanim` | `yol`u atar (`RequestSchema` gevşek); eski satıcı `donanim` amacını reddeder ⇒ satıcı önce yayınlanır, eski fabrika bu amacı zaten göndermez |
| Yeni uç `POST /v1/donanim` | `{v, parmakIzi, kayip[], gerekce}` → `LicenseResponse` ya da `{talepId, durum}` | eski satıcıda yok (`BULUNAMADI`) |
| `PollRequestSchema` · `ActivateRequestSchema` (KATI) | `yetenekler?` · `belirsizlik?` · `durumKaydi?` · `parmakIziKayip?` | eski satıcı 400 `GOVDE_GECERSIZ` döner ⇒ satıcı fabrikadan ÖNCE yayınlanır |
| `LicenseResponseSchema` (gevşek) | `iptal?` | eski fabrika atar |
| Protokol işlevleri | `verifyEntitlement(…, {nowMs, iptal})` · `verifyCertificate(…, iptal)` · `verifyRevocation` · `compareFingerprints(…, {kural})` (güçlü şartı + kayıp) | — (native ABI değişir, §4.3) |
| Kodlar | protokol: `SERTIFIKA_IPTAL` · `BELGE_ILERI_TARIHLI` · `UFUK_TAVANI_ASIMI` · `ISTEK_YOL` — satıcı: `ZAYIF_TANIMA_ONAY_BEKLIYOR` (409) | kod eklemek kırıcı değildir (protokol §9) |

**`v` neden artmıyor?** Anlamı daraltan değişiklikler — `kipAltSiniri`, ara imzacı zinciri ve parmak izi kuralı — yalnız `yetenekler` bildiren kuruluma gider; kuralı da kiradaki alan seçer. Eski doğrulayıcının yok saydığı alanlar ya bilgi taşır ya da yalnız genişletir; yok sayıldıklarında eski, daha sıkı davranış sürer.

### 4.2 Uyumluluk yönleri

| Yön | Ne olur |
|---|---|
| Yeni satıcı ↔ eski fabrika | HAK kök imzalı kalır (değişiklik kuyruğa girer, törende imzalanır). Kira yeni alanları taşır; eski fabrika onları atar, internetsiz zarfı bugünkü gibi ~60–75 gündür ve eski parmak izi kuralını uygular. İptal belgesini görmez. Satıcının öğrenme kuralı (güçlüler ≥ 2) bu kurulumlar için de geçerlidir |
| Eski satıcı ↔ yeni fabrika | izin verilmeyen sıra. Olursa yoklama 400 alır, eski çapa işler; davranış bugünkü gibidir |
| Yeni fabrika + v1 belge | eski çapa ve eski parmak izi kuralı. Yalnız merdiven ve yeni ikinci anahtar işler; gözlem kipinde sıfır fark |
| Yeni fabrika + v2 belge | P · iptal · ufuk · kip alt sınırı · parmak izi v2 |
| Panel / tablet (eski) | `detay`'ın yeni alanlarını yok sayar. Bant metni backend'den gelir. Yeni neden kodları ham kod olarak görünür (Electron `labels.ts` L2-5'te güncellenir). "Donanım değişikliğini bildir" yalnız yeni panelde vardır |
| Patron sunucusu | ayna güncellenir; `yol` alanı varsa denetlenir |
| CF Worker | yeni İNDİRME listesi; eski biçim bir sürüm daha tanınır |

### 4.3 Test vektörü etkisi

- **TS kâhin** (`test_lisans_native_kahin`, `--vektor-yaz`) yeni vektör aileleri:
  - ara imzacı zinciri: geçerli · sınıf dışı · pencere dışı · iptalli · sınıfa göre ufuk tavanı · süresiz ufuk;
  - iptal belgesi: imza · şema · düşük `sira`;
  - ileri tarihli veriliş;
  - yeni alanların şema çıktısında KORUNDUĞU vektörler;
  - İSTEK `yol` ve `donanim` amacı;
  - parmak izi kararı: kayıp etken · güçlü şartı (f1+f5 eşleşip güçlüler tutmuyor = RED) · zayıf kural · DR'de f5 hariç.

  Gömülü çapa vektörleri G3'ün `kiplere()` yardımcısıyla iki kipe çoğaltılır.
- **Rust:** `schema.rs` · `chain.rs` (iki seviye, iptal, `nowMs`) · `fingerprint.rs` (karar kuralı) · `collect.rs` (çok yollu sonda; TS ile aynı metin, `§0d`) · `api.rs` + napi · `tests/vektorler.rs`.
- **ABI:** G3 ABI'yi 3 yaptı. G3 yayınlanmadan G4 ve parmak izi v2 de ABI 3 altında birleşir (kural: yayınlanmamış değişiklikler tek ABI numarasında toplanır). G3 önce yayınlanırsa yeni numara 4 olur. `VEKTOR_BICIMI` aynı ilkeyle yönetilir; vektörler birleşimden SONRA yeniden üretilir. G13 aynı dalgadadır ve aynı numarayı paylaşır.
- **Aynalar:** değişen protokol dosyaları satıcıya ve patrona bayt-eşit kopyalanır (`test_lisans_protokol_aynasi`, patron `test_patron_kapilari` §7a).

## 5. Uygulama dilimleri (son hâl)

**Bağımlılık sırası:**
1. G3: `inis/guvenlik-g` main'e iner (iniş sürüyor).
2. L2-1.
3. Paralel: L2-2 ‖ L2-3 ‖ L2-4 ‖ L2-5 ‖ L2-11.
4. L2-10 (L2-2 inince).
5. L2-6 (L2-5 ve L2-10 inince) · L2-7 · L2-8.
6. L2-9.

Geliştirme paralel yürür; YAYIN sırası satıcı → fabrika → istemcidir. Süreler ajan-günü tahminidir (ölçülmedi). Her dilim kendi worktree'sinde ve kendi `_test` DB'siyle çalışır; dilimde yalnız hedefli bekçiler koşulur, tam paket inişte bir kez. Model önerisi: varsayılan Opus; efor riske göre seçildi.

| # | Dilim | Ana dosyalar | Bekçiler | Süre | Model · efor |
|---|---|---|---|---|---|
| L2-0 | Kararlar + kural uyumu (§7) | bu belge, `docs/kurallar/lisans.md`, arşiv notu, protokol belgesi | `check-docs` | 0,5 | Opus · orta (1e) |
| L2-1 | Protokol (TS tek kaynak) | `protocol/belgeler.ts` · `anahtar-zinciri.ts` · `parmak-izi.ts` · `uclar.ts` · `istek.ts` · `ortak.ts` + satıcı/patron aynası | `test_lisans_protokol` (yeni: ara zincir, iptal, ufuk, `yol`, `donanim`, parmak izi v2) · `test_lisans_protokol_aynasi` · `test_lisans_yoklama_allowlist` | 3–4 | Opus · max |
| L2-2 | Native ayna | `chain.rs` · `schema.rs` · `fingerprint.rs` · `api.rs` · `napi_api.rs` · vektörler | `test_lisans_native_kahin` · cargo `vektorler.rs` · `test_guven_capasi_ekle` | 2–3 | Opus · yüksek |
| L2-3 | Satıcı: ara imzacı, tören, iptal | `keys/key-store.ts` · `signing-scope.ts` · `signer.ts` · `scripts/anahtar.ts` (`ara-uret`, `iptal-uret`) · `deploy/satici/uretim-toren.mjs donem` · `entitlement.service.ts` (yetenek kapısı, kök kuyruğu, uzun ufuk onayı + defter) · iptal defteri (ekleyen migration) | yeni `test_ara_imzaci` · yeni `test_iptal_belgesi` · `test_imza_parolasi` · `test_uretim_toren` · `test_kok_parola_argv` · `test_erisim_kapisi` | 3–4 | Opus · max |
| L2-4 | Satıcı: P, kapanış kirası, yerel müdahale | `lease.service.ts` · `odenmisTarihi` yardımcısı · `sanction.service.ts` · `renewal.service.ts` · `lease-chain.ts` · uzatma dosyası · `YABANCI_HAK` · `Kurulum.yetenekler`/`sonDurumSirasi` · enum değerleri (reçeteli) · `satici/web` | yeni `test_odenmis_tarih` · `test_kira_zinciri` · `test_yaptirim_kira` · `test_planli_eylem_taksit` · `test_portal_taksit_planli` · `test_bildirim_tarama` · `test_qr_sayfasi` · web `mirrors.test.ts` | 3–4 | Opus · yüksek |
| L2-5 | Fabrika: P modeli | `Teks-Erp/src/lib/license/state-rules.ts` · `Teks-Erp/src/lib/license/state.ts` · `Teks-Erp/src/services/license.service.ts` · Electron Lisans ekranı (`LicenseLeaseCard`, `labels.ts`, dosya yükle) | `test_lisans_durumu` (P, bant görünürlüğü, iki anahtar, eski belgeyle sıfır fark) · `test_lisans_motoru` · Electron `licenseService.test.ts` | 2 | Opus · yüksek |
| L2-6 | Fabrika: G12 merdiveni + parmak izi merdiveni | `store.ts` · `runtime.ts` · `module-ceiling.ts` · `accumulation.ts` · `saat.ts` · DB izi · `license.middleware.ts` · `native-adapter.ts` · yoklama gövdesi | `test_lisans_durumu` · `test_lisans_motoru` · `test_lisans_kapisi` · `test_lisans_modul_tavani` · `test_lisans_butunluk` · `test_audit_muafiyeti` · `test_lisans_yoklama_allowlist` | 4–5 | Opus · max |
| L2-7 | Fabrika: G4 tüketimi | iptal deposu + pin · `nowMs` · `yetenekler` · `yol` · `detay`'da imzacı zinciri | `test_lisans_motoru` · `test_lisans_protokol` · `test_lisans_native_kahin` | 1–2 | Opus · orta |
| L2-8 | Worker İNDİRME listesi | `deploy/guncelleme-sunucusu/worker/indirme-kapisi.js` · `protocol/indirme.ts` | `test_indirme_kapisi` | 1 | Opus · orta |
| L2-10 | Parmak izi: çok yollu toplayıcı + bildirim ucu | `Teks-Erp/src/lib/license/fingerprint-os.ts` · `Teks-Erp/src/lib/license/fingerprint.ts` · `collect.rs` (aynı sonda) · 24 sa önbellek · `POST /api/license/donanim-bildir` · panel düğmesi. Ölçüm: thinkpad-1 + bir VM, salt okuma | `test_lisans_native_kahin` (§0d sonda metni, §6a aynı özet) · `test_lisans_motoru` · `test_lisans_kapisi` (uç her kademede açık) | 3 | Opus · yüksek |
| L2-11 | Satıcı: parmak izi öğrenme, donanım bildirimi, zayıf tanıma | `renewal.service.ts` (güçlü ≥ 2 öğrenme) · yeni `/v1/donanim` işleyicisi + onay kuyruğu · `activation.service.ts` (zayıf tanıma kapısı) · `satici/web` onay ekranı | yeni `test_donanim_bildirimi` · `test_etkinlestirme` · `test_kira_zinciri` · web `mirrors.test.ts` | 3 | Opus · yüksek |
| L2-9 | Entegrasyon + Senaryo L | L31'den başlayan yeni senaryolar: internetsiz 400 g · üç iz silme · uzatma dosyası · iptal turu · tören atlanması · kapanış kirası · donanım değişikliği · zayıf tanıma | `senaryo-ly.ts` · tam paket (bir kez) | 2–3 | Opus · yüksek |

Toplam ~28–34 ajan-günü. Paralel yürütmede takvimde ~3 hafta. G13 aynı dalgada ayrı dilimdir ve native ABI'yi paylaşır.

### 5.1 Canlıya çıkış sırası

Takvim kapısı yoktur; her adımın kapısı bir ölçüm ya da kullanıcı cümlesidir.

1. **A düzeni (şimdi):** kök VDS'ten kaldırılır. Kopyalar doğrulanınca, kullanıcının "uygula" cümlesiyle.
2. **G3 inişi:** `inis/guvenlik-g` → main.
3. **Satıcı hazırlık** (`lisans-test`): L2-3 · L2-4 · L2-11; hazırlık kökünün ara imzacı töreni.
4. **testfabrika** (hazırlık çapası, thinkpad-1): L2-5…L2-7 ve L2-10.
   - Parmak izi yolları salt okumayla ölçülür.
   - Senaryolar önce gözlem kipinde, sonra `zorla`da koşulur (yanlış pozitif 0).
5. **İlk üretim töreni** (Mac): ara imzacı · ALT · İNDİRME (120 g) · iptal `sira` 1 → üretim satıcısının yeni sürümü.
6. **demofabrika** (üretim çapası, DEMO): yeni derleme; zayıf tanıma olup olmadığı ölçülür.
7. **adnansahin:** yalnız kullanıcı cümlesiyle (gözlem → ölçüm → `zorla`).

## 6. Kararlar (kullanıcı, 2026-10-01)

| # | Konu | Karar | Belgede |
|---|---|---|---|
| K1 | Hatırlatma bandı | yalnız internetsizken (son başarılı alışveriş 7 günden eski) ya da P sözleşme sonuyken | §1.3 |
| K2 | 400 günü aşan / süresiz ufuk | **ara imzacı da imzalayabilir.** Ara imzacı çalınırsa süresiz sahte HAK üretilebilir ve iptal yalnız çevrimiçi fabrikaya ulaşır; bu risk bilinçli kabul edildi. Önlemler: sınıf kısıtı, portalda ikinci onay + defter, `YABANCI_HAK` tespiti, iptalin kirayla yayılması, 120 g ömür | §1.1 · §1.6 · §2.2 |
| K3 | İkinci anahtar | "son 24 saatte başarılı alışveriş yok"; etkinleşmemiş kurulum da kapsanır | §1.2 · §3.3 |
| K4 | Tören sıklığı | üç ayda bir. ALT · ara imzacı · İNDİRME 120 g (30 g örtüşme). Uyarı 30 / 15 / 7 / 1 gün kala | §2.1 · §2.4 |
| K5 | Taksitte P | sıradaki taksitin tarihi | §1.1 |
| K6 | Kopya ikinci pencere, taşınan anahtar | imzalı kapanış kirası (K3 + ek süre) | §1.2 |
| K7 | Üç iz birden silinirse | hemen EK_SURE (14 günlük UYARI atlanır) | §3.1-4 · Z8 |
| K8 | Parmak izinde kayıp etken | **şimdi**: çok yollu okuma · 24 sa sonra kayıp · kayıp = uyuşmazlık ama iptal değil · güçlü etkenlerden ≥ 2 · meşru değişikliği satıcı öğrenir, panelde "bildir" düğmesi · zayıf tanıma satıcı onayıyla | §3.1-6 · L2-10 · L2-11 |

**Uygulamada netleştirilen iki nokta:**
- K8'in "zayıf tanıma" tanımı, okunabilen güçlü etkenin 2'den az olduğu durumu da kapsayacak şekilde genişletildi. Gerekçe: aksi hâlde güçlü şartı hiç sağlanamaz ve kurulum hiç geçerli olamaz.
- K7'de üç iz silinmesi her tekrarlandığında ek süre yeniden başlar. Bu artık riskin görünür yüzü portaldaki `sira` sıfırlanması ve `LISANS_IZI_KAYIP` bildirimidir.

## 7. Kural uyumu

Bu belge kural yazmaz; aşağıdaki değişiklikler L2-0'da, dilimlerle birlikte yapılır.

- **`docs/kurallar/lisans.md` değişmezleri:**
  - "aniden durdurmaz" merdivenine P, bilgi bandı, 14 günlük belirsizlik ve "üç iz birden silinirse hemen ek süre" girer;
  - "Ek süre İMZALI tarihten türer" kuralında v2 çapası P olur;
  - "iki anahtarlı" kuralının ikinci anahtarı yeniden tanımlanır;
  - modül tavanının fail-open'ı §3.1-2 ile değişir;
  - **parmak izi satırı** ("ölçülemeyen etken uyuşmazlık SAYILMAZ, ≥ 3") §3.1-6 ile değişir;
  - güven çapası satırına ara imzacı girer.
- **Kararlar ve yasaklar:**
  - kira zincirinin (c) maddesi kapanış kirasına dönüşür;
  - kök parolası satırına "kök VDS'te durmaz; ara imzacı parolası da aynı stdin kuralına tabidir" eklenir;
  - native toplayıcı satırı çok yollu sondayı kapsar.
- **Protokol belgesi:** §2'deki "tek seviye" · §6 (parmak izi kararı) · §11'deki iki sınır.
- **Plan:**
  - §3 tablosu ve §12'deki "kök VDS'te" riski arşivde GEÇERSİZ olarak işaretlenir;
  - §4'teki "≤ 60 gün" çevrimdışı kopya zarfı ve parmak izi eşiği bu belgeyle değişir.
