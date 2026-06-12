import type { Cd09Notifications } from '@egrm/config-schemas';
export declare function renderTemplateBody(cfg: Cd09Notifications, templateId: string, locale: string, channel: string, vars: Record<string, string>): {
    subject: string;
    body: string;
};
/** Process all queued notification_log rows for an outbox entry. */
export declare function dispatchNotificationOutbox(outboxId: string): Promise<void>;
//# sourceMappingURL=notification-dispatch.d.ts.map