import { useMemo, useRef, useState } from "react";
import { ScanLine, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMachineConfig } from "@/hooks/useMachineConfig";
import type { ScannerConfig } from "@/lib/machine-config";
import {
  createWedgeDetector,
  DEFAULT_WEDGE_CONFIG,
  type WedgeResult,
} from "@/lib/scanner/wedge-detector";
import { classifyBarcode } from "@/lib/scanner/barcode-kind";
import { ScannerDeviceSettings } from "./ScannerDeviceSettings";
import { FlagToggle, FieldLabel } from "./SettingRow";
import { InfoPopover } from "./SettingHint";

type Terminator = "Enter" | "Tab" | "both";

const TERMINATOR_LABELS: Record<Terminator, string> = {
  Enter: "Enter (varsayılan)",
  Tab: "Tab",
  both: "Enter veya Tab",
};

/**
 * Barkod tabancası ayarları — bu iş istasyonuna özel (yerel tercih, backend
 * feature-flag DEĞİL). USB + Bluetooth tabancalar "klavye-wedge" modunda kod
 * yazıp Enter basar; bu ayarlar yalnız global "her yerde okut" davranışını ve
 * burst tespiti hassasiyetini yönetir. Per-ekran okutma alanları (Yeniden
 * Etiketle, Çuval Arama vb.) bu ayardan bağımsız her zaman çalışır.
 */
export function ScannerSettingsSection() {
  const { config, setConfig } = useMachineConfig();
  const sc = config.scanner ?? {};
  const setScanner = (patch: Partial<ScannerConfig>) =>
    setConfig({ scanner: { ...sc, ...patch } });

  const scanAnywhere = sc.scanAnywhere ?? false;
  const terminator = (sc.terminator ?? DEFAULT_WEDGE_CONFIG.terminator) as Terminator;
  const maxInterKeyMs = sc.maxInterKeyMs ?? DEFAULT_WEDGE_CONFIG.maxInterKeyMs;
  const minLength = sc.minLength ?? DEFAULT_WEDGE_CONFIG.minLength;

  return (
    <div className="space-y-5">
      {/* Her yerde okut */}
      <FlagToggle
        title="Her yerde okut (global)"
        desc="Açıkken, bir metin kutusuna odaklı değilken okutulan kod otomatik tanınır (top / refakat / kartela / çuval) ve ilgili kayda gitmek için bir panel açılır. Kapalıyken (varsayılan) yalnızca okutma alanı olan ekranlarda çalışır. Tabancayı okutma istasyonunda kullananlar için açın."
        checked={scanAnywhere}
        onChange={(v) => setScanner({ scanAnywhere: v })}
      />

      {/* Terminator */}
      <div className="border-t pt-4">
        <FieldLabel
          htmlFor="scan-terminator"
          label="Bitiş tuşu (terminator)"
          desc="Tabancanın kod sonunda gönderdiği tuş. Çoğu tabanca varsayılan olarak Enter gönderir; tabancanız Tab gönderiyorsa burayı değiştirin."
        />
        <Select value={terminator} onValueChange={(v) => setScanner({ terminator: v as Terminator })}>
          <SelectTrigger id="scan-terminator" className="mt-2 w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TERMINATOR_LABELS) as Terminator[]).map((t) => (
              <SelectItem key={t} value={t}>
                {TERMINATOR_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Gelişmiş — hassasiyet */}
      <div className="border-t pt-4">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium">Gelişmiş — burst hassasiyeti</p>
          <InfoPopover desc="Tabancayı insan yazımından ayıran eşikler. Genelde dokunulmaz; aşağıdaki test kutusuyla gerçek tabancanıza göre ince ayar yapabilirsiniz." />
        </div>
        <div className="mt-2 flex flex-wrap gap-4">
          <label className="text-xs">
            <span className="block text-muted-foreground">Maks. tuş aralığı (ms)</span>
            <Input
              type="number"
              inputMode="numeric"
              className="mt-1 w-32"
              min={5}
              max={200}
              value={maxInterKeyMs}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 5 && n <= 200) setScanner({ maxInterKeyMs: n });
              }}
            />
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">Min. uzunluk</span>
            <Input
              type="number"
              inputMode="numeric"
              className="mt-1 w-32"
              min={2}
              max={32}
              value={minLength}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 2 && n <= 32) setScanner({ minLength: n });
              }}
            />
          </label>
        </div>
      </div>

      {/* Canlı test kutusu */}
      <ScannerTestBox
        maxInterKeyMs={maxInterKeyMs}
        minLength={minLength}
        terminator={terminator}
      />

      {/* Faz-2 — seri/HID cihaz okuyucu (klavye-wedge yapamayan tabancalar) */}
      <div className="border-t pt-4">
        <p className="mb-2 text-sm font-medium">Cihaz okuyucu (seri / HID — Faz-2)</p>
        <ScannerDeviceSettings />
      </div>
    </div>
  );
}

interface TestBoxProps {
  maxInterKeyMs: number;
  minLength: number;
  terminator: Terminator;
}

/** Tabancayı buraya okutarak burst'ün algılanıp algılanmadığını + zamanlamayı gör. */
function ScannerTestBox({ maxInterKeyMs, minLength, terminator }: TestBoxProps) {
  const [value, setValue] = useState("");
  const [lastGap, setLastGap] = useState<number | null>(null);
  const [result, setResult] = useState<WedgeResult | null>(null);
  const detector = useMemo(
    () => createWedgeDetector({ ...DEFAULT_WEDGE_CONFIG, maxInterKeyMs, minLength, terminator }),
    [maxInterKeyMs, minLength, terminator],
  );
  const lastTsRef = useRef<number | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const now = performance.now();
    if (e.key.length === 1) {
      setLastGap(lastTsRef.current === null ? null : Math.round(now - lastTsRef.current));
      lastTsRef.current = now;
    }
    const r = detector.feed(e.nativeEvent, now);
    if (r) {
      e.preventDefault();
      setResult(r);
      setValue("");
      lastTsRef.current = null;
    }
  };

  return (
    <div className="border-t pt-4">
      <div className="flex items-center gap-1.5">
        <label htmlFor="scan-test" className="flex items-center gap-1.5 text-sm font-medium">
          <ScanLine className="h-4 w-4" /> Tabancanı test et
        </label>
        <InfoPopover desc="Tabancayı bu kutuya okutun. Algılanan kodu, karakter sayısını ve tuş aralığını gösterir — eşikleri buna göre ayarlayabilirsiniz. (Bu kutuda okutma global panele gitmez.)" />
      </div>
      <Input
        id="scan-test"
        className="mt-2 max-w-md font-mono"
        placeholder="Buraya okut…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          detector.reset();
          lastTsRef.current = null;
        }}
      />
      <div className="mt-2 space-y-1 text-xs">
        {lastGap !== null && (
          <p className="text-muted-foreground">
            Son tuş aralığı: <span className="font-medium text-foreground">{lastGap} ms</span>{" "}
            {lastGap <= maxInterKeyMs ? "(makine-hızlı ✓)" : "(yavaş — insan?)"}
          </p>
        )}
        {result && (
          <p className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-500">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Algılandı: <span className="font-mono font-medium">{result.code}</span> (
            {result.charCount} karakter, {Math.round(result.durationMs)} ms,{" "}
            {classifyBarcode(result.code).kind})
          </p>
        )}
      </div>
    </div>
  );
}
