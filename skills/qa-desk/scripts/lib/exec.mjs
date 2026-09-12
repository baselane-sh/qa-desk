import { execFile as execFileCb } from 'node:child_process';

/** promisify(execFile) cannot feed stdin; this one can, through opts.input. */
export function execFileWithInput(cmd, args, opts = {}) {
  const { input, ...rest } = opts;
  return new Promise((resolve, reject) => {
    const child = execFileCb(cmd, args, { ...rest, shell: false }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
    if (child.stdin) {
      // A child that exits without reading stdin makes the pipe emit an
      // unhandled 'error' (EPIPE), which otherwise crashes the whole
      // process. The callback above already reports the real failure.
      child.stdin.on('error', () => {});
      if (input !== undefined) child.stdin.end(input); else child.stdin.end();
    }
  });
}
