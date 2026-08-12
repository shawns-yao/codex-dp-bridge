import test from "node:test";
import assert from "node:assert/strict";
import { parseCommandPaths, quoteWindowsCommandArg } from "../src/command-discovery.js";

test("命令发现可以解析不同平台的多行 PATH 输出", () => {
  assert.deepEqual(parseCommandPaths(" /usr/local/bin/pi\r\n\n/home/example/bin/pi\n"), ["/usr/local/bin/pi", "/home/example/bin/pi"]);
});

test("Windows 命令参数包含空格时会被引用", () => {
  assert.equal(quoteWindowsCommandArg("C:\\Program Files\\codex-dp\\codex.cmd"), '"C:\\Program Files\\codex-dp\\codex.cmd"');
  assert.equal(quoteWindowsCommandArg("mcp"), "mcp");
});
