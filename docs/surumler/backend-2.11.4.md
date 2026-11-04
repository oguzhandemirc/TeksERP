# Backend `2.11.4`

**Paket:** `tekserp-backend-20261104_183757-5bb36948d.zip`
**SHA256:** `AD230366EE6025AA4028DFFCC247049CDD4F598BB732423F3517DD4743367CDF`
**Commit:** `5bb36948d`
**Önceki saha sürümü:** **2.11.2** (etiket `backend-v2.11.2` = `72889f5a`; kuran, kurulumdan önce `/health` ve `app\PAKET.json` ile 2.11.2 olduğunu ÖLÇER — farklıysa DUR).

**Bakım sürümü:** `bakim/adnansahin-backend-2.11.4` dalı, taban `backend-v2.11.3` (o da `backend-v2.11.2` üstünde).
**2.11.3 sahaya ÇIKMADI** — paketlendi ama kurulmadan bu sürüme katıldı; içeriği (A1+A2) aşağıda aynen yer alır.
`main`deki sonraki geliştirmeler (2.12+) bu pakette YOKTUR. Paketleme **`-Surum 2.11.4`** ile koşulur — yama
otomatiği en yeni `backend-v*` etiketinden (main hattı) sayar ve bu belgeyi bulamaz.

## 1. Özet

Şema değişikliği yok. 2.11.3'ün iki düzeltmesi — iş emri listesine "fasonda olanlar" süzgeci (A1) ve iş
emrine farklı kumaş/renkteki sipariş kalemlerinin birlikte bağlanmasının engellenmesi (A2) — artı
**Siparişler "Nerede?"**: sipariş listesinin her satırı siparişin şu an nerede olduğunu ve sevk durumunu
sunucuda kurulmuş Türkçe cümleyle taşır; hızlı sekme / fason firma / "fasonda X günden uzun" süzgeçleri ve
sipariş yan paneli için yeni bir okuma ucu. Panelin bunu gösteren sürümü ayrı pakettir (panel 1.3.9); eski
panel yeni alanları yok sayar.

Ölçüm (git, `backend-v2.11.2..` bu dal): yeni migration **0** (toplam **363**, 2.11.2 ile aynı) · yeni ortam
değişkeni **0** · yeni izin kodu **0** · yeni uç **1** (`GET /api/orders/:id/nerede`, mevcut izinlerle).

## 2. Ne değişti

- **A1 — `GET /api/work-orders?filter[fasonda]=1`** (ya da `true`): en az bir topu şu an fasonda
  (`AT_SUBCONTRACTOR`, topun bulunduğu adım iş emrinin bir adımı) olan iş emirlerini döner. Anlam satırdaki
  fason rozetiyle (`currentFasonStations`) aynıdır; kısmi fasondaki iş emri de görünür. Sayım (`total`) liste
  ile aynı koşuldan gelir. Başka her değer 400 `details.code=INVALID_FILTER_VALUE` (eskiden anahtar sorguya
  sızıp 500 verirdi).
- **A2 — kumaş/renk karışıklığı engeli:** bir iş emri tek kumaş + tek renk üretir. Bağlanan sipariş
  kalemlerinde birden fazla kumaş → 400 `WORK_ORDER_MIXED_ITEM`, birden fazla (boş olmayan) renk → 400
  `WORK_ORDER_MIXED_COLOR`; hedef kumaş/renk açıkça verilmiş olsa da. Uygulanan yollar: iş emri oluşturma,
  düzenleme (replace), sonradan sipariş bağlama (mevcut açık bağlar + yeni kalemler birlikte; hedef rengi boş
  iş emrinde de) ve süpervizörün "uyumsuz bağla" (override) zinciri — override hedef↔kalem farkını aşar ama
  kalemler ARASI karışıklığı aşmaz ve reddi plan (renk/en) yazılmadan ÖNCE verir. Renksiz kalem (renk boş)
  karışıklık sayılmaz; tek renkli kalemlerde davranış değişmedi.
- **Nerede? — `GET /api/orders`** (offset ve `mode=cursor`): her satıra iki EK alan — `nerede`
  (`kind`, `tone`, `text`, `extraPlaces`, `overdue`, `overdueText`) ve `sevk` (`kind`, `text`, `shipped`,
  `requested`, `unit`). Cümle tek kaynaktan (`order-nerede.helper`) kurulur: "İş emri açılmadı", "Boyahane
  aşamasında · N top", "Fasonda – Akın Boya · 8 top · 3 gündür", "Sevke hazır · N top", "Üretilen toplar
  gönderildi", "Sipariş kapatıldı" … ; birden çok yerde "· +K yerde daha". Sevk rakamı BRÜT (kalem
  `shippedQty` toplamı). Sayfa başına sorgu sayısı sabittir (sipariş/iş emri sayısından bağımsız).
- **Nerede? süzgeçleri:** `filter[nerede]=BEKLEYEN|FASONDA|SEVKE_HAZIR|KISMEN|GECIKEN`,
  `filter[fasonFirma]` (virgüllü firma UUID listesi), `filter[fasonGun]` (0–3650 gün); liste, cursor ve `GET /api/orders/stats`
  aynı koşuldan sayar. Geçersiz değer 400 `details.code=INVALID_FILTER_VALUE`.
- **Nerede? — `GET /api/orders/:id/nerede`** (izin `order:read` ya da `mobile:siparis`): yan panel için
  iş emri başına rota izi, adım başına top/metre, sevke hazır toplam ve son hareket. Olmayan sipariş 404.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — yeni isteğe bağlı süzgeç parametreleri, sipariş listesinde iki ek alan, bir yeni
  okuma ucu ve iki yeni 400 kodu. Kaldırılan uç 0, alan adı/tipi değişen 0, zorunlu hâle gelen parametre 0,
  enum/izin değişikliği 0.
- **Eski istemci ne yapar:** panel/tablet `filter[fasonda]` ve `filter[nerede|fasonFirma|fasonGun]`
  göndermiyorsa hiçbir şey değişmez; sipariş listesindeki `nerede`/`sevk` ek alanlarını yok sayar. Eskiden
  "hedef rengi/ürünü açıkça belirtin" ile geçen karışık kalemli iş emri artık 400 alır; istemci mesajı
  (Türkçe) genel hata tostunda gösterir.
- **`minVersion` dokunuldu mu:** HAYIR.

## 4. Migration

- **Var mı:** HAYIR — yalnız kod.
- **Toplam migration:** **363** (2.11.2 ile aynı). Kuran `[7/9]`da "363 migrations found" + **0** uygulanan
  migration görmelidir; farklı sayı = yanlış paket ya da yanlış DB → DUR.
- **Veri yazan adımlar:** yok.
- **Geri alınabilir mi:** EVET — şema değişmediği için kod geri dönüşü yeterli (§6).

## 5. Kurulum notu

- **Beklenen kesinti:** ~5 dk API kapalı (2.11.2 kurulumuyla aynı adımlar; migration adımı boş geçer).
- **Sıra:** backend ÖNCE; panel 1.3.9 ("Nerede?" sütunu) backend 2.11.4 kurulduktan sonra. Tablet bağımlılığı yok.
- **Kurulum yöntemi:** 2.11.2 ile aynı — paket `C:\TeksERP\guncelleme\`e; paketin kendi `kur.ps1` +
  `uzaktan-kos.ps1`i çıkarılır, `C:\TeksERP\kur.ps1` onunla değiştirilir; SYSTEM görevi:
  `uzaktan-kos.ps1 -Betik kur.ps1 -Argumanlar '-Kok C:\TeksERP -Paket {zip} -Zorla'`.
- **Bu sürüme özel:** veri aracı yok, bayrak yok.
- **Sınırlar (her sürümde geçerli):** `migrate reset`/reseed/DB drop YOK · uygulanmış migration'a dokunma ·
  postgres/node süreçlerini `Stop-Process` ile durdurma, `postgresql-tekserp` servisine dokunma ·
  `C:\TeksERP\pgsql\bin` JUNCTION'dır, recursive SİLİNMEZ · gece yedeği görevi çakışmamalı · elle koşumda
  `-GeriAl` ile `-Zorla` birlikte KULLANMA · başarısız kurulumu TEKRAR DENEME · hata → DUR, insana rapor et.

## 6. Geri alma

Migration olmadığı için geri dönüş = **2.11.2 uygulama dizinine dönmek**: `kur.ps1 -GeriAl` (elle, yönetici
PowerShell'de; SYSTEM görevinde `-Kok C:\TeksERP -GeriAl -Zorla`) bu kurulumun kenara aldığı `app.eski-*`i
(2.11.2) geri koyar. Yedekten restore GEREKMEZ (şema aynı; 2.11.4'ün yazdığı veri 2.11.2 koduyla uyumludur).
Panel 1.3.9 kurulduysa eski backend'de "Nerede?" kartı gizlenir (uç yok), liste sütunu boş kalır.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- yeni sürüm + `pm2 jlist` (online, restart sayısı)
- `/health` → `UP/UP 2.11.4`
- `[7/9]`: 0 migration uygulandı; `_prisma_migrations` 363 bitmiş / 0 sorunlu
- `backend-err*.log` son satırlar — yeni hata var mı
- `GET /api/work-orders?filter[fasonda]=1` (yetkili oturumla) 200 döner; `filter[fasonda]=x` 400
  `INVALID_FILTER_VALUE` döner (500 DEĞİL)
- `GET /api/orders?limit=5` satırlarında `nerede.text` ve `sevk.text` dolu; `GET /api/orders?filter[nerede]=x`
  400 `INVALID_FILTER_VALUE`; bir siparişte `GET /api/orders/{id}/nerede` 200
- ölçülen kesinti
