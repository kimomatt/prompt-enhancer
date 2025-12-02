import { useState, useEffect, useRef } from 'react';
import MarkdownMessage from './MarkdownMessage';
import AgentReasoningModal from './components/AgentReasoningModal';
import AnswerMessage from './components/AnswerMessage';
import ConfirmDialog from './components/ConfirmDialog';
import './Interaction.css';
// Note: types.ts exports are used for type checking in JSDoc comments
// In JSX files, we use JSDoc for type hints instead of TypeScript imports

const API_URL = 'http://localhost:8000';
const STORAGE_KEY_CONVERSATIONS = 'learning_agent_conversations';
const STORAGE_KEY_ACTIVE_CONVERSATION = 'learning_agent_active_conversation';

function Interaction() {
  const [prompt, setPrompt] = useState('');
  const [enhancerEnabled, setEnhancerEnabled] = useState(true);
  const [mode, setMode] = useState('learning');
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState({}); // { conversationId: { turns: [], title: string, updatedAt: timestamp } }
  const [error, setError] = useState(null);
  const [modalTurnId, setModalTurnId] = useState(null);
  const [draftRewrite, setDraftRewrite] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [pendingTurn, setPendingTurn] = useState(null); // Turn being processed in modal
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState({ isOpen: false, conversationId: null });
  const chatFeedRef = useRef(null);

  // Load conversations from localStorage on mount
  useEffect(() => {
    try {
      const savedConversations = localStorage.getItem(STORAGE_KEY_CONVERSATIONS);
      if (savedConversations) {
        const parsed = JSON.parse(savedConversations);
        setConversations(parsed);
      }

      const activeId = localStorage.getItem(STORAGE_KEY_ACTIVE_CONVERSATION);
      if (activeId) {
        const savedConversations = localStorage.getItem(STORAGE_KEY_CONVERSATIONS);
        if (savedConversations) {
          const parsed = JSON.parse(savedConversations);
          if (parsed[activeId]) {
            setConversationId(activeId);
            const validTurns = parsed[activeId].turns.filter(turn => 
              turn.final_answer !== '__LOADING__' && turn.intent !== 'loading'
            );
            // Ensure all loaded turns have reasoningStage and chosenPromptVersion
            const turnsWithStages = validTurns.map(turn => ({
              ...turn,
              reasoningStage: turn.reasoningStage || 'done',
              chosenPromptVersion: turn.chosenPromptVersion || null,
              edited_prompt: turn.edited_prompt || null,
              rewrite_strategy: turn.rewrite_strategy || null,
              decisionRationale: turn.decisionRationale || null,
              promptFeedback: turn.promptFeedback || null,
              interaction_id: turn.interaction_id || null,
              // For backward compatibility: if showReasoning not present, infer from whether enhancer was used
              showReasoning: turn.showReasoning !== undefined ? turn.showReasoning : (turn.rewrite_strategy !== null && turn.rewrite_strategy !== undefined) || turn.intent !== null
            }));
            setTurns(turnsWithStages);
          }
        }
      }

    } catch (err) {
      console.error('Error loading from localStorage:', err);
    }
  }, []);

  // Save conversations to localStorage whenever they change
  useEffect(() => {
    try {
      if (Object.keys(conversations).length > 0) {
        localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(conversations));
      } else {
        localStorage.removeItem(STORAGE_KEY_CONVERSATIONS);
      }
    } catch (err) {
      console.error('Error saving conversations:', err);
    }
  }, [conversations]);

  // Save active conversationId
  useEffect(() => {
    try {
      if (conversationId) {
        localStorage.setItem(STORAGE_KEY_ACTIVE_CONVERSATION, conversationId);
      } else {
        localStorage.removeItem(STORAGE_KEY_ACTIVE_CONVERSATION);
      }
    } catch (err) {
      console.error('Error saving active conversation:', err);
    }
  }, [conversationId]);

  // Save current conversation's turns when they change
  useEffect(() => {
    if (!conversationId) return;
    
    try {
      const completeTurns = turns.filter(turn => 
        turn.final_answer !== '__LOADING__' && turn.intent !== 'loading'
      );
      
      if (completeTurns.length > 0) {
        const firstPrompt = completeTurns[0]?.originalPrompt || 'New Conversation';
        const title = firstPrompt.length > 50 ? firstPrompt.substring(0, 50) + '...' : firstPrompt;
        
        setConversations(prev => ({
          ...prev,
          [conversationId]: {
            turns: completeTurns,
            title: title,
            updatedAt: Date.now()
          }
        }));
      }
    } catch (err) {
      console.error('Error saving turns:', err);
    }
  }, [turns, conversationId]);


  // Auto-scroll to bottom when new turns are added or when content changes
  useEffect(() => {
    if (chatFeedRef.current) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (chatFeedRef.current) {
          chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
        }
      });
    }
  }, [turns, loading]);

  // Initialize draftRewrite when modal opens
  useEffect(() => {
    if (modalTurnId) {
      // Check pending turn first, then existing turns
      const turn = pendingTurn?.id === modalTurnId 
        ? pendingTurn 
        : turns.find(t => t.id === modalTurnId);
      if (turn) {
        setDraftRewrite(turn.edited_prompt ?? turn.rewritten_prompt ?? '');
      }
    }
  }, [modalTurnId, turns, pendingTurn]);

  // Note: progressReasoningStage removed - we use progressReasoningStageForPending instead

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    const currentPrompt = prompt;
    const currentMode = mode;
    
    setLoading(true);
    setError(null);

    // Generate unique ID for this turn
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // If enhancer is disabled, bypass modal and go directly to answer
    if (!enhancerEnabled) {
      // Create turn and add to chat feed immediately (like when selecting from modal)
      const newTurn = {
        id: turnId,
        conversationId: conversationId || 'pending',
        originalPrompt: currentPrompt,
        mode: null,
        intent: null,
        topic: null,
        rewritten_prompt: null,
        rewrite_strategy: null,
        edited_prompt: null,
        final_answer: null, // Will be set when answer arrives
        decisionRationale: null,
        reasoningStage: 'answering', // Set to answering while we generate the answer
        chosenPromptVersion: 'original',
        interaction_id: null,
        showReasoning: false, // No reasoning peek when enhancer is off
      };

      setTurns(prev => [...prev, newTurn]);
      
      // Clear prompt from textbox immediately
      setPrompt('');
      // Reset textarea height
      const textarea = document.getElementById('prompt');
      if (textarea) {
        textarea.style.height = 'auto';
      }

      // Reset loading state immediately so send button doesn't show hourglass
      setLoading(false);

      // Scroll to chat feed after a brief delay to ensure DOM update
      setTimeout(() => {
        if (chatFeedRef.current) {
          requestAnimationFrame(() => {
            if (chatFeedRef.current) {
              chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
            }
          });
        }
      }, 100);

      // Now call /interact to get the answer
      try {
        const interactResponse = await fetch(`${API_URL}/interact`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            prompt: currentPrompt, 
            enhancerEnabled: false,
            mode: null,
            conversationId: conversationId 
          }),
        });

        if (!interactResponse.ok) {
          throw new Error(`HTTP error! status: ${interactResponse.status}`);
        }

        const interactData = await interactResponse.json();
        
        // Update conversationId if we got a new one
        const newConversationId = interactData.conversationId;
        if (newConversationId && newConversationId !== conversationId) {
          setConversationId(newConversationId);
        }

        // Update the turn with the final answer
        setTurns(prev => prev.map(t => 
          t.id === turnId 
            ? {
                ...t,
                conversationId: newConversationId,
                final_answer: interactData.final_answer,
                decisionRationale: interactData.decisionRationale,
                reasoningStage: 'done',
                interaction_id: interactData.interaction_id,
                showReasoning: interactData.showReasoning ?? false,
              }
            : t
        ));
      } catch (err) {
        setError(err.message || 'Failed to get response');
        console.error('Error:', err);
        
        // Update turn with error
        setTurns(prev => prev.map(t => 
          t.id === turnId 
            ? {
                ...t,
                final_answer: `Error: ${err.message}`,
                reasoningStage: 'done',
              }
            : t
        ));
      }
      return; // Exit early when enhancer is disabled
    }

    // For enhancer-enabled modes, show modal
    // Create a pending turn (not added to chat feed yet - only shown in modal)
    const newTurn = {
      id: turnId,
      conversationId: conversationId || 'pending',
      originalPrompt: currentPrompt,
      mode: currentMode,
      intent: null,
      topic: null,
      rewritten_prompt: null,
      rewrite_strategy: null,
      edited_prompt: null,
      final_answer: null,
      reasoningStage: 'classifying',
      chosenPromptVersion: null,
      interaction_id: null,
      showReasoning: true, // Set to true initially for enhancer-enabled requests
    };

    // Set as pending turn and open modal immediately
    setPendingTurn(newTurn);
    setModalTurnId(turnId);
    setDraftRewrite('');
    
    // Don't clear prompt - keep it until user chooses a prompt version
    // Reset textarea height
    const textarea = document.getElementById('prompt');
    if (textarea) {
      textarea.style.height = 'auto';
    }
    
    // Reset loading state immediately so send button doesn't show hourglass
    setLoading(false);

    try {
      // Step 1: Call /interact (analyze & rewrite, does NOT generate answer - answer generated later via /answer)
      const response = await fetch(`${API_URL}/interact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          prompt: currentPrompt, 
          enhancerEnabled: true,
          mode: currentMode,
          conversationId: conversationId 
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // Update conversationId if we got a new one
      const newConversationId = data.conversationId;
      if (newConversationId && newConversationId !== conversationId) {
        setConversationId(newConversationId);
      }
      
      // Update the pending turn with real data (answer will be generated later via /answer)
      // Update in real-time as data becomes available
      setPendingTurn(prev => prev ? {
        ...prev,
        conversationId: newConversationId,
        intent: data.intent,
        topic: data.topic,
        rewritten_prompt: data.rewritten_prompt,
        rewrite_strategy: data.rewrite_strategy,
        decisionRationale: data.decisionRationale,
        promptFeedback: data.promptFeedback,
        interaction_id: data.interaction_id,
        showReasoning: data.showReasoning ?? true,
        reasoningStage: 'rewritten', // Jump to rewritten stage since we have all the data
        // Note: final_answer is not generated yet - will be generated by /answer endpoint
      } : null);

      // Update draftRewrite if we have a rewritten prompt
      if (data.rewritten_prompt) {
        setDraftRewrite(data.rewritten_prompt);
      }
    } catch (err) {
      setError(err.message || 'Failed to get response');
      console.error('Error:', err);
      
      // Update pending turn with error
      setPendingTurn(prev => prev ? {
        ...prev,
        intent: 'error',
        topic: '',
        rewritten_prompt: null,
        rewrite_strategy: null,
        final_answer: `Error: ${err.message}`,
        reasoningStage: 'done',
      } : null);
    }
    // Note: loading is already false, no need to set it again
  };

  // Note: progressReasoningStageForPending removed - we now update stages in real-time
  // as data becomes available from the API


  const openCompareModal = (turnId) => {
    setModalTurnId(turnId);
    const turn = turns.find(t => t.id === turnId);
    if (turn) {
      setDraftRewrite(turn.edited_prompt ?? turn.rewritten_prompt ?? '');
    }
  };

  const closeCompareModal = () => {
    // Always allow closing - cancel any pending turn
    // Restore the original prompt to the textbox if this was a pending turn
    if (pendingTurn && pendingTurn.originalPrompt) {
      setPrompt(pendingTurn.originalPrompt);
    }
    setModalTurnId(null);
    setDraftRewrite('');
    setRegenerating(false);
    setPendingTurn(null);
    setLoading(false);
  };

  const choosePromptVersion = async (turnId, version) => {
    // Capture draftRewrite value before closing modal
    const currentDraftValue = draftRewrite.trim();
    
    // Close modal immediately when prompt is chosen
    setModalTurnId(null);
    setDraftRewrite('');
    // Clear prompt from textbox since user chose to proceed
    setPrompt('');
    // Reset textarea height
    const textarea = document.getElementById('prompt');
    if (textarea) {
      textarea.style.height = 'auto';
    }
    
    // Check if this is a pending turn (in modal) or existing turn (in chat)
    const turn = pendingTurn?.id === turnId ? pendingTurn : turns.find(t => t.id === turnId);
    if (!turn) return;

    // Determine which prompt version was chosen
    // Check if draftRewrite has been edited (different from rewritten_prompt)
    const isEdited = turn.rewritten_prompt && currentDraftValue !== turn.rewritten_prompt && currentDraftValue !== '';
    
    let actualVersion = version;

    if (version === 'rewritten' || version === 'edited') {
      // If user clicked "Use this version", check if it's been edited
      if (version === 'edited' || (version === 'rewritten' && isEdited)) {
        actualVersion = isEdited ? 'edited' : 'rewritten';
      } else {
        actualVersion = 'rewritten';
      }
    }

    // Determine the final edited_prompt value
    const finalEditedPrompt = (actualVersion === 'edited' || isEdited) ? currentDraftValue : null;

    // Determine which prompt to use for answer generation
    const promptForAnswer = actualVersion === 'edited' && finalEditedPrompt
      ? finalEditedPrompt
      : actualVersion === 'rewritten' && turn.rewritten_prompt
      ? turn.rewritten_prompt
      : turn.originalPrompt;

    // If this is a pending turn, add it to chat feed with loading state
    if (pendingTurn && pendingTurn.id === turnId) {
      const turnToAdd = {
        ...pendingTurn,
        chosenPromptVersion: actualVersion,
        edited_prompt: finalEditedPrompt,
        reasoningStage: 'answering', // Set to answering while we generate the answer
        final_answer: null, // Will be set when answer arrives
      };
      
      setTurns(prev => [...prev, turnToAdd]);
      setPendingTurn(null);
      
      // Scroll to chat feed after a brief delay to ensure DOM update
      setTimeout(() => {
        if (chatFeedRef.current) {
          requestAnimationFrame(() => {
            if (chatFeedRef.current) {
              chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
            }
          });
        }
      }, 100);
    } else {
      // Update existing turn in chat with loading state
      setTurns(prev => prev.map(t => 
        t.id === turnId 
          ? {
              ...t,
              chosenPromptVersion: actualVersion,
              edited_prompt: finalEditedPrompt,
              reasoningStage: 'answering',
              final_answer: null,
            }
          : t
      ));
    }

    // Now call /answer endpoint to generate the answer for the chosen prompt
    try {
      const answerResponse = await fetch(`${API_URL}/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: promptForAnswer,
          mode: turn.mode,
          intent: turn.intent,
          topic: turn.topic,
          interaction_id: turn.interaction_id,
          conversationId: turn.conversationId,
          chosen_version: actualVersion,
          original_prompt: turn.originalPrompt,
          rewritten_prompt: turn.rewritten_prompt,
        }),
      });

      if (!answerResponse.ok) {
        throw new Error(`HTTP error! status: ${answerResponse.status}`);
      }

      const answerData = await answerResponse.json();

      // Update the turn with the final answer
      setTurns(prev => prev.map(t => 
        t.id === turnId 
          ? {
              ...t,
              final_answer: answerData.final_answer,
              reasoningStage: 'done',
            }
          : t
      ));
    } catch (err) {
      console.error('Error generating answer:', err);
      // Update turn with error
      setTurns(prev => prev.map(t => 
        t.id === turnId 
          ? {
              ...t,
              final_answer: `Error: ${err.message}`,
              reasoningStage: 'done',
            }
          : t
      ));
    }
  };

  const handleRegenerate = async (turnId) => {
    // Check if this is a pending turn or existing turn
    const turn = pendingTurn?.id === turnId ? pendingTurn : turns.find(t => t.id === turnId);
    if (!turn || !turn.mode) return;

    setRegenerating(true);

    try {
      // Reuse /interact to get a new rewritten prompt and finalAnswer
      const response = await fetch(`${API_URL}/interact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          prompt: turn.originalPrompt, 
          enhancerEnabled: true,
          mode: turn.mode,
          conversationId: turn.conversationId 
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // Get the new rewritten prompt (or null if no rewrite)
      const newRewrittenPrompt = data.rewritten_prompt || null;

      // Update pending turn or existing turn
      if (pendingTurn && pendingTurn.id === turnId) {
        setPendingTurn(prev => prev ? {
          ...prev,
          rewritten_prompt: newRewrittenPrompt,
          rewrite_strategy: data.rewrite_strategy,
          decisionRationale: data.decisionRationale,
          promptFeedback: data.promptFeedback,
          edited_prompt: null,
          interaction_id: data.interaction_id,
          // Note: final_answer is not generated yet - will be generated by /answer endpoint
        } : null);
      } else {
        setTurns(prev => prev.map(t => 
          t.id === turnId 
            ? {
                ...t,
                rewritten_prompt: newRewrittenPrompt,
                rewrite_strategy: data.rewrite_strategy,
                decisionRationale: data.decisionRationale,
                promptFeedback: data.promptFeedback,
                edited_prompt: null,
              }
            : t
        ));
      }
      
      // Always update draftRewrite to match the new rewritten prompt
      setDraftRewrite(newRewrittenPrompt || '');
    } catch (err) {
      console.error('Error regenerating:', err);
      alert(`Error regenerating prompt: ${err.message}`);
    } finally {
      setRegenerating(false);
    }
  };

  const formatIntent = (intent) => {
    if (!intent || intent === 'loading') return 'Loading...';
    if (intent === 'error') return 'Error';
    return intent.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  /**
   * Transforms modalTurn structure into AgentReasoningStepData format
   */
  const transformTurnToReasoningData = (turn) => {
    if (!turn) return null;

    // Parse promptFeedback into bullets array
    let reasoningBullets = [];
    if (turn.promptFeedback) {
      if (Array.isArray(turn.promptFeedback)) {
        reasoningBullets = turn.promptFeedback;
      } else if (typeof turn.promptFeedback === 'string') {
        // Split by newlines and clean up bullet markers
        const lines = turn.promptFeedback.split('\n').filter(line => line.trim());
        reasoningBullets = lines.map(line => 
          line.replace(/^[-•*]\s*/, '').trim()
        ).filter(Boolean);
        
        // If no bullets found, use the whole text as a single bullet
        if (reasoningBullets.length === 0 && turn.promptFeedback.trim()) {
          reasoningBullets = [turn.promptFeedback.trim()];
        }
      }
    }

    // Extract summary from decisionRationale (first sentence)
    let summary = '';
    if (turn.decisionRationale) {
      const firstSentence = turn.decisionRationale.split('.')[0];
      summary = firstSentence + (turn.decisionRationale.includes('.') ? '.' : '');
    } else {
      // Fallback summary
      const intentFormatted = turn.intent
        ? turn.intent.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        : 'understanding';
      summary = `The agent interpreted your prompt as seeking ${intentFormatted}.`;
    }

    return {
      intent: turn.intent || '',
      topic: turn.topic || '',
      summary: summary,
      reasoningBullets: reasoningBullets,
      originalPrompt: turn.originalPrompt || '',
      rewrittenPrompt: turn.rewritten_prompt || '',
    };
  };

  const startNewConversation = () => {
    setConversationId(null);
    setTurns([]);
    setError(null);
  };

  const switchConversation = (targetConversationId) => {
    if (targetConversationId === conversationId) return;
    
    const targetConversation = conversations[targetConversationId];
    if (targetConversation) {
      setConversationId(targetConversationId);
      const turnsWithStages = (targetConversation.turns || []).map(turn => ({
        ...turn,
        reasoningStage: turn.reasoningStage || 'done',
        chosenPromptVersion: turn.chosenPromptVersion || null,
        edited_prompt: turn.edited_prompt || null,
        rewrite_strategy: turn.rewrite_strategy || null,
        decisionRationale: turn.decisionRationale || null,
        promptFeedback: turn.promptFeedback || null,
        interaction_id: turn.interaction_id || null,
        // For backward compatibility: if showReasoning not present, infer from whether enhancer was used
        showReasoning: turn.showReasoning !== undefined ? turn.showReasoning : (turn.rewrite_strategy !== null && turn.rewrite_strategy !== undefined) || turn.intent !== null
      }));
      setTurns(turnsWithStages);
      setError(null);
    }
  };

  const deleteConversation = (targetConversationId, e) => {
    e.stopPropagation();
    setDeleteConfirmDialog({ isOpen: true, conversationId: targetConversationId });
  };

  const handleConfirmDelete = () => {
    const targetConversationId = deleteConfirmDialog.conversationId;
    if (!targetConversationId) return;

    setConversations(prev => {
      const updated = { ...prev };
      delete updated[targetConversationId];
      return updated;
    });
    
    if (targetConversationId === conversationId) {
      // If deleting active conversation, switch to another or start new
      const remainingIds = Object.keys(conversations).filter(id => id !== targetConversationId);
      if (remainingIds.length > 0) {
        switchConversation(remainingIds[remainingIds.length - 1]);
      } else {
        startNewConversation();
      }
    }

    setDeleteConfirmDialog({ isOpen: false, conversationId: null });
  };

  const handleCancelDelete = () => {
    setDeleteConfirmDialog({ isOpen: false, conversationId: null });
  };

  const getConversationList = () => {
    return Object.entries(conversations)
      .map(([id, conv]) => ({ id, ...conv }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  };

  const hasTurns = turns.length > 0;
  // Modal can show either a pending turn or an existing turn from chat
  const modalTurn = modalTurnId 
    ? (pendingTurn?.id === modalTurnId ? pendingTurn : turns.find(t => t.id === modalTurnId))
    : null;

  return (
    <div className="interaction-container">
      {/* Sidebar for conversations */}
      <div className="sidebar">
        
        <div className="conversation-list">
          <div className="conversation-list-header">
            <h3>Conversations</h3>
            <button 
              className="new-conversation-icon-btn"
              onClick={startNewConversation}
              title="Start a new conversation"
              aria-label="Start a new conversation"
            >
              +
            </button>
          </div>
          <div className="conversation-list-content">
            {getConversationList().length === 0 ? (
              <div className="conversation-list-empty">
                <p>No conversations yet</p>
                <p className="empty-hint">Start a conversation to see it here</p>
              </div>
            ) : (
              getConversationList().map((conv) => (
                <div
                  key={conv.id}
                  className={`conversation-item ${conv.id === conversationId ? 'active' : ''}`}
                  onClick={() => switchConversation(conv.id)}
                >
                  <div className="conversation-item-content">
                    <div className="conversation-item-title">{conv.title || 'Untitled'}</div>
                    <div className="conversation-item-meta">
                      {conv.turns?.length || 0} message{conv.turns?.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <button
                    className="delete-conversation-btn"
                    onClick={(e) => deleteConversation(conv.id, e)}
                    title="Delete conversation"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Main chat area */}
      <div className="main-chat-area">
        {error && (
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        )}

        {hasTurns ? (
          <>
            <div className="chat-feed" ref={chatFeedRef}>
              {turns.map((turn, turnIndex) => (
                <div key={turn.id} className={`turn ${turnIndex > 0 ? 'turn-spaced' : ''}`}>
                  {/* User bubble - show the actual prompt that was sent */}
                  <div className="user-bubble">
                    {/* Check if this is an enhanced prompt (Tier 3) */}
                    {turn.chosenPromptVersion === 'edited' || turn.chosenPromptVersion === 'rewritten' ? (
                      <div className="enhanced-prompt-container">
                        <div className="enhanced-prompt-label">Enhanced prompt</div>
                        <div className="enhanced-prompt-content">
                          {turn.chosenPromptVersion === 'edited' && turn.edited_prompt
                            ? turn.edited_prompt
                            : turn.rewritten_prompt}
                        </div>
                      </div>
                    ) : (
                      <div className="bubble-content">
                        {turn.originalPrompt}
                      </div>
                    )}
                    {/* Enhancer metadata line below bubble - Tier 2 */}
                    {(turn.rewrite_strategy || (!turn.rewrite_strategy && turn.intent === null)) && (
                      <div className={`user-enhancer-metadata ${!turn.rewrite_strategy && turn.intent === null ? 'enhancer-off' : ''}`}>
                        Enhancer: {turn.rewrite_strategy 
                          ? (turn.rewrite_strategy === 'learning_explanation' ? 'Learning' 
                            : turn.rewrite_strategy === 'socratic_questioning' ? 'Socratic'
                            : turn.rewrite_strategy)
                          : 'Off'}
                      </div>
                    )}
                  </div>

                  {/* Assistant answer - with inline reasoning strip if available */}
                  {turn.reasoningStage === 'answering' && (
                    <div className="assistant-bubble">
                      <div className="bubble-content">
                        <div className="answer-loading-indicator">
                          <div className="spinner"></div>
                          <span>Generating answer...</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Final answer - show with inline reasoning if available */}
                  {turn.reasoningStage === 'done' && turn.final_answer && (
                    <div className="assistant-bubble">
                      {turn.showReasoning && 
                      turn.chosenPromptVersion !== null ? (
                        <AnswerMessage
                          answer={turn.final_answer}
                          intent={turn.intent || ''}
                          topic={turn.topic || ''}
                          rationale={turn.decisionRationale || ''}
                          choice={turn.chosenPromptVersion === 'original' 
                            ? 'original' 
                            : (turn.chosenPromptVersion === 'rewritten' || turn.chosenPromptVersion === 'edited')
                            ? 'rewritten'
                            : null}
                          onOpenFullBreakdown={() => {
                            // Open modal in post-choice mode
                            openCompareModal(turn.id);
                          }}
                        />
                      ) : (
                        <div className="answer-message-wrapper answer-message-wrapper-tier1">
                          <div className="answer-body-text">
                            <MarkdownMessage text={turn.final_answer} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-chat-state">
            <h2>Start a conversation</h2>
            <p>Ask a question to begin learning with the agent</p>
          </div>
        )}

        {/* Input area at bottom */}
        <form onSubmit={handleSubmit} className="chat-input-form">
          <div className="input-container">
            {/* First row: Prompt input */}
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                // Auto-resize textarea
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              placeholder="Type your question here... (e.g., 'What is reinforcement learning?')"
              rows={1}
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              className="prompt-textarea"
            />
            {/* Second row: Control bar */}
            <div className="control-bar">
              <div className="control-bar-left">
                <div className="control-group">
                  <span className="control-label">Enhancer:</span>
                  <button
                    type="button"
                    onClick={() => setEnhancerEnabled(!enhancerEnabled)}
                    disabled={loading}
                    className={`enhancer-pill ${enhancerEnabled ? 'enhancer-on' : 'enhancer-off'}`}
                  >
                    {enhancerEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="control-group">
                  <span className="control-label">Mode:</span>
                  <select
                    id="mode"
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                    disabled={loading || !enhancerEnabled}
                    className="mode-select"
                    style={{ opacity: enhancerEnabled ? 1 : 0.5 }}
                  >
                    <option value="learning">Learning</option>
                    <option value="socratic">Socratic</option>
                  </select>
                </div>
              </div>
              <div className="control-bar-right">
                <button type="submit" disabled={!prompt.trim()} className="send-button">
                  →
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* Agent Reasoning Modal - Loading State */}
      {modalTurn && (modalTurn.reasoningStage === 'classifying' || modalTurn.intent === null) && (
        <div className="modal-overlay" onClick={closeCompareModal}>
          <div className="modal-content modal-reasoning" onClick={(e) => e.stopPropagation()}>
            <button 
              className="modal-close" 
              onClick={closeCompareModal}
              title="Close"
            >
              ×
            </button>
            <div className="enhancing-state">
              <div className="enhancing-spinner">
                <div className="spinner"></div>
              </div>
              <div className="enhancing-text">Enhancing your prompt...</div>
              <div className="enhancing-subtext">Analyzing intent, topic, and optimizing for learning</div>
            </div>
          </div>
        </div>
      )}

      {/* Agent Reasoning Modal - New Premium Version */}
      {modalTurn && 
       modalTurn.reasoningStage !== 'classifying' && 
       modalTurn.intent !== null && 
       modalTurn.reasoningStage !== 'answering' && (
        (() => {
          // Determine mode based on whether a choice has been made
          const hasChoice = modalTurn.chosenPromptVersion !== null && modalTurn.chosenPromptVersion !== undefined;
          const modalMode = hasChoice ? 'postChoice' : 'preChoice';
          // Pass the actual chosenPromptVersion as choice to differentiate between 'rewritten' and 'edited'
          const choice = modalTurn.chosenPromptVersion === 'original' ? 'original' 
            : modalTurn.chosenPromptVersion === 'rewritten' ? 'rewritten'
            : modalTurn.chosenPromptVersion === 'edited' ? 'edited'
            : null;
          
          // Parse promptFeedback into bullets array
          let reasoningBullets = [];
          if (modalTurn.promptFeedback) {
            if (Array.isArray(modalTurn.promptFeedback)) {
              reasoningBullets = modalTurn.promptFeedback;
            } else if (typeof modalTurn.promptFeedback === 'string') {
              const lines = modalTurn.promptFeedback.split('\n').filter(line => line.trim());
              reasoningBullets = lines.map(line => 
                line.replace(/^[-•*]\s*/, '').trim()
              ).filter(Boolean);
              if (reasoningBullets.length === 0 && modalTurn.promptFeedback.trim()) {
                reasoningBullets = [modalTurn.promptFeedback.trim()];
              }
            }
          }

          // Always pass the original rewritten_prompt, and separately pass edited_prompt if it exists
          return (
            <AgentReasoningModal
              isOpen={!!modalTurn}
              onClose={closeCompareModal}
              intent={modalTurn.intent || ''}
              topic={modalTurn.topic || ''}
              rationale={modalTurn.decisionRationale || ''}
              originalPrompt={modalTurn.originalPrompt || ''}
              rewrittenPrompt={modalTurn.rewritten_prompt || ''}
              editedPrompt={modalTurn.edited_prompt || undefined}
              choice={choice}
              mode={modalMode}
              draftRewrite={draftRewrite}
              onDraftRewriteChange={setDraftRewrite}
              reasoningBullets={reasoningBullets}
              onUseOriginal={modalMode === 'preChoice' ? () => choosePromptVersion(modalTurn.id, 'original') : undefined}
              onUseRewritten={modalMode === 'preChoice' ? () => {
                // The function will detect if draftRewrite was edited
                choosePromptVersion(modalTurn.id, 'rewritten');
              } : undefined}
            />
          );
        })()
      )}

      {/* Generating Answer State (if already chosen prompt) */}
      {modalTurn && modalTurn.reasoningStage === 'answering' && (
        <div className="modal-overlay" onClick={closeCompareModal}>
          <div className="modal-content modal-reasoning" onClick={(e) => e.stopPropagation()}>
            <button 
              className="modal-close" 
              onClick={closeCompareModal}
              title="Close"
            >
              ×
            </button>
            <h2 className="modal-title">Agent Reasoning</h2>
            <div className="modal-reasoning-card">
              <div className="modal-card-header">
                Generating answer…
              </div>
              <div className="modal-card-body">
                <div className="step-loading">
                  <div className="spinner"></div>
                  <span>Crafting response...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmDialog.isOpen}
        title="Delete Conversation"
        message="Are you sure you want to delete this conversation? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}

export default Interaction;
