# codex-dp

`codex-dp` 是 Codex 与独立 Pi Agent 之间的本地协作桥接工具。Codex 负责需求分析、方案裁决和最终验收；Pi Agent 负责独立反方审查和经授权的代码实现。

当前版本提供 Windows 11、Linux 和 macOS 适配，使用 Node.js 启动本地 CLI 和 MCP 服务，不访问数据库，不自动提交、暂存或推送代码。

## 核心能力

- 通过 MCP 管理架构审查、分歧审查、实施、修订和任务清理。
- 支持审核补丁模式：Pi Agent 只生成补丁，由 Codex 审查后再决定是否应用。
- 支持隔离工作区直接修改模式：Pi Agent 只能在 Git 隔离工作区内工作。
- 限制 Pi Agent 的工具调用次数、执行时间和可访问路径。
- 拦截 Shell 调用、越界路径、敏感文件和通过符号链接形成的越界访问。
- 记录脱敏后的失败摘要和事件日志，便于诊断。
- 提供 Pi Agent 发现、版本兼容性检查、模型检查和真实联调命令。

## 适用环境

- Windows 11、Linux 或 macOS
- Node.js `>=22.19.0`
- Git
- 已安装并可以在 PATH 中找到 Codex CLI
- 已安装并可以在 PATH 中找到 Pi Agent 命令
- 已通过 Pi Agent 原生登录流程完成 OpenCode Go 认证
- 项目目录位于本地 Git 工作区

## 架构流程

```text
Codex
  │
  │ MCP
  ▼
codex-dp
  ├─ CLI 管理命令
  ├─ MCP 服务
  ├─ TaskManager 任务生命周期管理
  ├─ Pi RPC 客户端
  ├─ 补丁生成模式
  ├─ Git 隔离工作区模式
  ├─ pi-guard 权限守卫
  └─ 配置、日志、备份和临时任务目录
       │
       ▼
Pi Agent / OpenCode Go / DeepSeek
```

一次协作任务的流程如下：

1. Codex 根据用户需求形成初步方案。
2. 用户明确授权后，`codex-dp` 启动独立审查。
3. Pi Agent 对方案进行一轮反方审查。
4. 如果存在明确技术分歧，用户可以授权第二轮审查；分歧仍未解决时交由用户裁决。
5. Codex 展示审查摘要、冻结方案和允许修改的路径。
6. 用户明确授权实施。
7. Pi Agent 生成补丁，或者在隔离工作区中完成修改。
8. Codex 审查结果，并决定是否整合补丁。
9. 任务结束时清理 RPC 进程；失败任务保留脱敏摘要和隔离结果。

## 安装

在项目目录中执行：

```shell
npm install
npm run build
```

`npm install` 会执行构建准备脚本，显式执行 `npm run build` 可以再次确认构建产物完整。仓库提供以下源码启动入口：

- Windows PowerShell：`.\codex-dp.ps1 <命令>`
- Windows 命令提示符：`codex-dp.cmd <命令>`
- Linux 和 macOS：`./codex-dp <命令>`
- 通用入口：`node dist/src/cli.js <命令>`

通过不保留 Unix 执行权限的压缩包获取源码时，需要先执行：

```shell
chmod +x ./codex-dp
```

安装 Pi Agent 和 Codex CLI 后，先确认两个命令都可以从 PATH 中找到：

```shell
pi --version
codex --version
```

然后通过 Pi Agent 自身的登录流程完成 OpenCode Go 认证。`codex-dp` 不直接接收或保存 OpenCode Go API Key。

## 首次配置和健康检查

在项目目录中先预览和应用安装配置：

```shell
node dist/src/cli.js setup preview
node dist/src/cli.js setup apply
```

Windows 会把源码目录加入用户级 PATH。Linux 和 macOS 会在 `~/.local/bin` 安装用户级启动入口，但不会修改 shell 配置文件；如果预览结果包含 `pathInstruction`，需要把其中的 PATH 配置加入所用 shell 的配置文件，然后重新打开终端。

安装完成后依次执行：

```shell
codex-dp status
codex-dp doctor
codex-dp models
codex-dp config set-model <模型标识>
codex-dp config set-thinking max
codex-dp live-test
```

各命令的用途：

- `status`：检查 Node.js、Pi Agent、供应商和默认模型配置。
- `doctor`：检查 Pi RPC 是否可启动，并列出当前供应商下已认证的模型。
- `models`：列出当前供应商可用的模型。
- `config set-model <模型标识>`：设置默认模型。
- `config set-thinking <思考强度>`：设置默认思考强度，可选 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，默认使用 `max`。
- `live-test`：使用真实模型完成一次固定口令联调，会消耗模型额度。
- `setup preview`：只展示平台、PATH 项、CLI 入口和 MCP 注册信息，不修改系统。
- `setup apply`：Windows 维护用户级 PATH；Linux 和 macOS 安装用户级启动入口；三个平台都会注册 `codex-dp` MCP 服务。
- `setup remove`：移除本项目管理的 PATH 项或启动入口，并移除 `codex-dp` MCP 服务。

`setup apply` 前应确认预览结果中没有不希望修改的路径或同名 MCP 服务。

## 常用命令

### 状态和模型

```shell
codex-dp status
codex-dp doctor
codex-dp models
codex-dp live-test
```

### 配置

```shell
codex-dp config show
codex-dp config set-model <模型标识>
codex-dp config set-thinking <思考强度>
```

默认配置模板位于源码目录的 `Config/default.json`。用户配置会覆盖默认配置中的同名字段，具体位置如下：

| 平台 | 用户配置 | 日志和任务状态 |
| --- | --- | --- |
| Windows | `%APPDATA%\codex-dp\config.json` | `%LOCALAPPDATA%\codex-dp\` |
| macOS | `~/Library/Application Support/codex-dp/config.json` | `~/Library/Application Support/codex-dp/` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/codex-dp/config.json` | `${XDG_STATE_HOME:-~/.local/state}/codex-dp/` |

旧版源码目录中的 `Config/config.json` 仍可以读取；下一次更新配置时会写入新的用户配置目录。配置写入前会在用户配置目录的 `backups/` 中保留备份。

可使用以下环境变量覆盖默认位置或命令：

| 环境变量 | 用途 |
| --- | --- |
| `CODEX_DP_HOME` | 使用一个绝对路径统一存放 `Config/`、`Log/` 和 `Temp/` |
| `CODEX_DP_BIN_DIR` | 指定 Linux 或 macOS 用户启动入口目录，必须是绝对路径 |
| `CODEX_DP_CODEX_COMMAND` | 指定 Codex CLI 命令名或绝对路径 |
| `CODEX_HOME` | 指定 Codex 配置目录 |

`defaultThinkingLevel` 控制 Pi Agent 的默认思考强度，初始值为 `max`。启动任务后，`codex-dp` 会读取当前模型实际支持的思考等级；如果配置等级不受支持，任务会停止并返回可用等级，不会静默降级。MCP 审查工具也可以通过 `requestedThinkingLevel` 为单次任务覆盖默认值，后续分歧审查、实施和修订会沿用该任务的思考强度。

### 安装和卸载

```shell
codex-dp setup preview
codex-dp setup apply
codex-dp setup remove
```

`setup apply` 会备份已有的 Codex 配置，并在失败时尝试恢复 PATH、Unix 启动入口和 Codex 配置。它不会修改 Codex 原生多 Agent 编排配置，但会注册或移除名为 `codex-dp` 的 MCP 服务。

### 任务诊断

```shell
codex-dp temp list
codex-dp temp inspect <任务标识>
codex-dp temp clean <任务标识>
```

- `temp list`：列出临时任务目录。
- `temp inspect`：查看失败摘要、任务模式、允许路径数量以及隔离工作区状态。
- `temp clean`：清理指定任务的临时文件和隔离工作区结果。

## 两种实施模式

### 审核补丁模式

这是默认模式。Pi Agent 返回带有固定标记的补丁，`codex-dp` 会校验补丁路径和二进制授权范围，随后由 Codex 进行审查和整合。

适合需要严格控制变更范围、希望在应用前查看完整补丁的任务。

### 隔离工作区直接修改模式

Pi Agent 在 Git 隔离工作区中直接修改文件。`codex-dp` 会记录基线，并只收集允许路径内的后续差异。

该模式不会直接把 Pi Agent 放入用户当前工作区。Git 忽略文件默认不会复制到隔离工作区，以避免带入密钥、依赖目录和缓存。

## 安全边界

- 不访问数据库，也不执行数据库命令。
- Pi Agent 不允许执行 Shell 工具。
- 所有文件访问都必须位于当前任务根目录内。
- 通过符号链接访问任务根目录之外的路径会被拒绝。
- 敏感路径由 `sensitivePatterns` 配置控制。
- 补丁只能修改用户批准的路径。
- 二进制文件变更必须单独获得授权。
- 实施和修订都有工具调用预算和超时限制。
- 默认向 Pi RPC 传递 `max` 思考强度，也允许通过配置或单次任务参数自定义；不支持的等级会明确报错。
- 总超时只累计模型和工具实际执行时间，不计算用户阅读、裁决和授权等待时间。
- 任务失败时会终止 Pi RPC 进程及其 Windows、Linux 或 macOS 子进程树。
- 日志和失败摘要会省略提示词、补丁、响应、密钥、令牌等字段，并对部分路径进行脱敏。
- 不自动提交、不自动暂存、不自动推送。
- MCP 中的授权字段依赖 Codex 根据用户对话进行转述，服务端无法独立证明授权来源。

安全边界不能替代人工审查。用户仍应在实施前确认冻结方案、允许路径和补丁内容。

## 目录说明

```text
Config/default.json   默认配置模板
src/                  TypeScript 源代码
Test/                 自动化测试
dist/                 构建输出，不提交到 Git
```

用户配置、配置备份、运行日志和任务临时目录位于前述平台用户目录，不再依赖源码所在的本地绝对路径。包含密钥、令牌或个人配置的文件不应加入版本控制。

## 故障排查

### 找不到 Pi Agent

执行：

```shell
pi --version
codex-dp status
```

Windows 可以使用 `where.exe pi`，Linux 和 macOS 可以使用 `which pi` 检查命令位置。如果没有结果，请先将 Pi Agent 安装目录加入 PATH，再重新打开终端。

### Pi 版本不兼容

执行：

```shell
codex-dp status
codex-dp doctor
```

`codex-dp` 会校验 Pi Agent 版本是否符合 `compatiblePiRange`。如果版本不兼容，应升级 Pi Agent，或在确认兼容性后调整配置。

### 没有可用模型

执行：

```shell
codex-dp doctor
codex-dp models
```

确认已经通过 Pi Agent 原生登录流程完成 OpenCode Go 认证，并且配置的供应商与模型一致。

### `live-test` 失败

依次检查：

1. `codex-dp status` 是否能发现 Pi Agent。
2. `codex-dp doctor` 是否返回已认证模型。
3. `codex-dp config show` 是否存在默认模型。
4. 默认模型是否仍然可以使用。
5. Pi Agent 是否因为认证、网络或额度问题拒绝请求。

### MCP 注册失败

先执行：

```shell
codex-dp setup preview
codex-dp setup apply
```

Windows 可以使用 `where.exe codex-dp`，Linux 和 macOS 可以使用 `which codex-dp` 检查启动入口。如果提示存在同名命令或同名 MCP 服务，请先确认该命令或服务是否属于本项目。不要直接覆盖未知来源的配置。

### 任务失败后如何查看结果

执行：

```shell
codex-dp temp list
codex-dp temp inspect <任务标识>
```

日志和失败摘要位于平台用户状态目录。失败任务默认保留诊断信息，确认不再需要后再执行 `temp clean`。

### 配置文件损坏

如果 `config.json` 格式损坏，先保留现有文件，再从用户配置目录的 `backups/` 选择最近一次有效备份恢复。恢复后重新执行：

```shell
codex-dp config show
codex-dp doctor
```

## 构建与验证

类型检查：

```shell
npm run check
```

构建：

```shell
npm run build
```

测试脚本依赖构建输出。运行完整测试前应先执行构建：

```shell
npm test
```

## 已知限制

- Linux 和 macOS 会安装用户级启动入口，但不会自动改写 bash、zsh 或 Fish 配置文件。
- Pi Agent 必须独立安装，并通过自身登录流程完成认证。
- `codex-dp` 不直接录入或保存 OpenCode Go API Key。
- Git 忽略文件默认不会复制到隔离工作区。
- 失败任务只保留脱敏摘要和隔离结果，不恢复或续传 Pi 会话。
- 授权字段依赖 Codex 转述，服务端无法独立验证用户授权来源。
- 不自动提交、暂存或推送代码。
- 项目级自定义 Prompt 尚未实现。
- 正式开源许可证、npm 发布流程、日志轮转和会话恢复尚未实现。

## 当前后续计划

已实现的功能和仍在计划中的功能统一记录在 `TODO.md`。尚未确定开源许可证，正式发布前必须先完成许可证选择和仓库元数据配置。
