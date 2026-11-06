# Backend `2.11.7`

**Paket:** (paketleme sonrası yazılacak)
**SHA256:** (paketleme sonrası yazılacak)
**Commit:** (paketleme sonrası yazılacak)
**İçerik commit'leri:** `feat(rapor): stock report "by item" tab endpoint (backend 2.11.7, port of #598)` (Stok & Ölü Stok "Kalem bazında" ucu — main #598'in taşıması)
**Önceki saha sürümü:** **2.11.6** (etiket `backend-v2.11.6` = `2b6719509`; kuran, kurulumdan önce `/health` ve `app\PAKET.json` ile 2.11.6 olduğunu ÖLÇER — farklıysa DUR).

**Bakım sürümü:** `bakim/adnansahin-backend-2.11.7` dalı, taban `bakim/adnansahin-backend-2.11.6` (2.11.6 künye commit'inin üstünde).
`main`deki sonraki geliştirmeler (2.12+) bu pakette YOKTUR. Paketleme **`-Surum 2.11.7`** ile koşulur — yama
otomatiği en yeni `backend-v*` etiketinden (main hattı) sayar ve bu belgeyi bulamaz.

## 1. Özet

Şema değişikliği yok. Stok & Ölü Stok raporuna **"Kalem bazında"** sekmesinin veri ucu eklendi: rafta duran
ham kumaş kumaş başına, bitmiş kumaş kumaş + en + renk + kat başına top sayısı ve metre olarak listelenir
(commit `feat(rapor): stock report "by item" tab endpoint (backend 2.11.7, port of #598)`).

Ölçüm (git, 2.11.6 künye commit'i `..` bu dal): yeni migration **0** (toplam **363**, 2.11.6 ile aynı) · yeni
ortam değişkeni **0** · yeni izin kodu **0** · yeni uç **1** (`GET /api/reports/inventory/scorecard/kalem`).

## 2. Ne değişti

- **`GET /api/reports/inventory/scorecard/kalem`** (yeni): `{ totals: { hamCount, hamQty, bitmisCount,
  bitmisQty }, ham: [...], bitmis: [...] }` rapor zarfı içinde. Kapı ve izin Stok & Ölü Stok'unkiyle AYNI
  (rapor kapısı `inventory/scorecard` + `report:inventory`).
- Raf kümesi ve ham/bitmiş ayrımı Stok & Ölü Stok'un kendi fonksiyonlarından gelir (`loadShelfCells`,
  `isRawCell`, `isFinishedCell` — yalnız dışa açıldı, davranışı değişmedi); bu yüzden sekmenin toplamları
  kutulardaki "Ham stok" / "Bitmiş depo" rakamlarıyla birebir tutar.
- Kat = topun kendi `Roll.foldType` kolonu; görünen ad kat kataloğundan, katalogda yoksa kod.
- `GET /api/reports/inventory/scorecard` (mevcut) değişmedi.
- 2.11.x'te rapor satır tavanı (`capReportLists`) yok: yeni uç satırları tavansız döner (satır top değil
  kalem grubudur; sayısı kumaş × en × renk × kat çeşidiyle sınırlı).

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — yalnız yeni uç; mevcut uçların alan adı/tipi, parametresi, enum ve izinleri aynı.
- **Eski istemci ne yapar:** panel 1.3.11 yeni ucu çağırmaz, etkilenmez. Panel 1.3.12 bu ucu çağırır;
  eski backend'e (2.11.6) bağlanırsa uç 404 döner ve sekme "Bu rapor için sunucunun güncellenmesi
  gerekiyor" der (çökme yok).
- **Panel uyumluluğu:** **Panel 1.3.11 ve 1.3.12** ile uyumlu.
- **`minVersion` dokunuldu mu:** HAYIR.

## 4. Migration

- **Var mı:** HAYIR — yalnız kod.
- **Toplam migration:** **363** (2.11.6 ile aynı). Kuran `[7/9]`da "363 migrations found" + **0** uygulanan
  migration görmelidir; farklı sayı = yanlış paket ya da yanlış DB → DUR.
- **Veri yazan adımlar:** yok (uç salt okur).
- **Geri alınabilir mi:** EVET — şema değişmediği için kod geri dönüşü yeterli (§6).

## 5. Kurulum notu

- **Beklenen kesinti:** ~5 dk API kapalı (2.11.6 kurulumuyla aynı adımlar; migration adımı boş geçer).
- **Sıra:** önce bu backend, SONRA panel 1.3.12; tablet değişmez.
- **Kurulum yöntemi:** 2.11.6 ile aynı — paket `C:\TeksERP\guncelleme\`e; paketin kendi `kur.ps1` +
  `uzaktan-kos.ps1`i çıkarılır, `C:\TeksERP\kur.ps1` onunla değiştirilir; SYSTEM görevi:
  `uzaktan-kos.ps1 -Betik kur.ps1 -Argumanlar '-Kok C:\TeksERP -Paket {zip} -Zorla'`.
- **Bu sürüme özel:** veri aracı yok, bayrak yok.
- **Sınırlar (her sürümde geçerli):** `migrate reset`/reseed/DB drop YOK · uygulanmış migration'a dokunma ·
  postgres/node süreçlerini `Stop-Process` ile durdurma, `postgresql-tekserp` servisine dokunma ·
  `C:\TeksERP\pgsql\bin` JUNCTION'dır, recursive SİLİNMEZ · gece yedeği görevi çakışmamalı · elle koşumda
  `-GeriAl` ile `-Zorla` birlikte KULLANMA · başarısız kurulumu TEKRAR DENEME · hata → DUR, insana rapor et.

## 6. Geri alma

Migration olmadığı için geri dönüş = **2.11.6 uygulama dizinine dönmek**: `kur.ps1 -GeriAl` (elle, yönetici
PowerShell'de; SYSTEM görevinde `-Kok C:\TeksERP -GeriAl -Zorla`) bu kurulumun kenara aldığı `app.eski-*`i
(2.11.6) geri koyar. Yedekten restore GEREKMEZ (şema aynı). Eski backend'de panel 1.3.12'nin "Kalem bazında"
sekmesi güncelleme gerektiğini söyler; "Genel" sekmesi çalışır.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- yeni sürüm + `pm2 jlist` (online, restart sayısı)
- `/health` → `UP/UP 2.11.7`
- `[7/9]`: 0 migration uygulandı; `_prisma_migrations` 363 bitmiş / 0 sorunlu
- `backend-err*.log` son satırlar — yeni hata var mı
- `GET /api/reports/inventory/scorecard/kalem` (yetkili oturumla) 200; `totals.hamQty` =
  `GET /api/reports/inventory/scorecard` "Ham stok" metresi ve `totals.bitmisQty` = "Bitmiş depo" metresi
- `GET /api/reports/inventory/scorecard/kalem?x=1` 400 (500 DEĞİL)
- ölçülen kesinti
