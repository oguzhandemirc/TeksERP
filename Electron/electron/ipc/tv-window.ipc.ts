// =============================================================================
// Salon TV penceresi — ayrı BrowserWindow, aynı oturum (aynı session + preload).
// Adres renderer'dan alınmaz: güvenilen giriş adresi + sabit TV hash'i (`tvWindowUrl`).
// Tek pencere: ikinci istek var olanı öne getirir (istenen ekran farklıysa oraya taşır).
// =============================================================================
import { BrowserWindow, screen, type Display } from "electron";
import log from "electron-log/main.js";
import { handleTrusted, trustedAppEntry } from "../security/trusted-ipc.js";
import {
  parseTvWindowRequest,
  pickTvDisplay,
  tvWindowUrl,
  type TvDisplayInfo,
  type TvWindowOpenResult,
} from "@shared/tv-window";

export interface TvWindowOptions {
  preload: string;
  icon: string;
  title: string;
  /** Preload köprüsünün giriş adresi argümanı — ana pencereyle aynı. */
  entryArgument: string;
  /** Kapanış bildirimi ana pencereye gider (renderer "TV açıktı" tercihini temizler). */
  mainWindow: () => BrowserWindow | null;
}

let tvWindow: BrowserWindow | null = null;
/** Uygulama/ana pencere kapanırken TV de kapanır — bu kullanıcının TV'yi kapatması sayılmaz. */
let closingWithApp = false;

export function listTvDisplays(): TvDisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Ekran ${i + 1}`,
    primary: d.id === primaryId,
    width: d.size.width,
    height: d.size.height,
  }));
}

function placeOn(win: BrowserWindow, display: Display): void {
  if (win.isFullScreen()) win.setFullScreen(false);
  win.unmaximize();
  win.setBounds(display.workArea);
  win.maximize();
}

function createTvWindow(display: Display, entry: string, opts: TvWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    ...display.workArea,
    title: `${opts.title} — Tezgah Salonu`,
    icon: opts.icon,
    backgroundColor: "#000",
    show: false,
    // Çerçeveli: kullanıcı pencereyi başlığından tutup TV ekranına sürükleyebilsin.
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: opts.preload,
      additionalArguments: [opts.entryArgument],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.on("page-title-updated", (event) => event.preventDefault());
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });
  win.on("closed", () => {
    if (tvWindow === win) tvWindow = null;
    const main = opts.mainWindow();
    if (main && !main.isDestroyed()) main.webContents.send("tv-window:closed", { byUser: !closingWithApp });
    closingWithApp = false;
  });
  void win.loadURL(tvWindowUrl(entry)).catch((err) => log.warn("[tv-penceresi] yüklenemedi", err));
  return win;
}

export function openTvWindow(raw: unknown, opts: TvWindowOptions): TvWindowOpenResult {
  const req = parseTvWindowRequest(raw);
  if (!req) {
    log.warn("[tv-penceresi] geçersiz istek reddedildi");
    return { ok: false, reason: "Geçersiz istek" };
  }
  const entry = trustedAppEntry();
  if (!entry) return { ok: false, reason: "Uygulama adresi bilinmiyor" };
  const display = pickTvDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay().id, req.displayId);
  if (!display) return { ok: false, reason: "Ekran bulunamadı" };
  if (tvWindow && !tvWindow.isDestroyed()) {
    if (req.displayId !== null && screen.getDisplayMatching(tvWindow.getBounds()).id !== display.id) placeOn(tvWindow, display);
    if (tvWindow.isMinimized()) tvWindow.restore();
    tvWindow.show();
    tvWindow.focus();
    return { ok: true, reused: true, displayId: display.id };
  }
  tvWindow = createTvWindow(display, entry, opts);
  return { ok: true, reused: false, displayId: display.id };
}

/** Ana pencere kapanırken çağrılır: TV penceresi sahipsiz kalıp süreci ayakta tutmasın. */
export function closeTvWindowWithApp(): void {
  closingWithApp = true;
  if (tvWindow && !tvWindow.isDestroyed()) tvWindow.close();
}

export function registerTvWindowIpc(opts: TvWindowOptions): void {
  handleTrusted("tv-window:displays", () => listTvDisplays());
  handleTrusted("tv-window:open", (_event, raw: unknown) => openTvWindow(raw, opts));
}
