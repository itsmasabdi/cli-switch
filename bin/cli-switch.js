#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";
const PROGRAM = path.basename(process.argv[1] || "cli-switch");
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROVIDER_PATHS = {
  azure: [["configDir", "AZURE_CONFIG_DIR"]],
  claude: [["configDir", "CLAUDE_CONFIG_DIR"]],
  codex: [["home", "CODEX_HOME"]],
  gcloud: [
    ["configDir", "CLOUDSDK_CONFIG"],
    ["activeConfigName", "CLOUDSDK_ACTIVE_CONFIG_NAME"]
  ],
  github: [["configDir", "GH_CONFIG_DIR"]],
  aws: [["profile", "AWS_PROFILE"]],
  kubernetes: [["kubeconfig", "KUBECONFIG"]]
};

function main() {
  const [, , rawCommand, ...args] = process.argv;
  const command = rawCommand || "help";

  try {
    switch (command) {
      case "--help":
      case "-h":
      case "help":
        printHelp();
        return;
      case "--version":
      case "-v":
      case "version":
        console.log(VERSION);
        return;
      case "init":
        initConfig(args);
        return;
      case "list":
        listContexts();
        return;
      case "status":
        status(args);
        return;
      case "use":
        useContext(args);
        return;
      case "shell":
        printShell(args);
        return;
      case "run":
        runInContext(args);
        return;
      case "doctor":
        doctor(args);
        return;
      default:
        fail(`Unknown command: ${command}\nRun '${PROGRAM} help' for usage.`);
    }
  } catch (error) {
    if (error instanceof CliError) fail(error.message, error.exitCode);
    throw error;
  }
}

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function printHelp() {
  console.log(`cli-switch ${VERSION}

Usage:
  ${PROGRAM} init
  ${PROGRAM} list
  ${PROGRAM} status [context]
  ${PROGRAM} use <context>
  ${PROGRAM} shell [context]
  ${PROGRAM} run [context] -- <command> [args...]
  ${PROGRAM} doctor [context]

Environment:
  CLI_SWITCH_CONFIG      Override config path
  CLI_SWITCH_STATE_HOME  Override state root

Default files:
  ${configPath()}
  ${stateRoot()}
`);
}

function configPath() {
  if (process.env.CLI_SWITCH_CONFIG) return expandPath(process.env.CLI_SWITCH_CONFIG);
  const configHome = process.env.XDG_CONFIG_HOME
    ? expandPath(process.env.XDG_CONFIG_HOME)
    : path.join(os.homedir(), ".config");
  return path.join(configHome, "cli-switch", "config.json");
}

function stateRoot() {
  if (process.env.CLI_SWITCH_STATE_HOME) return expandPath(process.env.CLI_SWITCH_STATE_HOME);
  const stateHome = process.env.XDG_STATE_HOME
    ? expandPath(process.env.XDG_STATE_HOME)
    : path.join(os.homedir(), ".local", "state");
  return path.join(stateHome, "cli-switch");
}

function activeContextPath() {
  return path.join(stateRoot(), "active-context");
}

function initConfig(args) {
  if (args.length > 0) throw new CliError("Usage: cli-switch init");
  const target = configPath();
  if (fs.existsSync(target)) {
    throw new CliError(`Config already exists: ${target}`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.mkdirSync(stateRoot(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, `${JSON.stringify(exampleConfig(), null, 2)}\n`, { mode: 0o600 });
  console.log(`Created ${target}`);
  console.log("Edit it with your real external state paths, then run: cli-switch doctor");
}

function exampleConfig() {
  return {
    version: 1,
    contexts: {
      work: {
        description: "Work account",
        providers: {
          azure: {
            configDir: "~/.local/state/cli-switch/azure/work"
          }
        }
      },
      "client-a": {
        description: "Client A account",
        providers: {
          azure: {
            configDir: "~/.local/state/cli-switch/azure/client-a"
          }
        }
      },
      personal: {
        description: "Personal account",
        providers: {
          azure: {
            configDir: "~/.local/state/cli-switch/azure/personal"
          }
        }
      }
    }
  };
}

function loadConfig() {
  const target = configPath();
  if (!fs.existsSync(target)) {
    throw new CliError(`Missing config: ${target}\nRun '${PROGRAM} init' to create one.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    throw new CliError(`Could not parse ${target}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object" || !parsed.contexts || typeof parsed.contexts !== "object") {
    throw new CliError(`Invalid config: ${target}\nExpected an object with a 'contexts' map.`);
  }

  return parsed;
}

function listContexts() {
  const config = loadConfig();
  const names = Object.keys(config.contexts).sort();
  if (names.length === 0) {
    console.log("No contexts configured.");
    return;
  }

  const active = readActiveContext();
  for (const name of names) {
    const context = namedContext(config, name);
    const providers = Object.keys(context.providers || {}).sort().join(", ") || "none";
    const marker = name === active ? "*" : " ";
    const description = context.description ? ` - ${context.description}` : "";
    console.log(`${marker} ${name} [${providers}]${description}`);
  }
}

function status(args) {
  if (args.length > 1) throw new CliError("Usage: cli-switch status [context]");
  const config = loadConfig();
  const name = args[0] || readActiveContext();

  console.log(`Config: ${configPath()}`);
  console.log(`State:  ${stateRoot()}`);
  console.log(`Shell:  ${process.env.CLI_SWITCH_CONTEXT || "(no CLI_SWITCH_CONTEXT)"}`);

  if (!name) {
    console.log("Active: (none)");
    console.log(`Run '${PROGRAM} use <context>' or '${PROGRAM} status <context>'.`);
    return;
  }

  const context = namedContext(config, name);
  console.log(`Active: ${name}`);
  printProviderSummary(context);
}

function useContext(args) {
  if (args.length !== 1) throw new CliError("Usage: cli-switch use <context>");
  const config = loadConfig();
  const context = namedContext(config, args[0]);

  fs.mkdirSync(stateRoot(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(activeContextPath(), `${context.name}\n`, { mode: 0o600 });

  console.log(`Active context saved: ${context.name}`);
  console.log(`For this shell: eval "$(${PROGRAM} shell ${context.name})"`);
}

function printShell(args) {
  if (args.length > 1) throw new CliError("Usage: cli-switch shell [context]");
  const config = loadConfig();
  const name = args[0] || readActiveContext();
  if (!name) throw new CliError("No active context. Run 'cli-switch use <context>' or pass a context.");

  const context = namedContext(config, name);
  const env = envForContext(context);
  for (const [key, value] of Object.entries(env)) {
    if (value === null) console.log(`unset ${key}`);
    else console.log(`export ${key}=${shellQuote(value)}`);
  }
}

function runInContext(args) {
  if (args.length === 0) throw new CliError("Usage: cli-switch run [context] -- <command> [args...]");

  const config = loadConfig();
  let contextName;
  let commandStart;

  if (args[0] === "--") {
    contextName = readActiveContext();
    commandStart = 1;
  } else {
    contextName = args[0];
    commandStart = args[1] === "--" ? 2 : 1;
  }

  if (!contextName) throw new CliError("No active context. Pass a context or run 'cli-switch use <context>'.");
  const command = args.slice(commandStart);
  if (command.length === 0) throw new CliError("Usage: cli-switch run [context] -- <command> [args...]");

  const context = namedContext(config, contextName);
  const result = spawnSync(command[0], command.slice(1), {
    env: applyEnv(process.env, envForContext(context)),
    stdio: "inherit"
  });

  if (result.error) throw new CliError(result.error.message);
  process.exit(result.status ?? 1);
}

function doctor(args) {
  if (args.length > 1) throw new CliError("Usage: cli-switch doctor [context]");
  const config = loadConfig();
  const names = args[0] ? [args[0]] : Object.keys(config.contexts).sort();
  let failed = false;

  console.log(`Config: ${configPath()}`);
  console.log(`State:  ${stateRoot()}`);

  for (const name of names) {
    const context = namedContext(config, name);
    console.log(`\n${context.name}`);
    const env = envForContext(context);
    for (const [key, value] of Object.entries(env)) {
      console.log(`  ${key}=${formatEnvValue(value)}`);
    }

    const contextFailed = validateContext(context);
    failed = failed || contextFailed;
  }

  if (failed) throw new CliError("\nDoctor found issues.", 2);
}

function validateContext(context) {
  let failed = false;
  const providers = context.providers || {};

  for (const [providerName, entries] of Object.entries(PROVIDER_PATHS)) {
    const provider = providers[providerName];
    if (!provider) continue;

    for (const [field] of entries) {
      if (!provider[field]) continue;
      const value = expandPath(provider[field]);
      if (isFilesystemField(field)) {
        const issue = validateExternalPath(value);
        if (issue) {
          failed = true;
          console.log(`  ! ${providerName}.${field}: ${issue}`);
        } else {
          console.log(`  ok ${providerName}.${field}`);
        }
      }
    }
  }

  if (providers.azure) {
    const azureStatus = getAzureStatus(envForContext(context));
    if (azureStatus.ok) {
      const account = azureStatus.account;
      console.log(`  ok azure.account: ${account.user?.name || "(unknown user)"}`);
      console.log(`  ok azure.subscription: ${account.name || "(unknown subscription)"}`);
      if (account.tenantId) console.log(`  ok azure.tenant: ${account.tenantId}`);
    } else {
      failed = true;
      console.log(`  ! azure.status: ${azureStatus.message}`);
    }
  }

  if (providers.codex) {
    const codexStatus = getCodexStatus(envForContext(context));
    if (codexStatus.ok) {
      console.log(`  ok codex.login: ${codexStatus.message}`);
    } else {
      failed = true;
      console.log(`  ! codex.login: ${codexStatus.message}`);
    }
  }

  if (providers.claude) {
    const claudeStatus = getClaudeStatus(envForContext(context));
    if (claudeStatus.ok) {
      console.log(`  ok claude.login: ${claudeStatus.message}`);
    } else {
      failed = true;
      console.log(`  ! claude.login: ${claudeStatus.message}`);
    }
  }

  return failed;
}

function printProviderSummary(context) {
  const providers = context.providers || {};
  if (Object.keys(providers).length === 0) {
    console.log("Providers: none");
    return;
  }

  console.log(`Providers: ${Object.keys(providers).sort().join(", ")}`);
  for (const [key, value] of Object.entries(envForContext(context))) {
    const current = process.env[key] || "";
    const marker = value === null ? (current ? "set in shell" : "current") : current === value ? "current" : "not in shell";
    console.log(`  ${key}=${formatEnvValue(value)} (${marker})`);
  }

  if (providers.azure) {
    const azureStatus = getAzureStatus(envForContext(context));
    if (azureStatus.ok) {
      const account = azureStatus.account;
      console.log(`  azure: ${account.name || "(unknown subscription)"} as ${account.user?.name || "(unknown user)"}`);
    } else {
      console.log(`  azure: ${azureStatus.message}`);
    }
  }

  if (providers.codex) {
    const codexStatus = getCodexStatus(envForContext(context));
    console.log(`  codex: ${codexStatus.message}`);
  }

  if (providers.claude) {
    const claudeStatus = getClaudeStatus(envForContext(context));
    console.log(`  claude: ${claudeStatus.message}`);
  }
}

function namedContext(config, name) {
  const context = config.contexts[name];
  if (!context) {
    const known = Object.keys(config.contexts).sort().join(", ") || "(none)";
    throw new CliError(`Unknown context: ${name}\nKnown contexts: ${known}`);
  }
  return {
    name,
    description: context.description || "",
    providers: context.providers || {}
  };
}

function readActiveContext() {
  const target = activeContextPath();
  if (!fs.existsSync(target)) return "";
  return fs.readFileSync(target, "utf8").trim();
}

function envForContext(context) {
  const env = {
    CLI_SWITCH_CONTEXT: context.name
  };
  const providers = context.providers || {};

  for (const [providerName, entries] of Object.entries(PROVIDER_PATHS)) {
    const provider = providers[providerName];
    if (!provider) continue;

    if (providerName === "claude" && provider.useDefault === true) {
      env.CLAUDE_CONFIG_DIR = null;
      continue;
    }

    for (const [field, envName] of entries) {
      if (!provider[field]) continue;
      env[envName] = shouldExpand(field) ? expandPath(provider[field]) : String(provider[field]);
    }
  }

  return env;
}

function getAzureStatus(envOverrides) {
  const result = spawnSync("az", ["account", "show", "--output", "json"], {
    env: applyEnv(process.env, envOverrides),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error) return { ok: false, message: result.error.message };
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    return { ok: false, message: stderr || `az exited with status ${result.status}` };
  }

  try {
    return { ok: true, account: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, message: `az returned invalid JSON: ${error.message}` };
  }
}

function getCodexStatus(envOverrides) {
  const result = spawnSync("codex", ["login", "status"], {
    env: applyEnv(process.env, envOverrides),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error) return { ok: false, message: result.error.message };

  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  const message = stdout || stderr || `codex exited with status ${result.status}`;
  return { ok: result.status === 0, message };
}

function getClaudeStatus(envOverrides) {
  const result = spawnSync("claude", ["auth", "status"], {
    env: applyEnv(process.env, envOverrides),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  if (result.error) return { ok: false, message: result.error.message };

  try {
    const status = JSON.parse(stdout || "{}");
    if (!status.loggedIn) return { ok: false, message: "Not logged in" };
    const details = [status.email, status.authMethod, status.subscriptionType].filter(Boolean).join(" / ");
    return { ok: true, message: details || "Logged in" };
  } catch {
    const message = stdout || stderr || `claude exited with status ${result.status}`;
    return { ok: result.status === 0, message };
  }
}

function applyEnv(baseEnv, overrides) {
  const env = { ...baseEnv };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value === null) delete env[key];
    else env[key] = value;
  }
  return env;
}

function validateExternalPath(value) {
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) return `missing path ${resolved}`;
  if (isInside(resolved, REPO_ROOT)) return `path is inside repo (${REPO_ROOT})`;
  return "";
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isFilesystemField(field) {
  return ["configDir", "home", "kubeconfig"].includes(field);
}

function shouldExpand(field) {
  return isFilesystemField(field);
}

function expandPath(value) {
  if (typeof value !== "string") return value;
  let expanded = value;
  if (expanded === "~") expanded = os.homedir();
  else if (expanded.startsWith("~/")) expanded = path.join(os.homedir(), expanded.slice(2));
  expanded = expanded.replace(/\$HOME\b/g, os.homedir());
  return path.resolve(expanded);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function redactPathIfNeeded(value) {
  return value.replace(os.homedir(), "~");
}

function formatEnvValue(value) {
  return value === null ? "(unset)" : redactPathIfNeeded(value);
}

main();
