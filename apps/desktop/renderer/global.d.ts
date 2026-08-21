import type { DesktopApi } from "../shared/ipc.js";

declare global {
  interface Window {
    chatcomDesktop: DesktopApi;
  }
}

export {};
