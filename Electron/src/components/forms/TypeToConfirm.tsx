import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Yazarak onaylama — kullanıcı beklenen metni ELLE yazana kadar yıkıcı eylemi kilitler.
 *
 * Neden ayrı primitif, `ConfirmDialog`'a prop değil: o bileşen `max-w-md` +
 * `description: string` ile sınırlı ve children almıyor; bu kapının gerektiği
 * yerler (geri yükleme, hard delete) zengin içerikli, elle kurulmuş dialoglar.
 * `ConfirmDialog`'un ~31 çağrı noktası ve kazanılmış çift-tık kilidi var — oraya
 * prop eklemek 31 çağrının regresyon yüzeyi olurdu. İleride istenirse
 * `ConfirmDialog` bunu opsiyonel prop arkasında RENDER eder (kompozisyon, kopya değil).
 *
 * KONTROLLÜ bileşen: `value` parent'ta yaşar. Sebebi, dialog her açılışta değeri
 * SIFIRLAMAK zorunda — aksi halde önceki onay yeni (ve farklı) bir hedef için
 * geçerli sayılır.
 */
interface Props {
  /** Kullanıcının birebir yazması gereken metin (örn. veritabanı adı). */
  expected: string;
  value: string;
  onChange: (value: string) => void;
  label?: ReactNode;
  /**
   * Yapıştırmaya izin ver. Varsayılan KAPALI: amaç ekrandaki metni panoyla
   * taşımak değil, OKUYUP yeniden üretmek — asıl sürtünme burada.
   */
  allowPaste?: boolean;
  disabled?: boolean;
}

/**
 * Baştaki/sondaki boşluk kırpılır; gerisi TAM ve BÜYÜK-KÜÇÜK HARF DUYARLI eşleşme.
 *
 * Harf duyarlılığı bilinçli: PostgreSQL'de tırnaklı `"TeksErpDb"` ile `"tekserpdb"`
 * FARKLI veritabanlarıdır. Harf duyarsız kabul etmek, operatörün aslında okumadığı
 * bir adı onaylamasına izin verirdi.
 */
export function matchesConfirmation(value: string, expected: string): boolean {
  return value.trim() === expected.trim() && expected.trim().length > 0;
}

export function TypeToConfirm({
  expected,
  value,
  onChange,
  label,
  allowPaste = false,
  disabled,
}: Props) {
  const id = useId();
  const matched = matchesConfirmation(value, expected);
  const dirty = value.trim().length > 0;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-normal">
        {label ?? (
          <>
            Onaylamak için <code className="rounded bg-muted px-1 py-0.5 font-mono">{expected}</code>{" "}
            yazın
          </>
        )}
      </Label>
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={allowPaste ? undefined : (e) => e.preventDefault()}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={dirty && !matched}
          placeholder={expected}
          className={cn("pr-9 font-mono", matched && "border-success")}
        />
        {matched && (
          <Check
            aria-hidden
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-success"
          />
        )}
      </div>
      {dirty && !matched && (
        <p className="text-xs text-destructive">
          Yazdığınız metin eşleşmiyor (büyük/küçük harf dahil birebir olmalı).
        </p>
      )}
      {!allowPaste && <p className="text-xs text-muted-foreground">Yapıştırma kapalı — elle yazın.</p>}
    </div>
  );
}
