import { useEffect, useState } from 'react'
import { roomService } from '../services/rooms'
import type { Category } from '../types/game'

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void roomService.categories().then(values => { if (active) setCategories(values) }).catch(cause => { if (active) { setCategories([]); setError(cause instanceof Error ? cause.message : '無法讀取分類。') } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision])
  return { categories, loading, error, retry: () => setRevision(value => value + 1) }
}
