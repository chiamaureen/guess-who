import { useState } from 'react'

export function useAction() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function run(action: () => Promise<string>) {
    setLoading(true)
    setError('')
    setMessage('')
    try {
      setMessage(await action())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '發生錯誤，請稍後再試。')
    } finally {
      setLoading(false)
    }
  }

  return { loading, error, message, run }
}
