"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@/components/ui";

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

/**
 * One button for push notifications on this device. Rendered only when the
 * browser supports push (nothing at all otherwise).
 */
export default function PushSubscriptionManager() {
  const t = useTranslations("Notifications");
  const tp = useTranslations("ProfileHub");
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

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

    navigator.serviceWorker.ready
      .then((reg) =>
        reg.pushManager.getSubscription().then((sub) => {
          setSubscribed(!!sub);
        }),
      )
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSubscribe() {
    setLoading(true);
    setFailed(false);
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
        console.error("[push] VAPID key endpoint returned", keyRes.status, "— push not configured on this server");
        setFailed(true);
        return;
      }
      const { publicKey } = (await keyRes.json()) as { publicKey?: string };
      if (!publicKey) {
        console.error("[push] VAPID public key not configured");
        setFailed(true);
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
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleUnsubscribe() {
    setLoading(true);
    setFailed(false);
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
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  if (!supported) return null;

  return (
    <div className="space-y-2">
      {subscribed ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-base font-medium text-ui-text">
            <Icon name="check" size={20} className="text-ui-success" />
            {t("pushEnabled")}
          </p>
          <Button variant="secondary" onClick={handleUnsubscribe} loading={loading}>
            {tp("pushDisableHere")}
          </Button>
        </div>
      ) : (
        <Button onClick={handleSubscribe} loading={loading} disabled={denied}>
          <Icon name="bell" size={20} />
          {tp("pushEnableHere")}
        </Button>
      )}
      {denied ? <p className="text-base text-ui-text-muted">{t("pushDenied")}</p> : null}
      {failed ? (
        <p role="alert" className="text-base font-medium text-ui-danger">
          {tp("pushFailed")}
        </p>
      ) : null}
    </div>
  );
}
