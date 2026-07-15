import "./style.css";

import { CertificationApp, type CertificationBrowserApi } from "./app.js";

declare global {
  interface Window {
    readonly avalCertification: CertificationBrowserApi;
  }
}

const root = document.querySelector<HTMLElement>("#certification-app");
if (root === null) throw new Error("certification app root is unavailable");
const api = new CertificationApp(root);
Object.defineProperty(window, "avalCertification", {
  value: api,
  configurable: false,
  enumerable: false,
  writable: false
});

void api.ready.catch((error: unknown) => {
  const status = root.querySelector<HTMLElement>("[data-certification-status]");
  if (status !== null) {
    status.dataset.status = "failed";
    status.textContent = error instanceof Error ? error.message : "certification harness failed to initialize";
  }
});
