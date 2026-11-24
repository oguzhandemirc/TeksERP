// Ürün penceresi atkı taslağı (B19): üç kip — "none" atkı yok · "new" bu kumaşa yeni atkı (kayıtta kart doğar) ·
// "card" var olan kart (`weftSpecId` form alanında). Kayıtlı kart (düzenlemede) içerik olarak düzenlenebilir; başka seçilen kart
// salt-okunur görünür, "kopyasını al" içeriği yeni atkıya taşır. Durum sekme değişince kaybolmasın diye pencerede tutulur.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { countWeftSpecUsers, weftSpecApi } from "@/pages/WeaveDesigns/service";
import { suggestForkCode, suggestForkName } from "@/pages/WeaveDesigns/tabs/weft-fork-defaults";
import { EMPTY_WEFT, weftContentBlank, weftContentReady, type WeftContent } from "@/pages/WeaveDesigns/tabs/WeftContentFields";
import { weftContentFromSpec } from "@/pages/WeaveDesigns/tabs/WeftSpecEditor";
import type { WeftSpecDetail } from "@/pages/WeaveDesigns/types";

export type WeftMode = "none" | "new" | "card";

export interface ItemWeftDraft {
  mode: WeftMode;
  /** Kip "card" iken seçili kart (form alanının aynası). */
  cardId: string | null;
  /** Düzenlemede kayıtlı kart — içeriği yalnız bunda düzenlenir. */
  savedCardId: string | null;
  content: WeftContent;
  touched: boolean;
  card: WeftSpecDetail | null;
  cardLoading: boolean;
  /** Seçili kartı kullanan ÖTEKİ kumaşlar (bu kumaş sayılmaz) — paylaşım bandı ve kayıttaki soru. */
  others: number;
  setContent: (c: WeftContent) => void;
  startNew: (prefill?: WeftContent) => void;
  pickCard: (id: string | null) => void;
  clear: () => void;
}

export function useItemWeftDraft(open: boolean, savedCardId: string | null): ItemWeftDraft {
  const [mode, setMode] = useState<WeftMode>(savedCardId ? "card" : "none");
  const [cardId, setCardId] = useState<string | null>(savedCardId);
  const [content, setContentState] = useState<WeftContent>(EMPTY_WEFT);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setMode(savedCardId ? "card" : "none");
    setCardId(savedCardId);
    setContentState(EMPTY_WEFT);
    setTouched(false);
  }, [open, savedCardId]);
  const cardQ = useQuery({
    queryKey: ["weft-specs", "detail", cardId],
    queryFn: () => weftSpecApi.get(cardId!),
    enabled: open && mode === "card" && !!cardId,
  });
  const usersQ = useQuery({
    queryKey: ["weft-specs", "users", cardId],
    queryFn: () => countWeftSpecUsers(cardId!),
    enabled: open && mode === "card" && !!cardId,
  });
  const others = mode === "card" && cardId ? Math.max(0, (usersQ.data ?? 0) - (cardId === savedCardId ? 1 : 0)) : 0;
  // Kart içeriği gelince (kullanıcı henüz yazmadıysa) forma.
  useEffect(() => {
    if (mode === "card" && cardQ.data && cardQ.data.id === cardId && !touched) setContentState(weftContentFromSpec(cardQ.data));
  }, [mode, cardId, cardQ.data, touched]);
  return {
    mode,
    cardId,
    savedCardId,
    content,
    touched,
    card: mode === "card" && cardQ.data?.id === cardId ? cardQ.data : null,
    cardLoading: cardQ.isLoading,
    others,
    setContent: (c) => {
      setContentState(c);
      setTouched(true);
    },
    startNew: (prefill) => {
      setMode("new");
      setCardId(null);
      setContentState(prefill ?? { ...EMPTY_WEFT, rows: [{ yarnItemId: "", picks: "" }] });
      setTouched(true);
    },
    pickCard: (id) => {
      setMode(id ? "card" : "none");
      setCardId(id);
      setContentState(EMPTY_WEFT);
      setTouched(false);
    },
    clear: () => {
      setMode("none");
      setCardId(null);
      setContentState(EMPTY_WEFT);
      setTouched(false);
    },
  };
}

/** Kayıtta atkı ne yapacak — saf karar (test edilir). */
export type WeftSavePlan =
  | { kind: "none" }
  | { kind: "link"; weftSpecId: string | null }
  | { kind: "create-with-item"; body: Record<string, unknown> }
  | { kind: "attach"; body: Record<string, unknown> }
  | { kind: "patch-card"; weftSpecId: string; body: Record<string, unknown> }
  | { kind: "fork-patch"; sourceId: string; code: string; name: string; body: Record<string, unknown> }
  | { kind: "invalid"; message: string };

/** Paylaşılan kart sorusu gerekir mi: kayıtlı kart değiştirildi VE başka kumaşlar da kullanıyor. */
export function needsShareQuestion(plan: WeftSavePlan, others: number): plan is Extract<WeftSavePlan, { kind: "patch-card" }> {
  return plan.kind === "patch-card" && others > 0;
}

/**
 * "Yalnız bu kumaş için kopya" seçimi: düzenleme kopyaya gider (`fork` tek ayırma yazıcısı, dokuma.md) — önerilen kod/ad
 * Desen > Atkı'daki "Bu desene özel kopya" ile aynı; kod doğal idempotency anahtarı (tekrar Kaydet aynı kopyayı bulur).
 */
export function toForkPlan(plan: Extract<WeftSavePlan, { kind: "patch-card" }>, card: { code: string; name: string }, itemCode: string): WeftSavePlan {
  return { kind: "fork-patch", sourceId: plan.weftSpecId, code: suggestForkCode(card.code, itemCode), name: suggestForkName(card.name, itemCode), body: plan.body };
}

export function planWeftSave(
  d: Pick<ItemWeftDraft, "mode" | "cardId" | "savedCardId" | "content" | "touched">,
  isEdit: boolean,
  build: (c: WeftContent) => Record<string, unknown>,
): WeftSavePlan {
  if (d.mode === "new") {
    if (weftContentBlank(d.content)) return { kind: "link", weftSpecId: null };
    if (!weftContentReady(d.content)) return { kind: "invalid", message: "Atkı: her satırda iplik seçin; sıra kodu yoksa rapordaki adeti girin." };
    return isEdit ? { kind: "attach", body: build(d.content) } : { kind: "create-with-item", body: build(d.content) };
  }
  if (d.mode === "card" && d.cardId) {
    if (isEdit && d.cardId === d.savedCardId && d.touched) {
      if (!weftContentReady(d.content)) return { kind: "invalid", message: "Atkı: her satırda iplik seçin; sıra kodu yoksa rapordaki adeti girin." };
      return { kind: "patch-card", weftSpecId: d.cardId, body: build(d.content) };
    }
    return { kind: "link", weftSpecId: d.cardId };
  }
  return { kind: "link", weftSpecId: null };
}
