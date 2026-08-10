import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { createAppRouter } from "./app/routes.js";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Web root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={createAppRouter()} />
  </StrictMode>,
);
