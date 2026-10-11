import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameStatus, InstallProgress } from '@shared/types'
import { Dlc } from './pages/Dlc'
import { GameFiles } from './pages/GameFiles'
import { Home } from './pages/Home'
import { Mods } from './pages/Mods'
import { Saves } from './pages/Saves'
import { Settings } from './pages/Settings'
import lockup from './assets/lockup.png'
import { Icon, type IconName, type Notify } from './ui'

type PageId = 'home' | 'settings' | 'saves' | 'dlc' | 'mods' | 'files'

const PAGES: { id: PageId; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Play', icon: 'home' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'saves', label: 'Saves', icon: 'saves' },
  { id: 'dlc', label: 'DLC', icon: 'dlc' },
  { id: 'mods', label: 'Mods', icon: 'mods' },
  { id: 'files', label: 'Game files', icon: 'folder' }
]

interface Toast {
  message: string
  kind: 'info' | 'error'
}

export function App() {
  const [page, setPage] = useState<PageId>('home')
  const [status, setStatus] = useState<GameStatus | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const notify = useCallback<Notify>((message, kind = 'info') => {
    clearTimeout(toastTimer.current)
    setToast({ message, kind })
    toastTimer.current = setTimeout(() => setToast(null), kind === 'error' ? 7000 : 3500)
  }, [])

  useEffect(() => {
    void window.skate.getStatus().then(setStatus)
    const unsubscribe = [
      window.skate.onStatus(setStatus),
      window.skate.onInstallProgress(setProgress),
      window.skate.onNotice((message) => notify(message, 'error'))
    ]
    return () => unsubscribe.forEach((stop) => stop())
  }, [notify])

  if (!status) return <div className="app" />

  return (
    <div className="app">
      <div className="titlebar">
        <img className="brand" src={lockup} alt="Skate 3" draggable={false} />
      </div>

      <nav className="sidebar" aria-label="Sections">
        {PAGES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            aria-current={page === item.id ? 'page' : undefined}
            onClick={() => setPage(item.id)}
          >
            <Icon name={item.icon} />
            {item.label}
          </button>
        ))}
        <div className={`run-state ${status.running ? 'on' : ''}`}>
          <span className="dot" />
          {status.running ? 'Game running' : 'Game closed'}
        </div>
      </nav>

      <main className="content">
        {page === 'home' && (
          <Home status={status} setStatus={setStatus} notify={notify} progress={progress} />
        )}
        {page === 'settings' && (
          <Settings status={status} setStatus={setStatus} notify={notify} progress={progress} />
        )}
        {page === 'saves' && <Saves status={status} notify={notify} />}
        {page === 'dlc' && <Dlc status={status} notify={notify} />}
        {page === 'mods' && <Mods status={status} notify={notify} />}
        {page === 'files' && <GameFiles status={status} notify={notify} />}
      </main>

      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.message}
        </div>
      )}
    </div>
  )
}
