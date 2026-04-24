export type Platform = 'telegram' | 'whatsapp';
export type UserState = 'IDLE' | 'AWAITING_QUERY' | 'AWAITING_EMAIL' | 'AWAITING_AUTO_QUESTION' | 'AWAITING_DOC_CLARIFICATION' | 'PROCESSING';

export interface UserContext {
  platform: Platform;
  id: string; // chatId for telegram, phone number for whatsapp
  state: UserState;
  
  // Investigation configuration
  selectedSolution?: string;
  topic?: string;
  
  // Buffers for email flow
  pendingQuery?: string;
  pendingDocumentPath?: string;
  pendingDocText?: string;
  
  // Auto-questions handling
  autoQuestions: string[];
  currentQuestionIndex: number;
  collectedAnswers: string[];
  
  lastActivityAt: number;
}

const stateMap = new Map<string, UserContext>();

/**
 * Normalizes the user ID across platforms
 */
export function getContextKey(platform: Platform, id: string | number): string {
  return `${platform}:${id}`;
}

export function getUserContext(platform: Platform, id: string | number): UserContext {
  const key = getContextKey(platform, id);
  if (!stateMap.has(key)) {
    stateMap.set(key, {
      platform,
      id: String(id),
      state: 'IDLE',
      autoQuestions: [],
      currentQuestionIndex: 0,
      collectedAnswers: [],
      lastActivityAt: Date.now(),
    });
  }
  
  const ctx = stateMap.get(key)!;
  ctx.lastActivityAt = Date.now();
  return ctx;
}

export function updateUserContext(platform: Platform, id: string | number, updates: Partial<UserContext>): UserContext {
  const ctx = getUserContext(platform, id);
  Object.assign(ctx, updates);
  ctx.lastActivityAt = Date.now();
  stateMap.set(getContextKey(platform, id), ctx);
  return ctx;
}

export function resetUserContext(platform: Platform, id: string | number): UserContext {
  return updateUserContext(platform, id, {
    state: 'IDLE',
    selectedSolution: undefined,
    topic: undefined,
    pendingDocText: undefined,
    autoQuestions: [],
    currentQuestionIndex: 0,
    collectedAnswers: [],
  });
}

// Clean up stale sessions (older than 1 hour)
setInterval(() => {
  const now = Date.now();
  for (const [key, ctx] of stateMap.entries()) {
    if (now - ctx.lastActivityAt > 60 * 60 * 1000) {
      stateMap.delete(key);
    }
  }
}, 5 * 60 * 1000);
