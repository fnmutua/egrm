import { and, eq } from 'drizzle-orm';
import { DeliveryError, sendEmail, sendSms } from '@egrm/notifications';
import { db, schema } from '../db/client.js';
import { decryptPII } from './crypto.js';
import { getActiveConfig } from './config.js';
import { env } from '../env.js';
export function renderTemplateBody(cfg, templateId, locale, channel, vars) {
    const tpl = cfg.templates.find((t) => t.id === templateId);
    const variant = tpl?.variants[locale]?.[channel] ??
        tpl?.variants.en?.[channel];
    const replace = (text) => text.replace(/\{\{([a-z_.]+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
    const body = replace(variant?.body ?? `[${templateId}]`);
    const subject = replace(variant?.subject ?? `Notification — ${vars['case.reference'] ?? ''}`);
    return { subject, body };
}
async function ancestorUnitIds(tenantId, unitId) {
    if (!unitId)
        return new Set();
    const units = await db
        .select({ id: schema.unit.id, parentId: schema.unit.parentId })
        .from(schema.unit)
        .where(eq(schema.unit.tenantId, tenantId));
    const byId = new Map(units.map((u) => [u.id, u.parentId]));
    const chain = new Set();
    let cur = unitId;
    while (cur) {
        chain.add(cur);
        cur = byId.get(cur) ?? null;
    }
    return chain;
}
async function resolveAddresses(tenantId, selector, channel, caseRow) {
    if (channel === 'in_app')
        return ['in_app'];
    if ('address' in selector && selector.address) {
        return [selector.address.trim()];
    }
    if ('party' in selector) {
        if (!caseRow.partyId)
            return [];
        const [party] = await db
            .select({ phoneEnc: schema.party.phoneEnc, emailEnc: schema.party.emailEnc })
            .from(schema.party)
            .where(eq(schema.party.id, caseRow.partyId))
            .limit(1);
        if (!party)
            return [];
        if (channel === 'sms') {
            const phone = decryptPII(party.phoneEnc);
            return phone ? [phone] : [];
        }
        if (channel === 'email') {
            const email = decryptPII(party.emailEnc);
            return email ? [email] : [];
        }
        return [];
    }
    if ('user' in selector) {
        const userId = selector.user === 'assignee' ? caseRow.assigneeId : null;
        if (!userId)
            return [];
        const [user] = await db
            .select({ email: schema.appUser.email })
            .from(schema.appUser)
            .where(eq(schema.appUser.id, userId))
            .limit(1);
        if (!user)
            return [];
        return channel === 'email' ? [user.email] : [];
    }
    if ('role' in selector) {
        const roleName = selector.role;
        const scope = selector.scope ?? 'case_unit';
        const assignments = await db
            .select({
            email: schema.appUser.email,
            unitId: schema.userRole.unitId,
        })
            .from(schema.userRole)
            .innerJoin(schema.role, eq(schema.userRole.roleId, schema.role.id))
            .innerJoin(schema.appUser, eq(schema.userRole.userId, schema.appUser.id))
            .where(and(eq(schema.role.tenantId, tenantId), eq(schema.role.name, roleName), eq(schema.appUser.active, true)));
        if (scope === 'tenant') {
            return [...new Set(assignments.map((a) => a.email).filter(Boolean))];
        }
        const caseChain = await ancestorUnitIds(tenantId, caseRow.unitId);
        const matched = assignments.filter((a) => {
            if (!a.unitId)
                return false;
            if (scope === 'case_unit')
                return a.unitId === caseRow.unitId;
            if (scope === 'unit_and_above')
                return caseChain.has(a.unitId);
            if (scope === 'level')
                return true;
            return false;
        });
        return [...new Set(matched.map((a) => a.email).filter(Boolean))];
    }
    return [];
}
async function buildTemplateVars(tenantId, caseRow) {
    const [identity, unitRow] = await Promise.all([
        getActiveConfig(tenantId, 'cd01_identity'),
        caseRow.unitId
            ? db.select({ name: schema.unit.name }).from(schema.unit).where(eq(schema.unit.id, caseRow.unitId)).limit(1)
            : Promise.resolve([]),
    ]);
    const tenantName = identity?.name ?? 'GRM';
    const trackUrl = `${env.PUBLIC_PORTAL_BASE_URL.replace(/\/$/, '')}/track?ref=${encodeURIComponent(caseRow.reference)}`;
    return {
        'case.reference': caseRow.reference,
        'case.status': caseRow.status,
        'case.status_label': caseRow.status,
        'case.level': caseRow.levelCode,
        'case.unit_name': unitRow[0]?.name ?? caseRow.levelCode,
        'tenant.name': tenantName,
        'tenant.short_name': tenantName.split(/\s+/)[0] ?? tenantName,
        'tracking.url': trackUrl,
        'tracking.link': caseRow.reference,
        'date.today': new Date().toISOString().slice(0, 10),
        'date.deadline': '',
    };
}
async function deliverMessage(cfg, channel, to, subject, body) {
    if (env.NOTIFICATIONS_DEV_LOG_ONLY) {
        console.log(`[notifications:dev] ${channel.toUpperCase()} → ${to}`);
        console.log(`  subject: ${subject}`);
        console.log(`  body: ${body.slice(0, 240)}${body.length > 240 ? '…' : ''}`);
        return { messageId: `dev-${Date.now()}`, provider: 'dev_log' };
    }
    if (channel === 'email') {
        return sendEmail(cfg.senders.email, { to, subject, body });
    }
    if (channel === 'sms') {
        return sendSms(cfg.senders.sms, { to, body });
    }
    if (channel === 'in_app') {
        return { messageId: `in_app-${Date.now()}`, provider: 'in_app' };
    }
    throw new DeliveryError(`Unsupported channel: ${channel}`, channel, false);
}
/** Process all queued notification_log rows for an outbox entry. */
export async function dispatchNotificationOutbox(outboxId) {
    const [outbox] = await db
        .select()
        .from(schema.notificationOutbox)
        .where(eq(schema.notificationOutbox.id, outboxId))
        .limit(1);
    if (!outbox || outbox.status === 'done')
        return;
    await db
        .update(schema.notificationOutbox)
        .set({ status: 'processing' })
        .where(eq(schema.notificationOutbox.id, outboxId));
    const logs = await db
        .select()
        .from(schema.notificationLog)
        .where(and(eq(schema.notificationLog.outboxId, outboxId), eq(schema.notificationLog.status, 'queued')));
    if (logs.length === 0) {
        await db
            .update(schema.notificationOutbox)
            .set({ status: 'done', processedAt: new Date() })
            .where(eq(schema.notificationOutbox.id, outboxId));
        return;
    }
    const cfg = await getActiveConfig(outbox.tenantId, 'cd09_notifications');
    if (!cfg) {
        await db
            .update(schema.notificationOutbox)
            .set({ status: 'failed', lastError: 'cd09_not_configured', processedAt: new Date() })
            .where(eq(schema.notificationOutbox.id, outboxId));
        return;
    }
    let caseRow = null;
    if (outbox.caseId) {
        const [c] = await db
            .select({
            id: schema.grmCase.id,
            reference: schema.grmCase.reference,
            status: schema.grmCase.status,
            levelCode: schema.grmCase.levelCode,
            unitId: schema.grmCase.unitId,
            partyId: schema.grmCase.partyId,
            assigneeId: schema.grmCase.assigneeId,
        })
            .from(schema.grmCase)
            .where(eq(schema.grmCase.id, outbox.caseId))
            .limit(1);
        caseRow = c ?? null;
    }
    const vars = caseRow
        ? await buildTemplateVars(outbox.tenantId, caseRow)
        : {
            'case.reference': '',
            'case.status': '',
            'case.status_label': '',
            'case.level': '',
            'case.unit_name': '',
            'tenant.name': 'GRM',
            'tenant.short_name': 'GRM',
            'tracking.url': env.PUBLIC_PORTAL_BASE_URL,
            'tracking.link': '',
            'date.today': new Date().toISOString().slice(0, 10),
            'date.deadline': '',
        };
    let failures = 0;
    for (const log of logs) {
        const selector = log.recipientSelector;
        if (!selector || !caseRow) {
            await db
                .update(schema.notificationLog)
                .set({ status: 'failed:no_recipient', updatedAt: new Date(), attempts: log.attempts + 1 })
                .where(eq(schema.notificationLog.id, log.id));
            failures += 1;
            continue;
        }
        const addresses = await resolveAddresses(outbox.tenantId, selector, log.channel, caseRow);
        if (addresses.length === 0) {
            await db
                .update(schema.notificationLog)
                .set({ status: 'failed:no_recipient', updatedAt: new Date(), attempts: log.attempts + 1 })
                .where(eq(schema.notificationLog.id, log.id));
            failures += 1;
            continue;
        }
        const { subject, body } = renderTemplateBody(cfg, log.templateId, log.locale, log.channel, vars);
        let lastMessageId;
        let sent = 0;
        let lastError;
        for (const to of addresses) {
            try {
                const result = await deliverMessage(cfg, log.channel, to, subject, body);
                lastMessageId = result.messageId;
                sent += 1;
            }
            catch (err) {
                lastError = err instanceof Error ? err.message : String(err);
            }
        }
        if (sent > 0) {
            await db
                .update(schema.notificationLog)
                .set({
                status: sent === addresses.length ? 'sent' : 'sent:partial',
                providerMessageId: lastMessageId,
                renderedPreview: body.slice(0, 500),
                updatedAt: new Date(),
                attempts: log.attempts + 1,
            })
                .where(eq(schema.notificationLog.id, log.id));
        }
        else {
            await db
                .update(schema.notificationLog)
                .set({
                status: 'failed',
                renderedPreview: `${body.slice(0, 400)} [err: ${(lastError ?? 'unknown').slice(0, 80)}]`,
                updatedAt: new Date(),
                attempts: log.attempts + 1,
            })
                .where(eq(schema.notificationLog.id, log.id));
            failures += 1;
        }
    }
    await db
        .update(schema.notificationOutbox)
        .set({
        status: failures > 0 && failures === logs.length ? 'failed' : 'done',
        lastError: failures > 0 ? `${failures} delivery failure(s)` : null,
        processedAt: new Date(),
        attempts: outbox.attempts + 1,
    })
        .where(eq(schema.notificationOutbox.id, outboxId));
}
//# sourceMappingURL=notification-dispatch.js.map