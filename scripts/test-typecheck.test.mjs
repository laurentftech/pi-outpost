/**
 * Test sources are type-checked (openspec/changes/typecheck-test-suites): every
 * TypeScript test CI runs is in a configuration `npm run typecheck` runs, an ill-typed
 * test fails it, a new test file is covered without editing a list, and no test may
 * silence the checker.
 *
 * Probe files are written into the real suite directories — the point is that the real
 * configuration picks them up — and always removed. Each positive check has its negative
 * control: the same probe under a configuration that excludes it must go unreported,
 * so a pass cannot come from somewhere else.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, test } from "node:test";
import { ROOT, SUITES, trackedFiles, tsc, uncheckedFiles } from "./test-typecheck-suites.mjs";

const OXLINT = path.join(path.dirname(createRequire(import.meta.url).resolve("oxlint/package.json")), "bin", "oxlint");

/** Write `content` at a repository-relative path for the length of `work`. */
function withFile(relPath, content, work) {
  const full = path.join(ROOT, relPath);
  writeFileSync(full, content);
  try {
    return work();
  } finally {
    rmSync(full, { force: true });
  }
}

/** A configuration beside the suite's own, extending it with one more exclusion. */
function withExclusion(suite, excluded, work) {
  const dir = path.dirname(suite.config);
  const probeConfig = `${dir}/tsconfig.probe-${process.pid}.json`;
  const base = JSON.parse(readFileSync(path.join(ROOT, suite.config), "utf8"));
  const relative = path.posix.relative(dir, excluded);
  return withFile(probeConfig, JSON.stringify({ extends: `./${path.basename(suite.config)}`, include: base.include, exclude: [...(base.exclude ?? []), relative] }), () => work(probeConfig));
}

const probeName = (suite, tag) => `${suite.probeDir}/zz-typecheck-probe-${tag}-${process.pid}${suite.probeSuffix}`;

describe("type-checked test suites", () => {
  for (const suite of SUITES) {
    describe(suite.name, () => {
      test("EveryRunTestFileIsChecked: no tracked test source is missing from its configuration", () => {
        const tracked = trackedFiles(suite);
        assert.ok(tracked.length > 0, `${suite.name} tracks no test file: the pathspecs are wrong`);
        assert.deepEqual(uncheckedFiles(suite), []);
      });

      test("…and the comparison does notice a file a configuration leaves out", () => {
        const [first] = trackedFiles(suite);
        withExclusion(suite, first, (config) => assert.deepEqual(uncheckedFiles(suite, config), [first]));
      });

      test("an ill-typed new test file fails the suite's check without any configuration edit", () => {
        const probe = probeName(suite, "ill");
        withFile(probe, 'const count: number = "not a number";\nexport { count };\n', () => {
          const { status, output } = tsc(["-p", suite.config, "--pretty", "false"]);
          assert.notEqual(status, 0);
          assert.ok(output.includes(path.basename(probe)), `the error names the probe:\n${output.slice(0, 2000)}`);
          // Negative control: the same probe, excluded, goes unreported.
          withExclusion(suite, probe, (config) => {
            const excluded = tsc(["-p", config, "--pretty", "false"]);
            assert.ok(!excluded.output.includes(path.basename(probe)), "an excluded probe must not be reported");
          });
        });
      });

      test("the suite's configuration is what `npm run typecheck` runs", () => {
        const manifest = JSON.parse(readFileSync(path.join(ROOT, suite.script.packageJson), "utf8"));
        assert.ok(manifest.scripts?.typecheck?.includes(suite.script.typecheck), `${suite.script.packageJson} typecheck runs \`${suite.script.typecheck}\``);
        const root = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
        assert.match(root.scripts.typecheck, /npm run typecheck --workspaces --if-present/);
      });
    });
  }
});

describe("silencing the type checker in a test", () => {
  const root = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  /** What `npm run lint:test-comments` runs, run directly so it spawns on every platform. */
  const lintTestComments = (files) => {
    const args = root.scripts["lint:test-comments"].replace(/^oxlint\s+/, "").split(/\s+/).filter((arg) => !["ui/src", "server/test", "e2e"].includes(arg));
    const result = spawnSync(process.execPath, [OXLINT, ...args, ...files], { cwd: ROOT, encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };

  test("the root `lint` runs the test-comment check, over every suite's directory", () => {
    assert.match(root.scripts.lint, /npm run lint:test-comments/);
    for (const dir of ["ui/src", "server/test", "e2e"]) assert.ok(root.scripts["lint:test-comments"].includes(dir), dir);
  });

  test("IgnoreCommentInTestIsRefused: `@ts-ignore` and `@ts-nocheck` fail the lint and are named", () => {
    for (const suite of SUITES) {
      const probe = probeName(suite, "ignore");
      withFile(probe, '// @ts-ignore\nconst count: number = "x";\nexport { count };\n', () => {
        const { status, output } = lintTestComments([probe]);
        assert.notEqual(status, 0, suite.name);
        assert.match(output, /ban-ts-comment/);
        assert.ok(output.includes(path.basename(probe)), output);
      });
    }
    const probe = probeName(SUITES[1], "nocheck");
    withFile(probe, '// @ts-nocheck\nconst count: number = "x";\nexport { count };\n', () => assert.notEqual(lintTestComments([probe]).status, 0));
  });

  test("UnexplainedExpectErrorIsRefused, while a described one is allowed", () => {
    const bare = probeName(SUITES[1], "bare");
    withFile(bare, '// @ts-expect-error\nconst count: number = "x";\nexport { count };\n', () => {
      const { status, output } = lintTestComments([bare]);
      assert.notEqual(status, 0);
      assert.match(output, /Include a description after the @ts-expect-error directive/);
    });
    const described = probeName(SUITES[1], "described");
    withFile(described, '// @ts-expect-error -- deliberately the wrong type, to exercise runtime validation\nconst count: number = "x";\nexport { count };\n', () => {
      assert.equal(lintTestComments([described]).status, 0);
    });
  });
});
