export interface GuardrailCheckResult {
  safe: boolean;
  violations: string[];
  sanitizedText?: string;
}

export class SatireGuardrails {
  private static prohibitedPatterns: Array<{ name: string; pattern: RegExp; replacement: string }> = [
    // Real educational / coaching brands & institutions
    { name: 'Coaching Brand', pattern: /\b(allen|fiitjee|aakash|resonance|byju['’]?s|unacademy|physics\s*wallah|pw)\b/gi, replacement: 'Apex Academy' },
    { name: 'Specific Real Institute', pattern: /\b(iit\s+delhi|iit\s+bombay|aiims|mit|stanford|harvard)\b/gi, replacement: 'Premier Institute' },

    // Real politicians & celebrities
    { name: 'Political Figures', pattern: /\b(modi|biden|trump|rahul\s*gandhi|kejriwal)\b/gi, replacement: 'The Mayor' },
    { name: 'Celebrity Names', pattern: /\b(elon\s*musk|zuckerberg|bezos|kardashian)\b/gi, replacement: 'The Mogul' },

    // Self-harm / academic distress / severe mental health
    { name: 'Self-Harm / Suicide', pattern: /\b(suicide|kill\s*myself|end\s*it\s*all|self[- ]harm|hanging|depressed|depression)\b/gi, replacement: 'rethinking priorities' },
    { name: 'Violence', pattern: /\b(murder|shoot|stab|bloodshed|assault)\b/gi, replacement: 'facepalm' },

    // Protected identity categories & slurs
    { name: 'Religious Reference', pattern: /\b(hindu|muslim|christian|sikh|jewish|caste|brahmin|dalit)\b/gi, replacement: 'citizens' },
    { name: 'Body Shaming', pattern: /\b(ugly|fat|deformed|dwarf|cripple)\b/gi, replacement: 'eccentric' },
  ];

  public static validateText(text: string): GuardrailCheckResult {
    const violations: string[] = [];
    let sanitized = text;

    for (const rule of this.prohibitedPatterns) {
      if (rule.pattern.test(sanitized)) {
        violations.push(rule.name);
        sanitized = sanitized.replace(rule.pattern, rule.replacement);
      }
    }

    return {
      safe: violations.length === 0,
      violations,
      sanitizedText: sanitized,
    };
  }

  public static sanitizeObject<T extends Record<string, any>>(obj: T): { safe: boolean; sanitized: T; violations: string[] } {
    let allViolations: string[] = [];
    const jsonStr = JSON.stringify(obj);
    let sanitizedStr = jsonStr;

    for (const rule of this.prohibitedPatterns) {
      if (rule.pattern.test(sanitizedStr)) {
        allViolations.push(rule.name);
        sanitizedStr = sanitizedStr.replace(rule.pattern, rule.replacement);
      }
    }

    return {
      safe: allViolations.length === 0,
      sanitized: JSON.parse(sanitizedStr) as T,
      violations: Array.from(new Set(allViolations)),
    };
  }
}
