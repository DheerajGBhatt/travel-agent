export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolUse?: string;
}

export interface WebSocketMessage {
  type: 'start' | 'chunk' | 'tool_use' | 'end' | 'error';
  text?: string;
  tool?: string;
  status?: string;
  error?: string;
  sessionId?: string;
}

export interface ChatState {
  messages: Message[];
  isConnected: boolean;
  isLoading: boolean;
  sessionId: string | null;
  error: string | null;
}
