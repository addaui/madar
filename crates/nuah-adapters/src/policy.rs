//! Policy adapters. Permissions look like `tasks.read`. A role grants patterns:
//! "*" (everything), "tasks.*" (a whole domain), "*.read" (one verb everywhere), or an exact name.

use nuah_kernel::*;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

struct AllowAll;
impl Policy for AllowAll {
    fn id(&self) -> &str {
        "policy-allow-all"
    }
    fn check(&self, _who: &Identity, _permission: &str) -> bool {
        true
    }
}

pub struct PolicyAllowPlugin;
impl Plugin for PolicyAllowPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(r#"{"id":"policy-allow-all","version":"0.1.0", "description":"Lets every signed-in caller do everything. For single-user and test setups.","kind":"adapter","implements":[{"port":"policy"}],"quality":"reference"}"#)
    }
    fn activate(&self, act: &mut Activation) -> Result<()> {
        act.provide_policy(Arc::new(AllowAll));
        Ok(())
    }
}

pub fn permission_matches(pattern: &str, permission: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some(suffix) = pattern.strip_prefix("*.") {
        return permission.ends_with(&format!(".{suffix}"));
    }
    if let Some(prefix) = pattern.strip_suffix(".*") {
        return permission.starts_with(&format!("{prefix}."));
    }
    pattern == permission
}

struct Roles {
    roles: HashMap<String, Vec<String>>,
}
impl Policy for Roles {
    fn id(&self) -> &str {
        "policy-roles"
    }
    fn check(&self, who: &Identity, permission: &str) -> bool {
        who.roles
            .iter()
            .filter_map(|r| self.roles.get(r))
            .any(|patterns| patterns.iter().any(|p| permission_matches(p, permission)))
    }
}

pub struct PolicyRolesPlugin;
impl Plugin for PolicyRolesPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(r#"{"id":"policy-roles","version":"0.1.0", "description":"Grants permissions by role (owner, member, viewer).","kind":"adapter","implements":[{"port":"policy"}],"quality":"reference","settings_schema":{"type":"object","properties":{"roles":{"type":"object"}}}}"#)
    }
    /// Settings: {"roles": {"viewer": ["*.read"]}} replaces the defaults for the named roles.
    fn activate(&self, act: &mut Activation) -> Result<()> {
        let mut roles: HashMap<String, Vec<String>> = HashMap::new();
        let mut put = |name: &str, p: &[&str]| {
            roles.insert(name.to_string(), p.iter().map(|s| s.to_string()).collect());
        };
        put("owner", &["*"]);
        put("member", &["tasks.*", "prefs.*", "audit.read"]);
        put("viewer", &["*.read", "prefs.write"]);
        if let Some(Value::Object(custom)) = act.settings().get("roles") {
            for (name, list) in custom {
                let patterns: Vec<String> =
                    list.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
                roles.insert(name.clone(), patterns);
            }
        }
        act.provide_policy(Arc::new(Roles { roles }));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn patterns() {
        assert!(permission_matches("*", "tasks.write"));
        assert!(permission_matches("*.read", "tasks.read"));
        assert!(!permission_matches("*.read", "tasks.write"));
        assert!(permission_matches("tasks.*", "tasks.write"));
        assert!(!permission_matches("tasks.*", "tasksx.write"));
        assert!(permission_matches("audit.read", "audit.read"));
    }
}
