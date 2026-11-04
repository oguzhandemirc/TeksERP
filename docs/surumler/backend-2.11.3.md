# Backend `2.11.3`

**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** **2.11.2** (etiket `backend-v2.11.2` = `72889f5a`; kuran, kurulumdan önce `/health` ve `app\PAKET.json` ile 2.11.2 olduğunu ÖLÇER — farklıysa DUR).

**Bakım sürümü:** `bakim/adnansahin-backend-2.11.3` dalı, taban `backend-v2.11.2`. `main`deki sonraki
geliştirmeler (2.12+) bu pakette YOKTUR. Paketleme **`-Surum 2.11.3`** ile koşulur — yama otomatiği en yeni
`backend-v*` etiketinden (main hattı) sayar ve bu belgeyi bulamaz.

## 1. Özet

İki küçük düzeltme, şema değişikliği yok: iş emri listesine "fasonda olanlar" süzgeci (A1) ve iş emrine
farklı kumaş/renkteki sipariş kalemlerinin birlikte bağlanmasının engellenmesi (A2). Panel ve tablet
değişmez; `dist-web` 2.11.2 ile aynı kaynaktan derlenir (`Electron/` tabandan beri değişmedi).

Ölçüm (git, `backend-v2.11.2..` bu dal): yeni migration **0** (toplam **363**, 2.11.2 ile aynı) · yeni ortam
değişkeni **0** · yeni izin kodu **0**.

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

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — yeni isteğe bağlı süzgeç parametresi ve iki yeni 400 kodu. Kaldırılan uç 0,
  alan adı/tipi değişen 0, zorunlu hâle gelen parametre 0, enum/izin değişikliği 0.
- **Eski istemci ne yapar:** panel/tablet `filter[fasonda]` göndermiyorsa hiçbir şey değişmez. Eskiden
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
- **Sıra:** yalnız backend. Panel/tablet bağımlılığı yok.
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
(2.11.2) geri koyar. Yedekten restore GEREKMEZ (şema aynı; 2.11.3'ün yazdığı veri 2.11.2 koduyla uyumludur).

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- yeni sürüm + `pm2 jlist` (online, restart sayısı)
- `/health` → `UP/UP 2.11.3`
- `[7/9]`: 0 migration uygulandı; `_prisma_migrations` 363 bitmiş / 0 sorunlu
- `backend-err*.log` son satırlar — yeni hata var mı
- `GET /api/work-orders?filter[fasonda]=1` (yetkili oturumla) 200 döner; `filter[fasonda]=x` 400
  `INVALID_FILTER_VALUE` döner (500 DEĞİL)
- ölçülen kesinti
