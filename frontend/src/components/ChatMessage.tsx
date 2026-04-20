
import {type Message } from '../types/chat';
import './ChatMessage.css';

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`chat-message ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-avatar">
        {isUser ? '👤' : '✈️'}
      </div>
      <div className="message-content">
        {message.toolUse && (
          <div className="tool-indicator">
            🔧 Looking up {message.toolUse}...
          </div>
        )}
        <div className="message-text">
          {message.content}
          {message.isStreaming && <span className="cursor">▋</span>}
        </div>
        <div className="message-time">
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
