# TeksERP

[![CI](https://github.com/oguzhandemirc/TeksERP/actions/workflows/ci.yml/badge.svg)](https://github.com/oguzhandemirc/TeksERP/actions/workflows/ci.yml)

Tekstil fabrikası ERP sistemi (monorepo). Üç alt proje:

| Proje | Stack | Açıklama |
|---|---|---|
| `Teks-Erp/` | Express 5 + Prisma 7 + PostgreSQL | Backend API (port 4000) |
| `Electron/` | Electron 42 + React 19 + Vite | Yönetim paneli |
| `mobil/` | React Native + Expo 54 | Saha (Android tablet/telefon) |

Domain kuralları: kök ve alt proje `CLAUDE.md` dosyaları + `Teks-Erp/ARCHITECTURE.md`.

## Test & CI

Her push/PR'da GitHub Actions (`.github/workflows/ci.yml`) 3 projede **lint + tip kontrolü + test** koşar.

| Proje | Test komutu | Altyapı | Kapsam |
|---|---|---|---|
| Backend | `cd Teks-Erp && npm test` | server'sız entegrasyon (`scripts/test_*.ts` runner; PostgreSQL gerekir) | 453 bekçi (kanonik: `ls Teks-Erp/scripts/test_*.ts`) |
| Electron | `cd Electron && npm test` | Vitest + Testing Library (jsdom) | 208 dosya |
| mobil | `cd mobil && npm test` | jest-expo + RNTL | 84 dosya · alan→bekçi haritası `Teks-Erp/docs/BEKCI-HARITASI.md` |

Tümünü tek komutta: **`bash run-tests.sh`** (tip kontrolü dahil: `bash run-tests.sh --tsc`).

- **Kullanıcı kabul testleri (manuel/fiziksel):** `docs/qa/TEST-SENARYOLARI.md` (UI + baskı + donanım — gerçek cihaz gerektirir).
- **Production migration:** `Teks-Erp/MIGRATION-DEPLOY.md`.
- **Doküman haritası:** kanonik tasarım `docs/design/`, deploy/runbook `docs/ops/`, arşiv (tarihsel) `docs/history/`.

## Hızlı başlangıç (geliştirme)

```bash
# Backend
cd Teks-Erp && npm install && npm run prisma:generate && npm run prisma:migrate   # migrate deploy — `migrate dev` DEFERRABLE FK'ları düşürür, kullanma && npm run seed && npm run dev
# Electron
cd Electron && npm install && npm run dev
# mobil
cd mobil && npm install && npx expo run:android
```

Test kullanıcısı: `admin / 123123` (tam yetki).
