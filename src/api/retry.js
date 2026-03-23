export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function withRetry(fn, maxRetries = 3, label = 'API 호출') {
  let lastError
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const msg = err.message || ''
      const status = err.status || err.code || 0

      // 일일 한도 초과 - 즉시 throw
      if (
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.toLowerCase().includes('daily limit') ||
        msg.toLowerCase().includes('quota exceeded') ||
        msg.includes('유료 요금제') ||
        (status === 429 && msg.toLowerCase().includes('daily'))
      ) {
        throw new Error(`[일일 한도 초과] ${label}: ${msg}`)
      }

      const isRetryable =
        status === 429 ||
        status === 503 ||
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.toLowerCase().includes('rate limit') ||
        msg.toLowerCase().includes('overloaded') ||
        msg.toLowerCase().includes('unavailable')

      if (!isRetryable || attempt === maxRetries) {
        throw err
      }

      // 503 Deadline expired: 짧은 딜레이로 즉시 재시도
      // 429 Rate limit: 지수 백오프
      const is503 = status === 503 || msg.includes('503') || msg.toLowerCase().includes('deadline')
      const delay = is503
        ? 1000 + Math.random() * 500
        : Math.pow(2, attempt) * 1000 + Math.random() * 500
      console.warn(`[${label}] 재시도 ${attempt + 1}/${maxRetries} - ${delay.toFixed(0)}ms 후...`, msg)
      await sleep(delay)
    }
  }
  throw lastError
}
