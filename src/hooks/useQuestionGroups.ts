import { useEffect, useState } from 'react'
import { roomService } from '../services/rooms'
import type { QuestionGroup } from '../types/game'

export function useQuestionGroups() {
  const [groups, setGroups] = useState<QuestionGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void roomService.questionGroups().then(values => {
      if (active) setGroups(values)
    }).catch(cause => {
      if (active) {
        setGroups([])
        setError(cause instanceof Error ? cause.message : '無法讀取題庫狀態。')
      }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision])
  return { groups, loading, error, retry: () => setRevision(value => value + 1) }
}
