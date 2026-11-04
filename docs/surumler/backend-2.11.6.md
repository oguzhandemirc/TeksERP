# Backend `2.11.6`

**Paket:** (paketleme sonrası yazılacak)
**SHA256:** (paketleme sonrası yazılacak)
**Commit:** (paketleme sonrası yazılacak)
**İçerik commit'leri:** `fix(workorder): stage filter + where-options include subcontractor stations (backend 2.11.6)` (aşama seçicisinde fason istasyonları)
**Önceki saha sürümü:** **2.11.5** (etiket `backend-v2.11.5`; kuran, kurulumdan önce `/health` ve `app\PAKET.json` ile 2.11.5 olduğunu ÖLÇER — farklıysa DUR).

**Bakım sürümü:** `bakim/adnansahin-backend-2.11.6` dalı, taban `bakim/adnansahin-backend-2.11.5` (2.11.5 künye commit'inin üstünde).
`main`deki sonraki geliştirmeler (2.12+) bu pakette YOKTUR. Paketleme **`-Surum 2.11.6`** ile koşulur — yama
otomatiği en yeni `backend-v*` etiketinden (main hattı) sayar ve bu belgeyi bulamaz.

## 1. Özet

Şema değişikliği yok. İş emri listesindeki **"Şu an hangi aşamada"** seçicisi artık fason istasyonlarını
(ör. "Boyahane (Fason)", "Zımpara (Fason)") da gösterir ve sayar; süzgeç bu istasyonların kimliğini kabul eder
(commit `fix(workorder): stage filter + where-options include subcontractor stations (backend 2.11.6)`).

Ölçüm (git, 2.11.5 künye commit'i `..` bu dal): yeni migration **0** (toplam **363**, 2.11.5 ile aynı) · yeni
ortam değişkeni **0** · yeni izin kodu **0** · yeni uç **0**.

## 2. Ne değişti

- **`GET /api/work-orders?filter[asama]=<uuid,...>`** ve **`GET /api/work-orders/where-options`** (`stages`):
  bir top şu an Y istasyonunda sayılır —
  - Y iç (INTERNAL) istasyonsa: top `IN_PRODUCTION` ve şu an durduğu adımın istasyonu Y (2.11.5 ile aynı);
  - Y fason (EXTERNAL) istasyonsa: top fasonda (`AT_SUBCONTRACTOR` ve açık bir sevk belgesinde dönmemiş
    kalemi var — "fasoncuda" süzgeciyle aynı tanım) ve şu an durduğu adımın istasyonu Y. İptal edilmiş ya da
    kalanı kapatılmış sevkteki top, fason adımında fabrikada `IN_PRODUCTION` duran top sayılmaz.

  Seçenek listesi iş emri adımı olabilen her istasyondur (iç ya da fason); KK1 ve Sevkiyat/Paketleme bugünkü
  kuralla (aktif + iş emri adımı olabilir) elenmeye devam eder. EXTERNAL istasyon kimliği artık 400 DEĞİL;
  uuid olmayan ya da bilinmeyen kimlik yine 400 `details.code=INVALID_FILTER_VALUE`. Faceted sayım
  (kendi anahtarı hariç süzgeçler + o seçenek) aynen sürer. "Fasonda", "fasoncuda" süzgeçleri ve sipariş
  "Nerede?" değişmedi.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — alan adı/tipi, uç, parametre, enum, izin değişikliği yok; yalnız `stages` dizisine
  fason istasyonları eklenir ve `filter[asama]` onların kimliğini kabul eder.
- **Eski istemci ne yapar:** panel 1.3.10 `stages` dizisini olduğu gibi listeler; fason istasyonları seçicide
  görünür ve seçilince liste süzülür. Panel değişikliği GEREKMEZ.
- **Panel uyumluluğu:** **Panel 1.3.10** ile uyumlu; panel 1.3.9 seçenek ucunu çağırmaz, etkilenmez.
- **`minVersion` dokunuldu mu:** HAYIR.

## 4. Migration

- **Var mı:** HAYIR — yalnız kod.
- **Toplam migration:** **363** (2.11.5 ile aynı). Kuran `[7/9]`da "363 migrations found" + **0** uygulanan
  migration görmelidir; farklı sayı = yanlış paket ya da yanlış DB → DUR.
- **Veri yazan adımlar:** yok.
- **Geri alınabilir mi:** EVET — şema değişmediği için kod geri dönüşü yeterli (§6).

## 5. Kurulum notu

- **Beklenen kesinti:** ~5 dk API kapalı (2.11.5 kurulumuyla aynı adımlar; migration adımı boş geçer).
- **Sıra:** yalnız backend; panel ve tablet değişmez.
- **Kurulum yöntemi:** 2.11.5 ile aynı — paket `C:\TeksERP\guncelleme\`e; paketin kendi `kur.ps1` +
  `uzaktan-kos.ps1`i çıkarılır, `C:\TeksERP\kur.ps1` onunla değiştirilir; SYSTEM görevi:
  `uzaktan-kos.ps1 -Betik kur.ps1 -Argumanlar '-Kok C:\TeksERP -Paket {zip} -Zorla'`.
- **Bu sürüme özel:** veri aracı yok, bayrak yok.
- **Sınırlar (her sürümde geçerli):** `migrate reset`/reseed/DB drop YOK · uygulanmış migration'a dokunma ·
  postgres/node süreçlerini `Stop-Process` ile durdurma, `postgresql-tekserp` servisine dokunma ·
  `C:\TeksERP\pgsql\bin` JUNCTION'dır, recursive SİLİNMEZ · gece yedeği görevi çakışmamalı · elle koşumda
  `-GeriAl` ile `-Zorla` birlikte KULLANMA · başarısız kurulumu TEKRAR DENEME · hata → DUR, insana rapor et.

## 6. Geri alma

Migration olmadığı için geri dönüş = **2.11.5 uygulama dizinine dönmek**: `kur.ps1 -GeriAl` (elle, yönetici
PowerShell'de; SYSTEM görevinde `-Kok C:\TeksERP -GeriAl -Zorla`) bu kurulumun kenara aldığı `app.eski-*`i
(2.11.5) geri koyar. Yedekten restore GEREKMEZ (şema aynı). Eski backend'de seçicide yine yalnız iç
istasyonlar görünür.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- yeni sürüm + `pm2 jlist` (online, restart sayısı)
- `/health` → `UP/UP 2.11.6`
- `[7/9]`: 0 migration uygulandı; `_prisma_migrations` 363 bitmiş / 0 sorunlu
- `backend-err*.log` son satırlar — yeni hata var mı
- `GET /api/work-orders/where-options` (yetkili oturumla) 200; `stages` içinde "Boyahane (Fason)" ve
  "Zımpara (Fason)" var (prova kopyasında ölçülen: Boyahane (Fason) 106 · Kurşun + KK2 58 · Tambur 19 ·
  Zımpara (Fason) 0 iş emri)
- "Boyahane (Fason)" seçeneğinin `workOrderCount`u = `filter[asama]=<o id>` listesinin `total`ı;
  `GET /api/work-orders?filter[asama]=x` 400 `INVALID_FILTER_VALUE` (500 DEĞİL)
- ölçülen kesinti
