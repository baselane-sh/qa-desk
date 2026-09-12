import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileWithInput } from '../scripts/lib/exec.mjs';

test('execFileWithInput survives an EPIPE from a child that exits without reading a large stdin', async () => {
  // Larger than the OS pipe buffer (tens of kilobytes), so the child can exit
  // before the write finishes and the stdin socket emits 'error'. Without a
  // listener that error is unhandled and kills the whole process before the
  // callback below ever runs, instead of surfacing as a rejection here.
  const big = 'x'.repeat(5_000_000);
  await assert.rejects(
    execFileWithInput('sh', ['-c', 'exit 1'], { input: big }),
    (err) => err.code === 1,
  );
});
