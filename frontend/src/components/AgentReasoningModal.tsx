import React, { useEffect, useRef, useState } from 'react';
import './AgentReasoningModal.css';

// Types
export type PromptChoice = 'original' | 'rewritten' | 'edited' | null;
export type AgentReasoningModalMode = 'preChoice' | 'postChoice';

export type AgentReasoningModalProps = {
  isOpen: boolean;
  onClose: () => void;
  intent: string;
  topic: string;
  rationale: string; // decision rationale text
  originalPrompt: string;
  rewrittenPrompt: string;
  editedPrompt?: string; // optional edited version of the rewritten prompt
  choice: PromptChoice; // which prompt the user ultimately chose ('original', 'rewritten', or 'edited')
  mode: AgentReasoningModalMode; // 'preChoice' or 'postChoice'
  // callbacks for pre-choice mode
  onUseOriginal?: () => void;
  onUseRewritten?: () => void;
  // Optional: for editing rewritten prompt in pre-choice mode
  draftRewrite?: string;
  onDraftRewriteChange?: (value: string) => void;
  // Optional: reasoning bullets for pre-choice mode
  reasoningBullets?: string[];
};

// Helper to format intent (capitalize and space)
const formatIntent = (intent: string): string => {
  if (!intent) return '';
  return intent
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const AgentReasoningModal = ({
  isOpen,
  onClose,
  intent,
  topic,
  rationale,
  originalPrompt,
  rewrittenPrompt,
  editedPrompt,
  choice,
  mode,
  onUseOriginal,
  onUseRewritten,
  draftRewrite,
  onDraftRewriteChange,
  reasoningBullets = [],
}: AgentReasoningModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const step1Ref = useRef<HTMLElement>(null);
  const step2Ref = useRef<HTMLElement>(null);
  const step3Ref = useRef<HTMLElement>(null);
  const step4Ref = useRef<HTMLElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);
  const lastFocusableRef = useRef<HTMLButtonElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [visibleSteps, setVisibleSteps] = useState<number[]>([]);

  // Helper function to scroll to an element smoothly
  const scrollToStep = (stepRef: React.RefObject<HTMLElement | null>, delay: number = 0) => {
    setTimeout(() => {
      if (stepRef.current && contentRef.current) {
        const stepElement = stepRef.current;
        const scrollOffset = stepElement.offsetTop - 140;
        contentRef.current.scrollTo({
          top: Math.max(0, scrollOffset),
          behavior: 'smooth',
        });
      }
    }, delay);
  };

  // Handle visibility and sequential step animations with auto-scroll
  useEffect(() => {
    if (isOpen) {
      // Reset steps visibility and scroll position
      setVisibleSteps([]);
      setIsVisible(false); // Start hidden
      if (contentRef.current) {
        contentRef.current.scrollTop = 0;
      }
      
      // Trigger modal animation immediately after DOM update
      // Use requestAnimationFrame to ensure smooth transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
      
      // In post-choice mode, show all steps immediately (no animation delay)
      if (mode === 'postChoice') {
        setTimeout(() => {
          setVisibleSteps([1, 2, 3, 4]);
        }, 100);
        return;
      }
      
      // Pre-choice mode: sequential step reveal with auto-scroll
      const step1Timer = setTimeout(() => {
        setVisibleSteps([1]);
        scrollToStep(step1Ref, 375);
      }, 750);

      const step2Timer = setTimeout(() => {
        setVisibleSteps([1, 2]);
        scrollToStep(step2Ref, 375);
      }, 1750);

      const step3Timer = setTimeout(() => {
        setVisibleSteps([1, 2, 3]);
        scrollToStep(step3Ref, 375);
        
        setTimeout(() => {
          if (contentRef.current) {
            contentRef.current.scrollTo({
              top: contentRef.current.scrollHeight,
              behavior: 'smooth',
            });
          }
        }, 1750);
      }, 2750);

      return () => {
        clearTimeout(step1Timer);
        clearTimeout(step2Timer);
        clearTimeout(step3Timer);
      };
    } else {
      setIsVisible(false);
      setVisibleSteps([]);
    }
  }, [isOpen, mode]);

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLInputElement) {
        return;
      }

      const focusableElements = modalRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableElements || focusableElements.length === 0) return;

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const activeElement = document.activeElement;
        const isInputElement = activeElement instanceof HTMLInputElement || 
                               activeElement instanceof HTMLTextAreaElement;
        if (!isInputElement) {
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleTabKey);
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleTabKey);
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isPreChoice = mode === 'preChoice';
  const isPostChoice = mode === 'postChoice';

  return (
    <div
      className={`agent-reasoning-modal-overlay ${isVisible ? 'fade-in' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
    >
      {/* Modal Card */}
      <div
        ref={modalRef}
        className={`agent-reasoning-modal-card ${isVisible ? 'slide-in' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="agent-reasoning-modal-header">
          <div>
            <h2 id="modal-title" className="agent-reasoning-modal-title">
              Agent Reasoning
            </h2>
            {isPreChoice && (
              <p className="agent-reasoning-modal-subtitle">
                Review how the agent interpreted your question and choose which prompt to use.
              </p>
            )}
            {isPostChoice && (
              <div className="agent-reasoning-modal-badge">
                {choice === 'original' ? (
                  <>Final prompt used: Original prompt ✅</>
                ) : choice === 'edited' ? (
                  <>Final prompt used: Edited version ✅</>
                ) : choice === 'rewritten' ? (
                  <>Final prompt used: Rewritten prompt ✅</>
                ) : null}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="agent-reasoning-modal-close"
            aria-label="Close modal"
          >
            <svg className="agent-reasoning-modal-close-icon" fill="none" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div ref={contentRef} className="agent-reasoning-modal-content">
          {/* Decision Rationale */}
          {rationale && (
            <section className="agent-reasoning-decision-rationale">
              <div className="agent-reasoning-decision-rationale-card">
                <h3 className="agent-reasoning-decision-rationale-title">Decision Rationale</h3>
                <p className="agent-reasoning-decision-rationale-text">
                  {rationale}
                </p>
              </div>
            </section>
          )}

          {/* Step 1: Detected Intent & Topic */}
          <section
            ref={step1Ref}
            className={`agent-reasoning-step ${visibleSteps.includes(1) ? 'fade-in' : 'fade-out'}`}
          >
            <div className="agent-reasoning-step-header">
              <div className="agent-reasoning-step-title-row">
                <span className="agent-reasoning-step-number">
                  Step 1
                </span>
                <span className="agent-reasoning-step-separator">▸</span>
                <h3 className="agent-reasoning-step-title">
                  Detected Intent & Topic
                </h3>
              </div>
              <div className="agent-reasoning-step-divider" />
            </div>
            <div className="agent-reasoning-step-body">
              <div className="agent-reasoning-intent-topic-container">
                <div className="agent-reasoning-field">
                  <span className="agent-reasoning-field-label">Intent</span>
                  <div className="agent-reasoning-chip">
                    <span className="agent-reasoning-chip-text">{formatIntent(intent)}</span>
                  </div>
                </div>
                {topic && (
                  <div className="agent-reasoning-field">
                    <span className="agent-reasoning-field-label">Topic</span>
                    <div className="agent-reasoning-chip">
                      <span className="agent-reasoning-chip-text">{topic}</span>
                    </div>
                  </div>
                )}
              </div>
              {isPreChoice && (
                <div className="agent-reasoning-ready">
                  <svg className="agent-reasoning-ready-icon" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Ready for next step</span>
                </div>
              )}
            </div>
          </section>

          {/* Step 2: Rewritten prompt ready (same for both modes, but post-choice shows which was used) */}
          <section
            ref={step2Ref}
            className={`agent-reasoning-step ${visibleSteps.includes(2) ? 'fade-in' : 'fade-out'}`}
          >
            <div className="agent-reasoning-step-header">
              <div className="agent-reasoning-step-title-row">
                <span className="agent-reasoning-step-number">
                  Step 2
                </span>
                <span className="agent-reasoning-step-separator">▸</span>
                <h3 className="agent-reasoning-step-title">
                  {isPreChoice ? 'Rewritten prompt ready' : 'Rewritten prompt'}
                </h3>
              </div>
              <div className="agent-reasoning-step-divider" />
            </div>
            <div className="agent-reasoning-step-body">
              {rewrittenPrompt && (
                <div className="agent-reasoning-prompt-box">
                  {rewrittenPrompt}
                </div>
              )}
              {reasoningBullets.length > 0 && (
                <div className="agent-reasoning-bullets-section">
                  <p className="agent-reasoning-bullets-intro">
                    What changed and why:
                  </p>
                  <ul className="agent-reasoning-bullets-list">
                    {reasoningBullets.map((bullet, idx) => (
                      <li key={idx}>{bullet}</li>
                    ))}
                  </ul>
                </div>
              )}
              {isPostChoice && editedPrompt && choice === 'edited' && (
                <div style={{ marginTop: '1rem' }}>
                  <div className="agent-reasoning-prompt-box" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                    <strong>Edited version used:</strong>
                    <div style={{ marginTop: '0.5rem' }}>{editedPrompt}</div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Step 3: Compare prompts (same structure for both modes, but post-choice is read-only) */}
          <section
            ref={step3Ref}
            className={`agent-reasoning-step ${visibleSteps.includes(3) ? 'fade-in' : 'fade-out'}`}
          >
            <div className="agent-reasoning-step-header">
              <div className="agent-reasoning-step-title-row">
                <span className="agent-reasoning-step-number">
                  Step 3
                </span>
                <span className="agent-reasoning-step-separator">▸</span>
                <h3 className="agent-reasoning-step-title">
                  Compare prompts
                </h3>
              </div>
              <div className="agent-reasoning-step-divider" />
            </div>
            <div className="agent-reasoning-step-body">
              <div className="agent-reasoning-prompt-comparison">
                <div className={`agent-reasoning-prompt-column ${
                  isPostChoice && choice === 'original' 
                    ? 'agent-reasoning-prompt-used' 
                    : isPostChoice 
                    ? 'agent-reasoning-prompt-unused'
                    : ''
                }`}>
                  <div className="agent-reasoning-prompt-header">
                    <h4 className="agent-reasoning-prompt-label">Original Prompt</h4>
                    {isPostChoice && (
                      choice === 'original' ? (
                        <span className="agent-reasoning-prompt-badge agent-reasoning-prompt-badge-used">
                          Used ✅
                        </span>
                      ) : (
                        <span className="agent-reasoning-prompt-badge agent-reasoning-prompt-badge-unused">
                          Not used
                        </span>
                      )
                    )}
                  </div>
                  <div className="agent-reasoning-prompt-box">
                    {originalPrompt}
                  </div>
                </div>
                <div className={`agent-reasoning-prompt-column ${
                  isPostChoice && (choice === 'rewritten' || choice === 'edited')
                    ? 'agent-reasoning-prompt-used' 
                    : isPostChoice 
                    ? 'agent-reasoning-prompt-unused'
                    : ''
                }`}>
                  <div className="agent-reasoning-prompt-header">
                    <h4 className="agent-reasoning-prompt-label">Rewritten Prompt</h4>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      {isPostChoice && editedPrompt && (
                        <span className={choice === 'edited' 
                          ? 'agent-reasoning-prompt-badge-edited' 
                          : 'agent-reasoning-prompt-badge-edited-inactive'}>
                          ✏️ Edited
                        </span>
                      )}
                      {isPostChoice && (
                        (choice === 'rewritten' || choice === 'edited') ? (
                          <span className="agent-reasoning-prompt-badge agent-reasoning-prompt-badge-used">
                            Used ✅
                          </span>
                        ) : (
                          <span className="agent-reasoning-prompt-badge agent-reasoning-prompt-badge-unused">
                            Not used
                          </span>
                        )
                      )}
                    </div>
                  </div>
                  {isPreChoice && rewrittenPrompt && onDraftRewriteChange ? (
                    <textarea
                      className="agent-reasoning-prompt-textarea"
                      value={draftRewrite || rewrittenPrompt}
                      onChange={(e) => onDraftRewriteChange(e.target.value)}
                      placeholder="Edit the rewritten prompt here..."
                      rows={8}
                      disabled={!rewrittenPrompt}
                    />
                  ) : (
                    <div className="agent-reasoning-prompt-box">
                      {isPostChoice && choice === 'edited' && editedPrompt 
                        ? editedPrompt 
                        : rewrittenPrompt || 'No rewrite available'}
                    </div>
                  )}
                </div>
              </div>
              {isPreChoice && onUseOriginal && onUseRewritten && (
                <div className="agent-reasoning-actions">
                  <button
                    ref={firstFocusableRef}
                    onClick={onUseOriginal}
                    className="agent-reasoning-button agent-reasoning-button-secondary"
                  >
                    Use Original
                  </button>
                  <button
                    ref={lastFocusableRef}
                    onClick={onUseRewritten}
                    className="agent-reasoning-button agent-reasoning-button-primary"
                    disabled={draftRewrite !== undefined && !draftRewrite?.trim()}
                  >
                    Use This Version
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Step 4: Answer generated (only in post-choice mode) */}
          {isPostChoice && (
            <section
              ref={step4Ref}
              className={`agent-reasoning-step ${visibleSteps.includes(4) ? 'fade-in' : 'fade-out'}`}
            >
              <div className="agent-reasoning-step-header">
                <div className="agent-reasoning-step-title-row">
                  <span className="agent-reasoning-step-number">
                    Step 4
                  </span>
                  <span className="agent-reasoning-step-separator">▸</span>
                  <h3 className="agent-reasoning-step-title">
                    Answer generated
                  </h3>
                </div>
                <div className="agent-reasoning-step-divider" />
              </div>
              <div className="agent-reasoning-step-body">
                <p className="agent-reasoning-answer-explanation">
                  The answer below was generated using the{' '}
                  {choice === 'original' ? 'original prompt' 
                   : choice === 'edited' ? 'edited prompt'
                   : choice === 'rewritten' ? 'rewritten prompt'
                   : 'selected prompt'} you selected.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentReasoningModal;
