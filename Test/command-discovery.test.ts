import test from "node:test";
import assert from "node:assert/strict";
import { buildWindowsCommandLine, parseCommandPaths, quoteWindowsCommandArg } from "../src/command-discovery.js";

test("命令发现可以解析不同平台的多行 PATH 输出", () => {
  assert.deepEqual(parseCommandPaths(" /usr/local/bin/pi\r\n\n/home/example/bin/pi\n"), ["/usr/local/bin/pi", "/home/example/bin/pi"]);
});

test("Windows 命令参数包含空格时会被引用", () => {
  assert.equal(quoteWindowsCommandArg("C:\\Program Files\\codex-dp\\codex.cmd"), '"C:\\Program Files\\codex-dp\\codex.cmd"');
  assert.equal(quoteWindowsCommandArg("mcp"), '"mcp"');
});

test("Windows 命令行转义命令解释器元字符", () => {
  const commandLine = buildWindowsCommandLine("C:\\Tools\\codex.cmd", ["mcp", "add", "name&whoami", "%PATH%"]);
  assert.equal(commandLine, '"C:\\Tools\\codex.cmd" "mcp" "add" "name^&whoami" "%%PATH%%"');
  assert.throws(() => buildWindowsCommandLine("codex.cmd", ["line\nbreak"]), /非法控制字符/);
});
