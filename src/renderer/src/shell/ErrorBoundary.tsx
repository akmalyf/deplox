import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Keeps one broken view from blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('[renderer]', error)
  }

  componentDidUpdate(prev: { resetKey?: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 }}>
        <h2 className="ad-empty-title">Something went wrong in this view</h2>
        <pre className="code-box" style={{ maxWidth: 720, whiteSpace: 'pre-wrap', margin: 0 }} id="error-detail">
          {this.state.error.message}
          {'\n'}
          {this.state.error.stack?.split('\n').slice(1, 6).join('\n')}
        </pre>
        <button type="button" className="ad-btn ad-btn-secondary" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
