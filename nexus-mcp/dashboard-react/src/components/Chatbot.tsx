import { useState, useRef, useEffect } from 'react';
import './Chatbot.css';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'nexus';
  text: string;
  timestamp: string;
}

interface ChatbotProps {
  messages: ChatMessage[];
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

export default function Chatbot({ messages, onSubmit, disabled }: ChatbotProps) {
  const [inputData, setInputData] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputData.trim() || disabled) return;
    onSubmit(inputData.trim());
    setInputData("");
  }

  if (!isOpen) {
    return (
      <button className="chat-fab" onClick={() => setIsOpen(true)}>
        💬 Ask NEXUS
      </button>
    );
  }

  return (
    <div className="web-chatbot-panel">
      <div className="chat-header">
        <span>NEXUS Web Client</span>
        <button className="chat-close" onClick={() => setIsOpen(false)}>×</button>
      </div>
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">Type a topic to begin a legal investigation...</div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`chat-bubble-container ${msg.sender}`}>
              <div className="chat-bubble">
                <div dangerouslySetInnerHTML={{ __html: msg.text }} />
              </div>
              <div className="chat-meta">{msg.timestamp}</div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
      <form className="chat-input-area" onSubmit={handleSubmit}>
        <input 
          type="text" 
          placeholder="Enter investigation topic..." 
          value={inputData}
          onChange={(e) => setInputData(e.target.value)}
          disabled={disabled}
        />
        <button type="submit" disabled={disabled || !inputData.trim()}>Send</button>
      </form>
    </div>
  );
}
