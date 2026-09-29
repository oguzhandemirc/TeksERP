# Electron Panelinin Otomatik Güncellenmesi

**Amaç:** fabrikadaki her bilgisayara tek tek setup taşımayı bitirmek. Yeni sürüm
bir kez yayınlanır, kurulu paneller kendiliğinden indirir ve **zorunlu olarak**
kurar.

**Durum (2026-08-27):** kod tarafı **uygulandı**, yayın sunucusu **kuruldu ve
doğrulandı** (§1). §2'deki bir kerelik son elle tur **2026-09-04'te yapıldı** (`docs/ops/FABRIKA-ISTEMCI-KURULUM-2026-09-04.md`); panel bugün kendi kendini günceller.

---

## Nasıl çalışıyor

```
Sen (geliştirme)                 VPS (yayın)                Fabrika (N bilgisayar)
─────────────────                ───────────                ──────────────────────
sürüm notunu yaz (kapı)
./deploy/electron-paketle.sh <müşteri>  ──►  3 dosya yüklenir  ──►  panel açılışta + 15 dk'da bir
release/<sürüm>/           latest.yml              latest.yml'e bakar
  TeksERP-x.y.z-Setup.exe  TeksERP-…-Setup.exe     yeni sürüm varsa arka planda
  TeksERP-…-Setup.exe.blockmap  …blockmap          indirir → ZORUNLU kapı
  latest.yml                                        (2 dk geri sayım) → kurar
```

> ⚠️ **Düzeltme (2026-09-03) — yukarıdaki diyagramın ilk iki satırı BAYAT.** (a) "sürüm no'yu artır" → doğrusu **"sürüm notunu yaz (kapı)"**: yama hanesini 2026-09-02'den beri script artırıyor (taban git etiketi `panel-v*`, doğrulayan yayın sunucusu — `scripts/lib/surum.mjs`); elle artırma yalnız küçük/büyük hane içindir ve o bir karardır. (b) `npm run build:win` → doğrusu **`./deploy/electron-paketle.sh <müşteri>`**; ham `build:win` bir önceki müşterinin adresiyle derler ve bu komut bu belgenin kendi "2. Paketle" bölümünde zaten yasaklı. Belge kendi içinde çelişiyordu ve çelişkinin yanlış tarafı en çok okunan diyagramdaydı.

- **Yayın adresi:** `https://guncelleme.etkiliyazilim.com/<kanal>/electron/` (fabrika: `adnansahin`)
  Tek kaynak: kanal kaydı `deploy/kanallar.json` (`yayin.panelFeed`); paketleme aynı değeri
  electron-builder'a (`app-update.yml`) ve koda (`shared/channel.ts` → updater) derleme anında verir.
  Kaynak tarafı `src/test/update-feed-url.test.ts`, paketin içi `scripts/kanal-kapisi.mjs panel-yayin` ile kilitli.
- **İndirme farksal:** `.blockmap` sayesinde 150 MB'ın tamamı değil, yalnız değişen
  bloklar iner. Bu yüzden blockmap dosyasını yüklemeyi atlama.
- **Kontrol ritmi 15 DAKİKA** (2026-09-04 kullanıcı kararı; eskiden 4 saat).
  Tek kaynak `Electron/shared/update-schedule.ts`, tek zamanlayıcı
  `electron/ipc/updater.ipc.ts`. Eski 4 saatlik pencerede sürüm çıktıktan sonra
  sahaya "kapatıp aç" deniyordu — yani otomatik güncellemenin çözdüğü iş elle
  yapılıyordu. Maliyet küçük: kontrol yalnız `latest.yml`i (birkaç yüz bayt)
  okur, makine başına saatte 4 istek. ⚠️ Arayüzde İKİNCİ bir zamanlayıcı
  kurulmaz (pencere/mount sayısı kadar çoğalır); topbar düğmesi yalnız
  `updater:check` çağırır. Bekçi: `src/test/update-check-interval.test.ts`.
- **Topbar'da "güncelleme denetle" düğmesi** (zilin solunda): durumu gösterir
  (kontrol ediliyor / güncel / iniyor / güncelleme hazır — birazdan kurulur). ⚠️ Hata KIRMIZI
  BASMAZ — durum eşlemesinin tek kaynağı `src/lib/updater-durum.ts`, `error` ve
  `idle` için `null` döner; internete çıkamayan makinede sürekli yanan kırmızı,
  gerçek güncelleme geldiğinde de görmezden gelinir. Hata metni Sistem →
  Güncelleme ekranındadır.
- **Kurulum ZORUNLU:** indirme bitince kapatılamaz bir kapı açılır, 2 dakikalık
  geri sayımdan sonra kurulum kendiliğinden başlar (bkz. "Operatör ne görüyor").
- **Kurulum tetiği HER EKRANDA:** kapı (`UpdateGate`) `App.tsx` `Root`ta TEK kez
  çizilir — giriş ekranında, tam panelde ve patron kabuğunda. Giriş ekranında
  kaydedilmemiş iş olmadığı için geri sayım 15 sn'dir (oturum açıkken 2 dk kalır).
  Eskiden kapı yalnız giriş sonrası kabuktaydı: giriş ekranında inen paket
  `pending`de bekledi, kapatıp açmak kurmadı (1.3.5 ve 1.3.6 testfabrikada bu
  yüzden kurulmadı, 2026-09-28). Sürüm politikası kilidi (`minVersion`) yalnız
  oturum açıkken uygulanır. Bekçi: `src/test/update-gate-her-ekranda.test.tsx`.
- **Kapanışta sessiz kurulum bilerek KAPALI** (`autoInstallOnAppQuit = false`):
  uygulama "Program Files"a kurulu olduğu için Windows izin sorar; kapanışta
  tetiklenseydi operatör gittikten sonra ekranda cevapsız bir izin penceresi
  asılı kalırdı. Kurulum hep operatör başındayken yapılır.

---

## §1 — VPS hazırlığı ✅ YAPILDI (2026-08-26)

Yayın servisi kuruldu ve uçtan uca doğrulandı. Burada anlatılan şey **tekrar
yapılacak bir iş değil**, ne olduğunun kaydıdır.

> ⚠️ **Sunucu değişti (2026-09-01):** yayın ESKİ paylaşımlı sunucudan (`91.217.119.138`,
> takma ad `yenisunucu`) **tekserp-vds**'e (`80.253.255.188`) taşındı ve DNS oraya
> döndü (`deploy/electron-yayinla.sh` `SSH_HEDEF=tekserp-yayin`). Aşağıdaki tablo
> BUGÜNKÜ durumu gösterir; ayrıntı `SUNUCU-ENVANTERI.md` · `VDS-TASIMA.md`.

Sunucuda nginx YOK — ortam **Docker + Traefik v3.5**. `demo.etkiliyazilim.com`
zaten `tekserp-demo` konteynerine (backend, port 4000) gidiyordu. Yayın için
ayrı bir statik servis eklendi:

| | |
|---|---|
| Servis | `/opt/stack/apps/tekserp-guncelleme/docker-compose.yml` (nginx:alpine, 64 MB) |
| Yayın klasörü | `/opt/stack/apps/tekserp-guncelleme/html/adnansahin/electron/` |
| Traefik kuralı | ``Host(`guncelleme.etkiliyazilim.com`)`` |
| Yol şeması | **müşteri bazlı**: `/<müşteri>/<ürün>/` → `/adnansahin/electron/`, mobil `/adnansahin/mobil/` |
| DNS | Cloudflare A kaydı → `80.253.255.188` (tekserp-vds), **proxy AÇIK (turuncu bulut)** |
| Yazma | yalnız `yayinci` hesabı (sudo YOK) — yayın betikleri `tekserp-yayin` takma adıyla bağlanır |
| SSH | **port 2222**, anahtarla: yayın `ssh tekserp-yayin` (`yayinci`) · yönetim `ssh tekserp-vds` (`oguzhan`, sudo) |

**Neden `tekserp-demo` konteynerinin `public/` klasörüne konulmadı:** orası imajın
parçası; demo her yeniden derlendiğinde yayın silinirdi. Ayrı servis + host
dizini, deploy'lardan bağımsız kalıcılık demek. (Fabrika sunucusunda da aynı
tuzak var: `kur.ps1` her deploy'da `app\` klasörünü komple değiştirir.)

### ⚠️ Cloudflare proxy'si AÇIK kalmalı — kapanırsa güncelleme sessizce durur

Sunucudaki sertifika bir **Cloudflare Origin CA** sertifikasıdır
(`*.etkiliyazilim.com` wildcard; tekserp-vds'te geçerlilik **2041-08-28**, 2026-09-01
kurulumunda ölçüldü; `traefik/dynamic/tls.yml` → default store). Eski belgelerdeki
"2036" değeri eski sunucudaki sertifikanın 2026-08-26 kaydıdır. ACME/Let's Encrypt
kullanılmıyor çünkü `etkiliyazilim.com` bu Cloudflare hesabının zone'unda değil,
DNS-01 çalışmıyor.

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
ssh tekserp-yayin 'mkdir -p /opt/stack/apps/tekserp-guncelleme/html/yenifabrika/electron'

# 2) Kanalı kayıt defterine ekle — deploy/kanallar.json (bütün kimlikler; bekçi:
#    node scripts/check-kanallar.mjs — iki kanal hiçbir kimliği paylaşamaz)

# 3) O kanal için paketle — adres pakete gömülür, çıktı release/yenifabrika/<sürüm>/
./deploy/electron-paketle.sh yenifabrika

# 4) Yayınla (hedef klasörü paketin kendi kimliğinden çözer; argüman niyettir)
./deploy/electron-yayinla.sh --musteri=yenifabrika
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
| Kanal kaydı tek kaynak (`deploy/kanallar.json`) | Kimlik (appId · ürün adı · paket adı · adres · başlık · varsayılan sunucu · etiket) derleme ANINDA enjekte edilir, ağaca yazılmaz; kaynakta literal kimlik yok (`check-kanallar` §4) | — |
| Bekçi `update-feed-url.test.ts` (`TEKSERP_KANAL=<kod>`) | Derlenecek kanalın kaydı çözülüyor ve gömülecek kimlik kayıtla birebir | Enjeksiyon derlemede düşerse |
| **Paketleme kapısı** (derlemeden SONRA) | Paketin İÇİNİ okur — `app-update.yml`, exe adı, asar'daki package.json (userData) ve ana süreç/arayüz (AUMID · çalışma anı adresi · varsayılan sunucu) — **argümanla verilen** kanalla kıyaslar, başka kanalın kimliği varsa durur | — |

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

### 0. Sürüm notunu yaz — ATLANIRSA PAKETLEME DURUR

`surum-notlari.json`'a bu tur için kayıt ekle (operatör diliyle, her madde
`panel`/`tablet`/`her-ikisi` etiketli), sonra:

```bash
node scripts/surum-notlari-kopyala.mjs
```

Not, güncelleme kurulduktan sonra ilk açılışta operatöre bir kez gösterilir.
Kurallar ve örnekler: [`SURUM-NOTLARI.md`](SURUM-NOTLARI.md).

### 1. Sürüm numarası — YAMA HANESİ OTOMATİK

`Electron/package.json > version`. Güncelleyici karşılaştırmayı bu numaraya göre
yapar; numara aynı kalırsa panel "en güncelim" der ve yeni setup'ı hiç indirmez.

Paketleme komutuna sürüm vermezsen **yama hanesi kendiliğinden artar**:

```
1.1.0  →  1.1.1     (otomatik — hata düzeltmesi)
1.1.1  →  1.2.0     (ELLE — yeni özellik, sözleşme değişikliği)
```

**Taban git etiketidir** (`panel-v*`), yerel `package.json` ya da yayın sunucusu
değil. Numara **koda** aittir, kanala değil: sunucudan okunsaydı her müşteri
kendi sayısını üretir ve iki farklı kod aynı numarayı taşıyabilirdi — *"panel
1.1.1'de şu hata var"* cümlesi anlamını yitirirdi. Yerel dosyadan okunsaydı
komutun her koşumu numarayı atlatırdı (bu komut bir turda birden çok kez koşar:
not kapısı kırmızı verir, derleme düşer).

**Etiketi sen atmıyorsun** — `electron-yayinla.sh` yayın bittikten sonra atıyor.
"Şu commit'ten sonrası yeni sürüm" diye bir karar vermek gerekmiyor; etiket
geriye dönük bir kayıt: *"sahaya çıkan kod tam olarak buydu."*

⚠️ **HEAD etiketin üstündeyken numara KORUNUR.** İki işi birden görür: komutun
tekrar koşumu, ve *aynı turda ikinci müşteri* — yayın adresi pakete derleme
anında gömüldüğü için her müşteri ayrı derleme ister, ama ikisi de aynı kodun
yayınıdır ve aynı numarayı taşımalıdır.

⚠️ **Etiket defteri bayatlayabilir** (yayın başka bir makineden yapıldı ve
etiket itilmedi; depo yeniden klonlandı). Bu yüzden hesaplanan numara yayındaki
`latest.yml` ile kıyaslanır: eşit ya da geride ise **durulur**. Yayın adresine
ulaşılamazsa kıyas atlanır ve uyarı basılır — bu bir doğrulama, kapı değil
(internetsiz paketleme mümkün kalmalı).

Kural + bekçi: `scripts/lib/surum.mjs` · `scripts/test_surum.mjs`.

### 2. Paketle — MÜŞTERİ BELİRTEREK

```bash
./deploy/electron-paketle.sh adnansahin          # yama hanesi otomatik artar
./deploy/electron-paketle.sh adnansahin 1.2.0    # haneyi elle ver
```

Script kanalın kimliğini kayıttan alır ve **derleme anında** iki derleyiciye verir
(electron-builder `-c.*` + `TEKSERP_KANAL` → electron-vite); ağaca kimlik yazmaz (yalnız
sürüm numarasını), derlemeden **sonra** paketin içini okuyup doğru kanalı gösterdiğini
doğrular. Hazırlık kanalı (`testfabrika`) pencere başlığında ve üst şeritte **"TEST FABRİKA"**
işaretini taşır; üretim kanalında işaret yoktur.

⚠️ **Ham `npm run build:win` kullanma.** O, ağaçtaki dinlenme tabanıyla (`varsayilan`
kanal) derler ve hiçbir kapıdan geçmez. Paketleme script'i tam olarak bu hatayı önlemek için var.

Çıktı: `Electron/release/<kanal>/<sürüm>/` içinde **üç dosya** (kanala ayrık: iki kanalın aynı sürümü aynı klasörde durmaz)

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

### 3. Yayınla

```bash
./deploy/electron-yayinla.sh --musteri=<kanal>     # macOS/Linux; Windows'ta Git Bash/WSL
```

`--musteri` NİYETTİR; hedef klasör paketin KENDİ kimliğinden çözülür
(`release/<kanal>/<sürüm>/win-unpacked/resources/app-update.yml` adresi ·
updater önbelleği · exe adı) ve ikisi aynı kanalı göstermezse ssh'tan ÖNCE durur.
Kanal kodu `deploy/kanallar.json`da kayıtlı olmalıdır. Script üç dosyanın varlığını
ve `latest.yml`in gerçekten o sürümü gösterdiğini doğrular, **doğru sırada** yükler
ve sonunda yayını dışarıdan kontrol eder. **Elle `scp` YOK** — kanal kapısı,
değişmezlik, sha512, yayın defteri ve etiket yalnız bu betikte.

Ağa çıkmadan prova: `./deploy/electron-yayinla.sh --musteri=<kanal> --kuru` — yerel kapıların
hepsi (kanal kaydı · paketin kimliği · üç dosya · `latest.yml` sürümü) koşar ve yükleme planı
basılır; ssh/scp/curl/etiket YOK (değişmezlik ve sha512 sunucu ister, kuru kipte atlanır).

> ⚠️ `deploy/electron-yayinla.ps1` EMEKLİ (2026-09-27): eski sunucuya, sabit
> `adnansahin` klasörüne ve kapısız yüklüyordu; artık hiçbir şey yüklemeden
> sıfır-dışı çıkan bir saplamadır.

> **`latest.yml` EN SON gider.** Önce giderse, henüz yüklenmemiş bir `.exe`yi
> işaret eder ve o aralıkta kontrol yapan paneller "sürüm dosyası bulunamadı"
> hatası alır (zararsız ama gereksiz alarm). Script'in asıl işi bu sırayı
> unutturmamaktır.
>
> **Dosya adını DEĞİŞTİRME.** `latest.yml` içindeki ad ile sunucudaki ad birebir
> aynı olmalı. (Bu yüzden paket adı ASCII'ye çevrildi: eski ad "Adnan Şahin
> ERP-…exe" idi ve `Ş` + boşluk aktarımda sessizce bozulup 404 üretirdi.)

### 3b. Yayın belirteci — betikler güncelleme sunucusunu ANONİM okumaz (3c')

Güncelleme sunucusunun kenarında Cloudflare Worker durur (Faz 3a): `/<kanal>/electron/*` ve
`/<kanal>/mobil/*` yalnız indirme belirteciyle (`X-TKL-Indirme`) açılır, anonim okuma 403 alır.
Yayın betikleri bu yüzden iki yoldan okur (tek kaynak `scripts/lib/yayin-okuma.mjs`, bekçi
`scripts/check-yayin-okuma.mjs`):

- **"Ne yayında"** → VDS diskinden SSH (`ssh tekserp-yayin`, `yayinci`, salt okuma). Sır gerekmez.
- **"Kenardan ne görünüyor"** (CF önbelleği · başlıklar · boyut) → satıcı yayın belirteciyle HTTP.

**Bir kez, yayın yapılan Mac'te:** belirteci satıcı portalından al ve
`~/.tekserp/yayin-belirteci` dosyasına TEK SATIR yaz, `chmod 600 ~/.tekserp/yayin-belirteci`.
Repoya, log'a, sürüm notuna GİRMEZ. Dosya yoksa / izinleri gevşekse / biçimsizse yayın betiği
**ilk ssh/scp'den ÖNCE durur** (anonim okumaya düşmez). `--kuru` belirteç istemez.

**Taze CLI belirteci (3bc, tercih edilen):** `~/.tekserp/yayin-belirteci-kaynagi.json` (600) varsa betik
her kanal/ürün için satıcı CLI'ından (`anahtar.ts indirme-belirteci`, ≤ 70 dk) taze belirteç üretir —
hazırlıkta yerel anahtar dizini, üretimde VDS'teki satıcı konteyneri (ssh). Kaynak dosyası yoksa yukarıdaki
dosya belirteci kullanılır; kaynak dosyası bozuksa ya da CLI başarısızsa betik DURUR (`docs/kurallar/surum-yayin.md`).

| Betik (3c' öncesi satır) | Ne okuyordu | Neden | Şimdi |
|---|---|---|---|
| `electron-yayinla.sh:121` | `latest.yml` (`--dogrula` sürümü) | denetlenecek sürüm | SSH `cat` (VDS) |
| `electron-yayinla.sh:223,225,241` | paket/`latest.yml` HEAD + boyut | önbellek ↔ origin ayrımı, yarım yükleme | `belirtecli_curl` |
| `electron-yayinla.sh:247` | `latest.yml` | yayında görünen sürüm = yüklenen | `belirtecli_curl` |
| `mobil-yayinla.mjs:228,229` | manifest/bundle/APK HEAD | önbellek ↔ origin, boyut, içerik tipi | `belirtecliFetch` |
| `mobil-yayinla.mjs:304` | manifest / APK künyesi GET | protokol başlıkları, manifest id, versionCode | `belirtecliFetch` |
| `surum.mjs:230` (`getir`) | panel `latest.yml` · OTA manifesti · APK künyesi | etiket defteri doğrulaması (`electron-paketle.sh:108`, `yayinla-ota.mjs:566,634`) | SSH (VDS) |
| `terfi.mjs:128` (`httpsOku`) | kaynak kanalın `latest.yml` · OTA manifesti · APK künyesi | terfi şartı ③ (beş yayıncı) | SSH (VDS) |

### 4. Doğrula

Script bunu kendi yapar. Elle (salt denetim, yükleme yok — belirteç ister):

```bash
./deploy/electron-yayinla.sh --musteri=<kanal> --dogrula
# ya da diskten:  ssh tekserp-yayin "cat /opt/stack/apps/tekserp-guncelleme/html/<kanal>/electron/latest.yml"
# version: <yeni sürüm>  ve  path: TeksERP-<sürüm>-Setup.exe  yazmalı
```

Fabrikadaki paneller en geç **15 dakika** içinde görür; beklemek istemezsen
herhangi bir makinede **topbar'daki güncelleme düğmesi** (zilin solunda) ya da
Sistem → Güncelleme → **Şimdi kontrol et**.

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

Panel açılışta ve 4 saatte bir okur (politika ekseni güncelleyicinin 15 dk'lık
ritminden AYRIDIR: politika bir backend deploy'uyla değişir); kendi sürümü
`minVersion`'ın altındaysa
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
./deploy/electron-paketle.sh adnansahin 2.9.0 && ./deploy/electron-yayinla.sh --musteri=adnansahin
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

1. **İnerken ince şerit** (yalnız tam panelde; giriş ekranında sağ alttaki sürüm
   rozeti "güncelleme iniyor" der) — *"Yeni sürüm indiriliyor… %N · İndirme bitince
   uygulama yeniden başlatılacak — işinizi kaydedin."* İş akışı kesilmez.
2. **İndikten sonra tam ekran kapı** — kapatılamaz, tek çıkış *Şimdi kur ve yeniden
   başlat*. **2 dakikalık geri sayım** vardır (giriş ekranında 15 sn); süre dolunca
   kurulum kendiliğinden başlar.
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

Süreler `UpdateGate.tsx > GERI_SAYIM_SN` (oturum) ve `GIRIS_GERI_SAYIM_SN` (giriş
ekranı) sabitleridir.

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

`nsis.packElevateHelper: true` beyanlıdır: app-builder-lib yalnız bu beyanla
(`perMachine` + `oneClick:false` iken) `latest.yml`e `isAdminRightsRequired: true`
yazar ve güncelleyici kurulumu doğrudan `elevate.exe` ile başlatır. Beyansız
yol da çalışır ama önce kurulumu yetkisiz başlatıp EACCES/740 alır, sonra
`elevate.exe`ye düşer (bir hata satırı + bir deneme boşa).

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
| Sunucu tarafı şüpheli | — | `ssh tekserp-vds 'sudo docker logs --tail 50 tekserp-guncelleme'` |
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

**Teşhis artık otomatik:** yayın script'i (`electron-yayinla.sh`)
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
./deploy/electron-yayinla.sh --musteri=adnansahin --dogrula          # yayındaki sürümü bul ve denetle
./deploy/electron-yayinla.sh --musteri=adnansahin --dogrula 2.8.1    # belirli sürümü bekle
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
| `Electron/shared/update-schedule.ts` | Kontrol ritmi (15 dk) — TEK KAYNAK |
| `Electron/src/lib/updater-durum.ts` | Durum → kısa metin/renk eşlemesi — TEK KAYNAK |
| `Electron/src/components/layout/GuncellemeDugmesi.tsx` | Topbar'daki denetleme düğmesi |
| `Electron/src/components/layout/UpdateGate.tsx` | İnerken şerit (`UpdateDownloadStrip`, yalnız AppShell) + zorunlu kurulum kapısı (`UpdateGate`, `App.tsx` `Root`ta tek) |
| `Electron/src/components/layout/SurumNotlariDialog.tsx` | "Neler değişti" penceresi |
| `Electron/src/lib/surum-notlari.ts` | Gösterim kararı (saf, test edilir) |
| `surum-notlari.json` + `scripts/check-surum-notlari.mjs` | Not kaynağı + bekçi |
| `Electron/src/pages/GeneralSettings/UpdateSection.tsx` | Bu Bilgisayar → Güncelleme |
| `Electron/src/test/update-feed-url.test.ts` | Adres + dosya adı bekçisi |
| `deploy/electron-yayinla.ps1` | EMEKLİ saplama — hiçbir şey yüklemez, sıfır-dışı çıkar |
| `deploy/electron-yayinla.sh` | Yayınlama — tek yol (Windows'ta Git Bash/WSL) |
| `deploy/kanallar.json` + `scripts/check-kanallar.mjs` | Kanal kimliklerinin tek kaynağı + çakışma bekçisi |
| `deploy/guncelleme-sunucusu/` | VPS servisinin kaynağı (compose + nginx) |
