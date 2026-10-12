---
paths:
  - "Teks-Erp/src/{app,server}.ts"
  - "Teks-Erp/src/middlewares/**"
  - "{Teks-Erp,Electron,mobil}/src/**/*{audit,Audit}*"
---

**Genel · konvansiyon · audit · süreç** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/genel.md § "Ortak"`
- `docs/kurallar/genel.md § "Backend"`

- Her CUD'u `AuditService.log()` ile yaz (tx DIŞINDA, best-effort); muafiyet `AUDIT_EXEMPT_MODELS`te beyanlı.
- Audit'ten karar, sayı, durum ya da join türetme; yalnız insana gösterilen ayak izidir.
- Künye başlığı (`X-Client-*`) hiçbir kapıya girmez; `CLIENT_IP_HEADER` yalnız beyanlı vekilde.
- Backend tek process: `pkill -f tsx` yok, ikinci Node süreci yok.
- Test DB'sini yalnız `node scripts/test-db.mjs ac|sil|liste` ile aç/sil; ana ağacın `.env`ine karşı bekçi koşma.
- Bitince alan bekçilerini koş (`/bekci-kos genel`; liste `docs/kurallar/genel.md § "Bekçiler"`); yeni karar → `/karar-notu`.
