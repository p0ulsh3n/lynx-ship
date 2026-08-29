/** Public realtime barrel. Transport implementation lives in client.ts. */
export * from "./client.js";

export {
  PRESENCE_PROTOCOL_VERSION,
  PresenceClient,
  createPresenceClient,
  type PresenceAppState,
  type PresenceEvent,
  type PresenceKind,
  type PresenceLifecycleSource,
  type PresenceOptions,
  type PresenceSnapshot,
  type PresenceConversationSnapshot,
  type PresenceParticipant,
  type PresenceProfile,
  type PresenceProfileUpdate,
  type PresenceStateStoreOptions,
  PresenceStateStore,
  PresenceActivityNotifier,
  type PresenceActivityNotification,
  type PresenceActivityNotificationOptions,
} from "./presence.js";

export {
  RECEIPT_PROTOCOL_VERSION,
  InMemoryReadReceiptStore,
  ReadReceiptClient,
  createReadReceiptClient,
  type ReadReceiptEvent,
  type ReadReceiptKind,
  type ReadReceiptMessageSnapshot,
  type ReadReceiptOptions,
  type ReadReceiptStore,
  type ReadReceiptStoreOptions,
} from "./receipts.js";

export {
  ActivityStack,
  PresenceActivityStack,
  type ActivityStackEntry,
  type ActivityStackItem,
  type ActivityStackOptions,
  type ActivityStackSnapshot,
} from "./activity-stack.js";
