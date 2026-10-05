# Zotero 10.0.5 数位板改进与本地验证

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
