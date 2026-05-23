import { app, BrowserWindow, nativeImage, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import log from "electron-log/main.js";
import windowStateKeeper from "electron-window-state";
import { registerIpcHandlers } from "./ipc/index.js";
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
  const state = windowStateKeeper({ defaultWidth: 1440, defaultHeight: 900 });

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 1100,
    minHeight: 700,
    title: "Adnan Şahin ERP",
    icon: iconPath,
    backgroundColor: "#000",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  state.manage(mainWindow);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  let splashFinished = false;
  const finishSplash = async () => {
    if (splashFinished || !mainWindow || mainWindow.isDestroyed()) return;
    splashFinished = true;
    await loadRendererInto(mainWindow);
  };

  mainWindow.webContents.on("console-message", (details) => {
    if (details.message === "SPLASH_DONE") void finishSplash();
  });

  setTimeout(() => void finishSplash(), 16000);

  await mainWindow.loadFile(splashPath);
}

app.whenReady().then(async () => {
  if (isDev && process.platform === "darwin" && app.dock) {
    const dockIconPath = path.join(__dirname, "../..", "resources", "TeksERP-LOGO-mac.png");
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  registerIpcHandlers();
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
