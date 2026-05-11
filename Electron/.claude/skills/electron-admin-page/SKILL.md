---
name: electron-admin-page
description: Adnan Şahin ERP Admin uygulamasında yeni bir CRUD sayfası iskeleti üretir. types/service/schema/columns/FormDialog/Page dosyalarını ayrı ayrı oluşturur, route ve (gerekirse) tanımlar kartını ekler. Tek satırda yüzlerce kod barındıran monolit sayfa yazmaz.
---

# electron-admin-page

Yeni admin CRUD sayfası eklerken bu skill'i kullan. Çıktı = 5–6 küçük dosya + router/tile güncellemesi.

## Kullanım

Kullanıcı şunlardan birini söylediğinde tetikle:
- "Yeni bir <X> sayfası ekle"
- "Müşteri/İstasyon/Hata Tipi sayfası yaz"
- "Şu modül için CRUD sayfası lazım"

## Soracakların

1. **Modül adı** (ör. `Customers`) ve route slug'ı (ör. `definitions/customers`)
2. **Backend endpoint** (ör. `/api/customers`)
3. **Permission kodu** (ör. `customer:read`, `customer:write`)
4. **Alanlar** — her alan için: ad, tip (string/number/boolean/date/select), zorunluluk, validasyon
5. **Sidebar konumu:** Tanımlar hub'ı altında mı (`tile-config.ts`'e kart eklenecek), yoksa root sidebar'a mı (Yetkilendirme/Sistem altı)?

## Üreteceğin dosyalar

```
src/pages/<Module>/
├── types.ts                      # Backend modeli interface
├── service.ts                    # createCrudService<T>("/api/...")
├── schema.ts                     # zod schema + defaults
├── columns.tsx                   # ColumnDef<T>[]
├── <Module>FormDialog.tsx        # EntityFormDialog wrapper
└── <Module>Page.tsx              # Orkestre — useDataTable + useCrudMutations
```

Ardından şunları **güncelle**:
- `src/router.tsx` — yeni route eklemesi `<ProtectedRoute requirePermission="...">` ile
- (Tanım modülüyse) `src/pages/Definitions/tile-config.ts` — yeni kart girişi

## Kurallar

- Dosya başına 300 satır limiti. Form 5+ alan içeriyorsa form sub-bileşenlere böl.
- `<Module>Page.tsx` sadece **orkestrasyondur**: state, mutation, dialog açma. Tablo, form, kolon mantığı oraya yazma.
- `useCrudMutations` mutation'ında `onError` toast EKLEME — `apiClient` zaten gösteriyor.
- `any` yasak. Backend tipi belirsizse önce `Teks-Erp/prisma/schema.prisma` veya `React/src/types/models.ts`'ten doğrula.
- Yeni paket eklemen gerekiyorsa **önce kullanıcıdan onay al**. Allowed packages tablosu `Electron/CLAUDE.md`'de.
- Sidebar'a doğrudan satır ekleme — Tanımlar hub'ından geçer.

## İskelet Şablonları

### types.ts
```ts
export interface <Module> {
  id: string;
  /* alanlar */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### service.ts
```ts
import { createCrudService } from "@/services/crudService";
import type { <Module> } from "./types";
export const <module>Service = createCrudService<<Module>>("/api/<endpoint>");
```

### schema.ts
```ts
import { z } from "zod";
export const <module>FormSchema = z.object({ /* alan -> z.* */ });
export type <Module>FormValues = z.infer<typeof <module>FormSchema>;
export const <module>FormDefaults: <Module>FormValues = { /* defaults */ };
```

### columns.tsx
```tsx
import type { ColumnDef } from "@tanstack/react-table";
import type { <Module> } from "./types";
export const <module>Columns: ColumnDef<<Module>>[] = [ /* sütunlar */ ];
```

### `<Module>FormDialog.tsx`
`EntityFormDialog<<Module>FormValues>` wrap'i — her alan için `<FormField>` + uygun input.

### `<Module>Page.tsx`
`useDataTable` + `useCrudMutations` + `DataTable` + `<Module>FormDialog` + `ConfirmDialog`. `pages/Users/UsersPage.tsx`'i referans olarak izle.

## Doğrulama

İş bittikten sonra:
- [ ] Yeni route hash URL'de açılıyor mu?
- [ ] Tablo backend'den veri çekiyor mu?
- [ ] Yeni/Düzenle/Sil akışı çalışıyor mu?
- [ ] Permission kontrolü doğru mu? (yetkisiz kullanıcı butonu görmüyor)
- [ ] Hiçbir dosya 300 satırı aştı mı?
