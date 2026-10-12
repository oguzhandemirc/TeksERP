---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{roll-cancel,RollCancel,RollEdit,manualAdjust,manual-adjust,scrap,Scrap,relabel,restore,variance,Variance}*"
---

**Top düzeltme · iptal · fire · geri alma** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/top-duzeltme.md § "Ortak"`
- `docs/kurallar/top-duzeltme.md § "Backend"`

- Silme yalnız soft (`isActive:false` / `CANCELLED`); `SCRAP` gerçek fire kararıdır.
- İptal ≠ fire: iptal stok düşmez ve fire raporuna girmez.
- İptal topun token'ı replay edilemez (409 `ENTRY_CANCELLED`).
- Geri alma tek yüklem `resolveRollRestoreBlockReason`.
- Yıkıcı işlemde preview ucu döner, arayüz HER kaydı listeler ve seçim sunar.
- Sebep kodu sunucuda, kolondan okunur; `roll:manual-adjust` SoD izni.
- Bitince alan bekçilerini koş (`/bekci-kos top-duzeltme`; liste `docs/kurallar/top-duzeltme.md § "Bekçiler"`); yeni karar → `/karar-notu`.
