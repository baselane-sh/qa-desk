import { execFile as execFileCb } from 'node:child_process';

/** promisify(execFile) cannot feed stdin; this one can, through opts.input. */
export function execFileWithInput(cmd, args, opts = {}) {
  const { input, ...rest } = opts;
  return new Promise((resolve, reject) => {
    const child = execFileCb(cmd, args, { ...rest, shell: false }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
    if (child.stdin) { if (input !== undefined) child.stdin.end(input); else child.stdin.end(); }
  });
}
