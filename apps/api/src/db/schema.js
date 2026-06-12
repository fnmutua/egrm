import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
/** Phase 0 schema: tenancy kernel, auth, config registry, audit (specs 02, 03, 07). */
export const tenant = pgTable('tenant', {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    hostnames: text('hostnames').array().notNull().default([]),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const appUser = pgTable('app_user', {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('app_user_tenant_email').on(t.tenantId, t.email)]);
export const role = pgTable('role', {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    name: text('name').notNull(),
    /** Permission patterns from the platform catalogue, wildcards allowed (e.g. case:*). */
    permissions: text('permissions').array().notNull().default([]),
    /** Sensitivity class codes this role may read/handle (from CD-10). */
    sensitiveClasses: text('sensitive_classes').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('role_tenant_name').on(t.tenantId, t.name)]);
export const userRole = pgTable('user_role', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => appUser.id),
    roleId: uuid('role_id').notNull().references(() => role.id),
    /** Jurisdiction scoping arrives with the unit tree in Phase 1; null = tenant-wide. */
    unitId: uuid('unit_id'),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validTo: timestamp('valid_to', { withTimezone: true }),
}, (t) => [uniqueIndex('user_role_unique').on(t.userId, t.roleId, t.unitId)]);
export const configVersion = pgTable('config_version', {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    domain: text('domain').notNull(),
    version: integer('version').notNull(),
    status: text('status', { enum: ['draft', 'active', 'retired'] }).notNull().default('draft'),
    payload: jsonb('payload').notNull(),
    changeNote: text('change_note'),
    changedBy: uuid('changed_by').references(() => appUser.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
}, (t) => [uniqueIndex('config_version_unique').on(t.tenantId, t.domain, t.version)]);
/** Jurisdiction unit tree (CD-02 instances): arbitrary-depth hierarchy per tenant. */
export const unit = pgTable('unit', {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    levelCode: text('level_code').notNull(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    code: text('code').notNull(),
    active: boolean('active').notNull().default(true),
}, (t) => [uniqueIndex('unit_tenant_code').on(t.tenantId, t.code)]);
/** Complainant/representative. PII columns are AES-GCM encrypted; *_hash are HMAC lookup digests (GEN-SEC-05). */
export const party = pgTable('party', {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    nameEnc: text('name_enc'),
    phoneEnc: text('phone_enc'),
    emailEnc: text('email_enc'),
    phoneHash: text('phone_hash'),
    emailHash: text('email_hash'),
    gender: text('gender'),
    ageBand: text('age_band'),
    vulnerabilityTags: text('vulnerability_tags').array(),
    preferredLanguage: text('preferred_language'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const grmCase = pgTable('grm_case', {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    reference: text('reference').notNull(),
    caseType: text('case_type').notNull().default('grievance'),
    status: text('status').notNull(),
    statusTag: text('status_tag').notNull(),
    levelCode: text('level_code').notNull(),
    unitId: uuid('unit_id').references(() => unit.id),
    partyId: uuid('party_id').references(() => party.id),
    anonymous: boolean('anonymous').notNull().default(false),
    channel: text('channel').notNull().default('web'),
    categories: text('categories').array().notNull().default([]),
    sensitivity: text('sensitivity').notNull().default('standard'),
    priority: text('priority').notNull().default('normal'),
    summary: text('summary').notNull(),
    description: text('description'),
    expectedOutcome: text('expected_outcome'),
    dateOccurred: timestamp('date_occurred', { withTimezone: true }),
    consent: boolean('consent').notNull().default(false),
    /** HMAC of the tracking verifier (submitter phone/email, or one-time PIN for anonymous cases). */
    verifierHash: text('verifier_hash'),
    assigneeId: uuid('assignee_id').references(() => appUser.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('grm_case_tenant_reference').on(t.tenantId, t.reference)]);
/** Append-only case event stream: lifecycle, thread, edits (spec 03). */
export const caseEvent = pgTable('case_event', {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    caseId: uuid('case_id').notNull().references(() => grmCase.id),
    kind: text('kind', {
        enum: ['created', 'status_changed', 'message_external', 'note_internal', 'field_edited', 'assigned'],
    }).notNull(),
    actorType: text('actor_type', { enum: ['complainant', 'staff', 'system'] }).notNull(),
    actorId: uuid('actor_id'),
    visibility: text('visibility', { enum: ['public', 'internal'] }).notNull().default('internal'),
    data: jsonb('data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
/** Concurrency-safe reference allocation (GEN-INT-08): one row per tenant × scope key. */
export const caseSequence = pgTable('case_sequence', {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    scopeKey: text('scope_key').notNull(),
    nextValue: integer('next_value').notNull().default(1),
}, (t) => [uniqueIndex('case_sequence_scope').on(t.tenantId, t.scopeKey)]);
export const auditEvent = pgTable('audit_event', {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    data: jsonb('data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
/** Notification outbox — enqueued inside case-action transactions (spec 06 §2). */
export const notificationOutbox = pgTable('notification_outbox', {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    caseId: uuid('case_id').references(() => grmCase.id),
    eventKind: text('event_kind').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: ['pending', 'processing', 'done', 'failed'] }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
});
/** Every send attempt — including suppressed (spec 06 §3, spec 03 §2.9). */
export const notificationLog = pgTable('notification_log', {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    caseId: uuid('case_id').references(() => grmCase.id),
    outboxId: uuid('outbox_id').references(() => notificationOutbox.id),
    eventKind: text('event_kind').notNull(),
    ruleId: text('rule_id'),
    recipientSelector: jsonb('recipient_selector'),
    recipientKind: text('recipient_kind').notNull(),
    recipientAddressHash: text('recipient_address_hash'),
    channel: text('channel').notNull(),
    templateId: text('template_id').notNull(),
    locale: text('locale').notNull().default('en'),
    renderedPreview: text('rendered_preview'),
    status: text('status').notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
//# sourceMappingURL=schema.js.map