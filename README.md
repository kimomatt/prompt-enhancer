# Prompt Enhancer

An AI-powered tool that improves learning-oriented LLM usage by automatically classifying user intent and rewriting prompts based on selected learning modes (Learning or Socratic).

## Description

This prototype addresses the challenge of getting better educational responses from LLMs. Instead of sending prompts directly, the enhancer analyzes each prompt's learning intent (conceptual, debugging, intuition, etc.), then intelligently rewrites it to encourage deeper understanding. In Learning mode, prompts are expanded to request step-by-step explanations, examples, and exercises. In Socratic mode, the system guides users through discovery by asking clarifying questions first. The tool provides transparent reasoning about its decisions, allowing users to review and choose between original and rewritten prompts before generating the final answer.

## 🎥 Demo Video

Link: https://www.youtube.com/watch?v=kkVesdn0AhE

## Features

- **Prompt intent detection** — Automatically classifies prompts by learning intent (conceptual, debugging, intuition, example, direct_answer)
- **Learning-mode prompt rewriting** — Transforms prompts to request structured explanations, examples, and exercises
- **Socratic tutoring mode** — Rewrites prompts to guide discovery through questioning before explanation
- **Transparent reasoning UI** — Shows intent classification, topic extraction, and rewrite rationale with before/after comparison
- **Toggleable enhancer** — Can be disabled for direct LLM interaction without classification or rewriting
- **Backend persistence** — SQLite database stores conversation history, interaction metadata, and Socratic prompts that persist across turns
- **Conversation management** — Multi-conversation support with localStorage persistence and conversation switching

## Tech Stack

- **Frontend**: React, Vite, Tailwind CSS
- **Backend**: FastAPI, Python, SQLite (SQLAlchemy)
- **LLM**: OpenAI API (configurable model, default: gpt-4o-mini)

## Getting Started

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cp env.example .env
# Edit .env and add your OPENAI_API_KEY
uvicorn main:app --reload
```

Backend runs at `http://localhost:8000`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`

## Repo Structure

```
.
├── backend/
│   ├── main.py           # FastAPI app and endpoints
│   ├── models.py         # SQLAlchemy database models
│   ├── llm_helpers.py    # OpenAI API integration (classification, rewriting, responses)
│   ├── requirements.txt  # Python dependencies
│   └── env.example       # Environment variables template
├── frontend/
│   ├── src/
│   │   ├── App.jsx       # Main app component
│   │   ├── Interaction.jsx  # Main chat UI and conversation management
│   │   ├── components/
│   │   │   ├── AgentReasoningModal.tsx  # Reasoning breakdown UI
│   │   │   ├── AnswerMessage.tsx         # Answer display with reasoning peek
│   │   │   └── ConfirmDialog.jsx        # Delete confirmation dialog
│   │   └── *.css         # Component styles
│   └── package.json      # Node dependencies
└── README.md
```

## How It Works

### Classification → Rewriting → Feedback → Answer

1. **Intent Classification**: User prompt is analyzed by LLM to determine learning intent (conceptual, debugging, intuition, etc.) and extract topic.

2. **Prompt Rewriting**: Based on intent and selected mode (Learning or Socratic), the prompt is rewritten:
   - **Learning mode**: Expands to request high-level intuition, step-by-step walkthrough, examples, and a diagnostic question
   - **Socratic mode**: Transforms into meta-instructions that guide the LLM to ask clarifying questions before explaining

3. **User Choice**: Transparent UI shows original vs. rewritten prompt with reasoning bullets. User can choose original, rewritten, or edit the rewritten version.

4. **Final Answer**: Selected prompt is sent to LLM with conversation history for context-aware responses.

### Socratic Prompt Persistence

When Socratic mode is used with a rewritten prompt, the system stores the Socratic meta-prompt in the database. This prompt persists for up to 3 turns or until 2 consecutive non-enhanced prompts occur, ensuring the Socratic behavior continues across the conversation. Users can explicitly clear it by saying "stop asking" or similar phrases.

### Data Model

SQLite stores all interactions with metadata:
- `conversation_id` and `turn_index` for conversation threading
- `interaction_id` linking classification/rewrite to final answer
- `intent`, `topic`, `mode`, `rewritten_prompt`, `chosen_version`
- `socratic_system_prompt` for persistent Socratic behavior
- `final_answer` and conversation history for context
