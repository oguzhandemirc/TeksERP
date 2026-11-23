import { Palette } from "lucide-react";
import { Callout } from "@/components/ui/callout";
import type { ShadeMixGroup } from "./types";

/** Sunucunun `[SHADE_MIX]` uyarı satırı — yapılandırılmış kutu çizildiğinde düz listede tekrar etmez. */
export const SHADE_MIX_PREFIX = "[SHADE_MIX]";

interface Props {
  groups: ShadeMixGroup[];
  policy: "off" | "warn" | "block" | undefined;
}

/**
 * Ton grubu karışımı — aynı ürün+renge farklı ton harfi giden toplar. Her ürün satırında tonlar ve
 * barkodları görünür: operatör hangi çuvalı ayıracağını buradan bulur. `block`ta Sevk Et sunucuda 409 alır.
 */
export function ShadeMixCallout({ groups, policy }: Props) {
  if (groups.length === 0) return null;
  const blocked = policy === "block";
  return (
    <Callout
      tone={blocked ? "danger" : "warning"}
      icon={Palette}
      title={blocked ? "Karışık ton — bu sevk gönderilemez" : "Karışık ton — müşteride ton farkı görünebilir"}
    >
      <ul className="mt-1 space-y-1.5">
        {groups.map((g) => (
          <li key={`${g.itemId}|${g.colorId ?? ""}`}>
            <span className="font-medium">{[g.itemName, g.colorName].filter(Boolean).join(" / ") || "Ürün"}</span>
            <span className="text-muted-foreground"> — {g.shades.length} farklı ton</span>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              {g.shades.map((s) => (
                <span key={s}>
                  <span className="mr-1 inline-flex h-5 min-w-5 items-center justify-center rounded bg-foreground/10 px-1 font-semibold">{s}</span>
                  <span className="font-mono">{(g.rollsByShade[s] ?? []).join(", ")}</span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs">
        Aynı tonları ayrı sevke ayırın ya da yanlış girilen tonu Envanter → Toplar → “Ton ata” ile düzeltin.
      </p>
    </Callout>
  );
}
