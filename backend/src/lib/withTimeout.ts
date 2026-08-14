// 여러 라우트(챗봇 메시지 처리, 로그인 시 CJ 세션 예열 등)가 "이 프로미스가 너무
// 오래 걸리면 명확한 타임아웃 오류로 끊는다"는 같은 패턴을 쓰기 때문에 공용으로 뺐다.

export class TimeoutError extends Error {}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(message ?? `처리 시간이 ${Math.round(timeoutMs / 1000)}초를 초과했습니다.`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
