// =============================================================================
// Windows Spooler RAW transport — USB etiket yazıcısı (Argox / Bixolon) DİL-BAĞIMSIZ
// =============================================================================
// USB'ye takılan Argox OS-214plus (PPLA) ve Bixolon (ZPL) yazıcıları Windows'ta
// COM portu DEĞİL, USBPRINT-sınıfı cihaz olarak görünür → seri/COM yolu ölü.
// Bu transport ham baytları (PPLA/PPLB/ZPL — hangisiyse) Windows print spooler'a
// "RAW" datatype ile geçirir: sürücü baytlara DOKUNMAZ, doğrudan yazıcıya iletir.
// Böylece cihazın "Generic / Text Only" (Windows yerleşik) kuyruğu yeterli —
// vendor sürücüsü indirmeye gerek yok. Dil cihaz-başına PeripheralDevice
// languageOverride'dan çözülür; bu katman yalnız bayt taşır (marka-bağımsız).
//
// Uygulama: gömülü C# (winspool.Drv WritePrinter P/Invoke, Microsoft
// RawPrinterHelper deseni) PowerShell Add-Type ile derlenir — .NET zaten
// Windows'ta var, node-gyp/Visual Studio GEREKMEZ, yeni npm paketi YOK.
// Windows dışı ortamda powershell.exe bulunmaz → available:false (uygulama çökmez).
// =============================================================================

import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  PrinterSendResult,
  ScannerListResult,
  ScannerDeviceInfo,
} from "@shared/ipc-contract.js";

const PS_EXE = "powershell.exe";
const PS_FLAGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];
// Aynı-PC eşzamanlı baskıda benzersiz veri dosyası (Date.now yerine sayaç — deterministik).
let counter = 0;

// RAW gönderim scripti: veri dosyasını okuyup winspool WritePrinter ile kuyruğa RAW yazar.
// C# `$` içermez → `@'...'@` LİTERAL here-string (PowerShell interpolasyonu yok).
// Kapanış `'@` SÜTUN 0'da olmalı — aşağıdaki satırlar bilinçli girintisizdir.
const RAW_SCRIPT = String.raw`param([Parameter(Mandatory=$true)][string]$PrinterName,[Parameter(Mandatory=$true)][string]$DataPath)
$ErrorActionPreference = 'Stop'
$cs = @'
using System;
using System.Runtime.InteropServices;
public class TeksRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFOW { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true)] public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true)] public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFOW di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool WritePrinter(IntPtr h, IntPtr buf, int count, out int written);
  public static int Send(string printer, byte[] bytes) {
    IntPtr h; DOCINFOW di = new DOCINFOW(); di.pDocName = "TeksERP Etiket"; di.pDataType = "RAW";
    int written = 0; IntPtr p = Marshal.AllocCoTaskMem(bytes.Length); Marshal.Copy(bytes, 0, p, bytes.Length);
    try {
      if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter hata kodu " + Marshal.GetLastWin32Error());
      try {
        if (!StartDocPrinter(h, 1, ref di)) throw new Exception("StartDocPrinter hata kodu " + Marshal.GetLastWin32Error());
        if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter hata kodu " + Marshal.GetLastWin32Error());
        if (!WritePrinter(h, p, bytes.Length, out written)) throw new Exception("WritePrinter hata kodu " + Marshal.GetLastWin32Error());
        EndPagePrinter(h); EndDocPrinter(h);
      } finally { ClosePrinter(h); }
    } finally { Marshal.FreeCoTaskMem(p); }
    return written;
  }
}
'@
try {
  Add-Type -TypeDefinition $cs -Language CSharp
  $bytes = [System.IO.File]::ReadAllBytes($DataPath)
  $written = [TeksRawPrinter]::Send($PrinterName, $bytes)
  Write-Output ("OK " + $written)
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;

/** Ham baytları (PPLA/PPLB/ZPL) Windows yazıcı kuyruğuna RAW olarak gönder. */
export async function sendWinspool(printerName: string, buf: Buffer): Promise<PrinterSendResult> {
  const dir = os.tmpdir();
  const id = `${process.pid}-${++counter}`;
  const dataPath = path.join(dir, `teks-raw-${id}.prn`);
  const scriptPath = path.join(dir, "teks-winspool-raw.ps1");
  try {
    await writeFile(scriptPath, RAW_SCRIPT, "utf8");
    await writeFile(dataPath, buf);
  } catch (e) {
    return { ok: false, bytes: 0, available: true, error: (e as Error).message };
  }

  return new Promise((resolve) => {
    let out = "", err = "", settled = false;
    const done = (r: PrinterSendResult) => {
      if (settled) return;
      settled = true;
      void unlink(dataPath).catch(() => {});
      resolve(r);
    };
    let child;
    try {
      child = spawn(
        PS_EXE,
        [...PS_FLAGS, "-File", scriptPath, "-PrinterName", printerName, "-DataPath", dataPath],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      return done({ ok: false, bytes: 0, available: false, error: (e as Error).message });
    }
    child.stdout?.on("data", (c) => (out += String(c)));
    child.stderr?.on("data", (c) => (err += String(c)));
    child.on("error", (e) => done({ ok: false, bytes: 0, available: false, error: `powershell çalıştırılamadı: ${e.message}` }));
    child.on("close", (code) => {
      const trimmed = out.trim();
      if (code === 0 && trimmed.startsWith("OK")) {
        const n = parseInt(trimmed.slice(2).trim(), 10);
        done({ ok: true, bytes: Number.isFinite(n) ? n : buf.length, available: true, error: null });
      } else {
        done({ ok: false, bytes: 0, available: true, error: err.trim() || trimmed || `powershell çıkış ${code}` });
      }
    });
  });
}

/** Kurulu Windows yazıcı kuyruklarını listele (Win32_Printer). path = kuyruk adı. */
export function listWinspool(): Promise<ScannerListResult> {
  // Ad `t Port `t Sürücü — satır başına bir yazıcı (JSON tek-öğe tuzağından kaçınmak için TSV).
  const cmd = 'Get-CimInstance Win32_Printer | ForEach-Object { "$($_.Name)`t$($_.PortName)`t$($_.DriverName)" }';
  return new Promise((resolve) => {
    let out = "", err = "";
    let child;
    try {
      child = spawn(PS_EXE, [...PS_FLAGS, "-Command", cmd], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ available: false, error: (e as Error).message, devices: [] });
      return;
    }
    child.stdout?.on("data", (c) => (out += String(c)));
    child.stderr?.on("data", (c) => (err += String(c)));
    child.on("error", (e) => resolve({ available: false, error: e.message, devices: [] }));
    child.on("close", (code) => {
      if (code !== 0 && !out.trim()) {
        resolve({ available: false, error: err.trim() || `powershell çıkış ${code}`, devices: [] });
        return;
      }
      const devices: ScannerDeviceInfo[] = out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line): ScannerDeviceInfo => {
          const parts = line.split("\t");
          const name = parts[0] ?? line;
          const extra = [parts[1], parts[2]].filter((s) => s && s.trim()).join(" · ");
          return { path: name, label: extra ? `${name} — ${extra}` : name };
        });
      resolve({ available: true, error: null, devices });
    });
  });
}
