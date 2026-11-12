// ============================================================================
// Content Script 入口（兼容引导，实现已模块化）
//
// 实际实现拆分在 scripts/content/ 目录，由 manifest.json 的 content_scripts
// 按依赖顺序在同一隔离世界全局作用域中加载：
//   core.js              共用底座（工具函数、可见性/已填判定、消息通道）
//   detector.js          字段识别与证据评分（FIELD_PATTERNS / FIELD_ALIASES 等）
//   control-adapters.js  控件适配（原生控件、单选复选、组件下拉有界等待写入）
//   site.js              站点适配（北森 / 小红书 / Moka）、声明、扩展字段、附件
//   smart-fill.js        AI 智能补填公共层（候选收集 / 校验 / 级联写入）
//   fill-engine.js       fillForm 主循环与岗位信息探测（full / incremental、可取消）
//   ai.js                AI 编排（aiSmartFill / aiStepByStepFill）
//   region.js            选区填入
//   dock.js              悬浮 Dock 与抽屉
//   main.js              初始化、消息监听（fillForm / cancelFill 等）、全局 API
//
// 双重注入保护与初始化引导在 main.js 中完成；本文件仅保留占位，
// 兼容既有的文件引用（测试加载器、文档与外部脚本）。
// ============================================================================

(function() {
  'use strict';
  // 实现见 scripts/content/*.js；此处无需逻辑。
})();
