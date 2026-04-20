import { useEffect, useRef } from 'react';
import { type Message } from '../types/chat';
import { ChatMessage } from './ChatMessage';
import './MessageList.css';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="message-list empty">
        <div className="welcome-message">
          <div className="welcome-icon">✈️</div>
          <h2>Welcome to Travel Assistant</h2>
          <p>I can help you with:</p>
          <ul>
            <li>Looking up your booking details</li>
            <li>Answering questions about baggage policies</li>
            <li>Check-in information</li>
            <li>Cancellation and refund policies</li>
            <li>Hotel amenities</li>
          </ul>
          <p className="hint">Try asking: "What's my booking BK7X9M2A?"</p>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
