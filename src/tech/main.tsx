import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Tech } from './Tech';
import '../styles.css';
import './tech.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Tech />
  </StrictMode>,
);
