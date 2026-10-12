---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{discovery,Discovery,device,Device,peripheral,Peripheral,pairing,mdns,scale-read,scanner,Scanner,bluetooth,btClassic,btPrinter,totp,access}*"
  - "{Electron,mobil}/src/**/hal/**"
---

**Keşif · cihaz · ağ · donanım** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/kesif-cihaz.md § "Ortak"`
- `docs/kurallar/kesif-cihaz.md § "Backend"`
- `docs/kurallar/kesif-cihaz.md § "Tablet"`

- Donanım fail-closed: cihaz yok/okunamadı/değer ≤ 0 → net Türkçe toast, mutasyon çağrılmaz.
- Uydurulmuş değeri `source:'SIMULATED'` beyanıyla gönder; kararı backend verir. Seri port/polling backend'e girmez.
- Keşifte bir satır = bir sunucu (`installationId`); yedek portta kimlik zorunlu.
- Keşif kuralı `KEŞİF-İKİZ` bloğunda tek metin; iki ikizi birlikte değiştir.
- Yeni kurulum ağa yalnız HTTPS 4443 açar; API portu yalnız 127.0.0.1; fabrikaya gelen port açma.
- Bitince alan bekçilerini koş (`/bekci-kos kesif-cihaz`; liste `docs/kurallar/kesif-cihaz.md § "Bekçiler"`); yeni karar → `/karar-notu`.
