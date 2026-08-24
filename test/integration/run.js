const { runTests } = require("@vscode/test-electron");

runTests({
  extensionDevelopmentPath: __dirname + "/../..",
  extensionTestsPath: __dirname + "/suite",
}).catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
