# UX-TUR · UX-1 — Ekran envanteri + bilgi mimarisi kararı

> Ölçüm tarihi 2026-10-26, taban `origin/main` `5a98a0b48`. Kod değişmedi; bu belge UX-2/3/4 istemlerinin kaynağıdır. PATRON onayı bekler (§4 kararları).
> Ölçüm yöntemi: `content-routes.tsx` (+ `reportV2Routes`/`customReportRoutes`), `pages/*/tile-config.ts` (+ `Reports/*/tile-config.ts`), `components/layout/nav-config.ts`, `command-entries*.ts`, `lib/route-modules.ts`, `Teks-Erp/src/constants/screen-catalog.ts` ve `report-catalog.ts` düğüm betiğiyle tabloya döküldü; tablet `mobil/src/types/permissions.ts` (`MOBILE_SCREENS`) + `screenModules.ts` + navigatörler; patron `patron/uygulama/app/**` + `src/ui/tabs.ts` + `src/lib/access.ts`. "Doğduğu commit" = rotanın ilk göründüğü commit (`git log -S`). PNG alınmadı (bu dilimin sınırı; UX-3'te).

## 0 · Özet

| Yüzey | Ekran | OK | KIRMIZI (menüde de palette de yok) | SARI (yalnız palet) | Muaf |
|---|---|---|---|---|---|
| Panel (Electron) | 164 ekran rotası (+22 detay/form/yönlendirme) · 10 hazır v2 rapor | 160 | **1** (`/definitions/label-templates`) | 2 (`/definitions/machines`, `/definitions/station-capabilities` — bilinçli yetim) | 1 (`/forbidden`) |
| Tablet (mobil) | 20 modül ekranı + 9 alt sayfa + 10 ayar alt ekranı | 39 | **0** | — | — |
| Patron uygulaması | 4 sekme + 9 "Diğer" modülü + 13 alt ekran | 26 | **0** | — | — |

Asıl bulunabilirlik açığı kırmızı satırlarda DEĞİL, **sessiz gizlemede**: panelde 27 karo (Operasyon 15 + Tanımlar 12), 2 yan menü kökü (Muhasebe, Maliyet & Teklif) ve 5 rapor kategorisi bayrak kapalıyken iz bırakmadan kaybolur; yalnız 4 Kalite Güvence karosu "kapalı" der ve o da yolu elle yazar (`settingRowPath` panelde yok). ORTAK-KURAL "kapalı özellik görünür kalır" der → §4 K3 kararı.

**İniş bekleyenler (2026-10-26 ölçümü, `gh pr list --state open` + uzak dallar):** `feature/izl-d5` (#216, açık PR — yeni ekran yok, yalnız palet derin girişi `/access/devices?kanit=1`) · `feature/bildirim-n6-enteg`, `feature/belge-veri`, `feat/rapor-kucukler`, `fix/kucuk-isler-c` (dal var, PR yok — ekran/karo/rota EKLEMİYOR, diff ölçüldü) · MAL-6 (teklif/fiyat listesi belgesi — ekran değil, `/cost/quotes/:id` ve `/cost/price-lists/:id` üzerinde belge düğmesi) · MAL-7 (iplik ihtiyaç planı — YENİ panel sayfası + rapor kataloğu satırı; dal yok) · KÜÇÜK-D (dal yok) · 5 v2 rapor satırı `hazir:false` (hiçbir yüzeyde çizilmez). Bunlar tablolarda "iniş bekliyor" olarak §1.4'te listelidir.

## 1 · Panel (Electron) envanteri

### 1.1 Ekran rotaları → Ek A (164 satır, belge sonunda). Kırmızı/sarı/muaf satırlar:

| Durum | Rota | Menü kökü › karo | Palet | İzin | Bayrak | Doğduğu commit (ay-gün · dalga) |
|---|---|---|---|---|---|---|
| KIRMIZI | `/definitions/label-templates` | — (içerik Tanımlar › Etiketler sekmesinde; bağımsız adres yetim) | YOK | label-template:read | — | 05-23  |
| SARI | `/definitions/machines` | — (bilinçli yetim: Üretim İstasyonları ekranına birleşti) | var | station:read | — | 05-11  |
| SARI | `/definitions/station-capabilities` | — (bilinçli yetim: Üretim İstasyonları ekranına birleşti) | var | station:read | productionEnabled | 05-11  |
| MUAF | `/forbidden` | — | YOK | — | — | 06-04 sevkiyat |

### 1.2 Ekran olmayan rotalar (detay · form · yönlendirme — üst ekrandan açılır, menü gerekmez)

| Rota | Tür | İzin |
|---|---|---|
| `/operations/loom-alarms/:id` | detay | loom:alarm-view |
| `/cost/items/:itemId` | detay | cost:read |
| `/cost/quotes/new` | form | quote:write |
| `/cost/quotes/:id` | detay | quote:read |
| `/cost/price-lists/:id` | detay | price-list:read |
| `/operations/stock-counts/:id` | detay | warehouse:read |
| `/definitions/label-templates/:id` | detay | label-template:write |
| `/definitions/document-designer/:id` | detay | DOCUMENT_DESIGN_READ |
| `/access/devices/:id` | detay | admin:settings |
| `/access/users/:id` | detay | admin:users |
| `/system/settings` | yönlendirme | — |
| `/system/update` | yönlendirme | — |
| `/system/server-updates` | yönlendirme | — |
| `/operations/work-orders/new` | form | workorder:write |
| `/operations/work-orders/:id/edit` | detay | workorder:write |
| `/operations/work-orders/:id` | detay | workorder:read |
| `/operations/kursun-queue` | yönlendirme | — |
| `/operations/shipments/direct/:id` | detay | shipping:read |
| `/operations/shipments/:id` | detay | shipping:read |
| `/operations/sack-search` | yönlendirme | — |
| `/operations/scan-dispatch` | yönlendirme | — |
| `/*` | yönlendirme | — |

### 1.3 Rapor Merkezi (v2) satırları — `reports.v2Enabled` açıkken `/reports` Rapor Merkezi'ni çizer; palet "Raporlar · Rapor Merkezi" bölümü `REPORT_CATALOG`tan üretilir

36 v1 satırı: 33'ü `kategoriV2:null` ("Eski raporlar" bandında, 26 birleşti · 7 taşındı · 3 uzman); taşınanların yeni girişi Operasyon hub'ında "İz sürme" bölümü (`RelocatedToolsSection`). Özel rapor: palet "Raporlar · Özel raporlar" → `/reports/ozel/yeni` (katalog anahtarı `reports/ozel`).

| Rapor (v2) | Panel yolu | Kategori | İzin | Bayrak | Durum |
|---|---|---|---|---|---|
| Ne kadar iş aldık? | `/reports/sales/siparis-talep` | satis-sevkiyat | report:sales | cekirdek:siparis-musteri | OK (Rapor Merkezi + palet) |
| Ne sevk ettik? | `/reports/sales/sevkiyat` | satis-sevkiyat | report:sales | cekirdek:siparis-musteri | OK (Rapor Merkezi + palet) |
| Sözümüzü tuttuk mu? | `/reports/sales/termin` | satis-sevkiyat | report:sales | cekirdek:siparis-musteri | OK (Rapor Merkezi + palet) |
| Açık siparişler hazır mı? | `/reports/sales/acik-siparisler` | satis-sevkiyat | report:sales | cekirdek:siparis-musteri | OK (Rapor Merkezi + palet) |
| Ne geri geldi, neden vazgeçildi? | `/reports/sales/vazgecilen-is` | satis-sevkiyat | report:sales | cekirdek:siparis-musteri | OK (Rapor Merkezi + palet) |
| Üretim nerede takıldı? | `/reports/production/uretim-akisi` | uretim | report:production | productionEnabled | HAZIR DEĞİL (çizilmez) |
| Kurşun Gramajı | `/reports/production/kursun-gramaj` | uretim | report:production | productionEnabled | OK (Rapor Merkezi + palet) · yeni |
| Kalite nasıl gidiyor? | `/reports/quality/kalite` | kalite | report:quality | productionEnabled | HAZIR DEĞİL (çizilmez) |
| Ne kaybettik? | `/reports/quality/kayip` | kalite | report:quality | productionEnabled | HAZIR DEĞİL (çizilmez) |
| Depoda ne yatıyor? | `/reports/inventory/depo` | uretim | report:inventory | cekirdek:stok-giris | HAZIR DEĞİL (çizilmez) |
| Fasoncular zamanında dönüyor mu? | `/reports/subcontract/fasoncular` | uretim | report:subcontract | planlanan:fason | HAZIR DEĞİL (çizilmez) |
| Tezgahlar verimli mi? | `/reports/dokuma/tezgah-randimani` | dokuma | report:production | dokumaEnabled | OK (Rapor Merkezi + palet) |
| Tezgahlar neden duruyor? | `/reports/dokuma/duruslar` | dokuma | report:production | dokumaEnabled | OK (Rapor Merkezi + palet) |
| Leventten beklenen kumaş çıktı mı? | `/reports/dokuma/levent-dengesi` | dokuma | report:production | dokumaEnabled | OK (Rapor Merkezi + palet) |
| Kimden ne alacağız? | `/reports/finance/alacaklar` | para | report:finance | financeEnabled | OK (Rapor Merkezi + palet) |

### 1.4 İniş bekleyen ekranlar (yerleşim önerisi şimdiden)

| İş | Ekran | Önerilen yer | Durum |
|---|---|---|---|
| MAL-6 | Teklif / fiyat listesi belgesi (PDF = Excel) | Ekran değil: `/cost/quotes/:id` ve `/cost/price-lists/:id` başlık eylemi "Belge"; şablon Tanımlar › Belge Şablonları'nda | iniş bekliyor (dal yok) |
| MAL-7 | İplik ihtiyaç planı | Maliyet & Teklif › "İplik İhtiyacı" karosu + Rapor Merkezi satırı (tek kayıt, iki giriş) — ya da iplik modülü açıksa Operasyon › Depo & Paketleme › "İplik Stoğu" yanında; karar §4 K6 | iniş bekliyor (dal yok) |
| D5 (#216) | Cihaz anahtar halkası kaybı | `/access/devices?kanit=1` palet derin girişi (mevcut ekranın süzgeci) | açık PR |
| v2 rapor `hazir:false` (5) | Rapor Merkezi satırları | Rapor Merkezi kategorisi | çizilmez — hazır olunca kendiliğinden görünür |
| N6-ENTEG · belge-veri · rapor-küçükler · KÜÇÜK-C/D | yeni ekran yok | — | dal var, PR yok |

## 2 · Tablet (mobil) envanteri

Giriş: modül seçimi ızgarası (`ModuleSelectScreen`, sürüklenebilir sıra). Görünürlük `useVisibleScreens` = izin ∧ modül; modül kapalı ekran **ızgaradan sessizce düşer** (§4 K3). Ekran kataloğu (`screen-catalog.ts` mobil listesi) ile `MOBILE_SCREENS` 20/20 birebir, etiketler eşit.

| Durum | Ekran (anahtar) | Etiket | Giriş | İzin | Bayrak | Katalog adı |
|---|---|---|---|---|---|---|
| OK | `KK1` | Ham Giriş | Modül seçimi karosu | mobile:kk1 | productionEnabled | = |
| OK | `KursunQc` | Kurşun | Modül seçimi karosu | mobile:kk2-kursun | productionEnabled | = |
| OK | `Tambur` | Tambur | Modül seçimi karosu | mobile:tambur | productionEnabled | = |
| OK | `Depo` | Depo | Modül seçimi karosu | mobile:depo | — | = |
| OK | `TartiPaket` | Sevkiyat | Modül seçimi karosu | mobile:tarti-paket | — | = |
| OK | `Sevkiyat` | Sevk Çıkışı | Modül seçimi karosu | mobile:sevkiyat | — | = |
| OK | `FasonSevk` | Fason Sevk | Modül seçimi karosu | mobile:fason-sevk | — (planlanan:fason) | = |
| OK | `FasonKabul` | Fason Mal Kabul | Modül seçimi karosu | mobile:fason-kabul | — (planlanan:fason) | = |
| OK | `KartelaSevk` | Kartela Sevk | Modül seçimi karosu | mobile:kartela-sevk | — (planlanan:kartela) | = |
| OK | `KartelaKabul` | Kartela Kabul | Modül seçimi karosu | mobile:kartela-kabul | — (planlanan:kartela) | = |
| OK | `IadeGirisi` | İade Girişi | Modül seçimi karosu | mobile:iade | — | = |
| OK | `HizliIsEmri` | Hızlı Terbiye İş Emri | Modül seçimi karosu | mobile:hizli-is-emri | productionEnabled | = |
| OK | `Siparis` | Sipariş | Modül seçimi karosu | mobile:siparis | — | = |
| OK | `Kumas` | Kumaş Ekle | Modül seçimi karosu | mobile:kumas | — | = |
| OK | `KursunDagitim` | Kurşun Dağıtım | Modül seçimi karosu | mobile:kursun-dagitim | productionEnabled | = |
| OK | `Dokuma` | Tezgah | Modül seçimi karosu | mobile:dokuma | dokumaEnabled | = |
| OK | `Devere` | Levent Sarım | Modül seçimi karosu | mobile:devere | devereEnabled | = |
| OK | `FasonDokuma` | Fason Dokuma Kabul | Modül seçimi karosu | mobile:fason-kabul | dokumaEnabled | = |
| OK | `Uyarilar` | Uyarılar | Modül seçimi karosu | mobile:tezgah-uyari | tezgahEnabled | = |
| OK | `Muayene` | Muayene | Modül seçimi karosu | mobile:muayene | kaliteGuvenceEnabled | = |

**Alt sayfalar (üst ekrandan push, izin-bağımsız):** `SevkiyatGecmisi`, `SevkiyatDetay`, `Paketleme`, `CuvalDuzelt`, `HizliSiparis` (Tartı/Paket & Sevk Çıkışı'ndan) · `KartelaSevkGecmisi`, `KartelaKabulGecmisi`, `FasonSevkGecmisi`, `IadeGecmisi` (ilgili modülden) · `UyariDetay` (Uyarılar + yerel bildirim dokunuşu). Hepsi OK.

**Ayarlar / üst çubuk:** Ayarlar (`ScreenChrome` dişlisi) → `SettingsServer`, `SettingsServerPair`, `SettingsPlaceHardware`, `SettingsScanner`, `SettingsUpdate`, `SettingsSurumNotlari`, `SettingsPrintReports`, `SettingsWorkPreferences`, `SettingsLicense`, `SettingsNotifications`, `DevicePairing` — 11/11 `SettingsScreen` listesinden erişilir. Bildirim zili + gelen kutusu çekmecesi (`NotificationBellButton` → `InboxDrawer`) üst çubukta. Kırmızı: 0.

## 3 · Patron uygulaması envanteri

Kenar rayı (geniş ekran, `RAIL_GROUPS`) ve "Diğer" sekmesi (dar ekran, `MORE_GROUPS`) aynı modül listesini (`src/lib/access.ts`) farklı gruplarla çizer.

| Durum | Ekran | Rota | Giriş | İzin (herhangi biri) |
|---|---|---|---|---|
| OK | Pano | `/pano` | Sekme 1 | — |
| OK | Üretim | `/uretim` | Sekme 2 · Pano kartı | `bulut:uretim:oku` |
| OK | Siparişler | `/siparisler` · `/siparisler/[id]` · `/siparisler/yeni` | Sekme 3 · Pano kartı · "Yeni sipariş" başlık düğmesi | `bulut:siparis:oku` (yeni: yazma) |
| OK | Finans | `/finans` | Sekme 4 · Pano kartı | finans okuma ∨ `bulut:cari-bakiye:oku` |
| OK | Diğer | `/diger` | Sekme 5 | — |
| OK | Cariler | `/cariler` · `[id]` · `yeni` | Diğer › İş · sipariş detayından cari bağı | `bulut:cari:oku` ∨ `cari-bakiye:oku` ∨ `cari:yaz` |
| OK | Sevkiyat | `/sevkiyat` | Diğer › İş · Pano kartı | `bulut:sevkiyat:oku` |
| OK | Stok | `/stok` | Diğer › İş | `bulut:stok:oku` |
| OK | Raporlar | `/raporlar` · `[id]` · `yeni` | Diğer › İş · cari kartından "Ekstre" | `bulut:rapor:oku` |
| OK | Gelen kutusu | `/gelen-kutusu` · `[mesajId]` | Diğer › **Eylem** (dar) / **İş** (ray) | `bulut:siparis:yaz` ∨ `bulut:cari:yaz` |
| OK | Bildirimler (aslında bildirim AYARLARI) | `/bildirimler` | Diğer › Hesap · Profil › "Bildirim ayarları" | — |
| OK | Hesaplar | `/hesaplar` · `[id]` · `yeni` · `disa-aktar` | Diğer › Hesap | `bulut:hesap:yonet` |
| OK | Profil | `/profil` · `/hesap-sil` | Diğer › Hesap (üst kart) | — |
| OK | Kayıt detayı | `/kayit/[projeksiyon]/[id]` | listelerden (`src/ui/nav.ts`) | projeksiyon izni |
| OK | Giriş · Davet | `/giris` · `/davet` | oturum yok | — |

Kırmızı: 0. Tutarlılık bulguları §5 P1–P4.

## 4 · Bilgi mimarisi önerisi (tek sayfa) — PATRON KARARI

**Bugün (ölçülen):** yan menü iki grup — *Genel*: Anasayfa · Tanımlar · Operasyon · Raporlar · Bildirimler · Muhasebe¹ · Maliyet & Teklif¹; *Yönetim*: Yetkilendirme² · Sistem (¹ bayrakla GİZLENİR, ² yalnız yönetici). Hub'lar: Operasyon 29 karo / 5 grup (Satış & Planlama 3 · Üretim & Fason 9 · Depo & Paketleme 8 · Sevkiyat & İade 5 · Kalite Güvence 4), Tanımlar 29 karo / 4 grup (Ürün Kataloğu 5 · İş Ortakları 4 · Üretim & Kalite 14 · Çıktılar 6), Sistem 32 karo / 4 bölüm (Aktivite & Denetim 6 · İzleme & Sağlık 4 · Arşiv 4 · Yapılandırma 18), Muhasebe 9, Maliyet & Teklif 7, Yetkilendirme 5, Raporlar 9 kategori (+v2 Rapor Merkezi).

**Önerilen son hal (rotalar DEĞİŞMEZ; yalnız giriş yüzeyi, breadcrumb ebeveyni ve karo dosyası taşınır):**

| Sıra | Kök (yan menü) | İçerik | Gerekçe (ölçü) |
|---|---|---|---|
| 1 | Anasayfa | pano | — |
| 2 | Operasyon | Satış & Planlama · Üretim & Fason · Depo & Paketleme · Sevkiyat & İade · "İz sürme" | 29 → 25 karo |
| 3 | **Kalite Güvence** (YENİ kök, `/quality` hub) | Muayeneler · Lab Testleri · Sertifikalar · 4 Puan Kuralları · Muayene Raporu (palette var, karoya çıkar) | rotalar zaten `/quality/*`; ayrı persona (kalite sorumlusu); modül bayrağı tek |
| 4 | Maliyet & Teklif | Teklifler · Fiyat Listeleri · Hızlı Hesaplayıcı · Maliyet Kartları │ Parametreler · İplik Maliyet Fiyatları · Fason Tarifeleri (+ MAL-7 İplik İhtiyacı) | karo sırası "iş önce, parametre sonra" |
| 5 | Ön Muhasebe (ad: §4.1) | mevcut 9 karo | — |
| 6 | Raporlar | Rapor Merkezi (v2) / kategoriler (v1) + Özel raporlar | — |
| 7 | Tanımlar | Ürün Kataloğu · İş Ortakları · Üretim & Kalite | 29 → 23 karo |
| 8 | **Belgeler** (YENİ kök, hub `/documents` yalnız karo sayfası) | Etiketler · Belge Şablonları · Belge Tasarımcısı · Serbest Belgeler · Refakat Kartı · Refakat Kartı Şablonları (+ Yazdırma Geçmişi kısayolu) | Tanımlar › Çıktılar 6 karo + belge dalgası büyüdü; "çıktı" kavramı tanım değil |
| — | *Yönetim grubu* | | |
| 9 | Sistem | Aktivite & Denetim · İzleme & Sağlık · Arşiv · **Yapılandırma ikiye bölünür**: "Ayarlar" (Baskı & Cihazlar, Bu Bilgisayar, Şirket & Güvenlik, Modüller, Özellik Anahtarları, Numaralandırma, Bildirim Profilleri) ve "Bakım" (Güncellemeler, Yedekler, Veritabanı Geri Yükleme/Okuma Erişimi, Lisans, Destek, Hakkında, Sürüm Notları, Veri Aktarımı, Mükerrer Kayıtlar) | Yapılandırma 18 karo tek grupta en kalabalık |
| 10 | Yetkilendirme | Kullanıcılar · Yetki Şablonları · Yetki Kataloğu · Yönetim Bulutu │ Tabletler | — |

"Bildirimler" yan menü satırı kalkar: üst çubuk zili + palet + Sistem karosu üç giriş zaten var (§4.2).

**En önemli 5 karar (onay istenen):**
- **K1** Kalite Güvence ayrı yan menü kökü (`/quality` hub); Operasyon'daki 4 karo taşınır, Operasyon'da kopya karo AÇILMAZ.
- **K2** "Belgeler" ayrı kök: Tanımlar › Çıktılar grubunun 6 karosu taşınır; rotalar `/definitions/...` olarak KALIR (adres pazarlık dışı), yalnız breadcrumb ebeveyni "Belgeler" olur.
- **K3** Bayrakla kapalı karo/kök GÖRÜNÜR kalır, sönük çizilir, "kapalı — <yol>" der; yol panelde `settingRowPath` aynasından gelir (bugün panelde yok; `KALITE_GUVENCE_OFF_HINT` elle yazılmış). İSTİSNALAR (kapalı değil "anlamsız" olduğu için gizlenmeye devam): rejim yüklemleri (`depoMultiEnabled` tek depo, `shipmentConfirmationEnabled`, Cariler↔Müşteriler/Fason Firmalar takası) ve **tablet** (operatör ızgarasında kapalı modül gösterilmez — saha kuralı). `MALIYET-TEKLIF-PLAN.md:22` ("kapalı kurulumda menü yok") ve `DOKUMA-MANUEL-PLAN.md:107` ("karo gizli") bu kararla GEÇERSİZ olur → arşiv notu.
- **K4** Ad sözlüğü: `TERIM` (bugün yalnız 2 kavram: terbiye/dokuma iş emri) §4.1'deki 10 kavramla genişler; panel karo + katalog + palet + tablet + patron aynı sözlükten okur; katalog başlığı karo başlığına eşitlenir (bekçi).
- **K5** `tile-config` modül/grup dosyalarına bölünür (§4.4) ve `test_ekran_bulunabilirlik` bekçisi doğar: her ekran rotası karo ∨ yan menü ∨ üst çubuk ∨ palet (deep dahil) ∨ beyanlı istisna; istisna tabanı bugün 4 (`forbidden`, `label-templates`, `machines`, `station-capabilities`; son üçü yönlendirmeye çevrilince 1), yalnız aşağı.
- (K6, ikincil) MAL-7 İplik İhtiyacı karosu Maliyet & Teklif'te, rapor satırı Rapor Merkezi'nde.

### 4.1 Ad tutarlılığı (aynı kavram aynı ad) — `TERIM` genişleme listesi

| Kavram | Bugün geçen adlar (yer) | Öneri (TERIM anahtarı) |
|---|---|---|
| Muhasebe modülü | "Muhasebe" (yan menü, palet başlığı) · "Ön Muhasebe" (katalog, rapor kategorisi) · "Finans" (patron sekmesi) | **Ön Muhasebe** (`onMuhasebe`); patron sekmesi "Finans" kalabilir (kısa) ama ekran başlığı "Ön Muhasebe" |
| Tartı/paket istasyonu | tablet `TartiPaket` = "Sevkiyat" · tablet `Sevkiyat` = "Sevk Çıkışı" · panel "Paketleme / Çuvallar" | tablet **"Tartı & Paket"** (`tartiPaket`); "Sevkiyat" adı yalnız sevk belgesi için |
| Muhasebe sevk listesi | "Sevkiyatlar" ve "Sevkiyatlar (Muhasebe)" (iki Operasyon karosu) | ikincisi **"Sevk Edilenler"** (`TERIM_AD.sevkEdilenler`, KÜÇÜK-F): ekran yalnız DISPATCHED sevkleri listeler; saha adı, backend servisi ve tablet ekranı zaten bu adı kullanıyordu |
| Kurşun dağıtımı | panel "Kurşun Planlama" · tablet "Kurşun Dağıtım" | tek ad (`kursunDagitim`) |
| Tezgah alarmı | panel "Tezgah Alarmları" · tablet "Uyarılar" | **"Tezgah Alarmları"** (`tezgahAlarmi`); tablet etiketi aynı |
| Dokuma salonu / tezgah ekranı | panel "Tezgah Salonu" · tablet "Tezgah" | tablet **"Tezgah Ekranı"**; salon panelde kalır |
| Etkinlik / aktivite | karo "Etkinlik" · katalog "Aktivite Günlüğü" · bölüm "Aktivite & Denetim" · "Aktivite Arşivi" | **"Etkinlik Günlüğü"** + "Etkinlik Arşivi" (`etkinlik`) |
| Makine kartı | "Makine Kartları" (= `machine-collectors`!) · "Makineler (ayrı liste)" · "Üretim İstasyonları" | `machine-collectors` → **"Makine Veri Toplayıcıları"**; "Makine Kartları" adı boşa çıkar |
| Belge ailesi | "Belge Şablonları" · "Belge Tasarımcısı" · "Serbest Belgeler" · "Refakat Kartı Şablonları" · "Etiketler" | Belgeler kökünde alt başlıkla ayrılır: Şablonlar (belge/refakat/etiket) · Tasarımcı · Serbest Belgeler |
| Bildirim | panel "Bildirimler" = gelen kutusu · patron "Bildirimler" = AYARLAR, patron "Gelen kutusu" = talepler · panel "Bildirim profilleri" (küçük harf) | patron `/bildirimler` başlığı **"Bildirim Ayarları"**; "Bildirim Profilleri" büyük harf |
| Finans karoları | "Kurlar"/"Döviz Kurları" · "Kasa & Banka"/"Kasa ve Banka Hesapları" · "Fatura Kapama"/"Tahsisler" · "Tahsilat / Ödeme"/"Tahsilat ve Ödemeler" · "Çek / Senet"/"Çek ve Senetler" | karo adı tek kaynak; katalog başlığı karodan türer |
| Sipariş onarımı | "Siparişe Yazılamayanlar" / "Siparişe yazılamayan sevkiyatlar" | karo adı |
| Cari / müşteri | Tanımlar'da finans açıkken "Cariler", kapalıyken "Müşteriler" + "Fason Firmalar" (bilinçli takas) · patron "Cariler" | takas kalır; sözlükte belgelenir |

### 4.2 Çift girişler

| Hedef | Girişler | Öneri |
|---|---|---|
| `/notifications` | yan menü "Bildirimler" + Sistem karosu "Bildirimler" + üst çubuk zili + palet | yan menü satırı kalkar (zil + Sistem karosu + palet yeter) |
| `/release-notes` · `/system/updates` | Sistem karosu + palet "Kişisel" + üst çubuk güncelleme düğmesi | kalır (kişisel ↔ yönetsel bağlam farklı); palet "Kişisel" girişi ile Sistem girişi aynı etiketle, yinelenen satır tek gösterilir |
| Ayarlar | `/settings` (kişisel, üst çubuk) + palet "Ayarlar" bölümü (`settings-groups` kategorileri) + Sistem › Yapılandırma karoları | üç yüzey adla ayrılır: "Kişisel Ayarlar" · "Fabrika Ayarları" (Sistem › Ayarlar grubu) |
| `/definitions/label-templates` | bağımsız rota + Etiketler sekmesi (`?tab=`) | bağımsız rota `/definitions/labels?tab=templates`e yönlendirme olur (KIRMIZI kapanır) |
| `/definitions/machines`, `/definitions/station-capabilities` | yalnız palet (Üretim İstasyonları'na birleşmiş) | ya yönlendirme ya beyanlı istisna; öneri: yönlendirme + palet girişi korunur |
| Raporlar v1 ↔ v2 | bayrak açıkken Rapor Merkezi + "Eski raporlar" bandı | kalır (R-plan §8 kararı); eski sayfaların kaldırılması ayrı karar |

### 4.3 Kayıp (bulunması zor) ekranlar

1. `/definitions/label-templates` — menüde ve palette yok (tek KIRMIZI).
2. Bayrak kapalı kurulumda 27 karo + 2 kök + 5 rapor kategorisi: kullanıcı "nerede?" diye sorduğunda ekranda hiçbir iz yok (K3).
3. `/quality/inspections` raporu "Muayene Raporu" yalnız palette (`quality:inspection-report`) ve sevkiyat detayında; karosu yok → Kalite Güvence hub'ına karo.
4. Operasyon "İz sürme" bölümü (taşınan rapor araçları) yalnız `flagsReady` ve v2 açıkken; v2 kapalıyken eski yol (Raporlar) — doğru, ama karo başlığı yok, bölüm hub'ın en altında.

### 4.4 `tile-config` bölünme planı (eslint geçici notunu kaldırır)

Bugün `Electron/eslint.config.mjs` `KATALOG_DOSYALARI` iki karo dosyasını `max-lines` dışında tutuyor (Operations 586 satır, System 389) ve gerekçesi "bekçiler karoyu bu dosyada arar, bölünemez"; Definitions (361) uyarıda.
- `pages/Operations/tiles/{planning,production,warehouse,shipping}.ts` + `pages/Quality/tile-config.ts` (K1) · `pages/System/tiles/{activity,monitoring,archive,settings,maintenance}.ts` · `pages/Definitions/tiles/{catalog,partners,production}.ts` + `pages/Documents/tile-config.ts` (K2). Her eski `tile-config.ts` yalnız sıralı birleşim (`export const operationsTiles = [...planning, ...production, …]`) olur — sıra ve palet paritesi (aynı `visibleWhen` fonksiyon nesnesi) korunur.
- Bekçiler: `test_screen_catalog` ve `test_ekran_yolu` karoyu dosya yolundan arıyor → `pages/**/tile-config.ts` + `pages/**/tiles/*.ts` glob'una geçer; yeni dosya iki tarayıcıya da negatif sondayla koşturulur.
- Ardından iki karo dosyası `KATALOG_DOSYALARI`ndan çıkar; her parça ≤300 satır.

## 5 · Bulgu listesi

**Responsive (panel; UX-3 PNG ile doğrulanacak, kök nedenler koddan okundu)**
- **R1** Kenar çubuğu sabit genişlik (`Sidebar.tsx`: `w-56` / daralmış `w-[72px]`), kırılma noktası yok; durum yalnız `localStorage("sidebar.collapsed")` → 600 px'te açık kalır ve içeriğin %37'sini yer. Öneri: ≤1024 px'te otomatik daralt, ≤768 px'te çekmece (`Sheet`) + karartma.
- **R2** 600 px'te diyalogların kenar çubuğu altında kalması: sekme-kapsamlı diyalog (`dialog.tsx` `scoped` dalı) sekme kabına portallanıyor, içerik `w-full max-w-lg` + `left-1/2 -translate-x-1/2` — kap 512 px'ten darsa diyalog kabın soluna taşar ve kenar çubuğunun altına girer (çubuk `backdrop-blur` ile kendi yığın bağlamını kurar). Öneri: kapsamlı diyalogda `max-w-[min(32rem,100%)]` + kabın `inset` sınırı; dar ekranda tam genişlik.
- **R3** Sayfa başlığı açıklaması kelime kelime kırılıyor: `PageHeader` satırı `flex justify-between` ama `flex-wrap` yok, eylem bloğu küçülmüyor, `px-6` sabit → metin sütunu `min-w-0` ile birkaç piksele iner. Öneri: `flex-wrap` + eylemler dar ekranda alt satıra; açıklama `line-clamp-2`.
- **R4** Üst çubuk taşıyor: tek satır `h-12`, arama düğmesi sabit `w-56`, ardından kanal rozeti, destek oturumu rozeti, alarm zili, bildirim zili, güncelleme düğmesi, kullanıcı menüsü, pencere kontrolleri. Öneri: <768 px'te arama yalnız simge, rozetler taşma menüsüne.
- **R5** `components/` + `pages/` içinde 111 sabit piksel `w-[NNNpx]`/`min-w-[…]` kullanımı (ORTAK-KURAL "sabit piksel varsaymaz"); UX-3 sayfa sayfa eler, tablolar yatay kaydırmalı kaba.
- **R6** Bildirim çekmecesi tasarımda 420 px sabit (`BILDIRIM-SISTEMI-PLAN.md` §6.1) → dar ekranda `min(420px,100vw)`.
- **R7** Diyalog tabanı `max-h-[90vh]` iyi; seçici modallar dar ekranda tam ekran olmalı (UX-3 kabul eşiği).

**Bulunabilirlik / tutarlılık (panel)**
- **B1** 27 karo + 2 yan menü kökü + 5 rapor kategorisi bayrak kapalıyken sessizce gizlenir (liste: Operasyon `work-orders`, `work-order-events`, `product-balance`, `weaving-orders`, `machine-stops`, `weaving-floor`, `loom-alarms`, `warp-beams`, `yarn-stock`, `goods-receipts`, `purchase-orders`, `warehouse-transfers`, `stock-counts`, `sack-store`, `kursun-dagitim`; Tanımlar `item-prices`, `cariler`, `customers`, `subcontractors`, `shift-definitions`, `loom-alarm-duty`, `machine-collectors`, `machine-stop-codes`, `routes`, `product-recipes`, `warp-specs`, `traveler-card`) → K3.
- **B2** `KALITE_GUVENCE_OFF_HINT = "Kalite Güvence kapalı — Genel Ayarlar'dan açılır"` elle yazılmış yol; `settingRowPath` yalnız backend'de, `test_ayar_yol_tarifi` panel `src`'yi taramıyor → panel aynası + tarayıcı kapsamı.
- **B3** Katalog başlığı ↔ karo başlığı 10 karoda + 1 yan menü kökünde ayrışıyor (Muhasebe, 5 finans karosu, Etkinlik, Siparişe Yazılamayanlar, Dokuma/Ön Muhasebe rapor kategorileri, Bildirim profilleri; §4.1); `test_screen_catalog` başlık eşitliğini ölçmüyor.
- **B4** `TERIM` yalnız iki kavram taşıyor; panel/tablet/patron aynaları bayt-eşit (`terim.ts` üçlüsü ölçüldü) — genişleme üç aynaya birden.
- **B5** "Makine Kartları" karosu `machine-collectors`'a gidiyor; "Makineler" ayrı listesi palette "Makine tablosu" diye geçiyor — ad çakışması.
- **B6** Muayene Raporu karosuz (yalnız palet + sevkiyat detayı).
- **B7** `MALIYET-TEKLIF-PLAN.md:22` ve `DOKUMA-MANUEL-PLAN.md:107` "menü yok / karo gizli" diyor; ORTAK-KURAL ile çelişki → K3 ile çözülür, arşive GEÇERSİZ notu.
- **B8** eslint `KATALOG_DOSYALARI` geçici muafiyeti (Operations/System tile-config) → §4.4.

**Tablet**
- **T1** Modül kapalı ekran ızgaradan düşer (K3 istisnası olarak onaylanması önerilir).
- **T2** `TartiPaket` etiketi "Sevkiyat", `Sevkiyat` etiketi "Sevk Çıkışı" — anahtar ↔ etiket ters izlenim (§4.1).
- **T3** "Uyarılar" (tablet) ↔ "Tezgah Alarmları" (panel) ↔ "Alarm Sorumluları" (Tanımlar) — tek sözlük.

**Patron uygulaması**
- **P1** `/bildirimler` ekranı bildirim AYARLARI; panelde "Bildirimler" gelen kutusu demek → başlık "Bildirim Ayarları".
- **P2** "Gelen kutusu" dar ekranda "Eylem" grubunda, geniş rayda "İş" grubunda (`MORE_GROUPS` ↔ `RAIL_GROUPS` ayrışması) → tek grup tablosu.
- **P3** "Finans" sekmesi ↔ panel "Muhasebe"/"Ön Muhasebe" (§4.1).
- **P4** Modül listesi `src/lib/access.ts`, sekme listesi `src/ui/tabs.ts`, ikon `src/ui/icons.ts`, grup `tabs.ts` — dört dosya; başlık tek kaynaktan değil (`tabs.ts` başlığı `access.ts` başlığını yinelemiş).

**Plan belgelerindeki UX notları (`grep "UX|responsive|dar ekran"` taraması):** `BELGE-SABLON-TASARIMCISI-PLAN.md` §4 (editör: sürükle-bırak bloklar — dar ekranda salt-okunur adayı) · `BILDIRIM-SISTEMI-PLAN.md` §6 (zil 420 px, R6) · `IZLENEBILIRLIK-CIHAZ-PLAN.md` §6 (baskı geçmişi bağlantısı detaylarda; durum renkleri) · `ISTASYON-YETENEK-KURSUN-PLAN.md` §4 (tablet dokunma hedefi ≥64 dp, gramaj ≥96 dp — UX-4/tablet kabulüne taşınır) · `PATRON-UYGULAMA-V2-PLAN.md` (testID envanteri 65, 7 mağaza görüntüsü). "Responsive"/"dar ekran" kelimesi hiçbir planda geçmiyor → web responsive için önceden alınmış karar yok, UX-3 sıfırdan.

## 6 · UX-2/3/4 somut iş listesi

**UX-2 · menü/palet/katalog (panel + tablet + patron)** — K1–K5 onayından sonra
1. `/quality` hub sayfası + yan menü kökü "Kalite Güvence" + `pages/Quality/tile-config.ts` (4 karo + Muayene Raporu karosu); Operasyon `quality` grubu kalkar; breadcrumb ebeveyni; `screen-catalog` girdisi `quality`.
2. "Belgeler" kökü + `pages/Documents/tile-config.ts` (6 karo); Tanımlar › Çıktılar grubu kalkar; rotalar aynı.
3. Sistem › Yapılandırma → "Ayarlar" + "Bakım" iki bölüm.
4. Yan menüden "Bildirimler" satırı kalkar; Muhasebe → "Ön Muhasebe".
5. Kapalı karo görünürlüğü (K3): `HubTile.offHint` her modül karosuna, metin panel `settingRowPath` aynasından; `test_ayar_yol_tarifi` panel kaynaklarını tarar; yan menü kökü de sönük + ipucu. İstisna listesi (rejim yüklemleri) koda beyanlı.
6. `/definitions/label-templates`, `/definitions/machines`, `/definitions/station-capabilities` → yönlendirme (sekme/ana ekran); palet derin girişleri korunur.
7. `TERIM` +10 kavram (üç ayna); karo, katalog, palet, tablet `MOBILE_SCREENS`, patron `access.ts` başlıkları sözlükten; katalog başlığı = karo başlığı.
8. tile-config bölünmesi (§4.4) + bekçi glob'u + `KATALOG_DOSYALARI` kısalır.
9. YENİ `test_ekran_bulunabilirlik`: her ekran rotası (detay/form/yönlendirme hariç) karo ∨ yan menü ∨ üst çubuk ∨ palet ∨ beyanlı istisna; taban yalnız aşağı; negatif sonda (karosu silinen ekran kırmızı).
10. Tablet: `TartiPaket` → "Tartı & Paket", `Uyarilar` → "Tezgah Alarmları", `Dokuma` → "Tezgah Ekranı" (yalnız etiket; anahtar/izin değişmez).
11. Patron: `/bildirimler` → "Bildirim Ayarları"; `MORE_GROUPS`/`RAIL_GROUPS` tek tablodan; başlıklar `access.ts`ten.

**UX-3 · responsive web** (kabul: 390/768 px yatay kaydırma yok)
1. R1 kenar çubuğu çekmece (≤1024 daralt, ≤768 `Sheet`).
2. R2 kapsamlı diyalog genişliği; seçici modallar dar ekranda tam ekran.
3. R3 `PageHeader` sarma; R4 üst çubuk taşma menüsü.
4. R5 111 sabit piksel kullanımının taraması; tablo sarmalayıcısı (`overflow-x-auto`) ortak bileşene.
5. 20 ana sayfa × 3 genişlik (390/768/1280) × açık/koyu PNG; vitest taşma sondası.
6. Belge tasarımcısı (GrapesJS), düzen editörü (dnd), etiket stüdyosu: dar ekranda salt-okunur + uyarı.

**UX-4 · patron uygulaması**
1. P1–P4; bildirim izni ekranı (N5) adıyla P1 birleşir.
2. Boş durum metinleri + simge seti tek tablo (`icons.ts`); tel aynası bayt-eşit kontrolü.
3. jest + emülatör ekran görüntüleri (dar/geniş: Diğer sekmesi ↔ ray aynı grup).

---

## Ek A · Panel ekran tablosu (164 ekran rotası)

"Menü kökü › karo" = hub karosu ya da yan menü satırı; "Palet" = komut paletinde giriş (karo girişleri palete otomatik taşınır). Bayrak = `lib/route-modules.ts`. İzin = route kapısı (`ProtectedRoute`).

| Durum | Rota | Menü kökü › karo | Palet | İzin | Bayrak | Doğduğu commit (ay-gün · dalga) |
|---|---|---|---|---|---|---|
| OK | `/access` | Yan menü | var | admin:users | — | 05-11  |
| OK | `/access/devices` | Yetkilendirme › Tabletler | var | admin:settings | — | 07-10 padding + dil önizleme |
| OK | `/access/patron-bulut` | Yetkilendirme › Yönetim Bulutu | var | admin:users | — | 09-29 B3 |
| OK | `/access/permissions` | Yetkilendirme › Yetki Kataloğu | var | admin:users | — | 05-11  |
| OK | `/access/templates` | Yetkilendirme › Yetki Şablonları | var | admin:users | — | 05-11  |
| OK | `/access/users` | Yetkilendirme › Kullanıcılar | var | admin:users | — | 05-11  |
| OK | `/cost` | Yan menü | var | ["cost:read","quote:read","price-list:read"] | maliyetEnabled | 10-25 MAL-3 |
| OK | `/cost/calculator` | Maliyet & Teklif › Hızlı Hesaplayıcı | var | cost:read | maliyetEnabled | 10-25 MAL-3 |
| OK | `/cost/finishing-rates` | Maliyet & Teklif › Fason Tarifeleri | var | cost:read | maliyetEnabled | 10-25 MAL-3 |
| OK | `/cost/items` | Maliyet & Teklif › Maliyet Kartları | var | cost:read | maliyetEnabled | 10-25 MAL-3 |
| OK | `/cost/parameters` | Maliyet & Teklif › Maliyet Parametreleri | var | cost:read | maliyetEnabled | 10-25 MAL-3 |
| OK | `/cost/price-lists` | Maliyet & Teklif › Fiyat Listeleri | var | price-list:read | maliyetEnabled | 10-26 MAL-5 |
| OK | `/cost/quotes` | Maliyet & Teklif › Teklifler | var | quote:read | maliyetEnabled | 10-26 MAL-5 |
| OK | `/cost/yarn-prices` | Maliyet & Teklif › İplik Maliyet Fiyatları | var | cost:read | maliyetEnabled | 10-25 MAL-3 |
| OK | `/definitions` | Yan menü | var | — | — | 05-11  |
| OK | `/definitions/cariler` | Tanımlar › Cariler | var | ["customer:read","subcontractor:read"] | — | 08-14 cari |
| OK | `/definitions/colors` | Tanımlar › Renkler | var | property:read | — | 05-11  |
| OK | `/definitions/customers` | Tanımlar › Müşteriler | var | customer:read | — | 05-11  |
| OK | `/definitions/defect-types` | Tanımlar › Hata Tipleri | var | quality:read | — | 05-11  |
| OK | `/definitions/document-designer` | Tanımlar › Belge Tasarımcısı | var | DOCUMENT_DESIGN_READ | — | 10-25 T2 |
| OK | `/definitions/document-templates` | Tanımlar › Belge Şablonları | var | DOCUMENT_DESIGN_READ | — | 06-07  |
| OK | `/definitions/fabric-properties` | Tanımlar › Kumaş Özellikleri | var | property:read | — | 05-11  |
| OK | `/definitions/free-documents` | Tanımlar › Serbest Belgeler | var | DOCUMENT_DESIGN_READ | — | 07-30  |
| OK | `/definitions/item-prices` | Tanımlar › Kalem Fiyatları | var | item:read | ticaretEnabled | 08-14 ticaret |
| OK | `/definitions/items` | Tanımlar › Ürünler | var | item:read | — | 05-11  |
| KIRMIZI | `/definitions/label-templates` | — (içerik Tanımlar › Etiketler sekmesinde; bağımsız adres yetim) | YOK | label-template:read | — | 05-23  |
| OK | `/definitions/labels` | Tanımlar › Etiketler | var | ["station:read","label-template:read"] | — | 06-30 tile 8→4 TAMAM |
| OK | `/definitions/loom-alarm-duty` | Tanımlar › Alarm Sorumluları | var | loom:spec-manage | tezgahEnabled | 10-11 dokuma-alarm |
| OK | `/definitions/machine-collectors` | Tanımlar › Makine Kartları | var | loom:spec-manage | tezgahEnabled | 10-13 makine duruşu D5 dilim 3a |
| OK | `/definitions/machine-stop-codes` | Tanımlar › Duruş Kodu Eşleme | var | loom:spec-manage | tezgahEnabled | 10-13 makine duruşu D5 dilim 3b |
| SARI | `/definitions/machines` | — (bilinçli yetim: Üretim İstasyonları ekranına birleşti) | var | station:read | — | 05-11  |
| OK | `/definitions/peripherals` | Tanımlar › Donanım | var | station:read | — | 06-29 tüm ağaç yeşil |
| OK | `/definitions/product-recipes` | Tanımlar › Terbiye İş Emri Şablonları | var | station:read | productionEnabled | 05-31  |
| OK | `/definitions/quality-grades` | Tanımlar › Kalite Sınıfları | var | quality:read | — | 05-11  |
| OK | `/definitions/reason-presets` | Tanımlar › Hazır Sebepler | var | roll:read | — | 08-19 sebep |
| OK | `/definitions/return-reasons` | Tanımlar › İade Nedenleri | var | return:read | — | 06-05  |
| OK | `/definitions/routes` | Tanımlar › Üretim Rotaları | var | station:read | productionEnabled | 05-11  |
| OK | `/definitions/sack-tags` | Tanımlar › Çuval İzleri | var | shipping:read | — | 09-04 panel |
| OK | `/definitions/shift-definitions` | Tanımlar › Vardiya Tanımları | var | loom:spec-manage | dokumaEnabled | 10-10 Tanımlar karosu, önizlemeli  |
| SARI | `/definitions/station-capabilities` | — (bilinçli yetim: Üretim İstasyonları ekranına birleşti) | var | station:read | productionEnabled | 05-11  |
| OK | `/definitions/stations` | Tanımlar › Üretim İstasyonları | var | station:read | — | 05-11  |
| OK | `/definitions/subcontractor-categories` | Tanımlar › Fason Kategorileri | var | subcontractor:read | — | 05-11  |
| OK | `/definitions/subcontractors` | Tanımlar › Fason Firmalar | var | subcontractor:read | — | 05-11  |
| OK | `/definitions/traveler-card` | Tanımlar › Refakat Kartı | var | DOCUMENT_DESIGN_READ | productionEnabled | 06-07  |
| OK | `/definitions/traveler-card-studio` | Tanımlar › Refakat Kartı Şablonları | var | DOCUMENT_DESIGN_READ | — | 08-04  |
| OK | `/definitions/warehouses` | Tanımlar › Depolar | var | warehouse:read | — | 08-13 depo |
| OK | `/definitions/warp-specs` | Tanımlar › Çözgü Kartları | var | warpspec:read | devereEnabled | 09-12 Faz 1a son adim |
| OK | `/finance` | Yan menü | var | finance:read | financeEnabled | 08-13 muhasebe |
| OK | `/finance/accounts` | Muhasebe › Kasa & Banka | var | finance:read | financeEnabled | 08-13 muhasebe |
| OK | `/finance/allocations` | Muhasebe › Fatura Kapama | var | finance:read | financeEnabled | 08-14 muhasebe |
| OK | `/finance/cari` | Muhasebe › Cari Hesaplar | var | finance:read | financeEnabled | 08-13 muhasebe |
| OK | `/finance/cash-transactions` | Muhasebe › Kasa Hareketleri | var | finance:read | financeEnabled | 08-14 F3/K3 |
| OK | `/finance/cheques` | Muhasebe › Çek · Senet | var | finance:read | financeEnabled | 08-14 muhasebe |
| OK | `/finance/invoices` | Muhasebe › Faturalar | var | finance:read | financeEnabled | 08-13 muhasebe |
| OK | `/finance/payments` | Muhasebe › Tahsilat · Ödeme | var | finance:read | financeEnabled | 08-13 muhasebe |
| OK | `/finance/period-close` | Muhasebe › Dönem Kapanışı | var | finance:read | financeEnabled | 08-14 muhasebe |
| OK | `/finance/rates` | Muhasebe › Kurlar | var | finance:read | financeEnabled | 08-13 muhasebe |
| MUAF | `/forbidden` | — | YOK | — | — | 06-04 sevkiyat |
| OK | `/notifications` | Sistem › Bildirimler · Yan menü | var | — | — | 10-25 bildirim |
| OK | `/operations` | Yan menü | var | — | — | 05-11  |
| OK | `/operations/accounting-dispatch` | Operasyon › Sevk Edilenler | var | ["shipping:read","report:sales"] | — | 06-13 Electron Vitest + mobil jest |
| OK | `/operations/allocation-repair` | Operasyon › Siparişe Yazılamayanlar | var | shipping:repair-allocation | — | 09-06 sevkiyat |
| OK | `/operations/e-irsaliye` | Operasyon › e-İrsaliye Kayıtları | var | eirsaliye:read | — | 10-25 e-irsaliye |
| OK | `/operations/goods-receipts` | Operasyon › Mal Kabul | var | goods-receipt:read | ticaretEnabled | 08-13 depo |
| OK | `/operations/kartela` | Operasyon › Kartela Takibi | var | kartela:read | — | 06-04 sevkiyat |
| OK | `/operations/kursun-dagitim` | Operasyon › Kurşun Planlama | var | ["quality:write","workorder:distribute"] | productionEnabled | 07-31 kursun |
| OK | `/operations/loom-alarms` | Operasyon › Tezgah Alarmları | var | loom:alarm-view | tezgahEnabled | 10-11 dokuma-alarm |
| OK | `/operations/machine-stops` | Operasyon › Tezgah Duruşları | var | ["loom:manual-entry","loom:classify"] | dokumaEnabled | 09-14 manifesto/karo/route/ROUTE_M |
| OK | `/operations/orders` | Operasyon › Siparişler | var | order:read | — | 05-11  |
| OK | `/operations/product-balance` | Operasyon › Kumaş Dengesi | var | workorder:read | productionEnabled | 06-01 coverage+sevkiyat |
| OK | `/operations/purchase-orders` | Operasyon › Alış Siparişleri | var | ["purchase-order:read","purchase-order:write"] | ticaretEnabled | 08-14 ticaret |
| OK | `/operations/relabel-station` | Operasyon › Yeniden Etiketle | var | ["roll:write","label:edit"] | — | 06-15 relabel |
| OK | `/operations/returns` | Operasyon › İade Takibi | var | return:read | — | 06-05  |
| OK | `/operations/rolls` | Operasyon › Kumaş Stoğu | var | roll:read | — | 05-11  |
| OK | `/operations/sack-content-edit` | Operasyon › Paketleme · Çuvallar | var | shipping:write | — | 06-19 shipping |
| OK | `/operations/sack-store` | Operasyon › Sevk Kapısı | var | shipping:read | — | 06-07  |
| OK | `/operations/shipments` | Operasyon › Sevkiyatlar | var | shipping:read | — | 05-11  |
| OK | `/operations/stock-counts` | Operasyon › Stok Sayımı | var | warehouse:read | ticaretEnabled | 08-15 J2 TAMAM |
| OK | `/operations/warehouse-transfers` | Operasyon › Depo Transferi | var | warehouse:transfer | depoMultiEnabled | 08-13 depo |
| OK | `/operations/warp-beams` | Operasyon › Leventler | var | warpbeam:read | devereEnabled | 09-14 dört kapı, 3 izin |
| OK | `/operations/weaving-floor` | Operasyon › Tezgah Salonu | var | loom:live-view | tezgahEnabled | 10-10 panel |
| OK | `/operations/weaving-orders` | Operasyon › Dokuma İş Emirleri | var | weavingorder:read | dokumaEnabled | 09-14 tek commit |
| OK | `/operations/work-order-events` | Operasyon › Terbiye İş Emri Hareketleri | var | workorder:read | productionEnabled | 09-25 iş emri no / top barkodu |
| OK | `/operations/work-orders` | Operasyon › Terbiye İş Emirleri | var | workorder:read | productionEnabled | 05-11  |
| OK | `/operations/yarn-stock` | Operasyon › İplik Stoğu | var | warehouse:read | iplikEnabled | 08-14 ticaret |
| OK | `/quality/certificates` | Operasyon › Sertifikalar | var | certificate:read | kaliteGuvenceEnabled | 10-25 K4P-SERT |
| OK | `/quality/inspection-rules` | Operasyon › 4 Puan Kuralları | var | inspection:read | kaliteGuvenceEnabled | 10-25 kalite |
| OK | `/quality/inspections` | Operasyon › Muayeneler | var | inspection:read | kaliteGuvenceEnabled | 10-25 liste/özet/detay/düzelt/ipta |
| OK | `/quality/lab-tests` | Operasyon › Lab Testleri | var | labtest:read | kaliteGuvenceEnabled | 10-25 K4P-LAB |
| OK | `/release-notes` | Sistem › Sürüm Notları | var | — | — | 09-24 panel |
| OK | `/reports` | Yan menü | var | — | — | 05-11  |
| OK | `/reports/audit` | Raporlar › Denetim | var | report:audit | — | 05-23  |
| OK | `/reports/audit/system-log-summary` | Raporlar › Denetim › Denetim Kaydı Özeti | var | report:audit | — | 05-23  |
| OK | `/reports/audit/user-activity` | Raporlar › Denetim › Kullanıcı Aktivitesi | var | report:audit | — | 05-23  |
| OK | `/reports/customer` | Raporlar › Müşteri | var | report:customer | — | 05-23  |
| OK | `/reports/customer/order-profile` | Raporlar › Müşteri › Müşteri Sipariş Profili | var | report:customer | — | 05-23  |
| OK | `/reports/customer/scorecard` | Raporlar › Müşteri › Müşteri Karnesi | var | report:customer | — | 08-27  |
| OK | `/reports/dokuma` | Raporlar › Dokuma | var | report:production | dokumaEnabled | 09-14 Dilim 5 |
| OK | `/reports/dokuma/durus-pareto` | Raporlar › Dokuma › Duruş Pareto | var | report:production | dokumaEnabled | 09-14 Dilim 5 |
| OK | `/reports/dokuma/kapasite-kullanimi` | Raporlar › Dokuma › Kapasite Kullanımı | var | report:production | dokumaEnabled | 10-21 rapor |
| OK | `/reports/dokuma/karne` | Raporlar › Dokuma › Karne Listesi ve Mühür | var | report:production | dokumaEnabled | 09-14 Dilim 5 |
| OK | `/reports/dokuma/levent-bitis-tahmini` | Raporlar › Dokuma › Levent Bitiş Tahmini | var | report:production | dokumaEnabled | 10-21 rapor |
| OK | `/reports/dokuma/levent-sonucu` | Raporlar › Dokuma › Levent Sonucu | var | report:production | dokumaEnabled | 10-21 rapor |
| OK | `/reports/dokuma/mudahale` | Raporlar › Dokuma › Müdahale ve Çözüm Süresi | var | report:production | dokumaEnabled | 10-13 rapor |
| OK | `/reports/dokuma/randiman` | Raporlar › Dokuma › Randıman | var | report:production | dokumaEnabled | 09-14 Dilim 5 |
| OK | `/reports/dokuma/vardiya-karnesi` | Raporlar › Dokuma › Vardiya Karnesi | var | report:production | dokumaEnabled | 09-14 Dilim 5 |
| OK | `/reports/dokuma/zincir` | Raporlar › Dokuma › Üretim Zinciri | var | report:production | dokumaEnabled | 09-18 strict, rapor kapısı |
| OK | `/reports/finance` | Raporlar › Ön Muhasebe | var | report:finance | financeEnabled | 08-14 muhasebe |
| OK | `/reports/finance/aging` | Raporlar › Ön Muhasebe › Cari Yaşlandırma | var | report:finance | financeEnabled | 08-14 muhasebe |
| OK | `/reports/finance/cash-book` | Raporlar › Ön Muhasebe › Kasa & Banka Defteri | var | report:finance | financeEnabled | 08-14 muhasebe |
| OK | `/reports/finance/cheque-due` | Raporlar › Ön Muhasebe › Çek Vade Takvimi | var | report:finance | financeEnabled | 08-14 H4 |
| OK | `/reports/finance/fx-diff` | Raporlar › Ön Muhasebe › Kur Farkı Raporu | var | report:finance | financeEnabled | 08-15 +route/karo dikişi |
| OK | `/reports/finance/vat-summary` | Raporlar › Ön Muhasebe › KDV Dönem Özeti | var | report:finance | financeEnabled | 08-14 H4 |
| OK | `/reports/inventory` | Raporlar › Stok & Depo | var | report:inventory | — | 05-23  |
| OK | `/reports/inventory/scorecard` | Raporlar › Stok & Depo › Stok & Ölü Stok | var | report:inventory | — | 08-10 paralel oturumların toplu co |
| OK | `/reports/production` | Raporlar › Üretim | var | report:production | productionEnabled | 05-23  |
| OK | `/reports/production/batch-trace` | Raporlar › Üretim › Parti İzleme | var | report:production | productionEnabled | 08-10 paralel oturumların toplu co |
| OK | `/reports/production/operator-performance` | Raporlar › Üretim › Operatör İş Hacmi | var | report:production | productionEnabled | 05-23  |
| OK | `/reports/production/traveler-trace` | Raporlar › Üretim › Top İzleme | var | report:production | productionEnabled | 05-23  |
| OK | `/reports/production/wip` | Raporlar › Üretim › Nerede Takıldı (WIP) | var | report:production | productionEnabled | 08-10 paralel oturumların toplu co |
| OK | `/reports/quality` | Raporlar › Kalite | var | report:quality | productionEnabled | 05-23  |
| OK | `/reports/quality/plan-deviation-scorecard` | Raporlar › Kalite › Plan-Sapma Karnesi | var | report:quality | productionEnabled | 08-19 tambur |
| OK | `/reports/quality/scorecard` | Raporlar › Kalite › Kalite Karnesi | var | report:quality | productionEnabled | 08-10 paralel oturumların toplu co |
| OK | `/reports/quality/scrap-scorecard` | Raporlar › Kalite › Fire Karnesi | var | report:quality | productionEnabled | 08-10 paralel oturumların toplu co |
| OK | `/reports/sales` | Raporlar › Sipariş & Sevkiyat | var | report:sales | — | 05-23  |
| OK | `/reports/sales/demand-analysis` | Raporlar › Sipariş & Sevkiyat › Talep Analizi | var | report:sales | — | 08-27  |
| OK | `/reports/sales/destination-mix` | Raporlar › Sipariş & Sevkiyat › Yurtiçi · Yurtdışı Satış | var | report:sales | — | 09-23 R2 ② |
| OK | `/reports/sales/open-order-coverage` | Raporlar › Sipariş & Sevkiyat › Açık Sipariş Karşılanma | var | report:sales | — | 08-27  |
| OK | `/reports/sales/order-cancellation` | Raporlar › Sipariş & Sevkiyat › Sipariş İptal Karnesi | var | report:sales | — | 08-27  |
| OK | `/reports/sales/order-intake` | Raporlar › Sipariş & Sevkiyat › Sipariş Karnesi | var | report:sales | — | 08-27  |
| OK | `/reports/sales/order-leadtime` | Raporlar › Sipariş & Sevkiyat › Sipariş → Teslim Süresi | var | report:sales | — | 08-27  |
| OK | `/reports/sales/return-scorecard` | Raporlar › Sipariş & Sevkiyat › İade Karnesi | var | report:sales | — | 08-10 paralel oturumların toplu co |
| OK | `/reports/sales/shipment-scorecard` | Raporlar › Sipariş & Sevkiyat › Sevk & Termin Karnesi | var | report:sales | — | 08-10 paralel oturumların toplu co |
| OK | `/reports/subcontract` | Raporlar › Fason | var | report:subcontract | — | 05-23  |
| OK | `/reports/subcontract/scorecard` | Raporlar › Fason › Fason Karnesi | var | report:subcontract | — | 08-10 paralel oturumların toplu co |
| OK | `/settings` | Üst çubuk › kullanıcı menüsü › Ayarlar | — | — | 05-31  |
| OK | `/settings/notifications` | Ayarlar sayfası › Bildirim tercihleri kartı | — | — | 10-26 bildirim |
| OK | `/system` | Yan menü | var | SYSTEM_HUB_ACCESS | — | 05-11  |
| OK | `/system/about` | Sistem › Hakkında | var | license:view | — | 09-29 Faz 1d, gözlem |
| OK | `/system/activity` | Sistem › Etkinlik | var | SYSTEM_ACTIVITY_ACCESS | — | 05-23  |
| OK | `/system/archive` | Sistem › Aktivite Arşivi | var | admin:settings +sistem | — | 05-23  |
| OK | `/system/archive/search` | Sistem › Arşiv Tarama | var | SYSTEM_ACTIVITY_ACCESS | — | 05-23  |
| OK | `/system/backups` | Sistem › Yedekler | var | SYSTEM_BACKUPS_ACCESS | — | 06-10  |
| OK | `/system/clients` | Sistem › Bağlı İstemciler | var | SYSTEM_CLIENTS_ACCESS | — | 09-04 sistem |
| OK | `/system/company` | Sistem › Şirket & Güvenlik | var | SETTINGS_COMPANY_ACCESS | — | 09-24 yetki |
| OK | `/system/data-import` | Sistem › Veri Aktarımı | var | data:import | — | 08-19 içe aktarım |
| OK | `/system/db-restore` | Sistem › Veritabanı Geri Yükleme | var | admin:settings +sistem | — | 07-30  |
| OK | `/system/duplicates` | Sistem › Mükerrer Kayıtlar | var | master-data:merge | — | 08-19 mükerrer |
| OK | `/system/feature-flags` | Sistem › Özellik Anahtarları | var | SETTINGS_FLAGS_ACCESS | — | 09-04 fabrika |
| OK | `/system/license` | Sistem › Lisans | var | LICENSE_ACCESS | — | 09-29 Faz 1d, gözlem |
| OK | `/system/logs` | Sistem › Sistem Kayıtları | var | SYSTEM_ACTIVITY_ACCESS | — | 05-11  |
| OK | `/system/module-profile` | Sistem › Modüller | var | admin:settings +sistem | — | 09-03 panel |
| OK | `/system/notification-profiles` | Sistem › Bildirim profilleri | var | NOTIFICATION_PROFILES_ACCESS | — | 10-26 bildirim |
| OK | `/system/numbering` | Sistem › Numaralandırma | var | settings:numbering | — | 09-22 C3 |
| OK | `/system/perf` | Sistem › Endpoint Performansı | var | admin:settings +sistem | — | 07-07 gozlem |
| OK | `/system/print-history` | Sistem › Yazdırma Geçmişi | var | SYSTEM_PRINT_HISTORY_ACCESS | — | 10-25 izlenebilirlik A3 |
| OK | `/system/printing` | Sistem › Baskı & Cihazlar | var | SETTINGS_PRINTING_ACCESS | — | 09-24 yetki |
| OK | `/system/read-only-db` | Sistem › Veritabanı Okuma Erişimi | var | admin:settings +sistem | — | 10-13 panel |
| OK | `/system/roll-archive` | Sistem › Top Arşivi | var | SYSTEM_ROLL_ARCHIVE_ACCESS | — | 08-05 rolls |
| OK | `/system/server-status` | Sistem › Sunucu Durumu | var | SYSTEM_SERVER_STATUS_ACCESS | — | 06-10  |
| OK | `/system/support` | Sistem › Destek | var | support:create | — | 09-29 panel |
| OK | `/system/updates` | Sistem › Güncellemeler | var | — | — | 10-12 guncellemeler |
| OK | `/system/work-sessions` | Sistem › Çalışma Oturumları | var | SYSTEM_WORK_SESSIONS_ACCESS | — | 07-02 Faz 4 |
| OK | `/system/workstation` | Sistem › Bu Bilgisayar | var | SETTINGS_WORKSTATION_ACCESS | — | 09-24 yetki |
