import { type WebSocketMessage } from '../types/chat';

const WS_ENDPOINT = (import.meta.env.VITE_WS_ENDPOINT ?? '').trim();

if (!WS_ENDPOINT) {
  throw new Error('VITE_WS_ENDPOINT is not set. Add it to frontend/.env and restart Vite.');
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  private onMessage: ((message: WebSocketMessage) => void) | null = null;
  private onConnect: (() => void) | null = null;
  private onDisconnect: (() => void) | null = null;
  private onError: ((error: string) => void) | null = null;

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.ws = new WebSocket(WS_ENDPOINT);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        this.onConnect?.();
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.onMessage?.(message);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.onDisconnect?.();
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.onError?.('Connection error occurred');
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.onError?.('Failed to connect');
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      this.onError?.('Unable to reconnect. Please refresh the page.');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendMessage(message: string, sessionId?: string, userId?: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.onError?.('Not connected');
      return;
    }

    const payload = {
      action: 'chat',
      message,
      sessionId,
      userId,
    };

    this.ws.send(JSON.stringify(payload));
  }

  setOnMessage(callback: (message: WebSocketMessage) => void): void {
    this.onMessage = callback;
  }

  setOnConnect(callback: () => void): void {
    this.onConnect = callback;
  }

  setOnDisconnect(callback: () => void): void {
    this.onDisconnect = callback;
  }

  setOnError(callback: (error: string) => void): void {
    this.onError = callback;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const websocketService = new WebSocketService();
