import { app, BrowserWindow, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import log from "electron-log/main.js";
import windowStateKeeper from "electron-window-state";
import { registerIpcHandlers } from "./ipc/index.js";
import { buildAppMenu } from "./menu.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

app.commandLine.appendSwitch("enable-features", "MiddleClickAutoscroll");

log.initialize();
log.transports.file.level = "info";
log.info("App starting", { version: app.getVersion(), platform: process.platform });

let mainWindow: BrowserWindow | null = null;

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
    backgroundColor: "#0a0a0a",
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

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
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
