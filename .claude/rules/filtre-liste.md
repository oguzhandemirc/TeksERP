---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{query-parser,cursor,filter,Filter,search,Search,base.service,base.controller,order-line-scope}*"
---

**Filtre · liste · arama** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/filtre-liste.md § "Ortak"`
- `docs/kurallar/filtre-liste.md § "Backend"`
- `docs/kurallar/filtre-liste.md § "Panel"`

- Elle okunan her id filtresini `readIdCondition`/`readFilterList`'ten geçir (CSV de string'dir).
- Çıplak süzgeç adını (`?status=OPEN`) reddet: fail-closed.
- Cursor'lu listede süzmeyi SUNUCUDA yap; liste + cursor + özet şeridi tek where'den (`BaseService.buildListWhere`).
- İlişki süzgeci `extraWhere`den gelir; skaler olmayan anahtarı jenerik süzgece sokma.
- Seçici: form kutusuna tıkla → doğrudan modal (combobox yok); Ctrl+F yok.
- Bitince alan bekçilerini koş (`/bekci-kos filtre-liste`; liste `docs/kurallar/filtre-liste.md § "Bekçiler"`); yeni karar → `/karar-notu`.
