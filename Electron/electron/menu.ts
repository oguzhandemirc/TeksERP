import { Menu, app, type MenuItemConstructorOptions } from "electron";

const isMac = process.platform === "darwin";

export function buildAppMenu(): void {
  // Windows/Linux'ta üst menü çubuğunu (Dosya/Düzenle/Görünüm/Pencere/Yardım)
  // tamamen kaldır. Metin düzenleme kısayolları (Ctrl+C/V/X, geri al/yinele,
  // tümünü seç) Chromium tarafından input/textarea alanlarında zaten yerel
  // olarak çalışır — görünür bir menü çubuğuna gerek yok.
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }

  // macOS uygulamaları sistem menü çubuğu gerektirir — tam menüyü koru.
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Düzenle",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Görünüm",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Pencere",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      role: "help",
      submenu: [{ label: "by Etkili Yazılım", enabled: false }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
