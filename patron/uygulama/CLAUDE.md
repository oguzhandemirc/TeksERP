# patron/uygulama — TeksERP patron uygulaması (Expo 54)

> Kök `CLAUDE.md` çekirdeği burada da AYNEN geçerlidir (fail-closed, `details.code`, TR ileti, sır hijyeni, yeni paket onayla). Alan kuralları `docs/kurallar/patron-bulutu.md` § Uygulama ve `docs/kurallar/bildirim.md` (patron push satırları); push sözleşmesi `docs/design/PATRON-PUSH-KOPRUSU.md`. Dokunmadan ÖNCE oku.

## Amaç ve kipler

Patronun telefon/tablet (Android) ve web uygulaması. İki bağlantı kipi, tek ekran kodu: **bulut** (`patron/sunucu` `/api/*`) ve **ERP** (fabrikanın `/api/patron/v1/*` uçları). Bağlantı yalnız `src/api/` katmanında kurulur (`Baglanti = {kip, tabanAdres, tasima}`); ekran kip sormaz, `Api` + `yetenek()` ile çalışır. Uygulama yalnız GİZLER, karar sunucudadır; aritmetik yapmaz.

## Komutlar (bu dizinde)

- `npm ci` · `npx tsc --noEmit -p .` · `npx jest` (tek dosya: `npx jest __tests__/<ad>`). Commit kapısı tsc + bu projenin hızlı testini koşar.
- Web: `npm run web` · `npm run export:web`.
- Mağaza paketi YALNIZ `npm run build:aab` (anahtar repo dışında, izin yalnız INTERNET).
- Cihaz dumanı APK'sı (push açık): `set -a; . ~/.tekserp/patron-push/eas-proje.env; set +a; PATRON_NATIVE_PUSH=1 npm run build:apk:duman`; `google-services.json` kaynağı `~/.tekserp/patron-push/google-services.json` — uygulama köküne kopyalanır, ASLA commit edilmez. Kurulum `adb install -r`, ekran `adb exec-out screencap -p` (kişisel içerikli ekran görüntüsü saklama).

## Değişmezler (kısa; tam metin kural dosyasında)

- **Tel tipi ayna:** `src/api/wire.ts` = `patron/sunucu/src/wire/api.ts` BAYT-EŞİT (`cp -p`); ayna bekçisi `__tests__/mirror.test.ts`. Çağrılan her bulut ucu `API_ROUTES`ta; ERP uçları bulut uç tablosuna girmez. Başka projenin kaynağı/`node_modules`ü içe aktarılmaz (test metin olarak okuyabilir).
- **Push kapısı:** native push yalnız derleme kapısı (`app.config.js` `pushKapisi`: `PATRON_NATIVE_PUSH=1` ∧ `google-services.json` ∧ `PATRON_EAS_PROJECT_ID`) açıkken; `expo-notifications` kodu yalnız `src/push/*-native.ts`te; literal `NATIVE_PUSH` yazma (`src/push/support.ts`). İzin yalnız "Telefon bildirimlerini aç" eylemiyle istenir; Android kanalı izin isteminden ÖNCE kurulur.
- **Bildirim/ses dosyaları:** ses kümesi `src/push/sesler.ts` ↔ bulut `PUSH_SOUNDS`, kanal `tekserp-<sınıf>-<ses>`; sesler `assets/sounds/`. Kanal kurulumu `src/push/kanallar-native.ts`: seçili kanal garanti edilir, önceki/önizlenen `tekserp-*` kanalı SİLİNMEZ (kullanıcının telefon ayarı korunur). Dokunuş `src/push/taps.ts` → `safeRoute` (`src/lib/notification-form.ts`): yalnız uygulamanın kendi ekranı; ERP'de yedek `/bildirimler?vurgu=`. Tür görünüşü `src/lib/erp-bildirim.ts` (ön ek → fabrika katalog grubu → ikon).
- **Ekran/gezinme adı** yalnız `src/lib/access.ts`; "Diğer" ve geniş ekran rayı aynı `NAV_GROUPS`; kapalı modül yalnız menüden gizlenir (`moduleInMenu`), kapalı modülün özeti istenmez.
- **Geniş ekran (≥ `WIDE_MIN` 768):** solda ray (`src/ui/Frame.tsx`), form rotaları ortalı kart (`Screen sheet` + `FORM_SHEET_OPTIONS`), seçici/sayfa modalları `src/ui/ModalSheet.tsx` (telefonda tam sayfa). Hareket `src/ui/motion.ts` tokenlarından, "hareketi azalt"a uyar (`useReducedMotion`).
- **Depolama:** oturum belirteci gizli depoda; TOTP sırrı/davet kodu/parola hiçbir depoya yazılmaz; önbellek salt-okunur, çıkışta silinir; Android `allowBackup: false`.
- **Yazma** yalnız `src/api/yazma.ts` `Yazici`; deneme kimliği mantıksal deneme başına, yalnız belirsiz hatada yapışır.
- Seçici (cari · ürün · renk) doğrudan modal açar, arama SUNUCUDA (`LIST_SEARCH`). Firma adı/logosu koda gömülmez.

## Dağıtım sırası

Sözleşme değişiminde bulut → fabrika → uygulama; eski bulut/fabrika ile uygulama geriye uyumlu kalır (bilinmeyen alan yok sayılır, tanınmayan rota listeye düşer).
