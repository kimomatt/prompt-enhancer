import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Interaction from './Interaction';
import './App.css';

function App() {
  return (
    <Router>
      <div className="app">
        <header className="app-header">
          <div className="app-header-content">
            <h1 className="app-title">Prompt Enhancer</h1>
            <p className="app-subtitle">Your personal prompt improvement agent</p>
          </div>
        </header>
        <div className="main-content">
          <Routes>
            <Route path="/" element={<Interaction />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
