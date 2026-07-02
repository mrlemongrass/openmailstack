import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: 40,
          textAlign: 'center',
          color: 'var(--text-secondary)',
          background: 'var(--bg-main)',
        }}>
          <div className="glass-panel" style={{ maxWidth: 480, width: '100%', padding: 40 }}>
            <AlertTriangle size={48} style={{ marginBottom: 16, color: 'var(--danger)', opacity: 0.7 }} />
            <h2 style={{ margin: '0 0 8px', fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Something went wrong
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: '0.9rem', lineHeight: 1.5 }}>
              An unexpected error occurred. Your data is safe — try reloading the page.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <RefreshCw size={16} />
              Reload page
            </button>
            <details style={{ marginTop: 24, textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.8rem', opacity: 0.6 }}>
                Error details
              </summary>
              <pre style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 'var(--radius-md)',
                background: 'rgba(0,0,0,0.3)',
                fontSize: '0.75rem',
                overflow: 'auto',
                maxHeight: 200,
              }}>
                {this.state.error.message}
              </pre>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
