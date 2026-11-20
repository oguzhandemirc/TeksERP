// =============================================================================
// DEVERE İADE PENCERESİ PARÇALARI — iade sebebi açılır listesi (iade + kapanış ortak), iade deposu, canlı özet,
// önizleme notları (tolerans aşımı onayı · otomatik kapanış bilgisi). Hesap/karar sunucuda; burada yalnız biçim.
// =============================================================================
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { reasonPresetService } from "@/pages/ReasonPresets/service";
import { fmtKg } from "./order-model";
import { SourcePicker } from "./YarnSourcePickers";
import { parsePieceCount, type PickedRef } from "./dispatch-model";
import type { WarpingYarnReturnPreview } from "./holding-types";

/** İade sebebi — `YARN_SUBCONTRACT_RETURN` kataloğundan açılır liste (iade ve kapanış penceresi aynı bileşen). */
export function ReasonSelect({ id, value, onChange }: { id?: string; value: string; onChange: (c: string) => void }) {
  const q = useQuery({ queryKey: ["reason-presets", "YARN_SUBCONTRACT_RETURN", "devere"], queryFn: () => reasonPresetService.list(false) });
  const reasons = useMemo(() => (q.data ?? []).filter((p) => p.kind === "YARN_SUBCONTRACT_RETURN" && p.isActive), [q.data]);
  if (!q.isLoading && reasons.length === 0) return <Callout tone="warning">Katalogda “Fasondan iplik dönüşü” sebebi yok — Tanımlar › Sebep Kataloğu’ndan ekleyin.</Callout>;
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={q.isLoading}>
      <SelectTrigger id={id} aria-label="İade sebebi">
        <SelectValue placeholder={q.isLoading ? "Sebepler yükleniyor…" : "Sebep seçin"} />
      </SelectTrigger>
      <SelectContent>
        {reasons.map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function ReturnWarehouseField({ exitName, value, onChange }: { exitName: string; value: PickedRef | null; onChange: (v: PickedRef | null) => void }) {
  const { multiWarehouse, warehouses } = useMultiWarehouse();
  if (!multiWarehouse) return null;
  return (
    <FormField label="İade deposu" info={`Boş bırakılırsa sevkin çıkış deposu (${exitName}).`}>
      <SourcePicker title="İade deposu" description="İplik bu depoya geri girer." placeholder={`Çıkış deposu — ${exitName}`} ariaLabel="İade deposu seç"
        value={value} onChange={onChange} clearable queryKey={["warping-return", "warehouses", warehouses.length]} emptyText="Aktif depo yok."
        load={async () => warehouses.map((w) => ({ id: w.id, label: w.name, hint: w.code, balanceKg: null }))} />
    </FormField>
  );
}

const PIECE_INFO = "Bilgi amaçlıdır (defter değil): iade belgesinde görünür, sayımı kolaylaştırır. Stok ve kapanış yalnız kg ile hesaplanır; boş bırakılabilir.";

/** Koli / bobin adedi — iki kısa alan; geçersiz girdide alan altı uyarı (boş ya da pozitif tam sayı). */
export function PieceCountFields({ packageCount, bobbinCount, onPackage, onBobbin }: { packageCount: string; bobbinCount: string; onPackage: (v: string) => void; onBobbin: (v: string) => void }) {
  const err = (v: string) => (parsePieceCount(v).ok ? undefined : { message: "Boş ya da sıfırdan büyük tam sayı." });
  return (
    <>
      <FormField label="Koli adedi" htmlFor="wr-packages" error={err(packageCount)} info={PIECE_INFO}>
        <Input id="wr-packages" inputMode="numeric" placeholder="Boş = girilmedi" value={packageCount} onChange={(e) => onPackage(e.target.value)} />
      </FormField>
      <FormField label="Bobin adedi" htmlFor="wr-bobbins" error={err(bobbinCount)} info={PIECE_INFO}>
        <Input id="wr-bobbins" inputMode="numeric" placeholder="Boş = girilmedi" value={bobbinCount} onChange={(e) => onBobbin(e.target.value)} />
      </FormField>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "muted" }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-base font-semibold tabular-nums", tone === "warn" && "text-amber-700 dark:text-amber-400", tone === "muted" && "text-muted-foreground")}>{value}</dd>
    </div>
  );
}

/** Canlı özet — girişten hesaplanır (ön bilgi); kesin sonucu sunucu yazar. */
export function ReturnSummary({ qty, waste, keep, warehouseName }: { qty: number; waste: number; keep: number; warehouseName: string }) {
  return (
    <dl className="grid grid-cols-3 gap-3" aria-label="İade özeti">
      <Stat label={`Depoya girer (${warehouseName})`} value={`${fmtKg(qty)} kg`} />
      <Stat label="Fire yazılır" value={waste > 0 ? `${fmtKg(waste)} kg` : "—"} tone={waste > 0 ? "warn" : "muted"} />
      <Stat label="Deverecide kalacak" value={`${fmtKg(keep)} kg`} tone={keep > 0 ? undefined : "muted"} />
    </dl>
  );
}

const pct = (v: string | null) => (v === null ? "—" : `%${formatQty(v, 2)}`);

/** Önizleme notları: tolerans aşımında uyarı + onay kutusu; kalan sıfırlanıyorsa "sipariş kapanır" bilgisi. */
export function ReturnPreviewNotes({ p, ack, onAck }: { p: WarpingYarnReturnPreview; ack: boolean; onAck: (v: boolean) => void }) {
  return (
    <>
      {p.overTolerance && (
        <Callout tone="warning" title="Fire toleransı aşıyor">
          {p.warnings.length > 0
            ? <ul className="list-disc pl-4" aria-label="Uyarılar">{p.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            : <p>Bu ipliğin firesi {pct(p.wastePct)} — sipariş toleransı {pct(p.tolerancePct)}.</p>}
          <p className="mt-1">Kayıt engellenmez; kontrol edip onaylayın.</p>
          <div className="mt-2 flex items-center gap-2">
            <Checkbox id="wr-ack-over" checked={ack} onCheckedChange={(v) => onAck(v === true)} />
            <label htmlFor="wr-ack-over" className="cursor-pointer font-medium">Toleransı aştığını gördüm, yine de kaydet</label>
          </div>
        </Callout>
      )}
      {p.willClose && (
        <Callout tone="info" title="Kaydedince sipariş kapanır">
          Bu iadeyle siparişin deverecide ipliği kalmıyor; sipariş “Tamamlandı” olur. Gerekirse sipariş sayfasından yeniden açılabilir.
        </Callout>
      )}
    </>
  );
}
