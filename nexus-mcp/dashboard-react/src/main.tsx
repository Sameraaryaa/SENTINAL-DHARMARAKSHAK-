import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import NFCVoicePage from './pages/NFCVoicePage'
import { AgentProvider } from './context/AgentContext' // DHARMARAKSHA NEW
import './index.css'

function Router() {
  const [route, setRoute] = useState(window.location.hash)

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (route === '#/nfc-voice') return <NFCVoicePage />
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AgentProvider>{/* DHARMARAKSHA NEW */}
      <Router />
    </AgentProvider>
  </React.StrictMode>,
)
