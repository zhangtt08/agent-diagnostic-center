/** 输入输出护栏：注入检测、PII 脱敏、外连白名单。 */

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|above)\s+instructions/i,
  /you\s+are\s+now\s+(dan|developer\s+mode)/i,
  /system\s*prompt\s*[:：]/i,
  /(泄露|忽略上述|无视之前|扮演).{0,12}(指令|规则|提示)/,
];

const PII_PATTERNS = [
  { name: 'email', re: /[\w.+-]+@[\w-]+\.[\w.]+/g, mask: () => '[redacted:email]' },
  { name: 'cn_phone', re: /(?<!\d)1[3-9]\d{9}(?!\d)/g, mask: () => '[redacted:phone]' },
  { name: 'card', re: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g, mask: () => '[redacted:card]' },
  { name: 'api_key', re: /\bsk-[A-Za-z0-9-]{16,}\b/g, mask: () => '[redacted:key]' },
];

const ALLOWED_HOSTS = new Set(['api.internal.example', 'cdn.example.com', 'kb.internal.example']);

export function checkPromptInjection(text) {
  const hits = INJECTION_PATTERNS.filter((re) => re.test(String(text ?? '')));
  if (hits.length > 0) {
    return { blocked: true, reason: 'injection_pattern', matched: hits.map((h) => h.source).slice(0, 3) };
  }
  if (String(text ?? '').length > 24_000) {
    return { blocked: true, reason: 'input_too_large' };
  }
  return { blocked: false, reason: null };
}

export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const rule of PII_PATTERNS) {
    out = out.replace(rule.re, rule.mask);
  }
  return out;
}

export function assertAllowedHost(url) {
  try {
    return ALLOWED_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function validateOutputSchema(payload, schema) {
  const required = schema?.required ?? [];
  const missing = required.filter((key) => payload?.[key] === undefined);
  return { ok: missing.length === 0, missing };
}
