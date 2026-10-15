import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { AxiosError } from "axios";
import { renderOutsideRouter } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import { useTabsStore } from "@/store/tabs";

/**
 * Panel 1.6.5 saha hatası: kart kabukta (Router DIŞINDA) çizilir; pencere `useNavigate()` çağırınca
 * destek hesabı + yönetici yokken kabuk çöküyordu. Bu dosya MemoryRouter'sız çizer — üretimdeki gibi.
 */
const api = vi.hoisted(() => ({ createFactoryAdmin: vi.fn() }));
vi.mock("@/services/adminUserService", () => ({ adminUserService: api }));

import { FactoryAdminCard } from "./FactoryAdminCard";
import { ShellBanners } from "./ShellBanners";

const refresh = vi.fn(async () => undefined);
const openTab = vi.fn();

beforeEach(() => {
  api.createFactoryAdmin.mockReset();
  refresh.mockClear();
  openTab.mockClear();
  useAuthStore.setState({ isSystemAccount: true, factoryAdminExists: false, refreshSystemAccount: refresh });
  useTabsStore.setState({ openTab });
});

describe("FactoryAdminCard — Router dışı (kabuk düzeyi)", () => {
  it("destek hesabı + yönetici yok: kart çizilir, çökmez", () => {
    renderOutsideRouter(<FactoryAdminCard />);
    expect(screen.getByTestId("fabrika-yoneticisi-karti")).toBeTruthy();
  });

  it("ShellBanners yığını Router olmadan çizilir ve kartı taşır", () => {
    renderOutsideRouter(<ShellBanners />);
    expect(screen.getByTestId("fabrika-yoneticisi-karti")).toBeTruthy();
  });

  it("409 FACTORY_ADMIN_EXISTS → 'Kullanıcılar ekranına git' kullanıcılar sekmesini açar, pencere kapanır", async () => {
    api.createFactoryAdmin.mockRejectedValue(
      new AxiosError("409", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 409,
        data: { success: false, message: "Fabrika yöneticisi zaten açılmış.", details: { code: "FACTORY_ADMIN_EXISTS" } },
      } as never),
    );
    renderOutsideRouter(<FactoryAdminCard />);
    fireEvent.click(screen.getByRole("button", { name: "Fabrika yöneticisini aç" }));
    fireEvent.change(screen.getByLabelText(/Kullanıcı Adı/), { target: { value: "mehmet" } });
    fireEvent.change(screen.getByLabelText(/Ad Soyad/), { target: { value: "Mehmet Yılmaz" } });
    fireEvent.click(screen.getByRole("button", { name: "Hesabı aç" }));
    fireEvent.click(await screen.findByRole("button", { name: "Kullanıcılar ekranına git" }));
    expect(openTab).toHaveBeenCalledTimes(1);
    expect(openTab).toHaveBeenCalledWith("/access/users");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Fabrika yöneticisi zaten açılmış")).toBeNull();
  });
});
