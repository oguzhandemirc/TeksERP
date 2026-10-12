---
paths:
  - "Electron/src/**"
---

**Electron paneli** — öz. Standardı baştan okuma; yalnız ilgili bölüm:
- `docs/standart/ELECTRON.md § 3` veri erişimi · § 4 süzme · § 5 hata · § 7 şema
- `docs/RECETELER.md § "Yeni Electron sayfası"`

- Veri yalnız `apiClient` kapısından; süzme sunucuda; tek hata toast'ı.
- İzin aynası `matchesPermission`; ekran izinsiz açılmaz.
- Zod şeması ↔ Prisma `VarChar` hizalı; istek gövdesine yeni alanı iki uçta ekle.
- Saat/gün `src/lib/factory-time.ts`ten; seçici doğrudan modal açar.
- Bitince `npm run typecheck` + `npm run lint` + `npx vitest run`.
