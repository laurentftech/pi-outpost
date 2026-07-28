import { useEffect } from "react";
import type { ExtensionNotification } from "../useAgent";

const STYLES: Record<NonNullable<ExtensionNotification["notifyType"]>, string> = {
  info: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-200",
  warning: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
  error: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200",
};

function NotificationToast({ notification, onDismiss }: { notification: ExtensionNotification; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className={`rounded-lg border px-3 py-2 text-sm shadow-lg ${STYLES[notification.notifyType ?? "info"]}`}>
      {notification.message}
    </div>
  );
}

/** Toast stack for extension notify() calls — see extensions.md#custom-ui. */
export function ExtensionNotifications({
  notifications,
  onDismiss,
}: {
  notifications: ExtensionNotification[];
  onDismiss: (id: string) => void;
}) {
  if (notifications.length === 0) return null;
  return (
    <div className="fixed right-4 top-16 z-40 flex w-80 flex-col gap-2">
      {notifications.map((n) => (
        <NotificationToast key={n.id} notification={n} onDismiss={() => onDismiss(n.id)} />
      ))}
    </div>
  );
}
