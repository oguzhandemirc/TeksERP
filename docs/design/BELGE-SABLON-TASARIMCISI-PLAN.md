# Belge şablon tasarımcısı (GrapesJS + LiquidJS): dilimli plan

**Durum: TAMAMLANDI 2026-10-26** (iniş sha'sı = TZ PR squash'ı; dal sha'ları squash'ta ölür) (inen PR: #114 #120 #135 #146 #156 #141 #161 #170 #174 #184 #181 #202 #208 #195 #201 #213 #217 + TZ kapanışı; e2e güzergâh BZ1–BZ9 yeşil; açık kalanlar arşiv 2026-10.md "Belge şablon tasarımcısı kapanışı" § Açık; §3.6 "profil config uygulanmaz" cümlesi GEÇERSİZ → R4) · ilk taslak 2026-10-24 · patron oturumu · Yazan: plan yazarı ajanı · Girdiler: `scratchpad/belge/{KARARLAR,D-R1-mevcut,D-R2-kutuphane,DEVIR-PLAN}.md` · Ana dal `main` @ `2bd3d7b08` (araştırma `8bd9fa6b8` üstünde yapıldı) · Backend 2.15.12, panel 1.6.6.

> Kod YAZILMADI. Bu belge dilimlerin sözleşmesidir. Her dilimin ajan istemi `scratchpad/belge/istemler/<KOD>.md` dosyasındadır ve buradaki sözleşmenin kopyasıdır. İkisi çelişirse BU BELGE geçerlidir. Bu belge `KARARLAR.md` ile çelişirse KARAR geçerlidir.

## 0 · Amaç, istek, kapsam

**İstek (kullanıcı):** Bugünkü belge sistemi aç/kapa düğmeleriyle küçük değişikliklere izin veriyor. Kullanıcı bunun yerine belgeyi sürükle-bırak ile tasarlayabilmek, HTML/CSS/şablon kodunu elle yazabilmek, her belge türüne birden çok şablon tanımlayıp müşteriye atayabilmek, sürüm geçmişini görüp geri alabilmek istiyor. Kütüphane araştırılacak, sıfırdan yazılmayacak. Bugünkü tasarım editörde "varsayılan" olarak gelmeli. PDF ile Excel aynı içeriği vermeli.

**Amaç:** Tanımlar → Çıktılar altına "Belge Tasarımcısı" eklemek. Sayfa GrapesJS kanvasından, CodeMirror 6 kod sekmelerinden, sandbox'lı canlı önizlemeden ve Electron `printToPDF` önizlemesinden oluşur. Arka planda **veri sözleşmesi** (tipli, yalnız büyüyen, iç alanları opt-in) + **LiquidJS katı görünüm** + **değişmez sürüm** + **donma** kurulur. Bugünkü TS renderer'lar "Sistem" şablonu olarak DEĞİŞMEDEN kalır. Her belge türüne elle port edilmiş bir Liquid eşleniği yazılır ve eşdeğerlik bekçisiyle kilitlenir.

**Kapsam:** Donmuş resmî belgelerin 14 türü (`PrintedDocType`; `TRAVELER_CARD` kendi yolundan gider), refakat kartı, serbest belge ve fason çeki taslağı. Panel (Electron + web) editörü. Tablette yalnız basım uyumu.

**Kapsam dışı (bilerek):** Etiket Stüdyosu ve termal etiket (ZPL/PPLA/PPLB) · e-posta · sunucu PDF'i (Puppeteer/Chromium sunucuya girmez) · panel-içi çıktılar (raporlar, çeki listesi kâğıdı, döküm, ekstre) · EN dil eşleniği (Sistem EN'yi taşımaya devam eder) · sayfa başı nakli yekûn · iş emri Manifest'i · eşdeğerliği kanıtlanan Sistem kod yolunun emekliye ayrılması (sonraki sürüm kararı) · kopyalanmış şablonun sonradan genel ayar değişikliklerini takip etmesi (Karar P-d bunu bilerek DONDURUR).

## 1 · Teşhis ve zorunlu korumalar

**Teşhis (D-R1 §8.1):**
1. Yerleşim kodda: 13 belgenin her biri 200–970 satırlık template literal. Yerleşim değişikliği sürüm ve dağıtım istiyor.
2. Ayar yüzeyi kapalı bir katalog (`sections/columns/fields`). Yeni alan eklemek dört kapıyı birden değiştirmeyi gerektiriyor (backend sanitize, renderer, panel tipi, panel UI).
3. Her belge türünün tek varsayılanı var. Çoklu şablon yalnız profil override'ı olarak mevcut. "Şablon seç → bas" akışı yok.
4. Ham HTML yalnız refakat kartında var ve düz textarea'da yazılıyor. CSS düzenleme yok.
5. Sürüm/geçmiş yok. "Bu baskı hangi tasarımla yapıldı" sorusunun cevabı yok.
6. Veri tipleri dağınık ve kısmen export edilmemiş. Alan paleti otomatik üretilemiyor.
7. `DOC_DEFS` panelde elle aynalanıyor ve bekçiyle tutuluyor.

**Zorunlu korumalar (D-R1 §8.2; her dilim bunlara karşı sınanır):**
- **Z1 Bayt uyumu.** Eski donmuş belgenin yeniden baskısı bayt bayt aynı kalır. Altın bekçiler kırmızıya düşmez: `test_sevk_belge_altin`, `test_cek_bordro_altin`, `dumpHtml.altin.test.ts`, `test_traveler_card_a5_batches`, `test_label_canvas_*`. Yeni motor opt-in doğar.
- **Z2 Numara ve zincir.** Numara kaynağın kolonundan gelir; şablon numarayı yalnız gösterir. `docType+sourceId+version` tekil kalır. VOIDED/SUPERSEDED filigranı, `reissueReason` ve `reconstructed` dipnotu şablonun ÜSTÜNE eklenir; şablon bunları kaldıramaz.
- **Z3 Brüt ve ad rejimi.** Şablon hesap yapmaz. Toplamlar sözleşmede backend'de hesaplanır. Sevk rakamı brüttür.
- **Z4 İç alan opt-in, tek kapı.** Müşteri belgesinde iç alanın varsayılanı YOK. Sistem şablonunda kapı `columns.shown`, tasarımcı şablonunda kapı `internalFields`. İki şablon türünün her birinde tek kapı vardır.
- **Z5 PDF = Excel.** Excel sözleşmeden üretilir (`DocColSpec`/`excelValue` hane kuralı).
- **Z6 Güvenlik.** Kayıt, render ve doldurma sonrası izin listesi temizleyicisi; `sandbox=""` önizleme; JS'i kapalı PDF penceresi. Liquid katı çalışır ve JS yürütmez.
- **Z7 Tek kaynak.** Tarih/saat fabrika diliminden (`constants/time.ts`, `fmt-date.ts`); büyük harf `upperTr/lowerTr`; sayılar `docNum/cssFixed`.
- **Z8 Yetki.** `document-template:read/write` ayrımı ve salt-okunur yüzey korunur; `DOCUMENT_DESIGN_FLAG_KEYS` dar kalır.
- **Z9 Sayfa.** `@page` adlandırılmış sayfa (toplu baskı, `print-merge.ts`), `preferCSSPageSize`, `table-header-group`.

## 2 · Kararlar

| # | Karar (kısa; tam metin `KARARLAR.md`) |
|---|---|
| D1 | Yığın: GrapesJS 0.23.x (BSD-3, TAM SABİT, gömülü, CDN yok, `tr` locale) · LiquidJS ≥10.30 katı · CodeMirror 6 (`@uiw/react-codemirror` + `@codemirror/lang-liquid/html/css`) · PDF Electron `printToPDF` (bugünkü yol) · Excel `exceljs` ile sözleşmeden. Elenenler: Handlebars/Nunjucks/Eta/EJS, Puck/Craft, Studio SDK/Unlayer, Monaco, Paged.js, SheetJS. `traveler-card-raw.ts` başlığındaki "handlebars olmasın / şablonda mantık olmasın" kararı GENİŞLETİLİR (karar notu + kural satırı; eski satır "GEÇERSİZ → 2026-10-24"). |
| D2 | Sistem şablonu = bugünkü TS renderer, değişmeden. "Kopyala ve düzenle" Liquid eşleniğini kopyalar; eşlenik normalize HTML eşitliği bekçisiyle kilitlenir. Belge türü × N şablon; her kayıt yeni değişmez sürüm; taslak/yayın ayrımı; varsayılan + müşteri/fasoncu ezmesi (`DocumentProfile` hizası). Basılan belge şablon + sürümü dondurur. Sürüm silinmez. Değişmezler şablondan delinemez. |
| D3 | Editör: solda bloklar · ortada A4/A5/Letter kanvası, cm cetveli, kenar boşlukları · sağda stil, özellikler, veri ağacı, katmanlar · üstte örnek veri, önizleme, PDF, kod, sürümler, taslak/yayın. Döngü/koşul `data-each`/`data-if` ile yazılır. Ham Liquid yazılırsa şablon CODE kipine geçer. Debounce'lu canlı önizleme, satır/sütunlu Türkçe hata. Ayrı tasarım ve yayın izni, SoD seçeneği. |
| D4 | Liquid katı ayarlı + render sonrası izin listesi temizleyicisi + sandbox iframe + CSP. Script, olay özniteliği, `javascript:`, dış http(s) görsel ve yazı tipi YASAK; yalnız gömülü varlık. Süre ve boyut sınırı aşılırsa Türkçe hata. |
| D5 | Worktree + PR + CI; Opus high (mekanik iş Sonnet); Fable yok; force-push yasak → merge; literal `unlink`; sembolik bağ merge'den önce kaldırılır; bildirim işiyle bölge-yerel ekleme; veto listesi. |

**Patron kararları (2026-10-24; bağlayıcı):**

- **P-a İzin ailesi.** Yeni `documents:*` ailesi AÇILMAZ. Mevcut `document-template:*` ailesi genişletilir: **`document-template:design`** (şablon oluştur, düzenle, sürüm kaydet, arşivle, ata) ve **`document-template:publish`** (sürüm yayınla). Katalogda yalnız `:read` ve `:write` var, çakışma yok. Satır `module: "ADMIN", category: "web"` olur; migration yazılmaz. `D3`'teki `documents:design/publish` adları bu kararla değişti.
- **P-b SoD.** "Tasarlayan ≠ yayınlayan" bir SİSTEM AYARIDIR: davranış bayrağı `documents.publishSodEnabled`, varsayılanı `false` (bugünkü davranış). Bayrak profile konmaz. Açıkken sürümün `createdById`'si ile yayınlayan aynı kişiyse yanıt 403 `PUBLISH_SOD` olur.
- **P-c Tasarımcı kapısı.** Kapı modül değil, davranış bayrağıdır: `documents.designerEnabled`, varsayılanı **KAPALI**. Menü karosu HER ZAMAN görünür (`visibleWhen` yok). Bayrak kapalıyken sayfa "Belge tasarımcısı kapalı — Genel Ayarlar'dan açılır" der ve Genel Ayarlar'a bağlantı verir (çıkışlı kapı). Kapalıyken tasarım uçları 403 `DOCUMENT_DESIGNER_DISABLED` döner; `GET /contracts` hariç. Bu bayrak `DOCUMENT_DESIGN_FLAG_KEYS`'e eklenmez.
- **P-d Kopyada ayar dondurma.** "Kopyala ve düzenle" kopyalama anındaki ETKİN belge ayarını yeni şablonun ilk sürümüne DONDURUR. Etkin ayar = `documentsConfig[belgeKey]` genel ayarı, varsayılanlarla tamamlanmış hali; müşteri profili override'ı HARİÇ. Ayar sürümün `settings` kolonunda saklanır. Liquid eşleniği bu nesneyi `ayar` adıyla okur. Kullanıcı bugün gördüğü tasarımla başlar; sonraki genel aç/kapa değişiklikleri kopyayı sessizce değiştirmez. Tasarımcıdaki "Belge ayarları" paneli bu dondurulmuş `ayar`ı düzenler ve her kayıt yeni sürüm üretir. Eşlenik eşitlik bekçisi varsayılan ayar ve en az 2 ayar varyantıyla koşar. Dondurma sırasında iki dönüşüm yapılır: `columns.*.shown` iç kolonları `internalFields`'e taşınır (tek kapı) ve `language: en|auto` değeri `tr` olur (EN eşleniği kapsam dışı; editörde uyarı gösterilir).
- **P-e Refakat kartı.** Kartın "sunum canlı" kuralı KORUNUR. Tasarımcı şablonu karta donmaz; her baskıda kartın varsayılanı canlı çözülür ve print-event'e yalnız iz (`templateVersionId`) düşer. Donma yalnız resmî/donmuş belgeler için geçerlidir. Serbest belge de donmaz (türün varsayılanı canlı çözülür).
- **P-ek Sıkı temizleyici kipi.** Bugünkü temizleyici dış http(s) `img/a` kaynağına bilerek izin veriyor. Tasarımcı şablonları bu yüzden `sanitizeUserHtml(html, { strict: true })` ile temizlenir: dış http(s) `img/src`, `a/href`, CSS `url()` ve `@font-face` yasaktır; yalnız `data:` görsel (SAFE_DATA_IMAGE) kabul edilir. Varsayılan kip BAYT BAYT aynı kalır; refakat kartı ve etiket yolları değişmez (`test_belge_sablon_temizleyici`, `test_traveler_template` yeşil kalır).

## 3 · Mimari

### 3.1 Sözleşme katmanı (`Teks-Erp/src/services/document-template/sozlesme/`)
- Dosyalar `tipler.ts`, `index.ts` (kayıt; alfabetik, her docType için tek satır), `kayit.ts`, `senaryolar.ts` ve docType başına bir dosya (`shipment-dispatch.ts`, …).
- Her belge türü şunları beyan eder: `hedef: musteri|ic`, `kokler` (alan ağacı), `tablolar` (anahtar → kolon listesi; `DocColSpec` eşi), `ayar` şeması + `ayarNormalize(raw)` (renderer'ın resolve yardımcılarını SALT-OKUR kullanır: `resolveDocStyle`, `resolveDocTable`), `insa(snapshot, ayar, internalFields) → baglam` ve `senaryolar` (`sample-data.ts` DEĞİŞMEZ; senaryolar onun üstüne kurulur).
- Alan tanımı `{yol, etiket, tur: metin|sayi|tarih|tarih_saat|takvim|para|gorsel|mantiksal, ondalik?, birim?, sinif: musteri|ic, ornek}` biçimindedir.
- Bağlam kökleri: `belge` (no, tür, tarih, sürüm, durum), `firma` (ad, antet, logo data URI; snapshot'tan), `karsi_taraf`, `tablolar.<anahtar>` (satır dizisi), `toplamlar` (backend hesaplar), `ayar` (dondurulmuş), `ic_acik.<kod>` (her iç alan için daima mantıksal değer), `baski` (basım anı, basan, nüsha; render anında).
- İç alanın yolu yalnız `internalFields`'te opt-in ise bağlamda VARDIR. Opt-in değilken şablon o yola atıf yaparsa `strictVariables` render'ı düşürür ve yayın 400 döner. Eşlenik iç kolonu `{% if ic_acik.x %}` ile sarar.
- **Yalnız büyür.** Alan silinmez ve yeniden adlandırılmaz. Özet `scripts/lib/belge-sozlesme-ozeti.json` dosyasındadır. Bekçi şunlarda kırmızı verir: alan çıkarılması, tür değişikliği, `sinif: ic→musteri` değişikliği. Eski snapshot'ta eksik veri `null` olur; `strictVariables` yalnız yazım hatasını yakalar. Bu, ileride eklenecek yeni belge türlerinin (teklif, muayene raporu) **genişleme noktasıdır**: yeni tür eklemek = sözleşme dosyası + Sistem eşleniği + iki kayıt satırı (TZ reçetesi).

### 3.2 Görünüm
Bir şablon sürümü şu alanlardan oluşur: `sourceHtml` (data-* yönergeli kaynak) + `css` + `projectData` (GrapesJS proje JSON'u, görsel kipte) + `compiledLiquid` (derleyici çıktısı) + `pageSettings` + `tableBindings` + `settings` (`ayar`) + `internalFields`. CODE kipte `sourceHtml` ham Liquid'dir, `projectData` boştur.

### 3.3 Render hattı (`document-template/motor/`)
```
snapshot ──▶ sozlesme.insa(snapshot, surum.settings, surum.internalFields) ──▶ bağlam (düz JSON)
surum.compiledLiquid ─(LRU 50, anahtar versionId)─▶ parse
renderUserTemplate(strict) içinde: Liquid fill (katı) → çıktı ≤4 MB
  → sanitizeUserHtml({strict:true}) → sanitizeCss (şablon CSS + derlenmiş @page)
  → barkod/QR SVG yerleştirme (işaretle, temizlik SONRASI)
  → üst katman: filigran (TASLAK/İPTAL/ESKİ KOPYA; position:fixed; #tekserp-f#tekserp-f#tekserp-f + !important)
              + künye @page{@bottom-left{belge no · vN · durum · revize gerekçesi · reconstructed dipnotu}}
  → <html lang="tr"> (CSS text-transform Türkçe)
```
- Şablon CSS'inde şunlar YASAKTIR ve yayında 400 döner: `tekserp-` ad öneki, `@bottom-left`, `#` içeren `:not/:is/:where/:has`.
- Render süresi 2000 ms'yi, bellek 32 MB'ı aşarsa 422 `TEMPLATE_RENDER_FAILED` döner (Türkçe mesaj).

### 3.4 Sistem şablonu ↔ Liquid eşleniği + eşitlik bekçisi
- Sistem şablonları DB'de YOKTUR. Kodda sanaldır (`system:<docType>`) ve salt-okunurdur. Snapshot'ta `template` yoksa belge Sistem şablonuyla basılmıştır.
- Eşlenik TS modülüdür: `document-template/sistem/<doc>.ts` (`String.raw`; `{html, css, pageSettings, tableBindings}`), kayıt `sistem/index.ts`. TS modülü olduğu için asset paketleme riski yoktur. Eşlenik GÖRSEL kipte (data-*) yazılır ki kopya editörde düzenlenebilsin. Görsel kip mümkün olmazsa CODE kipte yazılır ve dosya başında gerekçe verilir.
- **Bekçi `scripts/test_belge_sistem_esdegeri.ts`** (T6 kurar; her port dilimi kendi docType'ını ekler) her docType × senaryo × {varsayılan ayar, varyant-1, varyant-2} için ACTIVE ve overlay'siz koşar. Bir tarafta Sistem `renderHtml(snapshot, config)`, diğer tarafta Liquid render (`ayar = ayarNormalize(config)`, `internalFields` = config'in `shown` iç kolonları) üretilir. İkisi şu kanonik biçime indirilip karşılaştırılır: tokenizer ile belirteçlere ayrılır, öznitelikler sıralanır, boşluklar sıkıştırılır, CSS boşlukları normalize edilir, `@page` blokları yapısal karşılaştırılır. Varyantlar en az şunları kapsar: kolon gizle + sıra değiştir; bölüm kapat + imza etiketi; stil A5/fontScale/tableStyle. Her port kendi varyant listesini tanımlar. EN dil kapsam dışıdır.
- Negatif sonda: eşlenikte bir sınıf adı değiştirilir → bekçi kırmızı; varyantta bir bölüm kapatılır ama eşlenik `ayar`ı okumazsa → bekçi kırmızı.

### 3.5 Şablon, sürüm ve yayın modeli (migration `20261025120000_document_templates`)
- `DocumentTemplate`: id, `docType VarChar(40)` (PrintedDocType adı veya `FREE_DOCUMENT`/`TRAVELER_CARD`/`FASON_CEKI_DRAFT`), `name VarChar(80)`, description?, `status ACTIVE|ARCHIVED` (CHECK), `editMode VISUAL|CODE` (CHECK), `copiedFrom VarChar(80)?`, `publishedVersionId uuid? @unique` (FK), `latestVersionNo Int @default(0)` (atomik artış), archivedAt?, `clientToken @unique`, künye. İndeksler `@@unique([docType,name])`, `@@index([docType,status])`.
- `DocumentTemplateVersion` (DEĞİŞMEZ): templateId (FK Restrict), versionNo, sourceHtml, css, compiledLiquid (Text), projectData Json?, pageSettings Json, tableBindings Json, **settings Json** (P-d), internalFields Json, contractVersion Int, engineVersion VarChar(40), contentHash VarChar(64), note VarChar(300)?, removedOnSave Json, `clientToken @unique`, createdById, createdAt, publishedAt?, publishedById?. İndeks `@@unique([templateId,versionNo])`. İçerik kolonlarına UPDATE'i reddeden TRIGGER kurulur; tek istisna `publishedAt/publishedById` için NULL→değer geçişine bir kez izin vermesidir. Trigger `test_db_invariants` TRIGGERS listesine eklenir.
- `DocumentTemplateDefault`: id, `docType @unique`, templateId (FK).
- `DocumentProfileTemplate`: `@@id([profileId, docType])`, templateId (FK), `@@index([templateId])`. Müşteri/fasoncu ataması PROFİL ÜZERİNDEN yapılır; XOR'lu çift bağ yasağı korunur.
- Yayın: `updateMany WHERE {id, publishedVersionId: expected}` + `count===0 → 409`. Yayından önce tüm senaryolar strict render + temizleyici kesinti ölçümünden geçer. Kesinti varsa 400 `TEMPLATE_UNSAFE_CONTENT`, render düşerse 400 `TEMPLATE_RENDER_FAILED`.
- Sürüm kaydı: `baseVersionId` bayatsa 409 döner; `contentHash` aynıysa yeni sürüm açılmaz. Sürüm no `latestVersionNo` üzerinde atomik artışla verilir.
- Silme: yalnız hiç yayınlanmamış şablon hard delete edilebilir (taslak sınıfı); `delete-preview` önce çağrılır. Diğer durumlarda arşivlenir. Atanmış şablon arşivlenmek istenirse 409 döner ve etkilenen atamaların listesi gelir.
- Not: `DocumentTemplateVersion.editMode` eklendi (patron onayı 2026-10-24; sürüm kendi kipini taşır).

### 3.6 Donma ve çözüm sırası
- Freeze anında ve yalnız `designerEnabled` açıkken çözüm şu sırayla yapılır: kaynağın profili (`resolveProfileId`) → `DocumentProfileTemplate[profil, docType]` → `DocumentTemplateDefault[docType]` → Sistem. Atanan şablon ACTIVE ve yayında olmalıdır; değilse bir sonraki basamağa geçilir ve `warnings`'e not düşülür.
- `PrintedDocSnapshot.template?: {templateId, versionId, versionNo, name}` ADDITIVE eklenir; `schemaVersion` 1 kalır. Şablonlu belgenin `ayar`ı sürümden gelir. Genel `documentsConfig` ve profil `config` override'ı şablonlu basımda UYGULANMAZ; müşteriye özel tasarım şablon atamasıyla verilir. Atama ekranı, config override'ı olan profile şablon atarken uyarır.
- Yeniden baskı donmuş sürümle yapılır. Reissue (v+1) yeniden çözer. "Güncel şablonla bas" (`useCurrentConfig`) şablonu da canlı çözer. Tek seferlik parametreler (`?pageSize`, `?sections`, `printNote` …) `ayar` kopyasına uygulanır ve hiçbir yere yazılmaz.
- Bayrak kapalıyken yeni freeze Sistem'e düşer. Donmuş şablonlu belge yine şablonla basılır (veri erişimi hep açıktır).
- Render hatası FAIL-CLOSED'dır: 422 `TEMPLATE_RENDER_FAILED` + tek seferlik `?sistemSablonu=1` çıkışı (Sistem ile basar, audit iz bırakır). Sessiz sapma yoktur.

### 3.7 Müşteri ataması
- `PUT /defaults/:docType` ve `PUT /profiles/:profileId/:docType` uçları vardır. Atama ekranı etkilenen müşteri/fasoncu listesini gösterir (yıkıcı işlemde etkilenen her kayıt listelenir kuralı).
- Refakat kartında kendi zinciri işler (P-e): açık seçim > tasarımcı varsayılanı > bugünkü kart şablonu/ayarı. Hepsi canlıdır.
- Fason çeki taslağı = `SUBCONTRACTOR_DISPATCH` şablonu + TASLAK overlay.

### 3.8 Excel (TX)
- Şablonlu belgede `/tables` dalı sözleşme tablolarını ve `tableBindings`'i (kalem tablosu kolon anahtarı, başlık, sıra) kullanarak mevcut `DocTablesPayload`'ı üretir. Panelde `doc-tables-export.ts` değişmez; `excelValue` hane kuralı geçerlidir.
- CODE kipte bağ yoksa sözleşmenin varsayılan kolonları kullanılır ve editörde uyarı çıkar.
- `/html` yanıtına additive `template{name,versionNo}` ve `tablesAvailable` eklenir.
- Bekçi `test_belge_sablon_excel_esit.ts`: HTML'deki `data-tablo/data-kolon` hücreleri `/tables` çıktısıyla karşılaştırılır.

### 3.9 Güvenlik
- Sunucuda LiquidJS katı ayar (§5) + düz JSON bağlam (prototip yok, `ownPropertyOnly`) + süre, bellek ve çıktı sınırı.
- Panelde GrapesJS gömülü çalışır (CDN yok); ayarlar `cssIcons:''`, parser `allowScripts/allowUnsafeAttr:false`. Kanvas iframe'ine `sandbox="allow-same-origin"` uygulanabilirliği ÖLÇÜLÜR. Uygulanamıyorsa ajan DURUR ve rapor verir (kural: "HER iframe sandbox").
- Önizleme `sandbox=""` iframe'de, PDF JS'i kapalı pencerede üretilir. CSP değişmez (`script-src 'self' 'wasm-unsafe-eval'; frame-src 'self' blob:`).
- Görsel ≤300 KB `data:` URI olarak saklanır; dış kaynak yoktur. Yazı tipleri yalnız yerel/genel ailelerden seçilir.

### 3.10 Uçlar, izin, bayrak
- `/api/document-templates` uçları:
  - `GET /contracts` ve `GET /contracts/:docType`
  - `GET /?docType=`, `POST /` (`copyFrom: {kind:system}|{kind:template,id}`, `clientToken`)
  - `GET/PATCH /:id`, `GET /:id/versions`, `GET /:id/versions/:vid`, `POST /:id/versions`, `POST /:id/publish`
  - `POST /:id/archive|unarchive`, `GET /:id/delete-preview`, `DELETE /:id`
  - `GET /system/:docType`
  - `POST /preview` (`{docType, source, sample:{kind:senaryo,key}|{kind:kayit,sourceId}}` → `{html, hatalar[{satir,sutun,mesaj}], uyarilar, kesilenler, olcum{ms,bayt}}`; gerçek kayıt seçilirse ek olarak `DOC_PERMISSIONS[docType].read` aranır)
  - `GET /sample-sources/:docType?q=`, `GET /assignments`, `PUT /defaults/:docType`, `PUT /profiles/:profileId/:docType`
- Her CUD `AuditService.log` ile yazılır (tx dışında). Kayıt yaratan uçlar `token-replay.helper.ts` kullanır.
- `constants/document-design.ts` şöyle güncellenir: `DOCUMENT_TEMPLATE_DESIGN = ["admin:settings","document-template:design"]`, `DOCUMENT_TEMPLATE_PUBLISH = ["admin:settings","document-template:publish"]`; READ kümesine iki yeni kod eklenir (yazabilen okuyabilir). `admin:settings` emniyet supabı olarak kalır. Electron `permissions.ts` aynısını aynalar.
- Rol şablonu: "Belge & Etiket Tasarımı" rolüne `:design` + `:publish` eklenir.
- Ekran gelene dek iki kod `SCREENLESS_PERMISSIONS` muafiyetindedir; muafiyet T5'te düşer.
- Bayraklar (reçete §63, 19 adım): `documents.designerEnabled` (API `documentDesignerEnabled`), `documents.publishSodEnabled` (API `documentPublishSodEnabled`). İkisinin de varsayılanı `false`; izin `admin:settings`.

### 3.11 Eski istemci
- Eski panel ve tablet backend'in verdiği HTML'i aynen basar; şablon render'ı sunucudadır.
- Eski Belge Şablonları ekranı yalnız Sistem'i etkiler.
- Backend geri alınırsa snapshot'taki `template` alanı yok sayılır ve belge Sistem tasarımıyla basılır (sürüm notunda yazılır).
- `minVersion` gerekmez.

## 4 · Editör UX

```
┌ Belge Tasarımcısı › Sevk İrsaliyesi › "Müşteri A irsaliyesi"  [TASLAK v7 · Yayında v5]  [Görsel|Kod] ───────────┐
│ Örnek veri: [Senaryo: 12 kalem, 2 sayfa ▾] [Gerçek kayıttan…]  ⟳ Önizle  ▣ PDF  ⎘ Sürümler  [Taslağı kaydet] [Yayınla]│
├────────────┬───────────────────────────────────────────────────────────┬──────────────────────────────────────────┤
│ BLOKLAR    │  0cm   2    4    6    8    10   12   14   16   18   20      │ [Stil] [Özellikler] [Veri] [Katmanlar]   │
│ Metin      │ ┌─────────────────────────────────────────────────────┐    │ Seçili: Kalem tablosu                    │
│ Veri alanı │ │ ░ kenar 15mm ░                                       │    │  data-each: satir in tablolar.kalemler   │
│ Kalem tab. │ │  [Logo]          SEVK İRSALİYESİ    No: {{belge.no}} │    │  Kolonlar: ☑ Ürün ☑ Metre ☐ Parti (iç🔒)│
│ Toplam     │ │  Alıcı: {{karsi_taraf.ad}}                           │    │  data-if: satir.metre > 0                │
│ Logo       │ │  ┌────┬──────────┬──────┬──────┐ ← data-each         │    │ Veri ağacı: belge ▸ firma ▸ karsi_taraf  │
│ Barkod  QR │ │  │ #  │ Ürün     │ Metre│ Kg   │                     │    │  ▸ tablolar.kalemler[] ▸ toplamlar ▸ ayar│
│ İmza       │ │  └────┴──────────┴──────┴──────┘                     │    │ Belge ayarları (dondurulmuş `ayar`)      │
│ Üst/Alt b. │ │  Toplam: {{toplamlar.metre | metre}}                 │    │ Sayfa: A4 ▾ Dikey ▾ kenar 15/15/15/15 mm │
│ Sayfa no   │ │ ─ ─ ─ ─ ─ ─ sayfa kesmesi ─ ─ ─ ─ ─ ─               │    │                                          │
│ S. kesmesi │ └─────────────────────────────────────────────────────┘    │                                          │
│ Kutu/çizgi ├───────────────────────────────────────────────────────────┤                                          │
│ Görsel     │ ⚠ Satır 42, sütun 7: "satr" tanımsız alan · 2 uyarı · 38 ms │                                          │
└────────────┴───────────────────────────────────────────────────────────┴──────────────────────────────────────────┘
```

- **Bloklar:** Metin · Veri alanı (`data-alan` + `data-filtre`) · Kalem tablosu (`data-each` + kolon bağları → `tableBindings`) · Toplam kutusu (yalnız `toplamlar.*`) · Logo (`firma.logo`) · Barkod/QR (`barkod`/`qr` filtresi; SVG işaretli) · İmza alanı (`ayar.signatureLabels`) · Üst bilgi/Alt bilgi/Sayfa no (`pageSettings` → `@page` kenar kutuları; `@bottom-left` künyeye ayrılmıştır) · Sayfa kesmesi (`break-after:page`) · Kutu/çizgi · Görsel (≤300 KB, `data:`).
- **Özellik panelleri:** Seçili bileşenin trait'leri: alan seçici (sözleşme ağacından; `sinif: ic` alanlar kilitli görünür, "iç alanı aç" yalnız tasarım izniyle `internalFields`'e ekler), filtre, `data-each` kaynağı, `data-if` kurucusu (yol · op · değer satırları, and/or).
- **Veri bağlama ağacı:** Kaynak `GET /contracts/:docType`. Her düğümde etiket, tür, birim ve örnek değer görünür. Sürükle-bırak Veri alanı bloğu üretir.
- **data-each/data-if derleyicisi** (backend; kayıt ve önizlemede çalışır; §5 sonunda dilbilgisi): hata mesajı "Satır L, sütun C: …" biçimindedir; iç içe derinlik ≤8; `html/body` üzerinde yönerge yasaktır. Ham `{% %}` bulunursa CODE kipine geçilir ve "görsel düzenleme kısıtlı" uyarısı çıkar.
- **Sayfa ayarları:** `kagit A4|A5|LETTER`, `yon dikey|yatay`, `kenar{ust,sag,alt,sol}` 0–50 mm, `ustBilgi{sol,orta,sag}`, `altBilgi{orta,sag}`, `sayfaNo{konum alt-sag|alt-orta|yok, bicim "Sayfa {n} / {N}"}`, `ilkSayfaFarkli`. Derleyici `@page` ve gerekirse `@page :first` üretir. Temel CSS sabittir: `thead{display:table-header-group}`, `tr{break-inside:avoid}`.
- **Stil paneli** (Style Manager TR): sektörler Yerleşim, Tipografi, Kenarlık, Arka plan (yalnız renk ve `data:`), Tablo, Baskı (`break-*`). Birimler mm/pt/px/%. Gizli özellikler: `position: fixed/sticky`, animasyon, `transform`, vh/vw. Renk seçici `react-colorful`; sınıf tabanlı CSS (`avoidInlineStyle`).
- **Belge ayarları paneli:** Dondurulmuş `ayar`ı düzenler. Mevcut `Electron/src/pages/GeneralSettings/{DocumentConfigSection,DocumentStyleControls,DocumentAdvancedControls,DocumentFieldsPanel}.tsx` bileşenleri `value/onChange` ile yeniden kullanılır; kopyası yazılmaz.
- **Kod sekmeleri:** HTML (Liquid gömülü) / CSS / Sayfa JSON. CodeMirror 6 tamamlamayı sözleşmeden (`variables/properties`) ve kayıtlı filtre/etiket listesinden alır. Görsel kipte kod sekmesi okuma + "koda geç" onayı sunar.
- **Canlı önizleme:** 400 ms debounce ile `POST /preview` çağrılır; sonuç `sandbox=""` iframe'de gösterilir. Hata ve uyarı şeridi satır/sütun verir, tıklanınca kodda ilgili satıra gider. Ölçüm (ms, bayt) ve kesilen içerik listesi görünür.
- **PDF önizleme:** IPC `pdf:preview` (aynı sertleştirilmiş pencere, kuyruk ve bayt kapısı) baytları döndürür. Görüntüleme ayrı sertleştirilmiş görüntüleyici penceresinde yapılır (`plugins:true`, preload yok). Bu yol ölçülür; olmazsa sayfa sayısı (pdf-lib) + "PDF Kaydet" yedeği kullanılır. Web'de yazdır penceresi açılır.
- **Örnek veri:** Varsayılan senaryolardır (tek kalem, çok sayfa, boş opsiyonel alanlar, uzun metin, iptal). "Gerçek kayıttan" seçeneği arama ile kaynak seçtirir ve kaynağın okuma iznini ister.
- **Sürümler:** Liste (no, yazan, zaman, not, yayın rozeti) · iki sürümü karşılaştırma (yan yana önizleme + kendi satır diff'imiz, paket yok) · "bu sürümü yeniden yayınla" · "bu sürümden taslak". Geri alma ileri kaydı silmez.
- **Taslak/yayın:** Kaydetmek yeni sürüm açar. Yayınla düğmesi onay penceresinde senaryo render özetini ve atanan profillerde etkilenen müşteri sayısını gösterir. SoD açıksa ve yazar kişinin kendisiyse düğme pasiftir ve gerekçesi yazılır.
- **Şablon listesi ekranı:** Gruplama belge türüne göredir. Her türün ilk satırı "Sistem" (salt-okunur; Önizle · Kopyala ve düzenle). Rozetler: Varsayılan, Yayında vN, Taslak vM, Arşiv, Kod kipi, N profile atalı. Atamalar sekmesi tür varsayılanını ve profil × tür ızgarasını gösterir.
- **Boş/hata durumları:** Bayrak kapalı → "Belge tasarımcısı kapalı — Genel Ayarlar'dan açılır" + bağlantı. Türün eşleniği yok → "Bu belge türü için kopyalanabilir tasarım henüz yok" (Sistem önizlenebilir). İzin yok → salt-okunur yüzey. Render zaman aşımı → Türkçe hata + son başarılı önizleme soluk gösterilir.

## 5 · Liquid filtre/etiket kataloğu

**Motor ayarı:** `strictVariables`, `strictFilters`, `ownPropertyOnly`, `outputEscape = v => escape(stripRawMarkers(v))`, `dynamicPartials:false`, fs yok, `parseLimit 200_000`, `renderLimit 2000` ms, `memoryLimit 32e6`, `jsTruthy:false`; çıktı ≤4 MB. Rejim (docNum) ve fabrika dilimi her render için filtrelere kapatılır (closure); global yoktur.

| Etiket | Durum |
|---|---|
| if/elsif/else/unless/case/when/for/break/continue/cycle/assign/capture/comment/raw/echo/liquid | İZİNLİ |
| include/render/layout/block/tablerow/increment/decrement | RED (parse hatası, Türkçe) |

| Filtre | Anlam / kaynak |
|---|---|
| `tarih`, `tarih_saat`, `takvim`, `saat` | `fmt-date.ts` (fmtDate/fmtDateTime/fmtCalendarDate), fabrika dilimi `constants/time.ts` |
| `sayi: hane` | `docNum` (rejim zarftan), `NUMBER_ROUNDING_HALF_UP` |
| `metre`, `kg`, `adet` | `sayi` + birim; hane alan tanımından |
| `para: "TRY"` | Decimal dize → "1.234,50 TRY"; finans `fmtMoney` ile bayt-eşit |
| `yaziyla: "TRY"` | Türkçe tutar yazıyla (kendimiz; "Yalnız … TL … Kr") |
| `barkod: "code128"`, `qr` | `barcode-svg.helper.ts`; işaretli SVG, temizlik sonrası yerleştirilir |
| `css_metin` | `@page content` dize kaçışı |
| `upcase`/`downcase`/`capitalize` | EZİLİR → `upperTr`/`lowerTr` (`istanbul` → `İSTANBUL`) |
| `default`, `escape`, `strip`, `truncate`, `replace`, `split/join/first/last/size`, `where/map/sort` | İZİNLİ (LiquidJS yerleşik) |
| `newline_to_br` | T1A ölçer; güvensizse `satir_kir` ile değiştirilir |
| `date` | RED → "tarih filtresini kullanın" |
| `plus/minus/times/divided_by/modulo/abs/ceil/floor/round/at_least/at_most/sum` | RED → "toplam sözleşmeden gelir" |
| `raw`, `json` | RED |

`null` değer `""` basar; yedek değer için `default` kullanılır.

**Yönerge dilbilgisi:**
- `data-each="satir in tablolar.kalemler"` → `{% for %}` sarar. Aynı öğede `data-if` varsa öğe başı süzgeç olur.
- `data-if`: `yol (op değer)? ((and|or) yol (op değer)?)*`. op ∈ `== != > < >= <= contains`; değer ∈ `"…"|sayı|true|false|nil|blank`; parantez yoktur.
- `data-if-not` → `unless`.
- `data-alan="yol"` + `data-filtre="tarih"|"sayi:2"` öğenin iç içeriğini `{{ yol | filtre }}` ile değiştirir.
- `data-bag-src` yalnız `img` + `gorsel` alanda kullanılır.

## 6 · Dilimler

Ortak kurallar: Her dilim worktree, `feature/belge-<kod>`, PR, CI TÜM SUCCESS ve squash merge ile ilerler. Yeni bekçi negatif sondalıdır; kural satırı (`belge-etiket.md` § Bekçiler) ve `BEKCI-HARITASI` satırı aynı commit'te eklenir. Port dilimleri `document-render/*` renderer'larını ve altın JSON'ları YALNIZ OKUR. Ekran dilimi güzergâh ekran görüntüsü alır ve Read ile öz-inceleme yapar.

**T0 — Sözleşme çerçevesi + SHIPMENT_DISPATCH pilot sözleşmesi** · Opus · 1,5 g · M · bağımlılık yok · DB'siz
- Hedef: §3.1 tipleri, kayıt, senaryo altyapısı, `ayar` şeması + `ayarNormalize` çerçevesi, `ic_acik`/iç alan opt-in kuralı, pilot sözleşme.
- Yollar: `Teks-Erp/src/services/document-template/sozlesme/{tipler,index,kayit,senaryolar,shipment-dispatch}.ts` · okur: `printed-document.service.ts` (PrintedDocSnapshot :85), `document-render/{shipment-dispatch*,doc-model,doc-style,doc-table,sample-data}.ts`.
- Paket/migration: yok.
- Bekçi: `scripts/test_belge_sozlesme.ts` §1 her senaryoda tüm yollar tanımlı · §2 iç alan opt-in değilse yol yok, `ic_acik` mantıksal · §3 `belge-sozlesme-ozeti.json` yalnız büyür · §4 eski snapshot alanı eksikse null · §5 `ayarNormalize` tam nesne üretir. Negatif sondalar: alan silme kırmızı verir; iç alan sızdırma kırmızı verir.
- Kabul: pilot bağlam sevk altın fikstüründen kurulur; `sample-data.ts` diff'i 0.
- Risk: renderer tiplerinin export edilmemiş olması; çözüm yalnız `export type` eklemektir (davranış diff'i 0).

**T1A — Liquid motoru + filtreler + yönerge derleyicisi + sıkı temizleyici + overlay** · Opus · 2 g · L · bağımlılık yok · DB'siz
- Hedef: §3.3 ve §5. `sanitizeUserHtml(html,{strict:true})` + CSS strict (varsayılan kip bayt-aynı). Karar notu (arşiv 2026-10), `KOD-KURALLARI.md:247` (RAW_HTML "koşul/ifade EKLENMEZ" → tasarımcı istisnası), `genel.md:57` ve `deploy-kurulum.md:105` paket satırı güncellemesi. `traveler-card-raw.ts` başlığına GEÇERSİZ notu (yorum).
- Yollar: `document-template/motor/{liquid,filtreler,yonerge,sayfa,overlay,render}.ts`, `document-render/template-html.{sanitize,css}.ts` (yalnız seçenek ekleme).
- Paket: `liquidjs` ≥10.30 TAM SABİT; CJS `require()` sınavı; `KUTUPHANELER.md` §9 defter satırı (en yeni üstte) + `KUTUPHANELER-TABLO.md` §2.
- Bekçiler: `test_belge_liquid_kati` (yasak etiket/filtre, prototip erişimi, süre/bellek/çıktı sınırı) · `test_belge_liquid_filtre` (TZ=UTC sondasında da fabrika saati, `istanbul`→`İSTANBUL`, `para`↔`fmtMoney`, `yaziyla` tablosu) · `test_belge_yonerge_derleyici` (gidiş-dönüş, satır/sütun hata, derinlik) · `test_belge_sablon_guvenlik` (strict dış URL kesimi, overlay gizleme 5 sonda, `tekserp-` adı). `test_belge_sablon_temizleyici` ve `test_traveler_template` yeşil kalır. Negatif sonda: `date` filtresini açmak kırmızı verir.
- Kabul: `test_dependency_contract` yeşil.
- Risk: LiquidJS `memoryLimit` semantiği sürüme bağlı; sabit sürümde ölçülür.

**T1B — Model + migration + trigger + servis + uçlar + izinler (bayraksız)** · Opus · 2 g · L · ← T0, T1A
- Hedef: §3.5 ve §3.10 (bayrak kapısı hariç). P-d dondurma (`copyFrom:system`: etkin genel ayar → `ayarNormalize` → `settings`; `shown` → `internalFields`; `en` → `tr`). Eşleniği olmayan türde 409 `NO_SYSTEM_EQUIVALENT`.
- Yollar: `prisma/schema.prisma` (dosya SONUNA kendi bölümü), migration `20261025120000_document_templates` (`--create-only`, idempotent, `DropForeignKey` satırları silinir, trigger aynı dosyada), `services/document-template/{template.service,version.service,assignment.service}.ts`, `controllers/document-template.controller.ts`, `routes/document-template.routes.ts`, `app.ts`, `constants/{permission-catalog,role-template-catalog,screen-catalog(SCREENLESS),document-design}.ts`, `Electron/src/lib/permissions.ts`, swagger.
- Bekçiler: `test_belge_sablon_modeli` (DB: değişmezlik trigger'ı, paralel sürüm no, yayın claim 409, arşiv engeli, token replay dört durum, hard delete yalnız yayınsız) · `test_belge_sablon_uclari` (`bekci-http` izin matrisi: read/design/publish/admin:settings) · mevcut `test_permission_catalog`, `test_role_template_catalog`, `test_screen_catalog`, `test_route_auth_coverage`, `test_route_mount_reachability`, `test_swagger_spec`, `test_schema_drift`, `test_db_invariants`, `test_timestamptz_contract`, `test_migration_hygiene`. Negatif sonda: trigger kaldırılınca UPDATE geçer → kırmızı.
- Kabul: tüm bekçiler yeşil; şema provası en eski canlı dump üzerinde temiz.
- Risk: `schema.prisma` ve izin kataloğu bildirim işiyle çakışabilir; bölge-yerel ekleme + `git merge origin/main`.

**T1C — Bayraklar + basım entegrasyonu** · Opus · 1,5 g · M · ← T1B
- Hedef: bayrak reçetesi (19 adım) iki bayrak için; tasarım uçlarında 403 kapısı; §3.6 freeze çözümü; `snapshot.template`; getHtml dalı; `useCurrentConfig`; overlay; `?sistemSablonu=1`; SoD 403; `/html` additive alanları.
- Yollar: `printed-document.service.ts` (buildSnapshotEnvelope :263, DocRenderOpts :406, useCurrentConfig ~:647), `system-setting.service.ts`, `routes/feature-flag.routes.ts`, Electron `settings-config`/`featureFlagService`/`flag-modules`, `scripts/lib/hepsi-acik.ts`, `test_feature_flag_contract` girdileri.
- Bekçi: `test_belge_sablon_basim` §1 bayrak kapalıyken bayt-eşit · §2 profil > varsayılan > Sistem · §3 yayınsız/arşiv atlanır + uyarı · §4 yeniden baskı donmuş sürümle · §5 reissue yeniden çözer · §6 bayrak kapanınca donmuş şablonlu belge yine şablonla basılır · §7 render hatası 422 + `sistemSablonu=1` · §8 VOIDED filigranı şablon CSS'iyle gizlenemez (5 sonda) · §9 profil config'i şablonlu basımda uygulanmaz · §10 SoD. Tüm altın bekçiler yeşil. Negatif sonda: freeze'de template alanını yazmamak §4'ü kırmızı yapar.
- Risk: `printed-document.service.ts` sıcak dosya; TX bu dilimden sonra gelir.

**T2 — Electron editör iskeleti** · Opus · 2 g · L · bağımlılık yok (UI); veri uçları T1B gelene dek sahte istemciyle
- Hedef: `grapesjs` paketi + kayıt; rota `/definitions/document-designer[/:id]`; karo (grup `cikti`, `visibleWhen` yok); sayfa kanvası (A4/A5/Letter + yön + cm cetvel + kenar çizgisi); Style Manager TR sektörleri; Katmanlar; Metin/Kutu/Görsel temel blokları; `tr` locale + `I18n.addMessages`; dinamik import (200 KB kuralı); bayrak kapalı boş durumu (bayrak T1C'den gelene dek okuma güvenli varsayılanla).
- Yollar: `Electron/src/pages/Definitions/DocumentDesigner/*`, `tile-config.ts`, `groups-config.ts`, `src/routes/content-routes.tsx`.
- Paket: `grapesjs` 0.23.x TAM SABİT (`@grapesjs/react` varsayılan KULLANILMAZ, ölçülür); KUTUPHANELER §9 + TABLO §2.
- Testler: vitest (`cssIcons:''`, parser bayrakları, dış URL'li görselin reddi, kanvas iframe sandbox ölçümü → `iframe-sandbox.test.ts` genişlemesi), `pdf-window-hardening` yeşil; güzergâh adımı `e2e/guzergah/adimlar-belge-tasarimci.mjs` (PNG, Read ile inceleme).
- Risk: kanvas iframe'i `allow-same-origin` sandbox'ı ile çalışmazsa DUR + rapor (yerine ne konacağı patron kararı).

**T3 — Özel bileşenler + özellik panelleri + veri ağacı + yönerge trait'leri + sayfa ayarı + Belge ayarları paneli** · Opus · 3 g · XL · ← T2, T1B
- Hedef: §4 blokları (Veri alanı, Kalem tablosu → `tableBindings`, Toplam, Logo, Barkod, QR, İmza, Üst/Alt bilgi, Sayfa no, Sayfa kesmesi, Kutu/çizgi, Görsel ≤300 KB); trait'ler; veri ağacı (`GET /contracts/:docType`); `data-if` kurucusu; sayfa ayarı paneli → `pageSettings`; Belge ayarları paneli (GeneralSettings bileşenlerini yeniden kullanır); iç alan kilidi.
- Testler: gidiş-dönüş (GrapesJS `getHtml` → backend derleyici → aynı yönergeler), trait → öznitelik, iç alan opt-in kilidi; güzergâh PNG'leri.
- Risk: GrapesJS'in tablo normalizasyonu; `data-each`'in `tr` üzerinde korunması ölçülür, gerekirse özel bileşen tipi.

**T4 — Kod sekmeleri + canlı önizleme + örnek veri + PDF önizleme** · Opus · 2,5 g · L · ← T2, T1B
- Hedef: CodeMirror 6 sekmeleri (sözleşme tamamlaması, filtre/etiket listesi), CODE kip geçişi; 400 ms debounce önizleme (`sandbox=""`), hata satır/sütun → imleç; senaryo + gerçek kayıt seçici; IPC `pdf:preview` (`electron/ipc/pdf.ipc.ts`, `preload.ts`, `shared/pdf-limits.ts`) + görüntüleyici penceresi veya yedek.
- Paket: `@uiw/react-codemirror`, `@codemirror/lang-liquid`, `@codemirror/lang-html`, `@codemirror/lang-css` TAM SABİT; KUTUPHANELER kaydı. Electron lock çakışmasında origin/main lock'u alınır + `npm install <paket>@<tam>`.
- Testler: vitest (tamamlama sözleşmeden gelir, önizleme iframe sandbox'ı boş), `pdf-window-hardening` genişlemesi (`pdf:preview` aynı kapılar), güzergâh PNG'leri.

**T5 — Liste, sürümler, karşılaştırma, geri alma, yayın, atamalar** · Opus · 2 g · L · ← T1C, T3, T4
- Hedef: §4 liste ekranı (Sistem satırı, rozetler); sürüm listesi + yan yana karşılaştırma + satır diff; yeniden yayınla / bu sürümden taslak; yayın onayı (etkilenen müşteri listesi); atamalar sekmesi (varsayılan + profil × tür; config override uyarısı); salt-okunur yüzey; `screen-catalog` girdisi (`definitions/document-designer`, `requires` + `capabilities` = design/publish) + `SCREENLESS` düşümü; karo ↔ rota hizası.
- Bekçiler: `test_screen_catalog`, `test_belge_ekran_ayni`; vitest; güzergâh PNG'leri.

**T6 — Sevk irsaliyesi eşleniği (pilot) + eşitlik bekçisi** · Opus · 2 g · L · ← T0, T1A
- Hedef: `document-template/sistem/{index,shipment-dispatch}.ts` (görsel kip, `ayar` okur) + `scripts/test_belge_sistem_esdegeri.ts` (§3.4; varsayılan + ≥2 varyant).
- Kabul: tüm senaryolar × varyantlar eşit; altın bekçiler yeşil. Negatif sonda iki türlüdür (§3.4).
- Risk: Sistem renderer'ında dinamik dal fazlalığı; eşlenik CODE kipe düşerse gerekçe yazılır ve patrona raporlanır.

**T7 — Fason eşlenikleri** · Opus · 2,5 g · L · ← T6
- Kapsam: SUBCONTRACTOR_DISPATCH (grid; `gridGroups/gridRows/blankGrid`), SUBCONTRACTOR_DIRECT_SHIP, SUBCONTRACTOR_RECEIPT, fason çeki taslağı (TASLAK overlay).
- Teslim: sözleşme + sistem dosyaları + iki `index` satırı + bekçi docType girdileri + `test_cek_bordro_altin` yeşil.

**T8 — Depo eşlenikleri** · Opus · 1,5 g · M · ← T6
- Kapsam: TRANSFER_DISPATCH, GOODS_RECEIPT, STOCK_COUNT (`warehouse-doc` ortak gövdesi).

**T9 — Kartela + Kalite sertifikası + İade irsaliyesi** · Opus · 1,5 g · M · ← T6
- Kapsam: KARTELA_DISPATCH, QUALITY_CERTIFICATE, RETURN_DISPATCH (iade ayrı belge; brüt dipnotu korunur).

**T10 — Finans eşlenikleri** · Opus · 2 g · L · ← T6
- Kapsam: INVOICE_INTERNAL, PAYMENT_RECEIPT, RECONCILIATION_LETTER, CHEQUE_DELIVERY_NOTE.
- Ek bekçi: `para` ↔ `fmtMoney` ve `yaziyla` eşitliği belgede; imza kutuları korunur.

**T11 — Refakat kartı + Serbest belge** · Opus · 2 g · L · ← T6, T1C
- Hedef: kart A5 sözleşmesi (48 anahtar `traveler-card-fields.ts` + `TRAVELER_LOOPS` ile hizalı); kendi çözüm zinciri (P-e, canlı); print-event'e `templateVersionId` izi; Serbest belge sözleşmesi + canlı varsayılan çözümü.
- Bekçiler: `test_traveler_card_a5_batches §A/§E`, `test_traveler_template` yeşil; yeni `test_belge_kart_canli` (sürüm değişince sonraki basım yeni tasarımla yapılır, planKey içerik sürümü değişmez).

**TX — Excel hattı** · Opus · 1,5 g · M · ← T1C, T6
- Hedef: §3.8; `/tables` şablon dalı; `tableBindings`; CODE kip varsayılan kolonları; `/html` additive alanları; panel `PrintedDocDialog` "Excel" slotu değişmez.
- Bekçi: `test_belge_sablon_excel_esit` + `test_sevk_belge_excel_esit` yeşil. Negatif sonda: bağda kolon sırası bozulursa kırmızı.

**TY — Tablet ölçümü** · Opus · 0,5 g · S · ← T1C
- Hedef: Android WebView'de `@page` kenar kutuları ve `expo-print` ile şablonlu HTML basımı ölçülür (`mobil/src/services/printHtml.ts`). Kod değişikliği beklenmez. Kenar kutusu desteklenmiyorsa sayfa no'yu gövdeye alan yedek önerisi raporlanır, karar patronundur.

**TZ — Entegrasyon** · Opus (mekanik bölümler Sonnet) · 1 g · M · ← tümü
- Hedef: `belge-etiket.md` kural satırları (emir kipi) · arşiv karar notu (gerekçeler) · RECETELER'e "Belge türüne sözleşme + Sistem eşleniği ekleme" reçetesi (yeni tür: teklif, muayene raporu) · BEKCI-HARITASI toplu kontrol · backend ve panel sürüm notu taslakları · uçtan uca güzergâh (kopyala → düzenle → yayınla → ata → bas → yeniden bas → arşiv engeli) · plan durum satırı.

**Toplam ≈33 ajan-günü** (D-R2 tahmini 45–60 geliştirici-günü ile uyumlu).

**Dalgalar (her dalgada ≤3 paralel):**

| Dalga | Dilimler | Not |
|---|---|---|
| D1 | T0 · T1A · T2 | üçü de bağımsız; T1A backend lock'u, T2 Electron lock'u |
| D2 | T1B · T3 · T6 | T3 veri uçlarını T1B'nin sözleşme tipinden alır; T1B önce iner |
| D3 | T1C · T4 · T7 | |
| D4 | T5 · T8 · T10 | |
| D5 | T9 · T11 · TX | |
| D6 | TY · TZ | |

**Çakışma bölgeleri:**
- `schema.prisma`: yalnız T1B dokunur (dosya sonunda kendi bölümü).
- `permission/role/screen-catalog`: T1B ve T5 dokunur (`document-template:*` satırlarının yanına).
- `document-design.ts` + Electron `permissions.ts`: yalnız T1B.
- `system-setting.service` / `feature-flag.routes` / `settings-config` / `featureFlagService` / `flag-modules` / `hepsi-acik`: yalnız T1C.
- `printed-document.service.ts`: önce T1C, sonra TX.
- `template-html.{sanitize,css}.ts`: yalnız T1A.
- Backend `package.json`/lock: T1A. Electron `package.json`/lock: T2 ve T4 (farklı dalgalarda).
- `KUTUPHANELER §9/TABLO`: T1A, T2, T4 (çakışmada iki satır da korunur).
- `sozlesme/index.ts` + `sistem/index.ts`: port dilimleri (alfabetik kendi satırı; çakışmada iki satır da korunur).
- `belge-etiket.md § Bekçiler` + `BEKCI-HARITASI`: her dilim sona ekler.
- Electron `content-routes` / `tile-config`: T2 ve T5.
- RECETELER: yalnız TZ.
- **Paralel işler:** Bildirim işi izin kataloğuna, Electron ayar sayfalarına, RECETELER'e ve schema'ya dokunur; çakışmada bölge-yerel ekleme + `git merge origin/main`. ERP modülleri ileride yeni belge türleri ekleyecek (teklif, muayene raporu); genişleme noktası T0 sözleşme kaydıdır, reçetesi TZ'de yazılır.

## 7 · Riskler ve geri alma

| # | Risk | Önlem / geri alma |
|---|---|---|
| R1 | GrapesJS kanvas iframe'i sandbox ile çalışmaz | T2 ölçer; olmuyorsa DUR + patron kararı (alternatif: kanvası ayrı sertleştirilmiş BrowserWindow'a almak) |
| R2 | Eşlenik eşitliği bazı belgelerde sağlanamaz | Eşlenik CODE kipte yazılır + gerekçe; o tür "kopyalanamaz" olarak kalır (Sistem çalışmaya devam eder) |
| R3 | Şablon render hatası basımı durdurur | 422 + `?sistemSablonu=1` çıkışı; bayrak kapatılınca yeni freeze Sistem'e döner |
| R4 | ~~Profil config override'ı şablonlu basımda uygulanmaz~~ → **PATRON KARARI (2026-10-24): müşteri/fasoncu profili (`DocumentProfile`) basım anında şablon sürümünün dondurulmuş `ayar`ının ÜSTÜNE uygulanır** (bugünkü sistem davranışıyla aynı katman sırası: şablon ayarı → profil ezmesi); basılan belge sonuçtaki ETKİN ayarı dondurur (bugünkü "donan şey ayar" kuralı). Kullanıcının `ayar`a bakmayan elle tasarlanmış şablonunda profil ezmesinin etkisi olmaz — atama ekranı bunu bilgi notu olarak gösterir | Eşdeğerlik ve basım bekçilerine "profil ezmesi şablonlu basımda da uygulanır" bölümü (T1B/T1C) |
| R5 | Bildirim işiyle katalog çakışması | Bölge-yerel ekleme, merge |
| R6 | Kitaplık kırılması (0.x) | TAM SABİT sürüm; yükseltme ayrı dilim + gidiş-dönüş testleri |
| R7 | Web panelde `@page` kenar kutusu farkı | Chromium varsayımı yazılıdır; TY tablet ölçümü |

**Geri alma:** Backend geri alınırsa `template` alanı yok sayılır ve belge Sistem'le basılır. Yeni tablolar kalır (migration geri alınamaz; boş/atıl kalır). Bayrağı kapatmak yeni freeze'leri anında Sistem'e döndürür.

## 8 · Veto listesi (patron onayına sunulanlar)

1. Paketler (hepsi TAM SABİT): `grapesjs` 0.23.x · `liquidjs` ≥10.30.0 · `@uiw/react-codemirror` · `@codemirror/lang-liquid` · `@codemirror/lang-html` · `@codemirror/lang-css`. `@grapesjs/react` yalnız T2 ölçümü gerekli derse eklenir; varsayılanı KULLANMAMAK.
2. Şablon dili kararı: `traveler-card-raw` kararı genişler; `KOD-KURALLARI.md:247`, `genel.md:57` ve `deploy-kurulum.md:105` güncellenir.
3. Yeni izinler `document-template:design` ve `document-template:publish` (P-a).
4. Yeni davranış bayrakları `documents.designerEnabled` ve `documents.publishSodEnabled` (ikisinin varsayılanı false).
5. Yeni tablolar (4) + değişmezlik trigger'ı; `PrintedDocSnapshot.template` additive alanı.
6. Sıkı temizleyici kipi (varsayılan kip bayt-aynı).


> **Patron kararı (2026-10-24, R4):** Müşteri profili ezmesi şablonlu basımda KAYBOLMAZ; basım anında şablonun dondurulmuş `ayar`ının üstüne uygulanır, belge etkin ayarı dondurur. T1B/T1C/T5 istemleri bu karara göre uygulanır (istem metnindeki aksi ifade geçersiz).
