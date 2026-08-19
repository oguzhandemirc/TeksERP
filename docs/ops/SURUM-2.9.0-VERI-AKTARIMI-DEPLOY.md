# Sürüm 2.9.0 — Deploy Reçetesi (Veri Aktarımı: toplu içe/dışa aktarım)

> **Bu not YALNIZ 2.9.0'ın getirdiklerini anlatır.**
>
> ⛔ **ÖNCE ŞUNU OKU:** 2.9.0, henüz sahaya çıkmamış olan **2.8.0**'ın (arama
> katlaması + künye + audit derinleştirme, 17 migration) ÜSTÜNE gelir. Aynı
> `git pull` ikisini birden getirir. O sürümün riskleri — özellikle
> **`pg_trgm` uzantısı** — bu notta TEKRARLANMAZ:
> **[`SURUM-2026-08-19-ARAMA-DEPLOY.md`](./SURUM-2026-08-19-ARAMA-DEPLOY.md)**
> Sırayla: önce o notun "İLK 5 DAKİKA" bölümü, sonra bu not.
>
> Genel prosedür: [`DEPLOY-RUNBOOK.md`](./DEPLOY-RUNBOOK.md). Bu dosya runbook'un
> yerine GEÇMEZ.
>
> Yazan oturum **sahaya bağlanmadı**. Aşağıda "ölçüldü" yazan her şey yerel
> geliştirme veritabanında (fabrika verisinin kopyası) koşuldu; ölçülmemiş olan
> açıkça öyle yazıyor.

---

## 0) Bir bakışta — bu sürümde ne var

Sistem geneli **toplu içe/dışa aktarım**. Üç parça:

| Parça | Ne | Kullanıcıya görünen |
|---|---|---|
| **A — Dışa aktarım örtüsü** | Her listede PDF/Excel'e **CSV** eklendi; indirme artık ekrandaki değil **sunucudaki TÜM kayıtları** çeker; 12 ekrana ve 5 rapora hiç olmayan indirme eklendi | "Sütunlar" menüsünde "CSV indir"; "Tüm listeyi indir" başlığı |
| **B — İçe aktarım** | 17 veri türü için Excel/CSV yükleme: şablon indir → doldur → **önizle** → uygula. Önizleme hiçbir şey yazmaz. | Tanım ekranlarında **"İçe Aktar"** düğmesi + Sistem → **Veri Aktarımı** ekranı |
| **C — Yapılandırma paketi** | Etiket/refakat kartı/belge şablonları ve rol tanımlarını JSON paketiyle başka kuruluma taşıma | Veri Aktarımı ekranında "Yapılandırma Paketi" kartı |

Tasarım + gerekçeler: [`docs/design/IMPORT-EXPORT-TASARIM.md`](../design/IMPORT-EXPORT-TASARIM.md)
(özellikle **§7 Uygulama Notları** — plandan sapmalar orada).

---

## 1) Deploy adımları

`Teks-Erp/` **içinden** koşulur (Prisma komutları çalışma dizinine duyarlı).

```powershell
# 0. 2.8.0 notunun "İLK 5 DAKİKA" kontrolü YAPILDI mı? Yapılmadıysa ORAYA DÖN.

# 1. Kod
git pull

# 2. Bağımlılık — YENİ PAKET YOK, ama 2.8.0 ile birlikte geliyorsa gerekir
npm install

# 3. Prisma client (şema değişti: ImportRun modeli)
npm run prisma:generate

# 4. Migration
npm run prisma:migrate        # = migrate deploy

# 5. Yeniden başlat (izin uzlaştırması boot'ta koşar)
pm2 restart tekserp-backend   # adı farklıysa: pm2 list
```

Sonra **panel** (Electron) aynı pencerede dağıtılır. **APK GEREKMEZ** — mobilde
hiçbir değişiklik yok.

> **SIRA PAZARLIK DIŞI: backend ÖNCE, panel SONRA.** Yeni panel + eski backend =
> "İçe Aktar" düğmesi görünür ama `/api/import/...` **404** döner. Tersi
> zararsızdır (eski panel yeni uçları hiç çağırmaz).

---

## 2) Migration — tek satır, risksiz

| Migration | Ne yapar | Risk |
|---|---|---|
| `20260819120000_import_runs` | **YENİ TABLO** `import_runs` + `ImportRunStatus` enum + 3 index + `users`'a FK (`ON DELETE SET NULL`) | **Yok.** Mevcut tabloya dokunmaz, veri yeniden yazılmaz, kilit almaz. Boş tabloya index eklemek anlıktır. |

Geri alma (gerekirse): `DROP TABLE import_runs; DROP TYPE "ImportRunStatus";` —
veri kaybı yalnız içe aktarım GEÇMİŞİdir, iş verisi etkilenmez.

**Doğrulama (migration'dan sonra):**
```powershell
psql -U postgres -d tekserp -c "\d import_runs"
psql -U postgres -d tekserp -c "SELECT unnest(enum_range(NULL::""ImportRunStatus""));"
```
Beklenen: 17 kolon + 5 index (pkey, clientToken unique, entity+createdAt, userId,
createdAt) · enum'da `APPLIED, PARTIAL, FAILED`.

---

## 3) ⏳ ELLE YAPILACAK TEK ADIM — izin ataması

Yeni izin: **`data:import`** ("Toplu içe aktarım").

Boot uzlaştırması izni **DB'ye getirir ama KİMSEYE ATAMAZ** — bu, bu repoda
bilinçli bir kuraldır (*katalog koda, atama panele*). Atanmazsa:

- "İçe Aktar" düğmeleri **hiç görünmez**,
- Sistem hub'ında **Veri Aktarımı** karosu **hiç görünmez**,
- ve bunun sebebi hiçbir yerde yazmaz.

**Yapılacak:** Yetkilendirme → Kullanıcılar → ilgili kişi → Yetkiler →
`data:import` işaretle.

> ⚠️ **TEK BAŞINA YETMEZ ve bu tasarım gereğidir.** Her uç ayrıca hedef verinin
> kendi düzenleme iznini arar. Örnek: kumaş yükleyebilmek için `data:import`
> **VE** `item:write` gerekir. Yalnız `data:import` taşıyan kişi ekranı görür,
> hangi türe yazabileceğini kartlardaki pasif düğmelerden anlar (üzerine gelince
> "Bu veriye yazma yetkiniz yok" yazar).
>
> `admin:*` bu izni **VERMEZ** (`settings:workstation` emsali): tek tıkla yüzlerce
> kaydı değiştirebilen bir yüzey, wildcard'la sessizce dağıtılmamalı.

**Kime verilir (öneri):** kurulum/veri işini yapan kişi + planlama sorumlusu.
Rol şablonu "Sistem Yöneticisi" (`WEB_SYSTEM_ADMIN`) artık `data:import`
içeriyor — ama **mevcut kullanıcılara geriye dönük uygulanmaz**; şablon yalnız
yeniden uygulandığında etki eder.

**Doğrulama:**
```powershell
psql -U postgres -d tekserp -c "SELECT code FROM permissions WHERE code='data:import';"
psql -U postgres -d tekserp -c "SELECT u.username FROM users u JOIN user_permissions up ON up.\""userId\""=u.id JOIN permissions p ON p.id=up.\""permissionId\"" WHERE p.code='data:import';"
```
İlk sorgu 1 satır dönmeli (boot uzlaştırması koştu). İkincisi **atama yapana
kadar boş** — bu normaldir.

---

## 4) Doğrulama (deploy sonrası, 5 dakika)

1. **Sistem → Veri Aktarımı** ekranı açılıyor mu? (izni atadığın kullanıcıyla gir)
2. Bir karttan **"Şablon"** indir → .xlsx açılmalı, 3 sayfa olmalı:
   **Veri · Açıklama · Değerler**.
3. Aynı karttan **"Veriyi indir"** → mevcut kayıtlar şablonla AYNI sütunlarda gelmeli.
4. İndirdiğin dosyada **bir satırı değiştir**, "İçe Aktar" ile yükle → önizlemede
   o satır **"Güncelle"**, diğerleri **"Değişiklik yok"** görünmeli.
   → *Bu, en önemli tek doğrulamadır:* hepsi "Güncelle" görünüyorsa bir
   dönüştürme sorunu var demektir, **UYGULAMA, geri bildir.**
5. **Uygula** → sonuç kartı + Geçmiş tablosunda satır.
6. Herhangi bir listede **"Sütunlar" → "CSV indir"** → dosya Excel'de çift tıkla
   açılmalı, Türkçe karakterler ve sayılar bozulmamalı.

---

## 5) Bu sürümün davranış sözleşmeleri (sahaya anlatılacaklar)

Bunlar hata değil, **karar**dır. Kullanıcı "neden böyle" diye sorarsa cevap budur.

- **Önizleme hiçbir şey yazmaz.** "Uygula" demeden tek kayıt değişmez.
- **Varsayılan: ya hep ya hiç.** Tek satırda bile hata varsa **hiçbir şey
  yazılmaz**. Kullanıcı isterse "hatalı satırları atla"yı işaretler.
- **Boş hücre = O ALANA DOKUNMA.** Bir alanı temizlemek için hücreye `NULL`
  yazılır. (Kısmi bir dosya yükleyen kullanıcı böylece veri silmez.)
- **Sunucunun ürettiği kodlar (RNK…, MUS…, ROT…, REC…, IST…, MAK…) dosyadan
  YAZILMAZ.** Yeni kayıt eklerken kod hücresi **boş bırakılır**. Dolu ama
  eşleşmeyen bir kod satırı **hata** verir — sessizce başka bir kodla kayıt
  açmak, kullanıcının dosyasındaki kodu "yazıldı" sanmasına yol açardı.
- **`PARTIAL` (yarıda kesildi) diye bir sonuç vardır.** Doğrulama tüm satırlar
  için önceden koşar; yazma sırasında beklenmedik bir hata çıkarsa **ilk hatada
  durulur** ve sonuçta *"yazma N. satırda durdu"* yazar. Kısmi sonuç asla sessiz
  değildir; Geçmiş tablosunda da öyle görünür.
  (Gerekçe: gerçek tek-transaction, mevcut servis guard'larını çağırma kararıyla
  teknik olarak bağdaşmıyor — bkz. tasarım §7a/S1.)
- **Sipariş içe aktarımı YALNIZ YENİ SİPARİŞ AÇAR**, mevcut siparişi güncellemez.
  Aynı dosya iki kez yüklenirse **iki sipariş** olur. (Sipariş bir işlem kaydıdır;
  üzerine iş emri/sevkiyat bağlanır.) Aynı müşteriye son 90 günde aynı toplam
  metrajlı sipariş varsa **uyarı** verilir, engellenmez.
- **Rota ve Sipariş şablonları "gruplu"dur:** bir rotanın her ADIMI / bir
  siparişin her KALEMİ ayrı satırdır ve satırlar anahtar sütununa göre gruplanır.
  Adım/kalem listesi **replace**'tir: dosyada olmayan adım rotadan **silinir**.
- **Kalite Sınıfları ekranında "İçe Aktar" düğmesi YOKTUR** (o liste bilinçli
  salt-okunur), ama tür Veri Aktarımı ekranından aktarılabilir.
- **Dışa aktarım için ek izin yok** — listeyi görebilen indirebilir.
- **CSV biçimi:** `;` ayraç + ondalık **virgül** + UTF-8 BOM. Üçü birlikte bir
  sözleşmedir ("Türk Excel'i"): nokta yazılsaydı hücre metne düşer ve `SUM`
  sessizce çalışmazdı. Kendi içe aktarıcımız ayracı ve ondalığı **otomatik
  algılar**, yani indir-düzenle-geri yükle çalışır.

---

## 6) Riskler ve sınırlar

| Konu | Durum |
|---|---|
| **Satır tavanı** | İstek başına **10.000 satır**. Aşarsa panel dosyayı reddeder ve bölmeyi söyler. |
| **Gövde limiti** | `/api/import` ve `/api/config-bundle` router'ları **10 MB** JSON kabul eder. **Global 1 MB limiti DEĞİŞMEDİ** — gevşeme yalnız bu iki yola özgüdür. |
| **Performans** | 10.000 satırlık bir koşum **ölçülmedi**. Yazma mevcut servisler üzerinden satır satır ilerler (guard'lar korunsun diye). İlk gerçek kullanımda 200-500 satırla başlanması önerilir. |
| **Yeni npm paketi** | **YOK.** Backend'de CSV/XLSX ayrıştırıcı yok ve eklenmedi; dosyayı panel ayrıştırır (`exceljs` zaten paneldeydi). |
| **Mobil** | Etkilenmedi. |
| **Geri alma** | İçe aktarımın kendisi geri alınamaz (kayıtlar normal kayıttır). Yanlış yükleme panelden düzeltilir/pasife alınır. **Bu yüzden 3. adımdaki "önizleme" alışkanlığı sahaya anlatılmalı.** |

---

## 7) Bilinen açık — bu sürümle ilgili DEĞİL

`npm test` içinde `test_consistency.ts` **§18** (master-data ad mükerreri) tek
satır drift bildiriyor:

```
tablo=customers, ad=moda tekstil, adet=2
  MUS-002        Moda Tekstil   (2026-08-02)
  MUS1707260010  MODA TEKSTİL   (2026-07-17)
```

İkisi de **haftalar öncesine ait** ve bu sürümle ilgisi yok. 2.8.0'ın getirdiği
katlanmış (Türkçe harf-duyarsız) karşılaştırma bu tarihsel çifti artık "aynı ad"
sayıyor. **Veriye dokunma** — hangisinin doğru kart olduğu fabrikanın kararıdır;
biri pasife alınana kadar bekçi bu satırı bildirmeye devam eder.

---

## 8) Sürüm sonrası — hatırlatma

- 2.8.0'ın **künye backfill'i** (`--apply`) hâlâ zamana duyarlı bir adımdır;
  arama notundaki ilgili bölüm bu deploy'da da geçerlidir.
- İçe aktarım geçmişi (`import_runs`) **arşivlenmez**: audit 6 ayda arşive
  taşınır, bu tablo kalır ("bu 400 müşteriyi kim yükledi" sorusu yıllar sonra da
  sorulur).
