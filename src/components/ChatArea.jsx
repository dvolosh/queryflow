import React, { useRef, useEffect } from 'react';
import {
  UserMessage,
  AssistantTextMessage,
  AssistantDataMessage,
  AmbiguityMessage,
  TypingIndicator,
  RecommendationMessage,
} from './Messages';

export default function ChatArea({ messages, isLoading, executionStep, onClarify, onVizUpdate }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 scrollbar-thin">
      <div className="max-w-3xl mx-auto w-full space-y-6">
        {messages.map(msg => {
          if (msg.role === 'user') {
            return <UserMessage key={msg.id} message={msg} />;
          }
          if (msg.type === 'data_block') {
            return <AssistantDataMessage key={msg.id} message={msg} onVizUpdate={onVizUpdate} />;
          }
          if (msg.type === 'ambiguity') {
            return <AmbiguityMessage key={msg.id} message={msg} onSelect={opt => onClarify(msg.id, opt)} />;
          }
          if (msg.type === 'recommendation') {
            return <RecommendationMessage key={msg.id} message={msg} />;
          }
          return <AssistantTextMessage key={msg.id} message={msg} />;
        })}

        {isLoading && <TypingIndicator step={executionStep} />}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
