/**
 * Run an async function over an array with a concurrency limit.
 * Like Promise.all(items.map(fn)) but at most `concurrency` items in flight.
 * If any worker throws, remaining workers stop processing new items.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let cancelled = false;

  async function worker(): Promise<void> {
    while (!cancelled && nextIndex < items.length) {
      const i = nextIndex++;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        cancelled = true;
        throw err;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
