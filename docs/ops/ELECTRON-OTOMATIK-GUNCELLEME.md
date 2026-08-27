# Electron Panelinin Otomatik Güncellenmesi

**Amaç:** fabrikadaki her bilgisayara tek tek setup taşımayı bitirmek. Yeni sürüm
bir kez yayınlanır, kurulu paneller kendiliğinden indirir ve **zorunlu olarak**
kurar.

**Durum (2026-08-27):** kod tarafı **uygulandı**, yayın sunucusu **kuruldu ve
doğrulandı** (§1). Kalan tek iş **§2 — bir kerelik son elle tur**.

---

## Nasıl çalışıyor

```
Sen (geliştirme)                 VPS (yayın)                Fabrika (N bilgisayar)
─────────────────                ───────────                ──────────────────────
sürüm no'yu artır
npm run build:win     ──►  3 dosya yüklenir   ──►  panel açılışta + 4 saatte bir
release/<sürüm>/           latest.yml              latest.yml'e bakar
  TeksERP-x.y.z-Setup.exe  TeksERP-…-Setup.exe     yeni sürüm varsa arka planda
  TeksERP-…-Setup.exe.blockmap  …blockmap          indirir → ZORUNLU kapı
  latest.yml                                        (2 dk geri sayım) → kurar
```

- **Yayın adresi:** `https://guncelleme.etkiliyazilim.com/adnansahin/electron/`
  Tek kaynak: `Electron/shared/update-feed.ts` + `Electron/package.json > build.publish`.
  İkisinin eşitliği `src/test/update-feed-url.test.ts` bekçisiyle kilitli.
- **İndirme farksal:** `.blockmap` sayesinde 150 MB'ın tamamı değil, yalnız değişen
  bloklar iner. Bu yüzden blockmap dosyasını yüklemeyi atlama.
- **Kurulum ZORUNLU:** indirme bitince kapatılamaz bir kapı açılır, 2 dakikalık
  geri sayımdan sonra kurulum kendiliğinden başlar (bkz. "Operatör ne görüyor").
- **Kapanışta sessiz kurulum bilerek KAPALI** (`autoInstallOnAppQuit = false`):
  uygulama "Program Files"a kurulu olduğu için Windows izin sorar; kapanışta
  tetiklenseydi operatör gittikten sonra ekranda cevapsız bir izin penceresi
  asılı kalırdı. Kurulum hep operatör başındayken yapılır.

---

## §1 — VPS hazırlığı ✅ YAPILDI (2026-08-26)

Yayın servisi kuruldu ve uçtan uca doğrulandı. Burada anlatılan şey **tekrar
yapılacak bir iş değil**, ne olduğunun kaydıdır.

Sunucuda nginx YOK — ortam **Docker + Traefik v3.5**. `demo.etkiliyazilim.com`
zaten `tekserp-demo` konteynerine (backend, port 4000) gidiyordu. Yayın için
ayrı bir statik servis eklendi:

| | |
|---|---|
| Servis | `/opt/stack/apps/tekserp-guncelleme/docker-compose.yml` (nginx:alpine, 64 MB) |
| Yayın klasörü | `/opt/stack/apps/tekserp-guncelleme/html/adnansahin/electron/` |
| Traefik kuralı | ``Host(`guncelleme.etkiliyazilim.com`)`` |
| Yol şeması | **müşteri bazlı**: `/<müşteri>/<ürün>/` → `/adnansahin/electron/`, mobil `/adnansahin/mobil/` |
| DNS | Cloudflare A kaydı → `91.217.119.138`, **proxy AÇIK (turuncu bulut)** |
| Sahiplik | `oguzhan:oguzhan` — `scp` doğrudan yazar (`sudo` ile scp yapılamaz) |
| SSH | `oguzhan@91.217.119.138`, **port 2222** (yerel takma ad: `yenisunucu`, anahtar erişimi kurulu) |

**Neden `tekserp-demo` konteynerinin `public/` klasörüne konulmadı:** orası imajın
parçası; demo her yeniden derlendiğinde yayın silinirdi. Ayrı servis + host
dizini, deploy'lardan bağımsız kalıcılık demek. (Fabrika sunucusunda da aynı
tuzak var: `kur.ps1` her deploy'da `app\` klasörünü komple değiştirir.)

### ⚠️ Cloudflare proxy'si AÇIK kalmalı — kapanırsa güncelleme sessizce durur

Sunucudaki sertifika bir **Cloudflare Origin CA** sertifikasıdır
(`*.etkiliyazilim.com` wildcard, 2036'ya kadar; `traefik/dynamic/tls.yml` →
default store). ACME/Let's Encrypt kullanılmıyor çünkü `etkiliyazilim.com` bu
Cloudflare hesabının zone'unda değil, DNS-01 çalışmıyor.

**Origin CA sertifikasına yalnız Cloudflare Edge güvenir.** Kayıt DNS-only'ye
(gri bulut) çevrilirse istemci doğrudan origin'e bağlanır, sertifikayı reddeder
ve panelde "güvenlik sertifikası kabul edilmedi" yazar. Yani turuncu bulut bir
tercih değil, çalışma şartıdır.

Wildcard sayesinde bu alt alan adı için **ek sertifika işi yoktur** — kayıt
açıldığı anda TLS hazırdır (ölçüldü: `ssl_verify=0`, `server: cloudflare`).

**Neden ayrı alan adı:** `demo.etkiliyazilim.com` altında yol tabanlı bir
yönlendirmeyle de kurulabilirdi, ama o alan adı demo uygulamasının; yayın onun
altında yaşasaydı demo'nun SPA fallback'i (bilinmeyen her yola 200 + index.html)
ile aynı isim alanını paylaşırdı. Ayrı ad, yayını demo'nun yaşam döngüsünden
tamamen ayırır.

**Yol şeması müşteri bazlıdır: `/<müşteri>/<ürün>/`.** Alan adı Etkili Yazılım'ın
genel güncelleme sunucusudur; her müşteri kendi klasöründe yaşar. Yeni müşteri
eklemek sunucuda bir klasör açmaktır — DNS kaydı, sertifika ya da yeni servis
gerekmez. Mobil APK/OTA yayını da **aynı servise** `/adnansahin/mobil/` olarak
girer, ayrı konteyner değil.

Müşteri başına **alt alan adı** (`adnansahin.guncelleme.etkiliyazilim.com`)
bilinçli olarak seçilmedi: wildcard sertifika `*.etkiliyazilim.com` **iki
seviyeli** adları kapsamaz, her müşteri için ayrı Origin CA sertifikası
gerekirdi.

⚠️ **Adres pakete derleme anında gömülür** — adresleme kararı sahaya çıkmadan
ÖNCE verilmelidir. Sonradan değiştirmek, sahadaki her makineyi tek tek gezmek
(ya da her makinede adresi elle ezmek) demektir. Bu karar 2026-08-26'da, ilk
elle turdan önce verildi.

**Ölçülen sonuçlar (kurulum günü):**

```
GET guncelleme.etkiliyazilim.com/adnansahin/electron/<dosya> → 200, text/yaml
     Cache-Control: no-cache, must-revalidate · cf-cache-status: DYNAMIC
     ssl_verify=0 · server: cloudflare        (sertifika GEÇERLİ, proxy AÇIK)
GET demo.etkiliyazilim.com/            → 200  (demo BOZULMADI)
GET demo.etkiliyazilim.com/health      → 200  (demo API BOZULMADI)
```

`cf-cache-status: DYNAMIC` önemli: Cloudflare `latest.yml`i **önbelleklemiyor**.
Önbelleklese, yeni sürüm yayınlandıktan sonra paneller saatlerce eski bilgiyi
okurdu.

`.yml` her istekte tazelenir (bayat sürüm bilgisi güncellemeyi saatlerce
geciktirir); `.exe`/`.blockmap` bir hafta önbelleklenir (her sürümün adı farklı
olduğu için içerik değişmez).

## Birden fazla fabrika — her müşteri kendi kanalında

Yayın yolu **müşteri bazlıdır**: `/<müşteri>/electron/`. İki fabrikanın yayını
birbirini hiç görmez.

**Yeni fabrika eklemek:**

```bash
# 1) Sunucuda klasör (DNS, sertifika, servis GEREKMEZ)
ssh yenisunucu 'mkdir -p /opt/stack/apps/tekserp-guncelleme/html/yenifabrika/electron'

# 2) O müşteri için paketle — adres pakete gömülür
./deploy/electron-paketle.sh yenifabrika

# 3) Yayınla (hedef klasörü paketin kendi kimliğinden çözer)
./deploy/electron-yayinla.sh
```

⚠️ **Neden ayrı bir paketleme komutu var:** yayın adresi pakete **derleme
anında** gömülür. Müşteri kodu elle değiştirilseydi, unutulan tek bir düzenleme
*"yeni fabrikanın paneli başka bir fabrikanın güncellemesini indirip kurar"*
sonucunu verirdi — ve bu hata **sessizdir**: dosyalar kendi aralarında tutarlı
kalır, yalnızca yanlış müşteriyi gösterirler. Tek müşteriyle hiç görünmez,
ikincisinde patlar.

**Üç kademeli koruma:**

| Kademe | Ne yapar | Neyi yakalayamaz |
|---|---|---|
| `shared/musteri.json` tek kaynak | Adres koddan **türetilir**, elle yazılan ikinci kopya yok | — |
| Bekçi `update-feed-url.test.ts` | `musteri.json` ↔ `package.json` ↔ `update-feed.ts` tutarlılığı | Üçü de aynı **yanlış** müşteriyi gösterirse |
| **Paketleme kapısı** (derlemeden SONRA) | Paketin içindeki `app-update.yml`i okur, **argümanla verilen** müşteriyle kıyaslar | — |

Son kademe kritik: beklenen değer **argümandan** (bağımsız niyet beyanı), gerçek
değer **çıktıdan** gelir. Beklenen değeri de `musteri.json`dan alsaydı kontrol
**dairesel** olurdu — yanlış bir müşteri kodunu asla yakalayamazdı. (Mobil
tarafında kapı tam bu yüzden dairesel çıktı ve yakalayamadı.)

Yayın komutu da hedefi paketin **kendi kimliğinden** çözer, elle verilen bir
yoldan değil: "adnansahin paketini yenifabrika klasörüne yükleme" hatası yapısal
olarak imkânsız.

⚠️ **Sürüm politikası ayrı bir eksendir.** Her fabrikanın kendi backend'i var ve
`minVersion`ı o backend servis eder — yayın kanalıyla (VPS, müşteri klasörü)
birbirine bağlı değildir.

## §2 — Bir kerelik son elle tur (kaçınılmaz)

Otomatik güncelleme, makinede **zaten güncelleyiciyi taşıyan bir sürüm** varsa
çalışır. Sahadaki mevcut kurulumlar bu kodu taşımıyor. Yani:

1. Bu değişiklikleri içeren yeni sürümü paketle (§3).
2. Fabrikadaki her bilgisayara **son bir kez** elle kur.
3. Bundan sonraki her sürüm kendiliğinden gider.

Kurulumdan sonra her makinede tek kontrol:
**Genel Ayarlar → Bu Bilgisayar → Güncelleme** → "Şimdi kontrol et" → "En güncel
sürüm kurulu" yazmalı. Bu yazı, o makinenin yayın adresine ulaşabildiğinin kanıtıdır.

---

## §3 — Her yeni sürümde (rutin)

### 1. Sürüm numarasını artır — ATLANIRSA HİÇBİR ŞEY GÜNCELLENMEZ

`Electron/package.json > version`. Güncelleyici karşılaştırmayı bu numaraya göre
yapar; numara aynı kalırsa panel "en güncelim" der ve yeni setup'ı hiç indirmez.

```
2.8.0  →  2.8.1     (hata düzeltmesi)
2.8.1  →  2.9.0     (yeni özellik)
```

### 2. Paketle — MÜŞTERİ BELİRTEREK

```bash
./deploy/electron-paketle.sh adnansahin          # mevcut sürümle
./deploy/electron-paketle.sh adnansahin 2.9.0    # sürümü de ayarla
```

Script müşteri kodunu `shared/musteri.json` ve `package.json > build.publish`
içine **birlikte** yazar, derler ve derlemeden **sonra** paketin içindeki gömülü
adresi okuyup doğru müşteriyi gösterdiğini doğrular.

⚠️ **Ham `npm run build:win` kullanma.** O, `package.json`da ne yazıyorsa onunla
derler — yani bir önceki müşterinin adresiyle. Paketleme script'i tam olarak bu
hatayı önlemek için var.

Çıktı: `Electron/release/<sürüm>/` içinde **üç dosya**

| Dosya | Zorunlu | Ne işe yarar |
|---|---|---|
| `TeksERP-<sürüm>-Setup.exe` | ✅ | Kurulumun kendisi |
| `latest.yml` | ✅ | "Son sürüm nedir" bildirimi — panel ÖNCE bunu okur |
| `TeksERP-<sürüm>-Setup.exe.blockmap` | ✅ | Farksal indirme (yalnız değişen bloklar) |

> **macOS'tan da alınabilir** (2026-08-26'da ölçüldü) ama farklı komutla:
>
> ```bash
> npm run build:win:cross     # = electron-builder --win -c.npmRebuild=false
> ```
>
> Düz `npm run build:win` macOS'ta **düşer**: electron-builder native modülleri
> Electron için yeniden derlemeye çalışır ve `node-gyp does not support
> cross-compiling native modules from source` der. O adım atlandığında sorun
> kalmaz, çünkü `serialport` ve `node-hid` **N-API prebuild** kullanıyor
> (`node-napi-v4.node`) — Electron sürümünden bağımsızlar, yeniden derlenmeleri
> gerekmiyor. Windows binary'lerinin pakete girdiği ölçüldü (`PE32+ x86-64`).
>
> ⚠️ **Ama "doğru binary pakete girdi" ile "Windows'ta terazi ve okuyucu
> açılıyor" aynı şey değil.** Bu modüller düşerse uygulama çökmez, sessizce
> `available: false` der — arıza kendini göstermez. macOS'ta derlenen bir paketi
> sahaya yaymadan önce bir Windows makinesinde **Bu Bilgisayar → Yazıcı /
> Kantar** sekmelerinde cihazların listelendiğini gör.

### 3. Yayınla (aynı Windows makinesinden)

```powershell
.\deploy\electron-yayinla.ps1
```

Script sürümü `package.json`dan okur, üç dosyanın varlığını ve `latest.yml`in
gerçekten o sürümü gösterdiğini doğrular, **doğru sırada** yükler ve sonunda
yayını dışarıdan kontrol eder. Elle yapmak istersen:

```powershell
scp -P 2222 release\<sürüm>\TeksERP-<sürüm>-Setup.exe `
            release\<sürüm>\TeksERP-<sürüm>-Setup.exe.blockmap `
            oguzhan@91.217.119.138:/opt/stack/apps/tekserp-guncelleme/html/adnansahin/electron/
scp -P 2222 release\<sürüm>\latest.yml `
            oguzhan@91.217.119.138:/opt/stack/apps/tekserp-guncelleme/html/adnansahin/electron/
```

> **`latest.yml` EN SON gider.** Önce giderse, henüz yüklenmemiş bir `.exe`yi
> işaret eder ve o aralıkta kontrol yapan paneller "sürüm dosyası bulunamadı"
> hatası alır (zararsız ama gereksiz alarm). Script'in asıl işi bu sırayı
> unutturmamaktır.
>
> **Dosya adını DEĞİŞTİRME.** `latest.yml` içindeki ad ile sunucudaki ad birebir
> aynı olmalı. (Bu yüzden paket adı ASCII'ye çevrildi: eski ad "Adnan Şahin
> ERP-…exe" idi ve `Ş` + boşluk aktarımda sessizce bozulup 404 üretirdi.)

### 4. Doğrula

Script bunu kendi yapar. Elle:

```bash
curl -s https://guncelleme.etkiliyazilim.com/adnansahin/electron/latest.yml
# version: <yeni sürüm>  ve  path: TeksERP-<sürüm>-Setup.exe  yazmalı
```

Fabrikadaki paneller en geç 4 saat içinde görür; beklemek istemezsen bir makinede
**Bu Bilgisayar → Güncelleme → Şimdi kontrol et**.

---

## Sürüm politikası — backend "hangi paneli beklediğini" söyler

Bu projede deploy sırası **backend ÖNCE**. Yani yeni bir API sözleşmesi
çıktığında sahada bir süre eski paneller çalışır — ve bazı sözleşme
değişiklikleri onlarda **görünür bir hata üretmez**: alan sessizce düşer. En
tehlikeli arıza biçimi budur, çünkü kimse fark etmez.

Backend artık politikayı yayınlıyor:

```
GET /api/client-policy/:istemci      (PUBLIC — giriş öncesi sorulur)
  → { minVersion, currentVersion, message? }
```

Panel açılışta ve 4 saatte bir okur; kendi sürümü `minVersion`'ın altındaysa
**güncelleme henüz inmemiş olsa bile** kapatılamaz kapı açılır ("Bu sürüm
sunucuyla uyumlu değil") ve kontrol tetiklenir.

| Karar | Neden |
|---|---|
| Değer **kodda sabit** (`src/config/client-version-policy.ts`), panelde ayar DEĞİL | Yanlış girilen bir sayı sahadaki TÜM panelleri kilitler. Kod yolu review + deploy'dan geçer; ayrıca "şu API sürümü şu paneli gerektirir" cümlesi backend deploy'uyla birlikte değişmeli, ayrı bir insan hamlesiyle değil |
| İstemci tarafı **FAIL-OPEN** | Uç okunamaz/bozuk/404 ise panel KİLİTLENMEZ. Projenin genel fail-closed eğiliminin bilinçli istisnası: buradaki "kapalı" tarafın bedeli, tek bozuk yanıtla fabrikanın tüm panellerinin durmasıdır |
| Uç **PUBLIC** | Panel politikayı giriş ekranından önce sorar. Kimlik aransaydı, sözleşmesi bozulduğu için giriş yapamayan panele "güncelle" diyebilme yolu kapanırdı |
| Uç **parametreli** (`/:istemci`) | Yeni istemci eklemek route'a değil `CLIENT_VERSION_POLICIES` kayıt defterine bir satır yazmaktır |

⚠️ **`minVersion`'ı yalnız gerçek bir kırılmada yükselt** (kaldırılan uç, değişen
sözleşme, sessizce düşen alan). Her sürümde otomatik yükseltmek, güncellemeyi
indirememiş her makineyi üretim dışı bırakır.

⚠️ **`minVersion` sahaya çıkan panel sürümünden BÜYÜK OLAMAZ.** Olsaydı en güncel
paneli kurmuş makine bile kapıyı görür ve indirecek bir şey olmadığı için o
kapıdan **çıkamazdı** — kendi kendini kurtaramayan tek arıza biçimi. Bekçi
`Teks-Erp/scripts/test_client_policy.ts` bunu kilitliyor (12 kontrol, iki negatif
sondayla kırmızı verdiği ölçüldü).

**Açık eksik:** mobil (tablet) tarafında sürüm kapısı **yok** — ölçüldü
(2026-08-27): istek başlıklarında sürüm yok, backend'de mobil kapısı yok,
istemcide kontrol yok. `runtimeVersion` bu deliği kapatmaz; o JS↔native uyumunu
bağlar, backend sözleşmesi hakkında bir şey söylemez. Üstelik runtimeVersion
artınca eski APK'lı tabletler hiç OTA almaz ve eski JS yeni backend'e karşı
süresiz koşar. Uç parametreli olduğu için mobil bağlanmak istediğinde yalnız
kayıt defterine bir satır + istemci kodu gerekir.

### `minVersion`'a ne zaman dokunulur — iki durum

`Teks-Erp/src/config/client-version-policy.ts` iki farklı iş yapan iki alan
taşır. Karıştırmak pahalı:

```ts
export const ELECTRON_VERSION_POLICY = {
  minVersion:     "2.8.1",   // ZORUNLU eşik — altındaki panel KİLİTLENİR
  currentVersion: "2.8.2",   // yalnız bilgi — "yayında ne var"
  message: "…",              // opsiyonel — kapı açılınca operatöre ne yazsın
};
```

**Durum 1 — sıradan geliştirme (vakaların çoğu): `minVersion`'a DOKUNMA.**
Yeni ekran, yeni rapor, yeni uç. Eski panel bunları çağırmıyor, çalışmaya devam
ediyor ve otomatik güncellemeyle zaten birkaç saat içinde yeni sürüme geçiyor.
`currentVersion`'ı güncellemek isteğe bağlıdır (bilgi amaçlı).

**Durum 2 — sözleşmeyi kırdın: `minVersion`'ı yükselt.**
Bir uç kaldırıldı · yol değişti · yanıt alanının adı/şekli değişti · zorunlu bir
parametre eklendi. Eski istemci bunu çağırınca ya hata alır ya da **sessizce
yanlış davranır** (alan düşer, ekranda boş görünür) — ikincisi en tehlikelisidir,
çünkü kimse fark etmez.

### ⚠️ Sıra pazarlık dışı

```
1. Yeni istemci sürümünü YAYINLA   (paketle + yayınla — indirilebilir OLSUN)
2. SONRA backend'i minVersion yükseltilmiş haliyle deploy et
```

Ters yapılırsa: backend "2.9.0 istiyorum" der, yayında 2.9.0 yoktur ve **her
makine kapıyı görür, indirecek bir şey olmadığı için çıkamaz.** Bekçi
(`scripts/test_client_policy.ts`) bunun bir kısmını yakalar — `minVersion`,
`Electron/package.json` sürümünden büyük olamaz — ama paketin gerçekten YAYINDA
olup olmadığına bakmaz. O sıra insana aittir.

**Örnek:** `/api/orders` yanıtından bir alan kaldırıldı, panel 2.9.0'da yeni
alana geçti.

```bash
# 1) Önce panel yayına
./deploy/electron-paketle.sh adnansahin 2.9.0 && ./deploy/electron-yayinla.sh
```
```ts
// 2) Sonra politika + backend deploy
minVersion: "2.9.0",   // eskiden 2.8.1
message: "Sipariş ekranı yenilendi; eski sürüm listeyi eksik gösteriyor.",
```

**Mobil aynı dosyada ama İKİ EKSENLİ** (`minVersion` + `minPaketTarihi`): tablette
JS düzeltmesi APK sürümünü değiştirmeden gider, dolayısıyla tek sayı "şu tarihli
paketten yeni ol" diyemez. `minPaketTarihi` bugün BOŞ (kimseyi kilitlemiyor);
doldurmadan önce o tarihi karşılayan paketin yayında olması şarttır.

**Emin değilsen dokunma.** Otomatik güncelleme zaten herkesi kısa sürede yeni
sürüme taşıyor; `minVersion` o mekanizmanın YETMEDİĞİ durumlar için acil frendir.

## Operatör ne görüyor — güncelleme ZORUNLUDUR

Kullanıcı kararı (2026-08-26): güncelleme ertelenemez. Akış iki aşamalı:

1. **İnerken ince şerit** — *"Yeni sürüm indiriliyor… %N · İndirme bitince uygulama
   yeniden başlatılacak — işinizi kaydedin."* İş akışı kesilmez.
2. **İndikten sonra tam ekran kapı** — kapatılamaz, tek çıkış *Şimdi kur ve yeniden
   başlat*. **2 dakikalık geri sayım** vardır; süre dolunca kurulum kendiliğinden
   başlar.
3. Windows izin penceresi → **Evet** → kurulum sessiz → panel kendiliğinden geri açılır.
4. İzin penceresine **Hayır** denirse (ya da kurulum başka bir sebeple başlamazsa)
   kapı kilitli kalmaz: 20 saniye içinde uygulama kapanmadıysa kilit açılır,
   *"Kurulum başlatılamadı"* yazar ve **5 dakika sonra yeniden dener**. Yeniden
   deneme aralığı ilk geri sayımdan uzun — aynı soruyu iki dakikada bir sormak
   operatörü "Hayır"a şartlandırır.

**Geri sayım neden var:** güncelleme vardiya ortasında inebilir. Kapı anında
kesseydi operatörün yarım kalan formu giderdi ve olay "bilgisayar kendi kendine
kapandı" diye okunurdu. Geri sayım zorunluluğu yumuşatmaz — yalnız "işini kaydet"
penceresi açar. Aynı sebeple 1. aşamadaki şerit de load-bearing: kapı sürpriz
olmasın diye önceden uyarır.

Süre `UpdateGate.tsx > GERI_SAYIM_SN` sabitidir.

---

## Bilinen sınırlar (bilinçli kararlar)

**① Windows izin penceresi (UAC) çıkar.** Uygulama "Program Files"a kurulu
(`nsis.perMachine: true`), orası korumalı bir klasör olduğu için her kurulumda bir
kez izin sorulur.

⚠️ **O makinedeki Windows hesabı yönetici DEĞİLSE operatör "Evet" diyemez ve
güncelleme o makinede kurulmaz** (panel eski sürümle çalışmaya devam eder, bozulmaz).
Fabrikadaki bir makinede bunu bir kez kontrol et. Sorun çıkarsa çözüm tek satırlık:
`package.json > build.nsis.perMachine: false` → uygulama kullanıcı klasörüne kurulur,
izin hiç sorulmaz. Bedeli, o geçiş için bir elle tur daha (eski kurulumu kaldır + yenisini kur).

**② Paket imzalı değil** (kod imzalama sertifikası yok). Güncelleme akışını
etkilemez — indirilen dosya `latest.yml` içindeki sha512 ile doğrulanır. Yalnız
setup dosyası **elle** çalıştırıldığında Windows SmartScreen uyarısı çıkar
("Daha fazla bilgi → Yine de çalıştır"). Bu, §2'deki son elle turda görülecek,
sonrasında görülmeyecek.

**③ Yayın adresi pakete derleme anında gömülür.** Adres sonradan değişirse kurulu
paneller eski adrese bakmaya devam eder. Kaçış kapısı var: **Bu Bilgisayar →
Güncelleme → Değiştir** ile o makineye özel adres yazılabilir (yeni setup
dağıtmaya gerek kalmaz). Kalıcı çözüm elbette `shared/update-feed.ts` +
`package.json`u güncelleyip yeni sürüm çıkarmaktır (2026-08-26'da tam olarak bu
yapıldı: adres `demo…/guncelleme/electron/` iken `guncelleme.…/electron/` oldu).

**④ Geri alma (rollback) otomatik değildir.** Bozuk bir sürüm yayınlanırsa: VPS'te
`latest.yml`i bir önceki sürümünkiyle değiştir (o sürümün `.exe` + `.blockmap`
dosyaları hâlâ orada durmalı — **eski sürümleri silme**). Ama sürüm numarası
geriye gitmediği için zaten güncellenmiş makineler kendiliğinden dönmez; onlara
düzeltilmiş **daha yüksek** bir numara (örn. 2.7.2) çıkarmak gerekir.

---

## Sorun giderme

| Belirti | Sebep | Çözüm |
|---|---|---|
| "Güncelleme sunucusuna ulaşılamadı" | O makinenin interneti yok / güvenlik duvarı | Makineden `curl` ile adresi dene |
| "Sunucuda sürüm dosyası bulunamadı" | `latest.yml` yüklenmemiş ya da nginx yolu yanlış | §1 doğrulama komutu |
| "Sertifika kabul edilmedi" | HTTPS sertifikası süresi dolmuş/geçersiz | Sertifikayı yenile ya da adresi `http://` yap |
| Şerit hiç çıkmıyor, hata da yok | Sürüm numarası artırılmamış | `package.json > version` |
| Bir makine güncellenmiyor, ötekiler oluyor | O makinede izin penceresine "Hayır" denmiş | Yönetici hesabıyla tekrar dene (bkz. sınır ①) |
| Ayrıntı gerekiyor | — | `%APPDATA%\Adnan Şahin ERP\logs\main.log` — `[updater]` satırları |
| Sunucu tarafı şüpheli | — | `ssh yenisunucu 'sudo docker logs --tail 50 tekserp-guncelleme'` |
| **Dosya sunucuda VAR ama 404 dönüyor** | Cloudflare eski bir 404'ü önbelleğe almış | Aşağıdaki "Cloudflare 404 tuzağı" |

---

## ⚠️ Cloudflare 404 tuzağı (2026-08-26'da yaşandı)

**Belirti:** dosya sunucuda duruyor, doğru boyutta, ama adres 404 dönüyor.
`?cb=123` gibi bir sorgu eklendiğinde **200** dönüyor.

**Sebep:** nginx `.exe` başlığı `add_header ... always` ile yazılırsa başlık
**hata yanıtlarına da** eklenir. Cloudflare origin'in talimatına uyar ve 404'ü
`max-age` süresince (bir hafta) önbelleğe alır. Paket yüklenmeden önce o adrese
tek bir istek gitmişse, dosya yüklendikten sonra bile bir hafta 404 döner.

**Kalıcı düzeltme yapıldı:** `always` kaldırıldı + `error_page 404 → no-store`
ikinci hattı eklendi (`deploy/guncelleme-sunucusu/nginx/default.conf`). Yeni
sürümlerde tekrarlamaz.

**Teşhis artık otomatik:** yayın script'leri (`electron-yayinla.sh` / `.ps1`)
yükleme sonrası her dosyayı önce temiz URL, sorun varsa `?onbellek-atla=` ile
dener. Origin 200 dönüp temiz URL dönmüyorsa **"ÖNBELLEK SORUNU"** diye bağırır
ve tam Purge-by-URL adresini basar; ikisi de 404 ise "dosya gerçekten
yüklenmemiş" der. Ayrıca `content-length` yerel dosyayla kıyaslanır — yarım
yüklenmiş dosya 200 döner ama eksiktir.

Dalların ikisi negatif sondayla ölçüldü ("dosya yok", "boyut uyuşmuyor").
**"Önbellekte kalmış 404" dalı isteyerek üretilemedi** ve bu iyi haber: yukarıdaki
`error_page 404 → no-store` ikinci hattı 404'lerin Cloudflare önbelleğine
girmesini zaten engelliyor (`cf-cache-status: DYNAMIC`). Dal kodda savunma
derinliği olarak duruyor — nginx kuralı değişirse tek sinyal o olur.

⚠️ **Eski sürümü sunucudan silmek yetmez.** Silinen dosya Cloudflare önbelleğinden
bir hafta daha servis edilir (`temiz URL: 200`, `?onbellek-atla=: 404`). Zararı
sınırlıdır (adresi yalnız onu indirmiş kişi bilir) ama yanlış bir sürümü
dolaşımdan gerçekten kaldırmak istiyorsan **purge şart**. Yayın script'i bunu
raporlamaz: kontroller "olması gereken" dosyalara bakar, "olmaması gereken"i
bilmek için silinen sürümlerin listesini tutmak gerekirdi.

**Yayını yükleme yapmadan denetlemek:**

```bash
./deploy/electron-yayinla.sh --dogrula          # yayındaki sürümü bul ve denetle
./deploy/electron-yayinla.sh --dogrula 2.8.1    # belirli sürümü bekle
```

Elle turda "bu makine güncelleme alamıyor" şüphesi doğduğunda ilk bakılacak yer:
sorun yayında mı, o makinede mi.

**Önbellekte kalmış bir 404'ü temizleme** (yalnız o güne ait sürüm için gerekir):
Cloudflare paneli → **Caching → Configuration → Purge Cache → Custom Purge →
By URL** → tam adresi yapıştır. Saniyeler içinde etkili olur.

**Doğrulama:**

```bash
# temiz URL ile origin'i yan yana koy — ikisi de 200 olmalı
curl -s -o /dev/null -w "temiz:  %{http_code}\n" https://guncelleme.etkiliyazilim.com/adnansahin/electron/TeksERP-<sürüm>-Setup.exe
curl -s -o /dev/null -w "origin: %{http_code}\n" "https://guncelleme.etkiliyazilim.com/adnansahin/electron/TeksERP-<sürüm>-Setup.exe?cb=1"
```

Farklıysa önbellek, ikisi de 404 ise dosya gerçekten yok.

## Kodun yeri

| Dosya | Ne yapar |
|---|---|
| `Electron/shared/update-feed.ts` | Yayın adresi — TEK KAYNAK |
| `Electron/electron/ipc/updater.ipc.ts` | Kontrol/indirme/kurulum + Türkçe hata çevirisi |
| `Electron/src/hooks/useUpdater.ts` | Arayüzün durum aboneliği |
| `Electron/src/components/layout/UpdateBanner.tsx` | "Yeni sürüm hazır" şeridi |
| `Electron/src/pages/GeneralSettings/UpdateSection.tsx` | Bu Bilgisayar → Güncelleme |
| `Electron/src/test/update-feed-url.test.ts` | Adres + dosya adı bekçisi |
| `deploy/electron-yayinla.ps1` | Yayınlama — Windows (sıra + doğrulama) |
| `deploy/electron-yayinla.sh` | Yayınlama — macOS/Linux |
| `deploy/guncelleme-sunucusu/` | VPS servisinin kaynağı (compose + nginx) |
