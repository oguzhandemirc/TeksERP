# TeksERP

[![CI](https://github.com/oguzhandemirc/TeksERP/actions/workflows/ci.yml/badge.svg)](https://github.com/oguzhandemirc/TeksERP/actions/workflows/ci.yml)

Tekstil fabrikası ERP sistemi (monorepo). Üç alt proje:

| Proje | Stack | Açıklama |
|---|---|---|
| `Teks-Erp/` | Express 5 + Prisma 7 + PostgreSQL | Backend API (port 4000) |
| `Electron/` | Electron 33 + React 19 + Vite | Yönetim paneli |
| `mobil/` | React Native + Expo 54 | Saha (Android tablet/telefon) |

Domain kuralları: kök ve alt proje `CLAUDE.md` dosyaları + `Teks-Erp/ARCHITECTURE.md`.

## Test & CI

Her push/PR'da GitHub Actions (`.github/workflows/ci.yml`) 3 projede **lint + tip kontrolü + test** koşar.

| Proje | Test komutu | Altyapı | Kapsam |
|---|---|---|---|
| Backend | `cd Teks-Erp && npm test` | server'sız entegrasyon (`scripts/test_*.ts` runner; PostgreSQL gerekir) | 38 dosya |
| Electron | `cd Electron && npm test` | Vitest + Testing Library (jsdom) | 51 test |
| mobil | `cd mobil && npm test` | jest-expo + RNTL | 24 test |

Tümünü tek komutta: **`bash run-tests.sh`** (tip kontrolü dahil: `bash run-tests.sh --tsc`).

- **Kullanıcı kabul testleri (manuel/fiziksel):** `TEST-SENARYOLARI.md` (UI + baskı + donanım — gerçek cihaz gerektirir).
- **Test altyapısı detayı:** `TEST-ALTYAPI-PLAN.md`.
- **Production migration:** `Teks-Erp/MIGRATION-DEPLOY.md`.

## Hızlı başlangıç (geliştirme)

```bash
# Backend
cd Teks-Erp && npm install && npm run prisma:generate && npx prisma migrate dev && npm run seed && npm run dev
# Electron
cd Electron && npm install && npm run dev
# mobil
cd mobil && npm install && npx expo run:android
```

Test kullanıcısı: `admin / 123123` (tam yetki).
