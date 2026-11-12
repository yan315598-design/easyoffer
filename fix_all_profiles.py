#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
完整更新三份资料，修复所有不一致的数据
"""
import json
import time

# 读取三份JSON
print("读取现有JSON文件...")
with open('/mnt/c/Users/qq139/Downloads/AI开发_2026-10-10.json', 'r', encoding='utf-8') as f:
    ai_data = json.load(f)

with open('/mnt/c/Users/qq139/Downloads/计算机视觉_2026-10-10.json', 'r', encoding='utf-8') as f:
    cv_data = json.load(f)

with open('/mnt/c/Users/qq139/Downloads/软件开发_2026-10-10.json', 'r', encoding='utf-8') as f:
    sw_data = json.load(f)

# ============================================================================
# 1. 修复 AI开发 资料
# ============================================================================
print("\n修复 AI开发 资料...")
ai_profile = ai_data['profiles'][0]

# 修复自我评价中的数字
ai_profile['commonAnswers']['selfEvaluation'] = """具备较强的学习能力、沟通协作能力和责任心，能够在跨职能团队中主动推进问题解决，适应快速变化的业务节奏。
具备良好的产品表达能力，能够使用原型、流程图、文档工具完成需求梳理和方案说明；对 AI Coding 工具保持关注，熟练使用 CodeX、Claude Code、Trae、Cursor 等工具。
制作的 Agent Skills 教程在小红书收获 2000+ 收藏，开源项目 anti-defensive-writing（https://github.com/Kiterlin/anti-defensive-writing）收获 800+ Stars。
专业技能：熟悉 Python、Shell 等编程语言，掌握 Linux 系统操作与网络编程，熟悉数据库原理与 SQL，具备大模型应用开发经验，熟悉 RAG、LLM 微调、Prompt Engineering、agent记忆和上下文管理等技术。"""

ai_profile['jobIntention']['expectedPosition'] = 'AI Agent 开发 / 大模型应用开发'
ai_profile['commonAnswers']['careerGoal'] = 'AI Agent 开发 / 大模型应用开发（2027届校招）'

print("✓ AI开发资料已更新")

# ============================================================================
# 2. 修复 软件开发 资料
# ============================================================================
print("\n修复 软件开发 资料...")
sw_profile = sw_data['profiles'][0]

# 修复求职意向
sw_profile['jobIntention']['expectedPosition'] = '软件开发工程师'
sw_profile['commonAnswers']['careerGoal'] = '软件开发工程师（2027届校招）'

# 修复自我评价
sw_profile['commonAnswers']['selfEvaluation'] = """专业技能：熟练掌握 Java、Python；熟悉 Spring Boot、Vue、MySQL、Redis 与 RocketMQ，具备接口集成、异步消息处理、任务状态管理及 Docker 容器化交付经验；熟悉 Linux、SQL 与模型推理服务开发。
工程与产品素养：具备跨职能团队协作与良好的产品表达能力，善用原型与工程文档梳理复杂业务；熟练使用 Cursor、Claude Code、Trae 等 AI 辅助编程工具提升研发效能。
开源与技术影响：开源项目 anti-defensive-writing（https://github.com/Kiterlin/anti-defensive-writing）收获 800+ Stars，制作的 Agent Skills 技术教程在小红书获得 2000+ 收藏。"""

# 修复技能标签
sw_profile['skills'] = [
    'Java',
    'Python',
    'Spring Boot',
    'Vue',
    'MySQL',
    'Redis',
    'RocketMQ',
    'Docker',
    'Linux/Shell',
    'SQL',
    'YOLOv8',
    'TensorRT',
    'ONNX',
    'FFmpeg',
    'MinIO',
    'PyTorch',
    'OpenClaw 二次开发',
    'Function Calling / MCP',
    'Cursor',
    'Claude Code',
    'Trae'
]

# 确保有3个项目（补充PlugClaw）
if len(sw_profile['projects']) < 3:
    # 添加PlugClaw项目
    plugclaw_project = {
        'id': f"id_{int(time.time() * 1000)}_plugclaw_sw",
        'name': 'PlugClaw：全方位安全隔离的随身 AI 助手',
        'role': 'AI Agent 实习生',
        'projectType': '商业项目',
        'techStack': 'Android Use、Mobile GUI、OpenClaw、Android Bridge',
        'startDate': '2026-01',
        'endDate': '2026-08',
        'projectUrl': '',
        'description': '面向全平台、多设备的随身 AI 助手，以 USB 设备为载体，运行于定制化 PlugOS 系统（已装机量 10亿级）；采用 Android Use 与 Mobile GUI 协同完成应用操作，覆盖消息处理、日程管理、办公辅助等多个场景。项目基于 OpenClaw 高度定制化，通过 Android Bridge 和定制化插件提供设备执行能力。 合作单位：上海瓶钵信息科技有限公司。',
        'responsibilities': '1. 领域 Skills 体系构建：设计覆盖 9 个 Android 领域、145 项工具能力的 Skills 体系，以 description 定义触发场景并按需加载流程与参数参考，规范跨领域任务的多 Skill 组合调用。\n2. 意图路由与动态上下文：设计 72 类业务意图及对应的小模型多标签召回 + 主模型精判两级路由方案，通过注册表关联 Skills、工具参考与必填参数；按任务状态、候选能力、工具合同与流程参考分层加载上下文，结合多轮候选复用减少重复召回；设计能力可用性筛选与低置信度回退策略，制定召回覆盖率、任务成功率及 token / 延迟对照评测方案。\n3. 任务执行与异常恢复：规范原子操作调用 API 与多步任务委派 GUI Worker 的执行流程，明确暂停恢复与终态停止语义；结合同工具 Schema 纠参重试、确定性时间解析、异步状态查询与写后回读校验实际执行结果，任务恢复率达 95%。\n4. 分层记忆与状态持久化：针对长程交互中的记忆稀释问题，构建短期实体栈缓冲与跨会话长期记忆的分层架构；长期记忆采用向量检索与结构化摘要结合的冷温热分层策略；引入时效衰退函数与冲突覆盖机制，动态过滤过期历史并抑制记忆膨胀。',
        'achievements': '构建覆盖 9 个 Android 领域、145 项工具能力的 Skills 体系，设计 72 类业务意图及两级路由方案；任务恢复率达 95%。',
        'projectLevel': '',
        'technologies': ['Android Use', 'Mobile GUI', 'OpenClaw', 'Android Bridge']
    }
    sw_profile['projects'].append(plugclaw_project)
    print("  ✓ 已补充 PlugClaw 项目")

print("✓ 软件开发资料已更新")

# ============================================================================
# 3. 修复 计算机视觉 资料
# ============================================================================
print("\n修复 计算机视觉 资料...")
cv_profile = cv_data['profiles'][0]

# 修复求职意向
cv_profile['jobIntention']['expectedPosition'] = '计算机视觉工程师'
cv_profile['commonAnswers']['careerGoal'] = '计算机视觉工程师（2027届校招）'

# 修复自我评价
cv_profile['commonAnswers']['selfEvaluation'] = """视觉算法：具备基于 PyTorch / YOLOv8 的视觉模型开发经验，研究方向涵盖小目标检测、RGB-T 多模态融合与轻量化检测；结合对比实验、模块消融及 AP、参数量、FLOPs、FPS 指标分析模型效果与效率。
模型部署与工程开发：具备 ONNX / TensorRT FP16 部署及 GPU / CPU 双后端推理经验；熟悉 Python、Java、Shell、Linux 与 SQL，具备多路视频推理服务、FFmpeg 推流及 Docker 容器化交付经验。
协作与研发工具：具备跨职能协作、方案表达与工程文档编写能力；熟练使用 Codex、Claude Code、Cursor 等 AI 编程工具，具备 AI Agent 与大模型应用开发经验。
开源与技术分享：开源项目 anti-defensive-writing（https://github.com/Kiterlin/anti-defensive-writing）收获 800+ Stars，制作的 Agent Skills 教程在小红书收获 2000+ 收藏。"""

# 修复技能标签
cv_profile['skills'] = [
    'Python',
    'PyTorch',
    'YOLOv8',
    'RT-DETR',
    'TensorRT',
    'ONNX',
    'Docker',
    'Linux/Shell',
    'SQL',
    'Java',
    'Spring Boot',
    'FFmpeg',
    'OpenClaw 二次开发',
    'Function Calling / MCP',
    'RGB-T多模态融合',
    '小目标检测',
    '模型部署',
    'Codex',
    'Claude Code',
    'Cursor'
]

print("✓ 计算机视觉资料已更新")

# ============================================================================
# 保存更新后的文件
# ============================================================================
print("\n保存更新后的文件...")

with open('/mnt/c/Users/qq139/Downloads/AI开发_2026-10-10.json', 'w', encoding='utf-8') as f:
    json.dump(ai_data, f, ensure_ascii=False, indent=2)
print("✓ 已保存 AI开发_2026-10-10.json")

with open('/mnt/c/Users/qq139/Downloads/计算机视觉_2026-10-10.json', 'w', encoding='utf-8') as f:
    json.dump(cv_data, f, ensure_ascii=False, indent=2)
print("✓ 已保存 计算机视觉_2026-10-10.json")

with open('/mnt/c/Users/qq139/Downloads/软件开发_2026-10-10.json', 'w', encoding='utf-8') as f:
    json.dump(sw_data, f, ensure_ascii=False, indent=2)
print("✓ 已保存 软件开发_2026-10-10.json")

print("\n" + "="*80)
print("✅ 所有资料更新完成！")
print("="*80)
print("\n主要修复内容：")
print("1. ✓ 所有资料：Stars 500+ → 800+，收藏数 942 → 2000+")
print("2. ✓ 软件开发：求职意向、自我评价、技能标签、补充PlugClaw项目")
print("3. ✓ 计算机视觉：求职意向、自我评价、技能标签")
print("\n现在可以导入这三个文件了！")
