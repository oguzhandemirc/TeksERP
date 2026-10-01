import { app, BrowserWindow, nativeImage, session } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import log from "electron-log/main.js";
import { registerIpcHandlers } from "./ipc/index.js";
import { startDiscoveryIfNeeded } from "./ipc/discovery.ipc.js";
import { buildAppMenu } from "./menu.js";
import { APP_ID, WINDOW_TITLE } from "@shared/channel";
import { appEntryArgument } from "@shared/app-origin";
import { setTrustedAppEntry } from "./security/trusted-ipc.js";
import { guardWebContents, installPermissionPolicy } from "./security/web-contents-guard.js";
import { openExternalSafely } from "./security/external-open.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

const resourcesDir = isDev
  ? path.join(__dirname, "../..", "resources")
  : process.resourcesPath;

// Uygulamanın KENDİ belgesi: gezinme kapısı, IPC gönderen denetimi ve preload köprüsü
// yalnız bu adresi "uygulama" sayar (geliştirmede Vite sunucusunun kökeni).
const rendererIndexPath = path.join(__dirname, "../renderer/index.html");
const rendererEntryUrl =
  isDev && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL
    : pathToFileURL(rendererIndexPath).href;
setTrustedAppEntry(rendererEntryUrl);

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
    await window.loadFile(rendererIndexPath);
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
    // Kanaldan (deploy/kanallar.json, derleme anında) — hazırlık kanalında etiketi de taşır.
    title: WINDOW_TITLE,
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
      // Preload köprüyü YALNIZ bu adresteki belgeye açar (splash ve yabancı belge almaz).
      additionalArguments: [appEntryArgument(rendererEntryUrl)],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  // Pencere başlığı yalnız kanaldan gelir: splash'in ve renderer'ın <title>'ı onu ezmesin.
  mainWindow.on("page-title-updated", (event) => event.preventDefault());

  // Yeni pencere hiçbir zaman açılmaz; yalnız beyanlı https listesindeki bağlantı
  // işletim sisteminin tarayıcısına verilir (tek geçit: openExternalSafely).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url, "window-open");
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
    // Taskbar ikonu/gruplaması ve bildirimlerin doğru logoyla görünmesi için — kanalın appId'siyle birebir.
    app.setAppUserModelId(APP_ID);
  }

  if (isDev && process.platform === "darwin" && app.dock) {
    const dockIconPath = path.join(__dirname, "../..", "resources", "TeksERP-LOGO-mac.png");
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  installPermissionPolicy(session.defaultSession);
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

// Her webContents (ana pencere, PDF penceresi…) doğarken kapılar takılır: ana çerçeve
// yalnız uygulama belgesinde kalır, engellenen gezinme işletim sistemine DEVREDİLMEZ.
app.on("web-contents-created", (_event, contents) => guardWebContents(contents));

process.on("uncaughtException", (err) => log.error("uncaughtException", err));
process.on("unhandledRejection", (err) => log.error("unhandledRejection", err));

export { mainWindow };
