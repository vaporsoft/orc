import { execFile, type ExecFileOptions } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a command and capture its output. Rejects on non-zero exit
 * unless `allowFailure` is set.
 */
export function exec(
  command: string,
  args: string[],
  options: ExecFileOptions & { allowFailure?: boolean } = {},
): Promise<ExecResult> {
  const { allowFailure, ...execOpts } = options;
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { maxBuffer: 10 * 1024 * 1024, ...execOpts },
      (error, stdout, stderr) => {
        const exitCode = error?.code
          ? typeof error.code === "number"
            ? error.code
            : 1
          : 0;
        const result: ExecResult = {
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          exitCode,
        };
        if (error && !allowFailure) {
          reject(
            Object.assign(
              new Error(
                `Command failed: ${command} ${args.join(" ")}\n${result.stderr}`,
              ),
              { result },
            ),
          );
        } else {
          resolve(result);
        }
      },
    );

    // Kill the process if it takes too long
    const timeout = execOpts.timeout;
    if (timeout) {
      setTimeout(() => {
        child.kill("SIGTERM");
      }, timeout);
    }
  });
}
