# TEST ALTYAPISI + EKSİK KAPATMA PLANI (2026-06-13)

Kullanıcı: "gerekli düzenlemeler için sektör standartlarını göz önünde bulundurarak plan yap.
tam yetki sende. test kütüphanelerinden faydalanabilirsin. acele etme. token biterse yenilenince
kaldığın yerden devam."

Durum: ⬜ bekliyor · 🔧 devam · ✅ bitti+doğrulandı · ⏭️ atlandı

Strateji = test piramidi: bol saf-birim + entegrasyon, az bileşen/E2E. Backend CLAUDE.md
"jest/vitest YOK" kuralı KORUNUR (scripts/test_*.ts sözleşmesi). Frontend için kullanıcı
test kütüphanelerini açıkça yetkilendirdi → Electron Vitest, mobil jest-expo (sektör standardı).

## FAZ 1 — Electron test altyapısı (Vitest + Testing Library) ✅
| İş | Durum |
|---|---|
| vitest@3 + jsdom@26 + @testing-library/react@16 + jest-dom@6 + user-event@14 + dom@10 kur | ✅ |
| vitest.config.ts (jsdom, alias @→src + @shared, setup) + package.json test/test:watch | ✅ |
| Saf util testleri: roll-name, query-builder, picker-loader, code-generator, station-colors | ✅ |
| auth: matchesPermission + hasAdminAccess + canEnterApp | ✅ |
| Bileşen/şema smoke: MachineHardware schema (zod), DispatchReceiptDocument render | ✅ |
| `npm run test` yeşil → 41 test / 9 dosya | ✅ |

## FAZ 2 — mobil test altyapısı (jest-expo + RNTL) ✅
| İş | Durum |
|---|---|
| jest-expo@54 (expo install) + jest@29 + RNTL@13 + react-test-renderer@19.1 + @types/jest kur | ✅ |
| jest.config.js (preset jest-expo, transformIgnore native modüller, setup) + package.json test/test:watch | ✅ |
| setup.ts: AsyncStorage resmi jest mock + expo-secure-store no-op mock | ✅ |
| Saf birim: queryBuilder, relativeTime, offline/barcode (TEKS barkod + uuid v4) | ✅ |
| Hook: usePermissions (RBAC has/wildcard/allowedScreens — act ile) | ✅ |
| `npm test` yeşil → 19 test / 5 dosya | ✅ |

## FAZ 3 — Backend: runner + eksik servis testleri ✅
| İş | Durum |
|---|---|
| scripts/run-all-tests.ts (her test_*.ts'i spawn, exit-kodu doğruluk kaynağı) + package.json "test" | ✅ |
| test_dashboard.ts (defect özeti + istasyon canlı durum raw SQL + canlı sayaç) 4/4 | ✅ |
| test_device_pairing.ts (kod üret/eşle/kullanılmış-ret/geçersiz-ret/unpair/pasif-makine) 7/7 | ✅ |
| test_permission_management.ts (grant/revoke/set/applyTemplate merge+replace/son-admin) 8/8 | ✅ |
| Tüm suite tek komutla yeşil → 38/38 dosya | ✅ |

## FAZ 4 — Operasyonel ✅
| İş | Durum |
|---|---|
| Seed: Makine Donanımı 3 örnek satır (seed'li makinelere; tsc temiz, dev'de görünür) | ✅ |
| `Teks-Erp/MIGRATION-DEPLOY.md` (deploy sırası + statement_timeout=0 + bu turun 5 migration tablosu) | ✅ |
| `run-tests.sh` kök script (3 proje npm test + opsiyonel --tsc) | ✅ |

## FAZ 5 — Kapanış ✅
Backend 38/38 dosya · Electron 41 test · mobil 19 test · 3 tsc temiz · hafıza güncellendi · cron silindi.

## FAZ 7 — Genişletme (kullanıcı: "hepsini yap")
### 7a — Daha fazla bileşen testi (Electron + mobil) ✅
| İş | Durum |
|---|---|
| SackSearch: RollLocateCard (3 konum) + SackResultCard genişlet (lazy içerik) — 5 test | ✅ |
| MachineHardware: buildMachineHardwarePayload ''→null saf fonksiyona çıkarıldı + 2 test | ✅ |
| mobil: Pager bileşeni (renderWithPaper) — 5 test | ✅ |
### 7b — Playwright E2E (Electron) ✅
| İş | Durum |
|---|---|
| @playwright/test kur + playwright.config (testDir e2e, browser project YOK) | ✅ |
| e2e/login.smoke: `electron.launch(['.'])` → firstWindow → "TeksERP" + "ör. admin" görünür | ✅ (yerelde 15.5s geçti) |
| npm run e2e (build+test) + e2e:run scriptleri + eslint e2e TS-parser kapsamı | ✅ |
| CI'a e2e job (xvfb-run + playwright install-deps + continue-on-error) | ✅ |
### 7c — CI lint + durum rozeti ✅
| İş | Durum |
|---|---|
| vitest.config __dirname→import.meta (Electron lint 0 hata) | ✅ |
| mobil eslint kurulumu (expo lint → eslint9+eslint-config-expo, no-unescaped-entities kapalı, test global'leri) → exit 0 | ✅ |
| CI'a lint adımları (3 job: npm run lint, hepsi exit 0 blocking) | ✅ |
| Kök README.md + CI durum rozeti (oguzhandemirc/TeksERP actions) | ✅ |

## Sözleşme
Her faz: kur→çalıştığını trivial testle DOĞRULA→gerçek testleri yaz→yeşil→tabloda ✅→günlük.
Yarıda kalırsa tablodan kaldığın yeri bul. Paket sürümleri projedekiyle uyumlu seç (React 19,
Vite 7, Expo 54). Mevcut davranışı bozma; testler mevcut koda uyar (kodu teste uydurma — gerçek
bug bulursan ayrı not düş).

## Günlük
### FAZ 1 (2026-06-13) — Electron Vitest TAMAM
- Kurulum: vitest@3.2 + jsdom@26 + @testing-library/react@16 (+jest-dom@6, user-event@14, dom@10). `vitest.config.ts` (jsdom env, @/@shared alias, setup `src/test/setup.ts` → jest-dom matcher + afterEach cleanup). package.json `test`=vitest run, `test:watch`=vitest.
- Testler (9 dosya / 41 test): `types/auth` (matchesPermission/hasAdminAccess/canEnterApp — admin:users TÜM admin'i açmaz dahil), `lib/roll-name`, `lib/code-generator`, `lib/query-builder` (filter[]/cursor), `lib/station-colors` (toneFor/kind), `lib/picker-loader` (cap aşımı HATA + params), `MachineHardware/schema` (zod), `AccountingDispatch/DispatchReceiptDocument` (3-bölüm render). Hepsi yeşil; `tsc --noEmit` temiz.

### FAZ 2 (2026-06-13) — mobil jest-expo TAMAM
- Kurulum: jest-expo@54.0.17 (expo install — SDK uyumlu) + jest@29 + RNTL@13 + react-test-renderer@19.1 + @types/jest. `jest.config.js` (preset jest-expo, testMatch *.test, transformIgnorePatterns'a kullanılan native modüller). `src/test/setup.ts`: AsyncStorage resmi jest mock + expo-secure-store no-op (store import zinciri native köprü çekmesin).
- RNTL v13 notu: `extend-expect` kaldırıldı, matcher'lar built-in.
- Testler (5 dosya / 19 test): `utils/queryBuilder`, `utils/relativeTime`, `offline/barcode` (TEKS barkod regex + uuid v4 regex), `hooks/usePermission` (RBAC has/mobile:*/admin:*/allowedScreens — renderHook+act). Hepsi yeşil; `tsc --noEmit` temiz.

### FAZ 3 (2026-06-13) — Backend runner + eksik testler TAMAM
- `scripts/run-all-tests.ts`: tüm test_*.ts'i SIRAYLA spawn (`npx tsx`), **exit kodu = doğruluk kaynağı** (özet satırı formatları farklı: "Sonuç:", "SONUÇ: ... kaldı", "N/T geçti" — hepsi parse edilir ama ok=exit0). package.json `test`=tsx scripts/run-all-tests.ts. Sonuç: **38/38 dosya yeşil ~287s**.
- Yeni eksik-servis testleri: `test_dashboard` 4/4 (defect özeti + istasyon canlı raw SQL + canlı openCount sayacı), `test_device_pairing` 7/7 (kod üret→eşle→kullanılmış/geçersiz ret→unpair→pasif-makine ret), `test_permission_management` 8/8 (grant idempotent/revoke/setUserPermissions hedef-state/geçersiz-id 400/applyTemplate merge+replace). Backend CLAUDE.md "jest/vitest YOK" kuralı korundu.

### FAZ 4 (2026-06-13) — Operasyonel TAMAM
- Seed: `prisma/seed.ts`'e 3 makine donanım config örneği (KK1/KK2/Tambur makinelerine; printer IP/MAC + RS232 MAC + regex desen). tsc temiz; `npm run seed` ile dev'de gelir (production'da operatör girer).
- `Teks-Erp/MIGRATION-DEPLOY.md`: production'a `prisma migrate deploy` sırası + index-ağır migration vardiya-dışı + statement_timeout=0 uyarısı + bu turun 5 migration'ının tablo/risk listesi.
- `run-tests.sh` (kök): 3 projede `npm test` sıralı + `--tsc` ile 3 tip kontrolü; ilk hatada exit≠0.

### FAZ 6 (2026-06-13) — Kullanıcı testleri + GitHub Actions (ek istek)
- **GitHub Actions** `.github/workflows/ci.yml` (push/PR/manuel): 3 job — **backend** (postgres:16 service + `prisma generate` + `migrate deploy` + `npm run seed` + tsc + `npm test`), **electron** (npm ci + tsc + vitest, ELECTRON_SKIP_BINARY_DOWNLOAD=1), **mobile** (npm ci + tsc + jest). Node 22, npm cache per-proje lockfile. YAML `yaml` parser ile doğrulandı.
- Backend'e **`tsx` devDep eklendi** — `npm test` (script `tsx ...`) ve runner'ın spawn ettiği `npx tsx` CI'da deterministik resolve etsin (eskiden npx fetch'e bağlıydı). `npm test` yereldede 38/38 doğrulandı.
- **Kullanıcı kabul testleri** otomatikleştirilemez (gerçek UI/cihaz) → `TEST-SENARYOLARI.md`: 15 bölüm adım-adım UAT senaryosu (öncelik 🔴/🟡/🟢) — yeni 23 saha kalemi + makine donanımı + #15 fiziksel/donanım/baskı (zorunlu manuel) bölümü.
- **Ekstra otomatik bileşen testi:** `RetargetOrdersDialog.test.tsx` (#7) — Radix dialog + react-query + user-event tıklama akışı; servisler vi.mock'lu, `src/test/render.tsx` (QueryClientProvider sarmalayıcı) eklendi → gelecek ekran testleri için kalıp. Electron toplam **44 test/10 dosya**.

### FAZ 5 (2026-06-13) — Kapanış
- Doğrulama: backend 38/38 dosya · Electron 44 test/10 dosya · mobil 19 test/5 dosya · 3 tsc temiz · CI yaml geçerli.
- **Kazanım:** Frontend'de 0 → toplam 60 frontend testi (Electron 41 + mobil 19) + backend 38 dosyalık tek-komut runner. Yapısal "frontend hiç test yok" boşluğu kapandı.
- **Bilinçli sınır:** E2E (Playwright/Detox) ve fiziksel donanım/baskı testleri kapsam dışı (gerçek cihaz gerekir) — test piramidinin tepesi sahada manuel doğrulanır.
