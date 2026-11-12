#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
更新三份资料的项目信息
"""
import json
import sys

# 三个简历方向的项目配置
PROJECTS_CONFIG = {
    'AI开发': [
        {
            'name': 'PlugClaw：全方位安全隔离的随身 AI 助手',
            'role': 'AI Agent 实习生',
            'projectType': '商业项目',
        },
        {
            'name': '文旅导览对话机器人：面向景区游客的 AI 向导',
            'role': '对话模块开发',
            'projectType': '科研课题',
        },
        {
            'name': '电力信息安全知识问答与培训辅助系统',
            'role': '核心开发',
            'projectType': '科研课题',
        }
    ],
    '软件开发': [
        {
            'name': '视频目标检测算法中台',
            'role': '核心开发',
            'projectType': '个人软件项目',
        },
        {
            'name': '文旅导览对话机器人：面向景区游客的 AI 向导',
            'role': '对话模块开发',
            'projectType': '科研课题',
        },
        {
            'name': 'PlugClaw：全方位安全隔离的随身 AI 助手',
            'role': 'AI Agent 实习生',
            'projectType': '商业项目',
        }
    ],
    '计算机视觉': [
        {
            'name': 'LH-DETR：面向无人机图像的轻量化端到端目标检测',
            'role': '第二作者',
            'projectType': '科研课题',
        },
        {
            'name': 'MARSNet：可见光与红外融合的小目标检测',
            'role': '第二作者',
            'projectType': '科研课题',
        },
        {
            'name': 'PlugClaw：全方位安全隔离的随身 AI 助手',
            'role': 'AI Agent 实习生',
            'projectType': '商业项目',
        }
    ]
}

# 从简历tex文件提取的项目详细信息
PROJECTS_DETAILS = {
    'PlugClaw：全方位安全隔离的随身 AI 助手': {
        'techStack': 'Android Use、Mobile GUI、OpenClaw、Android Bridge',
        'startDate': '2026-01',
        'endDate': '2026-08',
        'description': '面向全平台、多设备的随身 AI 助手，以 USB 设备为载体，运行于定制化 PlugOS 系统（已装机量 10亿级）；采用 Android Use 与 Mobile GUI 协同完成应用操作，覆盖消息处理、日程管理、办公辅助等多个场景。项目基于 OpenClaw 高度定制化，通过 Android Bridge 和定制化插件提供设备执行能力。 合作单位：上海瓶钵信息科技有限公司。',
        'responsibilities': '1. 领域 Skills 体系构建：设计覆盖 9 个 Android 领域、145 项工具能力的 Skills 体系，以 description 定义触发场景并按需加载流程与参数参考，规范跨领域任务的多 Skill 组合调用。\n2. 意图路由与动态上下文：设计 72 类业务意图及对应的小模型多标签召回 + 主模型精判两级路由方案，通过注册表关联 Skills、工具参考与必填参数；按任务状态、候选能力、工具合同与流程参考分层加载上下文，结合多轮候选复用减少重复召回；设计能力可用性筛选与低置信度回退策略，制定召回覆盖率、任务成功率及 token / 延迟对照评测方案。\n3. 任务执行与异常恢复：规范原子操作调用 API 与多步任务委派 GUI Worker 的执行流程，明确暂停恢复与终态停止语义；结合同工具 Schema 纠参重试、确定性时间解析、异步状态查询与写后回读校验实际执行结果，任务恢复率达 95%。\n4. 分层记忆与状态持久化：针对长程交互中的记忆稀释问题，构建短期实体栈缓冲与跨会话长期记忆的分层架构；长期记忆采用向量检索与结构化摘要结合的冷温热分层策略；引入时效衰退函数与冲突覆盖机制，动态过滤过期历史并抑制记忆膨胀。',
        'achievements': '构建覆盖 9 个 Android 领域、145 项工具能力的 Skills 体系，设计 72 类业务意图及两级路由方案；任务恢复率达 95%。',
        'technologies': ['Android Use', 'Mobile GUI', 'OpenClaw', 'Android Bridge']
    },
    '文旅导览对话机器人：面向景区游客的 AI 向导': {
        'techStack': 'BERT-Tiny、RoBERTa-base、LLM、Function Calling、MCP、stdio、FastMCP',
        'startDate': '2025-09',
        'endDate': '2025-12',
        'description': '上海市文化和旅游局横向项目。面向景区游客咨询场景的多轮任务型对话系统（12 个领域、400+ 意图，日均 10w+ 指令）；采用「仲裁分发 → 双层意图 → MCP 工具 → NLG」流水线，通过 5 路并发预热与仲裁优先阻塞将端到端首字延迟从 4-5s 压至 约1s。',
        'responsibilities': '1. 仲裁分发与拒识：基于 LLM few-shot 仲裁将请求分流为任务、闲聊、拒识三路，多轮准确率达 89%；前置 BERT-Tiny 拒识模型（32 万条语料微调，单次 <10ms、QPS 400+），拒识率 91%，并通过多轮相关性召回避免误拦上下文承接短句。\n2. 双层意图与动态 FC：一级 RoBERTa-base（31 万条语料微调）以 Top-5 97.5% 召回率将 400+ 工具候选压至 5 个，二级 LLM 在该子集上执行动态 Function Calling 精判，意图准确率 87%、槽位准确率 91%；设计反向短路机制，仅在一级判定为 Unknown 且置信度 ≥0.98 时跳过二级 LLM，其余意图均经二级复核。\n3. MCP 工具与多轮改写：通过 MCP 协议（stdio + FastMCP）接入景点信息、路线规划等 14 个 tool，经槽位规范化层转为强类型后调用；LLM 改写处理指代消解与跨域承接，综合准确率 92%，辅以字符交集护栏防止误改。',
        'achievements': '覆盖 12 个领域、400+ 意图，日均 10w+ 指令；端到端首字延迟从 4–5s 降至约 1s；多轮仲裁准确率 89%；拒识率 91%，单次 <10ms、QPS 400+；一级 Top-5 召回率 97.5%；意图准确率 87%、槽位准确率 91%；接入 14 个 tool；多轮改写综合准确率 92%。',
        'technologies': ['BERT-Tiny', 'RoBERTa-base', 'LLM', 'Function Calling', 'MCP', 'stdio', 'FastMCP']
    },
    '电力信息安全知识问答与培训辅助系统': {
        'techStack': 'camelot-py、pdftotext、SQL、NL2SQL、BGE、ES、Rerank、RAG、GPT-4、P-Tuning v2、Qwen2.5-7B、Qwen2.5-32B、GaLore',
        'startDate': '2025-03',
        'endDate': '2025-06',
        'description': '国网上海市电力公司省级项目。面向电力培训合规场景的智能问答系统，离线将 11000+ 份 PDF（70GB）解析为结构化知识库，在线按 6 类意图分流至字段查询、NL2SQL 计算、混合检索 RAG 开放问答三条流水线；采用大小模型协同策略（7B 微调做理解，32B 做生成），总评测得分 95 分，人工工时减少约 50%；已申请发明专利 2 项、发表会议论文 1 篇。',
        'responsibilities': '1. PDF 解析与大宽表构建：采用 camelot-py 抽取表格、pdftotext 抽取文本，产出六张结构化 JSON 表，再按「单位+年份」合并为单张大宽表，将所有查询转为单表 SQL 避免多表 JOIN，使 NL2SQL 准确率较多表方案提升 30+ 百分点。\n2. 问题分类与 NL2SQL：利用 GPT-4 蒸馏 6K 条种子数据并经人工校验与说法泛化，以 P-Tuning v2 微调 Qwen2.5-7B 构建 6 类问题分类器，准确率约 90%，辅以规则兜底覆盖边界情况；NL2SQL 模块以 1000 条场景化精标数据微调，准确率达 95%+，验证了数据质量远优于 4 万条通用数据的结论。\n3. 答案生成与语料结构化：Type1/Type2 经 SQL 查询取值后由 Qwen2.5-32B 按格式模板生成答案（Type1 88 分、Type2 91 分）；Type3 开放问题引入 BGE 向量与 ES 双路召回，经 Rerank 重排后交由 32B 做 RAG 总结；同时基于 GaLore 微调的 32B 生成标准化 QA 对，转换准确率 82%。',
        'achievements': '解析 11000+ 份 PDF（70GB），构建结构化知识库；单表方案使 NL2SQL 准确率较多表方案提升 30+ 百分点；6 类问题分类准确率约 90%，NL2SQL 准确率 95%+；总评测得分 95 分（Type1 88 分、Type2 91 分）；QA 转换准确率 82%；人工工时减少约 50%；已申请发明专利 2 项、发表会议论文 1 篇。',
        'projectLevel': '省级',
        'technologies': ['camelot-py', 'pdftotext', 'SQL', 'NL2SQL', 'BGE', 'ES', 'Rerank', 'RAG', 'GPT-4', 'P-Tuning v2', 'Qwen2.5-7B', 'Qwen2.5-32B', 'GaLore']
    },
    '视频目标检测算法中台': {
        'techStack': 'Spring Boot、Vue、Python、YOLOv8、TensorRT、ONNX、RocketMQ、Redis、FFmpeg、MinIO',
        'startDate': '2025-10',
        'endDate': '2026-01',
        'description': '基于 Spring Boot + Vue + Python 开发视频检测管理平台，支持火灾烟雾、河道漂浮物等 5 类模型。用户可在网页上管理模型、创建检测任务、查看多路视频及告警图片；后端按任务加载模型，完成视频检测、结果标注与告警记录。',
        'responsibilities': '1. 检测任务管理：通过 Spring Boot 调用跨平台脚本启动 Python 检测进程，利用 RocketMQ 回传启动状态、检测结果和异常信息，更新任务状态并在异常时自动重启；使用 Redis 缓存任务和视频流状态，减少轮询查询。\n2. 模型部署与推理：将 YOLOv8 模型从 PyTorch 导出为 ONNX，并在 Tesla T4 上使用 TensorRT FP16 加速；封装 Python 推理服务，支持 GPU 上的 TensorRT 和 CPU 上的 ONNX Runtime，结合跳帧处理支持多路视频检测。\n3. 视频预览与告警：通过 FFmpeg 将原始视频和标注后的视频推送至 ZLMediaKit，前端使用 HTTP-FLV 分屏播放；按 60s 窗口聚合告警，减少重复入库，通过线程池异步上传图片至 MinIO，前端凭预签名 URL 直接读取图片。\n4. 页面开发与部署：使用 Vue + Element UI 开发模型管理、检测任务、视频预览和告警中心页面；编写 Dockerfile 配置 JDK、CUDA 11.8 和 TensorRT 环境，通过 docker-compose 统一启动服务及中间件，并配置容器访问 GPU。',
        'achievements': '支持 5 类检测模型；TensorRT FP16 加速推理；支持多路视频检测；Docker 容器化部署。',
        'technologies': ['Spring Boot', 'Vue', 'Python', 'YOLOv8', 'TensorRT', 'ONNX', 'RocketMQ', 'Redis', 'FFmpeg', 'MinIO', 'Docker']
    },
    'LH-DETR：面向无人机图像的轻量化端到端目标检测': {
        'techStack': 'RT-DETR、PyTorch、Mamba、小波变换、傅里叶变换',
        'startDate': '2025-06',
        'endDate': '2025-12',
        'description': '针对无人机图像中目标尺度小、分布密集及计算资源受限的问题，基于 RT-DETR 构建轻量化端到端检测模型，结合全局上下文建模、多尺度特征提取与频域增强，改善检测精度与计算开销的权衡。已录用于 ICRA（第二作者）。',
        'responsibilities': '1. 轻量化混合骨干：采用 Wavelet-Mamba Hybrid Block（WMHB），融合 Mamba 长程依赖建模与小波多尺度特征提取，通过全局、局部及恒等映射分支协同保留目标细节，降低骨干网络的参数量与计算开销。\n2. 频域增强与训练优化：引入 FAD-FFN，在局部 8×8 特征块上执行傅里叶变换与可学习频域滤波，结合空间分支增强小目标边缘与纹理；采用 ASVLoss，根据批次平均 IoU 调整阈值及预测质量权重。\n3. 实验评估：在 VisDrone 上，相较 RT-DETR-R18，AP 从 20.8% 提升至 22.4%，小目标 AP 从 11.3% 提升至 12.9%；参数量由 20.0M 降至 14.3M（降低 28.5%），FLOPs 由 60.0G 降至 44.9G（降低 25.2%）；RTX 3090、640×640 输入下达到 57 FPS，并在 UAVVaste、UAV-PDD 上验证效果。',
        'achievements': 'ICRA 已录用（第二作者）；AP 提升至 22.4%，小目标 AP 提升至 12.9%；参数量降低 28.5%，FLOPs 降低 25.2%；达到 57 FPS。',
        'projectLevel': '国际会议',
        'technologies': ['RT-DETR', 'PyTorch', 'Mamba', '小波变换', '傅里叶变换']
    },
    'MARSNet：可见光与红外融合的小目标检测': {
        'techStack': 'YOLOv8、PyTorch、RGB-T融合、特征金字塔',
        'startDate': '2025-01',
        'endDate': '2025-06',
        'description': '针对 RGB-T 小目标检测中的早期细节丢失、模态噪声传播与跨尺度定位失真，基于 YOLOv8 + PyTorch 构建双流检测网络，协同优化结构细节保留、模态质量感知与跨尺度特征融合。已投稿至 Information Fusion（第二作者）。',
        'responsibilities': '1. 细节增强与自适应融合：通过 DualSOE 将 P2 浅层结构细节传递至 P3 语义特征，避免新增高分辨率预测头的计算开销；AF 结合场景级与空间级质量估计、跨模态注意力及自适应温度调节，动态分配可见光与红外特征的融合权重。\n2. 特征金字塔与实验设计：采用抗混叠特征金字塔 ARFP，结合低通滤波上采样、细节保留下采样及跨尺度门控融合，改善定位一致性；开展模块组合消融、替代组件对照及计算开销分析，并在 4 个 RGB-T 数据集上评测。\n3. 实验成果：RGBTDronePerson 消融实验中，相较双流基线，mAP@50 从 43.15% 提升至 49.89%（+6.74 个百分点），mAP@50:95 从 27.55% 提升至 31.55%；RTX 3090、FP16、batch=1 下达到 35.48 FPS（含 NMS）；M³FD、LLVIP 上 mAP 分别达到 65.1%、70.4%。',
        'achievements': 'Information Fusion 在投（第二作者）；mAP@50 提升至 49.89%，mAP@50:95 提升至 31.55%；达到 35.48 FPS；多数据集验证有效性。',
        'projectLevel': 'SCI期刊',
        'technologies': ['YOLOv8', 'PyTorch', 'RGB-T融合', '特征金字塔']
    }
}

def update_profile_projects(profile_data, profile_type):
    """更新资料的项目信息"""
    if not profile_data.get('profiles') or len(profile_data['profiles']) == 0:
        print(f"错误：{profile_type} 资料为空")
        return False

    profile = profile_data['profiles'][0]
    projects_config = PROJECTS_CONFIG.get(profile_type, [])

    if not projects_config:
        print(f"警告：未找到 {profile_type} 的项目配置")
        return False

    # 更新项目列表
    updated_projects = []
    for idx, proj_cfg in enumerate(projects_config):
        proj_name = proj_cfg['name']
        proj_details = PROJECTS_DETAILS.get(proj_name, {})

        if not proj_details:
            print(f"警告：未找到项目 '{proj_name}' 的详细信息")
            continue

        # 生成新的项目ID
        import time
        proj_id = f"id_{int(time.time() * 1000)}_{idx}_{profile_type[:2]}"

        project = {
            'id': proj_id,
            'name': proj_name,
            'role': proj_cfg['role'],
            'projectType': proj_cfg['projectType'],
            'techStack': proj_details.get('techStack', ''),
            'startDate': proj_details.get('startDate', ''),
            'endDate': proj_details.get('endDate', ''),
            'projectUrl': '',
            'description': proj_details.get('description', ''),
            'responsibilities': proj_details.get('responsibilities', ''),
            'achievements': proj_details.get('achievements', ''),
            'projectLevel': proj_details.get('projectLevel', ''),
            'technologies': proj_details.get('technologies', [])
        }
        updated_projects.append(project)

    profile['projects'] = updated_projects
    print(f"✓ 已更新 {profile_type} 的 {len(updated_projects)} 个项目")
    return True

def main():
    import os

    # 文件路径
    ai_dev_path = '/mnt/c/Users/qq139/Downloads/AI开发.json'
    cv_path = '/mnt/c/Users/qq139/Downloads/计算机视觉.json'
    sw_dev_path = '/mnt/c/Users/qq139/Downloads/软件开发.json'

    # 读取AI开发资料作为基础模板
    print("读取 AI开发.json...")
    with open(ai_dev_path, 'r', encoding='utf-8') as f:
        ai_dev_data = json.load(f)

    # 读取计算机视觉资料
    print("读取 计算机视觉.json...")
    with open(cv_path, 'r', encoding='utf-8') as f:
        cv_data = json.load(f)

    # 读取软件开发资料
    print("读取 软件开发.json...")
    with open(sw_dev_path, 'r', encoding='utf-8') as f:
        sw_dev_data = json.load(f)

    # 将AI开发的基础信息复制到另外两份资料
    print("\n复制基础信息...")
    base_profile = ai_dev_data['profiles'][0]

    # 更新计算机视觉资料
    if cv_data.get('profiles') and len(cv_data['profiles']) > 0:
        cv_profile = cv_data['profiles'][0]
        # 复制基础信息（保留原有的name和id）
        cv_name = cv_profile.get('name', '计算机视觉')
        cv_id = cv_profile.get('id', '')
        for key in ['basicInfo', 'education', 'workExperience', 'awards', 'certificates',
                    'languageSkills', 'jobIntention', 'commonAnswers', 'skills',
                    'attachments', 'declarations', 'customAnswers']:
            if key in base_profile:
                cv_profile[key] = base_profile[key].copy() if isinstance(base_profile[key], (dict, list)) else base_profile[key]
        cv_profile['name'] = cv_name if cv_name else '计算机视觉'
        if cv_id:
            cv_profile['id'] = cv_id
        cv_profile['updatedAt'] = ai_dev_data['profiles'][0]['updatedAt']

    # 更新软件开发资料
    if sw_dev_data.get('profiles') and len(sw_dev_data['profiles']) > 0:
        sw_profile = sw_dev_data['profiles'][0]
        # 复制基础信息（保留原有的name和id）
        sw_name = sw_profile.get('name', '软件开发')
        sw_id = sw_profile.get('id', '')
        for key in ['basicInfo', 'education', 'workExperience', 'awards', 'certificates',
                    'languageSkills', 'jobIntention', 'commonAnswers', 'skills',
                    'attachments', 'declarations', 'customAnswers']:
            if key in base_profile:
                sw_profile[key] = base_profile[key].copy() if isinstance(base_profile[key], (dict, list)) else base_profile[key]
        sw_profile['name'] = sw_name if sw_name else '软件开发'
        if sw_id:
            sw_profile['id'] = sw_id
        sw_profile['updatedAt'] = ai_dev_data['profiles'][0]['updatedAt']

    print("✓ 基础信息已复制")

    # 更新各资料的项目信息
    print("\n更新项目信息...")
    update_profile_projects(cv_data, '计算机视觉')
    update_profile_projects(sw_dev_data, '软件开发')

    # 保存更新后的文件
    print("\n保存文件...")
    with open(cv_path, 'w', encoding='utf-8') as f:
        json.dump(cv_data, f, ensure_ascii=False, indent=2)
    print(f"✓ 已保存 {cv_path}")

    with open(sw_dev_path, 'w', encoding='utf-8') as f:
        json.dump(sw_dev_data, f, ensure_ascii=False, indent=2)
    print(f"✓ 已保存 {sw_dev_path}")

    print("\n✅ 所有资料更新完成！")
    print(f"\n请在扩展中导入更新后的资料文件：")
    print(f"  - 计算机视觉.json")
    print(f"  - 软件开发.json")

if __name__ == '__main__':
    main()
