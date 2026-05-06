"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    view[i] = rawData.charCodeAt(i);
  }
  return view as Uint8Array<ArrayBuffer>;
}

export default function PushSubscriptionManager() {
  const t = useTranslations("Notifications");
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const isSupported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    setSupported(isSupported);

    if (!isSupported) {
      setLoading(false);
      return;
    }

    if (Notification.permission === "denied") {
      setDenied(true);
      setLoading(false);
      return;
    }

    // Check current subscription status
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setSubscribed(!!sub);
        setLoading(false);
      });
    });
  }, []);

  async function handleSubscribe() {
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setDenied(permission === "denied");
        return;
      }

      // Fetch VAPID public key at runtime — avoids baking it into the
      // JS bundle so cloud tenants can ship per-tenant keys without
      // rebuilding the image.
      const keyRes = await fetch("/api/push/public-key");
      if (!keyRes.ok) {
        console.error(
          "[push] VAPID key endpoint returned",
          keyRes.status,
          "— push not configured on this server"
        );
        return;
      }
      const { publicKey } = (await keyRes.json()) as { publicKey?: string };
      if (!publicKey) {
        console.error("[push] VAPID public key not configured");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const subJson = sub.toJSON();
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys?.p256dh,
            auth: subJson.keys?.auth,
          },
        }),
      });

      setSubscribed(true);
    } catch (err) {
      console.error("[push] Subscribe failed:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleUnsubscribe() {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }

      setSubscribed(false);
    } catch (err) {
      console.error("[push] Unsubscribe failed:", err);
    } finally {
      setLoading(false);
    }
  }

  if (!supported) return null;

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-base font-medium text-gray-900">
          {t("pushNotifications")}
        </p>
        <p className="text-sm text-gray-500">
          {denied
            ? t("pushDenied")
            : subscribed
              ? t("pushEnabled")
              : t("pushDisabled")}
        </p>
      </div>
      <button
        onClick={subscribed ? handleUnsubscribe : handleSubscribe}
        disabled={loading || denied}
        className={`px-5 py-3 text-base font-medium rounded-lg transition-colors ${
          subscribed
            ? "bg-gray-200 hover:bg-gray-300 text-gray-700"
            : "bg-blue-600 hover:bg-blue-700 text-white"
        } disabled:opacity-50`}
      >
        {loading
          ? "..."
          : subscribed
            ? t("disable")
            : t("enable")}
      </button>
    </div>
  );
}
