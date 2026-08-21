# Git Graph（独立 Web 版）

从 [mhutchie/vscode-git-graph](https://github.com/mhutchie/vscode-git-graph) 移植的**本地独立应用**：不依赖 VS Code。进程绑定一个 git 仓库、启动 HTTP 服务，浏览器里画彩色泳道提交图，并用 **Monaco** 看文件 diff。

上游 LICENSE 允许使用/复制/修改，**禁止发布、分发衍生作品**。本仓库仅供本地使用。

## 运行

```bash
npm install
node src/cli.js /path/to/repo
# 或
npm start -- /path/to/repo --port 3840
```

服务会打印 URL（默认 `http://127.0.0.1:3840/`），并尝试打开系统浏览器。加 `--no-open` 可只启动服务。

## 界面

- 彩色泳道图 + 提交表（hash / 作者 / 日期 / 说明，带本地分支、远程分支、标签）
- 工作区有改动时显示 Uncommitted Changes 节点
- 单击提交：详情与变更文件列表
- Ctrl/Cmd+单击第二个提交：比较
- 单击文件：页内 Monaco diff（新增/删除一侧为空；未提交一侧为工作区内容）
- 右键提交：Add Tag / Create Branch / Checkout / Cherry Pick / Revert / Drop / Merge / Rebase / Reset / Copy
- 右键分支 pill：Checkout / Rename / Delete / Merge / Rebase / Push / Copy
- 右键远程分支、标签、Uncommitted、Stash 的对应动作
- 工具栏：分支过滤、Remotes/Stashes 开关、Fetch、Find、Load More
- 键盘：Ctrl/Cmd+F 查找，Ctrl/Cmd+R 刷新，Ctrl/Cmd+H 滚到 HEAD，方向键换详情，Esc 关闭

## 测试

```bash
npm test
```
