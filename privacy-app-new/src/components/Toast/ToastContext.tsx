import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import './toast.css';

type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  txHash?: string;
  duration?: number;
}

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  txHash?: string;
  duration: number;
}

interface ToastContextValue {
  toasts: Toast[];
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  warning: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return ctx;
};

const randomId = () => Math.random().toString(36).slice(2);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: ToastType, message: string, options?: ToastOptions) => {
    const id = randomId();
    const duration = options?.duration ?? 5000;

    setToasts(prev => [...prev, { id, type, message, txHash: options?.txHash, duration }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const contextValue: ToastContextValue = {
    toasts,
    success: (msg, opts) => addToast('success', msg, opts),
    error: (msg, opts) => addToast('error', msg, opts),
    warning: (msg, opts) => addToast('warning', msg, opts),
    info: (msg, opts) => addToast('info', msg, opts),
    dismiss,
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <div className="toast-body">
              <strong className="toast-message">{toast.message}</strong>
              {toast.txHash && (
                <a
                  href={`https://sepolia.starkscan.co/tx/${toast.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="toast-link"
                >
                  View on explorer ↗
                </a>
              )}
            </div>
            <button className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss toast">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
