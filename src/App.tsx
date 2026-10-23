import { useEffect } from 'react'
import { HashRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { CreateRoomPage } from './pages/CreateRoomPage'
import { JoinRoomPage } from './pages/JoinRoomPage'

function ScrollManager() {
  const { pathname, hash, search } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView()
    else window.scrollTo(0, 0)
  }, [pathname, hash])

  useEffect(() => {
    if (pathname !== '/' || hash !== '#how-to-play') return

    function syncHomeAtTop() {
      if (window.scrollY <= 1) {
        void navigate({ pathname, search, hash: '' }, { replace: true })
      }
    }

    window.addEventListener('scroll', syncHomeAtTop, { passive: true })
    return () => window.removeEventListener('scroll', syncHomeAtTop)
  }, [pathname, hash, search, navigate])

  return null
}

export default function App() {
  return <HashRouter><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>跳至主要內容</a><ScrollManager /><Routes><Route element={<Layout />}><Route index element={<HomePage />} /><Route path="host" element={<CreateRoomPage />} /><Route path="join" element={<JoinRoomPage />} /><Route path="*" element={<section className="inner-page"><h1>迷路了嗎？</h1><p>這個頁面不存在，回首頁再一起玩吧。</p><Link className="button button-primary" to="/">回到首頁 →</Link></section>} /></Route></Routes></HashRouter>
}
