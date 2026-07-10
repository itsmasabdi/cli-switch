# CLI Switch

> **⚠️ Superseded by [credctx](https://github.com/itsmasabdi/credctx).**
> This repo was the prototype. credctx is the clean rebuild: composable identity
> contexts (accounts × contexts × folder bindings), automatic switching on `cd`,
> complete environment hygiene, and live identity verification. This prototype is
> kept for reference and is not maintained.

Switch cloud and AI CLI contexts without storing credentials in project repos.

CLI Switch keeps source code, examples, and tests in this repo. Real provider auth state stays outside the repo, normally under `~/.local/state/cli-switch`, and the local context map stays under `~/.config/cli-switch/config.json`.

## Commands

Install from this checkout:

```sh
npm link
```

```sh
cli-switch list
cli-switch status [context]
cli-switch use <context>
cli-switch shell [context]
cli-switch run [context] -- <command> [args...]
cli-switch doctor [context]
```

The safest command for agents and one-off terminals is `run`:

```sh
cli-switch run work -- az account show -o table
```

That executes the command with the selected provider environment variables without depending on shell state.

For an interactive shell:

```sh
eval "$(cli-switch shell work)"
```

## Config

The default config path is:

```sh
~/.config/cli-switch/config.json
```

Example:

```json
{
  "version": 1,
  "contexts": {
    "work": {
      "description": "Work account",
      "providers": {
        "azure": {
          "configDir": "~/.local/state/cli-switch/azure/work"
        },
        "claude": {
          "configDir": "~/.local/state/cli-switch/claude/work"
        },
        "codex": {
          "home": "~/.local/state/cli-switch/codex/work"
        }
      }
    }
  }
}
```

## Providers

Current provider environment mapping:

| Provider | Config field | Environment variable |
| --- | --- | --- |
| Azure CLI | `azure.configDir` | `AZURE_CONFIG_DIR` |
| Claude Code | `claude.configDir` | `CLAUDE_CONFIG_DIR` |
| Claude Code | `claude.useDefault` | unsets `CLAUDE_CONFIG_DIR` |
| Codex CLI | `codex.home` | `CODEX_HOME` |
| Google Cloud SDK | `gcloud.configDir` | `CLOUDSDK_CONFIG` |
| Google Cloud SDK | `gcloud.activeConfigName` | `CLOUDSDK_ACTIVE_CONFIG_NAME` |
| GitHub CLI | `github.configDir` | `GH_CONFIG_DIR` |
| AWS CLI | `aws.profile` | `AWS_PROFILE` |
| kubectl | `kubernetes.kubeconfig` | `KUBECONFIG` |

## Credential Safety

Do not copy provider auth directories into this repo. Keep them under external state paths such as:

```sh
~/.local/state/cli-switch/azure/work
~/.local/state/cli-switch/claude/work
~/.local/state/cli-switch/codex/work
```

The repo `.gitignore` blocks common auth files and provider config directories as a second line of defense, but the primary rule is simpler: credentials never belong in the repo.

Claude Code can bind its current login to the default home and macOS Keychain. For that case, use:

```json
{
  "providers": {
    "claude": {
      "useDefault": true
    }
  }
}
```

That explicitly unsets `CLAUDE_CONFIG_DIR` for the command instead of copying a live Claude profile.
