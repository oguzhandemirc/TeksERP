import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Package } from "lucide-react";
import { HubCard } from "./HubCard";

/**
 * HUB KARTI TIKLAMA SÖZLEŞMESİ (2026-08-22 kullanıcı kararı).
 *
 * Kart eskiden kenar menüsüyle aynı davranıyordu (`openTab`) → her tık YENİ SEKME:
 * şerit doluyor ve yeni sekmenin geçmişi tek girişlik olduğu için geri oku sekme
 * geçmişine basamıyordu. Hub kartı aynı işin bir adımıdır → yerinde iner.
 */

const openTab = vi.fn();
const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: { openTab: unknown; navigateActive: unknown }) => unknown) =>
    sel({ openTab, navigateActive }),
}));

const card = () => screen.getByRole("button", { name: /Envanter/ });

beforeEach(() => {
  openTab.mockClear();
  navigateActive.mockClear();
  render(<HubCard to="/operations/rolls" title="Envanter" description="" icon={Package} />);
});

describe("HubCard", () => {
  it("sol tık: AYNI sekmede açar (yeni sekme açmaz)", () => {
    fireEvent.click(card());
    expect(navigateActive).toHaveBeenCalledWith("/operations/rolls", { state: undefined });
    expect(openTab).not.toHaveBeenCalled();
  });

  it("sağ tık: arka planda YENİ sekme (kullanıcı hub'da kalır)", () => {
    fireEvent.contextMenu(card());
    expect(openTab).toHaveBeenCalledWith("/operations/rolls", {
      forceNew: true,
      state: undefined,
      background: true,
    });
    expect(navigateActive).not.toHaveBeenCalled();
  });

  it("ctrl/shift + sol tık: yeni sekme (öne alınır)", () => {
    fireEvent.click(card(), { ctrlKey: true });
    expect(openTab).toHaveBeenCalledWith("/operations/rolls", {
      forceNew: true,
      state: undefined,
      background: false,
    });
    expect(navigateActive).not.toHaveBeenCalled();
  });

  it("orta tık: arka planda yeni sekme", () => {
    // `fireEvent.auxClick` bu sürümde yok — olayı elle kur (React onAuxClick dinler).
    fireEvent(card(), new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
    expect(openTab).toHaveBeenCalledWith("/operations/rolls", {
      forceNew: true,
      state: undefined,
      background: true,
    });
  });
});
