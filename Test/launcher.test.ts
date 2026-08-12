import test from "node:test";
import assert from "node:assert/strict";
import { renderUnixLauncher } from "../src/launcher.js";

test("Unix 启动入口使用当前 Node 和构建后的 CLI", () => {
  const launcher = renderUnixLauncher("/opt/Node Runtime/bin/node", "/opt/codex dp/dist/src/cli.js");
  assert.match(launcher, /# codex-dp managed launcher/);
  assert.match(launcher, /exec '\/opt\/Node Runtime\/bin\/node'/);
  assert.match(launcher, /'\/opt\/codex dp\/dist\/src\/cli\.js'/);
  assert.match(launcher, /"\$@"/);
});

test("Unix 启动入口可以安全引用单引号路径", () => {
  const launcher = renderUnixLauncher("/tmp/it's/node", "/tmp/codex/cli.js");
  assert.ok(launcher.includes("'/tmp/it'\"'\"'s/node'"));
});
