import { execFile } from "child_process";

interface ExecResult {
  stdout: string;
  exitCode: number;
}

/** Run a command and return stdout + exit code. Never throws on non-zero exit. */
export function exec(
  command: string,
  args: string[],
  options?: { cwd?: string }
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd: options?.cwd }, (error, stdout, _stderr) => {
      resolve({
        stdout: stdout ?? "",
        exitCode: error?.code === "ENOENT" ? 127 : (error as any)?.code ?? 0,
      });
    });
  });
}

/** Run a command, throw if it exits non-zero. Returns stdout trimmed. */
export async function execOrThrow(
  command: string,
  args: string[],
  options?: { cwd?: string; errorMessage?: string }
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd: options?.cwd, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const msg = options?.errorMessage ?? `${command} ${args[0]} failed`;
          reject(new Error(`${msg}: ${stderr || error.message}`));
          return;
        }
        resolve((stdout ?? "").trim());
      }
    );
  });
}
