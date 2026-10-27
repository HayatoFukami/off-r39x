import "./styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { routes } from "./routes/route-table";

// Entry point of the static SPA (DEV-WEB-001): the first render is a client render, so every container
// starts from its loading state. No mock code is imported here; ports are chosen by the port factories.
const container = document.getElementById("root");
if (container === null) throw new Error("root element not found");

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter(routes)} />
  </StrictMode>,
);
