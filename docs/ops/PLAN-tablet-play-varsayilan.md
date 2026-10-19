# PLAN — Tablet: onaysız cihazda parola girişi (D3) + Play kanalı varsayılan sunucu (E1)

> Durum: 2026-10-19. Backend sözleşmesi ayrı dalda (`feature/unpaired-password-login`, plan dosyası o dalda: PLAN-onaysiz-parola-girisi §2 Tablet, §6 D3). Bu plan yalnız `mobil/` tarafıdır.

## İŞ 1 — Onaysız cihazda parola girişi (D3)

### Sözleşme (backend)
- `GET /devices/status` ve `POST /devices/announce` → `unpairedPasswordLogin?: boolean` (eşleştirme zorunlu ∧ bayrak ∧ cihaz PENDING+aktif).
- `GET /auth/login-methods` → `unpairedPasswordOnly?: boolean` (yalnız onaysız cihaz isteğinde true).
- Alan yoksa (eski backend) `undefined` → bugünkü davranış.

### Senaryolar
| # | Girdi | Beklenen |
|---|---|---|
| S1 | zorunlu + PENDING + `unpairedPasswordLogin: true` | onay ekranı YOK → giriş ekranı |
| S2 | zorunlu + PENDING + alan yok / false | onay ekranında bekler (bugünkü) |
| S3 | zorunlu + INACTIVE / UNKNOWN + alan true (beklenmez ama) | onay ekranı (yalnız PENDING muaf) |
| S4 | APPROVED / zorunlu değil | bugünkü |
| S5 | `login-methods.unpairedPasswordOnly === true` | personel listesi istenmez; PIN/kart seçicisi çizilmez; kullanıcı adı + parola formu |
| S6 | S5 + kilit kipi | kullanıcı adı oturum sahibinden önceden dolu |
| S7 | `unpairedPasswordOnly` yok/false | giriş ekranı birebir bugünkü |
| S8 | yoklama | onaysız-girişli cihazda durum yoklaması 45 sn (beklenen onay yok) |

### Dilimler
1. `services/device.service.ts` `DeviceAssignment.unpairedPasswordLogin?`; `services/auth.service.ts` `LoginMethodsConfig.unpairedPasswordOnly?`.
2. `navigation/pairingGate.ts`: kapı = `required && status !== 'APPROVED' && !(status === 'PENDING' && unpairedPasswordLogin === true)`; `RootNavigator` yoklama aralığı.
3. `screens/Auth/UnpairedPasswordForm.tsx` (yeni; ≤300 satır, fonksiyon ≤80, renk `theme/tokens`, hedef ≥56dp) + `LoginScreen` en az ekleme (`unpairedOnly` → usersQuery kapalı, form çizilir, gönderim mevcut `submit(password, { id: '', username, fullName: username })`).

### Kabul testleri
- `src/navigation/pairingGate.test.ts` yeni kollar §10–§12 (S1–S3, eski backend). Negatif sonda: `=== true` muafiyeti PENDING şartsız yazılınca / muafiyet kaldırılınca kırmızı.
- `src/screens/Auth/UnpairedPasswordForm.test.tsx`: boşken gönder kapalı; doldurunca `onSubmit(username.trim(), password)`; kilit kipinde önden dolu kullanıcı adı; hata metni görünür; LoginScreen kaynağında `unpairedOnly` liste sorgusunu kapatır. Negatif sonda: trim/önden doldurma/enabled koşulu bozulunca kırmızı.
- `npx tsc --noEmit`, ilgili jest dosyaları, `npm run lint`.

### Eski backend / eski tablet
- Yeni tablet + eski backend: iki alan da `undefined` → kapı ve giriş ekranı bugünkü. `minVersion` gerekmez.
- Eski tablet + yeni backend: onay ekranında bekler (backend planı §5).

## İŞ 2 — Play kanalı varsayılan sunucu (E1) — ÖLÇÜLDÜ, KODLANMADI

### Ölçüm (2026-10-19, bu ağaç)
- **Tek derleme:** `mobil/app.config.js` yalnız tek ortak paketi derler; `TEKSERP_KANAL` görülürse derleme durur (eski kanal derlemesi `eski-kanal-son` etiketinde). `scripts/build-apk.mjs`: `--musteri` emekli argüman; ortak paket ERP adresi GÖMMEZ — `EXPO_PUBLIC_API_URL`/`--api-url` verilirse `ORTAK PAKET ERP ADRESİ GÖMMEZ` ile durur, derleme sonrası bundle'da adres bulunursa `ORTAK PAKETİN BUNDLE'INDA ERP ADRESİ VAR` ile durur.
- **Play = tek dağıtım yolu, tüm fabrikalar:** `surum-yayin.md` (ortak fabrika tableti yalnız Google Play üretim kanalından; tek kurulum yolu Play). `play-yayinla.mjs` internal → alpha → production'a AYNI baytı terfi ettirir; parça (track) başına ayrı derleme yok.
- **Kanal verisi:** `deploy/kanallar.json` eski kanal kaydıdır, BAYT-DONUK (`test_eski_kanal_donuk.mjs`); `deploy/dagitim.json` kapalı anahtar kümesi, "DAVRANIŞ TAŞIMAZ ve MÜŞTERİ TAŞIMAZ" (`check-dagitim.mjs`). Play derlemesini müşteri derlemesinden ayıran bir kanal/profil yok; `eas.json` profilleri kullanılmıyor (derleme yalnız `build-apk.mjs`).
- **Çalışma anı:** `store/baseUrlStore.autoUrlFrom` → ortak pakette boş → ilk ekran "Sunucuyu ekle" (`ServerSetupScreen`, mDNS + alt ağ taraması + elle adres/QR). Elle adres girişi ZATEN var ve kalıcı (`CUSTOM_URL_KEY`, SecureStore). `*.etkiliyazilim.com` adı internet kipidir (`INTERNET_PARENT_DOMAINS`): 443, sistem CA, kod yok — ama ekleme kullanıcı ONAYI ve sunucunun kurulum kimliğinin kaydı (`decideInternetPair`) ister; kaydı olmayan adres `secureAddressUsable` tarafından açılışta kullanılmaz.

### Sonuç
"Varsayılan yalnız Play kanalının derleme ayarında, müşteri kanalları değişmez" bugünkü düzende kurulamaz: Play paketi bütün fabrikalara giden TEK pakettir. Varsayılanı oraya gömmek her müşteri fabrikasındaki yeni tabletin ilk açılışta deneme sunucusuna bağlanması demektir; ayrıca iki çekirdek kuralı (ortak paket ERP adresi gömmez; `dagitim.json` davranış taşımaz) ve internet kipinin "insan onayı + kimlik kaydı" adımını deler. Kodlanmadı; karar kullanıcıya (bkz. dönüş raporu seçenekleri).

### Karar (kullanıcı, 2026-10-19): seçenek (a) — tek dokunuşlu "Deneme sunucusuna bağlan"
- Düğme "Sunucuyu ekle" ilk adımında (`ChooseStep`), QR ve elle adres kartlarının ALTINDA, nötr tonda; bütün tabletlerde görünür. Paket ERP adresi taşımaz.
- Adres tek kaynak `DEMO_SERVER_URL` (`mobil/src/lib/internet-tls.ts`), `INTERNET_PARENT_DOMAINS[0]`dan TÜRER — tırnaklı üst alan literal'i yine tek satırdır (`internet-tls.test.ts` bekçisi).
- Düğme elle adres yolunu koşar (`useServerPair.connectDemo` → `submitAddressText`): yoklama → `InternetConfirmStep` onayı → `decideInternetPair` → `completeInternetPairing` (kurulum kimliği kaydı + `CUSTOM_URL_KEY`). Yeni bağlantı yolu yok.
- **Derleme kapısı ölçümü:** `ortakBundleAdresleri` yalnız `/api` ile biten VE (IP | port | `.ts.net`) adresi gömülü sayar. `https://deneme.etkiliyazilim.com` (portsuz, `/api`siz) hiç eşleşmez; `…/api` biçimi bile yalnız "diğer (bilgi)" olur. İstisna gerekmez; sabit portlu ya da `/api`li yazılırsa kapı onu yakalar (`:443/api` → gömülü).
- Kabul: `ServerPairFlow.render.test.tsx` § deneme sunucusu düğmesi (5 test; onaysız tamamlama, boş adres alanı, değişen adres sondaları kırmızı).
