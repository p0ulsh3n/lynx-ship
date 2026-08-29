# @lynxship/queue

Server-side queue contracts with expiring leases, acknowledgement, retry and
dead-letter states. The in-memory `LeaseQueue` is deterministic for tests and
single-process development; the Redis adapter provides durable cross-process
queue operations when a Redis service is configured.

This package is not a client-side dependency and does not replace worker
isolation, authorization or persistent job records.
