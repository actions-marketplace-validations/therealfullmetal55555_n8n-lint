const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;
const PHONE = /\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;
const FAKE_DOMAIN = /@(example\.(com|org|net)|test\.[a-z]+|invalid|localhost|acme\.test|[a-z0-9-]+\.test|[a-z0-9-]+\.example)$/i;
const SECRETISH = /\b(sk-[A-Za-z0-9_-]{32,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36,}|xox[abprs]-[A-Za-z0-9-]{10,}|\d{8,10}:[A-Za-z0-9_-]{35})\b/;

export const rulePinDataPii = {
  id: 'N8N009',
  name: 'pindata-pii',
  severity: 'medium',
  title: 'Pinned test data contains real-looking personal data or secrets',
  summary: 'The exported workflow carries pinData with email addresses, phone numbers or tokens that do not look like placeholders.',
  why: 'Pinned data is saved inside the workflow JSON. People pin a real execution to test with, then export or commit the workflow and ship real customers\' data with it.',
  fix: 'Unpin data before exporting (or replace it with fake data such as user@example.com). Consider a pre-commit hook that runs n8n-lint.',
  bad: '{ "pinData": { "Webhook": [ { "json": { "email": "maria.ivanova@gmail.com", "phone": "+7 916 123 45 67" } } ] } }',
  good: '{ "pinData": { "Webhook": [ { "json": { "email": "user@example.com" } } ] } }',
  check({ wf, report }) {
    const pin = wf.pinData;
    if (!pin || typeof pin !== 'object') return;
    const offenders = [];
    let emails = 0, phones = 0, secrets = 0;
    for (const [node, items] of Object.entries(pin)) {
      const s = JSON.stringify(items ?? '');
      const e = (s.match(EMAIL) || []).filter((x) => !FAKE_DOMAIN.test(x));
      const p = s.match(PHONE) || [];
      const k = SECRETISH.test(s) ? 1 : 0;
      if (e.length || p.length || k) { offenders.push(node); emails += e.length; phones += p.length; secrets += k; }
    }
    if (!offenders.length) return;
    const what = [emails && `${emails} email${emails > 1 ? 's' : ''}`, phones && `${phones} phone number${phones > 1 ? 's' : ''}`, secrets && 'a token-like value'].filter(Boolean).join(', ');
    report({ nodes: offenders, path: 'pinData', severity: secrets ? 'high' : 'medium', message: `Pinned data in ${offenders.length} node${offenders.length > 1 ? 's' : ''} contains ${what} (${offenders.slice(0, 3).map((n) => `"${n}"`).join(', ')}${offenders.length > 3 ? ', …' : ''}).` });
  },
};
