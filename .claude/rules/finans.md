---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{cari,Cari,invoice,Invoice,cheque,Cheque,cash,Cash,payment,Payment,period-guard,goods-receipt,GoodsReceipt,purchase,Purchase,yarn,Yarn,statement}*"
  - "{Teks-Erp,Electron,mobil}/src/**/Finance/**"
---

**Finans · sağlamlık sınıfları** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/finans.md § "Ortak"`
- `docs/kurallar/finans.md § "Backend"`

- Beş sağlamlık sınıfını adıyla an: iki tarih · ters yol · kilit sırası · çift yüklem · tek kaynak satır.
- Cari hesap yalnız iş ortağı kartına bağlanır; XOR'lu çift bağ kurma; taraf değiştiren yazım TEK UPDATE.
- Kapama çözülürken satırı silme: `revokedAt`/`revokedById`/`revokeReason` damgala.
- Sevk rakamı her yüzeyde BRÜT; iade ayrı belgeyle kapanır.
- `invoiceNo`/`invoicedAt` dış muhasebe belgesinin izidir; yalnız DISPATCHED işaretlenir.
- Kasa/KDV davranışı PROFİL bayrağıdır; kodda müşteri dalı açma.
- Bitince alan bekçilerini koş (`/bekci-kos finans`; liste `docs/kurallar/finans.md § "Bekçiler"`); yeni karar → `/karar-notu`.
