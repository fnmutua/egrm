/** Dispatch notification outbox inline in the API process (no BullMQ/Redis queue). */
export declare function scheduleOutboxDispatch(outboxId: string): Promise<void>;
