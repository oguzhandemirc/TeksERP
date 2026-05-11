---
name: electron-ipc-handler
description: Adnan Şahin ERP Admin uygulamasında yeni bir typed IPC kanalı (main ↔ renderer) eklerken kullanılır. shared contract → main handler → preload bridge → renderer çağrısı dört adımı atomik tutar. Renderer'a `electron`/`fs` sızdırmaz.
---

# electron-ipc-handler

Renderer'dan main process'e güvenli, tipli bir kanal eklemek için bu skill'i kullan. Çıktı = 1 yeni handler dosyası + 3 dosyada güncellenmiş tip/bridge/registry.

## Kullanım

Kullanıcı şu cümlelerden birini söylediğinde tetikle:
- "Renderer'dan <X> yapmak istiyorum" (file save, print, system info...)
- "Main process'te <Y> kanalı ekle"
- "Preload'a <Z> bridge'i ekle"

## Süreç (4 ZORUNLU adım)

### 1. `shared/ipc-contract.ts`'ye tip ekle
Yeni domain interface'i veya mevcut domain'e yeni method:
```ts
export interface FileApi {
  saveDialog(opts: { defaultName: string }): Promise<string | null>;
}
export interface ApiBridge {
  /* mevcutlar */
  file: FileApi;
}
```

### 2. `electron/ipc/<domain>.ipc.ts` (yeni dosya)
```ts
import { ipcMain, dialog } from "electron";

export function register<Domain>Ipc(): void {
  ipcMain.handle("<domain>:<action>", async (_e, arg) => {
    /* iş mantığı */
  });
}
```

Sonra `electron/ipc/index.ts`'ye `register<Domain>Ipc()` çağrısı ekle.

### 3. `electron/preload.ts`'ye bridge ekle
```ts
const api: ApiBridge = {
  /* mevcutlar */
  file: {
    saveDialog: (opts) => ipcRenderer.invoke("<domain>:<action>", opts),
  },
};
```

### 4. Renderer'da kullan
```ts
const path = await window.api.file.saveDialog({ defaultName: "rapor.xlsx" });
```

## Kurallar

- **Yalnız serializable veri geç** — Buffer, BrowserWindow, function, Symbol geçemez. Buffer → base64 string'e çevir.
- **Kanal adı:** `<domain>:<action>` formatı. Örn: `file:save-dialog`, `print:document`.
- **Renderer'dan `electron`/`fs`/`path`/`child_process`/`os` import ETME.** ESLint kuralı yakalar; yakalamasa bile kural budur.
- **Validation:** main tarafında girdiyi doğrula (URL whitelist, path traversal, vs). `system.ipc.ts`'deki `openExternal` örneği gibi.
- **Error propagation:** `ipcMain.handle` reject olursa renderer'da Promise reject olur. Mesajı kullanıcıya doğrudan gösterme — sanitize et.
- **Yeni native paket gerekiyorsa onay al.** Allowed packages `Electron/CLAUDE.md`'de.

## Ne ZAMAN bu skill'i KULLANMA

- Sadece HTTP backend çağrısı yapacaksan → `apiClient` üzerinden git, IPC eklemeye gerek yok.
- Renderer içinde halledilebilen şey için (storage, navigasyon, UI state) → IPC ekleme.
- Saha cihazı (COM/Bluetooth) — bu uygulama yönetim aracı, saha entegrasyonu yok. Reddet, kullanıcıya hatırlat.

## Doğrulama

- [ ] Tip değiştiyse renderer'da otomatik tamamlama çalışıyor mu? (`window.api.<domain>.`)
- [ ] `npm run typecheck` hata vermiyor mu?
- [ ] Renderer'a hassas veri (token, raw FS path) sızıyor mu?
- [ ] Validation main tarafında var mı?
- [ ] Handler `index.ts`'te `registerIpcHandlers()` içinde mi?
