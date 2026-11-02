// 예전 오늘 몫 덱 주소(#/deck · 알림 링크 #/deck?first=…)는 세션(#/session)으로 넘긴다(기획 v11 2단계).
import { useEffect } from 'react'
import { navigate, useRoute } from '../router.ts'

export default function Deck() {
  const q = useRoute().query.toString()
  useEffect(() => {
    navigate('/session' + (q ? '?' + q : ''), true)
  }, [q])
  return <main className="page" />
}
