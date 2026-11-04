//! Deterministic simulation: the same random sequence of operations runs against two complete
//! cores that differ only in the db adapter. Every answer, every error and the whole event log
//! must match. This catches differences the db conformance suite does not think of.

use nuah_kernel::*;
use nuah_madar::*;
use serde_json::{json, Value};

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn pick<'a, T>(&mut self, v: &'a [T]) -> Option<&'a T> {
        if v.is_empty() { None } else { Some(&v[self.below(v.len())]) }
    }
}

fn sqlite_core() -> Core {
    let mut d = memory_for_tests();
    for e in d.enabled.iter_mut() {
        if e == "adapter-memory" {
            *e = "adapter-sqlite".into();
        }
    }
    d.settings.insert("adapter-sqlite".into(), json!({"path": ":memory:"}));
    start(d).unwrap()
}

fn run(core: &Core, seed: u64, steps: usize) -> Vec<Value> {
    let mut rng = Rng(seed);
    let words = ["Milk", "paint", "Tap", "ROOF", "tax", "9", "100% done", "under_score", "Ünïcode", "x"];
    let (mut projects, mut tasks, mut comments): (Vec<String>, Vec<String>, Vec<String>) = (vec![], vec![], vec![]);
    let mut log = vec![];
    for _ in 0..steps {
        let (op, input) = match rng.below(12) {
            0 => ("projects.create", json!({"name": format!("P{}", rng.below(5))})),
            1 | 2 | 3 => match rng.pick(&projects) {
                Some(p) => ("tasks.create", json!({"project_id": p, "title": format!("{} {}", rng.pick(&words).unwrap(), rng.pick(&words).unwrap()),
                    "priority": rng.below(12) as i64 - 1, "status": rng.pick(&["Backlog", "Planning", "Done", "Nope"]).unwrap(),
                    "due": rng.pick(&[json!("2026-05-06"), json!(null), json!("2026-02-30")]).unwrap().clone()})),
                None => continue,
            },
            4 | 5 => match rng.pick(&tasks) {
                Some(t) => ("tasks.update", match rng.below(4) {
                    0 => json!({"id": t, "status": rng.pick(&["Backlog", "In Progress", "Done"]).unwrap()}),
                    1 => json!({"id": t, "priority": rng.below(11)}),
                    2 => json!({"id": t, "title": rng.pick(&words).unwrap()}),
                    _ => json!({"id": t, "due": "2027-01-01"}),
                }),
                None => continue,
            },
            6 => match rng.pick(&tasks) { Some(t) => ("tasks.delete", json!({"id": t})), None => continue },
            7 | 8 => match rng.pick(&tasks) {
                Some(t) => {
                    let mut i = json!({"task_id": t, "text": rng.pick(&words).unwrap()});
                    if rng.below(2) == 0 {
                        if let Some(c) = rng.pick(&comments) { i["parent_id"] = json!(c); }
                    }
                    ("comments.add", i)
                }
                None => continue,
            },
            9 => match rng.pick(&comments) { Some(c) => ("comments.delete", json!({"id": c})), None => continue },
            10 => ("tasks.list", {
                let mut i = json!({});
                if rng.below(2) == 0 { i["q"] = json!(rng.pick(&words).unwrap()); }
                if rng.below(2) == 0 { i["status"] = json!(rng.pick(&["Backlog", "Planning", "Done"]).unwrap()); }
                if rng.below(3) == 0 { if let Some(p) = rng.pick(&projects) { i["project_id"] = json!(p); } }
                i
            }),
            _ => if rng.below(2) == 0 { ("projects.list", json!({})) } else { ("audit.list", json!({"limit": 20})) },
        };
        let result = core.call(CallRequest { op: op.into(), input: input.clone(), ..Default::default() });
        if let Ok(r) = &result {
            let id = r.data["id"].as_str().map(String::from);
            match (op, id) {
                ("projects.create", Some(id)) => projects.push(id),
                ("tasks.create", Some(id)) => tasks.push(id),
                ("comments.add", Some(id)) => comments.push(id),
                ("tasks.delete", Some(id)) => { tasks.retain(|t| *t != id); comments.clear(); }
                ("comments.delete", Some(id)) => comments.retain(|c| *c != id),
                _ => {}
            }
        }
        log.push(json!({"op": op, "input": input, "result": match result { Ok(r) => r.data, Err(e) => json!({"error": e}) }}));
    }
    log.push(json!({"events": core.events_since("local-user", 0, 100_000).unwrap()}));
    log
}

#[test]
fn memory_and_sqlite_cores_agree_on_random_sessions() {
    for seed in [1u64, 7, 42, 2026, 99_991] {
        let a = run(&start(memory_for_tests()).unwrap(), seed, 400);
        let b = run(&sqlite_core(), seed, 400);
        assert_eq!(a.len(), b.len());
        for (i, (x, y)) in a.iter().zip(&b).enumerate() {
            assert_eq!(x, y, "seed {seed}, step {i}: the two adapters diverged");
        }
        let ok = a.iter().filter(|s| s["result"].get("error").is_none() && s["result"] != Value::Null).count();
        assert!(ok > 100, "seed {seed}: the simulation should mostly make progress (only {ok} ok steps)");
    }
}
