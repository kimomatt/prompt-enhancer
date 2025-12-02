import React from 'react';
import MarkdownMessage from '../MarkdownMessage';
import '../Interaction.css';

export type PromptChoice = 'original' | 'rewritten' | null;

export interface AnswerProps {
  answer: string;                 // already-rendered markdown or text
  intent: string;                 // e.g. "Direct Answer"
  topic: string;                  // e.g. "love"
  rationale: string;              // short explanation of why it rewrote the prompt
  choice: PromptChoice;           // which prompt was used
  onOpenFullBreakdown: () => void; // open AgentReasoningModal in post-choice mode
}

function AnswerMessage(props: AnswerProps) {
  const { answer, intent, topic, rationale, choice, onOpenFullBreakdown } = props;

  // Helper to format intent (capitalize and space)
  const formatIntent = (intent: string): string => {
    if (!intent) return '';
    return intent
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Helper to truncate long topic strings for pills
  const truncateTopic = (topic: string, maxLength: number = 30): string => {
    if (!topic) return '';
    if (topic.length <= maxLength) return topic;
    return topic.substring(0, maxLength - 3) + '...';
  };

  return (
    <div className="answer-message-wrapper">
      {/* Reasoning strip header row */}
      <div className="answer-reasoning-header">
        {/* Left side: Pills container */}
        <div className="answer-reasoning-pills-container">
          {/* Intent pill */}
          {intent && (
            <span className="answer-reasoning-pill">
              {formatIntent(intent)}
            </span>
          )}
          
          {/* Topic pill */}
          {topic && (
            <span className="answer-reasoning-pill" title={topic}>
              {truncateTopic(topic)}
            </span>
          )}
          
          {/* Used rewritten prompt pill (only when choice is 'rewritten') */}
          {choice === "rewritten" && (
            <span className="answer-reasoning-pill">
              Used rewritten prompt ✔
            </span>
          )}
        </div>

        {/* Right side: View breakdown link */}
        <button
          type="button"
          onClick={onOpenFullBreakdown}
          className="answer-reasoning-breakdown-link"
        >
          View breakdown →
        </button>
      </div>

      {/* Light divider */}
      <div className="answer-reasoning-divider" />

      {/* Answer body */}
      <div className="answer-body-text">
        <MarkdownMessage text={answer} />
      </div>
    </div>
  );
}

export default AnswerMessage;

