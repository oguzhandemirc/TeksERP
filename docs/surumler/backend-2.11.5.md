# Backend `2.11.5`

**Paket:** `tekserp-backend-20261104_232230-3e94dfcbb.zip`
**SHA256:** `B5C7FBB8987D13FF1997645734BDB89ABA8BCCD30FA65FB18A10345BDB6B570D`
**Commit:** `3e94dfcbb`
**İçerik commit'leri:** `342d8eed5` (iş emri fasoncu/aşama süzgeçleri + where-options) · `53b864de1` ("Sipariş elle kapatıldı") · `5477daeda` (faceted sayım, yalnız üretim aşamaları)
**Önceki saha sürümü:** **2.11.4** (etiket `backend-v2.11.4` = `5bb36948d`; kuran, kurulumdan önce `/health` ve `app\PAKET.json` ile 2.11.4 olduğunu ÖLÇER — farklıysa DUR).

**Bakım sürümü:** `bakim/adnansahin-backend-2.11.5` dalı, taban `backend-v2.11.4` (2.11.4 künye commit'inin üstünde).
`main`deki sonraki geliştirmeler (2.12+) bu pakette YOKTUR. Paketleme **`-Surum 2.11.5`** ile koşulur — yama
otomatiği en yeni `backend-v*` etiketinden (main hattı) sayar ve bu belgeyi bulamaz.

## 1. Özet

Şema değişikliği yok. İş emri listesine **"şu an hangi fasoncuda / hangi aşamada"** süzgeçleri ve bu
süzgeçlerin seçeneklerini sayılarıyla veren yeni bir okuma ucu (commit `feat(workorder): "currently at which subcontractor / stage" list filters + where-options`); bu ucun sayılarının listenin
tarih aralığı ve diğer süzgeçleriyle tutarlı (faceted) sayılması ve aşama seçeneklerinin yalnız üretim
istasyonları olması (`fix(workorder): faceted where-options counts, production stages only`); elle kapatılan siparişin "Nerede?" cümlesinin **"Sipariş elle kapatıldı"**
olması (`fix(order): manually closed order reads 'Sipariş elle kapatıldı'`). Commit SHA'ları belge başındaki künyede.

Ölçüm (git, `backend-v2.11.4..` bu dal): yeni migration **0** (toplam **363**, 2.11.4 ile aynı) · yeni ortam
değişkeni **0** · yeni izin kodu **0** · yeni uç **1** (`GET /api/work-orders/where-options`, iş emri listesiyle
aynı izin).

## 2. Ne değişti

- **`GET /api/work-orders?filter[fasonFirma]=<uuid,...>`**: iş emrinin en az bir topu şu an o
  fasoncuda (`AT_SUBCONTRACTOR` ve o firmaya açık bir sevk belgesinde bekleyen kalemi var) olan iş emirleri.
  Yalnız planlanan firma eşleşmez.
- **`GET /api/work-orders?filter[asama]=<uuid,...>`**: iş emrinin en az bir topu
  şu an o istasyonda üretimde (`IN_PRODUCTION`). Yalnız üretim (INTERNAL) istasyonları kabul edilir; EXTERNAL
  istasyon kimliği, uuid olmayan ya da bilinmeyen kimlik → 400 `details.code=INVALID_FILTER_VALUE`.
- **`GET /api/work-orders/where-options`** (yeni uç): `{ firms, stages }`, her seçenekte `workOrderCount`.
  Listenin sorgu parametrelerini aynen alır (`search`, `filter[*]`, `dateField/dateFrom/dateTo`,
  `withArchived` …) ve FACETED sayar: firma sayısı = süzgeçler eksi `filter[fasonFirma]` artı o firma; aşama
  sayısı = süzgeçler eksi `filter[asama]` artı o aşama. Temel koşul listeyle aynı yerden
  (`WorkOrderService.buildListWhere`) kurulur; seçenekteki sayı, o seçenek seçilince listenin `total`ı ile
  aynıdır. Geçersiz süzgeç değeri listeyle aynı 400'ü verir. Arşivli iş emri varsayılan olarak sayılmaz.
- **Sipariş "Nerede?"**: elle kapatılan sipariş "Sipariş kapatıldı" yerine **"Sipariş elle
  kapatıldı"** okur (sevk cümlesinde de: "Sipariş elle kapatıldı (X gönderildi)"). `kind` değerleri aynı
  (`CLOSED`). Sipariş "Nerede?" fason dalı aynı top yüklemini (`roll-place.helper`) kullanır; davranış değişmedi.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — iki yeni isteğe bağlı süzgeç parametresi, bir yeni okuma ucu, bir metin değişikliği.
  Kaldırılan uç 0, alan adı/tipi değişen 0, zorunlu hâle gelen parametre 0, enum/izin değişikliği 0.
- **Eski istemci ne yapar:** panel/tablet `filter[fasonFirma]`/`filter[asama]` göndermiyor ve `where-options`
  çağırmıyorsa hiçbir şey değişmez. Sipariş listesinde yalnız elle kapatılan siparişlerin cümlesi değişir.
- **Panel uyumluluğu:**
  - **Panel 1.3.9** (sahadaki) bu backend'le olduğu gibi çalışır.
  - **Panel 1.3.10** bu backend'i İSTER: `GET /api/work-orders/where-options` backend 2.11.4'te **404** döner,
    iş emri listesindeki "Nerede?" süzgeç seçenekleri gelmez. Sıra: backend 2.11.5 ÖNCE, panel 1.3.10 sonra.
- **`minVersion` dokunuldu mu:** HAYIR.

## 4. Migration

- **Var mı:** HAYIR — yalnız kod.
- **Toplam migration:** **363** (2.11.4 ile aynı). Kuran `[7/9]`da "363 migrations found" + **0** uygulanan
  migration görmelidir; farklı sayı = yanlış paket ya da yanlış DB → DUR.
- **Veri yazan adımlar:** yok.
- **Geri alınabilir mi:** EVET — şema değişmediği için kod geri dönüşü yeterli (§6).

## 5. Kurulum notu

- **Beklenen kesinti:** ~5 dk API kapalı (2.11.4 kurulumuyla aynı adımlar; migration adımı boş geçer).
- **Sıra:** backend ÖNCE; panel 1.3.10 (iş emri "Nerede?" süzgeçleri) backend 2.11.5 kurulduktan sonra.
  Tablet bağımlılığı yok.
- **Kurulum yöntemi:** 2.11.4 ile aynı — paket `C:\TeksERP\guncelleme\`e; paketin kendi `kur.ps1` +
  `uzaktan-kos.ps1`i çıkarılır, `C:\TeksERP\kur.ps1` onunla değiştirilir; SYSTEM görevi:
  `uzaktan-kos.ps1 -Betik kur.ps1 -Argumanlar '-Kok C:\TeksERP -Paket {zip} -Zorla'`.
- **Bu sürüme özel:** veri aracı yok, bayrak yok.
- **Sınırlar (her sürümde geçerli):** `migrate reset`/reseed/DB drop YOK · uygulanmış migration'a dokunma ·
  postgres/node süreçlerini `Stop-Process` ile durdurma, `postgresql-tekserp` servisine dokunma ·
  `C:\TeksERP\pgsql\bin` JUNCTION'dır, recursive SİLİNMEZ · gece yedeği görevi çakışmamalı · elle koşumda
  `-GeriAl` ile `-Zorla` birlikte KULLANMA · başarısız kurulumu TEKRAR DENEME · hata → DUR, insana rapor et.

## 6. Geri alma

Migration olmadığı için geri dönüş = **2.11.4 uygulama dizinine dönmek**: `kur.ps1 -GeriAl` (elle, yönetici
PowerShell'de; SYSTEM görevinde `-Kok C:\TeksERP -GeriAl -Zorla`) bu kurulumun kenara aldığı `app.eski-*`i
(2.11.4) geri koyar. Yedekten restore GEREKMEZ (şema aynı). Panel 1.3.10 kurulduysa eski backend'de iş emri
"Nerede?" süzgeç seçenekleri gelmez (uç 404).

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- yeni sürüm + `pm2 jlist` (online, restart sayısı)
- `/health` → `UP/UP 2.11.5`
- `[7/9]`: 0 migration uygulandı; `_prisma_migrations` 363 bitmiş / 0 sorunlu
- `backend-err*.log` son satırlar — yeni hata var mı
- `GET /api/work-orders/where-options` (yetkili oturumla) 200, `firms`/`stages` dizileri döner;
  `GET /api/work-orders?filter[asama]=x` 400 `INVALID_FILTER_VALUE` (500 DEĞİL)
- bir aşama seçeneğinin `workOrderCount`u = aynı parametrelerle `filter[asama]=<o id>` listesinin `total`ı
- ölçülen kesinti
