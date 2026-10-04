# Zotero 10.0.5 数位板试写包

适用反馈：Windows、Wacom CTL-472、快速书写时没有墨迹。

本项目有两个分支：`fix/pen-input-zotero-10` 包含输入修复及平滑开关；`experimental/pressure-ink-zotero-10` 在其基础上增加默认关闭的实验性压感和本目录的本地验证工具。主仓库及 reader 子仓库各自保存分支。基线是 Zotero `10.0.5` 和其锁定的 reader `9d821fa`。

## 直接试写

在 PowerShell 中执行：

```powershell
& 'D:\Desktop\Working-Doc\Projects\zotero-10-pen\scripts\pen\start-test.ps1'
```

脚本使用 `pen-build` 中所选的独立程序，配置保存在 `pen-profile`，文献数据保存在 `pen-data`。第一次运行将关闭手写平滑和压感，之后菜单选择会保留。这个测试库最初是空的，需要导入一个 PDF 再打开。可以用项目自带的 `test/tests/data/test.pdf`，也可以用一份自己的测试文件。导入测试文件不会改写原来的 Zotero 文献库。

当前启动器会读取 `pen-build/current-build.txt`，选择已构建的 v2 包 `pen-build/Zotero_win-x64-v2`。先关闭上一版的试写窗口，再运行同一个启动脚本。测试文献及配置仍使用原来的 `pen-data` 和 `pen-profile`。原来的第一版程序目录仍保留。

点击阅读器的手写工具，再打开颜色/粗细弹出菜单：

- **平滑手写笔迹**：勾选或关闭落笔完成后的路径平滑。
- **笔压感应（实验性）**：启用压力控制粗细；默认关闭。

先关闭压感，连续快速写小字、点、短横、折线 60 秒，观察有没有落笔后无墨迹、笔尾消失或无法继续写的问题。然后开启压感，用逐渐加力的一笔观察粗细变化。最后关闭 PDF 再打开，并导出含注释的 PDF，检查笔迹。

请记录两项信息：关闭压感时快速书写是否仍丢笔；开启压感后粗细是否随力度变化。如果还丢笔，再记录是在快速抬笔、靠近页面边缘、还是滚动页面之后发生，以及驱动版本。这些是继续定位 CTL-472 实际输入链路需要的证据。

## 修改范围及限制

输入修复收集浏览器提供的合并采样点，并补收抬笔坐标。绘制按动画帧合并，但不通过节流丢弃采样点；短笔画保留末点，点按也保存为可绘制线段。输入被取消或捕获丢失时保存已收集的坐标。其他指针和排队中的悬停事件不会结束或污染当前笔画。

v2 处理旧事件进入下一笔的边界情况：鼠标模式下的手写也从 PointerEvent 开始，兼容 mousedown 不再创建手写笔画；每一笔记录开始时间，拒收旧接触的迟到事件及合并采样；同一指针的新接触会结束未收到抬笔的上一笔，再使用新坐标开始下一笔。合并到同一个侧栏注释的多个笔画仍保留各自的起点。

### 起点仍重复时的诊断

关闭试写窗口后，执行下面的命令，再打开 PDF 快速写几笔复现问题：

```powershell
& 'D:\Desktop\Working-Doc\Projects\zotero-10-pen\scripts\pen\start-test.ps1' -RecordInput
```

日志每秒写入 `D:\Desktop\Working-Doc\Projects\zotero-10-pen\work\pen-input-events.json`。它记录浏览器接收到的事件坐标、时间、指针类型、压力、兼容鼠标事件，以及事件处理后的笔画起点；不记录 PDF 正文或文献标题。每个阅读器最多保留最近 6000 个事件，仅诊断启动时启用。普通启动会关闭调试监听。记录期间可能有额外开销，不能用它测量平常书写延迟。再次开启记录会覆盖上次日志。

如果传入 PointerEvent 的起点已经错误，应用无法可靠推断真实起点，不能通过随意移动第一点来“修复”。Wacom 官方说明双击距离可导致笔画开始处延迟，并建议减小该距离或通过笔按钮双击。可对照测试驱动中的“笔尖双击距离 / Tip Double Click Distance”，如果有该选项，将它暂时设为关闭，比较快速写字时起点是否仍重复。这个因素尚未在此 CTL-472 上确认。

官方依据：https://101.wacom.com/UserHelp/en/AdvancedPenEraser_Con_Full.htm

### 实机日志发现及直接笔输入对照

随后用户确认起点重复也出现在其他软件。只读检查发现 One by Wacom 全局配置的 `DoubleClickOnOff=true`、`DoubleClickTime=500`，双击距离保存值为 `2.000000`（未将驱动内部值解释为屏幕像素）；`WinUseInk=true`。优先对照 Wacom 属性中的“笔尖双击距离”设为“关闭 / Off”，保持 Windows Ink 不变，跨两个软件比较结果。Wacom 与 UGEE 驱动进程同时运行是另一待排除因素，还没有证据确认驱动冲突。没有改写驱动配置或停止驱动进程。

2026-10-04 的 CTL-472 记录包含 1521 个真实事件、52 次手写落笔。其中 10 次符合重复起点特征：上一笔已经抬起，新位置的悬停事件已经到达，但随后的原生 `pointerdown` 又报告上一笔的起点。两笔间隔 108–157 毫秒，悬停事件领先新落笔 0–31 毫秒。应用按收到的坐标创建笔画，因此 v2 的旧事件隔离还不能解决这个原生坐标异常。这些记录不能单独区分 Windows、驱动及 Gecko 的责任。

已加入可撤回的对照选项；关闭独立试写窗口后运行：

```powershell
& 'D:\Desktop\Working-Doc\Projects\zotero-10-pen\scripts\pen\start-test.ps1' -RecordInput -DirectPenInput
```

它只在测试配置中设置 `dom.w3c_pointer_events.scroll_by_pen.enabled=false`，让笔走直接事件路径，保留笔压力及倾角信息，并关闭用笔拖动滚动页面。普通启动会将该值恢复为平台默认的 `true`。同一个 v2 程序即可使用此选项，无需重新打包。

Mozilla [缺陷 1716355](https://bugzilla.mozilla.org/show_bug.cgi?id=1716355) 记录了默认触控路径对笔移动应用容差、过滤部分初始移动事件的问题。对应 Gecko 140.15 ESR 的 `nsWindow::OnPenPointerEvents` 也保留这条分支。这个选项是定位及兼容性实验，尚未确认能解决本机重复起点；直接路径还存在 Windows 拖动阈值过滤，不能宣称已消除所有短笔画丢失。

日志现在也记录实际输入偏好、屏幕坐标及 `isPrimary`。实机日志在 `work/pen-input-events.json`，自动验证日志另存 `work/runtime-input-events.json`。用下面的命令提取重复起点特征：

```powershell
node scripts/pen/analyze-input.mjs work/pen-input-events.json
```

分析器要求两笔间已有抬笔、新悬停位置与重复起点相距至少 2 CSS 像素，并限制事件时间窗口；它报告疑似异常，不将用户有意重复落笔全部判成错误。原始记录保存在本地 `work/wacom-real-v2-baseline.json`，未提交到 GitHub。

压感实验读取 `PointerEvent.pressure`。为了继续使用 Zotero 10 原有的 `pageIndex/width/paths` 注释格式，笔画按离散粗细分成普通 Ink 注释，当前映射实际产生 7 个粗细等级，细端是工具最大粗细的 1/4。一笔可能对应侧栏中的多个注释，选择、缩放和删除也以这些分组为单位。它不是完整连续压感格式。驱动如果只向应用发送鼠标事件，压感不会启用；尚未在真实 CTL-472 输入上验证，也没有测量端到端延迟或云同步。

菜单平滑开关控制落笔后的 Zotero 路径处理；不能关闭驱动自身的滤波。这个本地测试包复用了已安装的官方 10.0.5 Gecko 二进制，并替换阅读器及相关桥接代码，属于本地覆盖构建，不是官方发布或完整桌面源码构建。

## 重新构建及运行自动验证

需要 Node.js 22 和 PowerShell 7。reader 子模块及依赖已在本地准备好。此机器的 PDF.js 资源来自同版本官方包，webpack 会保留 `reader/build/zotero/pdf`。全新克隆需要先按 reader 上游流程构建 PDF.js 资源。

```powershell
Set-Location 'D:\Desktop\Working-Doc\Projects\zotero-10-pen\reader'
npm.cmd test
npx.cmd webpack --config-name zotero
Set-Location ..
& scripts/pen/build-portable.ps1 -InstalledZotero 'D:\Zotero' -BuildName Zotero_win-x64-v2
& scripts/pen/test-runtime.ps1
& scripts/pen/test-runtime.ps1 -DirectPenInput -RecordInput
```

重建前关闭本项目的试写窗口，等待其子进程退出。自动桌面验证使用另外的 `work/runtime-profile` 和 `work/runtime-data`，开启仅本机端口 11192 的 Firefox 调试协议，发送合成 PointerEvent，完成数据库保存、重新打开、PDF 导出和标准 Ink 对象检查，最后关闭测试进程。结果在 `work/runtime-results.json`。

当前验证：核心分支 25 项、实验分支 31 项单元测试通过，27 项桌面集成检查在默认和直接笔输入配置下均通过，webpack 构建通过（2 条资源体积警告）；新增模块及测试 lint 无错误或警告，修改行无 lint 发现。被修改的旧文件整文件检查仍存在上游原有的 lint 错误。起点回归测试能在第一版中复现旧事件进入下一笔的错误，v2 中通过。日志记录工具已用合成事件验证。合成事件测试无法覆盖 Wacom 驱动及真实指针捕获行为，实际试写仍是交付前的必要验证。

## 上游提交准备

修复提交属于 `zotero/reader`；`zotero/zotero` 的相应提交增加配置桥接、本地化并更新 reader 子模块指针。官方均有 `10.0` 分支，可用于讨论回移。正式主仓库 PR 应在 reader 修改被上游接收后指向上游 reader 提交，不能直接把个人 fork 的 reader 提交当作最终子模块来源。本地试写脚本与压感实验保持在实验分支。目前没有创建官方 PR，也没有向维护者发送消息。
