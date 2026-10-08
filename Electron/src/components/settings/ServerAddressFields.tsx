import { useRef } from "react";
import { Building2, Cloud, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_API_BASE_URL, normalizeApiBaseUrl, type ApiBaseUrlParts } from "@/lib/api-config";
import { SERVER_MODES, SERVER_MODE_LABEL, type ServerMode } from "@/lib/server-mode";
import { cn } from "@/lib/utils";

const MODE_ICON = { fabrika: Building2, bulut: Cloud } as const;

const MODE_HINT: Record<ServerMode, string> = {
  fabrika: "Sunucu fabrikanızın ağında. Bağlantı şifrelidir; ilk bağlanışta doğrulama kodu karşılaştırılır.",
  bulut: "Sunucu internette (…etkiliyazilim.com). Sertifika otomatik doğrulanır, kod sorulmaz.",
};

export function ServerModeSwitch({ mode, onChange }: { mode: ServerMode; onChange: (m: ServerMode) => void }) {
  return (
    <div className="space-y-1.5">
      <div role="radiogroup" aria-label="Sunucu nerede" className="grid grid-cols-2 gap-2">
        {SERVER_MODES.map((m) => {
          const Icon = MODE_ICON[m];
          const on = m === mode;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(m)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition",
                on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {SERVER_MODE_LABEL[m]}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{MODE_HINT[mode]}</p>
    </div>
  );
}

interface FieldsProps {
  mode: ServerMode;
  parts: ApiBaseUrlParts;
  composed: string;
  isDefault: boolean;
  /** Şifresiz seçenek bu adreste geçerli mi (yalnız döngü adresi). */
  httpOk: boolean;
  /** Bulut'ta port kilitli (boş = 443); tıklayınca açılır. */
  portLocked: boolean;
  onUnlockPort: () => void;
  onProtocolChange: (p: "http" | "https") => void;
  onHostChange: (raw: string) => void;
  onPortChange: (port: string) => void;
}

function PortField({ mode, parts, portLocked, onUnlockPort, onPortChange }: FieldsProps) {
  const ref = useRef<HTMLInputElement>(null);
  const locked = mode === "bulut" && portLocked;
  const unlock = () => {
    if (!locked) return;
    onUnlockPort();
    requestAnimationFrame(() => ref.current?.focus());
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor="api-port">Port</Label>
      <div className="relative">
        <Input
          ref={ref}
          id="api-port"
          value={locked ? "" : parts.port}
          readOnly={locked}
          onClick={unlock}
          onChange={(e) => onPortChange(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder={mode === "bulut" ? "443" : "4443"}
          title={locked ? "Standart port (443). Elle yazmak için tıklayın." : undefined}
          inputMode="numeric"
          autoComplete="off"
          className={cn("font-mono", locked && "cursor-pointer pr-8 text-muted-foreground")}
        />
        {locked && (
          <button
            type="button"
            onClick={unlock}
            aria-label="Portu elle yaz"
            className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <Lock className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Protokol / adres / port — Bulut'ta protokol https sabit, port kilitli. */
export function ServerAddressFields(props: FieldsProps) {
  const { mode, parts, composed, isDefault, httpOk, onProtocolChange, onHostChange } = props;
  return (
    <>
      <div className="grid grid-cols-[7rem_1fr_5.5rem] gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="api-protocol">Protokol</Label>
          {mode === "bulut" ? (
            <Input id="api-protocol" value="https" readOnly disabled className="font-mono" />
          ) : (
            <Select value={parts.protocol} onValueChange={(v) => onProtocolChange(v as "http" | "https")}>
              <SelectTrigger id="api-protocol">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="https">https</SelectItem>
                <SelectItem value="http" disabled={!httpOk}>
                  http{httpOk ? "" : " (yalnız sunucu bilgisayarında)"}
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="api-host">{mode === "bulut" ? "Sunucu adresi" : "IP / Sunucu adresi"}</Label>
          <Input
            id="api-host"
            value={parts.host}
            onChange={(e) => onHostChange(e.target.value)}
            placeholder={mode === "bulut" ? "firmaniz.etkiliyazilim.com" : "192.168.1.50"}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </div>
        <PortField {...props} />
      </div>
      <p className="text-xs text-muted-foreground">
        {composed ? (
          <>
            Adres: <span className="font-mono text-foreground">{composed}</span>
            {isDefault && " (varsayılan)"}
          </>
        ) : (
          <>
            Varsayılan: <span className="font-mono">{normalizeApiBaseUrl(DEFAULT_API_BASE_URL)}</span>
          </>
        )}
      </p>
    </>
  );
}
