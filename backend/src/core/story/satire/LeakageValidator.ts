import { Logger } from '../../../utils/Logger';

export interface LeakageCheckResult {
  passed: boolean;
  overlapRatio: number;
  matchedNgrams: string[];
  details: string;
}

const REFERENCE_BIBLE_EXAMPLES = [
  // Example A: JEE rank
  'in this world jee rank floats above everyones head air 1 lives in a mansion while the mayor rank 750000 lives in a garage and runs the town from it at his own wedding the low rank groom stands in a pit while the brides high rank family looks down from a stage and he needs a ladder to hand over the garland the protagonist hides his tag under a scarf and is treated like a vip until wind blows it off twist the top ranked kid secretly wears a paper bag because people only love his number',
  // Example B: Instagram followers
  'in this world instagram followers float above heads follower count tags the 10m follower man gets a red carpet to the bus stop the 12 follower mayor is asked to tag a friend before he can speak',
  // Example C: Attendance percentage
  'in this world attendance percentage floats above heads a meter above each head 100 percent people literally get the sunniest seats 40 percent people get a shared umbrella of shame',
];

export class LeakageValidator {
  public static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);
  }

  public static extractNgrams(tokens: string[], n: number = 4): Set<string> {
    const ngrams = new Set<string>();
    for (let i = 0; i <= tokens.length - n; i++) {
      ngrams.add(tokens.slice(i, i + n).join(' '));
    }
    return ngrams;
  }

  public static checkLeakage(scriptText: string, maxAllowedRatio: number = 0.12): LeakageCheckResult {
    const scriptTokens = this.tokenize(scriptText);
    if (scriptTokens.length < 4) {
      return { passed: true, overlapRatio: 0, matchedNgrams: [], details: 'Script too short for 4-gram check' };
    }

    const scriptNgrams = this.extractNgrams(scriptTokens, 4);
    if (scriptNgrams.size === 0) {
      return { passed: true, overlapRatio: 0, matchedNgrams: [], details: 'No 4-grams extracted' };
    }

    const refNgrams = new Set<string>();
    for (const ref of REFERENCE_BIBLE_EXAMPLES) {
      const refTokens = this.tokenize(ref);
      for (const ng of this.extractNgrams(refTokens, 4)) {
        refNgrams.add(ng);
      }
    }

    const matched: string[] = [];
    for (const ng of scriptNgrams) {
      if (refNgrams.has(ng)) {
        matched.push(ng);
      }
    }

    const overlapRatio = matched.length / scriptNgrams.size;
    const passed = overlapRatio <= maxAllowedRatio;

    return {
      passed,
      overlapRatio,
      matchedNgrams: matched,
      details: passed
        ? `4-gram overlap ${(overlapRatio * 100).toFixed(1)}% <= ${(maxAllowedRatio * 100).toFixed(0)}% target threshold`
        : `Leakage violation: ${(overlapRatio * 100).toFixed(1)}% overlap exceeds ${(maxAllowedRatio * 100).toFixed(0)}% limit (${matched.length} matching 4-grams)`,
    };
  }

  public static sanitizeLeakage(scriptText: string): string {
    let sanitized = scriptText;
    // Replace leaked forbidden terms if any appear
    sanitized = sanitized.replace(/\bAIR\s+1\b/gi, 'Number 1');
    sanitized = sanitized.replace(/\bAIR\s+7,?50,?000\b/gi, 'Rank 750,000');
    sanitized = sanitized.replace(/\bJEE\s+rank\b/gi, 'Social metric');
    return sanitized;
  }
}
