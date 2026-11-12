// ============================================================================
// Capybara 网申助手 content script —— ai.js
// AI 编排：aiSmartFill 智能补填与 aiStepByStepFill 开放题逐步填写、进度条与投递记录
// 本目录各文件按 manifest content_scripts 顺序在同一隔离世界全局作用域中执行；
// 跨文件引用在运行时解析，模块内顶层 const/let 统一为 var 以支持扩展重注入。
// ============================================================================

'use strict';
function askAi(prompt, systemPrompt, maxTokens) {
  return runtimeSend({
    action: 'aiGenerate',
    prompt,
    systemPrompt,
    maxTokens: maxTokens || 2000
  }, 90000);
}

function showAiProgress(text) {
  let el = document.getElementById('job-autofill-ai-progress-badge');
  if (!el) {
    el = document.createElement('div');
    el.id = 'job-autofill-ai-progress-badge';
  }
  el.setAttribute('style', [
    'position:fixed',
    'top:18px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'gap:8px',
    'padding:10px 18px',
    'border-radius:999px',
    'background:#1e1b4b',
    'color:#f8fafc',
    'font-size:13px',
    'font-weight:650',
    'line-height:1.4',
    'box-shadow:0 10px 32px rgba(0,0,0,.4)',
    'pointer-events:none',
    'max-width:min(640px,calc(100vw - 24px))',
    'font-family:-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif'
  ].join(';'));
  el.innerHTML = `<span class="ai-spinner">✨</span><span>${text}</span>`;
  (document.documentElement || document.body).appendChild(el);
  return el;
}

function hideAiProgress() {
  const el = document.getElementById('job-autofill-ai-progress-badge');
  if (el) el.remove();
}

function smartFillSystemPrompt() {
  return [
    '你是网申表单的字段匹配助手，任务是判断每个表单字段应该填什么值。',
    '硬性规则：',
    '1. 只输出严格的 JSON 数组，不要 markdown 代码块、不要任何解释文字，格式：[{"position":字段序号,"value":"要填的值"}]',
    '2. 只能使用【候选人资料】中出现过的信息；资料里没有对应内容的字段绝不能出现在结果里，禁止虚构、推断或补全',
    '3. options 不为空的字段是下拉框，value 必须从选项原文中原样选择，一个字都不能改',
    '4. 日期类字段按 placeholder/maxLength 暗示的格式输出（如 2024-06 或 2024-06-30），没有提示时用 YYYY-MM',
    '5. value 必须简短、可直接填入输入框，不带单位说明、引号或多余文字',
    '6. widgetSelect: true 的字段是组件下拉框（选项未展开收集），value 必须填选项的常见原文，如政治面貌填"共青团员"、省份按选项习惯填"广东省"或"广东"',
    '7. cascadeGroup 相同的多个字段是同一组级联下拉（如 省/市/区）：只对 level=1 的字段返回一项，value 用数组按层级给出各级选项原文，例如 {"position":12,"value":["广东省","潮州市"]}；数组长度等于层级数，不要为 level>1 的字段单独返回',
    '8. 标注为「xxx·类型」和「xxx·内容」的字段是同一行拆开的组合控件：「xxx·类型」填类型下拉的选项原文（如"身份证"），「xxx·内容」填对应的值本身（如证件号码、账号）'
  ].join('\n');
}

// AI 智能补填主流程：收集未填字段 → 资料摘要 → 分批让 AI 匹配 → 校验后写入
async function aiSmartFill(profile, settings, options) {
  profile = profileForFilling(profile);
  const opts = options || {};
  const task = opts.task || null;
  const signal = opts.signal || task?.controller.signal || null;
  const result = { count: 0 };
  if (!profile || !settings?.aiEnabled || !settings?.aiApiKey || settings.aiSmartFill === false) return result;

  let fields = collectSmartFillFields();
  for (const ref of fields) attachSmartFillSourceContext(ref, profile);
  fields = fields.filter(ref => !ref.allowedSources.length || !!ref.sourceText);
  if (fields.length === 0) {
    if (typeof appLog !== 'undefined') appLog.info('content', 'ai.smart_fill', '没有需要 AI 智能补填的字段');
    return result;
  }

  const batches = [];
  for (let i = 0; i < fields.length; i += SMART_FILL_BATCH_SIZE) {
    batches.push(fields.slice(i, i + SMART_FILL_BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    await waitForFillCheckpoint(task);
    showAiProgress(`AI 智能匹配 第${i + 1}批/共${batches.length}批（共 ${fields.length} 个字段）…`);

    const payload = batches[i].map(smartFillFieldPayload);
    const allowedSections = new Set(batches[i].flatMap(ref => ref.allowedSources || []));
    const digest = buildSmartFillProfileDigest(profile, allowedSections);
    const userPrompt =
      `【候选人资料】\n${digest}\n\n` +
      `【待填字段】\n${JSON.stringify(payload)}\n\n` +
      '请对照资料逐个判断：资料中有明确对应值的字段才输出，严格按 [{"position":字段序号,"value":"要填的值"}] 的 JSON 数组返回；资料中没有对应信息的字段不要出现在结果里。字段的 sectionKind/entryIndex/allowedSources 是硬性来源限制，不得从其他模块或其他经历取值。';

    let aiRes = null;
    try {
      aiRes = await askAi(userPrompt, smartFillSystemPrompt(), 3000);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (typeof appLog !== 'undefined') appLog.error('content', 'ai.smart_fill_error', `第 ${i + 1} 批 AI 调用异常`, err?.message || String(err));
    }
    throwIfFillCancelled(signal);
    if (!aiRes || !aiRes.success || !aiRes.text) {
      if (typeof appLog !== 'undefined') {
        appLog.warn('content', 'ai.smart_fill_miss', `第 ${i + 1} 批 AI 未返回结果`, { error: aiRes?.error || aiRes?.message || '返回正文为空' });
      }
    } else {
      const items = parseSmartFillAiJson(aiRes.text);
      if (!items) {
        if (typeof appLog !== 'undefined') {
          appLog.warn('content', 'ai.smart_fill_parse', `第 ${i + 1} 批返回的不是合法 JSON`, { text: String(aiRes.text).slice(0, 200) });
        }
      } else {
          const filledLabels = [];
          const applied = await applySmartFillAiItems(items, batches[i], fields, 'ai.smart_fill', { task, signal });
          result.count += applied.count;
          filledLabels.push(...applied.labels);

          if (typeof appLog !== 'undefined') {
            appLog.info('content', 'ai.smart_fill', `AI 智能匹配 第${i + 1}批/共${batches.length}批：填了 ${filledLabels.length} 项`, { labels: filledLabels });
          }
      }
    }

    // 批次间不再固定休眠；DOM 写入仍在 applySmartFillAiItems 内串行执行。
  }

  if (typeof appLog !== 'undefined') {
    if (result.count > 0) appLog.success('content', 'ai.smart_fill_done', `AI 智能补填 ${result.count} 项`, { url: location.href });
    else appLog.info('content', 'ai.smart_fill_done', 'AI 智能补填 0 项（资料中没有可对应的字段）', { url: location.href });
  }
  return result;
}

async function aiStepByStepFill(profile) {
  profile = profileForFilling(profile);
  if (!profile) {
    showNotification('未找到可用简历资料，请先在配置中创建', 'warning');
    return { count: 0 };
  }
  // 与选区填入互斥：两段填入都直接写控件并管理进度条，并发会互相覆盖
  if (regionFillRunning) {
    showNotification('选区填入正在进行中，请稍候', 'info');
    return { count: 0 };
  }
  if (aiFillRunning) {
    showNotification('AI 助填正在进行中，请稍候', 'info');
    return { count: 0 };
  }
  const task = startActiveFillTask('ai', 'full');
  if (!task) {
    showNotification('已有填入任务正在进行，请稍候', 'info');
    return { count: 0 };
  }
  aiFillRunning = true;
  showAiProgress('正在填充基础字段…');

  try {
    cacheJobMetaFromPage();
    const fastFillRes = await fillForm(profile, { task, signal: task.controller.signal, mode: 'full' });

    const settingsRes = await runtimeSend({ action: 'getSettings' }, 8000);
    const settings = settingsRes?.settings || {};

    if (!settings.aiEnabled || !settings.aiApiKey) {
      hideAiProgress();
      showNotification(`⚡ 基础字段已填充 ${fastFillRes.filledCount} 项。如需 AI 解答开放题，请在插件配置中填入 API Key`, 'warning');
      return { ...fastFillRes, aiConfigured: false };
    }

    // AI 智能补填：用 AI 匹配本地字典识别不了、但资料中有明确值的标准字段
    let smartFillCount = 0;
    if (settings.aiSmartFill !== false) {
      const smartFillRes = await aiSmartFill(profile, settings, { task, signal: task.controller.signal });
      smartFillCount = smartFillRes.count;
    }

    const candidates = snapshotAiQuestionFields();
    if (typeof appLog !== 'undefined') {
      appLog.info('content', 'ai.candidates', `识别到 ${candidates.length} 道待填写开放题`, {
        fields: candidates.map((field) => ({
          label: field.label,
          maxLength: field.maxLength || null,
          fieldType: field.fieldType || null,
          section: field.sectionKind || null,
          experienceIndex: field.experienceIndex
        }))
      });
    }

    if (candidates.length === 0) {
      hideAiProgress();
      if (fastFillRes.filledCount > 0 || smartFillCount > 0) {
      }
      showNotification(`标准字段已填充 ${fastFillRes.filledCount} 项` +
        (smartFillCount ? `，AI 智能补填 ${smartFillCount} 项` : '') +
        '，当前没有需要 AI 写的开放题', 'success');
      return { count: fastFillRes.filledCount + smartFillCount };
    }

    showAiProgress(`准备解答 ${candidates.length} 道开放题…`);

    const posName = detectPositionName(profile);
    const compName = detectCompanyName();
    const resumeContext = JSON.stringify(slimResumeContext(profile));
    let aiFilledCount = 0;
    let manualAnswerCount = 0;

    for (let i = 0; i < candidates.length; i++) {
      await waitForFillCheckpoint(task);
      const fieldRef = candidates[i];
      const promptField = resolveAiQuestionField(fieldRef);
      const labelText = fieldRef.label;
      const maxLength = fieldRef.maxLength;

      showAiProgress(`AI 正在写 (${i + 1}/${candidates.length})：${escapeHtml(labelText.slice(0, 28))}`);
      if (promptField) {
        promptField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        promptField.classList.add('job-autofill-ai-focusing');
      }

      const structuredContext = resolveStructuredResumeContext(profile, fieldRef, promptField);
      // 游戏体验和个人熟练度排序需要本人确认，不能由项目经历推断。
      if (/游戏经历|游戏时长|氪金|编程语言.*(排序|熟悉程度)|最擅长.*编程语言/.test(labelText)) {
        manualAnswerCount++;
        promptField?.classList.remove('job-autofill-ai-focusing');
        if (typeof appLog !== 'undefined') appLog.info('content', 'ai.step_skip', `请本人填写: ${labelText}`);
        continue;
      }
      if (structuredContext.required && !structuredContext.item) {
        promptField?.classList.remove('job-autofill-ai-focusing');
        if (typeof appLog !== 'undefined') {
          appLog.warn('content', 'ai.step_skip', `跳过无对应简历来源的字段: ${labelText}`, {
            fieldType: fieldRef.fieldType,
            section: fieldRef.sectionKind,
            experienceIndex: fieldRef.experienceIndex,
            reason: structuredContext.reason
          });
        }
        continue;
      }

      let taskInstruction = '用 80-150 字回答，只写会填进输入框的正文。';
      if (fieldRef.fieldType === 'projectResponsibilities') {
        taskInstruction = `精准提取该项目中的个人职责，要求：
1. 列出3-4条核心职责，每条单独一行，以动词开头（如"构建"、"负责"、"实现"）
2. 每条职责必须包含：具体工作内容 + 使用的技术/方法 + 量化成果（如准确率、性能指标、处理量）
3. 严格使用简历中该项目已有的内容，不得引用其他项目
4. 保持专业技术描述，避免空洞表述
示例格式：
● 构建拒识模型，微调BERT-Tiny处理50万条语料，实现毫秒级响应与90%以上拒识率
● 基于DeepSeek与Function Calling实现意图匹配与槽位抽取，准确率达91%`;
      } else if (fieldRef.fieldType === 'workDescription') {
        taskInstruction = `精准提取该段工作/实习的核心职责，要求：
1. 列出3-4条主要职责，每条单独一行，以动词开头
2. 每条必须体现：具体负责的模块/功能 + 采用的技术方案 + 业务价值或量化指标
3. 严格基于简历中该段实习的原有内容，不得用项目经历替代
4. 突出实际落地工作，避免泛泛而谈
示例格式：
● 负责金融知识库构建，解析11588份年报（70GB），为RAG检索提供数据底座
● 基于LoRA微调GLM4-9B实现NL2SQL转换，生成准确率提升至82%`;
      } else if (/项目.*描述|项目.*介绍|项目.*内容/i.test(labelText)) {
        taskInstruction = `用80-120字精炼概括该项目，必须包含：
1. 项目背景与业务目标（1句话说明解决什么问题）
2. 核心技术方案（采用的关键技术栈）
3. 主要成果与业务价值（带数字的量化指标）
避免罗列职责，仅写项目整体概况。`;
      } else if (/项目.*职责|负责.*内容|个人.*分工/i.test(labelText)) {
        taskInstruction = `列出该项目中的个人具体职责，要求：
1. 写3-4条，每条单独一行，动词开头（构建/负责/实现/优化）
2. 体现：做了什么 + 用什么技术 + 达到什么效果
3. 必须有量化数据（准确率/延迟/并发量/数据规模等）
4. 突出个人核心贡献，不写团队整体工作`;
      } else if (/成果|成就|难点/i.test(labelText)) {
        taskInstruction = `提炼该经历的核心成果，要求：
1. 写2-3条量化成果，每条单独一行
2. 必须包含具体数字（准确率90%、延迟降低50ms、QPS达500+等）
3. 体现技术难点攻克或业务指标提升
4. 避免泛泛描述，每条都要有可验证的指标`;
      } else if (/自我评价|个人总结|个人优势/i.test(labelText)) {
        taskInstruction = `用80-120字总结个人核心竞争力，要求：
1. 突出技术栈深度（掌握的核心技术与框架）
2. 体现项目落地能力（独立完成过什么类型的系统）
3. 用量化数据支撑（处理过多少数据、达到什么指标）
4. 简洁专业，不写空话套话`;
      } else if (/动机|为什么/i.test(labelText)) {
        taskInstruction = `用80-120字说明申请动机，要求：
1. 结合「${compName}」的业务方向，说明个人技术与岗位的匹配点
2. 引用简历中的具体项目经验，说明如何能快速上手「${posName}」
3. 表达对该领域的兴趣与技术积累
4. 真诚专业，避免空洞表态`;
      }

      const fieldResumeContext = structuredContext.item
        ? JSON.stringify({ 对应经历类型: structuredContext.kind, 对应经历: structuredContext.context }, null, 2)
        : resumeContext;
      const groundingRule = structuredContext.item
        ? `【重要】本字段明确属于「${structuredContext.title}」。只能使用下面这一段对应经历，严禁引用其他项目或工作，严禁补充原材料中不存在的公司、岗位、职责或成果。\n`
        : '【重要】严格依据简历作答，不得虚构简历中不存在的经历、公司、岗位或成果。\n';

      const formatRequirement = (fieldRef.fieldType === 'projectResponsibilities' || fieldRef.fieldType === 'workDescription' || /职责|负责/i.test(labelText))
        ? '\n【输出格式】每条职责单独一行，以"●"或"•"开头，格式：● 动词+具体工作+技术方案+量化成果'
        : '\n【输出格式】流畅的段落文本，自然分段，不要使用列表符号';

      const userPrompt =
        `【任务】填写网申开放题\n` +
        '【资料不足】若简历没有题目要求的事实（如游戏经历、语言熟练度排序），只返回 [[NEEDS_USER_INPUT]]。不得把未提及写成“没有”，不得推断个人偏好或编造时长。能部分回答的题目只写已知事实。\n' +
        `【应聘岗位】${compName} - ${posName}\n` +
        `【题目】${labelText}\n` +
        (fieldRef.placeholder ? `【提示】${fieldRef.placeholder}\n` : '') +
        (maxLength ? `【字数限制】不超过 ${maxLength} 字\n` : '') +
        groundingRule +
        `【作答要求】\n${taskInstruction}\n` +
        formatRequirement + '\n' +
        `【可用简历材料】\n${fieldResumeContext}\n\n` +
        `请严格按照上述要求作答，只输出填入输入框的正文内容。`;

      const systemPrompt = `你是一个专业的网申填写助手。
核心要求：
1. 只输出可直接填入输入框的正文内容，不要标题、序号前缀、markdown格式
2. 必须严格基于提供的简历材料，不得虚构任何公司、岗位、技术或成果
3. 如果是项目职责/工作职责字段，每条职责必须包含：动作+技术+量化成果
4. 避免空洞表述，每个关键点都要有具体支撑（技术栈、数据量、性能指标）
5. 禁止跨项目混用内容，禁止把项目经历写成实习经历
6. 输出要简洁专业，符合技术岗位招聘的表达习惯`;

      try {
        const aiRes = await askAi(userPrompt, systemPrompt, 2000);
        throwIfFillCancelled(task.controller.signal);
        if (aiRes && aiRes.success && aiRes.text) {
          const answer = aiRes.text.trim().replace(/^```[\s\S]*?\n|```$/g, '').trim();
          if (answer.includes('[[NEEDS_USER_INPUT]]')) {
            manualAnswerCount++;
            if (typeof appLog !== 'undefined') appLog.info('content', 'ai.step_skip', `资料不足，待本人补充: ${labelText}`);
            continue;
          }
          if (answer) {
            const qualityCheck = checkAnswerQuality(answer, fieldRef.fieldType, labelText);
            const writeResult = await writeAndVerifyAiAnswer(fieldRef, answer);
            if (writeResult.success) {
              aiFilledCount++;
              writeResult.field.classList.add('job-autofill-ai-filled');
              if (typeof appLog !== 'undefined') {
                const logLevel = qualityCheck.isGood ? 'success' : 'warn';
                const logMessage = qualityCheck.isGood
                  ? `AI 已写入题目: ${labelText}`
                  : `AI 已写入题目: ${labelText}（质量评分: ${qualityCheck.score}/100）`;
                appLog[logLevel]('content', 'ai.step_fill', logMessage, {
                  answer: answer.slice(0, 500),
                  writtenLength: writeResult.value.length,
                  matchedExperience: structuredContext.title || null,
                  qualityScore: qualityCheck.score,
                  qualityWarnings: qualityCheck.warnings
                });
              }
            } else if (typeof appLog !== 'undefined') {
              appLog.warn('content', 'ai.step_fill_miss', `已生成但未能写入: ${labelText}`, {
                answer: answer.slice(0, 200),
                reason: writeResult.reason
              });
            }
          } else if (typeof appLog !== 'undefined') {
            appLog.warn('content', 'ai.step_generate_miss', `模型未生成可填写正文: ${labelText}`);
          }
        } else if (typeof appLog !== 'undefined') {
          appLog.warn('content', 'ai.step_generate_miss', `模型生成失败: ${labelText}`, {
            error: aiRes?.error || aiRes?.message || '返回正文为空'
          });
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        console.error('[易offer] AI 单步解析失败:', err);
        if (typeof appLog !== 'undefined') {
          appLog.error('content', 'ai.step_error', `AI生成异常: ${labelText}`, err.message);
        }
      } finally {
        promptField?.classList.remove('job-autofill-ai-focusing');
      }
      await sleep(200);
    }

    throwIfFillCancelled(task.controller.signal);
    hideAiProgress();

    if (aiFilledCount > 0 || fastFillRes.filledCount > 0 || smartFillCount > 0) {
    }

    showNotification(`AI 助填完成：开放题 ${aiFilledCount} 项，基础字段 ${fastFillRes.filledCount} 项` +
      (smartFillCount ? `，AI 智能补填 ${smartFillCount} 项` : '') +
      (manualAnswerCount ? `；${manualAnswerCount} 项资料不足，请本人填写` : ''), manualAnswerCount ? 'warning' : 'success');
    if (typeof appLog !== 'undefined') {
      appLog.success('content', 'ai.step_fill_done', `逐步解析完成，共解答 ${aiFilledCount} 项，AI 智能补填 ${smartFillCount} 项`, { url: location.href });
    }
    return { count: fastFillRes.filledCount + aiFilledCount + smartFillCount };
  } finally {
    aiFillRunning = false;
    finishActiveFillTask(task);
    hideAiProgress();
  }
}
