// Bayi arayüzü girişi — genel dinleyicide /bayi altında sunulur (API /bayi/api).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router-dom";
import { AppRoot } from "../shared/AppRoot";
import "../shared/styles.css";
import { BAYI_PRODUCT, BAYI_ROUTES } from "./routes";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRoot base="/bayi/api" product={BAYI_PRODUCT} routes={BAYI_ROUTES} createRouter={(routes) => createBrowserRouter(routes, { basename: "/bayi" })} />
  </StrictMode>,
);
