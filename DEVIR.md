# DEVİR — LAN TLS (plan 6.1 · §C-2) — dal `gece/lan-tls`, worktree `Teks-Erp-wt/lan-tls`

Ortam: DB `tekserp_tls_test` (Docker PG 55433, seed + fixtures yüklü); `Teks-Erp/.env` worktree'nin kendi dosyası (git-ignore). Electron ve mobil `npm ci --ignore-scripts` yapıldı (yalnız tip/test). PUSH YOK.

## Yapılanlar
- `f46fca44e` tasarım notu `docs/design/LAN-TLS.md`.
- `55d86bd25` D2 backend: `Teks-Erp/src/lib/lan-tls/*`, kimlik ucunda `tls`, mDNS `tp`, bekçiler `test_lan_tls` + `test_lan_tls_http` + `test_discovery_identity`.
- `543470f32` D3a panel: doğrulama kancası, https probu, sabitleme IPC'si, sabit varken HTTP'ye düşüş yok.
- `46285f01c` tasarım §5: `off`a dönüşte sabitli istemci bağlanamaz, sabit elle kaldırılır; `dual`a dönüş sorunsuz.
- `9cfbb9f5c` D3b panel arayüzü: `src/components/settings/LanTlsSection.tsx` (Sunucu Adresi diyaloğunda; döngü adresinde doğrudan, başka adreste "Kodlar birebir aynı" onayı; ilan ≠ el sıkışma → teklif yok; kaldırma onaylı → aynı sunucunun son http adresi), `src/lib/lan-tls-ui.ts` (saf), `src/pages/Devices/TabletTlsQrButton.tsx` (yalnız panel https + sabitliyken), `ServerNotFoundPanel` `tlsBlocked` uyarısı. Bekçi `src/test/lan-tls-arayuz.test.tsx` (11).
- `2165534c0` D4 tablet JS: `mobil/src/lib/lan-tls.ts` (Electron ile metin-ikiz işlevler + `decideQrPin` + `applyTlsRoute`), `mobil/src/services/lanTlsPins.ts` (secure-store; native `TeksErpLanTls.setPins` iletimi), `mobil/src/components/LanTlsCard.tsx` (API Sunucusu ekranı; native yokken ve sabit yokken GÖRÜNMEZ), keşifte `tls` ilanı + sabitli aday https'e yükselir/engellenir, `ServerDiscoveryList` engel sebebi. Bekçiler `lan-tls.test.ts` (23, ikiz kıyas dahil) + `LanTlsCard.render.test.tsx` (3).
- `b4e86acd5` D6 (kısmen) durum sayfası: kod yalnız döngü adresinden açılınca; `test_lan_tls` §6.

## Kalan adımlar
1. **D5 tablet native zorlama — KULLANICI ONAYI GEREKİR** (yeni npm paketi yok, native kod + yeni APK; OTA ile gitmez). Plan:
   - Depo içi Expo config eklentisi `mobil/plugins/with-lan-tls.js` (`withMainApplication` + `withDangerousMod`): Kotlin dosyalarını `android/app/src/main/java/<paket>/lantls/` altına yazar, `MainApplication.onCreate`te İLK istekten önce `OkHttpClientProvider.setOkHttpClientFactory(LanTlsOkHttpFactory)`.
   - Kotlin: `X509TrustManager` — sunucu sertifikası DER SHA-256'sı sabitteyse kabul, değilse sistemin varsayılan TrustManager'ına devret (dış https/CA aynen); `HostnameVerifier` — sabitli sertifikada IP adı kabul, değilse varsayılan. Sabitler native `SharedPreferences`ta (parmak izi gizli değil); JS `TeksErpLanTls.setPins(json)` ile yazar (sözleşme `lanTlsPins.ts`te hazır) ve açılışta native kendi kopyasından okur.
   - JS eşi: açılışta `setPins(getTlsPins())` eşitlemesi; `serverIdentity.ts`/`probeServer` şemayı (https) tanısın (bugün `http://` kurar); `expo-file-system` indirmesi ve görsel yükleyicinin OkHttp istemcisi kapsamda mı ölçülsün.
   - Bekçi: eklenti çıktısı için jest (üretilen Kotlin/MainApplication metni), parmak izi mantığı için saf JVM testi ya da cihazda manuel prova; `usesCleartextTraffic` `dual` boyunca açık.
2. D6 kalan: kurulum sihirbazı son sayfası + `kur.ps1` sonu parmak izini (4'lü gruplar) ve `http://localhost:<PORT>/` adresini basar.
3. D7 sertifika yenileme (sonraki parmak izi sabitli kanaldan önceden dağıtılır).

## Koşulacak testler (hepsi bu turda yeşil)
`cd Teks-Erp && npx tsx scripts/test_lan_tls.ts` (46) · `npx tsx scripts/test_discovery_identity.ts` (20) · dual uçtan uca `LAN_TLS_MODE=dual LAN_TLS_PORT=45443 LAN_TLS_DIR=<geçici> DATABASE_URL=…/tekserp_tls_test node ../scripts/agir-is.mjs -- npx tsx scripts/bekci-http.ts lan_tls_http` (7) · `cd Electron && npx vitest run src/test/lan-tls.test.ts src/test/lan-tls-arayuz.test.tsx src/test/discovery-ipc-contract.test.ts` · `cd mobil && npx jest src/lib/lan-tls.test.ts src/components/LanTlsCard.render.test.tsx discovery` · `node scripts/check-lint-baseline.mjs --proje=electron|mobil`.

## Kararlar (kullanıcıya)
- Yeni kurulumun varsayılan kipi `off` mu `dual` mı (kod varsayılanı `off`).
- D5 için depo içi native modül onayı.
