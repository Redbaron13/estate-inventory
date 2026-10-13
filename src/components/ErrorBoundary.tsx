import { Component, type ErrorInfo, type ReactNode } from 'react';
import { APP_VERSION } from '../lib/config';
import { recordDiagnostic } from '../lib/diagnostics';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error(error, info.componentStack);
    void recordDiagnostic('error', 'runtime', 'UI_RENDER_FAILED', 'A screen stopped unexpectedly.');
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="mx-auto max-w-xl px-5 py-12">
          <h1 className="mb-3">This screen could not open</h1>
          <p className="mb-5">Your saved work stays on this phone. Reload the app, then try again. If this keeps happening, share code UI_RENDER_FAILED and version {APP_VERSION} with the person helping you.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload app</button>
        </main>
      );
    }
    return this.props.children;
  }
}
