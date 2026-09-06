import { Navigate, Route, Routes } from 'react-router-dom';
import RequirementsPage from '../features/requirements/RequirementsPage';
import DocumentPage from '../features/capture/DocumentPage';
import PreparePage from '../features/preparation/PreparePage';
import ReviewPage from '../features/review/ReviewPage';
import DemoPortalPage from '../features/demo/DemoPortalPage';

/** The four workflow screens, plus the clearly-separated demo checker. */
export const STEPS = [
  { path: '/requirements', label: 'Requirements' },
  { path: '/document', label: 'Document' },
  { path: '/prepare', label: 'Prepare' },
  { path: '/review', label: 'Review' },
] as const;

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/requirements" replace />} />
      <Route path="/requirements" element={<RequirementsPage />} />
      <Route path="/document" element={<DocumentPage />} />
      <Route path="/prepare" element={<PreparePage />} />
      <Route path="/review" element={<ReviewPage />} />
      {/* Outside the product journey; labelled as a demo, never as a portal. */}
      <Route path="/demo-upload-checker" element={<DemoPortalPage />} />
      <Route path="*" element={<Navigate to="/requirements" replace />} />
    </Routes>
  );
}
