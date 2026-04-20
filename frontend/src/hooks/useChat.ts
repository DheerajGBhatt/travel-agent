import { useState, useEffect, useCallback, useRef } from 'react';
import { type Message, type WebSocketMessage, type ChatState } from '../types/chat';
import { websocketService } from '../services/websocket';

export function useChat() {
  const userId = useRef('1');
  const [state, setState] = useState<ChatState>({
    messages: [],
    isConnected: false,
    isLoading: false,
    sessionId: null,
    error: null,
  });

  const currentMessageRef = useRef<string>('');
  const messageIdRef = useRef<string | null>(null);

  const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const handleWebSocketMessage = useCallback((wsMessage: WebSocketMessage) => {
    switch (wsMessage.type) {
      case 'start':
        // Start of assistant response
        messageIdRef.current = generateId();
        currentMessageRef.current = '';
        setState((prev) => ({
          ...prev,
          isLoading: true,
          sessionId: wsMessage.sessionId || prev.sessionId,
          messages: [
            ...prev.messages,
            {
              id: messageIdRef.current!,
              role: 'assistant',
              content: '',
              timestamp: new Date(),
              isStreaming: true,
            },
          ],
        }));
        break;

      case 'chunk':
        // Streaming text chunk
        if (wsMessage.text) {
          currentMessageRef.current += wsMessage.text;
          setState((prev) => ({
            ...prev,
            messages: prev.messages.map((msg) =>
              msg.id === messageIdRef.current
                ? { ...msg, content: currentMessageRef.current }
                : msg
            ),
          }));
        }
        break;

      case 'tool_use':
        // Tool is being called
        if (wsMessage.tool) {
          setState((prev) => ({
            ...prev,
            messages: prev.messages.map((msg) =>
              msg.id === messageIdRef.current
                ? { ...msg, toolUse: wsMessage.tool }
                : msg
            ),
          }));
        }
        break;

      case 'end':
        // Response complete
        setState((prev) => ({
          ...prev,
          isLoading: false,
          messages: prev.messages.map((msg) =>
            msg.id === messageIdRef.current
              ? { ...msg, isStreaming: false, toolUse: undefined }
              : msg
          ),
        }));
        messageIdRef.current = null;
        currentMessageRef.current = '';
        break;

      case 'error':
        // Error occurred
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: wsMessage.error || 'An error occurred',
          messages: prev.messages.filter((msg) => msg.id !== messageIdRef.current),
        }));
        messageIdRef.current = null;
        currentMessageRef.current = '';
        break;
    }
  }, []);

  useEffect(() => {
    websocketService.setOnMessage(handleWebSocketMessage);

    websocketService.setOnConnect(() => {
      setState((prev) => ({ ...prev, isConnected: true, error: null }));
    });

    websocketService.setOnDisconnect(() => {
      setState((prev) => ({ ...prev, isConnected: false }));
    });

    websocketService.setOnError((error) => {
      setState((prev) => ({ ...prev, error, isLoading: false }));
    });

    websocketService.connect();

    return () => {
      websocketService.disconnect();
    };
  }, [handleWebSocketMessage]);

  const sendMessage = useCallback((content: string) => {
    if (!content.trim()) return;

    // Add user message
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      error: null,
    }));

    // Send via WebSocket
    websocketService.sendMessage(content.trim(), state.sessionId || undefined, userId.current);
  }, [state.sessionId]);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const clearMessages = useCallback(() => {
    setState((prev) => ({
      ...prev,
      messages: [],
      sessionId: null,
    }));
  }, []);

  return {
    messages: state.messages,
    isConnected: state.isConnected,
    isLoading: state.isLoading,
    error: state.error,
    sendMessage,
    clearError,
    clearMessages,
  };
}
