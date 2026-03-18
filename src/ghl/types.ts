// ─── GHL API response shapes ────────────────────────────────────────────────

export interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  source?: string;
  dateAdded?: string;
  customFields?: Record<string, string>;
}

export interface GHLMessage {
  id: string;
  type: "TYPE_SMS" | "TYPE_EMAIL" | "TYPE_CALL" | "TYPE_ACTIVITY" | string;
  body: string;
  direction: "inbound" | "outbound";
  dateAdded: string;
  status?: string;
}

export interface GHLConversation {
  id: string;
  contactId: string;
  locationId: string;
  lastMessageBody?: string;
  lastMessageDate?: string;
  type?: string;
  unreadCount?: number;
}

export interface GHLConversationDetail extends GHLConversation {
  messages: GHLMessage[];
  contact: GHLContact;
}

// ─── Internal agent types ───────────────────────────────────────────────────

export interface ScoredContact {
  contact: GHLContact;
  conversation: GHLConversationDetail;
  engagementScore: number;
  scoreRationale: string;
}

export interface FollowUpResult {
  contact: GHLContact;
  message: string;
  messageSent: boolean;
  pipelineMoved: boolean;
  errors: string[];
}
