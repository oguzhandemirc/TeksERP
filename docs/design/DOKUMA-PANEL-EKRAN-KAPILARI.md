# Dokuma işi PANEL EKRANI — dört kapı envanteri (ÖLÇÜLDÜ 2026-09-13)

> **Bu belge bir tasarım değil, bir ÖLÇÜMDÜR.** Her madde `dosya:sembol` (satır
> numarası değil — satır kayar, sembol kaymaz), onu ölçen bekçi bölümü ve **mevcut bir
> emsal ekran** taşır. Ölçüm tabanı `origin/main`, 2026-09-13.
>
> Yazma yüzeyi (`weaving-order.routes.ts`, `weaving-order.service.ts`) ZATEN İNDİ.
> Bu belge yalnız **ekran dilimi**nin dokunacağı kapıları sayar.

**EMSAL EKRAN — her maddede aynısı izlenir:** `operations/yarn-stock` (İplik Kg-Stok).
Seçilme sebebi ölçülü: bugün *modül bayrağına bağlı*, *karo yüklemi saf*, *route izni
karo izniyle birebir* olan ve dördü de bekçili tek yakın emsal.

---

## ① Route + izin

| ne | bugün | ekran diliminde |
|---|---|---|
| izin kodları | `permission-catalog.ts` → `weavingorder:read` · `weavingorder:write` (**VAR**, `module: "PRODUCTION"`, `category: "web"`) | değişmez |
| backend guard | `weaving-order.routes.ts` → `router.use(verifyToken, requireProductionEnabled)` + uç başına `requirePermission("weavingorder:read"/"…:write")` | ⚠️ aşağıdaki ④'e bak |
| guard TÜRÜ | `requirePermission` (tek izin) — mobil uç DEĞİL, `requireAnyPermission` gerekmiyor | değişmez |
| yasak | jenerik `requireModule("…")` — ESLint + bekçi middleware ADINI arar | — |

**Ölçen bekçi:** `test_permission_catalog` (kodda geçen her izin katalogda mı) + bugün
inen `§3b` kolu (MOBILE_* yayan uçta guard türü — burada konu dışı, mobil uç yok).
**Emsal:** `yarn.routes.ts` → `requireIplikEnabled` + `requirePermission("warehouse:read")`.

## ② `SCREEN_CATALOG` satırı

Eklenecek satırın biçimi (emsalden birebir):

```ts
{ key: "operations/yarn-stock", app: "desktop", modul: "iplikEnabled",
  title: "İplik Kg-Stok", requires: ["warehouse:read"], capabilities: ["yarn:write"] },
```

⇒ dokuma için `key` = route yolunun **ilk iki segmenti**, `app: "desktop"`,
`modul` ZORUNLU (④'e bak), `requires: ["weavingorder:read"]`,
`capabilities: ["weavingorder:write"]`.

⚠️ **AYNI DİLİMDE `SCREENLESS_PERMISSIONS`TAN İKİ SATIR DÜŞER.** `screen-catalog.ts`
bugün şunu taşıyor ve kendi yorumunda kapının iki yönlü olduğunu söylüyor:

```ts
{ code: "weavingorder:read",  reason: "Dokuma işi ekranı ayrı dilimde iner; yüzey önce, ekran sonra (2026-09-13)." },
{ code: "weavingorder:write", reason: "…" },
```

**Ölçen bekçi:** `test_screen_catalog` — `"manifestodaki her kod PERMISSION_CATALOG'da var"` ·
`"her Electron route izni manifestoda beyanlı"` · `"ekranı beyan edilmeyen izin yok"` ·
**`"muaf listesi bayat değil"`** (bu sonuncusu, satırlar düşürülmezse KIRMIZI verir).

## ③ Karo · route · palet (izin aynası)

| adım | dosya:sembol | not |
|---|---|---|
| Electron route | `routes/content-routes.tsx` → `<ProtectedRoute requirePermission="weavingorder:read">` | `router.tsx` DEĞİL |
| karo | `pages/Operations/tile-config.ts` → yeni `{ key, title, description, icon, to, group, permission, visibleWhen }` | `group` hub'ın `groups-config`inde TANIMLI olmalı |
| karo yüklemi | `visibleWhen: <saf yüklem>` — emsal `isYarnStockVisible` (`pages/Operations/Yarn/yarn-regime.ts`) | ⚠️ **sarmalayan ok fonksiyonu YAZILMAZ**; palet bekçisi karo ile palet girişinin AYNI fonksiyon nesnesini `toBe` ile ölçüyor |
| komut paleti | karosu olan ekran **otomatik** listelenir | karosuz ekran `command-entries.ts`e ELLE |
| izin aynası | karo izni ↔ route izni BİREBİR | ayrışırsa kullanıcı karoyu görür, tıklar, `/forbidden` (yaşanmış sapma) |

**Ölçen bekçiler:** `test_screen_catalog` §9a/§9b/§9b2 (karo ↔ `modul` hizası, bayrağa
bağlı karo yüklemi, nav ön ek mirası) · `Electron/src/pages/Operations/tile-visibility.test.ts`
(16 test) · `components/layout/CommandPalette.test.tsx`.
**Kalıbın tamamı:** `docs/standart/ELECTRON.md`; prosedür `docs/RECETELER.md` § Yeni Electron sayfası.

## ④ Bayrak — referans fabrikada ekran BELİRMEZ

⚠️ **BU MADDE ÖLÇÜLDÜ VE BEKLENTİYLE ÇELİŞİYOR — dilimin en kritik kararı burada.**

- Referans profil `basit` (*"bugünkü adnansahin kurulumu"*, `module-profiles.ts`)
  **`production.enabled` AÇIK** taşıyor.
- Dokuma uçları bugün `requireProductionEnabled` ile korunuyor.
- ⇒ Ekran `modul: "productionEnabled"` ile eklenirse **adnansahin'de BELİRİR.**

**`dokuma.enabled` / `requireDokumaEnabled` HENÜZ YOK** — ve yokluğu bilinçli.
`weaving-order.routes.ts` başlığı sebebini yazıyor: *ekransız bir modül kapısı
`test_screen_catalog` **§10b**'de kırmızı verir; kapı ekran dilimiyle doğar.*
`test_screen_catalog` §10b: *"Kapısı olan her modülün en az bir ekranı beyanlı"*.

⇒ **Ekran dilimi bayrağı DA getirir** (dört dosya, `modul-bayrak.md` kalıbı):
`constants/module-flags.ts` (anahtar + üst modül + görünen ad) ·
`constants/module-profiles.ts` (`"dokuma.enabled": "dokumaEnabled"`) ·
`middlewares/module.middleware.ts` (`requireDokumaEnabled`) ·
`routes/weaving-order.routes.ts` (`router.use`ta `verifyToken`dan SONRA).
⚠️ **İNDİ: YANINA değil YERİNE** — bu satır plan aşamasında *"`requireProductionEnabled`in
yanına"* diyordu; inen kod onu YERİNE koydu, çünkü `requireDokumaEnabled` üretim halkasını
KENDİ İÇİNDE okuyor (`test_dokuma_regime_gate §2a/§2b`). `test_production_regime_gate`in
`KAPILI` listesinden üç dosya bu yüzden düştü (13 → 10, D3).
**Varsayılan = BUGÜNKÜ davranış** kuralı burada *"referans profilde KAPALI"* demektir.

**Ölçen bekçiler:** `test_feature_flag_contract` (üç-yer sözleşmesi: boolean + sayısal +
enum ayakları) · `test_module_flags` · `test_module_profile` · `test_screen_catalog` §10b.

### `useTezgahEnabled` — DOKUMA İŞİ EKRANININ BAYRAĞI DEĞİL

`Electron/src/hooks/usePricingEnabled.ts` → `useTezgahEnabled()`:
`useFeatureFlags()` sonucundan `tezgahEnabled` okur, **yüklenene dek `false`**
(fail-closed; "bir an görünüp kaybolan sekme de sıfır fark değildir").
Bugünkü tek kullanıcısı `pages/ReasonPresets/useVisibleKindTabs.ts`.

⚠️ `tezgahEnabled` **tezgah İZLEME** modülüdür (Dilim 4) ve `screen-catalog.ts`te
*"yer tutucu bir anahtar — arkasında henüz hiçbir yüzey (ne route ne karo) yok"*
şerhiyle **ekransız modül muafı** listesinde duruyor. Dokuma işi ekranı bu bayrağa
BAĞLANMAZ; kendi `dokumaEnabled`ını getirir. Hook yalnız **kalıp emsali**dir:
React tarafında bayrak okumanın ve fail-closed varsayılanın biçimi.

---

## Dilimin kapanış ölçütü (hepsi aynı commit'te)

1. `SCREEN_CATALOG` satırı **eklendi** ve `SCREENLESS_PERMISSIONS`tan iki satır **düştü**.
2. `dokumaEnabled` dört dosyada doğdu; referans profilde **KAPALI**.
3. Karo + route + palet izinleri birebir; karo yüklemi **saf** (sarmalayıcı yok).
4. `test_screen_catalog` yeşil — route izni ↔ manifesto hizası *"her Electron route izni
   manifestoda beyanlı"* kontrolüdür (ADIYLA anılır: dosyada `§4` diye bir bölüm YOKTUR,
   D2) · `§9c`/`§9e` karo ↔ bayrak iki yönlü · `§10b` kapısı olan modülün ekranı var ·
   `test_feature_flag_contract` · `test_module_flags` · `test_module_profile` ·
   `tile-visibility.test.ts` · `CommandPalette.test.tsx`.
5. Negatif sonda İKİ yönlü ve **her yön mekanizmasıyla anılır**:
   · **karo çizilmez** — `isWeavingOrdersVisible` (`Operations/WeavingOrders/weaving-regime.ts`),
     ölçen `tile-visibility.test.ts`; karo ↔ bayrak bağı `test_screen_catalog §9c/§9e`.
   · **backend 403 `MODULE_DISABLED`** — `requireDokumaEnabled`, üç router'da da ilk
     `router.use(verifyToken, requireDokumaEnabled)` (`weaving-order` · `machine-run` ·
     `machine-doff`), ölçen `test_dokuma_regime_gate §2a/§2b` (kapı + sıra) ve `§6g`
     (dokuma yüzeyine dokunan HER router kapıyı taşıyor).
   · **route `/forbidden`e düşer** — ⭐ **İNDİ 2026-09-14 (B dilimi, 47/0c `f6d5e83a`)**:
     `ProtectedRoute` artık yol → modül aynasını okuyor (`components/ProtectedRoute.tsx:65`
     `isRouteModuleOpen(location.pathname, moduleCtx)` → `/forbidden`), ayna
     `lib/route-modules.ts` (`ROUTE_MODULE`) ve kaynağı `SCREEN_CATALOG.modul`; ölçen
     `test_screen_catalog §4b` (ayna İKİ YÖNLÜ, 28 satır) · `ProtectedRoute.module.test.tsx`
     · `route-modules.test.ts`. **Panel geneli tek mekanizma** — emsaller de aynı aynadan.
   ⚠️ **Bu cümlenin ÖNCEKİ hâli GEÇERSİZDİ (2026-09-13 → 2026-09-14):** aynı metin
   yazılıyken mekanizma YOKTU — `ProtectedRoute` yalnız oturum + izin okuyordu ve panelde
   hiçbir ekranın bayrak-duyarlı route kapısı yoktu. Cümle bugün doğru; **dünkü hâli bir
   ölçüt değil bir temenniydi** ve doğrulanırken kendi kendini onaylatmıştı
   (`docs/standart/OLCUM-DISIPLINI-CIKARIM.md` § Bir KAPANIŞ ÖLÇÜTÜ, ölçtüğü MEKANİZMANIN
   adını taşımalı). Aradaki fark ÖLÇÜLEBİLİR: dün `ProtectedRoute.tsx`te bayrak atfı 0'dı,
   bugün `:65`.

---

## İNDİ — 2026-09-13 (0c, tek commit) ve ölçülen ayak izi düzeltmesi

**Beş kapanış ölçütü de yeşil:** `SCREEN_CATALOG` `operations/weaving-orders` eklendi, `SCREENLESS_PERMISSIONS`tan iki
`weavingorder:*` satırı düştü · `dokumaEnabled` doğdu, referans profilde KAPALI (`basit`), `perde-dokuma` · `dokuma` · `tam`
AÇIK (1e ürün kararı) · karo + route + palet birebir, yüklem saf (`isWeavingOrdersVisible`) · bekçiler yeşil
(`test_screen_catalog` 33/0 · `test_feature_flag_contract` 78/0 · `test_module_flags` 82/0 · `test_module_profile` 58/0 ·
`tile-visibility.test` · `CommandPalette.test`) · negatif sonda İKİ yönlü: karo `ctx({dokumaEnabled:false})` → çizilmez
(`tile-visibility.test`) · backend kapısı 403 `MODULE_DISABLED` döner (`requireDokumaEnabled`, üç router'da ilk `router.use`;
ölçen `test_dokuma_regime_gate` — **bu bekçinin sayısı 0c'nin ölçümüdür, 5e'nin ağacında `DATABASE_URL` olmadığı için
KOŞULMADI**). Route de bayrağa bakar — **(B) dilimiyle 2026-09-14'te indi** (`f6d5e83a`): `ProtectedRoute` → `isRouteModuleOpen` →
`/forbidden`, ayna `ROUTE_MODULE` ↔ `SCREEN_CATALOG.modul` (`test_screen_catalog §4b`, iki yönlü, 28 satır).
⚠️ **Bu cümlenin ÖNCEKİ hâli ("route `/forbidden`a düşer", delil `test_screen_catalog §4`) ÇÜRÜDÜ ve 2026-09-14'te
DÜZELTİLDİ** (47 ölçtü — D1/D2; 5e yazdı — sözleşme cümlesi 5e'nin hatasıydı). İki cümle yan yana bırakılmaz.

**④'ün "dört dosya" cümlesi ÖNCÜLDÜ (5e: modüle ÖZGÜ dört yeri saymış, jenerik bayrak sözleşmesini atlamıştı), ölçülen ayak izi 28 dosyadır** — ölçüm 2026-09-13, taban `05c6dbbb`, yüklem `git grep -l -E 'devereEnabled|devere\.enabled|readDevereEnabled|requireDevereEnabled' -- ':!docs' ':!*.md'` (kod + bekçi/test dahil, belge hariç; devere emsali):
`Teks-Erp/src` 8 (`app.ts` · `constants/module-flags` · `constants/module-profiles` · `constants/screen-catalog` ·
`middlewares/module.middleware` · `routes/feature-flag.routes` · `routes/warp-spec.routes` · `services/system-setting.service`) +
`Teks-Erp/prisma` 1 (grandfathering migration) + `Teks-Erp/scripts` 7 (`test_devere_regime_gate` · `test_feature_flag_contract` ·
`test_module_flag_off` · `test_module_flags` · `test_module_grandfathering` · `test_module_profile` · `test_production_flow_api`) +
`Electron` 12 (`CommandPalette.test` · `boss-menu.test` · `lib/module-flags` · `Definitions/tile-config` · `GeneralSettings/flag-modules` ·
`GeneralSettings/settings-config` · `Operations/tile-config` · `Operations/tile-visibility.test` · `Operations/useOperationsVisibility` ·
`ModuleProfile/moduleProfile.helpers.test` · `WarpSpecs/service` · `services/featureFlagService`) — 5e aynı yüklemle bağımsız doğruladı
(2026-09-14, iki tabanda da 28; kova dökümü onun sayımı). ⚠️ Bu REÇETENİN ayak izidir; DİLİMİN gerçeği ayrı bir sayıdır —
0c'nin fiili commit'i 33 değişen + 14 yeni dosya (ekran dosyaları + yeni bekçi dahil). İkisi farklı soruların cevabıdır,
karıştırılırsa sonraki tahmin yine dar çıkar. Yeni modül anahtarı reçetesi bu sayıyı taşımalı.

**Mobil ayna KAPSAM DIŞI (ölçüldü 2026-09-14, `git grep -l -iE 'dokumaEnabled|dokuma\.enabled' -- mobil` → 0):** tablet bugün
dokuma bayrağını okumuyor; reçetenin 11. adımı tablet dilimi geldiğinde uygulanır. ⚠️ Bu adımın mekanik bekçisi YOKTUR
(`test_feature_flag_contract` yalnız backend `src` + iki Electron dosyasını ölçer) — atlanırsa hiçbir kapı kırmızı vermez.

**Kapsam düzeltmesi (1e):** `machine-run.routes.ts` de `requireDokumaEnabled`a geçti — koşum dokumanın koşumudur, kapı
takarken kardeş yollar aynı kapsama. `test_production_regime_gate` `KAPILI`si 13 → 10 (ölçüm düzeltildi 47, 2026-09-14: "14 → 11" tip satırını sayan grep gürültüsüydü, D3) (üç dosya `requireProductionEnabled`
metnini artık taşımıyor; §1e onları aramaz), yeni bekçi `test_dokuma_regime_gate` aynı ölçümü (kapı · sıra · kapsam) dokuma
adına yapar ve §7 ile "bayrak kapalıyken hiçbir şey değişmez" cümlesini KİLİTLER: ekran inerken ölçüldü — Electron + mobil
kaynağında dokuma uçlarını çağıran dosya 0'dı; bugün tek dosya var ve dokuma karosunun arkasında.

---

## İNDİ — 2026-09-14 · ikinci ekran: TEZGAH DURUŞLARI (`operations/machine-stops`, 0c `e480eb97`) — aynı dört kapı (manifesto `dokumaEnabled` + `requires: [loom:manual-entry, loom:classify]` biri yeterli · karo `permissionAny` + saf `isMachineStopsVisible` · route `requireAnyPermission` · `ROUTE_MODULE` satırı), iki izin SCREENLESS'tan düştü, `test_dokuma_regime_gate §7` izin-parametreli; 47 doğrulaması `DOKUMA-TEZGAH-IZLEME-TASARIMI.md` §2.7c.

## İNDİ — 2026-09-14 · üçüncü ekran: DOKUMA RAPORLARI (`reports/dokuma`, 01 Dilim 5) — Raporlar hub'ının biçimiyle aynı dört kapı

- **Desen farkı (ölçüldü):** Raporlar hub'ı karoyu `visibleWhen` saf yüklemiyle değil `Reports/tile-config.ts` `featureFlag: "dokumaEnabled"` ile süzer (`ReportsHubPage` `ctx[featureFlag]`; palet girişi `regimePredicate(featureFlag)`), `finance` emsali. Ayrı bir `isDokumaReportsVisible` yüklemi ÖLÜ KOD olurdu — yazılmadı. `test_dokuma_regime_gate §7` bu yüzden **`karo: "operations" | "reports"`** koluyla genişledi: reports kolu karo bloğunda `featureFlag: "dokumaEnabled"` + izin dizesini arar (negatif sonda: `featureFlag` düşürülünce §7d ❌ "referans fabrikada karo BELİRİR").
- ① route: `content-routes.tsx` beş route (`/reports/dokuma` hub · `/randiman` · `/durus-pareto` · `/vardiya-karnesi` · `/karne`), hepsi `requirePermission="report:production"` (1e hükmü ③ — ayrı `loom:read` yok); adres ÜÇ segment (ReportSideRail şartı). Karne eylemleri ekran içi `PermissionGate`: düzelt + mühürle `loom:manual-entry`, mühür aç `loom:shift-unseal` — `SHIFT_STAT_ACTION_PERMISSIONS` backend uçlarının GERÇEK izinleriyle birebir (1e şartı ①); `statId` NULL (karne henüz yazılmadı) ise üç eylem kapalı.
- ② `SCREEN_CATALOG`: `{ key: "reports/dokuma", modul: "dokumaEnabled", requires: ["report:production"], capabilities: ["loom:manual-entry", "loom:shift-unseal"] }`; `loom:shift-unseal` SCREENLESS'tan düştü; `loom:manual-entry` iki ekranda (machine-stops `requires`, dokuma `capabilities`) — `test_screen_catalog` kod-birden-çok-ekranda'yı KABUL eder (§6 ≥ 5 kod zaten öyle), bekçi gevşetilmedi (1e şartı ②).
- ③ karo · route · palet: hub karosu `permission: "report:production"` + `featureFlag`; palet `command-entries.reports.ts`ten otomatik. `command-entries.test.ts` "kategori izni = `report:<kategori>`" konvansiyonu adıyla istisna aldı (`KATEGORI_IZNI_ISTISNASI = { dokuma: "report:production" }`, bayatlık ayağıyla).
- ④ bayrak: `ROUTE_MODULE` `"reports/dokuma": "dokumaEnabled"` (ProtectedRoute `/forbidden` aynası, `test_screen_catalog §4b`); referans fabrikada karo BELİRMEZ.
- Ekranlar `pages/Reports/Dokuma/` (Hub + Randıman + Pareto + Vardiya Karnesi + Karne listesi; `*Page.tsx` ≤ 200 satır / fonksiyon ≤ 80 — tablo, diyaloglar, mutasyonlar ayrı dosyada). Oran `null` → "ölçülemedi" TEK yerde (`formatPct`, `?? 0` yok); kaynak kırılımı şeridi her sayfada, `SIMULATED` ayrı rozet; `meta.ufuk` notu.
- Bekçiler: `dokuma-regime.test.ts` (karo nesnesi bayrak+izin, `regimePredicate` iki yön, dört alt rapor üç segment) · `command-entries.test.ts` · `tile-visibility` / `route-modules` / `ProtectedRoute.module` (mevcut, yeşil) · backend `test_screen_catalog` 37/0 · `test_dokuma_regime_gate` 50/0 (§7 reports kolu) · `test_permission_catalog` · `test_role_template_catalog`.
- Sürüm maddesi: `surum-notlari.json` tur `2026-09-13`, kapsam panel, tip yeni; kopyalar + `check-surum-notlari --panel=1.3.2 --tablet=1.0.7` 16/0.

## Doğrulama — 2026-09-14 (47, çelişmeli; kod `c27dbfd3`, taban `origin/main` `c3ba2d94`)

**Sonuç: dört kapı ve bayrak MEKANİĞİ AYAKTA; kapanış ölçütü 5'in ikinci yarısı ÇÜRÜDÜ, üç ölçüm kaydı yanlış, iki envanter boşluğu.**
Yöntem: klon DB (`tekserp_1c_test`, migration 281/281) üzerinde bekçi koşumu + 6 bağımsız Opus okuyucu (mercek: dört-kapı ×2 ·
mekanik ×2 · sıfır-fark ×2, salt-okunur ağaç; komut `Workflow`, 311 araç çağrısı) + iddiaların kodda elle doğrulanması.
Davranışsal (güvenlik/veri) kusur BULUNMADI; asıl sed backend'dir ve ölçülüyor.

### Ölçüldü ✅

| ne | sonuç | nasıl |
|---|---|---|
| ① üç router `verifyToken → requireDokumaEnabled → requirePermission`; jenerik `requireModule` yok | ✅ | `test_dokuma_regime_gate` 33/0 (§6a/§6c ×3) |
| ② `SCREEN_CATALOG` satırı + iki `weavingorder:*` muafı düştü; `loom:*` muafı CANLI (hiçbir ekran istemiyor; düşse `permissionsWithoutScreen` dolar) | ✅ | `test_screen_catalog` 33/0; bayatlık yüklemi `screensUsing(code).length > 0` |
| ③ karo yüklemi saf, palet otomatik, izin aynası birebir; §9c/§9e çözücüsü alt dizindeki `weaving-regime.ts`i gerçekten çözüyor | ✅ | Electron vitest 43/43 (`tile-visibility` · `CommandPalette` · `weaving-regime` · `boss-menu` · `ModuleProfile`) |
| ④ bayrak: `basit`te KAPALI, `perde-dokuma`/`dokuma`/`tam` AÇIK; ön koşul kapının İÇİNDE (`production` önce, 403 `dependent:"dokuma"`); `setFeatureFlags` bağımlılığı 400 | ✅ | `test_module_flags` 82/0 · `test_module_profile` 58/0 · `test_feature_flag_contract` 78/0 · `test_production_regime_gate` 40/0 · `test_route_auth_coverage` 15/0 · `test_swagger` 12/0 |
| grandfathering: sabit `false`, `WHERE EXISTS rolls`, `ON CONFLICT DO NOTHING`; klon DB'de satır `dokuma.enabled=false` MEVCUT | ✅ | psql; `test_module_grandfathering §2b` ve `test_module_flag_off §3` klonda KIRMIZI ama ORTAM kaynaklı (öteki modüllerin grandfathering satırları rev1e klonunda yok; kod hatası değil) |
| "varsayılan = bugünkü davranış" öncülü | ✅ | `c27dbfd3~1`de Electron+mobil'de dokuma ucu çağıran dosya 0, bugün 1 (`WeavingOrders/service.ts`) |
| Electron etkin değer `productionEnabled && (dokuma ?? false)` — yüklenirken karo çizilmez | ✅ | `useOperationsVisibility.ts`; not: `productionEnabled ?? true` üretim için fail-open ama dokuma etkin değeri yine `false` kalır |
| mobil KAPSAM DIŞI | ✅ | `git grep -iE 'dokumaEnabled|dokuma\.enabled' -- mobil` → 0; tablet ayağı `DOKUMA-IS-EMRI-VE-TABLET-TASARIMI.md` §3.9 bulgu E ile sonraya |
| bayrak ayak izi | 32 dosya | `git grep -l -E 'dokumaEnabled|dokuma\.enabled|readDokumaEnabled|requireDokumaEnabled' -- ':!docs' ':!*.md'` @ `c3ba2d94`; aynı yüklem devere için bugün 30 (yukarıdaki 28 `05c6dbbb` tabanıydı); fark = ekran dosyaları + migration adı. Sayı tabana bağlıdır, reçeteye "≈30, yüklemle ölç" yazılmalı |

### Çürüdü ❌ — kalemler (sahibi 1e'nin kararı; 47 kod/sözleşme değiştirmedi)

- **D1 · ✅ KAPANDI 2026-09-14 (5e; ölçüt 5 yeniden yazıldı, mekanizma adıyla) · Kapanış ölçütü 5'in ikinci yarısı kodda KARŞILIKSIZ.** `Electron/src/components/ProtectedRoute.tsx` yalnız `user` ·
  `canEnterApp` · `requirePermission` · `requireAnyPermission` · `requireSystemAccount` okur; bayrak dalı YOK
  (`grep -c 'MODULE_DISABLED\|dokumaEnabled\|useFeatureFlags'` → 0). `content-routes.tsx` dokuma route'u yalnız
  `requirePermission="weavingorder:read"` taşır. ⇒ bayrak KAPALIYKEN `weavingorder:read` (ya da `["*"]` süperadmin) taşıyan
  kullanıcı adres çubuğu / kalıcı sekme defteri (`store/tabs.ts` `persist("teks.tabs")` → `TabRouter` doğrudan mount) ile
  `/operations/weaving-orders`ı AÇAR; `WeavingOrdersPage` mount'ta koşulsuz `useDataTable` sorgusu atar (`enabled` geçirilmez),
  backend 403 `MODULE_DISABLED` döner, hata paneli basılır. **Sıfır fark cümlesi bu yolda tutmaz; ölçütün istediği "iki ayrı
  sonda" fiilen TEK sondadır (izin).** Bu dilime özgü sapma DEĞİL, projenin yazılı konvansiyonu: `content-routes.tsx` finans
  yorumu *"görünürlük kapısı bayrak: menü satırı çizilmez ve backend her ucu 403'ler"*; emsal `operations/yarn-stock` da aynı
  biçimde. ⇒ kusur "kod emsalden saptı" değil, **"sözleşme var olmayan bir mekanizmayı ölçüt yazdı, indiriş onu yapılmış ilan etti"**.
  Karar 1e'de: **(a)** ölçüt 5 konvansiyona DARALTILIR ("karo çizilmez + backend 403; route izin kapısı") — 47 önerisi, backend
  sed zaten ölçülü · **(b)** `ProtectedRoute`a bayrak ayağı (`requireModuleFlag`) doğar, dokuma + emsaller ona bağlanır, negatif
  sonda (vitest + memory router, `dokumaEnabled:false` + `weavingorder:read` → `/forbidden`) yazılır — ayrı dilim, üç emsal ekranı kapsar.
- **D2 · ✅ KAPANDI 2026-09-14 (5e; ölçüt 4 ve İNDİ atfı ADIYLA anılır oldu) · "İNDİ" bölümünün delil atfı GEÇERSİZ.** `test_screen_catalog §4` diye bir bölüm yok (`grep -c '§4'` → 0); dosyanın
  "── 4)" bölümü *"her Electron route izni bir ekranda beyan edilmiş"* = izin↔manifesto hizası, bayrak-kapalı yönlendirme değil.
  Aynı sınıf: `test_dokuma_regime_gate` başlığı (satır 22–23) *"ne karo, ne route, ne istek"* der ama §7e yalnız
  `requirePermission="weavingorder:read"` metnini arar ve **§7b etiketi** *"(kapalı modülde istek atan yüzey yok)"* ölçtüğünden
  BÜYÜK — yüklem "çağıran dosya allowlist'te"dir. Kapının dördüncü ölüm biçimi (etiket ölçümü aşar). Kalem (0c): §7b etiketi ve
  başlık ölçtüğüne daraltılır; "istek atan yüzey yok" ancak (b) seçilirse §7f olarak doğar.
- **D3 · Sayı kaydı yanlış: `KAPILI` 14 → 11 DEĞİL, 13 → 10.** `sed -n '/^const KAPILI/,/^\];/p' scripts/test_production_regime_gate.ts | grep -c '{ dosya: "routes/'`
  → 10; `git show c27dbfd3~1:…` aynı komut → 13. "14/11" `grep -c 'dosya:'`in tip bildirim satırını (`ReadonlyArray<{ dosya: string…`)
  saymasıdır — aracın kendi gürültüsü. Belgede yukarıda düzeltildi; commit mesajı ve arşiv notu (varsa) 1e'de.
- **D4 · Envanter boşluğu: `Electron/src/pages/Operations/WeavingOrders/weaving-regime.test.ts`** (dilimle YENİ) ne
  `Teks-Erp/docs/BEKCI-HARITASI.md`de ne `docs/kurallar/modul-bayrak.md` İstemci listesinde ne `dokuma.md`de
  (`grep -c weaving-regime` üçünde 0); kardeşleri (`yarn-regime.test` · `production-regime.test` · `tile-visibility.test`) kayıtlı,
  backend bekçisi aynı commit'te İKİ yere yazılmış. Haritada olmayan bekçi koşulmaz ve `test_identity_ledger` yalnız
  `Teks-Erp/scripts/test_*.ts`yi ölçtüğü için hiçbir kapı kırmızı vermez. Kalem (0c): üç dosyaya satır.
- **D5 · Bayat kod yorumu:** `Teks-Erp/src/constants/module-flags.ts` `MODULE_SETTING_KEYS` üstü *"Aynı sekiz modülün DB anahtarı"*
  — küme artık dokuz (`dokuma.enabled`); aynı commit `module-profiles.ts` `tam` açıklamasını "Dokuz"a çevirmiş, bunu atlamış.
  (`module-flags.ts` başlığındaki "YEDİ", `module-profiles.ts`/`screen-catalog.ts`/`module-profile.job.ts`teki "yedi" bu dilimden
  ÖNCE de bayattı — aynı sınıf, ayrı borç; elle sayım yasağı kapsamında.)
- **D6 · ✅ KAPANDI 2026-09-14 (5e; ④'e "İNDİ: YANINA değil YERİNE" şerhi) · Sözleşme kendi eski cümlesini bırakmış:** ④ *"`router.use`ta `requireProductionEnabled`in yanına"* — inen kod YANINA değil
  YERİNE koydu (kapı üretimi kendi içinde okur), `test_production_regime_gate` KAPILI'sından üç dosya bu yüzden düştü. Plan cümlesi
  ölçümle yan yana duruyor; "İNDİ: yerine" şerhi düşülmeli.
- **Küçük (canlı delik değil):** `test_dokuma_regime_gate`in route taraması düz `readdirSync` — `src/routes/reports/` altındaki
  8 router görülmez; bugün hiçbiri üretim/dokuma kapısı taşımıyor (`grep -rl` → 0), kural cümlesinden dar. Dokunma yüklemi ham SQL'i
  ve transitif helper'ı görmez. Kapsam beyanı dosya başlığına yazılmalı.

### Ölçülemedi ⚠️

- Bayrak KAPALIYKEN uçların CANLI 403 verdiği (`test_module_flag_off` `/api/weaving-orders` sondası) klon DB'de ortam kırmızısına
  takıldı (yukarıda); kapının KURULDUĞU ölçüldü, ÇALIŞTIĞI temiz DB'de 1e/0c tarafından ölçülmeli: `npx tsx scripts/run-all-tests.ts module_flag_off`.
- Kalıcı sekme ile açılış sondası (bayrak açıkken sekme açık → bayrak kapatılır → yeniden boot): yazılmadı, D1'in kararına bağlı.
