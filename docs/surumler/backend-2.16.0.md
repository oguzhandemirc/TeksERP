# Backend `2.16.0`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk ve tek hedef `test` grubu (satıcıda ölçüldü 2026-11-13: grubun
tek kurulumu `deneme-bulut`, BARINDIRILAN, Linux, ONAYLI kip; fabrika yok). Öncü/genel gruba çıkış ayrı karar
(terfi etiketi).
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** `test` grubunda yayındaki ve denemede kurulu sürüm 2.15.16 (etiket `backend-v2.15.16` →
`829ebf52d`; satıcı `sonSaglik.surum` 2.15.16, 2026-11-13 17:39Z yoklaması).

Sürüm numarası: KÜÇÜK hane, elle (kullanıcı kararı 2026-11-13: "2.16.0") — 58 göç, hizmet kartı ayrımı, genel fason
dalga 2 ve patron uygulamasının ERP kipi tek sürümde.

## 1. Özet

Patron telefon uygulamasının fabrikaya doğrudan bağlandığı ERP kipi (okuma uçları, rapor dışa aktarma, bildirim
cihaz kaydı, push dürtme), hizmet kartlarının ayrı tabloya taşınması, genel fason dalga 2, gelen belge ve Gülkesim
demosu iyileştirmeleri. 58 göç; dördü mevcut veriyi değiştirir (§4). Yeni bayrakların hepsi kapalı doğar.

## 2. Ne değişti

Ölçüm: `backend-v2.15.16` (`829ebf52d`) → `origin/main` @ `34787a931`, ilk ebeveyn hattında 216 commit (#468–#696).
Alt proje farkı (dosya): `Teks-Erp/src` 889 · `Electron/src` 1746 (web paneli imaja girer) · `mobil/src` 759 (tablet
yayını ayrı, bu turda YOK) · `patron/` 158 (bulut 2026-11-13'te `34787a93130c`e yükseltildi, §13g) · `satici/` 19 ·
`deploy/` 20. Kapsam başlıkları (commit kapsamı sayısı): gelen-belge 37+ · fason 19 · panel 15 · patron/patron-app/
patron-push 21 · gülkesim 8 · iş emri 12 · sipariş 9 · tablet/mobil 15 · sevkiyat 3.

**Patron uygulaması ERP kipi (V1–V5, P1–P4)** — yeni istemci türü `patron` (`client_type_patron` göçü), 30 günlük
oturum, giriş izni `patron-app:login`; okuma uçları `/api/patron/v1/*` (tanımlar, sipariş kalemi), rapor çalıştırma
ve dosya `/api/patron/v1/raporlar` + `/api/patron/v1/raporlar/:id/dosya` (`patron_report_runs`, `exceljs`), sürüm
politikası `GET /api/client-policy/patron` (`minVersion` 0.0.0), cihaz kaydı `/api/bildirim/cihaz`
(`patron_push_tokens`), bildirim doğunca bulut köprüsüne dürt kuyruğu (`patron_push_nudges`; bayrak
`bildirim.patronPushEnabled`, varsayılan KAPALI). `PATRON_API_VERSION` 1.

**Hizmet kartı ayrımı (D0–D3)** — `items`taki SERVICE kalemleri `service_items`a taşındı (aynı UUID ve kod); fatura
satırı `lineType`; bulutta ayrı `hizmet` boyutu. Eski panel uyumluluk yolları korunur (§3).

**Genel fason dalga 2 (F2–F10, P1–P4, T1–T2)** — emanet ekstresi, emanet çıkış belgesi ve iptali, adım hizmeti
(`service_item_processes`), polimorfik hizmet öznesi (levent sarımı, dokuma işi), yeniden işlem sınıfı, termin ve
alış taslağı, Fason Kokpiti; patron bulutunda emanet anlıkları.

**Gelen belge** — müşteri sipariş no, parti/metre, satır bilgi durumu, mükerrer belge no, şablon sürümü ve token'ı,
tarama saklama süresi, tarama kutu çerçevesi, onaylı belge iptali (önizlemeli), iş emri formundan okutma, canlı akış.

**Üretim/etiket** — top aşaması `Roll.stage` (RAW · SEMI_FINISHED · FINISHED) ve rota adımı `outputStage`; etiket
şablon seçenekleri; tambur etiket parti no; istasyon okutma kontrolleri; duruş kapısı ve duruş sebebi istasyon türü
kapsamı; makine planı alanları; çuval yük birimi (BULK/CART); okutmayla rota.

**Sipariş/sevkiyat/cari** — sipariş satırı tolerans yüzdesi, sipariş onay belgesi, sevk teslim yeri ve planlanan
tarih, cari alış tevkifatı, kurşun gram fiyat sürümleri, müşteri etiket alıcısı, müşteri hızlı oluşturma
(`clientToken`), satır işaretleri (`row_marks`).

**Diğer** — giriş Turnstile kapısı (yalnız web çerez girişi, varsayılan KAPALI), menü düzeni, beş büyük servis
dosyasının alan modüllerine bölünmesi (davranış değişikliği yok), CI/bekçi düzeltmeleri.

**Güncelleyici ve hizmet konağı** — `tekserp-guncelleyici` 0.2.9, `tekserp-hizmet` 0.2.1 DEĞİŞMEDİ
(`scripts/test_guncelleyici_surum.mjs` yeşil, taban `backend-v2.15.16`). `deploy/pg` farkı yalnız Windows PG ayar
profilinde (`pg-ayar.ps1`, conf şablonu, `pg-surumu.json` uzantı listesine `pg_stat_statements`) — Linux/OCI
imajını ve göçleri etkilemez (hiçbir göç `pg_stat_statements` istemez). `deploy/kanallar.json`, `deploy/dagitim.json`,
`deploy/node-surumu.json`, `Teks-Erp/native`, `Teks-Erp/docker` değişmedi. Yeni bağımlılık: `exceljs`.

`dist-web` (web paneli) imaja girer ve bu turda büyük ölçüde değişti; masaüstü panel paketi bu turda YOK.

**Sürüm turunda eklenenler (2026-11-13):** `test_backend_surum` elle küçük/büyük haneyi tanır (#698); korumalı imaj
Dockerfile'ı iç içe `node_modules/*/.bin` bağlarını da siler — `exceljs`in getirdiği `exceljs/node_modules/.bin/uuid`
bağı imaj bekçisinde (K9, imzalanamaz bağ) ilk korumalı paket koşusunu durdurmuştu. Arada inen #697 (doküman) ve
#699 (`patron/uygulama`) backend imajına girmez.

Tam döküm: Ek A.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (2026-11-13 taraması, `backend-v2.15.16..34787a931`).
  - Uç kaldırma/yeniden adlandırma YOK: `Teks-Erp/src/routes` altında silinen dosya yok; diff'te kaldırılan 22 route
    satırının hepsi aynı yol ve yöntemle yeniden tanımlı (fark ara katman ya da işleyici gövdesi).
  - Yetki daralması: `POST /api/items` gövdesi `itemType: SERVICE` ise artık `item:write` ister (`mobile:kumas`
    yetmez); tablet SERVICE göndermez (`FORM_ITEM_TYPES`). Genişleyenler: `target-values` ve iş emri düzeltme uçları
    `mobile:is-emri-duzelt`i de kabul eder.
  - Yeni zorunlu gövde alanı yalnız YENİ uçlarda (`clientToken`: müşteri hızlı oluşturma, gelen belge iptali, iş emri
    formu, el terminali sevk, emanet çıkış, hizmet fiyatı, okutmayla rota, patron rapor). Katı şemalardan kaldırılan
    alan yok (kaldırılan her anahtar yeni şemada var; gelen belge şemaları `gelen-belge.schemas.ts`e taşındı).
  - Giriş uçlarına `turnstileLoginGate` eklendi: yalnız `clientType: web` + web panel kipinde ve ayar açıkken çalışır;
    varsayılan kapalı → panel/tablet girişi değişmez.
- **Eski istemci ne yapar:**
  - Masaüstü panel (yayındaki): yeni ekranları görmez. Hizmet kartları için `filter[itemType]=SERVICE` listesi ve
    `POST /api/items {itemType:SERVICE}` uyumluluk yoluyla çalışır, yanıt eski ürün kartı biçiminde
    (`item.service.ts`). `lineType`siz fatura satırı gövdesi `invoice-line-subject.helper` ile çözülür. Rota adımında
    `outputStage` göndermez → sunucu eski değeri korur. Web paneli imajla birlikte güncellenir.
  - Tablet (yayındaki): `kind` gönderen eski tablet akışı bugünkü gibi; yeni uçları çağırmaz.
  - Patron uygulaması (mağazadaki 1.2.0): ERP'ye bağlanmaz (bulutla konuşur), etkilenmez. ERP kipindeki yeni derleme
    yeteneği `/api/auth/me` `patronApiVersion` ile okur; eski backend'de uç yoksa 404 alır.
  - Patron bulutu: `34787a93130c` (yeni hizmet boyutu, push köprüsü) — "bulut önce" sağlandı (§13g).
  - Satıcı: etkilenmez.
- **`minVersion` dokunuldu mu:** hayır — electron/mobil/web farksız; yalnız yeni `patron` politikası eklendi
  (`minVersion` 0.0.0, `currentVersion` 1.2.0).
- **Yeni bayraklar (hepsi kapalı doğar):** `bildirim.patronPushEnabled`, `bildirim.gelenKutusuEnabled`; Turnstile
  ayarı kapalı. Yeni izin: `patron-app:login` (yalnız "Admin (Tam Yetki)" katalogla taşır; dar rollere panelden
  seçili kişiye verilir).

## 4. Migration

- **Var mı:** EVET — 58 adet (`20261102075124_gelen_belge_musteri_siparis_no` … `20261113170000_patron_push_nudges`).
- **Toplam migration:** 517 (2.15.16'da 459). Değiştirilen/silinen eski göç yok.
- **Geri alınabilir mi:** HAYIR (bu depoda migration geri alınamaz; rollback = güncelleme öncesi yedekten restore).
- **Veri değiştiren dört göç (kullanıcı kararı 2026-11-13: deneme kurulumuna KABUL; ayrı döküm provası YOK, deneme
  kurulumu provanın kendisi sayılır — deneme verisi fabrika verisi değil, güncelleyici kurulumdan önce yedek alır ve
  yeni sürüm açılmazsa kendiliğinden döner):**
  - `20261107202906_service_items_split` — SERVICE kalemlerini `service_items`a TAŞIR (aynı UUID), beş tablonun FK
    hedefini değiştirir, `item_prices` UPDATE; hizmet kartına bağlı saf yapılandırma pivotlarını SİLER (izinli
    renk/özellik, müşteri ürün/renk adı). GERİ ALINAMAZ. Başta FAIL-CLOSED kapı: hizmet kalemine stok/üretim bağı,
    tür sınırını geçen birleşme ya da ürün fiyatında kademe varsa göç `RAISE EXCEPTION` ile durur. Deneme ön ölçümü
    (2026-11-13, salt okuma): SERVICE kalemi 0, tür aşan birleşme 0 → kapı ve taşıma boş geçer.
  - `20261110120000_roll_stage` — yeni `stage` kolonu + tohum `UPDATE rolls SET stage='FINISHED' WHERE colorId IS NOT
    NULL` (yalnız kolonu ekleyen koşumda). Deneme: 5 top, renkli 0 → 0 satır güncellenir.
  - `20261102200756_kursun_gram_fiyat_surumleri` — dolu kurşun gram fiyatlarından başlangıç sürümü INSERT. Fiyat
    kolonları bu partide doğduğu için denemede 0 satır.
  - `20261109165544_station_machine_stop_scope` — sistem kataloğundaki 12 dokuma duruş sebebine `WEAVING` kapsamı
    (yalnız `isSystem` ve kapsamı boş satır; fabrikanın kendi satırı ezilmez).
- **Geri doldurma betiği `scripts/backfill_roll_stage.ts`:** ZORUNLU DEĞİL. Göçün tohumu bugünkü "renkli = bitmiş"
  davranışının aynasıdır; betik migration öncesi doğmuş topları statü/giriş/soy bilgisinden inceltir (dry-run
  varsayılan, `--apply --canli-onay`). Gerektiği durum: eski topların etiket türü/aşaması gerçek üretim geçmişine göre
  düzeltilmek istenirse. Denemede 5 renksiz top var; koşmasa da davranış 2.15.16 ile aynı. Kurulum KOŞTURMAZ.
- **Döküm provası:** yapılmadı — kullanıcı kararı yukarıda.

## 5. Kurulum notu

- **Beklenen kesinti:** güncelleyici yedek + 58 göç + yeniden başlatma; deneme ölçeğinde birkaç dakika.
- **Sıra:** backend tek başına güvenli (§3). Patron bulutu zaten yeni sürümde; satıcı güncellemesi gerekmez. Panel ve
  tablet sonra, ayrı turda.
- **Bu sürüme özel (deneme = barındırılan sınıf):**
  - Kurulumdan sonra (kullanıcı kararıyla, web panelinden): Sistem → Şirket & Güvenlik → Bildirimler'de
    `bildirim.gelenKutusuEnabled` ("Yeni bildirim gelen kutusu") ve `bildirim.patronPushEnabled` ("Patron telefonuna
    anlık bildirim") açılır — push ikisi birlikte açıkken çalışır; patron kullanıcısına `patron-app:login` verilir
    (Erişim → Kullanıcılar); telefon bağlantı karekodu Erişim → Patron Telefonu.
  - Okuma (OCR) hizmeti denemede yok; gelen belge okuma akışları "hizmet yok" gösterir.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Davranış geri alma: açılan bayrak panelden KAPATILIR (veri silinmez). Sürüm geri alma: güncelleyiciyle kurulan
sürüm açılmazsa önceki imaja VE güncelleme öncesi yedeğe kendiliğinden dönülür (`GERI_DONDU`). Kurulduktan sonra
dönmek gerekirse: veri değiştiren göçler nedeniyle 2.15.16 imajı yeni şemayla AÇILMAZ → geri alma = güncelleme
öncesi yedekten geri yükleme, ardından önceki sürüm; yalnız kullanıcı onayıyla. Grupta geri inme yok; düzeltme
ileri sürümle. Etiket `backend-v2.16.0` silinmez.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.16.0, sunucu ve veritabanı ayakta; güncelleyici durumu `BASARILI`.
- Veritabanı: 517 migration bitmiş, yarım/geri alınmış 0; `service_items` var.
- `GET /api/client-policy/patron` 200 (`minVersion` 0.0.0).
- Web paneli açılıyor; Güncellemeler sayfası 2.16.0 gösteriyor; ürün kartları ve hizmet kartları listeleniyor.
- Patron bulutu eşitlemesi (`POST /v1/esitle`) kurulumdan sonra 200 sürüyor.
- Konteyner günlüğünde yeni hata yok.

## Ek A — commit dökümü (`backend-v2.16.0` öncesi, eskiden yeniye, 216)

- `7d24ede06` — feat(gelen-belge): customer order number on delivery note header (S2b) (#468)
- `a5743863b` — feat(lisans): kök kuyruğu sadeleştirme — BARINDIRILAN ara kapsamı, kuyruk nedeni, tek komutlu kuyruk imzası (#469)
- `ac09849f4` — feat(gelen-belge): batch no + kursun meters schema and settings (Gülkesim S0) (#470)
- `00dda8a63` — feat(gelen-belge): per-document approval + batch no/kursun meters PATCH + batch key recall (Gülkesim B) (#475)
- `d9a1e2c86` — feat(gelen-belge): batch number from document + patternless auto work order (Gülkesim C) (#474)
- `620d24b5b` — feat(gelen-belge): Gülkesim parti no + kurşun metresi — toplu (A, C, P1, P2, T1) (#479)
- `20490fb03` — feat(gelen-belge): tablette belge okut → onay kartı → iş emri (Gülkesim T2) (#477)
- `455f9b313` — feat(gülkesim): özel iş emirleri + belgeden form doldurma + kurşun istasyonu gramaj/fiyat + plan makinesi (#480)
- `d4e6b5fab` — fix(gülkesim): özel iş emri inceleme ve demo bulguları (#481)
- `0542a8e57` — feat(gülkesim): kurşun gram fiyatı geçmişi — iş tarihindeki fiyat (K14) + fatura tarihi seçeneği (#482)
- `82dc1e214` — fix(gülkesim): istasyon kalıcı silmesi gram fiyatı sürümünü 409 ile engeller (#483)
- `8d0783b43` — feat(gelen-belge): onaylı gelen belge iptali — önizleme + ters kayıt (K15) (#484)
- `6cadf44b4` — feat(gülkesim): detaylı KK istasyonu — kurulum betiği, bekçi, tablet metinleri (S4) (#485)
- `db1b62e70` — feat(is-emri): yeni İE ekranı hizası + geri oku + yeni özel İE kartı + kurşun ayarları kutusu (K20, S8b) (#486)
- `fa48f9272` — feat(ui): başlık altı açıklama satırı ⓘ ipucuna taşındı (K24) (#489)
- `09ba17883` — S9: Kumaş Özellikleri hiyerarşik liste — çeşit ebeveyninin altında (K21) (#490)
- `571398490` — fix(gelen-belge): iptal inceleme bulguları (#491)
- `38c3ae0e5` — S6 — Sevkiyatta teslim yeri (K18) (#487)
- `b4e6ba0b4` — feat(gülkesim): istasyonda belgeden iş emri bulma — Belge okut + fiş/parti no araması (S2, K17) (#488)
- `903ff8b24` — fix(gülkesim): teslim yerli sevkte e-İrsaliye üretimi uyarır (s6 inceleme) (#497)
- `3ef6ebd76` — S3 — atanan kurşun makinesi (K16) + müşteri varsayılan gramajı + K14 düşükler (#494)
- `b94aa1e27` — fix(gelen-belge): istasyon belge okutmada kapanmış iş emri seçilemez (K17 inceleme) (#498)
- `04ebf803c` — Gülkesim S5 — final etiket (tambur): birim sistemi, İE etiket bilgisi, müşteri tambur ayarları, basım zamanı (#493)
- `6482f3d79` — fix(gülkesim): K16 uyarısı kapalı kartın yeniden açma yolunda da sorulur (s3 inceleme) (#499)
- `eb2268939` — S1a: çok partili gelen belge → iş emri (PER_PARTY | SINGLE) + belge tipi tanıtma motoru (sections, DB şablonu) (#496)
- `b8d2ec08d` — feat(menu): S7 — menü düzeni, fason hizmet firması hazır seti (K19) (#495)
- `61a6ce06d` — fix: s5 inceleme bulguları — tartım kapısı 'Bitir' yollarında (#500)
- `980a0f479` — fix(menu): K19 rapor kategorisi gizlenince alt raporlar paletten ve Rapor Merkezi'nden düşer (s7 inceleme) (#501)
- `9d334f0d9` — fix(gelen-belge): OCR "1/2" sayfa damgası uyarıdır, kapı değil (s1a inceleme) (#502)
- `11a90ab62` — feat(terim): S8a — dokuma kapalıysa "İş Emri" (K20 m1) (#492)
- `6bfe5ba43` — Gülkesim S10 — istasyon varsayılanları (K22) (#503)
- `60b08ffc0` — fix(terim): açılış tohumu iş emri adı rejimini yazmadan önce çözer (s8a inceleme) (#504)
- `7bbc2cc23` — S11 — Belge masası kipi (K23 + K26) (#505)
- `4268e41b6` — S1b: belge tipi tanıtma ekranı (panel + tablet) (#506)
- `96ddb2284` — fix: s11 inceleme bulguları (#507)
- `436b31dfa` — fix: s10 inceleme bulguları (#508)
- `574b08411` — fix: s1b inceleme bulguları (#509)
- `daae07cd7` — fix(tablet): Gülkesim QA turu tablet bulguları + S11/S12 lows (#510)
- `57d643e18` — fix(panel,backend): Gülkesim QA 2026-11-03 panel bulguları (#511)
- `2220253e9` — feat(gelen-belge): S13a — aynı gönderen belge no + aynı fotoğraf fabrika ayarı (K27) (#512)
- `095786c1f` — fix: s13a inceleme bulguları (#514)
- `1f295eeac` — S13b belge fotoğrafı saklama (K28) (#513)
- `df8796c2d` — S14 okutmayla (esnek) rota (K29) (#515)
- `7faa2e733` — fix: s13b inceleme bulguları (#516)
- `8cb137ef7` — fix: s14 inceleme bulguları (#517)
- `00ddd6ecc` — S14b rotasız iş emri açılışı (K29 ana senaryo) (#518)
- `ab1ae4b7b` — fix(db): tx içinde çoklu ilişki yüklemesi sıralı — pg eşzamanlı sorgu uyarısı (S15a) (#519)
- `86cde56e0` — feat(is-emri): K29 S15b rotasız Hızlı İE + açık listede rotasız İE + canClose (#520)
- `42065a607` — docs(kurallar): alan kural dosyaları kısaltıldı, tam metin ayrinti/'ye taşındı (#522)
- `ed1d6ab01` — chore: Claude limit verimliliği — oturum kancası tavanı, bekçi haritası bölündü, kurallar boyut cırcırı (#521)
- `0ded23ce7` — fix(mobil): rotasız Hızlı İE'de sipariş rengi "renk veren rota" engeline takılmaz (#523)
- `a4c4fd7b2` — fix(gelen-belge): K28 sevkte silme aday turu takılı belge sayısından bağımsız (S15c-d2) (#524)
- `e5cd6025e` — perf(sevke-hazir): toplam yalnız canlı birimleri sınıflar, belge biriminde JIT kapalı (S15c-d1) (#525)
- `4eedfed32` — S16a K30 belgeden iş emri: tam form alanları + tanıtma hedefleri + iki ayar (#527)
- `edd6d0232` — test(gelen-belge): sorgu bütçesi bekçisi belge süzgecinin uuid[] biçimini ölçer (S15c inceleme) (#528)
- `c4b7aea9b` — feat(gelen-belge): S16c cihazda OCR — ML Kit gömülü metin tanıma + clientOcr (#526)
- `642c531d7` — S16b K30 tablet tek iş emri formu: belge okut → inputlar dolar (#529)
- `cae966a1b` — K30 Gülkesim sabah senaryosu: belge tanıtma + sorusuz doldurma + tablet tam form + istasyonda parti no yedeği (#530)
- `da4d1e0f1` — test(gelen-belge): Gülkesim sabah senaryosu uçtan uca kabul bekçisi (#531)
- `f9bfc7957` — fix(gelen-belge): re-read after teaching replaces untouched OCR lines instead of 409 (#532)
- `0bc4de56c` — fix(gelen-belge): inactive built-in templates no longer classify documents (#533)
- `92c80abeb` — fix(gelen-belge): taught label repeated on page gets a window so the right value is read (#536)
- `ee563d96e` — fix(tanit): pinch-zoom + free pan photo pane, fixed side panel, explain blocked preview (#534)
- `c2abba6af` — fix(gelen-belge): raise teach identifier cap to 30 and show the Zod reason on tablet (#537)
- `50e36df5b` — feat(belge): multi-shot own camera with automatic page enhancement (no review screen) (#535)
- `d1f7378e7` — feat(gelen-belge): "rolls arrived separately" on the work-order form (backend) (#540)
- `98f41a5a8` — feat(mobil): "Toplar ayrı geldi" toggle on document work-order form (#538)
- `d1953a143` — fix(panel-export): cell-only columns export on-screen text + order line-level Excel (#541)
- `497cc3a7b` — feat(gelen-belge): work order target quantity follows incoming meters (#539)
- `ecaff2891` — fix(deploy): normalize uploaded file modes and verify packages externally before manifest (#542)
- `7bec40281` — fix(panel-export): customer dispatch Excel drops internal gross/return notes; document sheets get borders and fit-to-width (#544)
- `3a127b1d0` — feat(workorders): location filter class "at least one roll at subcontractor" (#543)
- `9bb45c444` — feat(panel): Sipariş Bağını Kopar + sipariş listesi Genel durum / Excel (#545)
- `cc89f78e9` — fix(workorder): reject mixed-color/mixed-item order lines on every link path (#546)
- `81646344a` — fix(gelen-belge): limit taught anchor value to the tapped words (#547)
- `9d542ce20` — feat(orders): "Nerede?" — plain-language order location, quick tabs, side panel (#548)
- `5fb1f61fd` — fix+feat(gelen-belge): şablonu güncelle — kayıtlı alanlar görünür, ekran yeniden tasarlandı (#549)
- `04618d678` — feat(gelen-belge): offer name-only customer record for unmatched document owner (#550)
- `39d96a8c0` — feat(gelen-belge): Gülkesim belgeden İE formu UX — müşteri parti no, sarı vurgu, iki sütun, başlıkta Alanlar (#551)
- `14ba2b072` — fix(gelen-belge): show saved fields when updating a template in the panel (#552)
- `8856ca25a` — chore(deploy): build Windows packages only on thinkpad-1 (#553)
- `c05e5dbd6` — fix(orders): plain-language shipping status across panel, tablet and owner app (#554)
- `051bdda33` — feat(workorders): İş emri listesinde "Şu an hangi fasonda" süzgeci (#555)
- `d823e5644` — fix(workorders): faceted fason firma counts + one qty format (#556)
- `f06822136` — fix(gelen-belge): offer quick-create for short owner names read from an introduced template field (#557)
- `90f8cca56` — fix(gelen-belge): position fallback for misread labels + tablet owner modal (#558)
- `d63345cfa` — feat(tablet): canlı okuma L2 — CameraX canlı kamera görünümü + JS sarmalayıcı (#559)
- `3e94eca81` — feat(gelen-belge): canlı kare okuma ucu (L1 sunucu, salt okuma) (#560)
- `178a2d303` — feat(gelen-belge): server completion of empty header fields + batch no differs warning (#562)
- `639c52d66` — feat(gelen-belge): tablet WO create redesign slice 2 — doc column, status language, create bar (#563)
- `a27f18fb8` — feat(tablet): canlı belge okuma ekranı (canlı okuma L3) (#564)
- `c9875048e` — fix(cari): müşteri kumaş adı seçicisi ve ucu hizmet kalemini dışlar (#567)
- `b7770d6f0` — feat(panel): bulk tab close (context menu, close-all button, Ctrl+Shift+W) (#568)
- `a16affb29` — fix(panel): roll and quick-ship fabric pickers list only fabric items (#570)
- `0a9458df4` — feat(is-emri): İE varsayılan stok kartı (boş hedef kumaş) (#566)
- `0244fc3ea` — feat(gelen-belge): same document re-scan opens existing record + tablet gramaj fix (#565)
- `10a5f06cb` — feat(tambur): customer label batch no on tambur labels (Gülkesim) (#571)
- `28d8b7d0d` — feat(gelen-belge+tablet): istasyonda belge okutmada çok İE — burada olan açılır, rotasız İE burada başlatılabilir (#569)
- `1ea5bc641` — test(gelen-belge): make canli-okuma §d trace count deterministic (#573)
- `fada721d2` — feat(mobil): İş Emirleri ekranı — sunucu süzmeli liste, sütun seçimi, okutma önizlemesi (#572)
- `7f30f4f6d` — feat(hizmet-fiyat): service price table — tier axis, single price order, future-dated prices (#575)
- `07d624b15` — feat(sevkiyat): çuvalsız sevk — yük birimi (çuval / araba / dökme) (#574)
- `e327e8a61` — fix(ux): İş Emirleri tablet + sekme toplu kapatma görsel denetimi (#577)
- `bba7a6519` — feat(gelen-belge+tablet): istasyon okutma doğrulama puanı — eşik altı kendiliğinden açılmaz (#576)
- `be03361d9` — feat(gelen-belge): çok blok — tek kağıtta çok parti → parti başına İE (#578)
- `a2842d28f` — test(is-emri): lock "where now" of route-less (scan-routed) work orders through the real flow (#579)
- `6b87a98cb` — fix(ux): gece denetimi — yük birimi farkında sevk kartı, doğrulama rozetleri, çevrimdışı durumlar (#580)
- `fb925fe8a` — chore(lint): lower ESLint warning ceilings to measured counts (#581)
- `7482878aa` — feat(panel): confirm before closing tabs with unsaved changes (#582)
- `2fc6aacc7` — feat(gelen-belge/tablet): per-party gramaj + machine on single WO form; fix flaky mobile tests (#585)
- `70524e92d` — fix(is-emri): show roll owner as customer on order-less work orders (#584)
- `908098b65` — feat(gelen-belge): "Taslağı iptal et" on tablet and panel (#583)
- `faa18b9dd` — feat(sevkiyat): çuvalsız sevk eksikleri — PLANLI sevkiyata yük ekleme, tek top çıkarma, önizleme, hazır sayımı düzeltmesi (#587)
- `1be1f0705` — fix(gelen-belge): ekran denetimi — parti kaydı toplardan ayrı, elle taslak mesajları, tek parti terimi, sekme başlığı (#586)
- `51739da26` — feat(is-emri): Fason (müşteri malı) work order type — backend, panel, tablet (#588)
- `5491ab39f` — feat(tablet/is-emri): Dokuma İş Emirleri list on the İş Emirleri screen (#589)
- `cdc4b7bf6` — fix(orders): "Metre" column shows shipped / requested metres again (#591)
- `4623c5746` — fix(tablet/kursun): move numpad to bottom-right, fall back to system keyboard when host is squashed (#592)
- `c5edec429` — fix(gelen-belge): keep paper batch no and declared party meters on multi-party notes (#593)
- `deab161ac` — fix(tablet/kursun): close step when every roll is done + fason chain guard (#594)
- `bc53dd5cd` — fix(ux): Gülkesim prova düzeltmeleri — madde 7–13 (#595)
- `99829fd85` — fix(gelen-belge): 2. prova — glued totals label, recorded party meters, overdue WO location (#596)
- `54a07cac3` — fix(tablet): Gülkesim 2. prova — İE listesi, seçici taşması, klavye, Kime? varsayılanı (#597)
- `b2e89539a` — feat(rapor): Stok & Ölü Stok "Kalem bazında" sekmesi (ham kumaş · bitmiş kumaş+en+renk+kat) (#598)
- `495428f4a` — ci: pin ci.yml jobs to ubuntu-24.04 (#601)
- `6963cd9ed` — feat(panel/kartela): Yeni Sevk, Bekleyen Kabul ve kabul/sevk iptali — tablet paritesi (#600)
- `e1baed2f9` — feat(mobil): el terminali donanım okuyucu çekirdeği (D1) (#599)
- `42ab29f88` — feat(panel): "Dışa aktar ▾" menüsü + Siparişler "Excel (stok kalemi bazında)…" (#602)
- `e45540d68` — feat(mobil): el terminali D2 — tarayıcı modalı donanım hedefi, Hızlı İE top tablosu, Depo/Kartela doğrudan okuma (#603)
- `056955ed9` — feat(mobil/el-terminali): D2b — tek amaçlı ekranlarda doğrudan tuş dinleme + en üstteki pencere kuralı (#604)
- `0eaa023e8` — feat(mobil/el-terminali): D3 — multi-purpose screens route the trigger by screen state / topmost window (#605)
- `4a76fedd8` — feat(siparis): stok kalemi Excel'ine "Depoda (tümü)" seçilebilir sütunu (#606)
- `e2672ce7b` — feat(panel): every new session starts with a single Anasayfa tab (#607)
- `1060fc28d` — feat(panel): kartelalık stok — grup ayraçlı stok sekmeleri, Kartelalık süzgeci, Kartelalık Stok sekmesi, seçici kapsamı (#608)
- `036f740e0` — fix(mobil): Hızlı İE top adımı — tek hata yüzeyi, doğru ret sebebi, dengeli alt çubuk (#609)
- `ce19d4bf9` — fix(backend): stale Prisma client select error is a server fault, not 400 — pano "Geciken İE" (#610)
- `a0c335c39` — feat(panel): single-row list filter bar — Orders first (#590)
- `2c29f03d6` — feat(panel): tek satır filtre + kayıt — İş Emirleri ve Sevkiyatlar (dalga 1) (#612)
- `5bd89dd8a` — feat(panel): tek satır filtre + sekme başına kayıt — Kumaş Stoğu ve Kartela Takibi (dalga 2) (#613)
- `2efe9895b` — feat(panel): tek satır filtre + kayıt — İadeler, Sevk Edilenler, Cariler, Müşteriler (dalga 3) (#614)
- `575569ea7` — feat(panel): tek satır filtre + kayıt — Leventler, Dokuma İş Emirleri, e-İrsaliye (dalga 4) (#615)
- `f8d3226bb` — feat(panel): tek satır filtre + kayıt — Çuvallar, Top Arşivi (dalga 5) (#616)
- `3f8913af8` — perf(is-emri): resolve produced-output set without full rolls scan (#618)
- `16bb6bd4e` — perf(db): createdAt + tambur indexes, enum comparisons, PG_POOL_MAX (#621)
- `491135737` — perf(log): request id, duration, user and error code in access log and slow ring (#619)
- `595d4b708` — feat(deploy): PostgreSQL ayar profili — sorgu görünürlüğü, SSD, kuru bakım betiği (#620)
- `4e463b46a` — feat(fason): single-source own stock vs consigned split (F1) (#622)
- `417af81d1` — feat(fason): tablet Depo + Hızlı İE emanet görünürlüğü (T3) (#624)
- `e34891307` — refactor(settings): split system-setting.service into domain modules (no behavior change) (#625)
- `40f62b713` — feat(hizmet): service card split at DB level — backend (D0–D1c) (#623)
- `eabcb4a39` — feat(fason): emanet default warehouse setting (F1b) (#626)
- `9be191713` — refactor(fason): split subcontractor.service into domain modules (no behavior change) (#627)
- `957d1f51b` — feat(hizmet-karti): panel + tablet on separate service cards (D2+D4) (#628)
- `f0c57b1a5` — feat(finans): fason F7 — alış faturasında tevkifat ön değeri (#630)
- `aa2507a72` — refactor(is-emri): split workorder.service into domain modules (no behavior change) (#631)
- `439cc9515` — feat(fason): terbiye kabulü emanet deposu boğazına bağlandı (F1b İSTİSNA kaldırıldı) (#629)
- `ea9ded18a` — refactor(sevkiyat): split shipping.service into domain modules (no behavior change) (#633)
- `7b374ccc2` — feat(fason): iş emrinde ana hammaddeyi kim verdi + tevkifat girdisi (F7b) (#632)
- `e8e7a1747` — refactor(siparis): split order.service into domain modules (no behavior change) (#634)
- `6bac5c772` — fix(bekci): regime-gate scan treats split service family as one node (#635)
- `3a31517eb` — refactor(envanter): split inventory.service into domain modules (no behavior change) (#636)
- `9ac44be4d` — refactor(tambur): split tambur.service into domain modules (no behavior change) (#637)
- `9a3a22511` — feat(hizmet-karti): patron bulutunda ayrı hizmet boyutu (D3) (#638)
- `2d2a9e4b9` — test(panel): mock electron-log in license-relay test so CI does not need the Electron binary (#641)
- `16b30581b` — chore(bekci): post-split cleanup — single family source, stale line refs, scanner fixes (#640)
- `fc513464c` — feat(fason): F3 adım hizmeti — service_item_processes (MIGRATION) (#642)
- `b34f5d4ae` — feat(fason): dalga-2 şema + sözleşme (M2–M4) — migration içerir (#643)
- `66bda64d4` — ci(e2e): cache Electron binary and retry its download (#649)
- `c56d5fb9a` — feat(fason): F9 yeniden işlem sınıfı — bizim hatamız faturaya girmez (#646)
- `2e2b51435` — feat(fason): emanet ekstresi backend (genel fason F2) (#639)
- `79cac3072` — feat(fason): panel consigned-goods surfaces (P1) (#644)
- `a20085ab7` — feat(fason): F5 emanet çıkış belgesi — backend (#647)
- `097fada0a` — feat(fason): F4 polimorfik hizmet öznesi — levent sarımı + dokuma işi (#648)
- `fcc652ed8` — feat(fason): emanet çıkış panel ekranı (genel fason P3) (#645)
- `6a6cbd9bd` — feat(fason): F6 termin + alış taslağı · F10 kokpit · T2 tablet termin (#651)
- `43feb2d9c` — feat(fason): panel P2 + P4 — süreç türü eşleme, iş kırılımı, Fason Kokpiti, alış taslağı, beklenen dönüş (#650)
- `69fb0e977` — feat(fason): T1 emanet çıkış aday ucu + panel seçicileri + tablet akışı (#652)
- `d4bf9ceea` — feat(patron): fason · emanet anlıkları — emanet bakiyesi, fasondaki işler, hizmet geliri (PB1) (#654)
- `e0c25ca9c` — fix(fason): emanet çıkış iptal önizlemesi iplik satırını belgeyle aynı adlandırır (#658)
- `19aa48a95` — docs(fason): dalga 2 belge toparlaması (D-son) (#659)
- #661 — feat: single-body main — Gülkesim and Seyitoğlu work (parts 2–3)
- #662 — feat(panel): new design language, dashboard widgets, shared tables, report centre
- #663 — feat(lists): server-side search on list endpoints
- #664 — feat(customers): planned ship date, balances, period summary, documents tab
- #665 — feat(orders): order side panel, record page and restyled form
- #666 — feat(orders): drop deadline badges and overdue counter from the order list
- #667 — feat(shell): smooth theme transition, refresh animation, hover-expand sidebar
- #668 — feat(dashboard): compact KPI cards, density-wide spacing, box sizes and per-box options
- #669 — feat(dashboard): per-box options, KPI strip wrap, consigned kg precision
- #670 — feat(tables): personal row marks and notes
- #671 — feat(patron-cloud): factory-side guard — inbox cap, report gate, kill switch
- #672 — feat(auth): owner app client type, 30-day session and login permission
- #673 — feat(device): auto re-attach approved devices by stable hardware identity
- #674 — feat(patron): ERP read endpoints for the owner app (same wire shape as the cloud)
- #675 — feat(auth): optional two-factor by default and Turnstile on browser logins
- #676 — feat(patron-app): direct ERP connection mode behind a transport layer
- #677 — feat(patron): serve all owner-app read sets from the ERP; fix flaky incoming-doc test
- #678 — feat(orders,customers): optional stale-record guard on updates
- #679 — feat(patron-app): create, edit and cancel customers and orders in ERP mode
- #680 — fix(patron-app): use the shared term for work orders on the cancel screen
- #681 — feat(orders,customers): idempotent customer create and cancel preview token
- #682 — feat(patron-app): clientToken on customer create, preview token on order cancel
- #684 — feat(patron-app): on-demand reports with history in ERP mode
- #683 — feat(patron): on-demand report runs with stored history for the owner app
- #685 — feat(patron): colours, items and prices from the owner app in ERP mode
- #686 — feat(patron): order line editing and in-production cancel from the owner app
- #687 — feat(patron): notifications in the owner app in ERP mode
- #688 — feat(patron): connect the owner phone by scanning a panel QR code
- #689 — feat(patron): share a report as PDF or Excel from the owner app
- #690 — feat(patron): push bridge endpoints on the owner cloud (P1)
- #691 — feat(patron): owner phone push token registration on the factory backend (P2)
- #692 — feat(patron): nudge the owner phone when a notification is born (P3)
- #693 — feat(patron): push registration, tap handling and per-type switch in the owner app (P4)
- #694 — feat(patron-deploy): wire phone push settings and Expo token secret into compose
- #695 — feat(patron-push): decouple push bridge sending from BILDIRIM_KIPI
- #696 — fix(patron-app): keep expo-camera out of the web bundle (cloud CSP)

## Ek B — operatör notu taslağı (`surum-notlari.json` biçimi; terfide onay)

Web paneli sürüm notu penceresini göstermez; kayıt masaüstü panel turunda `surum-notlari.json`a girer. Metin terfide
kullanıcı onayıyla donar.

```json
{
  "id": "2026-11-13a",
  "durum": "TASLAK — terfide kullanıcı onayı",
  "baslik": "Patron telefonu fabrikaya bağlanıyor, hizmet kartları ayrıldı, fason işleri genişledi",
  "maddeler": [
    { "kapsam": "panel", "tip": "yeni", "metin": "Patron telefon uygulaması fabrika sunucusuna bağlanabilir: tanımlar, sipariş kalemleri ve raporlar telefondan görülür, raporlar dosya olarak indirilebilir. Bağlantı karekodu Erişim → Patron Telefonu sayfasındadır; giriş için kişiye \"Patron telefon uygulamasıyla giriş\" yetkisi verilir." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Patron telefonuna anlık bildirim gönderilebilir (Sistem → Şirket & Güvenlik → Bildirimler, varsayılan kapalı)." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Hizmet kartları ürün kartlarından ayrı tutulur; mevcut hizmetler kodu ve fiyatıyla aynen taşınır." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Fason işlerinde emanet ekstresi, emanet çıkış belgesi, süreç türü eşleme, iş kırılımı, Fason Kokpiti, termin ve beklenen dönüş takibi." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Gelen belgede müşteri sipariş no, parti metresi ve mükerrer belge kontrolü; onaylı belge önizlemeyle iptal edilebilir." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Topun aşaması (ham, yarı mamul, bitmiş) kartında görünür; rota adımında çıktı aşaması seçilebilir." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Sevkiyatta planlanan tarih ve teslim yeri; sipariş satırında tolerans yüzdesi ve sipariş onay belgesi." }
  ]
}
```
