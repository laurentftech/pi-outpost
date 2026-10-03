/**
 * The timeline: version 3's one addition, judged the way every document is.
 *
 * Three questions, in the order a producer meets them. Does version 3 leave every
 * earlier document alone? Is a timeline's shape held to the schema, with refusals
 * that name the property at fault? And are the rules a schema cannot state — real
 * days, ordered ranges, items inside the range, dependencies that resolve and do
 * not loop — enforced, while a dependency the dates merely fail to honour is not?
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { checkStructuredExchangeSchemaInBrowser } from "@pi-outpost/shared/structured-exchange/schema-browser";
import { timelineFacts, timelineTextLines } from "@pi-outpost/shared/structured-exchange/timeline";
import {
  STRUCTURED_EXCHANGE_CEILINGS_3,
  STRUCTURED_EXCHANGE_SCHEMA_V2,
  STRUCTURED_EXCHANGE_SCHEMA_V3,
} from "@pi-outpost/shared/structured-exchange";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SUITE = path.join(ROOT, "shared/conformance");

/* eslint-disable @typescript-eslint/no-explicit-any */
const programme = (): any =>
  JSON.parse(readFileSync(path.join(SUITE, "valid/v3-timeline-programme.json"), "utf8"));

const verdict = (document: unknown) => parseStructuredExchange(document, checkStructuredExchangeSchema);
const issuesOf = (document: unknown) => {
  const result = verdict(document);
  return result.valid ? [] : result.issues;
};
const rulesOf = (document: unknown) => issuesOf(document).map((issue) => `${issue.rule} ${issue.path}`);

describe("TimelineOpensVersionThree", () => {
  test("the programme example is a valid version 3 timeline, in Node and in the browser", () => {
    assert.equal(programme().schema, STRUCTURED_EXCHANGE_SCHEMA_V3);
    assert.deepEqual(rulesOf(programme()), []);
    assert.deepEqual(checkStructuredExchangeSchemaInBrowser(programme()), []);
  });

  test("EarlierVersionsDoNotAcquireTheTimeline", () => {
    for (const schema of ["urn:structured-exchange:1", STRUCTURED_EXCHANGE_SCHEMA_V2]) {
      const document = { ...programme(), schema };
      assert.ok(checkStructuredExchangeSchema(document).length > 0, `${schema} accepted a timeline`);
      assert.ok(checkStructuredExchangeSchemaInBrowser(document).length > 0, `${schema} accepted a timeline in the browser`);
    }
  });

  test("AVersionTwoDocumentMeansTheSameUnderVersionThree", () => {
    const index = JSON.parse(readFileSync(path.join(SUITE, "index.json"), "utf8")) as {
      valid: { file: string }[];
      invalid: { file: string }[];
    };
    let compared = 0;
    for (const { file } of [...index.valid, ...index.invalid]) {
      const document = JSON.parse(readFileSync(path.join(SUITE, file), "utf8"));
      // A timeline under version 2 is the one document version 3 is meant to change.
      if (document.schema !== STRUCTURED_EXCHANGE_SCHEMA_V2 || document.kind === "timeline") continue;
      const before = verdict(document);
      const after = verdict({ ...document, schema: STRUCTURED_EXCHANGE_SCHEMA_V3 });
      assert.equal(after.valid, before.valid, `${file} changed verdict under version 3`);
      if (before.valid && after.valid) {
        // Same meaning: everything but the identifier survives validation identically.
        assert.deepEqual({ ...after.envelope, schema: undefined }, { ...before.envelope, schema: undefined }, file);
      } else if (!before.valid && !after.valid) {
        assert.deepEqual(
          after.issues.map((issue) => `${issue.rule} ${issue.path}`),
          before.issues.map((issue) => `${issue.rule} ${issue.path}`),
          `${file} is refused differently under version 3`,
        );
      }
      compared += 1;
    }
    assert.ok(compared >= 10, `only ${compared} version 2 cases were compared`);
  });

  test("a version 3 graph is still proposable, and keeps the enriched byte ceiling", () => {
    const graph = {
      schema: STRUCTURED_EXCHANGE_SCHEMA_V3,
      kind: "graph",
      target: { ref: "MODEL-1" },
      data: { nodes: [{ id: "a", ref: "A", set: { label: "Renamed" } }], edges: [] },
    };
    assert.deepEqual(rulesOf(graph), []);
  });

  test("the ceilings in code are the schema's", () => {
    const schema = JSON.parse(readFileSync(path.join(ROOT, "shared/schemas/structured-exchange-3.json"), "utf8"));
    const timeline = schema.properties.data.oneOf.find((variant: any) => variant.properties.time !== undefined);
    assert.equal(timeline.properties.rows.maxItems, STRUCTURED_EXCHANGE_CEILINGS_3.timelineRows);
    assert.equal(timeline.properties.dependencies.maxItems, STRUCTURED_EXCHANGE_CEILINGS_3.dependencies);
    assert.equal(schema.$defs.timelineTask.properties.items.maxItems, STRUCTURED_EXCHANGE_CEILINGS_3.itemsPerTask);
  });
});

describe("ATimelineDeclaresCalendarRowsAndItems", () => {
  test("ATaskHoldsSeveralDiscontinuousActivitiesAndMilestones", () => {
    const result = verdict(programme());
    assert.equal(result.valid, true);
    const task = (result as any).envelope.data.rows[1];
    assert.equal(task.items.filter((item: any) => item.type === "activity").length, 2);
    assert.equal(task.items.filter((item: any) => item.type === "milestone").length, 3);
  });

  test("AnEmptyTaskIsValid", () => {
    const document = programme();
    document.data.rows = [{ type: "task", id: "T", label: "Nothing yet", items: [] }];
    document.data.dependencies = [];
    assert.deepEqual(rulesOf(document), []);
  });

  test("AnAnonymousSeparatorIsValid", () => {
    const document = programme();
    document.data.rows.push({ type: "separator" });
    assert.deepEqual(rulesOf(document), []);
  });

  test("PresentationDataIsRefused", () => {
    const document = programme();
    document.data.rows[1].items[0].color = "#ff0000";
    document.data.rows[1].items[1].x = 472;
    const issues = issuesOf(document);
    assert.deepEqual(issues.map((issue) => issue.path).sort(), ["/data/rows/1/items/0/color", "/data/rows/1/items/1/x"]);
    // The refusal speaks about the timeline, never about a graph nobody sent.
    assert.ok(issues.every((issue) => !/nodes|participants|columns/.test(issue.message)), JSON.stringify(issues));
  });

  test("a separator carrying dates is refused", () => {
    const document = programme();
    document.data.rows[0].start = "2027-01-01";
    assert.deepEqual(rulesOf(document), ["schema/additionalProperties /data/rows/0/start"]);
  });

  test("AnUnsupportedScaleIsRefused", () => {
    const document = programme();
    document.data.time.scale = "day";
    const issues = issuesOf(document);
    assert.deepEqual(issues.map((issue) => `${issue.rule} ${issue.path}`), ["schema/enum /data/time/scale"]);
    for (const supported of ["week", "month", "quarter"]) assert.match(issues[0].message, new RegExp(`"${supported}"`));
  });

  test("EveryScaleIsValid", () => {
    const at = (scale: string) => {
      const document = programme();
      document.data.time.scale = scale;
      assert.deepEqual(issuesOf(document), [], scale);
      assert.deepEqual(checkStructuredExchangeSchemaInBrowser(document), [], `${scale} in the browser`);
      return document.data;
    };
    const facts = (scale: string) => JSON.stringify(timelineFacts(at(scale)));
    const text = (scale: string) => timelineTextLines(at(scale)).join("\n").replace(`by ${scale}`, "by <scale>");
    for (const scale of ["week", "quarter"]) {
      assert.equal(facts(scale), facts("month"));
      assert.equal(text(scale), text("month"));
    }
  });

  test("ATaskWithoutAnIdentifierIsRefused", () => {
    const withoutId = programme();
    delete withoutId.data.rows[2].id;
    withoutId.data.dependencies = [];
    assert.deepEqual(rulesOf(withoutId), ["schema/required /data/rows/2"]);
    assert.match(issuesOf(withoutId)[0].message, /\bid\b/);

    const withoutItems = programme();
    delete withoutItems.data.rows[2].items;
    withoutItems.data.dependencies = [];
    assert.deepEqual(rulesOf(withoutItems), ["schema/required /data/rows/2"]);
    assert.match(issuesOf(withoutItems)[0].message, /items/);
  });

  test("an unknown item type is refused at its type", () => {
    const document = programme();
    document.data.rows[1].items[1].type = "deadline";
    assert.deepEqual(rulesOf(document), ["schema/enum /data/rows/1/items/1/type"]);
  });
});

describe("TimelineDatesAreCheckedAfterTheSchema", () => {
  test("AnImpossibleDateIsRefused", () => {
    const document = programme();
    document.data.rows[2].items[0].end = "2027-02-30";
    assert.deepEqual(rulesOf(document), ["invalid-date /data/rows/2/items/0/end"]);
  });

  test("a leap day is a real day only in a leap year", () => {
    const document = programme();
    document.data.rows[2].items[0].end = "2028-02-29";
    assert.deepEqual(rulesOf(document), []);
    document.data.rows[2].items[0].end = "2027-02-29";
    assert.deepEqual(rulesOf(document), ["invalid-date /data/rows/2/items/0/end"]);
  });

  test("AnInvertedActivityIsRefused", () => {
    const document = programme();
    document.data.rows[2].items[0].start = "2027-10-01";
    assert.deepEqual(rulesOf(document), ["inverted-range /data/rows/2/items/0"]);
  });

  test("AnInvertedTimeRangeIsRefused", () => {
    const document = programme();
    document.data.time = { start: "2028-03-31", end: "2026-10-01", scale: "month" };
    assert.deepEqual(rulesOf(document), ["inverted-range /data/time"]);
  });

  test("AnItemOutsideTheRangeIsRefused", () => {
    const late = programme();
    late.data.rows[1].items[4].date = "2028-04-01";
    const issues = issuesOf(late);
    assert.deepEqual(issues.map((issue) => `${issue.rule} ${issue.path}`), ["item-outside-range /data/rows/1/items/4"]);
    assert.match(issues[0].message, /2026-10-01 to 2028-03-31/);

    const early = programme();
    early.data.rows[1].items[0].start = "2026-09-30";
    assert.deepEqual(rulesOf(early), ["item-outside-range /data/rows/1/items/0"]);
  });

  test("ASingleDayActivityIsValid", () => {
    const document = programme();
    document.data.rows[2].items.push({ type: "activity", start: "2027-04-01", end: "2027-04-01", label: "One day" });
    assert.deepEqual(rulesOf(document), []);
  });

  test("DuplicateIdentifiersAreRefused", () => {
    const tasks = programme();
    tasks.data.rows[4].id = "T1";
    tasks.data.dependencies = [];
    assert.deepEqual(rulesOf(tasks), ["duplicate-identifier /data/rows/4/id"]);

    const taskAndItem = programme();
    taskAndItem.data.rows[2].items[0].id = "T1";
    assert.deepEqual(rulesOf(taskAndItem), ["duplicate-identifier /data/rows/2/items/0/id"]);
  });
});

describe("ATimelineMayDeclareGanttDependencies", () => {
  test("ATimelineWithoutDependenciesIsValid", () => {
    const document = programme();
    delete document.data.dependencies;
    assert.deepEqual(rulesOf(document), []);
  });

  test("ADependencyLinksAMilestoneToATask", () => {
    const result = verdict(programme());
    assert.equal(result.valid, true);
    // Declared without a type; read as finish-to-start by every consumer.
    assert.deepEqual((result as any).envelope.data.dependencies[1], { from: "srr", to: "T2" });
  });

  test("AllFourGanttTypesAreAccepted", () => {
    const document = programme();
    document.data.dependencies = ["finish-to-start", "start-to-start", "finish-to-finish", "start-to-finish"].map(
      (type) => ({ from: "etude-preliminaire", to: "dev", type }),
    );
    assert.deepEqual(rulesOf(document), []);
  });

  test("AnUnknownDependencyTypeIsRefused", () => {
    const document = programme();
    document.data.dependencies[0].type = "lag";
    const issues = issuesOf(document);
    assert.deepEqual(issues.map((issue) => `${issue.rule} ${issue.path}`), ["schema/enum /data/dependencies/0/type"]);
    for (const type of ["finish-to-start", "start-to-start", "finish-to-finish", "start-to-finish"]) {
      assert.match(issues[0].message, new RegExp(type));
    }
  });

  test("AnUnresolvedEndpointIsRefused", () => {
    const document = programme();
    document.data.dependencies[0].to = "nowhere";
    assert.deepEqual(rulesOf(document), ["unresolved-endpoint /data/dependencies/0/to"]);
  });

  test("an unidentified item cannot be named", () => {
    // T3's activity carries no id, so nothing can point at it.
    const document = programme();
    document.data.dependencies.push({ from: "Étude", to: "T2" });
    assert.deepEqual(rulesOf(document), ["unresolved-endpoint /data/dependencies/4/from"]);
  });

  test("AnEmptyTaskCannotBeAnEndpoint", () => {
    const document = programme();
    document.data.dependencies.push({ from: "T4", to: "srr" });
    assert.deepEqual(rulesOf(document), ["empty-task-endpoint /data/dependencies/4/from"]);
  });

  test("ASelfDependencyIsRefused", () => {
    const ownItem = programme();
    ownItem.data.dependencies.push({ from: "T1", to: "pdr" });
    assert.deepEqual(rulesOf(ownItem), ["self-dependency /data/dependencies/4"]);

    const itself = programme();
    itself.data.dependencies.push({ from: "srr", to: "srr" });
    assert.deepEqual(rulesOf(itself), ["self-dependency /data/dependencies/4"]);
  });

  test("ADuplicateDependencyIsRefused", () => {
    const document = programme();
    document.data.dependencies.push({ from: "srr", to: "T2", type: "finish-to-start" });
    assert.deepEqual(rulesOf(document), ["duplicate-dependency /data/dependencies/4"]);
    // The same ends with another type is another dependency.
    document.data.dependencies[4].type = "start-to-start";
    assert.deepEqual(rulesOf(document), []);
  });

  test("ACycleIsRefused", () => {
    const document = programme();
    document.data.rows.push(
      { type: "task", id: "A", label: "A", items: [{ type: "milestone", date: "2027-01-01" }] },
      { type: "task", id: "B", label: "B", items: [{ type: "milestone", date: "2027-02-01" }] },
      { type: "task", id: "C", label: "C", items: [{ type: "milestone", date: "2027-03-01" }] },
    );
    document.data.dependencies.push({ from: "B", to: "A" }, { from: "C", to: "B" }, { from: "A", to: "C" });
    const issues = issuesOf(document);
    assert.deepEqual(issues.map((issue) => issue.rule), ["dependency-cycle"]);
    for (const id of ["A", "B", "C"]) assert.match(issues[0].message, new RegExp(`\\b${id}\\b`));
  });

  test("AnUnsatisfiedDependencyIsShownNotRefused (validation half)", () => {
    const document = programme();
    // dev starts on 2027-03-01; make CDR wait for it to finish, which it does not.
    document.data.dependencies.push({ from: "dev", to: "cdr" });
    assert.deepEqual(rulesOf(document), []);
  });
});

describe("ATimelineIsNotAProposal", () => {
  test("ATimelineWithATargetIsRefused", () => {
    const targeted = { ...programme(), target: { ref: "PLAN-1" } };
    const issues = issuesOf(targeted);
    assert.deepEqual(issues.map((issue) => `${issue.rule} ${issue.path}`), ["kind-not-proposable /target"]);
    assert.match(issues[0].message, /presenting the revised timeline/);

    const removing = { ...programme(), target: { ref: "PLAN-1" }, removals: [{ type: "element", ref: "T9" }] };
    assert.ok(rulesOf(removing).includes("kind-not-proposable /removals"));
  });

  test("ATimelineWithViewpointsIsRefused", () => {
    const document = {
      ...programme(),
      viewpoints: [{ id: "reviews", label: "Reviews", concern: "Gates", elementKinds: ["SRR"] }],
    };
    assert.deepEqual(rulesOf(document), ["viewpoints-without-graph /viewpoints"]);
  });
});

describe("ATimelineMayStateWhatItIsComparedWith", () => {
  const compared = () => {
    const document = programme();
    document.data.comparedTo = { label: "Plan of 1 September", date: "2026-09-01" };
    document.data.rows[1].items[2].previous = { start: "2027-03-01", end: "2027-06-30" };
    document.data.rows[1].items[4].role = "added";
    document.data.rows.push({ type: "task", id: "T9", label: "Dropped", role: "removed", items: [{ type: "milestone", id: "gone", date: "2027-04-01" }] });
    return document;
  };

  test("AComparedTimelineIsValid", () => {
    assert.deepEqual(rulesOf(compared()), []);
  });

  test("APlainTimelineIsUnchanged", () => {
    assert.deepEqual(rulesOf(programme()), []);
  });

  test("PreviousDatesFollowTheItemShape", () => {
    const document = compared();
    document.data.rows[1].items[1].previous = { start: "2027-02-01", end: "2027-02-02" };
    const issues = issuesOf(document);
    assert.ok(issues.length > 0);
    assert.ok(issues.every((issue) => issue.path.startsWith("/data/rows/1/items/1/previous")), JSON.stringify(issues));
  });
});

describe("ComparisonDataIsCheckedAfterTheSchema", () => {
  test("ComparisonWithoutReferenceIsRefused", () => {
    const document = programme();
    document.data.rows[1].items[1].previous = { date: "2027-02-01" };
    document.data.rows[2].role = "added";
    assert.deepEqual(rulesOf(document).sort(), [
      "comparison-without-reference /data/rows/1/items/1/previous",
      "comparison-without-reference /data/rows/2/role",
    ]);
  });

  test("AnAddedItemWithPreviousDatesIsRefused", () => {
    const document = programme();
    document.data.comparedTo = { label: "Before" };
    document.data.rows[1].items[1].role = "added";
    document.data.rows[1].items[1].previous = { date: "2027-02-01" };
    assert.deepEqual(rulesOf(document), ["contradictory-change /data/rows/1/items/1/previous"]);
  });

  test("an item removed inside an added task is contradictory", () => {
    const document = programme();
    document.data.comparedTo = { label: "Before" };
    document.data.rows[2].role = "added";
    document.data.rows[2].items[0].role = "removed";
    document.data.dependencies = [];
    assert.deepEqual(rulesOf(document), ["contradictory-change /data/rows/2/items/0/role"]);
  });

  test("previous dates are real days, in order", () => {
    const document = programme();
    document.data.comparedTo = { label: "Before" };
    document.data.rows[1].items[0].previous = { start: "2027-02-30", end: "2027-03-31" };
    document.data.rows[1].items[2].previous = { start: "2027-06-01", end: "2027-05-01" };
    assert.deepEqual(rulesOf(document).sort(), [
      "invalid-date /data/rows/1/items/0/previous/start",
      "inverted-range /data/rows/1/items/2/previous",
    ]);
  });

  test("PreviousDatesOutsideTheRangeAreRefused", () => {
    const document = programme();
    document.data.comparedTo = { label: "Before" };
    document.data.rows[1].items[0].previous = { start: "2026-09-01", end: "2027-02-28" };
    const issues = issuesOf(document);
    assert.deepEqual(issues.map((issue) => `${issue.rule} ${issue.path}`), ["item-outside-range /data/rows/1/items/0/previous"]);
    assert.match(issues[0].message, /covers both plans/);
  });

  test("ADependencyOnARemovedItemIsRefused", () => {
    const document = programme();
    document.data.comparedTo = { label: "Before" };
    document.data.rows[1].items[1].role = "removed";
    assert.deepEqual(rulesOf(document).sort(), [
      "dependency-on-removed /data/dependencies/0/to",
      "dependency-on-removed /data/dependencies/1/from",
    ]);
  });
});

describe("ATimelineMayDeclarePeriodsAndReferenceDates", () => {
  const withCalendar = () => {
    const document = programme();
    document.data.periods = [
      { start: "2026-12-21", end: "2027-01-03", label: "Fermeture de fin d'année", kind: "fermeture" },
      { start: "2027-08-02", end: "2027-08-22", label: "Congés d'été", kind: "vacances" },
    ];
    document.data.references = [{ date: "2027-06-30", label: "Livraison contractuelle", kind: "contrat" }];
    return document;
  };

  test("PeriodsAndReferencesAreValid", () => {
    assert.deepEqual(rulesOf(withCalendar()), []);
  });

  test("APeriodRunningPastTheEdgeIsValid", () => {
    const document = withCalendar();
    document.data.periods[0] = { start: "2026-09-15", end: "2026-10-10" };
    assert.deepEqual(rulesOf(document), []);
  });

  test("APeriodWhollyOutsideIsRefused", () => {
    const document = withCalendar();
    document.data.periods[1] = { start: "2026-08-01", end: "2026-09-30" };
    assert.deepEqual(rulesOf(document), ["period-outside-range /data/periods/1"]);
  });

  test("AnInvertedPeriodIsRefused", () => {
    const document = withCalendar();
    document.data.periods[1] = { start: "2027-08-22", end: "2027-08-02" };
    assert.deepEqual(rulesOf(document), ["inverted-range /data/periods/1"]);
  });

  test("AReferenceOutsideTheRangeIsRefused", () => {
    const document = withCalendar();
    document.data.references[0].date = "2028-04-01";
    assert.deepEqual(rulesOf(document), ["item-outside-range /data/references/0"]);
  });

  test("a period's or reference's impossible day is refused", () => {
    const document = withCalendar();
    document.data.periods[0].end = "2027-02-30";
    document.data.references[0].date = "2027-06-31";
    assert.deepEqual(rulesOf(document).sort(), ["invalid-date /data/periods/0/end", "invalid-date /data/references/0/date"]);
  });

  test("AnItemInsideAPeriodIsValid", () => {
    // Étude préliminaire runs through the year-end closure.
    assert.deepEqual(rulesOf(withCalendar()), []);
  });

  test("a reference needs a label, and neither carries presentation", () => {
    const unlabelled = withCalendar();
    delete unlabelled.data.references[0].label;
    assert.ok(rulesOf(unlabelled).some((rule) => rule.startsWith("schema/required /data/references/0")));
    const coloured = withCalendar();
    coloured.data.periods[0].color = "#eee";
    assert.deepEqual(rulesOf(coloured), ["schema/additionalProperties /data/periods/0/color"]);
  });
});
