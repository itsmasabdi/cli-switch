import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const bin = path.resolve("bin", "cli-switch.js");

function run(args, env = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: path.resolve("."),
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

test("prints help", () => {
  const result = run(["help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test("lists contexts from an external config", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-switch-"));
  const state = path.join(tmp, "state");
  const config = path.join(tmp, "config.json");
  fs.mkdirSync(path.join(state, "azure", "work"), { recursive: true });
  fs.writeFileSync(
    config,
    JSON.stringify({
      version: 1,
      contexts: {
        work: {
          description: "Work account",
          providers: {
            azure: {
              configDir: path.join(state, "azure", "work")
            }
          }
        }
      }
    })
  );

  const result = run(["list"], {
    CLI_SWITCH_CONFIG: config,
    CLI_SWITCH_STATE_HOME: state
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /work \[azure\]/);
});

test("prints shell exports for a context", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-switch-"));
  const state = path.join(tmp, "state");
  const config = path.join(tmp, "config.json");
  fs.mkdirSync(path.join(state, "azure", "work"), { recursive: true });
  fs.writeFileSync(
    config,
    JSON.stringify({
      version: 1,
      contexts: {
        work: {
          providers: {
            azure: {
              configDir: path.join(state, "azure", "work")
            }
          }
        }
      }
    })
  );

  const result = run(["shell", "work"], {
    CLI_SWITCH_CONFIG: config,
    CLI_SWITCH_STATE_HOME: state
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /export CLI_SWITCH_CONTEXT='work'/);
  assert.match(result.stdout, /export AZURE_CONFIG_DIR='/);
});

test("prints shell unset for default Claude context", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-switch-"));
  const state = path.join(tmp, "state");
  const config = path.join(tmp, "config.json");
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(
    config,
    JSON.stringify({
      version: 1,
      contexts: {
        "claude-current": {
          providers: {
            claude: {
              useDefault: true
            }
          }
        }
      }
    })
  );

  const result = run(["shell", "claude-current"], {
    CLI_SWITCH_CONFIG: config,
    CLI_SWITCH_STATE_HOME: state
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /export CLI_SWITCH_CONTEXT='claude-current'/);
  assert.match(result.stdout, /unset CLAUDE_CONFIG_DIR/);
});
