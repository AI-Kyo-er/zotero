# Zotero 10 手写改进与跨平台接手说明

## 当前开发分支与 MacBook 拉取（2026-10-29）

完整定制版保存在两个仓库的同名分支 `experimental/pressure-ink-zotero-10`：

| 仓库 | 功能版本提交 | 职责 |
| --- | --- | --- |
| `AI-Kyo-er/zotero` | `0a705b1` | Zotero 宿主偏好桥接、跨文件设置同步、10.0.6 适配，以及 Windows 构建、安装与诊断工具 |
| `AI-Kyo-er/reader` | `bd3f2fe` | 输入采样、短笔画、压感和平滑开关、笔刷状态、注释图形复用，以及 PDF.js 兼容更新 |

主仓库在上述功能提交之后补充了本段交接说明，并将 `pdf-reader` 子模块（磁盘路径 `reader/`）指向个人 fork。主仓库记录的 Reader 提交仍是 `bd3f2fe89c9a045b6aea54b2d7594c3e273dae2a`。递归更新子模块会取得这个固定版本。

在 MacBook 新拉取一份源码：

```bash
git clone --branch experimental/pressure-ink-zotero-10 --recurse-submodules https://github.com/AI-Kyo-er/zotero.git zotero-10-pen
cd zotero-10-pen
git rev-parse --short HEAD
git -C reader rev-parse HEAD
```

已有主仓库且工作区干净时，可以更新同名分支，再同步子模块地址：

```bash
git fetch origin
git switch experimental/pressure-ink-zotero-10
git pull --ff-only
git submodule sync --recursive
git submodule update --init --recursive
```

上述已有仓库的命令以 `origin` 指向 `AI-Kyo-er/zotero` 为前提。子模块按固定提交检出时通常处于 detached HEAD；准备修改 Reader 时，在其中创建适配分支：

```bash
git -C reader switch -c adapt/macos-pen-input
```

关键改动分布：

- `chrome/content/zotero/xpcom/reader.js`：将颜色、粗细、压感和平滑状态连接到 Zotero 偏好，并通知已打开的阅读器。
- `defaults/preferences/zotero.js`、`chrome/locale/*/zotero/reader.ftl`：默认偏好与开关文案。粗细在无有效配置时使用上游默认值；个人安装中保存的是 1.0，之后记忆用户最后选择的值。
- `reader/src/common/reader.js`、`reader/src/common/context-menu.js`：工具状态与压感、平滑菜单。
- `reader/src/pdf/ink-input.mjs`、`reader/src/pdf/pressure-ink.mjs`、`reader/src/pdf/pdf-view.js`：采样收集、抬笔端点、压感分组与笔画处理。
- `reader/src/pdf/page.js`：复用未变化的注释图形，减少书写时的整页重建。
- `reader/pdfjs/viewer.css`：书写区域与外围滚动区域的触摸行为。

最新 Windows 定制版基于 Zotero 10.0.6，曾通过 59 项运行检查、11 项重启检查及 29 项 Reader 单元测试；这些结果来自 Windows，macOS 尚待适配与设备验证。优先验证 macOS 上 `PointerEvent.pressure`、合并采样、指针捕获、快速笔画、页面外滚动，以及跨文件／重启后的四项设置保留。

`scripts/pen/*.ps1` 和个人安装脚本包含 Windows 程序、配置和数据目录；MacBook 上应以源码及对应 macOS 构建流程继续适配。仓库不包含 `pen-build/` 中的 Windows 测试程序、个人 `pen-profile/`／`pen-data/`、本地日志或资料库备份。

功能版本的主要提交：

- Zotero `de1a88c`：四项笔刷设置的全局记忆；`24b11a7`：图形复用与记录器验证；`0a705b1`：恢复到 10.0.6 并增加应用更新提示的安装选项。
- Reader `bd74b07`：颜色和粗细的宿主同步；`64a38f1`：注释图形复用；`fe98a08`：页面书写区域声明；`bd3f2fe`：官方 PDF.js OpenJPEG 兼容更新。

下面保留的是此前 Windows 调试、安装与上游贡献的历史记录，其中旧目录和旧构建号对应当时的环境。

## Windows 调试历史

适用反馈：Windows、Wacom CTL-472、快速书写时无墨迹、笔迹滞后、无法关闭平滑，以及下一笔起点重复。

## 已确认的起点重复原因

用户确认多个软件都存在起点重复，关闭 Wacom 全局“笔尖双击距离 / Double-tap distance”的双击辅助后恢复正常。关闭前的实机日志包含 1521 个真实事件和 52 次手写落笔，10 次落笔坐标精确重复上一笔起点，而落笔前的新位置悬停已经到达。配置读取确认双击辅助原先开启；关闭后 `DoubleClickOnOff=false`、`DoubleClickDistance=0`，Windows Ink 保持开启。

因此清理版本 v3 撤销了针对重复起点添加的时间戳隔离、缺失抬笔时新接触恢复，以及鼠标手写绕过兼容 mousedown 的处理。直接笔输入对照选项也已移除。测试启动器会恢复之前对照测试修改过的测试配置中的默认拖笔滚动设置。安装到本机的程序不改变 Windows、驱动或 Gecko 的输入偏好。

Wacom [高级笔设置说明](https://101.wacom.com/UserHelp/en/AdvancedPenEraser_Con_Full.htm)说明双击距离可能影响笔画起始响应。原始实机日志仅保存在本地 `work/wacom-real-v2-baseline.json`，未上传 GitHub。日志分析工具仍保留用于后续诊断。

## 保留的改进

输入处理收集浏览器提供的合并采样及抬笔端点，按动画帧合并绘制。短笔画经过平滑仍保留尾点，点按保存为可绘制线段。取消或捕获丢失时保留已收集的坐标，排队的悬停事件不会污染当前笔画。

手写工具颜色／粗细菜单增加“平滑手写笔迹”和“笔压感应（实验性）”。平滑默认开启，实验性压感默认关闭；选择会保存，并更新已打开的阅读器。原生鼠标兼容事件处理保持原来的流程。

压感实验读取 `PointerEvent.pressure`，将笔画分成原生固定粗细 Ink 注释，继续使用 `pageIndex/width/paths` 格式，实际产生 7 个粗细等级，细端为工具最大粗细的 1/4。一笔可能对应多个侧栏注释，选择、缩放和删除以各组为单位。它仍是实验性功能，云同步及所有插件的运行兼容性尚未全面验证。平滑开关只控制 Zotero 完成笔画时的处理。

## 本机安装和备份

2026-10-04 已备份实际文献目录 `C:\Users\world\Zotero`、配置与插件目录 `C:\Users\world\AppData\Roaming\Zotero\Zotero` 和整个原安装目录 `D:\Zotero`。

备份曾保存在 `work/backups/20261004-212007`，按用户要求现已移入回收站。创建时1350 个文件通过 SHA-256 校验，数据库完整性检查为 `ok`。数据库包含 387 个项目、99 个附件、84 条笔记、127 条注释和 7 个分类，没有需要另行备份的外部链接附件。逐文件清单随备份一起移入回收站。

本机安装只替换 `D:\Zotero\app\omni.ja`。其余 1349 个源文件在替换后再次通过与备份的 SHA-256 比较，包括完整文献库、附件、配置和插件。安装记录在 `work/local-installation.json`。独立测试包没有被用作用户的实际文献库或配置目录。

同版本官方 Gecko 二进制仍用于本地覆盖构建。官方更新可能覆盖此资源修改；本机版本号仍为 10.0.5。恢复程序资源不需要恢复或回滚文献库。

## 独立试写及自动验证

独立试写仍可用；与正式安装的文献库、配置分开：

```powershell
& 'D:\Desktop\Working-Doc\Projects\zotero-10-pen\scripts\pen\start-test.ps1'
```

当前独立包为 `pen-build/Zotero_win-x64-v4`。试写数据在 `pen-data`、配置在 `pen-profile`，不迁入实际文献库。

2026-10-05 的后续实机对照确认 Direct 可消除漏笔，但关闭了页面外的笔滚动。用户随后确认 NativeFine 对照“不再丢笔，页面外也能滚动”。本机配置改为保留 `dom.w3c_pointer_events.scroll_by_pen.enabled=true`、仅将 `apz.touch_move_tolerance` 设为字符串 `"0.0"`；滚动启动阈值未改动。相关配置单独备份，支持撤销。

v4 为本地个人配置提供可选 `inkSize` 初始粗细，宿主从 `reader.inkSize` 读取。用户默认值为 `"1.0"`，无有效配置时仍使用原有 2.0；已有笔迹宽度不被重写。这项本地宽度支持未加入此前的上游候选分支。

重新构建和验证：

```powershell
Set-Location 'D:\Desktop\Working-Doc\Projects\zotero-10-pen\reader'
npm.cmd test
npx.cmd webpack --config-name zotero
Set-Location ..
& scripts/pen/build-portable.ps1 -BuildName Zotero_win-x64-v4
& scripts/pen/test-runtime.ps1 -PenInputPath NativeFine -InkSize 1.0
& scripts/pen/test-runtime.ps1 -InstalledExecutable 'D:\Zotero\zotero.exe' -PenInputPath NativeFine -InkSize 1.0
```

核心分支 23 项单元测试、实验分支 29 项单元测试通过；清理后的独立包和已安装程序各通过 23 项桌面检查，15 个测试 Ink 注释均保存、重新打开并导出为标准 PDF Ink 对象。webpack 构建通过，有 2 条资源体积警告。新增模块、测试及诊断脚本 lint 通过。合成事件检查不能替代真实设备的端到端体验验证。

v4 独立包及实际安装各通过 26 项桌面检查，新增验证原生滚动保持开启、内容移动过滤阈值为零、滚动启动阈值仍为 0.1，以及新阅读器默认粗细 1.0。只替换程序归档，安装前后 1260 个个人文献库／配置文件哈希一致；只读数据库查询刷新了临时 `zotero.sqlite-shm` 索引，实际主库、WAL、附件、插件及其他配置未变化。当前程序归档和配置均另行备份；回退入口及详细安装记录在本次任务的 outputs 中。

诊断启动可加 `-RecordInput`。每次运行的日志在 Windows 临时目录的 `zotero-pen-recordings/<独立会话 ID>/pen-input-events.json`，启动成功时打印完整路径。同目录的 `session.json` 标明测试库和项目。使用独立文件避免覆盖旧记录，也避免项目同步软件占用共用日志；写入采用临时文件替换，并对 `NS_ERROR_FILE_IS_LOCKED` 最多重试五次。旧的 `work/pen-input-events.json` 保留。

记录事件坐标、时间、压力、指针、笔画状态及脚本错误；按 F8 可标记刚看到的漏笔。不记录 PDF 正文或文献标题。普通启动关闭调试监听。记录会增加开销，不能用来测量平常书写延迟。

在项目目录执行 `node scripts/pen/analyze-strokes.mjs` 会分析该项目最新的手动试写日志，自动验证日志不参与这个选择。也可以提供具体日志路径作为第一个参数，第二个参数是分析结果的输出文件。加 `-PenInputPath Direct` 仅在独立测试配置中关闭 Gecko 的笔拖动滚页，用于输入路径对照，未改变原版 Zotero 配置。

## 上游提交准备

`fix/pen-input-zotero-10` 保存核心输入修复和平滑开关；`experimental/pressure-ink-zotero-10` 增加默认关闭的压感、本地构建和诊断工具。主仓库及 reader 子仓库分别保存对应分支。

拟提交 `zotero/reader` 的核心修改不含实验性压感或本地工具。`zotero/zotero` 的配套修改增加偏好桥接和中英文本地化。在 reader 修改被上游接收后，主仓库提交应指向获接受的上游 reader 提交。不能将个人 fork 的子模块指针作为最终上游依赖。

已准备精简补丁和英文 PR 描述。驱动双击辅助引起的起点重复不会被描述为此 PR 修复的 Zotero 缺陷。已提交上游 reader #263、#264 和 Zotero #6065、#6066。核心阅读器 PR 为普通 PR，其余为草稿，等待依赖及设计审阅。
