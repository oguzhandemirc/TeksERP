# Adım 1 — Mekanik Taban Özeti

Çalıştırma: 2026-08-09, `Teks-Erp/` dizininden. Ham çıktılar bu dizindeki `.out` / `.err` dosyalarında.
Bu özet, sonraki oturumların ham çıktıyı context'e almadan referans alabilmesi içindir.

## Ölçüm tabanı (git/wc ile ölçüldü, tahmin değil)

| Ölçü | Değer |
|---|---|
| `Teks-Erp/src` TS dosyası | 271 |
| `Teks-Erp/src` satır | 103.727 |
| `src/services` | 152 dosya / 77.067 satır |
| `src/routes` | 54 dosya / 13.791 satır |
| `src/controllers` | 22 dosya / 6.714 satır |
| `src/middlewares` | 7 dosya / 1.067 satır |
| `src/utils` | 7 dosya / 909 satır |
| `src/config` | 8 dosya / 1.372 satır |
| `src/constants` | 4 dosya / 745 satır |
| `src/lib` | 7 dosya / 581 satır |
| `src/jobs` | 4 dosya / 646 satır |
| `src/types` | 4 dosya / 185 satır |
| `src/app.ts` | 462 satır |
| `src/server.ts` | 188 satır |
| `prisma/schema.prisma` | 3.721 satır |
| Migration sayısı | 155 |
| `scripts/` (bekçi + araç) | 312 dosya / 68.884 satır |
| **Denetim kapsamı toplamı** (src + prisma + scripts) | **~176.332 satır** |

Not: Brief "~200.000 satır" diyor. Ölçülen 176.332. Aradaki fark muhtemelen `Electron/` ve `mobil/`
alt projelerinden geliyor; bunlar Express API denetiminin kapsamı DIŞINDA.

## Araç sonuçları

| Araç | Durum | Sonuç |
|---|---|---|
| `madge --circular` | Koştu | **14 circular dependency** |
| `ts-prune` | Koştu | 428 satır; "used in module" hariç **41 gerçek ölü export** |
| `depcheck` | Koştu | 1 kullanılmayan devDependency (`@faker-js/faker`); 1 eksik (`playwright-core`, sadece git-ignore'lu `_final.mjs` için) |
| `npm audit` | Koştu | **12 açık**: 0 critical, 4 high, 7 moderate, 1 low. 3'ü doğrudan bağımlılık |
| `knip` | **Yeniden koştu (config'li)** | **0 unused file · 19 unused export · 3 unused type · 1 unused devDependency** — kullanılabilir |
| `jscpd --min-lines 20` | Koştu | 50 klon, 1.691 yinelenen satır, **%1,63** — düşük |
| `eslint` | Koştu | **0 error, 0 warning** — ama aşağıdaki uyarıyı oku |
| `semgrep p/nodejs + p/owasp-top-ten` | Koştu (venv, npm paketi çalışmıyor) | **0 bulgu** — ama aşağıdaki uyarıyı oku |

### madge — 14 circular dependency

13'ü tek bir alt sistemde toplanıyor: **etiket/belge render** (`label.service.ts` ile
`services/helpers/label-*` arasında iki yönlü bağımlılık ağı; `label-field-values`,
`label-rawcode`, `label-html`, `label-renderer.registry`, `raster/*`).
14'üncü: `workorder.service.ts` <-> `workorder-batch-drop.service.ts`.
Sinyal: etiket alt sistemi modüler sınırını kaybetmiş. Ham liste: `madge-circular.out`.

### npm audit — 12 açık

Doğrudan bağımlılıklar: `morgan` (moderate), `prisma` (moderate), `uuid` (moderate).
Dolaylı: `brace-expansion`, `fast-uri`, `hono`, `js-yaml` (high); `@hono/node-server`,
`@prisma/dev`, `qs`, `valibot` (moderate); `body-parser` (low).
Hepsinde `fixAvailable: true`. `hono`/`@hono/node-server`/`valibot` muhtemelen `@prisma/dev`
üzerinden geliyor, yani üretim çalışma yolunda olmayabilir — DOĞRULANMADI, ŞÜPHELİ.

### ESLint — "0 bulgu" YANILTICIDIR

`eslint.config.mjs` bilinçli olarak minimal: yorumunda "bu config bir formatter değil, bir guardrail"
yazıyor. **Aktif kural sayısı: 2.**
1. `no-restricted-syntax` — tx client üzerinde `Promise.all`/`allSettled` yasağı.
2. `no-restricted-imports` — route/controller katmanında `lib/prisma` import yasağı.

KAPALI olanlar (denetim için kritik): `no-floating-promises`, `no-misused-promises`,
`require-await`, `no-explicit-any`, `no-unsafe-*`. Yani **lint katmanında async disiplini yok**.
Ayrıca 1 numaralı kural **isim tabanlıdır** (`Identifier[name='tx']`): transaction closure parametresi
`tx` dışında adlandırılmışsa kural sessizce kaçırır. Bu, denetimin doğrulaması gereken bir varsayımdır.

`tsconfig.json`: `strict: true` (iyi), `skipLibCheck: true`. `scripts/` ana tsconfig'in dışında,
ayrı `tsconfig.scripts.json` ile denetleniyor.

### semgrep — "0 bulgu" YANILTICIDIR

Tarama meşru: 271 dosya, ~%100 parse, 0 hata. Ancak yüklenen 561 kuraldan
**TypeScript'e uygulanabilen sadece 78'i** koştu (72 ts + 6 multilang).
`p/nodejs` kural setinin büyük kısmı JS/Express kalıplarına bakıyor ve bu kod tabanının
TS + Prisma + katmanlı servis yapısına denk gelmiyor.
Doğru okuma: "bu 78 desende eşleşme yok". "Güvenlik açığı yok" DEĞİLDİR.
semgrep ayrıca `semgrep login` ile daha fazla ücretsiz registry kuralı önerdi — hesap gerektirir,
karar kullanıcıya bırakıldı (bkz. PLAN.md "Kapsanmayan Alan").

### knip — YAPILANDIRILDI (2026-08-09), sonuç artık kullanılabilir

İlk koşum config'sizdi ve **çöp üretti**: 323 "unused file", 188 unused export, 97 unused type.
Sebep: knip entry point'leri bilmediği için `scripts/` altındaki 312 bekçiyi ve `prisma/seed*.ts`'i
"kullanılmıyor" sayıyordu.

`Teks-Erp/knip.json` yazıldı (entry: `src/server.ts` · `prisma.config.ts` · dört `prisma/seed*.ts` ·
`scripts/**/*.ts`; project: `src` + `prisma` + `scripts`; ignore: `dist`, `_e2e`, `scratch`,
`src/generated`). Bu bir araç ekleme değil, **mevcut aracın yapılandırılmasıdır**.

Yeniden koşum sonucu:

| Ölçü | Config'siz | **Config'li** |
|---|---|---|
| Unused file | 323 | **0** |
| Unused export | 188 | **19** |
| Unused exported type | 97 | **3** |
| Unused devDependency | 2 | **1** (`@types/bcryptjs`) |

**19 ölü export'un 12'si BLG (etiket/belge) alt sisteminde** — bağımsız olarak madge (14 döngünün
13'ü) ve jscpd (32 klon ucu) ile aynı yeri işaret ediyor. Üç aracın aynı modülde buluşması,
`BLG.mimari` hücresinin P0 gerekçesini güçlendiriyor.

Dikkat çekenler: `src/lib/string-validators.ts`'in iki fonksiyonu (`validateLongText`,
`validateHexColor`) hiç kullanılmıyor — tamlık eleştirisi bu dosyayı "hiç haritalanmadı"
diye işaretlemişti, knip de "hiç çağrılmıyor" diyor. `reports/_shared.ts`'te iki tarih
yardımcısı (`eachDay`, `ymdLocal`) ölü. `db-copy.service` ve `backup.service`'te dörder
getter export'u ölü.

Ham çıktı: `knip.out`. `ts-prune`'un 41 "gerçek ölü export"u ile knip'in 19'u **farklı kümeler**
(ts-prune tip export'larını ve dosya-içi kullanımı farklı sayıyor); denetimde ikisinin kesişimi
alınmalı, birleşimi değil.

### jscpd — düşük kopya oranı

%1,63 (1.691 / 103.482 satır). Yoğunlaştığı yerler: `workorder.service.ts` (11 klon),
`tambur.service.ts` (11), `subcontractor.service.ts` (9), `document-render/fason-ceki.html.ts` (8),
`document-render/fason-direct-ship.html.ts` (8), `inventory.service.ts` (5).
Belge render tarafındaki kopya, HTML şablonlarının doğası gereği kısmen meşru olabilir.

## Değişim sıklığı (en güvenilir hata yoğunluğu vekili)

Repo yaşı: ilk commit **2026-04-17**, yani 12 aylık pencere = tüm proje geçmişi.
Toplam commit (12 ay): **632**.

Dizin bazında dokunma sayısı (`src` içi):
`services` 893 · `routes` 436 · `controllers` 296 · `services/helpers` 244 ·
`services/document-render` 72 · `utils` 38 · `middlewares` 37 · `app.ts` 37 ·
`services/reports` 34 · `config` 25 · `server.ts` 14 · `lib` 14 · `jobs` 9 · `constants` 8

En çok değişen 20 dosya:

| Dokunma | Dosya |
|---|---|
| 69 | `services/workorder.service.ts` |
| 64 | `services/subcontractor.service.ts` |
| 64 | `services/inventory.service.ts` |
| 60 | `services/shipping.service.ts` |
| 59 | `services/tambur.service.ts` |
| 48 | `services/system-setting.service.ts` |
| 48 | `services/order.service.ts` |
| 42 | `services/label.service.ts` |
| 40 | `routes/feature-flag.routes.ts` |
| 37 | `app.ts` |
| 31 | `services/traveler-card.service.ts` |
| 31 | `routes/shipping.routes.ts` |
| 31 | `controllers/shipping.controller.ts` |
| 30 | `services/kursun-qc.service.ts` |
| 30 | `controllers/inventory.controller.ts` |
| 29 | `controllers/workorder.controller.ts` |
| 28 | `controllers/tambur.controller.ts` |
| 26 | `routes/inventory.routes.ts` |
| 25 | `services/label-template.service.ts` |
| 24 | `controllers/label.controller.ts` |

Tam liste: `churn-backend-src.txt`. Dizin özeti: `churn-backend-dirs.txt`. Repo geneli: `churn-repo.txt`.

## Boyut ve churn kesişimi

En büyük 10 service dosyası (satır) ve churn'leri:

| Satır | Dosya | Churn |
|---|---|---|
| 6.073 | `workorder.service.ts` | 69 |
| 6.055 | `subcontractor.service.ts` | 64 |
| 4.318 | `inventory.service.ts` | 64 |
| 3.476 | `shipping.service.ts` | 60 |
| 3.318 | `tambur.service.ts` | 59 |
| 2.839 | `system-setting.service.ts` | 48 |
| 2.819 | `order.service.ts` | 48 |
| 2.362 | `kursun-bypass.service.ts` | (churn listesinde ilk 40'ta yok) |
| 1.984 | `label.service.ts` | 42 |
| 1.656 | `kursun-qc.service.ts` | 30 |

Hem büyük hem sık değişen ilk yedi dosya, denetimin ağırlık merkezini belirler.

## Atlanan / başarısız araç

Yok. Sekiz aracın sekizi de koştu.
Tek işlem notu: `semgrep`in npm paketi çalıştırılabilir binary sağlamıyor
(`could not determine executable to run`); aynı araç scratchpad'de bir Python venv'ine
kurulup öyle koşturuldu. Araç değişmedi, kurulum yolu değişti.
