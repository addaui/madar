//! The customizer: what a person may change about how Madar looks, and where that choice is kept.
//! A theme preset (a data plugin, `presets.json`) is a full token set; a person's overrides are sparse.
//! The Core only validates and stores them; the Face derives every shade and shadow (ADR 0028).

use crate::util::*;
use nuah_kernel::*;
use serde_json::{json, Map, Value};

pub const OVERRIDES: &str = "appearance.overrides";

enum Kind {
    Num(f64, f64),
    NumAuto(f64, f64),
    Choice(&'static [&'static str]),
    Color,
    Bool,
}

struct Tok {
    key: String,
    group: &'static str,
    kind: Kind,
    per_scheme: bool,
    basic: bool,
    en: String,
    ar: String,
}

const MATERIALS: &[&str] = &["flat", "hairline", "clay", "glass", "elite", "brutal", "terminal"];
const FONTS: &[&str] = &["system", "dm", "manrope", "grotesk", "plex", "mono", "serif", "round"];
const TEXTURES: &[&str] = &["none", "grain", "dots", "grid", "orbit"];
const CASES: &[&str] = &["none", "uppercase"];

pub const COLOUR_KEYS: [&str; 11] = ["bg", "side", "surface", "sunk", "text", "muted", "line", "primary", "accent", "warn", "ok"];
pub const SIG_KEYS: [&str; 18] = [
    "orbit", "glyph", "ids", "crop", "ruler", "keys", "prompt", "r_tier", "r_rail", "r_due", "r_mono", "r_hier", "r_harmony", "r_fill", "r_hover", "r_tint", "r_icons", "r_tabs",
];

fn tok(key: &str, group: &'static str, kind: Kind, en: &str, ar: &str) -> Tok {
    Tok { key: key.into(), group, kind, per_scheme: false, basic: false, en: en.into(), ar: ar.into() }
}

/// Every token a person may override, in the order the settings panel shows them.
fn tokens() -> Vec<Tok> {
    let mut v = vec![];
    for (k, en, ar, basic) in [
        ("primary", "Primary", "الأساسي", true), ("accent", "Accent", "التمييز", true), ("bg", "Background", "الخلفية", true), ("text", "Ink", "الحبر", true),
        ("side", "Sidebar", "الشريط الجانبي", false), ("surface", "Surface", "السطح", false), ("sunk", "Sunken", "الغائر", false), ("muted", "Muted text", "نص خافت", false),
        ("line", "Lines", "الخطوط", false), ("warn", "Warning", "تحذير", false), ("ok", "Success", "نجاح", false),
    ] {
        let mut t = tok(k, "colour", Kind::Color, en, ar);
        t.per_scheme = true;
        t.basic = basic;
        v.push(t);
    }
    v.push(tok("material", "shape", Kind::Choice(MATERIALS), "Material", "الخامة"));
    v.push(tok("r", "shape", Kind::Num(0.0, 40.0), "Surface radius", "تدوير الأسطح"));
    v.push(tok("rcard", "shape", Kind::NumAuto(0.0, 40.0), "Card radius", "تدوير البطاقات"));
    v.push(tok("rbtn", "shape", Kind::Num(0.0, 40.0), "Control radius (40 = pill)", "تدوير الأزرار (40 = حبة)"));
    v.push(tok("rchip", "shape", Kind::NumAuto(0.0, 40.0), "Chip radius", "تدوير الشارات"));
    v.push(tok("bw", "shape", Kind::Num(0.0, 4.0), "Border width", "سماكة الإطار"));
    v.push(tok("depth", "depth", Kind::Num(0.0, 100.0), "Shadow depth", "عمق الظل"));
    v.push(tok("blur", "depth", Kind::Num(0.0, 30.0), "Glass blur", "ضبابية الزجاج"));
    v.push(tok("alpha", "depth", Kind::Num(30.0, 100.0), "Glass opacity", "شفافية الزجاج"));
    v.push(tok("dpct", "space", Kind::Num(70.0, 130.0), "Density (%)", "الكثافة (٪)"));
    v.push(tok("gap", "space", Kind::Num(0.0, 28.0), "Section gap", "المسافة بين الأقسام"));
    v.push(tok("frame", "space", Kind::Num(0.0, 32.0), "Frame", "الهامش الخارجي"));
    v.push(tok("fs", "space", Kind::Num(12.0, 17.0), "Text size", "حجم النص"));
    v.push(tok("font", "type", Kind::Choice(FONTS), "Body font", "خط النص"));
    v.push(tok("head", "type", Kind::Choice(FONTS), "Heading font", "خط العناوين"));
    v.push(tok("hw", "type", Kind::Num(400.0, 800.0), "Heading weight", "وزن العناوين"));
    v.push(tok("tt", "type", Kind::Choice(CASES), "Label case", "حالة التسميات"));
    v.push(tok("texture", "texture", Kind::Choice(TEXTURES), "Backdrop", "الخلفية الزخرفية"));
    for (k, en, ar) in [
        ("orbit", "Orbit ring: subtask progress on avatars", "حلقة المدار: تقدم المهام الفرعية"), ("glyph", "Shape glyphs for status and priority", "رموز الحالة والأولوية"),
        ("ids", "Mono IDs like MDR-012", "معرّفات أحادية المسافة"), ("crop", "Crop marks on the selected card", "علامات القص على البطاقة المحددة"),
        ("ruler", "Ruler ticks on column heads", "علامات المسطرة"), ("keys", "Key caps for shortcuts", "أزرار الاختصارات"), ("prompt", "Prompt mark before titles", "علامة الأمر قبل العناوين"),
        ("r_tier", "Three glass tiers", "ثلاث طبقات زجاجية"), ("r_rail", "Accent rail on the selected card", "شريط التمييز على البطاقة المحددة"),
        ("r_due", "Relative due dates", "مواعيد نسبية"), ("r_mono", "Mono numerals", "أرقام أحادية المسافة"), ("r_hier", "Stronger type hierarchy", "تسلسل خطوط أقوى"),
        ("r_harmony", "Status colours matched to the accent", "ألوان الحالة متناسقة مع التمييز"), ("r_fill", "Full-height columns and add slot", "أعمدة كاملة الارتفاع"),
        ("r_hover", "Quick actions on hover", "إجراءات سريعة عند التمرير"), ("r_tint", "Neutrals tinted toward the accent", "محايدات بصبغة التمييز"),
        ("r_icons", "Icon-rail sidebar", "شريط جانبي بالأيقونات"), ("r_tabs", "Tabbed task pane", "لوحة مهمة بتبويبات"),
    ] {
        v.push(tok(&format!("sig.{k}"), "signature", Kind::Bool, en, ar));
    }
    v
}

fn is_hex(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// One value, checked against its token and made canonical.
fn check(t: &Tok, key: &str, v: &Value) -> Result<Value> {
    let bad = |why: &str| Err(Error::invalid(key, why));
    match &t.kind {
        Kind::Color => match v.as_str() {
            Some(s) if is_hex(s) => Ok(json!(s.to_ascii_lowercase())),
            _ => bad("must be a colour like #1a2b3c"),
        },
        Kind::Num(lo, hi) => match v.as_f64() {
            Some(n) if n >= *lo && n <= *hi => Ok(v.clone()),
            _ => bad(&format!("must be a number from {lo} to {hi}")),
        },
        Kind::NumAuto(lo, hi) => match v {
            Value::String(s) if s == "auto" => Ok(v.clone()),
            _ => match v.as_f64() {
                Some(n) if n >= *lo && n <= *hi => Ok(v.clone()),
                _ => bad(&format!("must be \"auto\" or a number from {lo} to {hi}")),
            },
        },
        Kind::Choice(list) => match v.as_str() {
            Some(s) if list.contains(&s) => Ok(v.clone()),
            _ => bad(&format!("must be one of: {}", list.join(", "))),
        },
        Kind::Bool => match v {
            Value::Bool(_) => Ok(v.clone()),
            Value::Number(n) if n.as_i64() == Some(0) || n.as_i64() == Some(1) => Ok(json!(n.as_i64() == Some(1))),
            _ => bad("must be true or false"),
        },
    }
}

/// Resolve `dark:accent` to the token `accent` (colours only) or a plain key to its token.
fn find<'a>(all: &'a [Tok], key: &str) -> Option<&'a Tok> {
    let (scheme, base) = match key.split_once(':') {
        Some((s @ ("light" | "dark"), b)) => (Some(s), b),
        _ => (None, key),
    };
    let t = all.iter().find(|t| t.key == base)?;
    if scheme.is_some() != t.per_scheme {
        return None;
    }
    Some(t)
}

/// Validate a person's overrides. Unknown keys are refused; a `null` value is not stored (it clears).
pub fn validate_overrides(input: &Value) -> Result<Map<String, Value>> {
    let all = tokens();
    let obj = input.as_object().ok_or_else(|| Error::invalid("overrides", "must be an object"))?;
    let mut out = Map::new();
    for (k, v) in obj {
        if v.is_null() {
            continue;
        }
        let Some(t) = find(&all, k) else { return Err(Error::invalid(k, "is not a theme token")) };
        out.insert(k.clone(), check(t, k, v)?);
    }
    Ok(out)
}

fn em(s: &str) -> bool {
    s == "0" || s.strip_suffix("em").is_some_and(|n| n.parse::<f64>().is_ok())
}

/// A theme preset must be complete: every colour, every token, every signature flag.
pub fn validate_preset(theme: &Value) -> Result<()> {
    let bad = |f: &str, why: &str| Err(Error::invalid(f, why));
    if theme["schema"] != "theme/1" {
        return bad("schema", "must be theme/1");
    }
    if !matches!(theme["scheme"].as_str(), Some("auto" | "light" | "dark")) {
        return bad("scheme", "must be auto, light or dark");
    }
    for scheme in ["light", "dark"] {
        for k in COLOUR_KEYS {
            if !theme[scheme][k].as_str().is_some_and(is_hex) {
                return bad(&format!("{scheme}.{k}"), "must be a colour like #1a2b3c");
            }
        }
        let sh = theme[scheme]["sh"].as_str().unwrap_or("");
        if sh.split(',').count() != 3 || !sh.split(',').all(|n| n.parse::<u8>().is_ok()) {
            return bad(&format!("{scheme}.sh"), "must be r,g,b");
        }
    }
    let all = tokens();
    for t in all.iter().filter(|t| !t.per_scheme && t.key != "dpct" && !t.key.starts_with("sig.")) {
        let v = &theme["tokens"][&t.key];
        if v.is_null() {
            return bad(&format!("tokens.{}", t.key), "is missing");
        }
        check(t, &format!("tokens.{}", t.key), v)?;
    }
    if !theme["tokens"]["d"].as_f64().is_some_and(|d| (0.6..=1.4).contains(&d)) {
        return bad("tokens.d", "must be a number from 0.6 to 1.4");
    }
    if !matches!(theme["tokens"]["bcol"].as_str(), Some("line" | "text" | "soft")) {
        return bad("tokens.bcol", "must be line, text or soft");
    }
    for k in ["hls", "ls"] {
        if !theme["tokens"][k].as_str().is_some_and(em) {
            return bad(&format!("tokens.{k}"), "must be 0 or a length in em, like .06em");
        }
    }
    for k in SIG_KEYS {
        if !theme["sig"][k].is_boolean() {
            return bad(&format!("sig.{k}"), "must be true or false");
        }
    }
    Ok(())
}

fn schema_items() -> Value {
    let items: Vec<Value> = tokens()
        .iter()
        .map(|t| {
            let mut it = json!({"key": t.key, "group": t.group, "per_scheme": t.per_scheme, "basic": t.basic, "label": {"en": t.en, "ar": t.ar}});
            match &t.kind {
                Kind::Color => it["type"] = json!("color"),
                Kind::Num(lo, hi) => {
                    it["type"] = json!("number");
                    it["min"] = json!(lo);
                    it["max"] = json!(hi);
                }
                Kind::NumAuto(lo, hi) => {
                    it["type"] = json!("number_or_auto");
                    it["min"] = json!(lo);
                    it["max"] = json!(hi);
                }
                Kind::Choice(c) => {
                    it["type"] = json!("choice");
                    it["choices"] = json!(c);
                }
                Kind::Bool => it["type"] = json!("bool"),
            }
            it
        })
        .collect();
    json!({
        "version": "theme/1",
        "groups": [
            {"id": "colour", "label": {"en": "Colour", "ar": "الألوان"}}, {"id": "shape", "label": {"en": "Material and shape", "ar": "الخامة والشكل"}},
            {"id": "depth", "label": {"en": "Depth", "ar": "العمق"}}, {"id": "space", "label": {"en": "Space", "ar": "المساحات"}},
            {"id": "type", "label": {"en": "Type", "ar": "الخطوط"}}, {"id": "texture", "label": {"en": "Texture", "ar": "الملمس"}},
            {"id": "signature", "label": {"en": "Signature elements and ideas", "ar": "العناصر المميزة"}}
        ],
        "items": items
    })
}

pub struct Appearance;
impl Plugin for Appearance {
    fn manifest(&self) -> Manifest {
        manifest(json!({
            "id": "appearance", "version": "0.1.0", "name": "Appearance", "namespaces": ["appearance"],
            "description": "The customizer: a person's own changes to a theme preset, checked against the token schema (ADR 0028)",
            "requires": {"capabilities": ["emit"]},
            "data": {"collections": [OVERRIDES], "version": 1},
            "events": {"appearance.changed": {}},
            "operations": {
                "appearance.schema": {"kind": "query", "description": "Every token a person may change, with its range or choices", "output": {"type":"object","required":["items"]}},
                "appearance.get": {"kind": "query", "description": "Your overrides of the theme preset", "output": {"type":"object","required":["overrides"]}},
                "appearance.save": {"kind": "command", "description": "Replace your overrides; every value is checked, nothing unknown is kept",
                    "input": {"type":"object","required":["overrides"],"properties":{"overrides":{"type":"object","maxProperties":120}},"additionalProperties":false},
                    "output": {"type":"object","required":["overrides"]}},
                "appearance.reset": {"kind": "command", "description": "Drop all your overrides and return to the preset", "output": {"type":"object","required":["overrides"]}}
            }
        }))
    }
    fn bind(&self, b: &mut Bindings) {
        b.op("appearance.schema", |_tx, _| Ok(schema_items()));
        b.op("appearance.get", |tx, _| {
            let me = tx.who().subject.clone();
            let body = tx.get(OVERRIDES, &me)?.map(|d| d.body).unwrap_or(json!({}));
            // a stored token that no longer validates (the schema changed) is dropped on read
            let kept = validate_overrides(&body["overrides"]).unwrap_or_default();
            Ok(json!({"overrides": kept}))
        });
        b.op("appearance.save", |tx, i| {
            let me = tx.who().subject.clone();
            let kept = validate_overrides(&i["overrides"])?;
            let cur = tx.get(OVERRIDES, &me)?;
            tx.put(OVERRIDES, &me, json!({"overrides": kept}), cur.map(|d| Expect::Rev(d.rev)).unwrap_or(Expect::Absent))?;
            let out = json!({"overrides": kept});
            tx.emit("appearance.changed", Audience::subject(&me), out.clone())?;
            Ok(out)
        });
        b.op("appearance.reset", |tx, _| {
            let me = tx.who().subject.clone();
            let cur = tx.get(OVERRIDES, &me)?;
            tx.put(OVERRIDES, &me, json!({"overrides": {}}), cur.map(|d| Expect::Rev(d.rev)).unwrap_or(Expect::Absent))?;
            let out = json!({"overrides": {}});
            tx.emit("appearance.changed", Audience::subject(&me), out.clone())?;
            Ok(out)
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_preset_is_complete_and_valid() {
        let all: Vec<Value> = serde_json::from_str(include_str!("presets.json")).unwrap();
        assert!(all.len() >= 9);
        assert_eq!(all[0]["id"], "phantom-onyx", "the default preset comes first");
        for p in &all {
            validate_preset(&p["theme"]).unwrap_or_else(|e| panic!("{}: {e:?}", p["id"]));
        }
    }

    #[test]
    fn overrides_are_checked() {
        let ok = validate_overrides(&json!({"r": 5, "rcard": "auto", "dark:accent": "#D9D9D9", "sig.r_rail": 1, "material": "glass", "gap": null})).unwrap();
        assert_eq!(ok["dark:accent"], "#d9d9d9");
        assert_eq!(ok["sig.r_rail"], true);
        assert!(!ok.contains_key("gap"), "null clears");
        for bad in [
            json!({"r": 41}), json!({"r": "5"}), json!({"nope": 1}), json!({"accent": "#fff"}), json!({"dark:r": 3}), json!({"dark:accent": "red"}),
            json!({"material": "neon"}), json!({"font": "Comic Sans"}), json!({"sig.orbit": "yes"}), json!({"rcard": "big"}), json!("x"),
        ] {
            assert!(validate_overrides(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn colours_need_a_scheme_and_other_tokens_must_not_have_one() {
        assert!(validate_overrides(&json!({"accent": "#aabbcc"})).is_err());
        assert!(validate_overrides(&json!({"light:accent": "#aabbcc", "dark:bg": "#000000"})).is_ok());
    }
}
