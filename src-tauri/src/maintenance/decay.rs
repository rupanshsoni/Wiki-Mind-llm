use serde::{Deserialize, Serialize};
use chrono::NaiveDate;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DomainVolatility {
    Low,
    Medium,
    High,
}

impl DomainVolatility {
    pub fn multiplier(&self) -> f64 {
        match self {
            DomainVolatility::Low => 0.5,
            DomainVolatility::Medium => 1.0,
            DomainVolatility::High => 2.0,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FreshnessState {
    Fresh,
    Aging,
    Stale,
    Decayed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimDecayInput {
    pub confidence: f64,
    pub source_count: usize,
    pub contradiction_count: usize,
    pub last_verified: String,
    pub domain_volatility: Option<DomainVolatility>,
}

pub fn compute_confidence(input: &ClaimDecayInput, now: NaiveDate) -> f64 {
    let last_verified_date = match NaiveDate::parse_from_str(&input.last_verified, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => return input.confidence, // Fallback if invalid date
    };

    let delta_t = (now - last_verified_date).num_days();
    if delta_t <= 0 {
        return input.confidence;
    }

    let lambda_0 = 0.01;
    let v = input.domain_volatility.unwrap_or(DomainVolatility::Medium).multiplier();
    let alpha = 0.3;
    let s = input.source_count as f64;
    let beta = 0.5;
    let k = input.contradiction_count as f64;

    let lambda_eff = lambda_0 * v * (1.0 / (1.0 + alpha * s)) * (1.0 + beta * k);
    let confidence_t = input.confidence * (-lambda_eff * delta_t as f64).exp();

    // Clamp between 0.0 and 1.0
    confidence_t.max(0.0).min(1.0)
}

pub fn classify_freshness(confidence_t: f64, base_confidence: f64) -> FreshnessState {
    if base_confidence <= 0.0 {
        return FreshnessState::Decayed;
    }
    let ratio = confidence_t / base_confidence;
    if ratio >= 0.7 {
        FreshnessState::Fresh
    } else if ratio >= 0.4 {
        FreshnessState::Aging
    } else if ratio >= 0.2 {
        FreshnessState::Stale
    } else {
        FreshnessState::Decayed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_volatility_multipliers() {
        assert_eq!(DomainVolatility::Low.multiplier(), 0.5);
        assert_eq!(DomainVolatility::Medium.multiplier(), 1.0);
        assert_eq!(DomainVolatility::High.multiplier(), 2.0);
    }

    #[test]
    fn test_compute_confidence_no_decay() {
        let input = ClaimDecayInput {
            confidence: 0.8,
            source_count: 2,
            contradiction_count: 0,
            last_verified: "2026-07-10".to_string(),
            domain_volatility: Some(DomainVolatility::Medium),
        };
        let now = NaiveDate::from_ymd_opt(2026, 7, 10).unwrap();
        let computed = compute_confidence(&input, now);
        // delta_t = 0, should be identical
        assert_eq!(computed, 0.8);
    }

    #[test]
    fn test_compute_confidence_basic_decay() {
        let input = ClaimDecayInput {
            confidence: 1.0,
            source_count: 0,
            contradiction_count: 0,
            last_verified: "2026-07-01".to_string(),
            domain_volatility: Some(DomainVolatility::Medium),
        };
        // delta_t = 10 days
        // lambda_eff = 0.01 * 1.0 * 1.0 * 1.0 = 0.01
        // C(t) = 1.0 * exp(-0.01 * 10) = exp(-0.1) ≈ 0.9048
        let now = NaiveDate::from_ymd_opt(2026, 7, 11).unwrap();
        let computed = compute_confidence(&input, now);
        assert!((computed - 0.904837).abs() < 1e-5);
    }

    #[test]
    fn test_classify_freshness() {
        assert_eq!(classify_freshness(0.8, 1.0), FreshnessState::Fresh);
        assert_eq!(classify_freshness(0.69, 1.0), FreshnessState::Aging);
        assert_eq!(classify_freshness(0.4, 1.0), FreshnessState::Aging);
        assert_eq!(classify_freshness(0.39, 1.0), FreshnessState::Stale);
        assert_eq!(classify_freshness(0.2, 1.0), FreshnessState::Stale);
        assert_eq!(classify_freshness(0.19, 1.0), FreshnessState::Decayed);
    }
}
