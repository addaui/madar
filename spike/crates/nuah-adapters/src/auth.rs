//! Auth adapters. `auth-local` is the single-user "no login" mode; `auth-token` maps bearer
//! tokens to identities. Replacing one with the other is a distribution change, not a code change.

use nuah_kernel::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

struct Local {
    display: String,
}
impl Auth for Local {
    fn id(&self) -> &str {
        "auth-local"
    }
    fn authenticate(&self, _credential: Option<&str>) -> Result<Identity> {
        Ok(Identity { subject: "local-user".into(), display: self.display.clone(), roles: vec!["admin".into()] })
    }
    fn signin(&self) -> Value {
        json!({"kind": "none"})
    }
}

pub struct AuthLocalPlugin;
impl Plugin for AuthLocalPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(r#"{"id":"auth-local","version":"0.1.0", "description":"One local user, no sign-in.","implements":[{"port":"auth"}],"quality":"reference","settings_schema":{"type":"object","properties":{"display":{"type":"string","minLength":1}}}}"#)
    }
    fn activate(&self, act: &mut Activation) -> Result<()> {
        let display = act.settings().get("display").and_then(|d| d.as_str()).unwrap_or("Me").to_string();
        act.provide_auth(Arc::new(Local { display }));
        Ok(())
    }
}

struct Token {
    tokens: HashMap<String, Identity>,
}
impl Auth for Token {
    fn id(&self) -> &str {
        "auth-token"
    }
    fn authenticate(&self, credential: Option<&str>) -> Result<Identity> {
        let Some(t) = credential.filter(|c| !c.is_empty()) else {
            return Err(LinkError::unauthenticated("a token is required"));
        };
        self.tokens.get(t).cloned().ok_or_else(|| LinkError::unauthenticated("unknown token"))
    }
    fn signin(&self) -> Value {
        json!({
            "kind": "token",
            "title": "Sign in",
            "fields": [{"name": "token", "label": "Access token", "secret": true}],
            "help": "Ask whoever runs this instance for a token."
        })
    }
}

pub struct AuthTokenPlugin;
impl Plugin for AuthTokenPlugin {
    fn manifest(&self) -> Manifest {
        Manifest::parse(r#"{"id":"auth-token","version":"0.1.0", "description":"Sign in with an access token.","implements":[{"port":"auth"}],"quality":"reference","settings_schema":{"type":"object","required":["tokens"],"properties":{"tokens":{"type":"object","additionalProperties":{"type":"object","required":["subject"],"properties":{"subject":{"type":"string","minLength":1}}}}}}}"#)
    }
    /// Settings: {"tokens": {"<token>": {"subject": "...", "display": "...", "roles": ["admin"]}}}
    fn activate(&self, act: &mut Activation) -> Result<()> {
        let Some(map) = act.settings().get("tokens").and_then(|t| t.as_object()) else {
            return Err(LinkError::internal("setting `tokens` is required"));
        };
        let mut tokens = HashMap::new();
        for (tok, who) in map {
            let subject = who.get("subject").and_then(|s| s.as_str()).ok_or_else(|| LinkError::internal("each token needs a subject"))?;
            let roles = who
                .get("roles")
                .and_then(|r| r.as_array())
                .map(|r| r.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_else(|| vec!["member".to_string()]);
            tokens.insert(
                tok.clone(),
                Identity {
                    subject: subject.to_string(),
                    display: who.get("display").and_then(|d| d.as_str()).unwrap_or(subject).to_string(),
                    roles,
                },
            );
        }
        act.provide_auth(Arc::new(Token { tokens }));
        Ok(())
    }
}
