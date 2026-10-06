# DEVİR — LAN TLS (plan 6.1 · §C-2) — dal `gece/lan-tls`, worktree `Teks-Erp-wt/lan-tls`

Ortam: DB `tekserp_tls_test` (Docker PG 55433, seed + fixtures yüklü); `Teks-Erp/.env` worktree'nin kendi dosyası (git-ignore). Electron `npm ci --ignore-scripts` yapıldı (Electron ikili dosyası yok, yalnız tip/vitest). PUSH YOK.

## Yapılanlar
- `f46fca44e` tasarım notu `docs/design/LAN-TLS.md` (tehdit, ölçüm: keşif yanıtı İMZASIZ, sertifika yaşam döngüsü, parmak izi kökleri: loopback / göz ile karşılaştırma / panel QR'ı, kipler, istemci sabitleme, dilimler).
- `55d86bd25` D2 backend: `Teks-Erp/src/lib/lan-tls/{x509,config,store,listener}.ts`, `server.ts` bağlantısı, kimlik ucunda `tls`, mDNS TXT `tp`, bekçiler `test_lan_tls` (43) + `test_lan_tls_http` (dual sunucuyla 7/7) + `test_discovery_identity`; kural satırı `docs/kurallar/kesif-cihaz.md`, arşiv `docs/history/arsiv/2026-10.md` §2026-10-06 LAN TLS.
- D3a panel (bu devirle commit'lendi, sha `git log -1`): `Electron/shared/lan-tls.ts` (saf kararlar + QR), `electron/security/lan-tls-pin.ts` (setCertificateVerifyProc: sabitli → 0, gerisi → -3), `electron/discovery/probe.ts` (https probu, gözlenen parmak izi), `electron/discovery/tls-candidate.ts`, `electron/ipc/lan-tls.ipc.ts` (`discovery:tlsObserve/tlsPin/tlsUnpin/tlsPins`), `discovery.ipc.ts` (sabit varken HTTP'ye düşüş yok, `tlsBlocked`, kayıtlı http → https yükseltme `applied.reason:"tls"`), `MAIN_ONLY_KEYS` + `config.serverTlsPin`. Bekçi `src/test/lan-tls.test.ts` (22; 4 negatif sonda kırmızı verdi, geri alındı). Tüm Electron vitest 420 dosya yeşil (D3a öncesi tam koşum; sonra hedefli).

## Kalan adımlar (sırayla)
1. D3b panel arayüzü: `src/components/settings/ApiEndpointDialog.tsx`te "Şifreli bağlantıya geç" — `window.api.discovery.tlsObserve(url)` → parmak izini `formatFingerprintGroups` ile göster; loopback adreste `via:"loopback"`, değilse kullanıcı "kodlar aynı" onayıyla `via:"confirmed"` → `tlsPin` → dönen https adresini `setStoredApiBaseUrl` + `applyApiBaseUrl`. "Şifreli bağlantıyı kaldır" (`tlsUnpin`, onaylı). `DiscoveryState.tlsBlocked`i ServerNotFoundPanel'de göster. Cihazlar sayfasında (yalnız panel https + sabitliyken) `qrcode.react` ile `buildTlsQr(iid, advert)`.
2. D4 tablet JS: QR okuma (`parseTlsQr` ikizi mobilde; Electron'u import edemez → İKİZ blok + metin kıyas testi), pin deposu (expo-secure-store), keşifte sabit varken HTTP'ye düşmeme.
3. D5 tablet native zorlama — **ONAY GEREKİR**: OkHttp'a parmak izi denetleyen TrustManager (depo içi Expo config eklentisi + Kotlin; yeni npm paketi yok ama native kod, yeni APK). Hazır paketler (CertificatePinner) kendinden imzalıda çalışmaz.
4. D6 durum sayfası (`Teks-Erp/public/status.js`: parmak izi + QR, loopback'ten açılınca) + kurulum sihirbazı/`kur.ps1` son sayfası.
5. D7 sertifika yenileme (sonraki parmak izi sabitli kanaldan).
6. Geri dönüş notu: `dual`a dönüş sorunsuz; `off`a dönüşte sabitli istemciler bağlanamaz (tasarım gereği) → `tlsUnpin` gerekir; tasarım §5'e bu cümle eklenmeli.

## Koşulacak testler
`cd Teks-Erp && npx tsx scripts/test_lan_tls.ts && npx tsx scripts/test_discovery_identity.ts` · dual uçtan uca: `LAN_TLS_MODE=dual LAN_TLS_PORT=45443 LAN_TLS_DIR=<geçici> DATABASE_URL=…/tekserp_tls_test node ../scripts/agir-is.mjs -- npx tsx scripts/bekci-http.ts lan_tls_http` · `cd Electron && npx vitest run src/test/lan-tls.test.ts src/test/discovery-ipc-contract.test.ts src/test/secure-store-core.test.ts` · `node scripts/check-lint-baseline.mjs --proje=electron`.

## Kararlar (kullanıcıya)
- Yeni kurulumun varsayılan kipi `off` mu `dual` mı (kod varsayılanı `off`).
- D5 için depo içi native modül onayı.
