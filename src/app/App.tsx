import { BrowserRouter } from 'react-router-dom';
import AppRoutes from './routes';
import { JobProvider } from './JobContext';
import StepProgress from '../components/StepProgress';
import SavedIndicator from '../components/SavedIndicator';
import '../styles/app.css';

export default function App() {
  return (
    <BrowserRouter>
      <JobProvider>
        <div className="app-shell">
          <header className="app-header">
            <h1>FormReady</h1>
            <p className="tagline">Show the requirements. Get your document ready.</p>
          </header>
          <StepProgress />
          <main className="app-main">
            <AppRoutes />
          </main>
          <footer className="app-footer">
            <SavedIndicator />
            {/* Section 11: never imply recovery the app does not provide. */}
            <p>
              Your document stays on this phone and is never uploaded. Clearing your browser data
              removes it.
            </p>
          </footer>
        </div>
      </JobProvider>
    </BrowserRouter>
  );
}
