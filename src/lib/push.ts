/** 推播權限狀態（契約 §6.4 的 6 種）與訂閱流程。 */
import { api } from "../api/watch";
import { S } from "../state";
import type { PushDevice } from "../types";

export type PushState = "unsupported" | "not_installed" | "default" | "granted" | "revoked" | "denied";

const mockPush = () => (import.meta.env.VITE_USE_MOCK === "1" ? ((globalThis as any).__mock?.push as string | undefined) : undefined);

export function isStandalone() {
  return matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
function isIOS() { return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }

export function pushState(devices: PushDevice[] | null): PushState {
  const m = mockPush();
  if (m && m !== "auto") return m as PushState;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return isIOS() && !isStandalone() ? "not_installed" : "unsupported";
  if (isIOS() && !isStandalone()) return "not_installed";
  const perm = Notification.permission;
  if (perm === "denied") return "denied";
  if (perm === "default") return "default";
  const cur = devices?.find((d) => d.is_current);
  if (!cur || cur.state !== "active") return "revoked";
  return "granted";
}

function b64ToBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** 必須由使用者點擊觸發 */
export async function enablePush(): Promise<PushDevice> {
  if (mockPush()) { (globalThis as any).__mock.setPush("granted"); return api.subscribe({ endpoint: "https://push.example/mock", keys: { p256dh: "mock", auth: "mock" }, device_label: deviceLabel() }); }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "已拒絕通知" : "尚未允許通知");
  const reg = await navigator.serviceWorker.ready;
  const old = await reg.pushManager.getSubscription();
  if (old) await old.unsubscribe().catch(() => {});
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(S.boot!.channels.push.vapid_public_key) });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  return api.subscribe({ endpoint: j.endpoint, keys: j.keys, device_label: deviceLabel() });
}
export function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "這台裝置";
}
