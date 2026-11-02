// 폰에 든 독일어 음성으로 읽기(v11 D6 결정: 기기 내장 음성, 무료·오프라인). 음성이 없으면 false
export function speak(text: string, rate = 0.9): boolean {
  const s = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  if (!s || !text) return false
  s.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'de-DE'
  u.rate = rate
  const v = s.getVoices().find((x) => x.lang?.toLowerCase().startsWith('de'))
  if (v) u.voice = v
  s.speak(u)
  return true
}
export const stopSpeak = () => {
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
}
