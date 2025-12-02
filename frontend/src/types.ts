// API Request/Response Types

export interface InteractRequest {
  prompt: string;
  enhancerEnabled: boolean;
  mode: "learning" | "socratic" | null;
  conversationId?: string | null;
}

export interface InteractResponse {
  interaction_id: string;
  conversationId: string;
  intent: string | null;
  topic: string | null;
  rewritten_prompt: string | null;
  rewrite_strategy: string | null;
  decisionRationale: string;
  promptFeedback: string | null; // Formatted bullet points explaining what changed and why
  final_answer: string | null; // null if enhancerEnabled is true (answer generated later via /answer)
}

