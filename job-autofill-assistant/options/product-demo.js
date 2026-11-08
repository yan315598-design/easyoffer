/* Local product walkthrough. All example values are synthetic. */
(() => {
  const demo = document.getElementById('product-demo');
  const descriptions = {
    local: '姓名、邮箱这类有明确对应值的字段，先由本地规则填入。',
    ai: '启用 AI 后，可以补匹配难识别的字段，也能根据简历里的经历为开放题起草答案。',
    review: '请核对开放题草稿和网站要求。简历只有年月时，完整日期需要你补上具体日。'
  };
  const answer = '我想从数据分析做起，先熟悉业务指标，再把项目里的报表经验用到实际业务中。';
  const examples = {
    local: {
      answer: ['有待补充', '未填写', 'waiting'],
      date: ['请选择具体日期', '未填写', 'waiting']
    },
    ai: {
      answer: [answer, 'AI 草稿', 'draft'],
      date: ['请选择具体日期', '未填写', 'waiting']
    },
    review: {
      answer: [answer, '请核对', 'review'],
      date: ['简历只填了 2027-06，请补充具体日。', '待补充', 'review']
    }
  };

  const steps = [...demo.querySelectorAll('[data-demo-stage]')];
  const explanation = demo.querySelector('.product-demo-explain');
  for (const button of steps) {
    button.addEventListener('click', () => {
      const stage = button.dataset.demoStage;
      if (stage === demo.dataset.stage) return;
      demo.dataset.stage = stage;
      for (const step of steps) step.setAttribute('aria-pressed', String(step === button));
      explanation.textContent = descriptions[stage];
      for (const [field, [value, status, tone]] of Object.entries(examples[stage])) {
        const row = demo.querySelector(`[data-demo-field="${field}"]`);
        row.querySelector('.demo-field-value').textContent = value;
        row.querySelector('.demo-field-status').textContent = status;
        row.dataset.tone = tone;
      }
    });
  }
})();
