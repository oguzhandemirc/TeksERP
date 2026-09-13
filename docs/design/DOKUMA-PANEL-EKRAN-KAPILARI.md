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
`routes/weaving-order.routes.ts` (`router.use`ta `requireProductionEnabled`in yanına).
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
4. `test_screen_catalog` yeşil (§4 · §9a/b/b2 · §10b · muaf listesi) ·
   `test_feature_flag_contract` · `test_module_flags` · `test_module_profile` ·
   `tile-visibility.test.ts` · `CommandPalette.test.tsx`.
5. Negatif sonda: bayrak KAPALIYKEN karo çizilmiyor VE route `/forbidden`e düşüyor —
   ikisi ayrı ayrı ölçülür (biri karoyu, öteki ucu korur).
