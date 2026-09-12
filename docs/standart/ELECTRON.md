# Electron paneli — nasıl yazılır

Yönetim paneli (`Electron/`, React 19 + Vite + Electron 42). Bu dosya **rutin** soruların cevabıdır: sayfa hangi dosyalara bölünür, iskelet nedir, veri nereden gelir, izin kapısı nereye konur, dosya ne kadar uzun olabilir.

Katman-üstü ilkeler [`ILKELER.md`](ILKELER.md)'de ve burada TEKRAR EDİLMEZ — gerekince `[IL-xx]` ile atıf yapılır. Kadans [`TEST-VE-DERLEME.md`](TEST-VE-DERLEME.md)'de. Panel-geneli düzen (IPC dört adımı, sekme/gezinme defteri, otomatik güncelleme, paket listesi) `Electron/CLAUDE.md`'de; olaydan doğan tuzaklar `docs/KOD-KURALLARI.md`'de; alan kararları `docs/kurallar/<alan>.md`'de.

Kural biçimi ve zorlama etiketleri: [`README.md`](README.md). Ölçüm kaynakları: `docs/history/standart-2026-09-05/kesif/electron-panel.json`, `olcum/eslint-electron.json`, `olcum/faz0-acik-olcumler.json`.

---

## 1 · Sayfa kalıbı

Master-data CRUD sayfası altı dosyaya bölünür ve her dosyanın tek işi vardır. Referans: `src/pages/DefectTypes/` (tam set), `src/pages/System/Clients/` (özel uçlu, saf yardımcısı testli).

- **[EL-01]** Yeni master-data sayfasını `pages/<Modul>/` altında altı dosyaya böl: `types.ts` · `service.ts` · `schema.ts` (zod) · `columns.tsx` · `<Modul>FormDialog.tsx` · `<Modul>Page.tsx` · zorlama: insan:dosya kalıbı AST'den ölçülmez — iskeleti `.claude/skills/electron-admin-page` üretir · kanıt: `src/pages/DefectTypes/` (6 dosya); tam sete sahip 14 modül (`kesif/electron-panel.json → 5_dosya_CRUD_uyumu`) · devralınan: yok
- **[EL-02]** Altı-dosya kuralını YALNIZ master-data CRUD sayfasına uygula; rapor · operasyon · hub sayfası kapsam dışıdır ve tek dosya olarak doğabilir · zorlama: insan:sayfa sınıfı ad kalıbından çıkarılamaz · kanıt: 131 `Page.tsx`'in 14'ü tam set, 13'ü `CrudPage` — kalanı rapor/hub (`kesif/electron-panel.json`) · devralınan: yok
- **[EL-03]** Master-data servisini elle yazma; `createCrudService<T>(basePath)` döndür ve yalnız ek uçları elle ekle · zorlama: insan:"bu servis master-data mı" sınıflandırması AST'den çıkmaz · kanıt: `src/services/crudService.ts:24-41` (`createCrudService`, dosya 42 satır); `pages/DefectTypes/service.ts:1-4`; 52 sayfa servisinin 23'ü böyle, elle yazan master-data servisi 0 · devralınan: yok
- **[EL-04]** Sayfaya özel saf yardımcıyı (biçimleme, eşleme, karar tablosu) ayrı dosyaya çıkar ve yanına `.test.ts`'ini koy · zorlama: insan:"saf mı" ölçülemez · kanıt: `pages/System/Clients/clients-utils.ts` + `clients-utils.test.ts` (2026-09-04, en yeni referans sayfa) · devralınan: yok
- **[EL-05]** Basit master-data formunu `EntityFormDialog` sarmalayıcısıyla kur; kendi `useForm`'unu yalnız satır kalemli/karma form için aç · zorlama: insan:form karmaşıklığı ölçülemez · kanıt: 26 FormDialog'un 12'si sarmalayıcı; kendi form'unu kuran 14 dosyanın hepsi ≥118 satır (ortalama ~340) · devralınan: yok

Route kaydı, `screen-catalog.ts` girdisi, hub karosu / komut paleti girişi ve "Sidebar'a satır EKLENMEZ" kuralı `Electron/CLAUDE.md` § Sayfa kalıpları ile `docs/RECETELER.md` § Electron sayfası'ndadır.

## 2 · İskelet

`TabHost` her sayfayı `absolute inset-0` ile sarar. Sayfa kendi yüksekliğini kısıtlamazsa TÜM panel kayar ve alttaki butonlar görünümden çıkar — iskelet bir süs değil, bu arızanın kapısıdır.

- **[EL-06]** Sayfayı `PageShell` + `PageHeader` + `PageBody` ile kur; alternatif yalnız `CrudPage` ya da `ReportPageLayout` sarmalayıcısıdır · zorlama: insan:iskelet seçimi JSX ağacından güvenilir sınıflandırılamaz · kanıt: `src/components/layout/PageShell.tsx:4-22` (banner kalıbı yazıyor); 115/131 `Page.tsx` · devralınan: 16
- **[EL-07]** Kaydırıcıyı TEK yerde bırak — `PageBody` (ya da kendi kaydırıcısını yöneten `DataTable`/`CrudPage`); `PageHeader`, toolbar ve `PageFooter` sabittir · zorlama: insan:overflow sınıfının hangi kapta durduğu AST'den okunmaz · kanıt: `PageShell.tsx:5-9`, `:18-21` · devralınan: yok
- **[EL-08]** Rapor hub'ını da `PageShell`/`PageBody` ile kur; `ReportHubGrid`'in elle yazılmış `flex h-full flex-col` kabını kopyalama · zorlama: insan:hangi kabın 'iskelet' sayıldığı JSX ağacından güvenilir okunmaz · kanıt: `src/pages/Reports/_components/ReportHubGrid.tsx:21-22` — 8 rapor hub'ı bu yüzden iskeletsiz · devralınan: 8 (düzeltilecek borç)
- **[EL-09]** Sonsuz kaydırmayı otomatik bırak (`useInfiniteScroll` + `AutoLoadMore`); "Daha Fazla Yükle" butonu ve sayfa numarası pager'ı yazma · zorlama: insan:buton metni yasağı AST'den ölçülemez · kanıt: `components/data-table/AutoLoadMore.tsx:22`; panelde 0 sapma; kural `docs/KOD-KURALLARI.md` § filtre'de de yaşar · devralınan: yok

## 3 · Veri erişimi

- **[EL-10]** Her HTTP çağrısını `services/apiClient.ts` üzerinden yap; ham `fetch`/`axios` yazma · zorlama: insan:kimliksiz sunucu yoklaması meşru istisnadır ve selector'dan ayrılamaz · kanıt: 235 apiClient çağrısı / 0 ham `fetch(`; tek istisna `ApiEndpointDialog.tsx:124` (`axios.get /health`, aday sunucu yoklaması, gerekçeli) · devralınan: 1 (gerekçeli)
- **[EL-11]** Servis yolunu TAM yaz (`/api/...`); `apiClient.baseURL` öneki İÇERMEZ · zorlama: bekçi:`src/services/api-path-prefix.test.ts` · kanıt: bekçi başlığı :12-16 — öneksiz beş çağrı bir ekranı **on iki gün** kırık bıraktı (`d0575389`); muaf liste yalnız `/health` · devralınan: yok
- **[EL-12]** query-key'in ilk elemanını kebab-case string literal yaz (ya da kebab değerli bir `*_QUERY_KEY` sabiti) · zorlama: insan:sabitten gelen anahtar AST'de literal görünmez · kanıt: 569 anahtarın 532'si doğrudan literal, 37'si kebab değerli sabit; camelCase/PascalCase 0; emsal `pages/Operations/Shipments/ShipmentsPage.tsx:37` · devralınan: yok
- **[EL-13]** Picker/lookup listesini `loadAllForPicker(service)` ile yükle; inline `pageSize: N` yazma (backend `MAX_PAGE_SIZE` değişince 400 gelir) · zorlama: insan:inline `pageSize` ölçüldü (22 kullanım, çoğu sayaç) ve ESLint kuralı bu yüzden REDDEDİLDİ · kanıt: `src/lib/picker-loader.ts:60-84`; ret gerekçesi `olcum/eslint-electron.json` kova 3 · devralınan: yok

## 4 · Süzme sunucuda

BELİRSİZ-01 kapandı: `pages/` altındaki 296 `.filter(` çağrısının **tamamı** sınıflandırıldı, 33 cursor'lu yüzeyin hepsi elle okundu — cursor'lu liste üstünde daraltma yapan tek site yok. Kural bugünkü gerçeği dondurur.

- **[EL-14]** `useDataTable` / `CrudPage` / `useInfiniteQuery` sonucu üstünde `.filter(` ile satır daraltma; süzme SUNUCUDA olur · zorlama: insan:alıcı ifadenin sorgu sonucu olup olmadığı tek AST düğümünden okunmaz (ölçüm çok satırlı geri-yürüyüş istedi) · kanıt: `olcum/faz0-acik-olcumler.json → BELIRSIZ_01` — 296 çağrı sınıflandırıldı, ihlal 0 · devralınan: yok
- **[EL-15]** İstemci süzmesini yalnız tamamı TEK istekte gelen listede kullan — `loadAllForPicker` ya da sayfasız `useQuery` · zorlama: insan:aynı gerekçe (EL-14) · kanıt: 10 meşru site (`AccessUsersPage.tsx:98,104` · `PermissionsCatalogPage.tsx:50,84` · `ProductionStationsPage.tsx:164,195` …); "tamamı elde" garantisi mekaniktir: `picker-loader.ts:74-82` aşımda SESSİZ KESMEZ, hata fırlatır · devralınan: yok
- **[EL-16]** Seçili-satır süzmesini ve filtre-seçeneği süzmesini bu yasağın dışında tut, ama gerekçesini kodda tek satırla yaz · zorlama: insan:süzmenin neyi daralttığı ancak alıcı ifadenin anlamıyla bilinir · kanıt: `Operations/Shipments/ShipmentsPage.tsx:175,232` (toplu işlem hedefi, 5 satır gerekçe yorumu) · `Operations/Rolls/RollsTableBody.tsx:215` (`FilterDef.options`) · `SackStore/SackStorePage.tsx:119` (dedupe — daraltmaz, genişletir) · devralınan: yok

## 5 · Hata ve toast

`apiClient` interceptor'ı 4xx/5xx'i zaten basar (401 token sil + auth kapısı, 403 "yetkin yok", 4xx backend mesajı, 5xx generic). `onError` içinde ikinci bir toast kullanıcıya aynı hatayı iki kez gösterir.

- **[EL-17]** Mutation `onError`'ında ikinci `toast.error` yazma · zorlama: eslint:`yerel/mutation-onerror-toast` (warn + tavan) — YEREL plugin kuralı, `no-restricted-syntax` DEĞİL: o kural adı altında iki severity olamaz ve yuvayı yasaklar tutuyor (`Electron/eslint.config.mjs:132-147` selector, `:284` kayıt, gerekçe `:57-62`); selector `Property[key.name='onError'] CallExpression[callee.object.name='toast'][callee.property.name='error']` · kanıt: `src/services/apiClient.ts:127`; tavan `Electron/lint-baseline.json` `yerel/mutation-onerror-toast: 22`; AST ölçümü 26 ihlal / 19 dosya, en yenisi `SackTagsPage.tsx:73,98,110` (2026-09-04); negatif sonda koşuldu (`olcum/eslint-electron.json`) · devralınan: 22 (`lint-baseline.json` tavanı, ARTMAZ)
- **[EL-18]** Hata toast'ını bastırmanın tek yolu isteğin `suppressErrorToast: true` taşımasıdır; bastırıyorsan `eslint-disable` satırına gerekçeyi yaz · zorlama: eslint:aynı kural — `yerel/mutation-onerror-toast` (satır-içi disable direktifi) · kanıt: `apiClient.ts:127`; bayrağın 6 meşru kullanımı (`useServerClock`, `useDeviceAnnounce`, `scan-resolvers`, `WorkOrders/service.ts:256`, `:543`); 26 ihlalin hiçbiri bayrağı taşımıyor · devralınan: yok
- **[EL-19]** `onError` YAZMAMA kararını tek satır yorumla kaydet — boş bırakılmış bir handler ile bilinçli sessizlik ayırt edilemez · zorlama: insan:yokluk ölçülemez · kanıt: 10 dosyada gerekçeli "onError YOK" yorumu emsali; `pages/Operations/Rolls/RollQtyAdjustDialog.tsx:77` · devralınan: yok

## 6 · İzin

- **[EL-20]** Her içerik route'unu `ProtectedRoute` + `requirePermission` / `requireAnyPermission` ile kapat · zorlama: insan:route ağacının TAMAMINI gezen bir kapı YOK — `tile-route-permission.test.ts` yalnız `systemTiles` karolarının route izniyle eşleştiğini ölçer (72 satır), 106 route bloğunu gezmez · kanıt: 106 route bloğunun 100'ü kapılı; muaflar `settings`, `forbidden`, 3 hub yönlendirmesi ve `*` (gerekçeli); emsal `routes/content-routes.tsx:241-247` · devralınan: 6 (gerekçeli)
- **[EL-21]** Karo (`tile-config.permissionAny`) ile route'un istediği izni BİREBİR aynı tut · zorlama: bekçi:`pages/System/tile-route-permission.test.ts` + `pages/Operations/tile-visibility.test.ts` · kanıt: bekçi başlığı :6-16 — sapmanın görünümü "kartı görür, tıklar, `/forbidden`'a düşer"; palet aynası `components/layout/command-entries.ts:66,102,119` · devralınan: yok
- **[EL-22]** Yazma butonunu `<PermissionGate>` arkasına koy; bir VERİ özelliği (`cap.canApplyProperty` gibi) izin kapısı yerine geçmez · zorlama: insan:"bu buton yazıyor mu" AST'den çıkmaz · kanıt: **GÜVENLİK BORCU** — `pages/StationCapabilities/StationCapabilitiesPage.tsx:286` ("Yetenekleri Düzenle") kapısız, route izni `content-routes.tsx:486` `station:read`, backend `Teks-Erp/src/routes/station-capability.routes.ts:190-193` `station:write` ister; `constants/screen-catalog.ts:195` de `capabilities: []` diyor (kardeşleri `:176-181` `station:write` taşıyor) · devralınan: 1 (İ-14, düzeltilecek)
- **[EL-23]** İzin yüklemini `matchesPermission` ile kur; düz `includes` OR zinciri yazma · zorlama: bekçi:`src/types/auth.test.ts` (yüklem semantiği) · kanıt: helper `src/types/auth.ts:101`; sapma `components/layout/NotificationBell.tsx:28-31` (üç halkalı OR zinciri, İ-25); doğru yazım `useRoleAccess.hasPermission` (`src/hooks/useRoleAccess.ts:18`); kural `docs/KOD-KURALLARI.md` § superadmin'de yaşar · devralınan: 1

## 7 · Şema ↔ Prisma

⚠️ `Electron/CLAUDE.md`'nin "zod, backend'le uyumlu" cümlesi bir ayna vaadi kurar; ölçüm o aynanın backend ucunun BOŞ olduğunu gösterdi. Master-data CRUD'da doğrulamayı yapan tek kapı paneldir.

- **[EL-24]** `schema.ts`'i master-data CRUD'un TEK doğrulama kapısı olarak yaz — `BaseController` gövdeyi Zod'suz doğrudan servise geçirir · zorlama: insan:sözleşme iki repoda yaşar, tek AST'den ölçülemez · kanıt: `Teks-Erp/src/controllers/base.controller.ts:95-102` (`this.service.create(req.body, req.user?.userId)`) · devralınan: yok
- **[EL-25]** zod `max(n)` değerini aynası olan Prisma kolonunun `@db.VarChar(n)` uzunluğuna eşitle · zorlama: insan:alan eşlemesi (panel alanı ↔ Prisma kolonu) mekanik çıkarılamaz · kanıt: 12 modül örnekleminde 21 eşleşen alanın 20'si birebir; sapma `pages/Customers/schema.ts:63` `name.max(200)` ↔ `prisma/schema.prisma:2070` `Customer.name @db.VarChar(100)` → 101-200 karakterlik ad panelden geçer, DB'de P2000 olur · devralınan: 1
- **[EL-26]** Yeni alanı panel şemasına ve backend sözleşmesine BİRLİKTE ekle — [IL-08] · zorlama: insan:[IL-08] gerekçesi · kanıt: `docs/KOD-KURALLARI.md` § yasaklar (istek gövdesini elle kuran istemci katmanı bir allowlist'tir) · devralınan: yok

## 8 · Süreç sınırı

- **[EL-27]** Renderer'da `electron` · `fs` · `path` · `child_process` · `os` import etme · zorlama: eslint:`no-restricted-imports` (`Electron/eslint.config.mjs:267-278`, renderer bloğu) · kanıt: 0 ihlal; kural canlı olduğu `--stdin` negatif sondasıyla doğrulandı (`olcum/eslint-electron.json`) · devralınan: yok
- **[EL-28]** Native yeteneğe yalnız `window.api` üzerinden eriş; yeni kanalı dört adımda aç (shared contract → `electron/ipc/<domain>.ipc.ts` → `preload.ts` köprüsü → renderer çağrısı) · zorlama: insan:kanal bütünlüğü dört dosyaya yayılır, tek AST kuralı ölçemez · kanıt: `Electron/CLAUDE.md` § Mimari ve süreç sınırı; iskelet `.claude/skills/electron-ipc-handler` · devralınan: yok
- **[EL-29]** Token'ı `safeStorage` + `electron-store` üzerinden sakla; `localStorage`/`sessionStorage`'a token/JWT YAZMA · zorlama: eslint:`no-restricted-syntax` dar `setItem` selector'ı (iki biçim: `localStorage.…` ve `window.localStorage.…`) · kanıt: 0 ihlal, negatif sonda koşuldu; kapsamdaki 5 `setItem` çağrısının hiçbiri token yazmıyor, geri kalan `localStorage` kullanımı UI tercihidir; tek belgeli istisna web fallback'i `src/lib/secure-store.ts:22-36` (`secure.` önekli, değişken anahtar) · devralınan: yok

## 9 · Adlandırma ve dosya

Genel isimlendirme [IL-16] · [IL-17] · [IL-18]'de; burada yalnız panele özgü olanlar.

- **[EL-30]** Sayfayı, bileşeni ve servisi **named export** ile aç; `export default` yazma · zorlama: insan:default export tek başına hata değil, kalıp kararıdır · kanıt: 131 `Page.tsx`'in 130'u named (`routes/content-routes.tsx:36` yorumu bunu kayda geçirir); sapma `pages/System/RollArchivePage.tsx:44` · devralınan: 1
- **[EL-31]** `service.ts`'ten React hook EXPORT ETME; hook sayfa dizinindeki ayrı bir dosyaya (`hooks.ts` / `use<Konu>.ts`) gider · zorlama: insan:`use` ile başlayan bir export'un gerçekten hook mu yoksa saf yardımcı mı olduğu addan değil gövdesinden okunur · kanıt: 0 ihlal — `grep -rnE 'export (const|function|async function) use[A-Z]' Electron/src/pages --include='service.ts'` boş döner (ölçüm 2026-09-05; turun kendi içinde düzeltildi) · devralınan: yok
- **[EL-32]** Paylaşılan hook'u `src/hooks/`'a, sayfaya özel hook'u sayfa dizinine koy · zorlama: insan:paylaşım niyeti ölçülemez · kanıt: `src/hooks/useCrudMutations.ts` (ortak CRUD) ↔ `pages/GeneralSettings/useSessionSettingsForm.ts` (sayfa dizini) · devralınan: yok
- **[EL-33]** `any` yazma; kaçınılmaz tip sürtünmesinde `as any`'yi gerekçeli `eslint-disable` ile birlikte kullan · zorlama: eslint:`@typescript-eslint/no-explicit-any` (error — `eslint.config.mjs:264` renderer, `:304` ana süreç/shared) · kanıt: 0 `: any` / 0 `<any>`; 9 `as any`'nin 8'i zodResolver-RHF sürtünmesi ve gerekçeli; gerekçesiz tek nokta `pages/Operations/Orders/OrderFormDialog.tsx:297` · devralınan: 1
- **[EL-34]** Tanımlayıcıya Türkçe karakter koyma ([IL-16]); TR etiketli VERİ anahtarı bu yasağın dışındadır · zorlama: eslint:`@typescript-eslint/naming-convention` `custom` girdisi (ham `Identifier` selector'ı REDDEDİLDİ) · kanıt: ham selector 24 ihlal verdi, 22'si veri anahtarı yanlış pozitifi (`carilerPaging.ts:25`, `reportExport.ts:177` TR harf haritası); dar sürüm 2 gerçek ihlal: `pages/GeneralSettings/settings-groups.ts:206`, `src/test/scrollbar-theme.test.ts:36` · devralınan: 2 (düzeltilerek error)

## 10 · Boyut

Satır = KOD satırı; yorum ve boş satır sayılmaz ([IL-21]). `skipComments` kapalı ölçüm bu repoda standardın kendi kalıbını cezalandırır: 134 ihlalin 60'ı yalnız yorum yüzünden sınırı aşıyordu.

- **[EL-35]** Yeni ve dokunulan dosyada sınır: dosya ≤300 · `*Page.tsx` ≤200 · `*FormDialog.tsx` ≤200 · fonksiyon ≤80 · zorlama: eslint:`max-lines` / `max-lines-per-function` (`skipComments`+`skipBlankLines`, warn) + `scripts/check-lint-baseline.mjs` · kanıt: ölçülen ihlal 74 dosya · 42 Page · 12 FormDialog · 454 fonksiyon (`olcum/eslint-electron.json`); tavan `Electron/lint-baseline.json` — `max-lines: 107` (dosya + Page + FormDialog TEK kural altında sayılır) ve `max-lines-per-function: 454` · devralınan: 107 / 454 (tavan, yalnız düşer)
- **[EL-36]** Muafiyeti ADLI `files` override'ı ile ver, heuristikle değil · zorlama: eslint:`max-lines: "off"` adlı blok · kanıt: dört katalog/registry dosyası — `pages/GeneralSettings/settings-config.ts` (1445, 0 hook) · `pages/Operations/WorkOrders/service.ts` (1266, 0 hook) · `routes/content-routes.tsx` (1218, 365 JSX etiketi) · `services/documentConfig.ts` (1216, 0 hook); heuristik ölçüt (0 hook + yorum >%15) `content-routes.tsx`'i KAÇIRIR (%9.3 yorum) ve içinde iş mantığı olan 10 dosyayı da süpürürdü; override ihlali 74→70 · devralınan: 4 (adlı)
- **[EL-37]** Fonksiyon parametresini 4 ile sınırla; fazlasını `opts` nesnesine al · zorlama: eslint:`max-params` (`["warn", 4]`) + `scripts/check-lint-baseline.mjs` · kanıt: `Electron/eslint.config.mjs:228` (`BOYUT_KURALLARI`), tavan `Electron/lint-baseline.json` `max-params: 10`; keşif dosyasının "0 ihlal" ölçümü ÜRETİM config'iyle yeniden ölçülünce 10 çıktı ve gerekçe config başlığında (`eslint.config.mjs:52-55,211-221`) · devralınan: 10 (tavan, yalnız DÜŞER)
- **[EL-38]** Bölmeyi fırsatçı yap ([IL-22]): gerçek borç katalog dosyası değil, hook-yoğun monolit bileşendir · zorlama: insan:"monolit mi katalog mu" ayrımı hook sayımıyla ölçülür ama karar insanındır · kanıt: >300 satırlık 124 dosyanın ≥10 hook taşıyan 28'i; başı `components/data-table/FilterBar.tsx` (1049 satır / 19 hook) · devralınan: 28 (borç listesi)

## 11 · Test

Kadans ve kapılar [`TEST-VE-DERLEME.md`](TEST-VE-DERLEME.md)'de ([TD-03] panel paketi commit kadansında; [TD-21] tip kontrolü `npm run typecheck` ile, çıplak `npx tsc --noEmit` hiçbir dosyayı derlemez).

- **[EL-39]** Panel testini vitest ile ve kaynağın YANINDA yaz; ortak kurulum `src/test/setup.ts` · zorlama: hook:`.githooks/pre-commit` (Electron `src` değiştiyse `vitest run`) · kanıt: 224 test dosyası / 2385 test (ölçüldü 2026-09-13; süre 23 sn ölçümü 2026-09-05'tendir ve bu turda BOŞ MAKİNEDE yeniden ölçülmedi — yük altındaki 59 sn sayılmaz) · devralınan: yok
- **[EL-40]** jsdom boşluğunu ÜRÜN kodunu eğerek değil, `src/test/setup.ts`'te **koşullu · gerekçeli · davranış değiştirmeyen** bir stub ile kapat · zorlama: insan:"davranışı değiştirmiyor mu" ölçülemez, gerekçe cümlesi insan yazar · kanıt: `src/test/setup.ts:11-60` — `IntersectionObserver` (DataTable sentinel'i), `ResizeObserver` (cmdk), pointer capture + `scrollIntoView` (Radix); her biri `if (!(… in globalThis))` koruması ve 3 satırlık NEDEN yorumu taşır · devralınan: yok
- **[EL-41]** İskelet · izin aynası · yol öneki · sekme geçmişi bekçilerini dokunulan sayfayla aynı commit'te güncelle ([TD-20]) · zorlama: hook · kanıt: `services/api-path-prefix.test.ts` · `pages/System/tile-route-permission.test.ts` · `pages/Operations/tile-visibility.test.ts` · `components/layout/tabs/history-depth.test.ts` · `store/tabs.back.test.ts` · `components/layout/PageHeader.test.tsx` · devralınan: yok

Stryker (`test:mutation`) hiçbir kapıda koşmuyor (son dokunuş 2026-06-14) — komut listesinde durur, kapı değildir.

## 12 · Bilinen borç (bu standardın kapsamı dışında)

Her biri ayrı bir iştir, toplu kampanyayla düzeltilmez:

- 8 rapor hub'ı iskeletsiz (EL-08) · çift hata toast'ı tavanı 22 (EL-17) · 1 kapısız yazma butonu (EL-22, **güvenlik**) · 1 zod↔VarChar sapması (EL-25). (EL-31 hook export borcu 2026-09-05'te kapandı: ölçüm 0.)
- Boyut tavanı (`lint-baseline.json`): `max-lines` 107 · `max-lines-per-function` 454 · `max-params` 10; içinde gerçek borç hook-yoğun 28 dosyadır (EL-38).
- `no-floating-promises` 35 ihlal / 18 dosya — çoğu tek kelimelik (`void invalidate();`), 6'sı ortak `hooks/useCrudMutations.ts`'te; tip bilgili lint maliyeti ölçüldü (5.2 → 11.4 sn).
- `import/no-cycle` plugin'i REDDEDİLDİ (paket kararı + 1888 kenarlık registry gürültüsü); tek gerçek döngü `store/auth.ts → services/authService.ts → services/apiClient.ts → store/auth.ts` — bağımlılıksız bir bekçiyle sabitlenir.
