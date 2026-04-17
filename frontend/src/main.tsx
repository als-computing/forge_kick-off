import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinchConfigProvider } from '@blueskyproject/finch';
import '@blueskyproject/finch/style.css'; //<--Import this file once at the top level
import App from './app/App';
import './app/index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <FinchConfigProvider config={{
          tiledApiUrl: 'http://localhost:8000/api/v1',
          tiledApiKey: 'your-tiled-key',
          ophydApiUrl: 'http://localhost:8001/api/v1',
          qServerApiUrl: 'http://localhost:60610/api',
          qServerApiKey: 'your-api-key',
        }}>
          <App />
        </FinchConfigProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>
);
