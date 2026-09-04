import { app, BrowserWindow, nativeImage, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import log from "electron-log/main.js";
import { registerIpcHandlers } from "./ipc/index.js";
import { startDiscoveryIfNeeded } from "./ipc/discovery.ipc.js";
import { buildAppMenu } from "./menu.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

const resourcesDir = isDev
  ? path.join(__dirname, "../..", "resources")
  : process.resourcesPath;

const iconFile = process.platform === "win32" ? "TeksERP-LOGO.ico" : "TeksERP-LOGO.png";
const iconPath = path.join(resourcesDir, iconFile);
const splashPath = path.join(resourcesDir, "splash.html");

app.commandLine.appendSwitch("enable-features", "MiddleClickAutoscroll");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

log.initialize();
log.transports.file.level = "info";
log.info("App starting", { version: app.getVersion(), platform: process.platform });

let mainWindow: BrowserWindow | null = null;

async function loadRendererInto(window: BrowserWindow): Promise<void> {
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    center: true,
    resizable: false,
    minWidth: 1100,
    minHeight: 700,
    title: "Adnan Şahin ERP",
    icon: iconPath,
    backgroundColor: "#000",
    show: false,
    // ⚠️ WINDOWS/LINUX: CERCEVESIZ — baslik cubugunu uygulama kendisi cizer
    //   (`components/layout/TitleBar.tsx`). macOS'ta `hiddenInset` KALIR: orada
    //   trafik isiklarini isletim sistemi cizer ve kullanicilar onlarin yerini
    //   kas hafizasiyla bilir; kendi dugmelerimizi koymak platform sozlesmesini
    //   bozardi.
    // ⚠️ Splash AYNI pencerede yuklenir (`loadFile(splashPath)`) ve React
    //   baslik cubugu orada YOKTUR -> splash.html kendi surukleme seridini ve
    //   kapatma dugmesini tasir, yoksa 16 saniye boyunca kapatilamayan bir
    //   pencere kalirdi.
    frame: process.platform === "darwin",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  let splashFinished = false;
  const finishSplash = async () => {
    if (splashFinished || !mainWindow || mainWindow.isDestroyed()) return;
    splashFinished = true;
    mainWindow.setResizable(true);
    mainWindow.maximize();
    await loadRendererInto(mainWindow);
  };

  mainWindow.webContents.on("console-message", (details) => {
    if (details.message === "SPLASH_DONE") void finishSplash();
  });

  setTimeout(() => void finishSplash(), 16000);

  await mainWindow.loadFile(splashPath);
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    // Taskbar ikonu/gruplaması ve bildirimlerin doğru logoyla görünmesi için — appId ile birebir aynı.
    app.setAppUserModelId("com.etkiliyazilim.adnan-sahin-erp");
  }

  if (isDev && process.platform === "darwin" && app.dock) {
    const dockIconPath = path.join(__dirname, "../..", "resources", "TeksERP-LOGO-mac.png");
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  registerIpcHandlers();
  // Sunucu keşfi — ATEŞLE VE UNUT, splash'i BEKLETMEZ. Splash videosu zaten
  // ~16 sn'ye kadar zaman veriyor (finishSplash'in emniyet supabı) ve keşif
  // onun altında paralel koşuyor; mutlu yolda renderer yüklenmeden biter ve
  // adres yerine yazılmış olur. Bitmezse renderer boş adresle açılır ve
  // kullanıcıya aday seçtirir — iki yol da aynı yere varır.
  // ⚠️ `finishSplash`e BAĞLAMAYIN: `SPLASH_DONE` hızlı yolunu geriletir.
  void startDiscoveryIfNeeded();
  buildAppMenu();
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    const allowed = process.env.ELECTRON_RENDERER_URL ?? "file://";
    if (!url.startsWith(allowed)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
});

process.on("uncaughtException", (err) => log.error("uncaughtException", err));
process.on("unhandledRejection", (err) => log.error("unhandledRejection", err));

export { mainWindow };
