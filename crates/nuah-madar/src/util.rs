use nuah_kernel::*;
use serde_json::Value;

pub fn manifest(v: Value) -> Manifest {
    serde_json::from_value(v).expect("madar manifest")
}

pub fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

/// Priority 0-10 as a band.
pub fn band(p: i64) -> &'static str {
    match p {
        0..=2 => "low",
        3..=5 => "medium",
        6..=8 => "high",
        _ => "urgent",
    }
}

/// A due date is a calendar date, `YYYY-MM-DD`.
pub fn check_date(field: &str, v: &Value) -> Result<()> {
    if v.is_null() {
        return Ok(());
    }
    let s = v.as_str().unwrap_or("");
    let b = s.as_bytes();
    let ok = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && matches!(s[5..7].parse::<u32>(), Ok(1..=12))
        && matches!(s[8..10].parse::<u32>(), Ok(1..=31));
    if ok { Ok(()) } else { Err(Error::invalid(field, "must be a date like 2026-11-30")) }
}

/// The calendar date (UTC) of a time in milliseconds.
pub fn date_of(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    // civil-from-days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { y + 1 } else { y }, m, d)
}

/// Turn a stale-revision failure of the data Port into the plugin's own reason code.
pub fn stale(e: Error, reason: &str, what: &str) -> Error {
    if e.reason.as_deref() == Some("kernel.stale_revision") {
        Error::reason(Category::Conflict, reason, &format!("{what} changed since you read it"))
    } else {
        e
    }
}

pub fn ids_of(v: &Value) -> Vec<String> {
    v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}
