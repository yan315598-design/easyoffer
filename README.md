# 易offer / easyoffer

<img src="job-autofill-assistant/icons/icon512.png" alt="易offer / easyoffer Logo" width="148">

**网申填写助手 · Job application autofill assistant**

适用于支持原生扩展侧栏的 Chrome 和 Edge，识别并填充校招 / 社招网申表单。资料保存在本机浏览器，可以创建或复制多套简历。AI 解析与助填可选。

纯原生 JS，没有构建步骤，也没有 npm 依赖。

## 界面

扩展内部工作区默认打开「我的简历」。顶部可切换产品功能、我的简历、求职工作台、帮助中心和设置。

![易offer 产品功能页与填写演示](pictures/easyoffer-demo.png)

## 能做什么

- **一键填入**：按中英文标签识别姓名、联系方式、政治面貌、教育 / 实习 / 项目等常见字段，兼容 React 等框架的受控输入
- **增量填入**会保留已有内容，默认补现有行。需要继续添加简历中的剩余条目时，可勾选「增量填入时也补建条目」。
- **AI 助填**：先快速填入标准字段，再调用大模型逐题解答主观开放题
- **选区填入**：一键填不上的整块空白，手动框选一段区域把一条经历批量填入（交互见下）
- **浏览器侧栏**。点工具栏的易offer图标，在网页旁边切换简历、发起填入、查看待核对字段。侧栏宽度由浏览器控制。
- **资料速查**按简历条目分组。点选网页字段后可直接填入单项，也可预览并确认同一行的多项资料。停用模块、浏览器内置页及其他扩展页面可复制后粘贴。
- **多条填写**先匹配网页已有行，再补空行，最后逐条新增并核对控件结果。遇到行身份不明确或需要网站确认时，剩余条目会列为待处理。
- 填写时可在侧栏暂停、继续或取消。OfferLink 的日期、下拉和地区控件按页面选项填写并回读，资料缺值与控件未确认会分别显示。
- 多益网络校招表单支持性别单选、常见下拉、地区级联和已有家庭关系行。出生地、户口地、现住地及童年城市各自使用对应简历字段。家庭关系按网页已有的姓名或关系匹配。
- 新建简历时可创建空白资料，或选择一份已有简历复制。副本的经历和附件可独立编辑。
- 简历工作台支持多条目卡片、详细字段和上下排序。技能按名称、类别、熟练程度和补充说明分条保存，旧技能标签会转为独立记录。
- 「外语能力」按语种或考试保存为独立卡片，可快捷新增四级、六级、雅思和托福。旧成绩和小语种备注自动合入卡片。同一考试有多条不同成绩时，可指定一条用于只有一个成绩框的网申。
- 家庭现居地址使用一个字段录入，旧简历的省、市、区县和详细地址会合并显示。
- OfferLink 新增经历后会展开收起的卡片再填写。简历日期用月历选择，可以选具体日期或仅保存年月。需要完整日期的网页控件会提示补充具体日，可从「日期待完善」定位回简历。
- 「模块管理」随简历保存启用状态。关闭模块后仍可备份原始资料，自动填写和新增经历会跳过该模块。
- 求职工作台默认显示投递表格，可以切换看板和仪表盘。「面试中」可细分待一面、待二面和待终面。侧栏顶部和填入结果都提供「记录此岗位」。岗位草稿默认为「已收藏」，核对后由用户保存。工作台可预览导入 CSV，历史待核实记录独立标记。
- **秋招字段**：政治面貌、民族、籍贯、生源地、入党 / 入团时间、婚姻状况、家庭成员、院校层次、结构化证书、论文、专利、开源成果、常用问答、个人声明
- **可选 AI**：上传 PDF / Word / 图片解析进资料卡，生成 HR 打招呼语
- **附件**：简历源文件存在本机 IndexedDB，可作网申代传附件
- **备份**可下载完整 JSON，或选择简历和其他资料导出。恢复前会预览同 ID 冲突，已有简历默认跳过。选择独立本地目录并授权后，保存资料会自动留下快照。下载默认排除 API Key，自动快照始终排除 API Key。

## 选区填入与快捷键

在侧栏点击「选区填入」，然后回到网页操作。

| 操作 | 效果 |
| --- | --- |
| 按住**左键拖框** | 圈选一段区域，把选中的一条经历批量填入框内字段 |
| **右键** | 取消当前拖出的框 |
| **Esc** | 退出选区模式 |
| 按住 **Ctrl / Command** 拖框 | 一次拖出多个框，多段内容同时填入 |

框选后，右侧会显示“选择填写内容”面板。选择分类和具体经历，再点「立即填入」；已有值默认跳过。点击「完成框选」可结束 Ctrl / Command 多区域选择，重复区域中的字段会去重。

## 安装

1. 打开浏览器的扩展管理页，Chrome 使用 `chrome://extensions/`，Edge 使用 `edge://extensions/`
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」
4. 如果下载的是压缩包，先解压。选择其中的 `job-autofill-assistant/` 目录（含 `manifest.json` 的那一层）

更新后在扩展管理页重新加载扩展，再刷新招聘网页。

## 使用

1. 点扩展图标 →「配置资料与简历」，手工填写或用 AI 解析简历
2. 打开企业校招 / 北森 / 莫招 / 大易 / Moka 等网申页
3. 在侧栏点「一键填入」。开放题可以用「AI 助填」，整块空白可以用「选区填入」，单个字段可以用「资料速查」
4. 核对并在招聘网站提交。想跟进这个岗位时，点「记录此岗位」，确认阶段后保存到工作台

AI 助填和 AI 简历解析可在「设置」中配置。支持 DeepSeek、通义千问、智谱 GLM、Kimi、豆包、硅基流动、OpenAI 和 Gemini。

## 权限与隐私

扩展使用网站访问权限识别各招聘网站的表单，并在你发起填写时写入字段。简历、附件和投递记录保存在本机浏览器。启用 AI 后，解析或助填所需的资料会发送至你配置的模型接口。JSON 备份默认排除 API Key。

## 开发

```
job-autofill-assistant/            # 仓库根（git 根，test/ 在这里）
├── test/run.mjs                   # 静态检查 + 单元测试
└── job-autofill-assistant/        # 扩展本体（Chrome 加载这一层）
    ├── manifest.json
    ├── popup/                     # 浏览器原生侧栏
    ├── options/                   # 五页工作区、简历编辑器与投递工作台
    ├── styles/brand.css           # 易offer 界面样式变量
    └── scripts/
        ├── background.js          # 消息中枢，简历主数据唯一存储入口
        ├── content.js             # 兼容引导（实际模块在 content/）
        ├── content/               # 识别、适配器、填充引擎、选区、Shadow DOM Dock
        ├── storage.js             # 资料结构、迁移与备份
        └── resume-parser.js       # AI 解析
```

```bash
# 仓库根目录：静态检查 + 单元测试
node test/run.mjs

# 真实 Chrome：慢下拉、级联、增量、单/多选区、界面加载与截图
python test/browser_regression.py

# OfferLink 控件和经历卡片，以及任务暂停、继续与取消
python test/offerlink_regression.py
python test/fill_pause_regression.py

# 合成简历提取、字段识别和填写耗时
python test/engine_benchmark.py

# 加载真实扩展，验证侧栏点选、岗位确认、表格和抽屉，可传入截图目录
python test/sidebar_tracker_regression.py

# 页面、简历、日期、投递存储和 CSV
python test/app_shell_regression.py
python test/options_workspace_regression.py
python test/date_controls_regression.py
node --test test/module_config_test.mjs test/tracker-regression.mjs test/tracker-storage-regression.mjs
```

简历主数据一律经 `background.js` 读写；页面脚本只直接保存 Dock 位置、折叠状态等轻量 UI 偏好。

侧栏和扩展工作区共用 `job-autofill-assistant/styles/brand.css`。页内选区选择面板使用 Shadow DOM 隔离招聘网站样式。

README 截图使用合成简历和岗位示例。浏览器测试可通过 `CHROME_PATH` 指定本机 Chrome/Edge 路径。

## 第三方组件

- [PDF.js](job-autofill-assistant/vendor/pdfjs/LICENSE)
- [PDF 字符映射](job-autofill-assistant/vendor/pdfjs/cmaps/LICENSE)
- [界面字体](job-autofill-assistant/fonts/LICENSE.txt)
