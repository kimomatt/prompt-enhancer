# Learning Intent Agent - Frontend

This is the React frontend for the Learning Intent Agent application, built with Vite.

## Quick Start

### Prerequisites
- Node.js 18+ installed
- Backend server running (see [Backend Setup](#backend-setup) below)

### Frontend Setup

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`

### Backend Setup

Before starting the frontend, make sure the backend is running:

1. Navigate to the backend directory:
```bash
cd ../backend
```

2. Activate the virtual environment (if you haven't already):
```bash
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Make sure you have a `.env` file with your OpenAI API key:
```bash
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini
```

4. Start the backend server:
```bash
uvicorn main:app --reload
```

The backend API will be available at `http://localhost:8000`

## Starting the Full Application

To run the complete application:

1. **Terminal 1 - Backend:**
   ```bash
   cd backend
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   uvicorn main:app --reload
   ```

2. **Terminal 2 - Frontend:**
   ```bash
   cd frontend
   npm run dev
   ```

3. **Open your browser** and navigate to `http://localhost:5173`

## Available Scripts

- `npm run dev` - Start the development server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run preview` - Preview the production build

## Notes

- The frontend is configured to connect to the backend at `http://localhost:8000`
- CORS is enabled on the backend to allow requests from `http://localhost:5173`
- See the main [README.md](../README.md) for more details about the application
