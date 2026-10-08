# İndirme kapısı Worker'ı — kurulum, prova, geçiş, geri alma

> **Durum (ölçüldü 2026-10-08):** kapı **`indir.etkiliyazilim.com`da YAYINDA** (Worker `tekserp-indirme-kapisi`, rota `indir.etkiliyazilim.com/*`, VDS kökeni `tekserp-indir` — §11); eski `guncelleme.etkiliyazilim.com` kapı DIŞINDA, belirteçsiz iner (adnansahin 9/9). **Kapı eski `guncelleme.etkiliyazilim.com`da AÇILMAZ** (kullanıcı kararı 2026-10-03, `docs/plan/DEMOFABRIKA-KURULUM-BULGULARI.md` §D-1): yeni alt adreste (`indir.etkiliyazilim.com`, karar 2026-10-07) tek ortak paketle (plan 3.1) birlikte açılır, klasörler güncelleme grubuna göredir (`/test` · `/oncu` · `/genel`); eski adres adnansahin için kapı DIŞINDA aynen kalır — o ana makineye rota bağlanmaz. testfabrika ve hazırlık satıcısı emekli (2026-10-05): `indirmeListesi.hazirlik` boş.
> **adnansahin belirteç GÖNDERMEZ:** sahadaki panel 1.3.7 · tablet OTA 1.0.12 · APK 1.0.0 · backend 2.11.2 belirteç kodundan (panel 3b · tablet 3c · fabrika ucu, hepsi 2026-09-29) ÖNCEDİR; adnansahin'e yeni güncelleme gönderilmez, yeni sisteme sonra alınır (kullanıcı kararı 2026-10-06) ⇒ `guncelleme.etkiliyazilim.com`a Worker rotası BAĞLANMAZ.
> **İstemci zinciri (dilim 3bc):** fabrika ucu `GET /api/license/indirme-belirteci?urun=electron|mobil` süresi dolmuş belirteci vermez, dolmaya < 15 dk kalmışsa yoklamayı dürter; panel (`updater.ipc.ts` + `/download-token`) her denetimde `X-TKL-Indirme`, tablet (`mobil/src/services/downloadToken.service.ts`) her OTA denetiminden önce `tkl` extra param + APK isteğinde başlık, açılışta native denetim bayat paramla 403 alırsa JS 5 sn sonra tazeleyip yeniden dener; belirteç alınamazsa HER İKİSİ BAŞLIKSIZ ister (geçiş listesi). Yayın betikleri önce taze CLI belirteci (`docs/kurallar/surum-yayin.md`). Senaryo L22/L24 bu zinciri gerçek Worker modülüyle koşar.
> **İNDİRME listesi (L2-8, lisans v2 §2.1/§2.5):** Worker anahtarları tek listeden okur (`uretim`; tek satıcı — başka liste adı 503); her satır kid × izinli kanal kümesi × pencere (sertifikanınki) taşır. Dönem töreni (yılda bir) yapıştırılacak satırı hazır basar — §8. Eski `anahtarlar: [{kid, x}]` biçimi kısıtsız olarak BİR Worker sürümü daha tanınır.
> **Kod:** `deploy/guncelleme-sunucusu/worker/indirme-kapisi.js` · **Kâhin:** `Teks-Erp/src/lib/license/protocol/indirme.ts` · **Bekçi:** `Teks-Erp/scripts/test_indirme_kapisi.ts` · **Sözleşme:** `docs/design/LISANS-PROTOKOLU.md` (İNDİRME) · plan Faz 3a (`docs/design/LISANS-KOD-KORUMA.md`).

## 0. Ne yapar, ne yapmaz

- Yeni indirme adresinde (`indir.etkiliyazilim.com`, §D-1; eski `guncelleme.etkiliyazilim.com` kapı dışında) `/<kanal>/electron/*`, `/<kanal>/mobil/*` ve `/<kanal>/backend/*` (Dağıtım v2 — backend paketleri ve sürüm işaretçisi, `docs/design/GUNCELLEYICI.md` §1) isteklerini İNDİRME belirteciyle kapılar; ürün kümesi kâhinin `DOWNLOAD_PRODUCTS`ıyla birebir (`URUN_DIZINLERI`, bekçi §8a). Belirteç fabrikanın KENDİ backend'inden gelir (`GET /api/license/indirme-belirteci`), Ed25519 imzalıdır, kanal + ürün önekine ve kuruluma bağlıdır, ömrü ≤ 70 dk.
- Belirteç üç yoldan okunur, bu sırayla: başlık `X-TKL-Indirme` (panel, electron-updater `requestHeaders`) · tabletin manifest isteğindeki `Expo-Extra-Params` başlığında `tkl` anahtarı (`Updates.setExtraParamAsync`) · sorgu `?t=`. İlk bulunan karar verir.
- Doğrulanan istek origin'e (VDS nginx) **belirteçsiz** gider: `?t=`, `X-TKL-Indirme` ve `Expo-Extra-Params` düşer, `Range` korunur ⇒ önbellek belirteç başına bölünmez.
- Önbellek: değişmez dosya (exe · blockmap · apk · OTA varlığı) `cacheEverything` + `cacheTtlByStatus` (200–299 `onbellekSn`, 404 bir saniye, 5xx hiç — bir hafta tutulan 404 dersi, `deploy/guncelleme-sunucusu/README.md` ①); değişken dosya (`*.yml` · `manifest` · `surum.json` · backend `son.json` ve zincirli ikizleri `son-zincir.json` · `surum-zincir.json` · `pg-zincir.json`) cf seçeneksiz — origin'in `no-cache`i geçerli kalır.
- Kapsam kararı origin'in GÖRECEĞİ yolda verilir: yüzde kodu çözülür, çoklu bölü katlanır, büyük/küçük harf fark etmez (`/k/%65lectron/…`, `//k/electron/…` kapılıdır). Kapsam DIŞI her istek olduğu gibi geçer.
- Ret: 403 + kısa Türkçe gövde + `X-TKL-Kod` başlığı, `no-store`. Kodlar §9'da.
- Worker imzalayamaz (yalnız açık anahtar); satıcıya ya da fabrikaya çağrı yapmaz; durum tutmaz.

## 1. Ön koşullar — kapı açılmadan önce

1. **İNDİRME anahtarı:** kök imzalı `INDIRME` kullanımlı sertifika (kid `ind-…`); Worker'a yalnız açık yarısı ve onun liste satırı (`{kid, x, kanallar, baslangic, bitis}`) girer (özel yarı satıcıda, `docs/ops/SATICI-KURULUM.md`). `x` 43 karakter base64url'dir. Satırın hazır metni tören künyesindedir (`capaSatirlari.CF_WORKER_INDIRME`, listesi `CF_WORKER_LISTESI`); ilk törenden kalan eski künye (yalnız `kid` + `x`) için `kanallar` = `deploy/kanallar.json`da o çapa kipindeki kanallar, pencere = künyenin `indirme.baslangic` / `indirme.bitis`i.
2. **İstemciler belirteç gönderiyor:** panel (3b) ve tablet (3c) belirteç kodu sahada; 3c' yayın betikleri Worker'dan ÖNCE iner. Belirteç kodunu taşıyan İLK sürüm eski anonim yoldan iner — geçiş listesi bu yüzden vardır.
3. **Geçiş listesi hazır:** her kanalın BUGÜNKÜ sürüm dosyaları — `latest.yml`, güncel exe + `.blockmap`, OTA `manifest`(ler), güncel OTA damga dizini (önek), `apk/surum.json`, güncel apk. Adları yayın klasöründen okuyarak yaz, elle tahmin etme.
4. **Yayıncı belirteci üretildi (dilim 3bc):** yayın betiklerinin kenar doğrulaması (`?onbellek-atla=`/`cb=` sorgulu `HEAD`/`GET`) `~/.tekserp/yayin-belirteci`ndeki belirteci `X-TKL-Indirme` başlığıyla gönderir. 3c' bu değeri yalnız OPAK biçimle denetler (`[A-Za-z0-9._~+/=-]{16,8192}`); Worker ise satıcının İNDİRME anahtarıyla imzalı Ed25519 JWS (`typ: tekserp-indirme`, yayın kanalının öneki) ister. Yayıncı belirteci üretimi inmeden ve belirteç yayın makinesine yazılmadan rota BAĞLANMAZ — aksi hâlde dosyalar SSH ile yüklenir ama kenar doğrulaması 403 `JWS_BICIM` ile durur. Worker belirteç dışı sorguyu origin'e aynen iletir (`t` hariç), önbellek anahtarı belirteçsiz URL'dir; önbellek atlatması bu yüzden kapı arkasında da çalışır (bekçi §4o–§4q).

5. **Rota yalnız adın tamamıdır, joker rota YASAK:** Workers Routes'ta `*.etkiliyazilim.com/*` gibi joker bir rota Worker'ı `guncelleme.etkiliyazilim.com`un da önüne koyar ve belirteç göndermeyen adnansahin 403 `INDIRME_BELIRTEC_YOK` alır (olay 2026-10-08: kurulum sırasında listede joker rota belirdi, adnansahin birkaç dakika 403 aldı; rota silinince düzeldi). Rota eklendikten ya da değiştirildikten HEMEN sonra rota listesi okunur (yalnız `indir.etkiliyazilim.com/*` olmalı) ve adnansahin ölçümü koşulur: `node Teks-Erp-wt/indirme-kapisi-olc.mjs --adnansahin` → 9/9.

## 2. Ayar — `TKL_INDIRME_AYAR`

Worker değişkeni (panelde Settings → Variables and Secrets; tür JSON ya da düz metin, ikisi de okunur). Verilen alanlar dosyadaki `VARSAYILAN_AYAR`ın üstüne yazılır:

```json
{
  "indirmeListesi": {
    "uretim": [{ "kid": "ind-2026-2", "x": "<43 karakter base64url>", "kanallar": ["test", "oncu", "genel"], "baslangic": "<ISO Z>", "bitis": "<ISO Z>" }]
  },
  "gecisListesi": [
    { "yol": "/genel/electron/latest.yml", "bitis": "2026-12-15T00:00:00Z" },
    { "onek": "/genel/mobil/ota/54.2/1790804528727/", "bitis": "2026-12-15T00:00:00Z" }
  ],
  "varlikBelirteci": false,
  "onbellekSn": 604800
}
```

- **İNDİRME listesi:** `uretim` dizisine satıcının (kök `kok-*`) İNDİRME anahtarları girer; eski `hazirlik` dizisi ayarda bulunursa (boş da olsa) ayar GEÇERSİZ (503) — Worker ile ayar BİRLİKTE yayınlanır (tek ortak paket O14c). Satır alanlarının HEPSİ zorunludur: `kid` (`ind-…`) · `x` · `kanallar` (1–64 kanal kodu; güncelleme grupları, `deploy/dagitim.json` `gruplar`) · `baslangic` / `bitis` (sertifikanın penceresi, ISO `Z`, en çok 730 gün). Belirteç YALNIZ kid listedeyse, belirtecin kanalı satırın kümesindeyse ve şimdi pencere içindeyse (±10 dk) geçer; değilse 403 `JWS_KID` · `INDIRME_KANAL` · `INDIRME_PENCERE`. Penceresi geçmiş satır ayarı bozmaz (temizlik §8).
- **Eski biçim (`anahtarlar`):** `[{kid, x}]` — kanal ve pencere KISITSIZ; yalnız L2-8 öncesi ayarın bir Worker sürümü daha çalışması için. Yeni anahtar buraya YAZILMAZ; satır yalnız `kid` + `x` taşıyabilir (kanallı satır buraya yapıştırılırsa 503). Bir sonraki Worker sürümünde kalkar.
- **Fail-closed:** tanınmayan alan (üst düzeyde, listede, satırda), biçimsiz anahtar, çift kid ya da aynı `x` iki satırda (eski biçim dahil), `uretim` dışında liste adı, boş/biçimsiz/çift kanal kümesi, eksik/ters/730 günden uzun pencere, `yol`+`onek` birlikte, `bitis`siz ya da 90 günden uzak bitişli geçiş satırı, `/<kanal>/<ürün>/`dan sığ önek ⇒ AYAR GEÇERSİZ ⇒ kapsamdaki her istek **503 `AYAR_GECERSIZ`**. Kapsam dışı etkilenmez. Sessiz gevşeme yoktur: yazım hatası kapıyı açmaz, kapatır — bu yüzden Deploy'dan ÖNCE §8 adım 2'deki yerel denetim koşulur.
- `yol` tam eşleşmedir; `onek` önekin ALTINDAKİ dosyaları kapsar (önekin kendisini değil). İkisi de kaçış dizisi (`..` · `//` · `%2e` · `%2f` · `%5c` · `%00` · `\`) taşıyamaz.
- `varlikBelirteci` (varsayılan **kapalı**): kapalıyken OTA varlıkları (`/<kanal>/mobil/ota/<rv>/<damga>/…`) anonim geçer — içerik adreslidir, kapı manifesttedir (tasarım §3c geri çekilmesi). Açıkken varlıklar da kapılanır ve belirteçle alınan manifestin imza DIŞI `extensions.assetRequestHeaders` alanına her varlık anahtarı için aynı belirteç yazılır (Worker yeni belirteç basamaz). Açmadan önce bir test kurulumu + gerçek tablette ölç (tablet varlık isteğine başlığı ekliyor mu).

## 3. Panelden yapıştırma (wrangler yok)

1. Cloudflare → Workers & Pages → Create → Worker → ad `tekserp-indirme-kapisi` → Deploy (şablon) → **Edit code**.
2. İçeriği `deploy/guncelleme-sunucusu/worker/indirme-kapisi.js` ile **değiştir** (ES modülü, `export default { fetch }`) → Deploy.
3. Settings → Variables → `TKL_INDIRME_AYAR` (§2). Uyumluluk tarihi güncel kalsın (WebCrypto `Ed25519` standart adıyla).
4. Rota henüz BAĞLAMA — §4 provası önce.
5. **`workers.dev` alt adını KAPAT** (Worker → Settings → Domains & Routes): açık kalırsa Worker rotasız bir ikinci adresten de çağrılabilir; kapı yalnız rota üzerinden çalışır.
6. Rota bağlanırken §1 adım 5: adın tamamı, joker yok; rotadan hemen sonra adnansahin ölçümü.

## 4. Prova — yeni adreste, önce `test` grubu

1. Rota: `indir.etkiliyazilim.com/*` → `tekserp-indirme-kapisi` — ana makinenin TAMAMI (yol önekli dar rota `//<grup>/…` ve `/%xx…` biçimleriyle atlatılabilir; origin bunları sunar, ölçüldü 2026-10-06). `guncelleme.etkiliyazilim.com`a rota BAĞLANMAZ (§D-1).
2. **Rota "fail closed":** Workers Routes → rota → *Request limit failure mode* = **Fail closed (block)**. Ücretsiz planın günlük 100 bin istek sınırı aşılırsa Worker atlanıp dosyalar AÇILMASIN; aşımda istemci o gün hata alır, ertesi gün devam eder (güncelleme ertelenir, kapı delinmez). Bütçe: panel yoklaması `latest.yml` başına 1 istek + indirmede exe/blockmap birkaç istek; tablet manifest başına 1 + varlıklar. Kullanımı Workers Analytics'ten günlük izle.
3. Ölç (belirteç: yayıncı CLI'ı `anahtar.js indirme-belirteci --kanal=test --dk=60` — `~/.tekserp/yayin-belirteci-kaynagi.json`daki komut; belirteç ekrana basılmaz):
   - belirteçsiz `curl -sI …/test/electron/latest.yml` → **403**, `x-tkl-kod: INDIRME_BELIRTEC_YOK`;
   - `-H "X-TKL-Indirme: <belirteç>"` → **200**; aynı dosya `?t=<belirteç>` → 200; `HEAD` → 200; biçimsiz belirteç → 403 `JWS_BICIM`;
   - electron belirteciyle `/test/mobil/apk/surum.json` → 403 `INDIRME_YOL`; başka grup yolu → 403 `INDIRME_KANAL`/`INDIRME_YOL`;
   - exe'yi İKİ AYRI belirteçle iste: ikincisinde `cf-cache-status: HIT` (önbellek belirteç başına bölünmüyor);
   - `/test/%65lectron/…`, `//test/electron/…` → 403;
   - backend belirteciyle `/test/backend/son.json` → kapıdan geçer; electron belirteciyle → 403 `INDIRME_YOL`;
   - eski adres değişmedi: `guncelleme.etkiliyazilim.com/adnansahin/electron/latest.yml` belirteçsiz → 200, `X-TKL-Kod` yok.
   Bu adım Senaryo L15'in "WebCrypto çalışma zamanı" kısmını kapatır (bekçi Node'un WebCrypto'sunu ölçer, workerd'i değil).
4. Yeşilse `oncu` ve `genel` grupları aynı adımlarla; satırların `kanallar` kümesi grupları taşır.

## 5. Origin yalnız Cloudflare'i kabul eder

Worker yalnız Cloudflare üzerinden gelen isteği görür; VDS'e doğrudan (IP ya da `Host` başlığıyla) gelen istek kapıyı atlar. Origin CA sertifikası tarayıcıya güvenilmez ama `curl -k` onu umursamaz ⇒ daraltma şarttır:

- Traefik'te güncelleme servisinin yönlendiricisine `ipAllowList` ara katmanı: `sourceRange` = Cloudflare'in yayımladığı aralıklar (`https://www.cloudflare.com/ips-v4` · `ips-v6`). Traefik doğrudan CF kenarının TCP bağlantısını gördüğü için varsayılan `ipStrategy` (uzak adres) doğrudur; `depth` KULLANMA (başlık sahtelenebilir).
- Aralıklar değişebilir: listeyi değişiklik günlüğüyle yaz, `vds-dogrula.sh` tabanına ekle.
- Daha güçlü seçenek (ücretsiz): Authenticated Origin Pulls — origin yalnız CF'nin istemci sertifikasını taşıyan TLS'i kabul eder. IP listesiyle birlikte kullanılabilir.
- Ölç: VDS dışından `curl -sk --resolve indir.etkiliyazilim.com:443:<VDS-IP> https://indir.etkiliyazilim.com/test/electron/latest.yml` → **403/bağlantı reddi**; aynı adres CF üzerinden belirteçle → 200. Bu VDS değişikliği ayrı ve kullanıcı cümlesiyle yapılır; SAHINSRV'e dokunmaz.

## 6. Yayılım ölçümü — geçiş listesi ne zaman kapanır

Kapanış TAKVİMLE değil ÖLÇÜMLE verilir (bitiş tarihi yalnız emniyet süresidir):

1. Portal: yoklamanın sağlık özetindeki istemci tür × sürüm SAYISI (`LISANS-PROTOKOLU.md`, yoklama allowlist'i). Her kanal için panel sürümlerinin HEPSİ belirteç gönderen sürümde (3b ve sonrası), tablet OTA'larının HEPSİ 3c ve sonrasında olmalı.
2. Worker analitiği yalnız yan göstergedir (403 sayısı yükselirse belirteç göndermeyen istemci kalmıştır); karar 1. maddedeki dağılımdır.
3. Dağılım %100 olunca o kanalın satırlarını `gecisListesi`nden sil → Deploy. Ölç: aynı dosyalar belirteçsiz → 403; belirteçli istemci → 200.

## 7. Geri alma — tercih sırasıyla

1. **Ayar geri alma (dakika):** geçiş satırlarını yeniden ekle (bitiş ≤ 90 gün) → Deploy. Anonim eski istemci yeniden iner, kapı açık kalır.
2. **Önceki Worker sürümü:** Workers → Deployments → önceki sürüm → Rollback.
3. **Rota kaldırma:** rotayı sil → her şey BUGÜNKÜ gibi anonim açılır. Bu kapıyı bilinçli olarak açmaktır; yalnız kullanıcı cümlesiyle ve kısa süre için.
- 503 `AYAR_GECERSIZ` görülürse sebep yazım hatasıdır: ayarı önceki geçerli hâline döndür (1).

## 8. Anahtar döndürme — dönem töreninden sonra (yılda bir)

Satıcı yeni İNDİRME anahtarını anahtar birimine kurulduğu DAKİKA kullanmaya başlar (en yeni geçerli sertifika). Bu yüzden Worker listesi yeni satırı ÖNCE taşır; eski satır yerinde kalır ve penceresi (sertifikasının bitişi + 10 dk) dolunca kendiliğinden kapanır — örtüşme 30 gündür. Sıra tören runbook'unda: [`URETIM-SATICI-TOREN.md`](URETIM-SATICI-TOREN.md) §8 adım 4 (VDS'e kurmadan önce).

1. Tören çıktısındaki iki satırı al (ekranda "CF Worker" adımı ya da `DONEM-KUNYE.json` → `capaSatirlari`): `CF_WORKER_LISTESI` (`uretim`) ve `CF_WORKER_INDIRME` (tek satır JSON). Yapıştırma birimi şudur — `<liste>` dizisinin SONUNA bir eleman:

<!-- indirme-listesi-sablonu -->
```json
{
  "indirmeListesi": {
    "uretim": [
      { "kid": "ind-2026-2", "x": "<eski satır, olduğu gibi kalır>", "kanallar": ["test", "oncu", "genel"], "baslangic": "<eski satır>", "bitis": "<eski satır>" },
      { "kid": "ind-2027-1", "x": "<künye CF_WORKER_INDIRME satırı — olduğu gibi yapıştır>", "kanallar": ["test", "oncu", "genel"], "baslangic": "<künye>", "bitis": "<künye>" }
    ]
  }
}
```

2. **Deploy'dan önce yerelde ölç** (repo kökünden; ayarın TAMAMI `~/tkl-indirme-ayar.json`da, panelden kopyalanmış + yeni satır eklenmiş hâliyle):
   ```sh
   node --input-type=module -e 'import fs from "node:fs"; const w = await import("./deploy/guncelleme-sunucusu/worker/indirme-kapisi.js"); const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); console.log(w.ayarCoz({ ...w.VARSAYILAN_AYAR, ...a }, Date.now()))' ~/tkl-indirme-ayar.json
   ```
   Beklenen `{ ok: true, … }`. `ok: false` ise `neden` yazım hatasını söyler — panele YAPIŞTIRMA (yapıştırılırsa kapsamdaki her istek 503).
3. Panel → Worker → Settings → Variables → `TKL_INDIRME_AYAR` → aynı JSON → Deploy. Ölç: yeni kid'le basılmış belirteç (törenden sonra satıcı yüklenince fabrikadan) 200; aynı kanalın eski kid'li belirteci de 200 (örtüşme).
4. **Temizlik (isteğe bağlı, acil değil):** eski satırın `bitis`i geçtikten sonra satırı sil → yerel denetim → Deploy. Silmemek güvenlidir (pencere dışı satır 403 `INDIRME_PENCERE` verir), yalnız liste kalabalıklaşır.
5. **Acil durum (İNDİRME anahtarı ele geçti):** iptal edilen kid'in satırını pencerenin dolmasını BEKLEMEDEN sil (iptal belgesi Worker'a ulaşmaz — Worker'daki karşılığı satırın yokluğudur) ve yeni satırı aynı Deploy'da ekle.
6. **Yeni kanal (yeni müşteri):** kanal `deploy/kanallar.json`a girdikten sonra kendi çapa listesindeki HER etkin satırın `kanallar`ına eklenir (örtüşme sırasında iki satır) → yerel denetim → Deploy; sonraki törenin satırı onu kendiliğinden taşır.

## 9. Ret kodları (`X-TKL-Kod`)

| Kod | Durum | Anlam |
|---|---|---|
| `INDIRME_BELIRTEC_YOK` | 403 | başlık, `tkl`, `?t=` üçü de yok (ve geçiş listesinde değil) |
| `INDIRME_YOL` | 403 | belirteç geçerli ama istenen yol önekinin altında değil / kaçış dizisi |
| `JWS_BICIM` · `JWS_BASLIK` · `JWS_ALG` · `JWS_TYP` · `JWS_KID` · `JWS_IMZA` | 403 | protokol kodları (`LISANS-PROTOKOLU.md` §1) |
| `BELGE_SURUM` · `BELGE_SEMA` · `BELGE_SURESI_DOLDU` · `INDIRME_OMUR` | 403 | belge sürümü/şeması, süre (±10 dk), ömür > 70 dk |
| `INDIRME_PENCERE` | 403 | belirteci imzalayan kid'in liste satırı şu an pencere dışında (başlamadı ya da bitti, ±10 dk) — döndürmede yeni satır eklenmemiş ya da eski satır dolmuş |
| `INDIRME_KANAL` | 403 | belirtecin kanalı, imzalayan kid'in satırındaki kanal kümesinde değil — çoğunlukla yeni grup satıra eklenmemiş |
| `YONTEM` | 405 | kapsamda GET/HEAD dışı yöntem |
| `AYAR_GECERSIZ` | 503 | `TKL_INDIRME_AYAR` geçersiz (§2) |

## 10. Bilinen sınırlar

- Cloudflare CDN koşulları "orantısız büyük dosya" sunumunu kısıtlayabilir; kısıt gelirse aynı Worker dosyaları R2'den sunar (ücretsiz katman 10 GB-ay, çıkış ücretsiz) — ayrı dilim.
- Bekçi Worker'ı Node'un WebCrypto'suyla koşar; workerd ölçümü §4'teki provadır.
- `varlikBelirteci` gerçek tablette ölçülmeden açılmaz.

## 11. Yeni adres `indir.etkiliyazilim.com` — tek ortak paket (O9; yayın 3.2, kullanıcıyla)

- **Durum: YAYINDA (2026-10-08).** Yapılan adımlar, sırasıyla:
  1. VDS kökeni: `/opt/stack/apps/tekserp-indir` (repo `a92359530`, compose `deploy/guncelleme-sunucusu/indir/`, yönlendirici `tekserp-indir`, ara katmanlar `tekserp-indir-cf` → `tekserp-indir-hiz`). Kök sahipli dizinler `oguzhan`ın etkileşimsiz sudo'su olmadığından TEK SEFERLİK YARDIMCI KONTEYNERLE yazıldı (`SATICI-KURULUM.md` §12 kalıbı); `html/` + `defter/` → `yayinci`. Envanter: `SUNUCU-ENVANTERI.md`.
  2. Worker `tekserp-indirme-kapisi`: kod `deploy/guncelleme-sunucusu/worker/indirme-kapisi.js`; değişken `TKL_INDIRME_AYAR` = `worker/indir-ayar.json`, tür **Text**; `workers.dev` alt adı KAPALI.
  3. Rota `indir.etkiliyazilim.com/*` → `tekserp-indirme-kapisi`. ⚠️ *Request limit failure mode* = Fail closed panelde **TEYİT EDİLMEDİ** — açık iş (Workers Routes → rota → ayarı oku, değilse Fail closed yap).
  4. DNS: `A indir` → `80.253.255.188`, proxy AÇIK (turuncu bulut).
  - Ölçüm: `node Teks-Erp-wt/indir-olc.mjs` 15/15 · `--adnansahin` 9/9 · `deploy/vds-dogrula.sh` önce/sonra AYNI. Belirteçsiz `/test/electron/latest.yml` → 403 `INDIRME_BELIRTEC_YOK`; köke doğrudan (`--resolve …:80.253.255.188`) → 403.
  - **Olay (2026-10-08):** kurulum sırasında rota listesinde `*.etkiliyazilim.com/*` joker rotası belirdi → `guncelleme.etkiliyazilim.com/adnansahin` birkaç dakika 403 `INDIRME_BELIRTEC_YOK` aldı; joker rota silindi, adnansahin yeniden 9/9. Ders §1 adım 5'te.

- **3.2 kararları (kullanıcı 2026-10-07):**
  - Adres `indir.etkiliyazilim.com`.
  - Gruplar (klasörler) `test` · `oncu` · `genel`.
  - `ind-2026` yeni adreste kabul EDİLMEZ (K-5); ayarda yalnız `ind-2026-2` ve sonraki dönem satırları.
  - Bir tesisin grubunu yalnız bizim portal yöneticilerimiz (kurulum düzenleme yetkisi) değiştirir; bayi değiştiremez (K-4).
  - adnansahin yeni sisteme taşındığı gün eski adresin VDS klasörü (`tekserp-guncelleme/html/adnansahin`) SİLİNMEZ, ARŞİVE alınır; eski adresin kapanışı o günün ayrı adımıdır.

- **Eski adres değişmez:** `guncelleme.etkiliyazilim.com`a rota BAĞLANMAZ (adnansahin eski adresten belirteçsiz alır). Yayından önce ve sonra `node Teks-Erp-wt/indirme-kapisi-olc.mjs --adnansahin` → 9/9.
- **VDS kökeni:** ayrı compose projesi `deploy/guncelleme-sunucusu/indir/` → `/opt/stack/apps/tekserp-indir` (yönlendirici `tekserp-indir`, kendi CF ipallowlist + hız seddi — §5 bu yönlendiricide uygulanmış doğar; eski `tekserpguncelleme`ye kısıt EKLENMEZ). `html/<grup>/{electron,mobil,backend}` + `defter/` yayıncıya ait. Bekçi `node scripts/test_indir_sunucusu.mjs`.
- **Cloudflare sırası:** Worker (+ `TKL_INDIRME_AYAR`) → rota → DNS. DNS en son: ad çözülmeye başladığı anda Worker zaten önündedir; arada kapısız pencere olmaz.
- **Rota:** `indir.etkiliyazilim.com/*` (adın tamamı; joker rota YASAK, §1 adım 5), *Request limit failure mode* = **Fail closed**. Klasöre bağlı dar rota `//<grup>/…` ve `%..` biçimleriyle atlanır (ölçüldü 2026-10-06); §4'teki kanal başına rota yeni adreste KULLANILMAZ.
- **Ayar:** `TKL_INDIRME_AYAR` = `deploy/guncelleme-sunucusu/worker/indir-ayar.json` (yalnız açık anahtar; dosyaya yorum YAZILMAZ — tanınmayan alan 503). Satırın `kanallar`ı = güncelleme grupları (test · oncu · genel), `anahtarlar`/`gecisListesi` boş, liste adı yalnız `uretim` (yeni adreste eski istemci yok). **K-5:** `ind-2026` satırı YOK — onunla imzalı belirteç `JWS_KID`. Döndürmede yeni satır bu dosyaya eklenir, bekçi (`test_indirme_kapisi` §10) geçince panele yapıştırılır.
- **OTA takma adı:** tablet `/ota/<rv>/manifest` ister (grup-nötr, `runtimeVersion` biçimi `55.0`). Belirteç ZORUNLU, geçiş listesi uygulanmaz; Worker yolu belirtecin kanalından `/<grup>/mobil/ota/<rv>/manifest`e çevirir, gerçek yol belirtecin `yolOneki`nin altında olmalı. Origin isteği ve önbellek anahtarı gerçek yoldur (manifest değişken: kenarda tutulmaz). Başka her yazım (`//ota/…`, `/%6fta/…`, büyük harf, sonek, `manifest-<damga>`) 403 `INDIRME_YOL`; `ota` grup adı olamaz (`deploy/dagitim.json` ayrılmış ad, `check-dagitim` §3 Worker önekini ölçer).
- **Prova (yayın günü):** belirteçsiz `/ota/55.0/manifest` → 403 `INDIRME_BELIRTEC_YOK`; test kurulumunun `?urun=mobil` belirteciyle → 200 ve gövde `/test/mobil/ota/55.0/manifest` ile aynı; aynı belirteçle `/oncu/mobil/…` → 403 `INDIRME_YOL`; `//ota/55.0/manifest` → 403.
