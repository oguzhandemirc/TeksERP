# MOBIL.md — tablet (`mobil/`) yazım standardı

React Native + Expo 54, Android tablet + telefon. Bu dosya **rutin** soruyu cevaplar: yeni bir ekran nasıl kurulur, hangi parça nereye yazılır, ne kadar uzun olur, hangi kapı korur.

Katman-üstü ilkeler [`ILKELER.md`](ILKELER.md)'de (burada tekrar edilmez, `[IL-xx]` ile atıf yapılır) · kadans [`TEST-VE-DERLEME.md`](TEST-VE-DERLEME.md)'de · kural biçimi ve "yeni kodda zorunlu / devralınan baseline'da donar" ilkesi [`README.md`](README.md)'de · tablet-geneli düzen (HAL, oturum, okutma kalıpları, paketler) `mobil/CLAUDE.md`'de · alan kararları `docs/kurallar/<alan>.md`'de.

Ölçüm zemini: 386 kaynak dosya · 84 test dosyası / 820 vaka · `tsc --noEmit` temiz (`docs/history/standart-2026-09-05/kesif/mobil-ekran.json`, `olcum/eslint-mobil.json`, `olcum/faz0-acik-olcumler.json`).

**Bu dosyanın tek cümlesi:** kalıp mevcut ve yeni kodda tutuyor; sapmanın tamamı 2026-05-11 doğumlu beş dev ekranda toplanmış ve onlar sınır dışıdır.

---

## 1 · Ekran kalıbı

Ekran **dört parçadır**: ince kabuk (`<Ad>Screen.tsx`) · görünüm bileşenleri · ekran-hook (`use<Ad>.ts`) · saf mantık modülü (`<ad>.ts` / `<ad>.helper.ts`) + yanında `.test.ts`.

- **[MO-01]** Yeni ekran bu dört parçayla açılır; tek dosyada büyüyen ekran yazılmaz · zorlama: insan:parça sayısı AST'den ölçülmez, boyut kapısı yalnız dolaylı ölçer · kanıt: `src/screens/Modules/HizliIsEmri/` (15 dosya / 4.167 satır; kabuk `HizliIsEmriScreen.tsx` 140) · devralınan: 5 dev ekran (23.862 satır) sınır dışı
- **[MO-02]** Kabuk yalnız navigasyon, yerleşim ve alt görünümlerin bağlanmasıdır — iş kuralı, mutasyon ve HTTP kabukta durmaz · zorlama: eslint:`max-lines` (warn 400) + `scripts/check-lint-baseline.mjs` · kanıt: `HizliIsEmriScreen.tsx` 140, `Siparis/SiparisScreen.tsx` 134, `UpdateSettingsScreen.tsx` 305 (bugünkü üst sınır) · devralınan: yok
- **[MO-03]** Beş dev ekran (`TamburScreen` 9.386 · `FasonKabulScreen` 4.679 · `KK1Screen` 4.204 · `KursunQcScreen` 3.192 · `FasonSevkScreen` 2.401) `max-lines` muafiyet listesindedir; liste **yalnız kısalır** ve dokunulan bölüm çıkarılırken sınıra çekilir · zorlama: eslint muafiyet bloğu + baseline tavanı · kanıt: `olcum/eslint-mobil.json` § max-lines; bölme planı `kesif/mobil-ekran.json → sizeProposal.tambur_bolme_plani` (6 adım) · devralınan: 5 dosya

## 2 · Katman — ekran → servis → apiClient

- **[MO-04]** Ekran HTTP kurmaz: her uç `services/<domain>.service.ts` üzerinden `apiClient`e iner · zorlama: insan:"ekran mı servis mi" ayrımı dosya yolundan okunur, AST'den değil · kanıt: `services/tambur.service.ts` (581); `services/api`yi import eden 9 ekranın hepsi yalnız yüklem alıyor (`isWorkSessionLost` / `isLoginLocked`, `KK1Screen.tsx:76`) · devralınan: 1 (`components/LabelPrinter.tsx:6,212` apiClient'i doğrudan çağırıyor)
- **[MO-05]** Ham `axios` yalnız `services/api.ts` ile baseURL'siz sunucu keşfi/yoklamasında import edilir · zorlama: insan:meşru istisna gerekçeyle ayrılır · kanıt: `ServerSettingsScreen.tsx:31`, `ServerAddressSheet.tsx:14` (keşif yolu, oturumsuz) · devralınan: yok
- **[MO-06]** Ölçülecek karar ekrandan **çıkar**: saf mantık kardeş bir modüle alınır ve `.test.ts` onun YANINDA durur — `src/test/` yalnız kurulum + guard/smoke dosyalarını taşır (5 dosya) · zorlama: bekçi:`jest` (yan yana test toplanır) + insan:çıkarma kararı · kanıt: 84 test dosyasının 80'i kaynağın yanında; emsal `Modules/FasonKabul/receivePayload.helper.ts` (351) + `.test.ts` (468) · devralınan: yok
- `mobil/CLAUDE.md`'nin klasör listesindeki "`test/` (guard testleri)" cümlesi fiilî kalıbı anlatmıyordu; doğrusu bu satırdır.

## 3 · Çevrimdışı yazma

- **[MO-07]** Kuyruğa girecek istasyon yazması `mutationKey: STATION_MUT.*` ile tanımlanır ve `mutationFn`i `offline/mutations.ts`te `setMutationDefaults` ile bağlanır — anahtarsız mutasyon `resume`da kaybolur · zorlama: bekçi:`src/offline/*.test.ts` (kuyruk paketi) · kanıt: `offline/mutations.ts:5` (başlık gerekçesi), `:44-58` (12 anahtar), `:152+` (`setMutationDefaults`); emsal `KursunQcScreen` 5 mutasyonun 5'i kuyruklu · devralınan: yok
- **[MO-08]** **Kuyruksuz (online-only) yazma bir KARARDIR** ve tek satırlık gerekçesi mutasyonun hemen üstünde durur · zorlama: insan:"gerekçe var mı" sorusu AST'den okunmaz · kanıt: emsal `TamburScreen.tsx:1703-1705` ("barkodu sunucu üretir → offline kuyruğuna GİRMEZ"), `FasonKabulScreen.tsx:650` · devralınan: 13 kuyruksuz istasyon mutasyonunun 11'i gerekçesiz (`TamburScreen` 1198/1245/1492/1510/1525/1635/7168/7934 · `KK1Screen` 188 · `FasonKabulScreen` 686 · `DepoScreen` 923)

## 4 · İdempotency — istemci tarafı

Mekanizma tablosu ve backend karşılığı [`ESZAMANLILIK.md`](ESZAMANLILIK.md) § istemci token'da; burada yalnız tablet tarafı.

- **[MO-09]** `clientToken` **mantıksal deneme** başına üretilir ve yalnız sonucu belirsiz bırakan hatada (ağ / zaman aşımı / 5xx) yapışır; kesin 4xx taze token alır · zorlama: bekçi:`src/offline/entryAttempt.test.ts` · kanıt: `offline/entryAttempt.ts:1-28` (2026-08-03 saha vakası: tek fiziksel top için N stok kaydı) · devralınan: yok
- **[MO-10]** Uçuştaki bir denemeye gelen ikinci basış, yük BİREBİR aynıysa uçuştaki kimliği (token + damga) yeniden kullanır; yük farklıysa yeni bir denemedir · zorlama: bekçi:`entryAttempt.test.ts` · kanıt: `offline/entryAttempt.ts` § "UÇUŞ PENCERESİ" (2026-08-05) · devralınan: yok
- **[MO-11]** `onMutate` yeşil basmaz: kayıt onayı yalnız sunucu cevabından doğar · zorlama: insan:iyimser güncelleme meşru bir kalıptır, AST "yeşil bastı mı" ayrımını yapamaz · kanıt: ölçüm — `src`'de `onMutate` kullanımı 0 · devralınan: yok
- **[MO-12]** Çakışma 409'u TEK yüzeyde konuşur — ekranın kendi modalı; toast basmaz · zorlama: bekçi:`KK1/EntryConflictModal.test.tsx` · kanıt: `offline/queryClient.ts:52` (kural yorumu), `KK1Screen.tsx:3120` (iki 409'un ortak yüzü); alan kararı `docs/kurallar/kk1.md` · devralınan: yok

## 5 · Okutma geri bildirimi

- **[MO-13]** Okutma sonucu `services/scanFeedback.signalScan` ya da `hooks/useScanFeedback` ile verilir; okutma yolunda `Haptics.*` doğrudan çağrılmaz · zorlama: insan:"okutma yolu" AST'den ancak beyaz listeyle ayrılır — `components/BarcodeScannerView.tsx:286` (opt-in yakalama onayı) ve `HizliIsEmri/useQuickWorkOrder.ts:657` (yakalama tıkı) meşrudur · kanıt: `services/scanFeedback.ts:6-18`; bugünkü tüketiciler `KK1Screen.tsx:607,615` · `FasonSevkScreen.tsx:792` · `useQuickWorkOrder.ts:604` · devralınan: 11 dosya
- **[MO-14]** Sonuç sözlüğü üçtür (`accept` | `duplicate` | `reject`) ve dördüncüsü uydurulmaz: "kabul edilmedi" sınıfının tamamı `reject`tir, `duplicate` atlanmaz · zorlama: tsc (`ScanOutcome` union) · kanıt: `scanFeedback.ts:6-18`; emsal çevrim `DepoScreen.tsx:316` (CANCELLED top → reject) · devralınan: yok
- **Borç (ölçülü):** `signalScan` yalnız 3 tüketicide; okutma yolunda ham `Haptics` taşıyan 11 dosyada **mükerrer sinyali ve `scanSoundEnabled` ses ayarı hiç çalışmıyor**. Doğrulanmış üç ekran ve dönüştürme çevrimleri: `DepoScreen.tsx:296,299,309,316,319` (+ `:322-328` catch sinyalsiz) · `KursunQcScreen.tsx:396,406,419,446,477` (+ `:373-383` "kart zaten açık" → `duplicate`, bugün sessiz) · `PaketlemeScreen.tsx:361,364,376,384` (+ `:398` sessiz return → `duplicate`). Kalan 6 dönüştürülecek dosya ve 2 bilinçli istisna: `olcum/faz0-acik-olcumler.json → I_20_mobil_haptics`.

## 6 · UI sözleşmesi

- **[MO-15]** Tıklanabilir her alan Paper bileşenidir: `TouchableRipple` / `Button` / `IconButton` / `List.Item`; `<Card` + `onPress` yazılmaz · zorlama: insan:ESLint kuralı ÖLÇÜMLE reddedildi — `<Card` kullanımı 0, ihlal yüzeyi yok, sıfır koruma değeri üretirdi (`olcum/eslint-mobil.json` § Card+onPress, karar "yazma"), `[IL-12]` · kanıt: `TouchableRipple` 233 kullanım / 81 dosya · devralınan: 9 ham RN dokunma (7 `Pressable` backdrop, `ToastConfig.tsx` 1, `TouchableWithoutFeedback` 1)
- **[MO-16]** Modallar `components/AppModal.tsx`ten doğar · zorlama: insan:ham `<Modal` meşru bir React Native ilkelidir, jenerik yasak yanlış pozitif üretir · kanıt: `AppModal` 54 dosyadan import / 79 JSX kullanım · devralınan: 3 (`Tambur/LabelNamePreview.tsx`, `components/AppMenu.tsx`, `components/labels/LabelPreviewSheet.tsx`)
- **[MO-17]** Liste `FlashList` + `useInfiniteQuery` (`onEndReached`) ile kurulur; "Önceki/Sonraki" pager yoktur · zorlama: insan:kalıp %100 tutuyor, kapı maliyeti değerini aşar · kanıt: `FlashList` 37 kullanım / 23 dosya, `useInfiniteQuery` 36 çağrı, `<FlatList` 0 · devralınan: yok
- **[MO-18]** `SegmentedButtons` `flexDirection:'row'` kabının doğrudan çocuğu OLAMAZ · zorlama: bekçi:`src/test/segmented-buttons-row.guard.test.ts` (TS AST, en yakın sarmalayıcı stilini çözer) · kanıt: aynı dosya; vaka `[IL-14]` (2026-08-25) · devralınan: yok
- **[MO-19]** Renk, spacing ve radius `theme/tokens.ts`ten okunur; **yeni dosyada ham hex 0** · zorlama: eslint:`no-restricted-syntax` (hex `Literal`, warn) + baseline; `theme/tokens.ts` muaf · kanıt: 2.173 ihlal / 100 dosya (AST ölçümü), %51'i beş dev ekranda; en yeni beş ekran 0/0/0/2/9 — kural yeni kodda zaten tutuyor · devralınan: 2.173 (baseline)
- İkinci bir yerel palet kaynağı vardır (`screens/Common/settings/settingsUi.tsx:20 SETTINGS_COLORS`); yeni renk oraya değil `tokens.ts`e eklenir.

## 7 · Oturum ve donanım

- **[MO-20]** Oturum kapısı ekran içinde kurulmaz: kayıt `constants/stationScreens.ts`te, sarma navigator'da `withWorkSession` ile yapılır · zorlama: bekçi:`components/session/SessionGate.test.tsx` · kanıt: `MainNavigator.tsx:46`, `SessionGate.tsx:31`, `stationScreens.ts` (4 ekran, 4/4 registry'den; elle saran yer 0) · devralınan: yok
- **[MO-21]** Çevre birimi oturumdan çözülür (`hooks/useMachinePeripherals`); cihaz-yerel seçim yoktur ve ekran `services/hal/`e doğrudan inmez · zorlama: bekçi:`hooks/useMachinePeripherals.test.ts` · kanıt: 3 tüketici (`TamburScreen.tsx:611` METER, `KK1Screen.tsx:388` METER, `hooks/useSackWeigh.ts:41` SCALE); ekrandan HAL'e inen yer 0; sözleşme `mobil/CLAUDE.md` § Donanım (HAL) · devralınan: yok

## 8 · İzin

- **[MO-22]** Ekran görünürlüğü `usePermissions().has()` ile ölçülür; joker dalları (`*`, `mobile:*`, `admin:*`) düz `includes`/OR zincirine çevrilmez — bu hook backend `matchesPermission`ın mobil ikizidir · zorlama: bekçi:`src/hooks/usePermission.test.ts` · kanıt: `hooks/usePermission.ts:12-30` (2026-09-03: `*` dalı olmadan giriş başarılı görünür, ekran listesi boş kalır) · devralınan: yok
- **[MO-23]** Mobil izin union'ı `types/permissions.ts`te ELLE aynalanır (backend tipleri import edilemez); yeni izin kodu iki uçta birlikte eklenir · zorlama: insan:iki repo arasında derleyici bağı yok, `[IL-08]` · kanıt: `types/permissions.ts:1-30` (`MobilePermission` union + dar mobil ikizlerin gerekçeleri); reçete `docs/RECETELER.md` § route+izin · devralınan: yok

## 9 · Adlandırma ve import

Genel isimlendirme `[IL-16]`–`[IL-18]`; burada yalnız mobile özgü olan.

- **[MO-24]** Ad kalıbı: hook `use*` · store `<ad>Store.ts` · API sarmalayıcı `<domain>.service.ts` · bileşen `PascalCase.tsx` · zorlama: insan:ad kalıbı AST'den ölçülmez (`[IL-18]`) · kanıt: hooks 27/27, `.service.ts` 37 dosya, components 49/50 · devralınan: 2 (`shippingSession.store.ts`, `androidEditText.model.tsx`); `services/` altındaki 12 sarmalayıcı-olmayan dosya (api, printHtml, netStats, scanFeedback…) bilinçlidir
- **[MO-25]** Tanımlayıcı ASCII'dir — Türkçe karakter yalnız UI metninde, hata mesajında ve yorumda · zorlama: eslint:`no-restricted-syntax` (`Identifier[name=/[çğıöşüÇĞİÖŞÜ]/]`, error) · kanıt: ölçüm 2 ihlal / 1 dosya (`Sevkiyat/SackContentsModal.tsx:165` `styles.boş` tanımı, `:91` kullanımı) — geniş selector dar selector'ın kaçırdığını yakaladı · devralınan: yok (düzeltilir)
- **[MO-26]** Import **göreli** yazılır; `tsconfig` alias'ı kullanılmaz · zorlama: insan:iki biçim de derlenir, ihlal derleyiciden görünmez · kanıt: 993 göreli import (587'si üç seviye) ↔ 9 alias tanımı / 2 kullanım · devralınan: 2 alias kullanımı
- Alias tanımları ile fiilî kalıp ayrışıktır (`tsconfig.json` `paths` 9 satır). Karar verilene kadar yeni kod alias yazmaz; kararın kendisi ayrı bir iştir (`kesif/mobil-ekran.json → gaps`).

## 10 · queryKey

- **[MO-27]** Yeni ekranda query anahtarı satır içi yazılmaz: ekranın/domain'in anahtar fabrikasından üretilir ve `invalidateQueries` aynı fabrikadan okur · zorlama: insan:merkezi kayıt henüz yok, AST satır içi anahtarı meşru olandan ayıramaz · kanıt: ölçüm 238 satır içi `queryKey:` (test hariç); merkezi sabit yalnız `offline/persistPolicy.ts`te · devralınan: 238 (sınır dışı; anahtar ayrışması derleme zamanında yakalanamıyor)

## 11 · OTA / APK sınırı

Reçete, kapılar ve tuzaklar `docs/kurallar/surum-yayin.md` + `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md`'de; burada yalnız kodu yazarken verilen karar.

- **[MO-28]** Saf JS/TS değişikliği OTA ile gider; yeni native modül, izin, ikon, SDK ya da config-plugin APK ister ve kararı `npm run yayinla:check` (native parmak izi) verir — tahminle karar verilmez · zorlama: bekçi:`scripts/yayinla-ota.mjs` parmak izi kapısı (`--parmak-izini-kabul-et` bilinçli kaçış) · kanıt: `scripts/yayinla-ota.mjs:21-31` · devralınan: yok
- **[MO-29]** `versionCode` YALNIZ yayınlanacak APK için artar; OTA turunda dokunulmaz — OTA paketi `versionCode`u da taşır, yükselirse tablet kendini kurulu APK'dan yeni sanır ve güncelleme aramayı keser · zorlama: bekçi:`scripts/yayinla-ota.mjs:490-505` (versionCode kapısı) · kanıt: aynı dosya `:177-184`, `:491-502` · devralınan: yok

## 12 · Boyut

Boyut felsefesi ve "satır = kod satırı" tanımı `[IL-21]`; aşağıdaki sayılar mobilin ölçülen dağılımından çıkar (components p50 162 / p90 399 · hooks p90 173 · services p90 347 · offline p90 287 · screens p90 1.125 / max 9.386).

| Birim | Yeni dosyada sınır |
|---|---|
| Ekran kabuğu `*Screen.tsx` | ≤ 250 |
| Görünüm / panel / sheet bileşeni | ≤ 500 |
| Ekran-hook `use<Ekran>.ts` | ≤ 400 |
| Tek React bileşeni fonksiyonu | ≤ 300 satır ve ≤ 12 `useState` |
| Saf mantık `<ad>.ts` / `<ad>.helper.ts` | ≤ 200 + `.test.ts` ZORUNLU |
| Servis `<domain>.service.ts` | ≤ 400 |

- **[MO-30]** Bu sınırlar yeni dosyalarda ve mevcut dosyaya eklenen yeni bölümlerde zorunludur; devralınan dosya baseline'da donar ve tavan yalnız düşer · zorlama: eslint:`max-lines` (warn 400, `skipComments`+`skipBlankLines`) + `scripts/check-lint-baseline.mjs` · kanıt: 46 ihlal / 46 dosya (5 dev ekran muaf); skipComments açık/kapalı farkı 21 dosya — "yorum bir değerdir" sayıyla doğrulandı · devralınan: 46
- **[MO-31]** Tek React bileşeni fonksiyonu ≤ 300 satır ve ≤ 12 `useState` taşır; fonksiyon boyu kuralı dev ekranlarda da AÇIK kalır (dosya muafiyeti fonksiyonu muaf etmez) · zorlama: eslint:`max-lines-per-function` (warn 80) + baseline; `useState` sayısı insan:hook sayımı bileşen sınırını AST'de güvenilir çizmiyor · kanıt: `TamburScreen.tsx` tek React fonksiyonu L374-5107 = 4.734 satır / 81 `useState`; 166 ihlal / 115 dosya, 42'si beş dev ekranda · devralınan: 166
- **[MO-32]** Fonksiyon parametresi ≤ 4; fazlası `opts` nesnesi olur · zorlama: eslint:`max-params` 4 (error) · kanıt: ölçüm tek ihlal — `HizliIsEmri/OrderLineFilterSheet.tsx:115` · devralınan: yok
- **[MO-33]** Ekran bölmek **fırsatçıdır** (`[IL-22]`): dokunulan bölüm bileşene/hook'a çıkarılır, dokunulmayan yerinde kalır; beş dev ekranı bölmek ayrı bir iştir · zorlama: insan · kanıt: `kesif/mobil-ekran.json → sizeProposal.tambur_bolme_plani` (stil → hazır alt bileşen → hook → JSX → saf mantık → 250 satırlık kabuk; 1-2 mekanik, 3-5 tablette ölçülür) · devralınan: 5 ekran

## 13 · Test

Kadans, komut ve süreler [`TEST-VE-DERLEME.md`](TEST-VE-DERLEME.md) `[TD-03]`; bekçi yazma sözleşmesi `Teks-Erp/CLAUDE.md`.

- **[MO-34]** Mobil paketi `jest --runInBand` ile koşar ve **commit kadansındadır** — 29 sn commit başına ödenebilir · zorlama: hook:`.githooks/pre-commit` (mobil `src` değiştiyse) · kanıt: 84 dosya / 820 vaka, ölçüm 29 sn · devralınan: yok
- **[MO-35]** Ekran BİLEŞENİ testi beklenmez: ölçülecek mantık saf modüle çıkarılır ve test ORAYA yazılır — bu bilinçli bir kapsam kararıdır · zorlama: insan:kapsam kararı, kapı kurulmaz · kanıt: 84 test dosyasının 2'si bileşen render ediyor (`KK1/EntryConflictModal.test.tsx`, `UpdateActions.test.tsx`); 820 vakanın tamamı saf modül / servis / hook düzeyinde · devralınan: yok
- **[MO-36]** Yeni test, test ettiği kaynağın yanına yazılır (`<ad>.test.ts`) ve kod ile aynı commit'te gelir (`[TD-20]`) · zorlama: bekçi:`jest.config.js` toplama deseni · kanıt: 80/84 dosya kaynağın yanında · devralınan: 4 (`src/test/` altyapı + guard dosyaları, bilinçli)

## 14 · Lint kapıları ve devralınan borç

Kapı `npm run lint` + `node scripts/check-lint-baseline.mjs --proje=mobil`; commit ve CI'da koşar (`[TD-24]`).

- **[MO-37]** Lint TEK komutla ve tam kapsamda koşar (`eslint .`); `expo lint` kapsamı dardır — yol verilmezse yalnız `src`/`app`/`components` dizinlerini görür, `App.tsx` · `index.ts` · `app.config.js` · `jest.config.js` · `plugins/` · `scripts/` (12 dosya) LİNT DIŞI kalır ve varsayılan cache bayat sonuç riski taşır · zorlama: hook + CI (aynı komut) · kanıt: `olcum/eslint-mobil.json` § mevcutDurum (kaynak `@expo/cli` `DEFAULT_INPUTS`) · devralınan: yok
- **[MO-38]** Beklenmeyen promise `void` ile işaretlenir; yeni ve dokunulan dosyada `no-floating-promises` sert, devralınanda tavan · zorlama: eslint:`@typescript-eslint/no-floating-promises` (tip bilgili, warn) + baseline · kanıt: 291 ihlal / 36 dosya (168'i beş dev ekranda); tip bilgisinin lint maliyeti ölçüldü: +3,3 sn (%25) · devralınan: 291
- **[MO-39]** `any` yazılmaz; domain tipinde zaten yok, React tip köşeleri de tiplenir · zorlama: eslint:`@typescript-eslint/no-explicit-any` (error) · kanıt: 12 ihlal / 5 dosya, hepsi React tip erozyonu (`MainNavigator.tsx:20,41,42`, `SessionGate.tsx:33,34,41`, `PickerModal.tsx:589,627`, `NumpadInput.tsx:125,137`, `PlaceholderScreens.tsx:17,29`); `@ts-ignore` / `@ts-expect-error` 0 · devralınan: yok (düzeltilir)
- **[MO-40]** `src` altında `console` çıkış kanalı değildir (toast / şerit / log servisi vardır); `scripts/`, `plugins/` ve `*.config.js` muaftır — orada `console` tek kanaldır · zorlama: eslint:`no-console` (error, muafiyet bloklu) · kanıt: `src` altında 8 ihlal / 6 dosya; `scripts/` altında 29 meşru çağrı · devralınan: yok (düzeltilir)
- **[MO-41]** Yeni kodda `react-hooks/exhaustive-deps` bastırılmaz; ölü disable direktifi bırakılmaz · zorlama: eslint:`reportUnusedDisableDirectives` (error) + insan:canlı bastırmanın meşruluğu okunarak karar verilir · kanıt: 26 disable yorumu, 23'ü canlı bastırma, 3'ü ölü (`FasonKabulScreen.tsx:442`, `KartelaKabulScreen.tsx:255`, `KartelaSevkScreen.tsx:88`) · devralınan: 23

**Bilinen borç (bu standardın kapsamı dışında, her biri ayrı iş):** beş dev ekranı bölmek (23.862 satır; plan kayıtlı) · okutma yolundaki 11 ham `Haptics` dosyasını `signalScan`e çevirmek (İ-20) · 11 gerekçesiz kuyruksuz mutasyona karar yazmak (İ-21) · 3 ham `<Modal`ı `AppModal`a almak (İ-22) · `ReasonPresetPicker` birleştirmesi 1/4 (İ-23) · merkezi `queryKeys` fabrikası · alias kararı · ham hex codemod'u (jeton sözlüğü eşleşmesi ister) · mobilde şema doğrulama katmanı yok (`zod`; `ESZAMANLILIK.md` § bilinen boşluklar) · üç ölü paket (`@react-navigation/bottom-tabs`, `expo-sharing`, `react-native-qrcode-svg`) — kaldırma native değişikliktir, sonraki APK'da gider.
