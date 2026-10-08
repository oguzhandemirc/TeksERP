# DEVİR — gl2b (güncelleyici sağlamlık L2b, sözleşme 5 uçları)

Dal `gece/gl2b` (origin/main `ecad5e133`ten). Commit: `1329face3` (iş) + bu not.

## Yapılan (1329face3)
- Protokol `Teks-Erp/src/lib/license/protocol/indirme.ts` (+ satıcı/patron aynası bayt-eşit): `DOWNLOAD_PRODUCTS` += `backend-oci`; `DOWNLOAD_PRODUCTS_BY_PLATFORM` (Windows aynen electron·mobil·backend; Linux/OCI electron·mobil·backend-oci); `downloadPlatformOf(ortam)` (yalnız linux + konteyner:true → OCI); `backendDownloadPrefix`. `guncelleme.ts` `RELEASE_PRODUCT_DIRS` `satisfies Record<UpdatePlatform, DownloadProduct>`.
- Satıcı `lease.service.ts downloadTokens(..., ortam = installation.sonOrtam)`; `renewal.service.ts` iki çağrı `g.telemetry?.ortam ?? inst.sonOrtam`. Şema değişmedi → GÖÇ YOK.
- Backend: `updater-ipc.ts` `runningInContainer` + `ownUpdatePlatform`; `update-intent.service.ts` / `update-status.service.ts` öneki `backendDownloadPrefix(kanal, platform)`; `license-wire.helper.ts` konteyner ölçümü ortak fonksiyondan; route OpenAPI enum.
- Worker `deploy/guncelleme-sunucusu/worker/indirme-kapisi.js` `URUN_DIZINLERI` += backend-oci (Cloudflare'e DAĞITILMADI). `scripts/lib/yayin-okuma.mjs` regex backend-oci. `scripts/lib/dagitim.mjs` `INDIRME_DIZINLERI` + `check-dagitim.mjs` §3/N19.
- Belgeler: GUNCELLEYICI.md §16 madde 7 (eski istemci + sıra) ve eşleme cümlesi (TEKSERP_GUNCELLEME_DIZINI Linux üretim), SAGLAMLIK §1.3/§7 tablo, INDIRME-KAPISI-WORKER.md, lisans.md (2 satır güncel + 1 yeni kural + dizin satırı), arşiv `docs/history/arsiv/2026-10.md` sonu.

## Testler (yeşil)
test_indirme_kapisi 350/0 · test_guncelleme_protokol 197/0 · test_guncelleme_durumu 93/0 · test_lisans_protokol_aynasi 7/0 · test_lisans_yoklama_allowlist 27/0 · test_indirme_belirteci_ucu 21/0 · test_indirme_grup 12/0 · test_guncelleme_onay 61/0 · test_lisans_motoru 219/0 · check-dagitim yeşil + --sonda 59/0 · satıcı: guncelleme_politikasi 34/0 · bulut_kira_alanlari 28/0 · etkinlestirme 43/0 · ara_imzaci 52/0 · yaptirim_kira 24/0 · guncelleme_grubu 17/0 · kira_zinciri 70/0 · donanim_bildirimi 21/0 · tasima_dr 45/0 · tsc (backend, backend scripts, satıcı, satıcı scripts) temiz; commit kapısı yeşil.
Negatif sondalar (geri alındı): Worker'dan backend-oci → 12 ❌ (belirteçsiz backend-oci 200) + check-dagitim KIRMIZI · satıcı eski map → 4 ❌ · bayat ortam → 2 ❌ · eski yayın okuyucusu → test çöker ("sözleşmeye uymuyor") · niyet eski önek → 2 ❌.

## Kalan (sırayla)
1. `Teks-Erp/docs/BEKCI-HARITASI.md` test_indirme_kapisi satırına §11 + L2b sonda kaydı; test_guncelleme_durumu §9 ve satıcı §2b1–§2b3 satırları (yalnız belge).
2. İsteğe bağlı: satıcı `npm test` tam koşusu (DB `tekserp_l2b_satici_test` silindi — yeniden: createdb + `npx prisma migrate deploy`; ilk_sema `public`e yazdığı için backend DB'siyle paylaşılamaz).
3. Açık (L3): indirme kökeni nginx `.tar` değişmez listesinde yok.
4. İniş (kullanıcı onayıyla): satıcı VDS + yayın makinesi aynı commit'te → Worker ilk Linux yayınından ÖNCE → backend.
