import os
import logging
from pathlib import Path
from openai import OpenAI
from typing import Dict, List, Optional, Tuple
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load environment variables from .env file
# Get the directory where this file is located
backend_dir = Path(__file__).parent
env_path = backend_dir / ".env"
load_dotenv(dotenv_path=env_path)

# Model to use (can be configured)
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# Lazy initialization of OpenAI client
_client = None

def get_client():
    """Get or create the OpenAI client (lazy initialization)"""
    global _client
    if _client is None:
        logger.debug("Initializing OpenAI client...")
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.error("OPENAI_API_KEY not found in environment")
            raise ValueError(
                f"OPENAI_API_KEY not found in environment variables. "
                f"Please set it in your .env file at {env_path}"
            )
        logger.debug(f"API key found (length: {len(api_key) if api_key else 0})")
        try:
            logger.debug("Creating OpenAI client instance...")
            import httpx
            logger.debug(f"httpx version: {httpx.__version__}")
            logger.debug(f"OpenAI module: {OpenAI.__module__}")
            _client = OpenAI(api_key=api_key)
            logger.info("✓ OpenAI client initialized successfully")
        except Exception as e:
            logger.error(f"✗ Error creating OpenAI client: {str(e)}", exc_info=True)
            logger.error(f"Error type: {type(e).__name__}")
            logger.error(f"Error args: {e.args}")
            raise
    else:
        logger.debug("Reusing existing OpenAI client")
    return _client


def classify_intent(prompt: str) -> Dict[str, str]:
    """
    Classifies the learning intent of a prompt and extracts the topic.
    Returns: {"intent": "...", "topic": "..."}
    """
    logger.debug(f"classify_intent called with prompt length: {len(prompt)}")
    classification_prompt = f"""Analyze the following user prompt and classify it by learning intent and extract the main topic.

Learning Intent Categories:
- "direct_answer": User wants a quick, direct answer without explanation
- "conceptual": User wants to understand a concept deeply
- "debugging": User is trying to fix an error or solve a problem
- "intuition": User wants to build intuition or understand "why" something works
- "example": User wants examples or demonstrations
- "other": Doesn't fit the above categories

Return your response in this exact JSON format:
{{
  "intent": "one of the categories above",
  "topic": "a short topic description (e.g., 'reinforcement learning', 'sql joins', 'python decorators')"
}}

User prompt:
{prompt}

JSON response:"""

    try:
        logger.debug("Getting OpenAI client for classification...")
        client = get_client()
        logger.debug("Calling OpenAI API for classification...")
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "You are a learning intent classifier. Always respond with valid JSON only."},
                {"role": "user", "content": classification_prompt}
            ],
            temperature=0.3,
            response_format={"type": "json_object"}
        )
        
        import json
        content = response.choices[0].message.content
        if not content:
            return {"intent": "other", "topic": "general"}
        result = json.loads(content)
        return {
            "intent": result.get("intent", "other"),
            "topic": result.get("topic", "general")
        }
    except Exception as e:
        # Fallback if classification fails
        return {"intent": "other", "topic": "general"}


def rewrite_prompt(original_prompt: str, intent: str, mode: str) -> Tuple[Optional[str], str, List[str]]:
    """
    Rewrites a prompt to be more learning-oriented based on mode and intent.
    
    Args:
        original_prompt: The user's original prompt
        intent: The classified intent (e.g., "direct_answer", "conceptual", "debugging", "intuition", "example", "other")
        mode: The learning mode ("learning" or "socratic")
    
    Returns:
        A tuple of (rewritten_prompt: Optional[str], rewrite_strategy: str, prompt_feedback: List[str])
        - rewritten_prompt: The rewritten prompt (or original if no rewrite)
        - rewrite_strategy: "learning_explanation", "socratic_questioning", or "other"
        - prompt_feedback: List of 2-3 bullet points explaining what changed and why
    """
    # Build rewrite instructions based on mode
    if mode == "learning":
        rewrite_instruction = """
Rewrite this prompt so that it turns the original question into a **deep, structured learning task**, not just a more verbose version.

The rewritten prompt should:
- Keep the user’s original goal and topic.
- Start with a request for a **high-level intuition first**, then a more formal explanation.
- Ask for a **step-by-step walkthrough** (when relevant, e.g., algorithms / processes).
- Ask for **2–3 concrete examples or scenarios** that make the idea feel real.
- (If applicable) Ask for **a small numerical or code example** to ground the idea.
- End with **1 short diagnostic question or mini-exercise** the user can use to test themselves.

Constraints:
- Keep the rewritten prompt to 1–3 sentences or bullet points (concise but structured).
- Do NOT restate the original prompt text verbatim; transform it into clear instructions to the LLM.

Example style:
"Explain [concept] starting from an intuitive explanation, then give a step-by-step walkthrough and a small numerical example. After that, show 2–3 real-world applications, and finish with a short question I can answer to check my understanding."
"""
        rewrite_strategy = "learning_explanation"

    elif mode == "socratic":
        rewrite_instruction = """
    Rewrite the user's prompt into a **strict meta-instruction** that tells the LLM how to behave as a Socratic tutor.

    The rewritten prompt must enforce ALL of the following rules:

    1. Start by asking the user **exactly 2 clarifying questions**, one after the other.
    2. DO NOT provide ANY explanation, definitions, hints, or teaching until the user has answered **BOTH** questions.
    3. After the user answers both questions, ask **1 additional probing question** based on their response.
    4. ONLY AFTER the user answers that probing question may you begin explaining the concept.
    5. When you explain, tailor it **specifically** to the user's expressed misunderstandings.
    6. Continue tutoring by alternating between:
    - asking a targeted question,
    - waiting for the user's answer,
    - giving a **small, incremental** explanation.
    7. NEVER give a full explanation in one dump. Break explanations into small pieces.
    8. NEVER skip ahead to teaching before the user has responded to your questions.
    9. Maintain a tone that is curious, patient, and encouraging.

    Important:
    - The rewritten prompt should NOT contain the actual questions or explanations.
    - It should be a **meta-instruction** describing HOW the LLM should conduct the interaction, not the content itself.

    Example style:
    "You are a Socratic tutor. Begin by asking me exactly two clarifying questions about my understanding of [topic]. Wait for my responses before explaining anything. After I answer both, ask one targeted follow-up question. Only then begin a step-by-step explanation tailored to my answers. Continue alternating between asking and explaining in small increments."

    Return only the rewritten meta-prompt.
    """
        rewrite_strategy = "socratic_questioning"

    else:
        # Fallback: return original with "other" strategy
        logger.warning(f"Unknown mode '{mode}', returning original prompt")
        return (original_prompt, "other", [])

    # Add intent-specific guidance
    intent_guidance = ""
    if intent == "debugging":
        intent_guidance = """
Because the intent is "debugging", make sure the rewritten prompt:
- Asks the LLM to reason about likely root causes,
- Requests an ordered checklist of things to try,
- And ends by asking what extra context (error messages, code snippets) I should provide next time.
"""
    elif intent == "intuition":
        intent_guidance = """
Because the intent is "intuition", focus the rewritten prompt on:
- metaphors, visualizations, and "why it works" reasoning,
- comparisons to simpler ideas the user might already know,
- and one or two probing questions that challenge common misconceptions.
"""
    elif intent == "example":
        intent_guidance = """
Because the intent is "example", make the rewritten prompt:
- Ask explicitly for several diverse, concrete examples,
- Include one example that is very close to a real-world scenario a student might see,
- And ask for a brief explanation of why each example fits.
"""
    elif intent == "conceptual":
        intent_guidance = """
Because the intent is "conceptual", emphasize:
- clear definitions,
- connections between related concepts,
- and a short summary that restates the idea in plain language.
"""
    # "direct_answer" and "other" just fall back to the general learning behaviour

    # Build the rewrite prompt with both mode and intent context
    rewrite_prompt_text = f"""You are a prompt rewriting assistant.

Given:
- the user's original prompt: "{original_prompt}"
- the selected mode: {mode}
- the detected intent: {intent}

{intent_guidance}

You MUST:
1. Rewrite the prompt (if helpful for this mode and intent).
2. Provide a short explanation (2-3 bullet points) for the user that:
   - highlights the most important change you made (not every tiny tweak),
   - ties that change directly to their original wording or goal,
   - and gives ONE very concrete "next time you write a prompt, try X" tip.
Avoid generic feedback like "this will enhance your learning" without specifics.

Instruction for rewriting:
{rewrite_instruction}

Respond in strict JSON with:
{{
  "rewrittenPrompt": "...",
  "rewriteStrategy": "{rewrite_strategy}",
  "promptFeedback": [
    "First bullet...",
    "Second bullet...",
    "Optional third bullet..."
  ]
}}"""

    try:
        logger.debug(f"Getting OpenAI client for prompt rewriting (mode={mode}, intent={intent})...")
        client = get_client()
        logger.debug("Calling OpenAI API for prompt rewriting...")
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are a prompt rewriting assistant that helps make prompts more learning-oriented. Always respond with valid JSON only."
                },
                {"role": "user", "content": rewrite_prompt_text},
            ],
            temperature=0.5,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content
        if not content:
            logger.warning("Empty response from rewrite API, returning original prompt")
            return (original_prompt, rewrite_strategy, [])

        import json
        try:
            result = json.loads(content)
            rewritten_prompt = result.get("rewrittenPrompt", original_prompt)
            rewrite_strategy = result.get("rewriteStrategy", rewrite_strategy)
            prompt_feedback = result.get("promptFeedback", [])

            # Ensure prompt_feedback is a list
            if not isinstance(prompt_feedback, list):
                prompt_feedback = []

            logger.info(f"✓ Prompt rewritten with strategy '{rewrite_strategy}' (length: {len(rewritten_prompt)})")
            logger.info(f"✓ Prompt feedback: {len(prompt_feedback)} bullets")
            return (rewritten_prompt, rewrite_strategy, prompt_feedback)
        except json.JSONDecodeError as e:
            logger.error(f"✗ Error parsing JSON response: {str(e)}", exc_info=True)
            logger.error(f"Response content: {content[:200]}...")
            # Fallback to original if JSON parsing fails
            return (original_prompt, rewrite_strategy, [])

    except Exception as e:
        logger.error(f"✗ Error in rewrite_prompt: {str(e)}", exc_info=True)
        # Fallback to original if rewriting fails
        return (original_prompt, rewrite_strategy, [])



def get_llm_response(
    prompt: str,
    conversation_history: List[Dict[str, str]] = None,
    socratic_system_prompt: Optional[str] = None,
) -> str:
    """
    Gets the final answer from the LLM for the given prompt.
    Includes conversation history for context if provided.
    If socratic_system_prompt is provided, uses it as the system message instead of the default.
    """
    logger.debug(f"get_llm_response called with prompt length: {len(prompt)}")
    if conversation_history:
        logger.debug(f"Conversation history: {len(conversation_history)} messages")
    if socratic_system_prompt:
        logger.debug("Using Socratic system prompt")
    
    try:
        logger.debug("Getting OpenAI client for final response...")
        client = get_client()
        logger.debug("Calling OpenAI API for final response...")
        
        # Build system message - use Socratic prompt if provided, otherwise use default
        if socratic_system_prompt:
            system_content = socratic_system_prompt
        else:
            system_content = (
                "You are a helpful AI assistant focused on teaching and learning. "
                "Provide clear, educational responses. You can reference previous parts of the conversation when relevant."
            )
        
        messages = [{"role": "system", "content": system_content}]
        
        # Add conversation history if provided
        if conversation_history:
            messages.extend(conversation_history)
        
        # Add current prompt
        messages.append({"role": "user", "content": prompt})
        
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            temperature=0.7
        )
        
        content = response.choices[0].message.content
        logger.debug(f"✓ Got response (length: {len(content) if content else 0})")
        return content if content else "No response generated."
    except Exception as e:
        logger.error(f"✗ Error in get_llm_response: {str(e)}", exc_info=True)
        logger.error(f"Error type: {type(e).__name__}")
        return f"Error getting LLM response: {str(e)}"

