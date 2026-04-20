import { useEffect, useState, useCallback } from 'react';
import { Layout } from './components/Layout';
import { useTranslation } from 'react-i18next';
import { useTheme } from './hooks/useTheme';

interface ErrorEntry {
  id: number;
  context: string;
  message: string;
}

let errorIdCounter = 0;

function App(): React.JSX.Element {
  const { t } = useTranslation();
  useTheme();
  const [errors, setErrors] = useState<ErrorEntry[]>([]);

  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ context: string; message: string }>).detail;
      const id = ++errorIdCounter;
      setErrors((prev) => [...prev, { id, ...detail }]);
      // Auto-dismiss after 8 seconds
      setTimeout(() => {
        setErrors((prev) => prev.filter((err) => err.id !== id));
      }, 8000);
    };
    window.addEventListener('arena:error', handler);
    return () => window.removeEventListener('arena:error', handler);
  }, []);

  const dismissError = useCallback((id: number) => {
    setErrors((prev) => prev.filter((err) => err.id !== id));
  }, []);

  return (
    <>
      <Layout />
      {errors.length > 0 && (
        <div className="toast-container">
          {errors.map((err) => (
            <div key={err.id} className="toast-error" role="alert">
              <div style={{ flex: 1 }}>
                <strong>{err.context}</strong>
                <div style={{ marginTop: 4, opacity: 0.9 }}>{err.message}</div>
              </div>
              <button
                onClick={() => dismissError(err.id)}
                className="toast-dismiss"
                aria-label={t('app.close')}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default App;
