// Never shows a stack trace to a crew member mid-shift — logs to Firestore
// and shows a plain recovery message instead (docs/03-M0-FOUNDATION.md §9).
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { getDeviceId } from '@/lib/deviceId'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    addDoc(collection(db, 'clientErrors'), {
      message: error.message,
      stack: error.stack ?? null,
      componentStack: info.componentStack ?? null,
      at: serverTimestamp(),
      deviceId: getDeviceId(),
      url: window.location.pathname,
    }).catch(() => {
      // If even the error log can't be written, there's nothing left to do
      // but let the recovery screen show — this must never throw again.
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-screen">
          <h1>Something went wrong</h1>
          <p>The app hit a problem and couldn't continue. Nothing you entered has been lost — Firestore keeps queued writes locally.</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}
