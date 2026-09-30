# satici/web — TeksERP satıcı portalı web arayüzü

> Kök `CLAUDE.md` çekirdeği burada da AYNEN geçerlidir. Alan kuralları: `docs/kurallar/lisans.md` (§ Satıcı portalı web). Sunucu sözleşmesi: `satici/sunucu/CLAUDE.md` (portal JSON API) ve kod (`src/http/portal-routes.ts` · `dealer-routes.ts` · `portal-http.ts`). Plan: Kod Koruma + Lisanslama, Faz 1f.

## Amaç ve yapı

Satıcı sunucusunun portal JSON API'sine arayüz. Tek kod tabanından **iki ayrı derleme**:

| Uygulama | Giriş | Derleme | Sunulduğu yer | API |
|---|---|---|---|---|
| Satıcı arayüzü | `portal.html` → `src/portal/` | `npm run build:portal` → `dist/portal` | tailnet dinleyicisi `/portal` (tailnet kapısının arkasında) | `/portal/api` |
| Bayi arayüzü | `bayi.html` → `src/bayi/` | `npm run build:bayi` → `dist/bayi` | genel dinleyici `/bayi` | `/bayi/api` |

- `src/shared/` ortak katmandır ve hiçbir uygulamaya bağımlı değildir; **bayi paketi satıcı kodunu TAŞIMAZ** (bekçi `src/test/app-isolation.test.ts`).
- Çıktıyı satıcı sunucusu API ile **AYNI kökenden** sunar (`satici/sunucu/src/http/web-static.ts`, `PORTAL_WEB_DIZINI` varsayılan `../web/dist`): çerez yolları (`/portal` · `/bayi`, httpOnly + SameSite=Strict) korunur, CORS yok. Derleme yoksa `/portal` ve `/bayi` 404 döner, API çalışır.
- CSP `'self'`: satır içi betik/stil YOK (görünüm `src/shared/styles.css`, `style=` özniteliği yazılmaz).
- Paketler Electron panelinin sürümleriyle AYNI (React 19 · react-router-dom 7 · TanStack Query 5 · qrcode.react · vitest · Testing Library · ESLint); yeni paket TÜRÜ eklenmez.

## Kurallar

- **Karar sunucudadır, arayüz yalnız GİZLER.** İzin tablosu (`shared/permissions.ts`), ağır yaptırım yüklemi (`shared/sanctions.ts`), tavan sınırları, kanal/sürüm desenleri sunucunun tek kaynağının KOPYASIDIR ve `src/test/mirrors.test.ts` sunucu KAYNAĞINI metin olarak okuyup birebir ölçer; arayüzün çağırdığı her uç (yöntem + yol) sunucunun rota tablosunda aranır. Yol LİTERAL yazılır (`api.post(\`/kurulumlar/${id}/iptal\`)`), değişkenden gelen yol ölçülemez → kırmızı.
- **İdempotency:** her yazma `useWrite` (`shared/attempt.ts`) ile gider; `clientToken` MANTIKSAL DENEME başına bir kez üretilir, yalnız belirsiz hatada (ağ · 5xx · 409 `TEKRAR_DENEYIN`) yapışır, başarı ya da kesin 4xx'te bırakılır. Form/pencere ömrü = deneme.
- **Hata kodu `details.code`** (`ApiError.code`); kullanıcıya sunucunun Türkçe iletisi gösterilir. 401 `OTURUM_YOK` → önbellek temizlenir, giriş ekranı.
- **Bir kez gösterilen sır** (etkinleştirme kodu · TOTP sırrı/QR) yalnız canlı yanıtta ve bileşen durumunda yaşar; sorgu önbelleğine, web deposuna (ESLint yasağı), URL'ye yazılmaz. Tekrar yanıtı (`…Gosterilemez: true`) "gösterilemez" der.
- **Giriş:** kullanıcı adı + parola + TOTP TEK adım (TOTP'siz oturum yok). TOTP kurulumu hesabı AÇAN ya da SIFIRLAYAN yöneticinin ekranında QR ile bir kez; kurtarma kodu YOK (kayıpta yönetici sıfırlar, yönetici yoksa sunucu CLI'ı `scripts/portal-kullanici.ts`).
- **Yıkıcı / deftere yazan eylem** `shared/ConfirmAction.tsx` ile: etkilenen kaydı ADIYLA gösterir, sebep ister (sunucuda zorunlu). **Ağır yaptırım** (K4 · K5 · geri sayımı 7 günden kısa K3 — planlı eylem ve taksit kısıtlama günü dahil) yalnız yöneticiye görünür ve kurulumun lisans numarası AYNEN yazılarak (`onay`) gider; K4/K5 `/agir-yaptirim`, K3 `/yaptirim` ucundan.
- **Dağıtım ekranları (Faz 3d):** Kurulum → İlk kurulum sekmesi · Dosyalar · Sürümler. `/d` · `/y` bağlantı adresi BİR KEZ gösterilir (`TokenSecretModal`; sunucu `GENEL_KOK_ADRESI` yoksa yalnız yol); giden dosya parçalı yüklenir (`portal/distribution/upload.ts`, artımlı SHA-256, aynı dosya yeniden seçilince aynı işlem kimliği → oturum SÜRER); ham uçlar (`/portal/api/ham/…`) JSON tablosunun dışında olduğundan ayna testi onları sunucunun `distribution-raw.ts` yönlendiricisinde ayrıca arar.
- **Bildirimler:** kanal durumu ve son bildirimler salt okunur (`bildirim:oku`); kanal sırları arayüze ve satıcıya GELMEZ (yan konteynerde). Deneme bildirimi yalnız `bildirim:yonet` (yönetici), işlem kimliğiyle giden kutusuna yazar; olay/kanal/durum ekran adları sunucu kataloğunun aynasıdır (`mirrors.test.ts`).
- Kurulum fabrikanın `installationId`'siyle açılır; kanal yalnız KAYITLI kanaldan seçilir (satıcıda `/kanallar`, bayide tavanın kanalları).
- Tanımlayıcılar İngilizce; tel/şema anahtarları, kod değerleri ve kullanıcı metinleri Türkçe (i18n yok).

## Komutlar

```bash
cd satici/web
npm ci
npm run dev:portal      # vekil → satıcı sunucusu tailnet dinleyicisi (SATICI_TAILNET_URL, varsayılan 127.0.0.1:4611)
npm run dev:bayi        # vekil → genel dinleyici (SATICI_GENEL_URL, varsayılan 127.0.0.1:4610)
npm run build           # dist/portal + dist/bayi (satıcı sunucusu bunları sunar)
node ../../scripts/agir-is.mjs -- npm run typecheck:plain
node ../../scripts/agir-is.mjs -- npm run lint
node ../../scripts/agir-is.mjs -- npx vitest run
```

Commit kapısının beşinci projesidir (tip + lint + vitest; `scripts/hooks/lib/staged.mjs`), CI'da `satici-web` job'ı (tip + lint + kapı kapsamı + vitest + derleme). Bekçiler ve ne ölçtükleri: `Teks-Erp/docs/BEKCI-HARITASI.md` § lisans.
