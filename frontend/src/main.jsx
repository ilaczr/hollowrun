import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { captureRendererException, initializeRendererCrashReporting } from './crash-reporting.js'

initializeRendererCrashReporting()

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    captureRendererException(error)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <main className="fatal-error-screen">
        <div className="fatal-error-card" role="alert">
          <img src="/hollowrun.svg" alt="" aria-hidden="true" />
          <h1>HollowRun encountered an unexpected error</h1>
          <p>If automatic crash reports are enabled, a privacy-filtered report was sent.</p>
          <div className="fatal-error-actions">
            <button type="button" onClick={() => window.location.reload()}>Reload</button>
            <button type="button" onClick={() => window.hollowrun?.restart()}>Restart HollowRun</button>
          </div>
        </div>
      </main>
    )
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
