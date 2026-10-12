---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{traveler,Traveler,refakat}*"
---

**Refakat kartı** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/refakat-karti.md § "Ortak"`
- `docs/kurallar/refakat-karti.md § "Backend"`

- Kart iş emri açılışında doğar; bir iş emri = tek kart.
- Plan canlı, sunum canlı; içerik yalnız geçersiz kartta donuk.
- Önizleme, baskı ve sürüm numarası tek karar noktası `resolvePrintPlan`.
- `contentDirty` tek yazıcı `markTravelerCardDirtyTx`; partiler baskıda canlı çözülür.
- Bitince alan bekçilerini koş (`/bekci-kos refakat-karti`; liste `docs/kurallar/refakat-karti.md § "Bekçiler"`); yeni karar → `/karar-notu`.
