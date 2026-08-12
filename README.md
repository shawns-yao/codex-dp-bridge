# codex-dp

`codex-dp` 是 Codex 与独立 Pi Agent 之间的本地协作桥接工具。Codex 负责需求分析、方案裁决和最终验收；Pi Agent 负责独立反方审查和经授权的代码实现。

当前版本提供 Windows 11、Linux 和 macOS 适配，通过 npm 安装 CLI 和 MCP 服务，不访问数据库，不自动提交、暂存或推送代码。

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
- npm 包已内置兼容的 Pi Agent 运行时；也可以显式指定已有 Pi 安装
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

正式发布后使用 npm 全局安装：

```shell
npm install --global codex-dp
```

安装完成后确认命令可用：

```shell
codex-dp --help
```

`codex-dp` 默认使用 npm 包依赖中的 Pi Agent `0.84.1`，不要求用户单独安装 Pi，也不依赖固定目录。已经安装其他 Pi 时，可以使用环境变量 `CODEX_DP_PI` 指定命令名、CLI 文件、Pi npm 包目录或 Pi 项目根目录；指定版本必须满足 `>=0.84.1 <0.85.0`。

Codex CLI 需要可以从 PATH 中找到，并支持 MCP 管理命令：

```shell
codex --version
```

认证信息仍由 Pi Agent 管理。首次使用前，需要通过 Pi Agent 支持的登录流程完成 OpenCode Go 认证。`codex-dp` 不直接接收或保存 OpenCode Go API Key。

从源码参与开发时才需要克隆仓库并构建：

```shell
git clone https://github.com/shawns-yao/codex-dp-bridge.git
cd codex-dp-bridge
npm ci
npm run build
```

## 首次配置和健康检查

预览并注册 Codex MCP 服务：

```shell
codex-dp setup preview
codex-dp setup apply
```

全局命令入口由 npm 管理。`setup apply` 只注册名为 `codex-dp` 的 Codex MCP 服务，不修改 Windows 用户 PATH，不修改 shell 配置，也不创建额外启动脚本。

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
- `setup preview`：只展示平台和 MCP 注册信息，不修改系统。
- `setup apply`：注册 `codex-dp` MCP 服务。
- `setup remove`：移除 `codex-dp` MCP 服务；卸载程序需另行执行 `npm uninstall --global codex-dp`。

`setup apply` 前应确认预览结果中的 Node.js 与 MCP 文件路径属于当前 npm 安装，并确认不存在同名 MCP 服务。

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
| `CODEX_DP_PI` | 指定已有 Pi 命令、CLI 文件、npm 包目录或项目根目录；未设置时使用包内 Pi |
| `CODEX_DP_CODEX_COMMAND` | 指定 Codex CLI 命令名或绝对路径 |
| `CODEX_HOME` | 指定 Codex 配置目录 |

`defaultThinkingLevel` 控制 Pi Agent 的默认思考强度，初始值为 `max`。启动任务后，`codex-dp` 会读取当前模型实际支持的思考等级；如果配置等级不受支持，任务会停止并返回可用等级，不会静默降级。MCP 审查工具也可以通过 `requestedThinkingLevel` 为单次任务覆盖默认值，后续分歧审查、实施和修订会沿用该任务的思考强度。

### 安装和卸载

```shell
codex-dp setup preview
codex-dp setup apply
codex-dp setup remove
```

`setup apply` 会备份已有的 Codex 配置，并在失败时尝试恢复配置。它不会修改 PATH 或 Codex 原生多 Agent 编排配置，只会注册或移除名为 `codex-dp` 的 MCP 服务。

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
LICENSE               MIT 许可证
```

用户配置、配置备份、运行日志和任务临时目录位于前述平台用户目录，不再依赖源码所在的本地绝对路径。包含密钥、令牌或个人配置的文件不应加入版本控制。

## 故障排查

### 找不到 Pi Agent

执行：

```shell
codex-dp status
```

默认包内 Pi 不依赖 PATH。设置了 `CODEX_DP_PI` 或用户配置中的 `piCommand` 后，可以在 Windows 使用 `where.exe pi`，在 Linux 和 macOS 使用 `which pi` 检查命令位置；也可以直接指定 Pi CLI、npm 包目录或项目根目录。

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

仓库还提供隔离的 Docker Linux 验证矩阵。Debian 和 Alpine 的本机架构验证可以分别执行：

```shell
npm run test:docker:debian
npm run test:docker:alpine
```

使用 Docker Buildx 和 QEMU 验证 ARM64 Debian：

```shell
docker buildx build --platform linux/arm64 \
  --build-arg NODE_IMAGE=node:22.19-bookworm \
  -f Dockerfile.test \
  -t codex-dp-test:debian-arm64 \
  --load .
docker run --platform linux/arm64 --rm --init codex-dp-test:debian-arm64
```

镜像构建阶段会依次执行依赖安装、类型检查、构建、测试和 npm 打包预览；容器启动阶段会执行 `setup preview`。Docker 只能模拟 Linux 用户空间和 CPU 架构，不能替代 Windows 或 macOS 原生验证；三平台原生验证由 GitHub Actions 矩阵负责。

## 已知限制

- npm 全局安装目录必须位于当前用户 PATH；该配置由 npm 和用户的 Node.js 版本管理工具负责。
- 默认使用包内 Pi Agent；外部 Pi 仅在用户显式指定时使用，并且必须满足兼容版本范围。
- `codex-dp` 不直接录入或保存 OpenCode Go API Key。
- Git 忽略文件默认不会复制到隔离工作区。
- 失败任务只保留脱敏摘要和隔离结果，不恢复或续传 Pi 会话。
- 授权字段依赖 Codex 转述，服务端无法独立验证用户授权来源。
- 不自动提交、暂存或推送代码。
- 项目级自定义 Prompt 尚未实现。
- npm 首次发布仍需要仓库所有者在 npm 配置 Trusted Publishing；日志轮转和会话恢复尚未实现。

## 当前后续计划

已实现的功能和仍在计划中的功能统一记录在 `TODO.md`。项目使用 MIT 许可证；npm 发布由 GitHub Release 和 Trusted Publishing 工作流触发。
