import { execFileSync } from "node:child_process";

const pattern = "(sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{10,}\\.)";
try {
  const matches = execFileSync(
    "git",
    ["grep", "-n", "-I", "-E", pattern, "--", ".", ":!package-lock.json"],
    {
      encoding: "utf8",
    },
  );
  process.stderr.write(`Potential secret found:\n${matches}`);
  process.exitCode = 1;
} catch (error) {
  if (error.status !== 1) throw error;
}
