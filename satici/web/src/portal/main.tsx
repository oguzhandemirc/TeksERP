// Satıcı arayüzü girişi — tailnet dinleyicisinde /portal altında sunulur (API /portal/api).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router-dom";
import { AppRoot } from "../shared/AppRoot";
import "../shared/styles.css";
import { PORTAL_PRODUCT, PORTAL_ROUTES } from "./routes";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRoot base="/portal/api" product={PORTAL_PRODUCT} routes={PORTAL_ROUTES} createRouter={(routes) => createBrowserRouter(routes, { basename: "/portal" })} />
  </StrictMode>,
);
