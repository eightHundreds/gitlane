# Gitlane

本地 Git 提交图：在浏览器里看彩色泳道、提交详情和文件 diff，不依赖 VS Code。

绑定一个仓库、起一个 HTTP 服务即可。写入操作走 CSRF 保护的 `POST /api/action`。

![Gitlane 使用演示：浏览提交图、展开详情、左右 diff、右键分支](https://raw.githubusercontent.com/eightHundreds/gitlane/main/docs/demo.gif)

## 安装

```bash
npm install -g gitlane
gitlane /path/to/repo
```

或不安装，直接跑：

```bash
npx gitlane /path/to/repo
```

默认打开 `http://127.0.0.1:3840/`。常用参数：

```
gitlane <repo-path> [--port 3840] [--host 127.0.0.1] [--no-open]
```

## 开发

```bash
git clone https://github.com/eightHundreds/gitlane.git
cd gitlane
npm install
npm run build
node dist/cli.js /path/to/repo
```

```bash
npm test
```

## 界面

- 彩色泳道图 + 提交表（hash / 作者 / 日期 / 说明，带本地分支、远程分支、标签）
- 工作区有改动时显示 Uncommitted Changes 节点
- 单击提交：在该行下方展开详情与变更文件
- Ctrl/Cmd+单击第二个提交：比较
- 单击文件：从底部滑出 Monaco 左右 diff，可全屏
- 变更文件支持 Tree / List，偏好会记在本机
- 右键提交 / 分支 / 远程 / 标签 / Stash / Uncommitted：checkout、branch、merge、rebase、reset、stash、push/fetch/pull 等
- 工具栏：分支过滤、Remotes/Stashes、Fetch、Find、Load More、亮/暗主题（跟随系统，可手动切换）
- 键盘：Ctrl/Cmd+F 查找，Ctrl/Cmd+R 刷新，Ctrl/Cmd+H 滚到 HEAD，方向键换详情，Esc 关闭

## 发版

`package.json` 的 `version` 必须和 git tag 一致，例如 `1.1.0` 对应 `v1.1.0`。推送 tag 后，GitHub Actions 会跑测试、发布 npm，并创建 GitHub Release。

```bash
npm version patch   # 或 minor / major
git push origin main --follow-tags
```

仓库需要配置 secret `NPM_TOKEN`：在 [npm Access Tokens](https://www.npmjs.com/settings/~/tokens) 生成 **Automation** 类型（不要用 Publish，那种会要求 OTP，GitHub Actions 过不了）。

## 许可

MIT。见 [LICENSE](LICENSE)。
