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

/// Days from the civil date `YYYY-MM-DD` to 1970-01-01 (negative before it). `None` if it is not a date.
pub fn day_number(date: &str) -> Option<i64> {
    let b = date.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let (y, m, d): (i64, i64, i64) = (date[0..4].parse().ok()?, date[5..7].parse().ok()?, date[8..10].parse().ok()?);
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

/// The date `n` days before `date`.
pub fn days_before(date: &str, n: i64) -> String {
    date_of((day_number(date).unwrap_or(0) - n) * 86_400_000)
}

/// `date` plus `every` days, weeks or months. A month step keeps the day, or the month's last day if it is shorter.
pub fn add_interval(date: &str, every: i64, unit: &str) -> String {
    let Some(n) = day_number(date) else { return date.to_string() };
    match unit {
        "day" => date_of((n + every) * 86_400_000),
        "week" => date_of((n + 7 * every) * 86_400_000),
        _ => {
            let (y, m, d): (i64, i64, i64) = (date[0..4].parse().unwrap_or(1970), date[5..7].parse().unwrap_or(1), date[8..10].parse().unwrap_or(1));
            let t = y * 12 + (m - 1) + every;
            let (ny, nm) = (t.div_euclid(12), t.rem_euclid(12) + 1);
            let first = format!("{ny:04}-{nm:02}-01");
            let next_first = if nm == 12 { format!("{:04}-01-01", ny + 1) } else { format!("{ny:04}-{:02}-01", nm + 1) };
            let len = day_number(&next_first).unwrap_or(0) - day_number(&first).unwrap_or(0);
            format!("{ny:04}-{nm:02}-{:02}", d.min(len))
        }
    }
}
