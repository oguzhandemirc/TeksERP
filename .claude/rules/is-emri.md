---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{workorder,work-order,WorkOrder,quickStart,HizliIsEmri,production-balance}*"
  - "{Teks-Erp,Electron,mobil}/src/**/*{order.,Order.,orders.,Orders,OrderLine,order-line}*"
---

**İş emri · sipariş bağı** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/is-emri.md § "Ortak"`
- `docs/kurallar/is-emri.md § "Backend"`
- `docs/kurallar/is-emri.md § "Panel"`

- `WorkOrder.type` beyan değil bağın aynasıdır; iş emri N sipariş satırına ya da hiçbirine bağlanır.
- İki bağ yolu iki sözleşme: gövdedeki satırdan hedef türetilir; sonradan bağlamada hedef ezilmez.
- Rota şablonu hedefi öneridir; siparişin şartını ezmez.
- Bağ işlemlerine kapalı statüler yalnız CANCELLED + SUPERSEDED.
- Sipariş yönü doğuşta donar (`Order.destination`); kalem iptali soft.
- Top ↔ sipariş satırı bağı YOK; karşılama `SackAllocation` ile sevk anında.
- Bitince alan bekçilerini koş (`/bekci-kos is-emri`; liste `docs/kurallar/is-emri.md § "Bekçiler"`); yeni karar → `/karar-notu`.
