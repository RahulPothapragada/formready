import { NavLink, useLocation } from 'react-router-dom';
import { STEPS } from '../app/routes';

/** Position indicator for the four-step journey. Hidden on the demo page. */
export default function StepProgress() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/demo-upload-checker')) return null;

  const currentIndex = STEPS.findIndex((step) => step.path === pathname);

  return (
    <nav className="step-progress" aria-label="Progress">
      <ol>
        {STEPS.map((step, index) => (
          <li key={step.path} aria-current={index === currentIndex ? 'step' : undefined}>
            <NavLink to={step.path}>
              <span className="step-number">{index + 1}</span>
              <span className="step-label">{step.label}</span>
            </NavLink>
          </li>
        ))}
      </ol>
    </nav>
  );
}
