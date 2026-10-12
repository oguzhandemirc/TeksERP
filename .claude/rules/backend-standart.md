---
paths:
  - "Teks-Erp/src/**"
---

**Backend katmanı** — öz. Standardı baştan okuma; yalnız ilgili bölüm (eşzamanlılık `docs/standart/ESZAMANLILIK.md`, şema `docs/standart/VERITABANI.md`):
- `docs/standart/BACKEND.md § 1` katman sözleşmesi
- `docs/standart/BACKEND.md § 3` servis metodu anatomisi
- `docs/standart/BACKEND.md § 11` boyut

- Route/controller'da `prisma` import etme; iş servis katmanında.
- Durum geçişi atomik claim: `updateMany WHERE {id, durum}` + `count===0 → 409`; `findUnique→if→update` yok.
- `tx.*` çağrılarını `Promise.all` ile paralelleştirme; advisory kilit tx'in İLK ifadesi.
- Hata kodu `details.code`; validation mesajı Türkçe; `src/`de tanımlayıcı İngilizce.
- `BaseController` modeline yeni skaler kolon = yeni yazılabilir alan; istemiyorsan açıkça kapat.
- Kurallar yeni ve dokunulan kodda zorunlu; devralınan sapma baseline'da donar. Bitince alan bekçileri (`/bekci-kos`).
