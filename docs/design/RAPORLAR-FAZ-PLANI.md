# Raporlar fazı — plan ve dilimler (2026-09-15)

> **Durum: PLAN — sözleşme.** Kullanıcı isteği (2026-09-14): *"basit ve gelişmiş raporlar; hangilerinin fabrikaya açık olacağını süperadmin belirlesin (dokuma/devere modüllerinde olduğu gibi); ekranlar kolay anlaşılır; Excel + PDF; tarih ve çeşitli filtreler."* Ölçüm zemini: `RAPORLAR-ENVANTER.md` (29 uç · 29 yaprak · çıktısız 4 · rapor başına anahtar YOK · tarih dört adla · fabrika kullanımı tekli haneler). Plan ve dağıtım yönetici oturumda (1e); dilimler oturumlara bu belgeden verilir. Kullanıcı ayrıldı; varsayımlar §4'te beyanlı, dönünce onaylanır.

## 0 · Tasarım kararları (hükümler)

| # | Karar | Gerekçe |
|---|---|---|
| K1 | **Rapor kimliği tek kaynak:** `src/constants/report-catalog.ts` `REPORT_CATALOG` — her rapor bir satır: `key` (`"<kategori>/<rapor>"`, adres kalıbıyla aynı) · `baslik` · `soru` (tek cümle: "bu rapor neyi cevaplar") · `sinif: "basit" \| "gelismis"` · `izin` · `modul` (`ModulKey \| cekirdek:* \| planlanan:*`, SCREEN_CATALOG söz dağarcığı) · `tarih: "aralik-iso" \| "aralik-gun" \| "tek-gun" \| "kesit" \| "yok"` · `panelYolu`. Electron aynası `lib/report-catalog.ts` metin-birebir (module-flags aynası kalıbı), bekçi ölçer. | Bugün "rapor" kümesinin sınırı yüzeyde çizili, adreste değil (envanter §0). Anahtar, kapı, karo, route ve sürüm notu aynı kimliğe bağlanır. |
| K2 | **Görünürlük = tek liste, modül anahtarı DEĞİL:** `SystemSetting` `reports.closedKeys` (JSON `string[]`, katalog anahtarları). Satır yok ⇒ boş liste ⇒ **hepsi açık = bugünkü davranış** (ölçüldü: rapor başına kapı yok). Yeni doğan rapor açık doğar; kapatma süperadmin kararıdır. | 29 yeni modül anahtarı `MODULE_FLAG_KEYS`/profil/grandfathering makinesini şişirir; liste tek satır, tek yazma kapısı. "Varsayılan = bugünkü davranış" çekirdek kuralı (kapalı doğsaydı yükseltmede 29 rapor kaybolurdu). |
| K3 | **Yazma kapısı süperadmin:** `PATCH /api/feature-flags` `updateSchema`e `reportsClosedKeys: string[]`; `flagWriteGuard` ① dalının kümesi `MODULE_FLAG_KEYS` → `SUPERADMIN_ONLY_FLAG_KEYS = MODULE_FLAG_KEYS ∪ {reportsClosedKeys}` (supap dalı aynen). Tanınmayan anahtar → 400 `REPORT_KEY_UNKNOWN` (fail-closed). Ham `PUT /admin/settings/reports.closedKeys` → 400 `MODULE_KEY_RESERVED` (K7 kalıbı). Okuma `getFeatureFlags` → `reportsClosedKeys` (30 sn önbellek, mevcut). | Modül anahtarlarının tek yazma evi ve sırası (`verifyToken → flagWriteGuard → requireSettingsPassword`) korunur; ikinci yazma yüzeyi açılmaz. |
| K4 | **Backend kapısı adlı ve parametrik:** `requireReportOpen(key: ReportKey)` (`ReportKey` katalogdan türetilmiş union — derleyici bilinmeyen anahtarı reddeder), `verifyToken`dan SONRA ve izin guard'ından ÖNCE, 403 `details.code:"REPORT_DISABLED", rapor:key`. Modül kapısı (`requireDokumaEnabled` vb.) kalır ve önce koşar. Jenerik `requireModule("x")` yasağı bu kapıya uygulanmaz: anahtar tipli, bekçi her `router.get`'i katalogla iki yönlü ölçer. | Envanter: backend 8 / panel 16 kapı kümesi AYRIŞIK; rapor anahtarı iki uçta aynı olduğunda ayrışma kapanır. |
| K5 | **Panel kapısı üç yolda birden** (modül kalıbı): karo (`reportTiles`/alt karolar `key`den süzer) · route (`ProtectedRoute` izin kapısından SONRA `isReportOpen(key)`; kapalı → `/forbidden`) · komut paleti. Karar tek yerde: `useOperationsVisibilityContext`e `reportsClosedKeys` + `isReportOpen(key)` (bilinmeyen anahtar → kapalı). | `ROUTE_MODULE` deseninin rapor taneciği. |
| K6 | **Süperadmin yüzeyi:** `ModuleProfilePage`e "Raporlar" bölümü — kategori başlıkları altında 29 satır (`baslik` + `soru` + sınıf rozeti), `FlagToggle` kalıbı; modülü kapalı raporun satırı kilit bandı ("modül kapalı") ve yazılamaz; `canWrite = isSuperadminGateOpen(...)`. Fabrika yöneticisinin Özellik Anahtarları'nda görünmez (modül kalıbı: satış sınırı). | "dokuma-devere modüllerinde olduğu gibi" — aynı sayfa, aynı kapı yüklemi. |
| K7 | **Tarih sözleşmesi ADLA değil KATALOGLA birleşir:** backend parametre adları DEĞİŞMEZ (`dateFrom/dateTo` ISO · `from/to` gün · `factoryDay` · `asOf`) — takvim günü ↔ mutlak pencere ayrımı semantik, ad birleştirmek onu siler. Panel tek bileşen `ReportDateFilter` katalogdaki `tarih` sözleşmesinden çizer (aralık / tek gün / kesit / yok) ve doğru parametre adını üretir; URL durumu `useReportDateRange` kalıbı. | Sözleşme kırılmaz ⇒ "eski istemci ne yapar" sorusu doğmaz. |
| K8 | **Çıktı kuralı:** `Reports/` altındaki her yaprak sayfa `ReportExportBar` çizer (tek spec → üç çıktı); Electron vitest taraması (tile-config yaprakları → dosya → `<ReportExportBar`). Backend'de Excel/PDF üretimi AÇILMAZ (bağımlılık yok, ihtiyaç yok). Web yüzeyi gelirse PDF'in `window.api.pdf`e bağlı olduğu beyanlı kör nokta. | Envanter §0: 25/29'da var, 4 dokuma yaprağında yok; kural bekçisiz kalırsa beşinci yaprak da çıktısız doğar. |
| K9 | **"Kolay anlaşılır" ölçülebilir üç kalem:** ① hub'da BASİT / GELİŞMİŞ iki bölüm (katalog `sinif`) · ② her yaprak başlığında `soru` cümlesi · ③ özet şeridi (MetricCard) tablodan ÖNCE — hangi yaprakta yoksa ölçülür, eklenir. Yeniden tasarım YOK. | Fabrika iş raporlarını neredeyse hiç açmıyor (57 günde tekli haneler); sebep çıktı değil bulunabilirlik/anlaşılırlık — ölçülmedi, kullanıcıya sorulur (envanter §6.6). |
| K10 | **"Çeşitli filtreler" = rapor başına ikinci eksen, SUNUCUDA:** önce envanter (her rapor: bugünkü eksenler, doğal eksik eksen — makine · vardiya · operatör · müşteri/cari · depo · kalite sınıfı · fasoncu), sonra alan alan uygulama. Envanterdeki "sunucu/kurulum süzgeci" yorumu DÜŞTÜ: tek DB = tek kurulum, `installationId` yetki/süzgeç ekseni değil (ajan ölçümü 2026-09-15). | Kullanıcının sözü "tarih ve çeşitli filtreler"; "sunucu" okuması yanlış çözümlemeydi. |
| K11 | Migration YOK (ayar satırı; satır-yok sigortası). Profil sabitine girmez (profil yalnız modül anahtarı taşır). Sürüm notu: backend + panel 1.3.2 aynı pencerede; tablet dokunuşu yok. | |

## 0b · Ek hükümler (oturum notlarından, 2026-09-15 03:00)

| # | Karar | Kaynak |
|---|---|---|
| K4a | `requireReportOpen(key)` okuyucusu modül kapılarının okuyucu kalıbıdır (tek satır okuyucu; önbellek varsa TTL tazeliktir; DB okuması başarısızsa FAIL-CLOSED 403). Hangi okuyucunun kullanıldığı R1'in kural satırında yazılır. | 6e ① |
| K4b | Katalogdaki her satır `kapiTasiyici: { dosya, yol } \| null` beyanı taşır; bekçi taşıyıcının gerçekten `requireReportOpen("<key>")` çağırdığını ölçer. `null` YALNIZ iki yabancı-uç yaprağı için (`reports/dokuma/karne` → `/api/machine-shift-stats`, `reports/finance/cheque-due` → `/api/finance/cheques/due-summary`: rapor-dışı paylaşılan uçlar, backend rapor kapısı yok, panel karosu R2'de süzer); `null` sayısı bekçide 2'ye sabit. | 6e ① |
| K2a | `reports.closedKeys` içinde katalogda olmayan anahtar: YAZMADA 400 `REPORT_KEY_UNKNOWN`, OKUMADA yok sayılır + boot'ta tek uyarı logu (backend önce yükselir; eski panel eski anahtarla yazmış olabilir). | 6e ② |
| K7a | `tarih` sözleşmesi ALTI değer: `aralik-iso` (18) · `aralik-gun` (3) · `tek-gun` (1) · `kesit` (1) · `ileri-pencere` (1, Çek Vade: bugünden ileri, +7/+30/+90) · `yok` (5); katalog `varsayilanGun: number \| null` taşır (hook + layout çift yazımı kalkar). Tarama kapsamı `pages/Reports/**` bütünü (diyaloglar dahil). | d5 ölçümü |
| K10a | R5a envanteri (`RAPORLAR-ENVANTER.md` §7): dokuma/kalite raporlarında **levent/lot ekseni** yeni doğal eksendir (Faz 4 `CONSUMED.rollId` ile top → levent → lot → tedarikçi defterden türetilir; `warpBeamId`/`lotNo`, sunucuda `readIdCondition`). Eksen eklenen her uç ÖNCE `.strict()`e çekilir (6 uç strict değildi — R5b-öncesi kalem). Tanınmayan süzgeç anahtarı 400. | 6e ③④ · 5e ④ |
| K10b | R5b-a (makine/vardiya seçicileri, dokuma 3 rapor): backend şemada olan ama ekranın göndermediği eksen; seçici raporun KENDİ satırlarından kurulur (makine listesi ucu `station:read` ister, rapor kitlesinde olmayabilir — çıkışsız kapı sınıfı), tek seçim, süzgeç aktifken seçenek listesi daralmaz (pencerenin süzgeçsiz yanıtı hatırlanır), "tümü" = bugünkü davranış. İzin-hafif liste uçları (R5b-c) gerekirse sonra. | 5e ①③ |

## 1 · Dilimler

| Dilim | İçerik | Bekçi / kapı | Bağımlılık | Oturum |
|---|---|---|---|---|
| **R0 Katalog** | `REPORT_CATALOG` (29 satır + Cari Ekstre diyaloğu `finance/statement` "yüzey: diyalog") · Electron aynası · `docs/kurallar/raporlar.md` kural satırı · harita satırı | `test_rapor_katalogu`: katalog ⇄ `routes/reports/**` `router.get` yolları ⇄ Electron `content-routes.tsx` `reports/*` ⇄ karo `to` ⇄ SCREEN_CATALOG kategori `modul` — HER yön; negatif sonda: katalogdan bir satır silince ve route'a sahte uç ekleyince kırmızı | — | **d9** (şimdi) |
| **R1 Backend kapı** | `reports.closedKeys` + `requireReportOpen` 29 uçta + `flagWriteGuard` küme genişlemesi + `updateSchema` + `getFeatureFlags` + K7 rezerv + `REPORT_KEY_UNKNOWN` | `test_rapor_kapisi` (`test_module_flag_off` kalıbı: her uç kapı taşır · kapı `verifyToken` sonrası · 403 kod · yazma süperadmin 4 senaryo · bilinmeyen anahtar 400) + `test_feature_flag_contract` (yeni anahtar A/B/C/D dört küme) + `test_superadmin` genişleme | R0 | **d9** (R0 ardından) |
| **R2 Panel kapı + süperadmin yüzeyi** | K5 üç yol + K6 bölüm + `settings-config`/`flag-modules` hizası + sürüm maddesi | Electron: `ProtectedRoute.report.test.tsx` (kapalı → /forbidden · açık → çizilir · bilinmeyen → kapalı) · hub süzme testi · `ModuleProfilePage.reports.test.tsx` (kilit bandı, canWrite) · `flag-modules.test.ts` tamlık | R0 + R1 | **01** (G1p → G3 sonrası) |
| **R3 Dokuma çıktı** | 4 dokuma yaprağına `ReportExportBar` (ölçülen/elle kolonu çıktıya da girer) + K8 tarama bekçisi + kural satırı + sürüm maddesi | Electron vitest tarama (negatif sonda: bir yapraktan kaldırınca kırmızı) | — | **5e** (başladı 02:38) |
| **R4 Tarih bileşeni** | `ReportDateFilter` (katalog `tarih`den çizer) · 29 yaprak ona geçer · URL durumu korunur · dokuma `useFactoryRange` ile birleşir | Electron: bileşen testi (4 sözleşme × parametre adı) + "hiçbir yaprak elle tarih girdisi çizmez" taraması | R0 (aynadaki `tarih` alanı) | **d5** (R0 inince; öncesinde yaprakların tarih girdisi envanteri) |
| **R5a Filtre envanteri** | 29 rapor × (bugünkü eksenler · eksik doğal eksen · sunucu tarafı var mı) — `RAPORLAR-ENVANTER.md` §7 | belge | — | **5e** (R3 sonrası) |
| **R5b Filtre uygulaması** | R5b-öncesi strict (6e, indi `725d7038`) · R5b-a makine/vardiya seçicileri panel (5e) · R5b-b levent/lot + `shiftDefinitionId` (6e, İNDİ 2026-09-15, `test_rapor_levent_ekseni`) · R5b-b2 `meta.leventler` + R5b-c3 `meta.secenekler` seçici kaynakları + R5b-c satış/müşteri/fason 8 uç (`_filters.ts` tek sözleşme, `test_rapor_satis_ekseni`; 1e H1–H3: karşılanmada müşteri süzgeci ve fason işlem türü kapsam dışı, tanınmayan id boş) (6e) · sonra: finans (d9) — her rapor: Zod + servis where + panel `filters` + çıktı başlığında süzgeç | ilgili rapor bekçileri + sunucu süzmesi kuralı (`filtre-liste.md`) | R5a | 6e / 01 / d9 |
| **R6 Anlaşılırlık** | K9 ①②③ — hub iki bölüm · `soru` başlığı · özet şeridi eksik yapraklara | Electron: hub testi · "her yaprak `soru` basar" taraması | R0, R2 | **01** (R2 sonrası) |
| **R7 Kullanılmayan 7 rapor** | Sipariş ailesi 5 + izleme 2 (57 günde 0 çağrı): kapatma DEĞİL, kullanıcıya SORU listesi (hangi soru cevapsız?) | — | kullanıcı | 1e (dönünce) |

**Kapanış ölçümü:** `RAPORLAR-ENVANTER.md` §9 — §0/§1'deki her sayı aynı komutla "önce → sonra" (dört koşum: `792b364b` → `3bba3840` → `69ae8b88` → `465d89b3`, 6e); "kodda değil" satırı BOŞ — §9 fazın kapanış kaydıdır.

**Sıra:** R0 → R1 → R2 → R6 ana hat; R3 ve R5a bağımsız (şimdi); R4 R0'ın hemen ardından; R5b R5a'dan sonra alan alan. Şema migration'ı YOK; migration penceresi kullanılmaz.

## 2 · Dilim tanımı disiplini

Her dilim tek sha (kod + bekçi + belge + sürüm maddesi), taban 1e'nin bildirdiği origin/main; sha gönderildikten sonra rebase yok. Yeni dosya → o dizini tarayan BÜTÜN tarayıcılar koşturulur (screen_catalog · feature_flag_contract · route_auth_coverage · swagger · kimlik_sizintisi · tanımlayıcı dili). Cırcır sabitlerine oturum dokunmaz. Commit mesajı ve belge: sayı serbest, kimlik yok.

## 3 · Ölçülmeyecek / kapsam dışı (beyanlı)

- Rapor İÇERİK doğruluğu (envanter §5) — bu faz yüzey, kapı, süzgeç ve çıktı.
- Tablet rapor yüzeyi — masaüstü fazı.
- Backend'de Excel/PDF üretimi — açılmaz (K8).
- Web paneli PDF — beyanlı kör nokta, iş yok.
- **KAPANDI 2026-09-17 (kullanıcı bulgusu: Mal Kabul / Alış Siparişleri yenilemede "Erişim engellendi"):** `ProtectedRoute` artık bayrak sorgusu sonuçlanana dek bekler (`flagsReady`), hata verirse yönlendirmez (`flagsFailed` — gerçek kapı backend 403); bekçi `ProtectedRoute.module.test.tsx` bayrak-bekleme kolları. Eski not: `ProtectedRoute` bayrak sorgusu bitmeden karar veriyor — modül ve rapor kapısı yüklenmemiş bayrağı KAPALI okur ve `/forbidden`a yönlendirir (bugünkü modül kapısı kabulü; soğuk açılışta derin bağlantı zıplayabilir). İyileştirme: sorgu `pending`ken yönlendirmek yerine beklemek (`null` çizmek) — modül kapısıyla BİRLİKTE, tek kalem; rapor kapısına özel çözüm yazılmaz.

## 4 · Kullanıcı dönünce onaylanacak varsayımlar

1. **Raporlar AÇIK doğar, süperadmin kapatır** (K2) — "modüller gibi" sözünün "kapalı doğar" okuması bilerek seçilmedi (yükseltmede 29 rapor kaybolurdu).
2. Görünürlük TEK liste (`reports.closedKeys`), rapor başına modül anahtarı değil (K2/K3).
3. Tarih parametre adları değişmedi; birleşme panel bileşeninde (K7).
4. "Çeşitli filtreler" = rapor başına ikinci eksen; "sunucu süzgeci" yorumu düştü (K10).
5. Kullanılmayan 7 rapor kapatılmadı; soru listesi bekliyor (R7).

## 5 · Kullanıcıya soru listesi — 57 günde hiç açılmayan yedi rapor (R7)

> **Neden soruyoruz:** telemetri (envanter §6.5) bu yedi raporun 57 günlük pencerede **hiç
> açılmadığını** söylüyor. Bu tek başına "gereksiz" demek DEĞİLDİR — düşük kullanım ile
> "ayda bir ama kritik" aynı görünür ve eksik bir süzgeç de kullanımı düşürür. Kapatma ya da
> iyileştirme kararı ölçümle değil **sizin cevabınızla** alınır. Her rapor için üç soru var;
> "bilmiyorum" da geçerli bir cevaptır ve o raporu bekleme listesine alır.

| # | Rapor | Bu rapor şu soruyu cevaplar | Size sorular |
|---|---|---|---|
| 1 | **Sipariş İptal Karnesi** | Hangi siparişler, ne zaman ve hangi sebeple iptal edildi? | ① Bu soru sizde kimde doğuyor (satış · üretim planlama · patron)? ② Bugün nereden bakıyorsunuz? ③ Sebep kırılımı mı yoksa müşteri kırılımı mı lazım? |
| 2 | **Sipariş → Teslim Süresi** | Sipariş girişinden sevke kaç gün geçiyor? | ① Müşteriye söz verilen süre nerede tutuluyor? ② Gecikmeyi bugün kim fark ediyor? ③ Ölçü "ilk sevk"e mi "tam kapanış"a mı göre olmalı? |
| 3 | **Talep Analizi** | Hangi ürün/renk ne kadar isteniyor (dönem karşılaştırmalı)? | ① Bu bilgiyi üretim planı için mi satın alma için mi kullanırsınız? ② Bugün yerine ne bakıyorsunuz? ③ Ürün mü renk mi yoksa müşteri mi ana eksen olmalı? |
| 4 | **Sipariş Karnesi** | Bu dönemde ne kadar sipariş girdi, önceki döneme göre nasıl? | ① Aylık bir toplantıda mı bakılır, günlük mü? ② Adet mi metraj mı tutar mı? ③ Hangi dönem kıyası anlamlı (geçen ay · geçen yıl aynı ay)? |
| 5 | **Açık Sipariş Karşılanma** | Açık siparişlerin ne kadarı bugünkü stok ve üretimle karşılanıyor? | ① "Karşılanma" sizce neyi sayar (depodaki top · üretimdeki iş emri · ikisi)? ② Bu soruyu sevkiyattan önce kim soruyor? ③ Eksik kalan için uyarı mı liste mi istersiniz? |
| 6 | **Parti İzleme (detay)** | Bu parti nereden geldi, hangi adımlardan geçti, nereye gitti? | ① Arama yapılmış ama detaya girilmemiş — aradığınız şey listede zaten görünüyor mu? ② Parti numarasıyla mı barkotla mı arıyorsunuz? ③ Müşteri şikâyetinde hangi bilgi ilk lazım? |
| 7 | **Top İzleme** | Bu top hangi istasyonlardan, hangi sırayla geçti? | ① Bu soru şikâyet anında mı doğuyor, kalite incelemesinde mi? ② Bugün refakat kartından mı bakıyorsunuz? ③ Topun geçmişini kim görmeli (operatör · amir · yönetim)? |

**Cevaplar üç KUTUYA ayrılır** (kutu, öneri değil: her cevap bir kutuya düşer ve kutunun sahibi bellidir):

| Kutu | Cevap şu anlama gelirse | Ne olur | Kararın sahibi |
|---|---|---|---|
| **(a)** | Soru gerçek, rapor doğru yerde | Süzgeç / erişim iyileştirmesi (faz kalemi) | Geliştirme |
| **(b)** | Soru gerçek ama rapor yanlış yerde ya da yanlış eksende | Yeniden tasarım (yeni kalem) | Geliştirme |
| **(c)** | Bu soru bu fabrikada doğmuyor | Rapor görünürlük anahtarının arkasına alınır — **kapatma değil gizleme**, kayıt ve uç yerinde kalır | **Süperadmin (siz)** — biz kapatma listesi ÜRETMEYİZ |

⚠️ (c) kutusunun kararı bize ait değildir: bir raporu "gereksiz" ilan etmek fabrikanın işidir, ölçümün değil. Telemetri sıralar, kutuyu siz seçersiniz.
