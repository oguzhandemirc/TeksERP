import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import {
  LOOKUP_CREATE,
  LOOKUP_CREATE_BLOCKED,
  type CreatedLookup,
} from "@/lib/import/lookup-create";

/**
 * "Eksik kaydı buradan yarat" — içe aktarım önizlemesindeki lookup hatasının
 * yanında açılan satır içi mini form (`QuickAddColor` kalıbı; yeni diyalog YOK).
 *
 * ⚠️ YALNIZ "bulunamadı" hatasında çizilir: çağıran, sunucunun yapısal
 * `issue.fix` ipucunu geçer. Belirsiz ad ve PASİF kayıt hatalarında ipucu
 * doğmaz — orada yaratmak, sırasıyla üçüncü bir mükerrer ve aktifleştirilmesi
 * gereken kaydın ikizini üretirdi.
 *
 * ⚠️ Mükerrer koruması `SimilarNamesWarning` ile: kullanıcı yazarken "şunlar
 * zaten var" listesi görünür. Bu, kataloğu kirletmeye karşı tek savunma ve
 * bir satır maliyeti var. Ad alanı ipucundaki değerle DOLU gelir ama
 * DÜZENLENEBİLİR — dosyada `MAVI` yazarken kataloğa `MAVİ` yazmak isteyebilir.
 */
export function QuickCreateLookup({
  entity,
  value,
  onCreated,
  alreadyCreatedCode,
}: {
  entity: string;
  value: string;
  onCreated: (created: CreatedLookup) => void;
  /** Bu değer bu oturumda zaten yaratıldıysa kodu — düğme yerine bilgi gösterilir. */
  alreadyCreatedCode?: string;
}) {
  const cfg = LOOKUP_CREATE[entity];
  const { hasPermission } = useRoleAccess();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(value);
  const [extra, setExtra] = useState(cfg?.extraField?.defaultValue ?? "");

  const createMut = useMutation({
    mutationFn: () => cfg!.create(name.trim(), extra || undefined),
    onSuccess: (created) => {
      for (const key of cfg!.queryKeys) void qc.invalidateQueries({ queryKey: key });
      setOpen(false);
      onCreated(created);
    },
    onError: (e) => {
      const msg = (e as { response?: { status?: number; data?: { message?: string } } })?.response;
      if (msg?.status === 409) {
        // 409 = ad zaten kayıtlı. Kırmızı bir "hata" değil, bir DURUM: kayıt
        // vardır, yalnız önizleme bayattır. Kullanıcıya yapılacak işi söyle.
        toast.info('Bu ad zaten kayıtlı. "Yeniden önizle" deyin, eşleşecektir.');
        setOpen(false);
        return;
      }
      toast.error(msg?.data?.message ?? "Kayıt oluşturulamadı.");
    },
  });

  // Bu değer zaten yaratıldı (başka bir satırdan) — ikinci yaratma 409 verirdi.
  if (alreadyCreatedCode) {
    return (
      <p className="flex items-center gap-1 text-xs text-success">
        <Info className="h-3 w-3 shrink-0" />
        {alreadyCreatedCode} oluşturuldu — "Yeniden önizle" deyin.
      </p>
    );
  }

  if (!cfg) {
    const reason = LOOKUP_CREATE_BLOCKED[entity];
    // Gri, tıklanabilir görünen ama hiçbir şey yapmayan bir düğme yerine SEBEP.
    return reason ? (
      <p className="flex items-start gap-1 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        {reason}
      </p>
    ) : null;
  }

  if (!hasPermission(cfg.permission)) {
    return (
      <p className="flex items-start gap-1 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        Buradan {cfg.label} açmak için <strong className="mx-1">{cfg.permission}</strong> yetkisi
        gerekir.
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-6 gap-1 px-2 text-xs"
        onClick={() => {
          setName(value);
          setOpen(true);
        }}
      >
        {/* ⚠️ `${label}ini` YAZILMAZ: Türkçede ünsüz yumuşaması var ("renk" →
            "rengini", "kumaş" → "kumaşını"). Ekli kalıp her etikette bozulurdu;
            nötr kalıp beşinde de doğru. */}
        <Plus className="h-3 w-3" /> "{value}" adıyla {cfg.label} oluştur
      </Button>
    );
  }

  const canSubmit = name.trim().length > 0 && !createMut.isPending;

  return (
    <div className="space-y-1.5 rounded-md border border-dashed p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) createMut.mutate();
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={`${cfg.label} adı`}
          className="h-7 max-w-[220px] text-xs"
        />
        {cfg.extraField && (
          <select
            className="h-7 rounded-md border bg-background px-1.5 text-xs"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            title={cfg.extraField.label}
          >
            {cfg.extraField.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" className="h-7 px-2 text-xs" disabled={!canSubmit} onClick={() => createMut.mutate()}>
          {createMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Ekle
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
      </div>
      <SimilarNamesWarning entity={cfg.apiEntity} name={name} />
      <p className="text-[11px] text-muted-foreground">
        Kaydedilince <strong>kodu</strong> hücreye yazılır ve aynı değeri taşıyan diğer satırlar da
        güncellenir.
      </p>
    </div>
  );
}
