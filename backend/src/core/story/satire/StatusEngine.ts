import { WorldConcept, StatusTier, MetricFormat, MetricDirection } from './WorldConceptSchema';

export interface ResolvedStatus {
  tier: StatusTier;
  formattedValue: string;
  displayPlateText: string;
  housing: string;
  elevation: string;
  treatment: string;
  isConcealed: boolean;
}

export class StatusEngine {
  /**
   * Formats a raw metric number according to the concept's configured display rules.
   */
  public static formatValue(val: number, format: MetricFormat): string {
    switch (format) {
      case 'indian_grouping': {
        const str = Math.round(val).toString();
        if (str.length <= 3) return str;
        const lastThree = str.substring(str.length - 3);
        const otherNumbers = str.substring(0, str.length - 3);
        const formatted = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree;
        return formatted;
      }
      case 'percent':
        return `${Math.round(val)}%`;
      case 'ordinal': {
        const n = Math.round(val);
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
      }
      case 'currency_inr': {
        return `₹${this.formatValue(val, 'indian_grouping')}`;
      }
      case 'k_m': {
        if (val >= 1000000) {
          const m = val / 1000000;
          return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
        }
        if (val >= 1000) {
          const k = val / 1000;
          return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
        }
        return val.toString();
      }
      case 'plain':
      default:
        return val.toLocaleString('en-US');
    }
  }

  /**
   * Resolves tier, formatting, plate text, and social effects for a character's metric value.
   */
  public static resolveStatus(value: number, concept: WorldConcept, isConcealed: boolean = false): ResolvedStatus {
    const isLowerBetter = concept.metric.direction === 'lower_is_better';
    
    // Find matching tier
    let tier = concept.tiers.find(t => value >= t.minVal && value <= t.maxVal);
    if (!tier) {
      tier = isLowerBetter ? concept.tiers[concept.tiers.length - 1] : concept.tiers[0];
    }

    const formatted = this.formatValue(value, concept.metric.format);
    const displayPlateText = isConcealed ? '???' : `${concept.metric.name}: ${formatted}`;

    const housing = concept.effects.housing[tier.id] || 'flat';
    const elevation = concept.effects.elevation[tier.id] || 'ground';
    const treatment = concept.effects.treatment[tier.id] || 'ignore';

    return {
      tier,
      formattedValue: formatted,
      displayPlateText,
      housing,
      elevation,
      treatment,
      isConcealed,
    };
  }

  /**
   * Compares two metric values. Returns > 0 if A has higher societal status than B,
   * < 0 if B has higher status than A, and 0 if equal status.
   */
  public static compareStatus(valA: number, valB: number, direction: MetricDirection): number {
    if (direction === 'lower_is_better') {
      return valB - valA; // lower number = higher societal status (e.g. Rank 1 > Rank 100)
    }
    return valA - valB; // higher number = higher status (e.g. 10M followers > 12 followers)
  }
}
