from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Literal, List, Dict
import os
import logging
import uuid
from datetime import datetime
from dotenv import load_dotenv
from sqlalchemy import desc

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv()

from models import Interaction, SessionLocal, init_db
from llm_helpers import classify_intent, rewrite_prompt, get_llm_response

app = FastAPI(title="Learning Intent Agent API")

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],  # Vite default port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    init_db()


# ========== Request/Response Models ==========

class InteractRequest(BaseModel):
    prompt: str
    enhancerEnabled: bool
    mode: Optional[Literal["learning", "socratic"]] = None  # Only used when enhancerEnabled is true
    conversationId: Optional[str] = None


class InteractResponse(BaseModel):
    interaction_id: str
    conversationId: str
    intent: Optional[str]  # null if enhancerEnabled is false
    topic: Optional[str]  # null if enhancerEnabled is false
    rewritten_prompt: Optional[str]  # null if enhancerEnabled is false or no rewrite
    rewrite_strategy: Optional[str]  # null if enhancerEnabled is false or no rewrite; "learning_explanation", "socratic_questioning", "other"
    decisionRationale: str  # Natural language explanation of the agent's decision
    promptFeedback: Optional[str]  # Formatted bullet points explaining what changed and why (null if enhancerEnabled is false or no rewrite)
    final_answer: Optional[str]  # null if enhancerEnabled is true (answer generated later via /answer), populated if enhancerEnabled is false
    showReasoning: bool  # True if enhancer was enabled for this interaction, False otherwise


class AnswerRequest(BaseModel):
    prompt: str  # The chosen prompt (original, rewritten, or edited)
    mode: Literal["learning", "socratic"]
    intent: str
    topic: str
    interaction_id: Optional[str] = None
    conversationId: Optional[str] = None
    chosen_version: Optional[Literal["original", "rewritten", "edited"]] = None
    original_prompt: Optional[str] = None  # For logging
    rewritten_prompt: Optional[str] = None  # For logging


class AnswerResponse(BaseModel):
    final_answer: str


# ========== Helper Functions ==========

def generate_decision_rationale(
    enhancer_enabled: bool,
    mode: Optional[str],
    intent: Optional[str],
    rewritten_prompt: Optional[str],
    rewrite_strategy: Optional[str]
) -> str:
    """
    Generate a natural-language rationale explaining the agent's decision.
    
    Decision Policy:
    - If enhancer is disabled: Use original prompt directly
    - If enhancer is enabled:
      - Learning mode: Rewrite to encourage deep, structured understanding with examples
      - Socratic mode: Rewrite to encourage the model to ask clarifying questions first
      - Rewrite is applied based on mode and intent classification
    """
    if not enhancer_enabled:
        return "The enhancer is disabled, so the agent kept your original wording and sent it directly to the model."
    
    if not mode:
        return "The enhancer is enabled but no mode was specified."
    
    # If no rewrite happened (should be rare, but handle it)
    if not rewritten_prompt or not rewrite_strategy:
        return f"You're in {mode.capitalize()} mode, so the agent kept your original wording and sent it directly to the model."
    
    # Build rationale based on mode, intent, and rewrite strategy
    if mode == "learning":
        if intent == "conceptual":
            return f"Your question was classified as conceptual and you're in Learning mode, so the agent expanded your prompt to encourage a deeper explanation with examples and a small exercise."
        elif intent == "direct_answer":
            return f"Your question was classified as requesting a direct answer, but you're in Learning mode, so the agent transformed it into a learning opportunity with structured explanations and examples."
        elif intent == "debugging":
            return f"Your question was classified as debugging, and you're in Learning mode, so the agent rewrote your prompt to guide you toward understanding the root cause with examples."
        elif intent == "intuition":
            return f"Your question was classified as seeking intuition, and you're in Learning mode, so the agent expanded your prompt to focus on building deep understanding of why things work."
        elif intent == "example":
            return f"Your question was classified as requesting examples, and you're in Learning mode, so the agent structured your prompt to request examples with clear explanations."
        else:
            return f"You're in Learning mode, so the agent expanded your prompt to encourage a deeper explanation with examples and a small exercise."
    
    elif mode == "socratic":
        return f"Because you selected Socratic mode, the agent rewrote your prompt to encourage the model to ask you clarifying questions before explaining."
    
    else:
        return f"You're in {mode.capitalize()} mode, so the agent processed your prompt accordingly."


# ========== Endpoints ==========

@app.post("/interact", response_model=InteractResponse)
async def interact(request: InteractRequest):
    """
    Process user prompt with optional enhancement.
    - If enhancerEnabled is false: Generate final answer directly from raw prompt
    - If enhancerEnabled is true: Classify intent, rewrite prompt, then generate final answer
    """
    logger.info(f"=== NEW /interact REQUEST ===")
    logger.info(f"Enhancer enabled: {request.enhancerEnabled}")
    logger.info(f"Mode: {request.mode or 'N/A (enhancer disabled)'}")
    logger.info(f"ConversationId: {request.conversationId or 'NEW'}")
    logger.info(f"Prompt length: {len(request.prompt)}")
    logger.debug(f"Prompt: {request.prompt[:100]}...")
    
    # Generate interaction_id for this interaction pair
    interaction_id = str(uuid.uuid4())
    logger.info(f"Generated interaction_id: {interaction_id}")
    
    # Determine or create conversation_id
    conversation_id = request.conversationId
    if not conversation_id:
        conversation_id = str(uuid.uuid4())
        logger.info(f"Created new conversation_id: {conversation_id}")
    else:
        logger.info(f"Using existing conversation_id: {conversation_id}")
    
    # Fetch conversation history for context (used in both paths)
    conversation_history = []
    active_socratic_prompt = None
    db = SessionLocal()
    try:
        # Get current turn_index for expiration check
        current_turn_index = 0
        if conversation_id:
            last_turn = db.query(Interaction).filter(
                Interaction.conversation_id == conversation_id
            ).order_by(desc(Interaction.turn_index)).first()
            current_turn_index = (last_turn.turn_index + 1) if last_turn else 0
        
        # Fetch conversation history (last 5 turns for context)
        if conversation_id:
            # Get the most recent Socratic prompt (query all turns, not just last 5)
            socratic_turn = db.query(Interaction).filter(
                Interaction.conversation_id == conversation_id,
                Interaction.socratic_system_prompt.isnot(None)
            ).order_by(desc(Interaction.turn_index)).first()
            
            socratic_prompt_turn_index = None
            if socratic_turn:
                active_socratic_prompt = socratic_turn.socratic_system_prompt
                socratic_prompt_turn_index = socratic_turn.turn_index
                logger.debug(f"Found Socratic prompt at turn_index {socratic_prompt_turn_index}")
            
            # Fetch last 5 turns for conversation history (ordered descending to get most recent)
            history_turns = db.query(Interaction).filter(
                Interaction.conversation_id == conversation_id
            ).order_by(desc(Interaction.turn_index)).limit(5).all()
            
            # Reverse to get chronological order for conversation history
            history_turns = list(reversed(history_turns))
            
            logger.info(f"Found {len(history_turns)} previous turns for context")
            
            # Build conversation history for LLM
            for prev_turn in history_turns:
                if prev_turn.final_answer:  # Only include completed turns
                    conversation_history.append({
                        "role": "user",
                        "content": prev_turn.original_prompt
                    })
                    conversation_history.append({
                        "role": "assistant",
                        "content": prev_turn.final_answer
                    })
            
            # Expire Socratic prompt if it's been more than 3 turns
            if active_socratic_prompt and socratic_prompt_turn_index is not None:
                turns_since_socratic = current_turn_index - socratic_prompt_turn_index
                if turns_since_socratic >= 3:
                    logger.info(f"Socratic prompt expired after {turns_since_socratic} turns")
                    active_socratic_prompt = None
                else:
                    logger.debug(f"Socratic prompt active (turns since: {turns_since_socratic})")
            
            # Check for consecutive non-enhanced prompts after Socratic prompt
            should_clear_socratic = False
            if active_socratic_prompt and socratic_prompt_turn_index is not None and not request.enhancerEnabled:
                # Count consecutive non-enhanced interactions since the Socratic prompt
                # Get all COMPLETED interactions after the Socratic prompt (must have final_answer)
                recent_turns = db.query(Interaction).filter(
                    Interaction.conversation_id == conversation_id,
                    Interaction.turn_index > socratic_prompt_turn_index,
                    Interaction.final_answer.isnot(None)  # Only count completed turns
                ).order_by(desc(Interaction.turn_index)).all()  # Order descending to count from most recent
                
                logger.debug(f"Found {len(recent_turns)} completed turns after Socratic prompt (turn {socratic_prompt_turn_index})")
                
                # Count consecutive non-enhanced prompts from most recent backwards
                consecutive_non_enhanced = 0
                for turn in recent_turns:
                    logger.debug(f"  Turn {turn.turn_index}: mode={turn.mode}, has_final_answer={turn.final_answer is not None}")
                    # Non-enhanced: mode is None or empty string (enhancer disabled)
                    if turn.mode is None or turn.mode == "":
                        consecutive_non_enhanced += 1
                    else:  # Enhanced prompt - stop counting (we only care about consecutive from the end)
                        logger.debug(f"  Found enhanced turn {turn.turn_index}, stopping count")
                        break
                
                # If current request is also non-enhanced, add 1 to the count
                if not request.enhancerEnabled:
                    consecutive_non_enhanced += 1
                    logger.debug(f"  Current request is non-enhanced, total count: {consecutive_non_enhanced}")
                
                logger.info(f"Consecutive non-enhanced prompts since Socratic (turn {socratic_prompt_turn_index}): {consecutive_non_enhanced}")
                
                # Clear if 2 or more consecutive non-enhanced prompts
                if consecutive_non_enhanced >= 2:
                    logger.info(f"✓ CLEARING Socratic prompt after {consecutive_non_enhanced} consecutive non-enhanced prompt(s)")
                    should_clear_socratic = True
                    active_socratic_prompt = None
                else:
                    logger.debug(f"Socratic prompt remains active ({consecutive_non_enhanced} consecutive non-enhanced, need 2+)")
            
            # Detect explicit requests to stop questioning (still works immediately)
            if active_socratic_prompt:
                prompt_lower = request.prompt.lower()
                stop_phrases = [
                    "stop asking", "no more questions", "stop questioning", 
                    "please stop", "don't ask", "no questions", "stop the questions",
                    "go with the", "just explain", "give me the", "skip the questions",
                    "start explaining", "begin explaining", "explain", "start the explanation",
                    "i'm good", "nah im good", "im good", "that's enough", "thats enough"
                ]
                if any(phrase in prompt_lower for phrase in stop_phrases):
                    logger.info("User explicitly requested to stop Socratic questioning - clearing prompt")
                    should_clear_socratic = True
                    active_socratic_prompt = None
            
            # Clear Socratic prompt from database if needed (BEFORE closing the session)
            if should_clear_socratic and socratic_turn:
                try:
                    # Object is already attached to session, just update and commit
                    socratic_turn.socratic_system_prompt = None
                    db.commit()
                    logger.info(f"✓ Cleared Socratic prompt from database (turn {socratic_turn.turn_index})")
                except Exception as e:
                    logger.error(f"✗ Error clearing Socratic prompt from database: {str(e)}", exc_info=True)
                    db.rollback()
    except Exception as e:
        logger.error(f"✗ Error fetching conversation history: {str(e)}", exc_info=True)
        # Don't fail the request if history fetch fails, just continue without history
    finally:
        db.close()
    
    try:
        # Top-level toggle logic
        if not request.enhancerEnabled:
            # Enhancer disabled: skip classification and rewrite, generate answer directly
            logger.info("Enhancer disabled - skipping classification and rewrite")
            intent = None
            topic = None
            rewritten_prompt = None
            rewrite_strategy = None
            
            # Generate final answer from raw prompt with conversation history
            logger.info("Generating final answer from raw prompt...")
            logger.debug(f"Conversation history: {len(conversation_history)} messages")
            logger.debug(f"Active Socratic prompt: {'present' if active_socratic_prompt else 'none'}")
            try:
                final_answer = get_llm_response(
                    prompt=request.prompt,
                    conversation_history=conversation_history,
                    socratic_system_prompt=active_socratic_prompt
                )
                logger.info(f"✓ Got LLM response (length: {len(final_answer)})")
            except Exception as e:
                logger.error(f"✗ Error in get_llm_response: {str(e)}", exc_info=True)
                raise
            
            # Log interaction
            db = SessionLocal()
            try:
                last_turn = db.query(Interaction).filter(
                    Interaction.conversation_id == conversation_id
                ).order_by(desc(Interaction.turn_index)).first()
                
                turn_index = (last_turn.turn_index + 1) if last_turn else 0
                
                interaction = Interaction(
                    timestamp=datetime.now(),
                    interaction_id=interaction_id,
                    conversation_id=conversation_id,
                    turn_index=turn_index,
                    original_prompt=request.prompt,
                    mode="",  # Empty string when enhancer is disabled (database may not allow NULL)
                    intent="",  # Empty string when enhancer is disabled (database may not allow NULL)
                    topic="",  # Empty string when enhancer is disabled (database may not allow NULL)
                    rewritten_prompt=None,
                    final_answer=final_answer[:500]  # Store summary
                )
                
                db.add(interaction)
                db.commit()
                logger.info(f"✓ Interaction logged (interaction_id: {interaction_id}, turn: {turn_index})")
            except Exception as e:
                logger.error(f"✗ Error logging interaction: {str(e)}", exc_info=True)
                db.rollback()
            finally:
                db.close()
            
            # Generate decision rationale
            decision_rationale = generate_decision_rationale(
                enhancer_enabled=False,
                mode=None,
                intent=None,
                rewritten_prompt=None,
                rewrite_strategy=None
            )
            
            # Return response
            logger.info("=== /interact REQUEST COMPLETE ===")
            return InteractResponse(
                interaction_id=interaction_id,
                conversationId=conversation_id,
                intent=None,
                topic=None,
                rewritten_prompt=None,
                rewrite_strategy=None,
                decisionRationale=decision_rationale,
                promptFeedback=None,
                final_answer=final_answer,
                showReasoning=False  # Enhancer was disabled for this interaction
            )
        
        else:
            # Enhancer enabled: run existing behavior
            if not request.mode:
                raise HTTPException(
                    status_code=400, 
                    detail="mode is required when enhancerEnabled is true"
                )
            
            # Step 1: Classify intent and extract topic
            logger.info("Step 1: Classifying intent...")
            try:
                intent_result = classify_intent(request.prompt)
                intent = intent_result.get("intent", "other")
                topic = intent_result.get("topic", "general")
                logger.info(f"✓ Intent classified: {intent}, Topic: {topic}")
            except Exception as e:
                logger.error(f"✗ Error in classify_intent: {str(e)}", exc_info=True)
                raise
            
            # Step 2: Rewrite prompt based on mode and intent
            logger.info(f"Step 2: Processing mode '{request.mode}' with intent '{intent}'...")
            rewritten_prompt = None
            rewrite_strategy = None
            prompt_feedback_bullets = []
            
            try:
                rewritten_prompt, rewrite_strategy, prompt_feedback_bullets = rewrite_prompt(
                    original_prompt=request.prompt,
                    intent=intent,
                    mode=request.mode
                )
                logger.info(f"✓ Rewrite complete - strategy: '{rewrite_strategy}'")
                if rewritten_prompt:
                    logger.info(f"✓ Rewritten prompt length: {len(rewritten_prompt)}")
                    logger.debug(f"Rewritten prompt: {rewritten_prompt[:200]}...")
                if prompt_feedback_bullets:
                    logger.info(f"✓ Prompt feedback: {len(prompt_feedback_bullets)} bullets")
            except Exception as e:
                logger.error(f"✗ Error in rewrite_prompt: {str(e)}", exc_info=True)
                raise
            
            # Format prompt feedback bullets
            prompt_feedback = "\n".join(f"• {b}" for b in prompt_feedback_bullets if b) if prompt_feedback_bullets else None
            
            # Note: We do NOT generate the final answer here when enhancer is enabled.
            # The answer will be generated later via /answer endpoint after the user chooses
            # which prompt version to use (original, rewritten, or edited).
            
            # Log stub interaction (without final_answer - will be filled in by /answer)
            db = SessionLocal()
            try:
                last_turn = db.query(Interaction).filter(
                    Interaction.conversation_id == conversation_id
                ).order_by(desc(Interaction.turn_index)).first()
                
                turn_index = (last_turn.turn_index + 1) if last_turn else 0
                
                interaction = Interaction(
                    timestamp=datetime.now(),
                    interaction_id=interaction_id,
                    conversation_id=conversation_id,
                    turn_index=turn_index,
                    original_prompt=request.prompt,
                    mode=request.mode,
                    intent=intent,
                    topic=topic,
                    rewritten_prompt=rewritten_prompt,
                    final_answer=None  # Will be set by /answer endpoint
                )
                
                db.add(interaction)
                db.commit()
                logger.info(f"✓ Stub interaction logged (interaction_id: {interaction_id}, turn: {turn_index})")
            except Exception as e:
                logger.error(f"✗ Error logging interaction: {str(e)}", exc_info=True)
                db.rollback()
            finally:
                db.close()
            
            # Generate decision rationale
            decision_rationale = generate_decision_rationale(
                enhancer_enabled=True,
                mode=request.mode,
                intent=intent,
                rewritten_prompt=rewritten_prompt,
                rewrite_strategy=rewrite_strategy
            )
            
            # Return response (without final_answer - will be generated by /answer)
            logger.info("=== /interact REQUEST COMPLETE ===")
            return InteractResponse(
                interaction_id=interaction_id,
                conversationId=conversation_id,
                intent=intent,
                topic=topic,
                rewritten_prompt=rewritten_prompt,
                rewrite_strategy=rewrite_strategy,
                decisionRationale=decision_rationale,
                promptFeedback=prompt_feedback,
                final_answer=None,  # Answer will be generated by /answer endpoint
                showReasoning=True  # Enhancer was enabled for this interaction
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"✗✗✗ FATAL ERROR: {str(e)}", exc_info=True)
        logger.error(f"Error type: {type(e).__name__}")
        raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")


@app.post("/answer", response_model=AnswerResponse)
async def answer(request: AnswerRequest):
    """
    Step 2: Generate final answer based on user's chosen prompt.
    - Accepts the chosen prompt (original, rewritten, or edited)
    - Generates final answer with conversation context
    - Logs the complete interaction with chosen_version
    """
    logger.info(f"=== NEW /answer REQUEST ===")
    logger.info(f"Interaction ID: {request.interaction_id or 'NONE'}")
    logger.info(f"ConversationId: {request.conversationId or 'NONE'}")
    logger.info(f"Chosen version: {request.chosen_version or 'NONE'}")
    logger.info(f"Prompt length: {len(request.prompt)}")
    logger.debug(f"Prompt: {request.prompt[:200]}...")
    
    # Determine conversation_id and fetch history
    conversation_id = request.conversationId
    turn_index = 0
    conversation_history = []
    active_socratic_prompt = None
    
    db = SessionLocal()
    try:
        # If we have an interaction_id, try to find the stub interaction
        if request.interaction_id:
            stub_interaction = db.query(Interaction).filter(
                Interaction.interaction_id == request.interaction_id
            ).first()
            
            if stub_interaction:
                conversation_id = stub_interaction.conversation_id
                turn_index = stub_interaction.turn_index
                logger.info(f"Found stub interaction: conversation_id={conversation_id}, turn={turn_index}")
        
        # If no conversation_id yet, create one
        if not conversation_id:
            conversation_id = str(uuid.uuid4())
            logger.info(f"Created new conversation_id: {conversation_id}")
        
        # Get turn_index if not found from stub
        if turn_index == 0:
            last_turn = db.query(Interaction).filter(
                Interaction.conversation_id == conversation_id
            ).order_by(desc(Interaction.turn_index)).first()
            turn_index = (last_turn.turn_index + 1) if last_turn else 0
        
        # Get the most recent Socratic prompt (query all turns, not just last 5)
        socratic_turn = db.query(Interaction).filter(
            Interaction.conversation_id == conversation_id,
            Interaction.socratic_system_prompt.isnot(None)
        ).order_by(desc(Interaction.turn_index)).first()
        
        socratic_prompt_turn_index = None
        if socratic_turn:
            active_socratic_prompt = socratic_turn.socratic_system_prompt
            socratic_prompt_turn_index = socratic_turn.turn_index
            logger.debug(f"Found Socratic prompt at turn_index {socratic_prompt_turn_index}")
        
        # Fetch last 5 turns for conversation history (ordered descending to get most recent)
        history_turns = db.query(Interaction).filter(
            Interaction.conversation_id == conversation_id
        ).order_by(desc(Interaction.turn_index)).limit(5).all()
        
        # Reverse to get chronological order for conversation history
        history_turns = list(reversed(history_turns))
        
        logger.info(f"Found {len(history_turns)} previous turns for context")
        
        # Build conversation history for LLM
        for prev_turn in history_turns:
            if prev_turn.final_answer:  # Only include completed turns
                conversation_history.append({
                    "role": "user",
                    "content": prev_turn.original_prompt
                })
                conversation_history.append({
                    "role": "assistant",
                    "content": prev_turn.final_answer
                })
        
        # Expire Socratic prompt if it's been more than 3 turns
        if active_socratic_prompt and socratic_prompt_turn_index is not None:
            turns_since_socratic = turn_index - socratic_prompt_turn_index
            if turns_since_socratic >= 3:
                logger.info(f"Socratic prompt expired after {turns_since_socratic} turns")
                active_socratic_prompt = None
            else:
                logger.debug(f"Socratic prompt active (turns since: {turns_since_socratic})")
        
        # Detect explicit requests to stop questioning
        should_clear_socratic = False
        if active_socratic_prompt:
            prompt_lower = request.prompt.lower()
            stop_phrases = [
                "stop asking", "no more questions", "stop questioning", 
                "please stop", "don't ask", "no questions", "stop the questions",
                "go with the", "just explain", "give me the", "skip the questions",
                "start explaining", "begin explaining", "explain", "start the explanation",
                "i'm good", "nah im good", "im good", "that's enough", "thats enough"
            ]
            if any(phrase in prompt_lower for phrase in stop_phrases):
                logger.info("User explicitly requested to stop Socratic questioning - clearing prompt")
                should_clear_socratic = True
                active_socratic_prompt = None
        
        # Clear Socratic prompt from database if user explicitly requested to stop
        if should_clear_socratic and socratic_turn:
            try:
                socratic_turn.socratic_system_prompt = None
                db.commit()
                logger.info(f"✓ Cleared Socratic prompt from database (turn {socratic_turn.turn_index})")
            except Exception as e:
                logger.error(f"✗ Error clearing Socratic prompt from database: {str(e)}", exc_info=True)
                db.rollback()
    except Exception as e:
        logger.error(f"✗ Error setting up conversation: {str(e)}", exc_info=True)
        db.close()
        raise HTTPException(status_code=500, detail=f"Error setting up conversation: {str(e)}")
    finally:
        db.close()
    
    try:
        # Generate final answer from chosen prompt
        logger.info("Generating final LLM response with context...")
        logger.debug(f"Final prompt length: {len(request.prompt)}")
        logger.debug(f"Conversation history: {len(conversation_history)} messages")
        logger.debug(f"Active Socratic prompt: {'present' if active_socratic_prompt else 'none'}")
        try:
            final_answer = get_llm_response(
                prompt=request.prompt,
                conversation_history=conversation_history,
                socratic_system_prompt=active_socratic_prompt
            )
            logger.info(f"✓ Got LLM response (length: {len(final_answer)})")
            logger.debug(f"Response preview: {final_answer[:200]}...")
        except Exception as e:
            logger.error(f"✗ Error in get_llm_response: {str(e)}", exc_info=True)
            raise
        
        # Log the complete interaction
        logger.info("Logging complete interaction to database...")
        db = SessionLocal()
        try:
            # Check if there's already an active Socratic prompt in recent turns
            # Only store a new Socratic prompt if one doesn't already exist (to prevent resetting expiration)
            has_active_socratic = False
            if conversation_id:
                recent_socratic = db.query(Interaction).filter(
                    Interaction.conversation_id == conversation_id,
                    Interaction.socratic_system_prompt.isnot(None)
                ).order_by(desc(Interaction.turn_index)).first()
                if recent_socratic:
                    # Check if it's within the last 3 turns (not expired)
                    turns_since = turn_index - recent_socratic.turn_index
                    if turns_since < 3:
                        has_active_socratic = True
                        logger.debug(f"Active Socratic prompt found at turn {recent_socratic.turn_index}, not storing new one")
            
            # Try to update existing stub interaction if it exists
            if request.interaction_id:
                existing = db.query(Interaction).filter(
                    Interaction.interaction_id == request.interaction_id
                ).first()
                
                if existing:
                    existing.final_answer = final_answer[:500]  # Store summary
                    existing.final_prompt = request.prompt
                    existing.chosen_version = request.chosen_version
                    # Store Socratic system prompt only if mode is socratic, rewritten prompt was used, AND no active Socratic prompt exists
                    if request.mode == "socratic" and request.chosen_version == "rewritten" and request.rewritten_prompt and not has_active_socratic:
                        existing.socratic_system_prompt = request.rewritten_prompt
                        logger.info(f"✓ Stored new Socratic prompt at turn {existing.turn_index}")
                    db.commit()
                    logger.info(f"✓ Updated existing interaction (ID: {existing.id})")
                else:
                    # Create new interaction record
                    interaction = Interaction(
                        timestamp=datetime.now(),
                        interaction_id=request.interaction_id,
                        conversation_id=conversation_id,
                        turn_index=turn_index,
                        original_prompt=request.original_prompt or request.prompt,
                        mode=request.mode,
                        intent=request.intent,
                        topic=request.topic,
                        rewritten_prompt=request.rewritten_prompt,
                        chosen_version=request.chosen_version,
                        final_prompt=request.prompt,
                        final_answer=final_answer[:500]
                    )
                    # Store Socratic system prompt only if mode is socratic, rewritten prompt was used, AND no active Socratic prompt exists
                    if request.mode == "socratic" and request.chosen_version == "rewritten" and request.rewritten_prompt and not has_active_socratic:
                        interaction.socratic_system_prompt = request.rewritten_prompt
                        logger.info(f"✓ Stored new Socratic prompt at turn {turn_index}")
                    db.add(interaction)
                    db.commit()
                    logger.info(f"✓ New interaction logged (interaction_id: {request.interaction_id})")
            else:
                # No interaction_id, create new record
                interaction = Interaction(
                    timestamp=datetime.now(),
                    conversation_id=conversation_id,
                    turn_index=turn_index,
                    original_prompt=request.original_prompt or request.prompt,
                    mode=request.mode,
                    intent=request.intent,
                    topic=request.topic,
                    rewritten_prompt=request.rewritten_prompt,
                    chosen_version=request.chosen_version,
                    final_prompt=request.prompt,
                    final_answer=final_answer[:500]
                )
                # Store Socratic system prompt only if mode is socratic, rewritten prompt was used, AND no active Socratic prompt exists
                if request.mode == "socratic" and request.chosen_version == "rewritten" and request.rewritten_prompt and not has_active_socratic:
                    interaction.socratic_system_prompt = request.rewritten_prompt
                    logger.info(f"✓ Stored new Socratic prompt at turn {turn_index}")
                db.add(interaction)
                db.commit()
                logger.info(f"✓ Interaction logged (conversation_id: {conversation_id}, turn: {turn_index})")
        except Exception as e:
            logger.error(f"✗ Error logging to database: {str(e)}", exc_info=True)
            db.rollback()
            # Don't fail the request if logging fails
        finally:
            db.close()
        
        # Return response
        logger.info("=== /answer REQUEST COMPLETE ===")
        return AnswerResponse(final_answer=final_answer)
        
    except Exception as e:
        logger.error(f"✗✗✗ FATAL ERROR: {str(e)}", exc_info=True)
        logger.error(f"Error type: {type(e).__name__}")
        raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "ok"}
