import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./apple.css";
import "./content-refinements.css";
import "./flowus.css";
import "./about.css";
import "./site-refinements.css";
import "./home-satellite.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
