export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<Array<{ item: T; ok: true; value: R } | { item: T; ok: false; error: unknown }>> {
  const queue = [...items];
  const output: Array<{ item: T; ok: true; value: R } | { item: T; ok: false; error: unknown }> = [];

  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      try {
        const value = await worker(item);
        output.push({ item, ok: true, value });
      } catch (error) {
        output.push({ item, ok: false, error });
      }
    }
  });

  await Promise.all(runners);
  return output;
}
