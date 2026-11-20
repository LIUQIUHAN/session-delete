# 删除会话

`@dsh2030/session-delete` 在 Web 侧边栏的会话菜单中加入**删除会话**操作，并附带实现它的 Host 路由。会话持久化刻意不提供删除 API（JSONL 后端文档写明“不会删除会话文件”），因此这个插件完整承担了该操作。

## 使用

1. 右键某个会话行，或打开该行的**更多**（…）菜单。
2. 选择**删除会话**。
3. 在确认对话框中确认。

任何会话都可以删除，包括当前窗口正打开的那个、以及正在运行的会话。对话框会说明后果：运行中的会话会先被停止（当前轮次、后台任务、子代理），删除当前打开的会话后视图会切换到一个新会话。

## 打开或运行中的会话会怎样

Host 会先拆除会话，再动文件，因此日志已关闭、最后一批事件也已落盘：

1. **归档准入**按用户自己的**停止并归档**方式停止该会话——正在运行的轮次、后台任务、正在运行的子代理、定时提醒——并在删除文件期间阻止它再次被唤醒。
2. Agent 自身的有序拆除流程（GUI 会话由 Session Controller 拥有）排空循环、关闭持久化写句柄，之后才离开注册表；请求会等待这次拆除完成。
3. 清除本次请求写入的归档标记。
4. 删除各代日志文件，再删除已空的会话目录。

尚未发送的排队消息会随会话一起丢弃，与“删除”语义一致。上述任一步失败时不会删除任何文件、归档标记会被清除，对话框会说明原因。

## 删除了什么

- 会话目录内所有规范命名的日志代（`session.jsonl`、`session.v1.jsonl.zstd` 等）；
- 仅当目录里没有其他文件时才删除目录本身（残留文件会让目录保留，这是有意的安全行为）。

随后刷新会话列表；全文搜索索引会在下一次搜索时自动和解已删除的来源。

## 不会删除什么

- **附件**按内容寻址，可能被其他会话共享，因此保留在附件存储中。
- DSH home 下的**投影缓存检查点**会保留；缓存只服务持久化后端仍列出的会话。清理它们属于持久化文档所说的带外维护。
- **子会话日志**位于各自目录，不会随父会话删除；直接删除子会话会被拒绝（`session/subagent`），因为它的工作属于驱动它的父会话。

## 限制

- **卡住的会话无法删除。** 若运行的轮次在约 20 秒内没有停止，或日志仍未关闭，对话框会报告（`session/stop-failed`、`session/detach-failed`）；请重启 DSH 后再删除。
- **不会跨 DSH 进程协调。** 拆除只在当前进程进行，另一个正在写入同一会话的 DSH 实例不可见。删除前请关闭可能打开该会话的其他实例。
- **从未写入磁盘的会话**返回 `session/unmaterialized`，没有可删除的文件。
- **无批量删除。** 菜单一次只操作一个会话；Host 路由单次最多接受 100 个 id，供未来调用方使用。
- **仅限桌面端与 Web。** 该操作位于 Web 侧边栏；不提供 agent 工具，因为这是破坏性操作，刻意只由用户发起。

## Host API

`POST /api/session.delete`（需认证的精确路由，仅 owner Peer 可访问），请求体 `{ "sessionIds": ["…"] }`，响应：

```json
{ "ok": true, "deleted": ["…"], "stopped": ["…"], "failed": [{ "id": "…", "code": "session/stop-failed", "message": "…" }] }
```

`stopped` 列出被本进程加载、并在删除前拆除的 id。失败码：`session/subagent`、`session/stop-failed`、`session/detach-failed`、`session/not-found`、`session/unmaterialized`、`session/unsafe-path`、`session/delete-failed`。

## 组合方式

bundle 补丁插入一个 Host 行 `session-delete`，依赖 `connection`、`sessions`、`agents`、`sessionPersistence`，并在 Web bundle 组合了 `workspaceRegistry` 时使用它。浏览器端由 `dsh.client` 发现，注册到 `shell.overlay`、`contextMenu.icon` 和共享的会话上下文菜单。
