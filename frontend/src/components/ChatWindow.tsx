import { useChat } from '../hooks/useChat';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import './ChatWindow.css';

export function ChatWindow() {
  const { messages, isConnected, isLoading, error, sendMessage, clearError, clearMessages } = useChat();


  return (
    <div className="chat-window">
      <header className="chat-header">
        <div className="header-content">
          <span className="header-icon">✈️</span>
          <div className="header-text">
            <h1>Travel Assistant</h1>
            <span className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? 'Online' : 'Connecting...'}
            </span>
          </div>
        </div>
        {messages.length > 0 && (
          <button className="clear-button" onClick={clearMessages} title="Clear conversation">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        )}
      </header>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={clearError} aria-label="Dismiss error">×</button>
        </div>
      )}

      <MessageList messages={messages} isLoading={isLoading} />

      <MessageInput
        onSend={sendMessage}
        disabled={isLoading}
        isConnected={isConnected}
      />
    </div>
  );
}
