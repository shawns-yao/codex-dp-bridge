import test from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/process.js";

test("PowerShell UTF-16 Base64 往返保持中文路径", async (context) => {
  if (process.platform !== "win32") { context.skip("仅验证 Windows 用户级 PATH 编码"); return; }
  const expected = "C:\\Users\\测试用户\\AppData\\Roaming\\npm;C:\\Tools\\Pi Agent";
  const encoded = Buffer.from(expected, "utf16le").toString("base64");
  const script = `$v=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'));[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($v))`;
  const result = await run("powershell.exe", ["-NoProfile", "-Command", script]);
  assert.equal(result.code, 0);
  assert.equal(Buffer.from(result.stdout, "base64").toString("utf16le"), expected);
});
