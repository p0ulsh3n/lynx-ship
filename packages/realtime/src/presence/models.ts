import type {
  RealtimeError,
  RealtimeOptions,
  RealtimeSnapshot,
  RealtimeState,
} from "../client.js";

export const PRESENCE_PROTOCOL_VERSION = 1 as const;

export type PresenceAppState = "active" | "background";

export type PresenceKind = "typing" | "recording";

export interface PresenceEvent {
  conversationId: string;
  userId: string;
  kind: PresenceKind;
  active: boolean;
  expiresAt?: number;
}

export interface PresenceLifecycleSource {
  subscribe(listener: (state: PresenceAppState) => void): () => void;
}

export interface PresenceSnapshot {
  appState: PresenceAppState;
  typingConversations: number;
  recordingConversations: number;
  realtime: RealtimeSnapshot;
}

export interface PresenceProfile {
  displayName: string;
  avatarUrl?: string;
}

export interface PresenceActivityNotification {
  id: string;
  conversationId: string;
  userId: string;
  kind: PresenceKind;
  profile?: PresenceProfile;
  title: string;
  body: string;
  createdAt: number;
}

export interface PresenceActivityNotificationOptions {
  /** Do not notify for the signed-in user, even if the server echoes events. */
  selfUserId?: string;
  /** Return false for the conversation currently visible on screen. */
  shouldNotify?: (event: PresenceEvent) => boolean;
  onNotification: (notification: PresenceActivityNotification) => void;
  now?: () => number;
  dedupeMs?: number;
  windowMs?: number;
  maxPerWindow?: number;
}

export interface PresenceProfileUpdate {
  userId: string;
  profile: PresenceProfile;
}

export interface PresenceParticipant {
  userId: string;
  profile?: PresenceProfile;
  expiresAt: number;
}

export interface PresenceConversationSnapshot {
  conversationId: string;
  typing: PresenceParticipant[];
  recording: PresenceParticipant[];
}

export interface PresenceStateStoreOptions {
  now?: () => number;
  defaultTtlMs?: number;
  maxTtlMs?: number;
  maxParticipantsPerConversation?: number;
}

export interface PresenceOptions extends Omit<
  RealtimeOptions,
  "onMessage" | "onReady" | "onStateChange"
> {
  onEvent?: (event: PresenceEvent) => void;
  onProfileChange?: (update: PresenceProfileUpdate) => void;
  onConversationChange?: (snapshot: PresenceConversationSnapshot) => void;
  onError?: (error: RealtimeError) => void;
  onStateChange?: (state: RealtimeState) => void;
  typingIdleMs?: number;
  heartbeatMs?: number;
  maxActiveConversations?: number;
  closeOnBackground?: boolean;
  stateStore?: PresenceStateStore;
  activityNotifications?: PresenceActivityNotificationOptions;
}

import type { PresenceStateStore } from "./state-store.js";
