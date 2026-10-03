/**
 * GENERATED from shared/schemas/structured-exchange-3.json — do not edit.
 *
 * Regenerate with:
 *   node --import tsx/esm shared/scripts/generate-structured-exchange-check.mjs
 *
 * A boolean check of the published schema, small enough to ship to the browser.
 * Diagnostics live in the Node-side validator; see structuredExchangeSchemaNode.ts.
 */
/* eslint-disable */
// @ts-nocheck
import { Hashing } from "typebox/system"
import { Format } from "typebox/format"
import { Guard } from "typebox/guard"

// @ts-ignore
let External = []

// @ts-ignore
export function SetExternal(external) { External = external.variables }

// @ts-ignore
const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (((("schema" in value && "kind" in value) && "data" in value) && Object.getOwnPropertyNames(value).every((var_81, var_82) => (External[0].test(var_81) || false))) && (((((((value.schema === "urn:structured-exchange:3" && (((value.kind === "graph" || value.kind === "sequence") || value.kind === "table") || value.kind === "timeline")) && (value.profile === undefined || (!("profile" in value) || (typeof value.profile === "string" && (Guard.IsMaxLength(value.profile, 200) && Guard.IsMinLength(value.profile, 1)))))) && (value.target === undefined || (!("target" in value) || ((typeof value.target === "object" && value.target !== null && !(Array.isArray(value.target))) && (("ref" in value.target && Object.getOwnPropertyNames(value.target).every((var_83, var_84) => (External[1].test(var_83) || false))) && (check_1(value.target.ref) && (value.target.revision === undefined || (!("revision" in value.target) || check_2(value.target.revision))))))))) && (value.removals === undefined || (!("removals" in value) || (Array.isArray(value.removals) && (value.removals.every((element, index) => check_3(element)) && value.removals.length <= 500))))) && (value.artifacts === undefined || (!("artifacts" in value) || (Array.isArray(value.artifacts) && (value.artifacts.every((element, index) => check_7(element)) && value.artifacts.length <= 50))))) && (value.viewpoints === undefined || (!("viewpoints" in value) || (Array.isArray(value.viewpoints) && (value.viewpoints.every((element, index) => check_8(element)) && value.viewpoints.length <= 20))))) && [((typeof value.data === "object" && value.data !== null && !(Array.isArray(value.data))) && ((("nodes" in value.data && "edges" in value.data) && Object.getOwnPropertyNames(value.data).every((var_92, var_93) => (External[6].test(var_92) || false))) && (((Array.isArray(value.data.nodes) && ((value.data.nodes.every((element, index) => check_9(element)) && value.data.nodes.length <= 500) && value.data.nodes.length >= 1)) && (Array.isArray(value.data.edges) && (value.data.edges.every((element, index) => check_21(element)) && value.data.edges.length <= 2000))) && (value.data.containers === undefined || (!("containers" in value.data) || (Array.isArray(value.data.containers) && (value.data.containers.every((element, index) => check_23(element)) && value.data.containers.length <= 50))))))), ((typeof value.data === "object" && value.data !== null && !(Array.isArray(value.data))) && ((("participants" in value.data && "messages" in value.data) && Object.getOwnPropertyNames(value.data).every((var_116, var_117) => (External[16].test(var_116) || false))) && (((Array.isArray(value.data.participants) && ((value.data.participants.every((element, index) => check_9(element)) && value.data.participants.length <= 100) && value.data.participants.length >= 1)) && (Array.isArray(value.data.messages) && (value.data.messages.every((element, index) => check_24(element)) && value.data.messages.length <= 1000))) && (value.data.containers === undefined || (!("containers" in value.data) || (Array.isArray(value.data.containers) && (value.data.containers.every((element, index) => check_23(element)) && value.data.containers.length <= 50))))))), ((typeof value.data === "object" && value.data !== null && !(Array.isArray(value.data))) && ((("columns" in value.data && "rows" in value.data) && Object.getOwnPropertyNames(value.data).every((var_122, var_123) => (External[19].test(var_122) || false))) && (((Array.isArray(value.data.columns) && ((value.data.columns.every((element, index) => (typeof element === "string" && (Guard.IsMaxLength(element, 200) && Guard.IsMinLength(element, 1)))) && value.data.columns.length <= 50) && value.data.columns.length >= 1)) && (Array.isArray(value.data.rows) && (value.data.rows.every((element, index) => [check_26(element), check_27(element), check_30(element)].reduce((result, var_124, _) => (var_124 === true) ? ++result : result, 0) === 1) && value.data.rows.length <= 5000))) && (value.data.relations === undefined || (!("relations" in value.data) || (Array.isArray(value.data.relations) && (value.data.relations.every((element, index) => check_31(element)) && value.data.relations.length <= 2000))))))), ((typeof value.data === "object" && value.data !== null && !(Array.isArray(value.data))) && ((("time" in value.data && "rows" in value.data) && Object.getOwnPropertyNames(value.data).every((var_136, var_137) => (External[25].test(var_136) || false))) && (((((value.data.title === undefined || (!("title" in value.data) || check_4(value.data.title))) && ((typeof value.data.time === "object" && value.data.time !== null && !(Array.isArray(value.data.time))) && (((("start" in value.data.time && "end" in value.data.time) && "scale" in value.data.time) && Object.getOwnPropertyNames(value.data.time).length === 3) && ((check_33(value.data.time.start) && check_33(value.data.time.end)) && value.data.time.scale === "month")))) && (Array.isArray(value.data.rows) && (value.data.rows.every((element, index) => check_34(element)) && value.data.rows.length <= 500))) && (value.data.dependencies === undefined || (!("dependencies" in value.data) || (Array.isArray(value.data.dependencies) && (value.data.dependencies.every((element, index) => check_41(element)) && value.data.dependencies.length <= 2000))))) && (value.data.comparedTo === undefined || (!("comparedTo" in value.data) || ((typeof value.data.comparedTo === "object" && value.data.comparedTo !== null && !(Array.isArray(value.data.comparedTo))) && (("label" in value.data.comparedTo && Object.getOwnPropertyNames(value.data.comparedTo).every((var_148, var_149) => (External[32].test(var_148) || false))) && ((typeof value.data.comparedTo.label === "string" && (Guard.IsMaxLength(value.data.comparedTo.label, 500) && Guard.IsMinLength(value.data.comparedTo.label, 1))) && (value.data.comparedTo.date === undefined || (!("date" in value.data.comparedTo) || check_33(value.data.comparedTo.date)))))))))))].reduce((result, var_91, _) => (var_91 === true) ? ++result : result, 0) === 1))));

// @ts-ignore
const check_1 = ((value) => (typeof value === "string" && (Guard.IsMaxLength(value, 200) && Guard.IsMinLength(value, 1))));

// @ts-ignore
const check_2 = ((value) => (typeof value === "string" && (Guard.IsMaxLength(value, 200) && Guard.IsMinLength(value, 1))));

// @ts-ignore
const check_3 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((("type" in value && "ref" in value) && Object.getOwnPropertyNames(value).every((var_85, var_86) => (External[2].test(var_85) || false))) && (((((((value.type === "element" || value.type === "relationship") || value.type === "row") && check_1(value.ref)) && (value.label === undefined || (!("label" in value) || check_4(value.label)))) && (value.kind === undefined || (!("kind" in value) || check_5(value.kind)))) && (value.from === undefined || (!("from" in value) || check_6(value.from)))) && (value.to === undefined || (!("to" in value) || check_6(value.to)))))));

// @ts-ignore
const check_4 = ((value) => (typeof value === "string" && Guard.IsMaxLength(value, 500)));

// @ts-ignore
const check_5 = ((value) => (typeof value === "string" && (Guard.IsMaxLength(value, 100) && Guard.IsMinLength(value, 1))));

// @ts-ignore
const check_6 = ((value) => (typeof value === "string" && (Guard.IsMaxLength(value, 200) && Guard.IsMinLength(value, 1))));

// @ts-ignore
const check_7 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (((("rel" in value && "uri" in value) && "sha256" in value) && Object.getOwnPropertyNames(value).every((var_87, var_88) => (External[3].test(var_87) || false))) && (((((typeof value.rel === "string" && (Guard.IsMaxLength(value.rel, 100) && Guard.IsMinLength(value.rel, 1))) && (typeof value.uri === "string" && (Guard.IsMaxLength(value.uri, 2000) && Guard.IsMinLength(value.uri, 1)))) && (typeof value.sha256 === "string" && External[4].test(value.sha256))) && (value.mediaType === undefined || (!("mediaType" in value) || (typeof value.mediaType === "string" && (Guard.IsMaxLength(value.mediaType, 100) && Guard.IsMinLength(value.mediaType, 1)))))) && (value.label === undefined || (!("label" in value) || check_4(value.label)))))));

// @ts-ignore
const check_8 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (((("id" in value && "label" in value) && "concern" in value) && Object.getOwnPropertyNames(value).every((var_89, var_90) => (External[5].test(var_89) || false))) && ((((check_6(value.id) && (typeof value.label === "string" && (Guard.IsMaxLength(value.label, 500) && Guard.IsMinLength(value.label, 1)))) && (typeof value.concern === "string" && (Guard.IsMaxLength(value.concern, 500) && Guard.IsMinLength(value.concern, 1)))) && (value.elementKinds === undefined || (!("elementKinds" in value) || (Array.isArray(value.elementKinds) && (((value.elementKinds.every((element, index) => check_5(element)) && value.elementKinds.length <= 64) && value.elementKinds.length >= 1) && new Set(value.elementKinds.map(Hashing.Hash)).size === value.elementKinds.length))))) && (value.relationshipKinds === undefined || (!("relationshipKinds" in value) || (Array.isArray(value.relationshipKinds) && (((value.relationshipKinds.every((element, index) => check_5(element)) && value.relationshipKinds.length <= 64) && value.relationshipKinds.length >= 1) && new Set(value.relationshipKinds.map(Hashing.Hash)).size === value.relationshipKinds.length))))))));

// @ts-ignore
const check_9 = ((value) => (((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("id" in value && Object.getOwnPropertyNames(value).every((var_94, var_95) => (External[7].test(var_94) || false))) && (((((((((check_6(value.id) && (value.ref === undefined || (!("ref" in value) || check_1(value.ref)))) && (value.label === undefined || (!("label" in value) || check_4(value.label)))) && (value.kind === undefined || (!("kind" in value) || check_5(value.kind)))) && (value.set === undefined || (!("set" in value) || check_10(value.set)))) && (value.container === undefined || (!("container" in value) || check_6(value.container)))) && (value.attributes === undefined || (!("attributes" in value) || check_11(value.attributes)))) && (value.expect === undefined || (!("expect" in value) || check_16(value.expect)))) && (value.locations === undefined || (!("locations" in value) || check_17(value.locations)))) && (value.artifacts === undefined || (!("artifacts" in value) || check_20(value.artifacts)))))) && (!((!((typeof value === "object" && value !== null && !(Array.isArray(value)))) || "ref" in value)) ? (!((typeof value === "object" && value !== null && !(Array.isArray(value)))) || "label" in value) : true)));

// @ts-ignore
const check_10 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((Object.getOwnPropertyNames(value).every((var_96, var_97) => (External[8].test(var_96) || false)) && (((((value.label === undefined || (!("label" in value) || check_4(value.label))) && (value.kind === undefined || (!("kind" in value) || check_5(value.kind)))) && (value.container === undefined || (!("container" in value) || check_6(value.container)))) && (value.attributes === undefined || (!("attributes" in value) || check_11(value.attributes)))) && (value.removeAttributes === undefined || (!("removeAttributes" in value) || check_15(value.removeAttributes))))) && Object.getOwnPropertyNames(value).length >= 1)));

// @ts-ignore
const check_11 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((Object.getOwnPropertyNames(value).every((var_98, var_99) => (External[9].test(var_98) || check_12(value[var_98]))) && Object.getOwnPropertyNames(value).every((var_102, var_103) => (!(typeof var_102 === "string") || (Guard.IsMaxLength(var_102, 200) && Guard.IsMinLength(var_102, 1))))) && Object.getOwnPropertyNames(value).length <= 50)));

// @ts-ignore
const check_12 = ((value) => [check_13(value), check_14(value), (Array.isArray(value) && (value.every((element, index) => [check_13(element), check_14(element)].reduce((result, var_101, _) => (var_101 === true) ? ++result : result, 0) === 1) && value.length <= 50))].reduce((result, var_100, _) => (var_100 === true) ? ++result : result, 0) === 1);

// @ts-ignore
const check_13 = ((value) => ((((typeof value === "string" || Number.isFinite(value)) || typeof value === "boolean") || value === null) && (!(typeof value === "string") || Guard.IsMaxLength(value, 1000))));

// @ts-ignore
const check_14 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("ref" in value && Object.getOwnPropertyNames(value).length === 1) && check_1(value.ref))));

// @ts-ignore
const check_15 = ((value) => (Array.isArray(value) && (value.every((element, index) => check_6(element)) && value.length <= 50)));

// @ts-ignore
const check_16 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((Object.getOwnPropertyNames(value).every((var_104, var_105) => (External[10].test(var_104) || false)) && (((((value.label === undefined || (!("label" in value) || check_4(value.label))) && (value.kind === undefined || (!("kind" in value) || check_5(value.kind)))) && (value.container === undefined || (!("container" in value) || check_6(value.container)))) && (value.revision === undefined || (!("revision" in value) || check_2(value.revision)))) && (value.attributes === undefined || (!("attributes" in value) || check_11(value.attributes))))) && Object.getOwnPropertyNames(value).length >= 1)));

// @ts-ignore
const check_17 = ((value) => (Array.isArray(value) && (value.every((element, index) => check_18(element)) && value.length <= 10)));

// @ts-ignore
const check_18 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("uri" in value && Object.getOwnPropertyNames(value).every((var_106, var_107) => (External[11].test(var_106) || false))) && (((typeof value.uri === "string" && (Guard.IsMaxLength(value.uri, 2000) && Guard.IsMinLength(value.uri, 1))) && (value.revision === undefined || (!("revision" in value) || check_2(value.revision)))) && (value.range === undefined || (!("range" in value) || ((typeof value.range === "object" && value.range !== null && !(Array.isArray(value.range))) && ((("startLine" in value.range && "endLine" in value.range) && Object.getOwnPropertyNames(value.range).every((var_108, var_109) => (External[12].test(var_108) || false))) && (((check_19(value.range.startLine) && (value.range.startCharacter === undefined || (!("startCharacter" in value.range) || check_19(value.range.startCharacter)))) && check_19(value.range.endLine)) && (value.range.endCharacter === undefined || (!("endCharacter" in value.range) || check_19(value.range.endCharacter))))))))))));

// @ts-ignore
const check_19 = ((value) => (Number.isInteger(value) && (!((Number.isFinite(value) || typeof value === "bigint")) || (value <= 1000000 && value >= 0))));

// @ts-ignore
const check_20 = ((value) => (Array.isArray(value) && (value.every((element, index) => check_7(element)) && value.length <= 20)));

// @ts-ignore
const check_21 = ((value) => (((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((("from" in value && "to" in value) && Object.getOwnPropertyNames(value).every((var_110, var_111) => (External[13].test(var_110) || false))) && (((((((((check_6(value.from) && check_6(value.to)) && (value.kind === undefined || (!("kind" in value) || check_5(value.kind)))) && (value.ref === undefined || (!("ref" in value) || check_1(value.ref)))) && (value.label === undefined || (!("label" in value) || check_4(value.label)))) && (value.set === undefined || (!("set" in value) || check_22(value.set)))) && (value.attributes === undefined || (!("attributes" in value) || check_11(value.attributes)))) && (value.expect === undefined || (!("expect" in value) || check_16(value.expect)))) && (value.locations === undefined || (!("locations" in value) || check_17(value.locations)))) && (value.artifacts === undefined || (!("artifacts" in value) || check_20(value.artifacts)))))) && (!((!((typeof value === "object" && value !== null && !(Array.isArray(value)))) || "ref" in value)) ? (!((typeof value === "object" && value !== null && !(Array.isArray(value)))) || "kind" in value) : true)));

// @ts-ignore
const check_22 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((Object.getOwnPropertyNames(value).every((var_112, var_113) => (External[14].test(var_112) || false)) && ((((value.kind === undefined || (!("kind" in value) || check_5(value.kind))) && (value.label === undefined || (!("label" in value) || check_4(value.label)))) && (value.attributes === undefined || (!("attributes" in value) || check_11(value.attributes)))) && (value.removeAttributes === undefined || (!("removeAttributes" in value) || check_15(value.removeAttributes))))) && Object.getOwnPropertyNames(value).length >= 1)));

// @ts-ignore
const check_23 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((("id" in value && "label" in value) && Object.getOwnPropertyNames(value).every((var_114, var_115) => (External[15].test(var_114) || false))) && ((check_6(value.id) && check_4(value.label)) && (value.kind === undefined || (!("kind" in value) || check_5(value.kind)))))));

// @ts-ignore
const check_24 = ((value) => (((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((("from" in value && "to" in value) && Object.getOwnPropertyNames(value).every((var_118, var_119) => (External[17].test(var_118) || false))) && ((((((((check_6(value.from) && check_6(value.to)) && (value.ref === undefined || (!("ref" in value) || check_1(value.ref)))) && (value.label === undefined || (!("label" in value) || check_4(value.label)))) && (value.set === undefined || (!("set" in value) || check_25(value.set)))) && (value.attributes === undefined || (!("attributes" in value) || check_11(value.attributes)))) && (value.expect === undefined || (!("expect" in value) || check_16(value.expect)))) && (value.locations === undefined || (!("locations" in value) || check_17(value.locations)))) && (value.artifacts === undefined || (!("artifacts" in value) || check_20(value.artifacts)))))) && (!((!((typeof value === "object" && value !== null && !(Array.isArray(value)))) || "ref" in value)) ? (!((typeof value === "object" && value !== null && !(Array.isArray(value)))) || "label" in value) : true)));

// @ts-ignore
const check_25 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((Object.getOwnPropertyNames(value).every((var_120, var_121) => (External[18].test(var_120) || false)) && (((value.label === undefined || (!("label" in value) || check_4(value.label))) && (value.attributes === undefined || (!("attributes" in value) || check_11(value.attributes)))) && (value.removeAttributes === undefined || (!("removeAttributes" in value) || check_15(value.removeAttributes))))) && Object.getOwnPropertyNames(value).length >= 1)));

// @ts-ignore
const check_26 = ((value) => (Array.isArray(value) && (value.every((element, index) => ((((typeof element === "string" || Number.isFinite(element)) || typeof element === "boolean") || element === null) && (!(typeof element === "string") || Guard.IsMaxLength(element, 1000)))) && value.length <= 50)));

// @ts-ignore
const check_27 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("cells" in value && Object.getOwnPropertyNames(value).every((var_125, var_126) => (External[20].test(var_125) || false))) && ((((((((((check_26(value.cells) && (value.role === undefined || (!("role" in value) || check_28(value.role)))) && (value.id === undefined || (!("id" in value) || check_6(value.id)))) && (value.ref === undefined || (!("ref" in value) || check_1(value.ref)))) && (value.kind === undefined || (!("kind" in value) || check_5(value.kind)))) && (value.label === undefined || (!("label" in value) || check_4(value.label)))) && (value.set === undefined || (!("set" in value) || check_29(value.set)))) && (value.attributes === undefined || (!("attributes" in value) || check_11(value.attributes)))) && (value.expect === undefined || (!("expect" in value) || check_16(value.expect)))) && (value.locations === undefined || (!("locations" in value) || check_17(value.locations)))) && (value.artifacts === undefined || (!("artifacts" in value) || check_20(value.artifacts)))))));

// @ts-ignore
const check_28 = ((value) => (((value === "added" || value === "changed") || value === "context") || value === "removed"));

// @ts-ignore
const check_29 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((Object.getOwnPropertyNames(value).every((var_127, var_128) => (External[21].test(var_127) || false)) && (((((value.label === undefined || (!("label" in value) || check_4(value.label))) && (value.kind === undefined || (!("kind" in value) || check_5(value.kind)))) && (value.cells === undefined || (!("cells" in value) || check_26(value.cells)))) && (value.attributes === undefined || (!("attributes" in value) || check_11(value.attributes)))) && (value.removeAttributes === undefined || (!("removeAttributes" in value) || check_15(value.removeAttributes))))) && Object.getOwnPropertyNames(value).length >= 1)));

// @ts-ignore
const check_30 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("heading" in value && Object.getOwnPropertyNames(value).every((var_129, var_130) => (External[22].test(var_129) || false))) && (((((typeof value.heading === "string" && (Guard.IsMaxLength(value.heading, 500) && Guard.IsMinLength(value.heading, 1))) && (value.depth === undefined || (!("depth" in value) || (Number.isInteger(value.depth) && (!((Number.isFinite(value.depth) || typeof value.depth === "bigint")) || (value.depth <= 6 && value.depth >= 1)))))) && (value.role === undefined || (!("role" in value) || check_28(value.role)))) && (value.id === undefined || (!("id" in value) || check_6(value.id)))) && (value.ref === undefined || (!("ref" in value) || check_1(value.ref)))))));

// @ts-ignore
const check_31 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (((("from" in value && "to" in value) && "kind" in value) && Object.getOwnPropertyNames(value).every((var_131, var_132) => (External[23].test(var_131) || false))) && (((((check_32(value.from) && check_32(value.to)) && check_5(value.kind)) && (value.ref === undefined || (!("ref" in value) || check_1(value.ref)))) && (value.label === undefined || (!("label" in value) || check_4(value.label)))) && (value.attributes === undefined || (!("attributes" in value) || check_11(value.attributes)))))));

// @ts-ignore
const check_32 = ((value) => (((typeof value === "object" && value !== null && !(Array.isArray(value))) && (((Object.getOwnPropertyNames(value).every((var_133, var_134) => (External[24].test(var_133) || false)) && ((value.id === undefined || (!("id" in value) || check_6(value.id))) && (value.ref === undefined || (!("ref" in value) || check_1(value.ref))))) && Object.getOwnPropertyNames(value).length >= 1) && Object.getOwnPropertyNames(value).length <= 1)) && [(!((typeof value === "object" && value !== null && !(Array.isArray(value)))) || "id" in value), (!((typeof value === "object" && value !== null && !(Array.isArray(value)))) || "ref" in value)].reduce((result, var_135, _) => (var_135 === true) ? ++result : result, 0) === 1));

// @ts-ignore
const check_33 = ((value) => (typeof value === "string" && External[26].test(value)));

// @ts-ignore
const check_34 = ((value) => (((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("type" in value && (value.type === "task" || value.type === "separator"))) && (((!((typeof value === "object" && value !== null && !(Array.isArray(value)))) || (value.type === undefined || (!("type" in value) || value.type === "task"))) ? check_35(value) : true) && ((!((typeof value === "object" && value !== null && !(Array.isArray(value)))) || (value.type === undefined || (!("type" in value) || value.type === "separator"))) ? check_40(value) : true))));

// @ts-ignore
const check_35 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((((("type" in value && "id" in value) && "label" in value) && "items" in value) && Object.getOwnPropertyNames(value).every((var_138, var_139) => (External[27].test(var_138) || false))) && ((((value.type === "task" && check_6(value.id)) && check_4(value.label)) && (Array.isArray(value.items) && (value.items.every((element, index) => check_36(element)) && value.items.length <= 100))) && (value.role === undefined || (!("role" in value) || check_38(value.role)))))));

// @ts-ignore
const check_36 = ((value) => (((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("type" in value && (value.type === "activity" || value.type === "milestone"))) && (((!((typeof value === "object" && value !== null && !(Array.isArray(value)))) || (value.type === undefined || (!("type" in value) || value.type === "activity"))) ? check_37(value) : true) && ((!((typeof value === "object" && value !== null && !(Array.isArray(value)))) || (value.type === undefined || (!("type" in value) || value.type === "milestone"))) ? check_39(value) : true))));

// @ts-ignore
const check_37 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (((("type" in value && "start" in value) && "end" in value) && Object.getOwnPropertyNames(value).every((var_140, var_141) => (External[28].test(var_140) || false))) && (((((((value.type === "activity" && check_33(value.start)) && check_33(value.end)) && (value.id === undefined || (!("id" in value) || check_6(value.id)))) && (value.label === undefined || (!("label" in value) || check_4(value.label)))) && (value.kind === undefined || (!("kind" in value) || check_5(value.kind)))) && (value.previous === undefined || (!("previous" in value) || ((typeof value.previous === "object" && value.previous !== null && !(Array.isArray(value.previous))) && ((("start" in value.previous && "end" in value.previous) && Object.getOwnPropertyNames(value.previous).length === 2) && (check_33(value.previous.start) && check_33(value.previous.end))))))) && (value.role === undefined || (!("role" in value) || check_38(value.role)))))));

// @ts-ignore
const check_38 = ((value) => (value === "added" || value === "removed"));

// @ts-ignore
const check_39 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((("type" in value && "date" in value) && Object.getOwnPropertyNames(value).every((var_142, var_143) => (External[29].test(var_142) || false))) && ((((((value.type === "milestone" && check_33(value.date)) && (value.id === undefined || (!("id" in value) || check_6(value.id)))) && (value.label === undefined || (!("label" in value) || check_4(value.label)))) && (value.kind === undefined || (!("kind" in value) || check_5(value.kind)))) && (value.previous === undefined || (!("previous" in value) || ((typeof value.previous === "object" && value.previous !== null && !(Array.isArray(value.previous))) && (("date" in value.previous && Object.getOwnPropertyNames(value.previous).length === 1) && check_33(value.previous.date)))))) && (value.role === undefined || (!("role" in value) || check_38(value.role)))))));

// @ts-ignore
const check_40 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("type" in value && Object.getOwnPropertyNames(value).every((var_144, var_145) => (External[30].test(var_144) || false))) && (value.type === "separator" && (value.label === undefined || (!("label" in value) || check_4(value.label)))))));

// @ts-ignore
const check_41 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((("from" in value && "to" in value) && Object.getOwnPropertyNames(value).every((var_146, var_147) => (External[31].test(var_146) || false))) && ((check_6(value.from) && check_6(value.to)) && (value.type === undefined || (!("type" in value) || (((value.type === "finish-to-start" || value.type === "start-to-start") || value.type === "finish-to-finish") || value.type === "start-to-finish")))))));

// @ts-ignore
export function Check(value) { return check_0(value) }

SetExternal({ variables: [
  new RegExp("(^schema$|^kind$|^profile$|^target$|^removals$|^artifacts$|^viewpoints$|^data$)", "u"),
  new RegExp("(^ref$|^revision$)", "u"),
  new RegExp("(^type$|^ref$|^label$|^kind$|^from$|^to$)", "u"),
  new RegExp("(^rel$|^uri$|^sha256$|^mediaType$|^label$)", "u"),
  new RegExp("^sha256:[0-9a-f]{64}$", "u"),
  new RegExp("(^id$|^label$|^concern$|^elementKinds$|^relationshipKinds$)", "u"),
  new RegExp("(^nodes$|^edges$|^containers$)", "u"),
  new RegExp("(^id$|^ref$|^label$|^kind$|^set$|^container$|^attributes$|^expect$|^locations$|^artifacts$)", "u"),
  new RegExp("(^label$|^kind$|^container$|^attributes$|^removeAttributes$)", "u"),
  new RegExp("(?!)", "u"),
  new RegExp("(^label$|^kind$|^container$|^revision$|^attributes$)", "u"),
  new RegExp("(^uri$|^revision$|^range$)", "u"),
  new RegExp("(^startLine$|^startCharacter$|^endLine$|^endCharacter$)", "u"),
  new RegExp("(^from$|^to$|^kind$|^ref$|^label$|^set$|^attributes$|^expect$|^locations$|^artifacts$)", "u"),
  new RegExp("(^kind$|^label$|^attributes$|^removeAttributes$)", "u"),
  new RegExp("(^id$|^label$|^kind$)", "u"),
  new RegExp("(^participants$|^messages$|^containers$)", "u"),
  new RegExp("(^from$|^to$|^ref$|^label$|^set$|^attributes$|^expect$|^locations$|^artifacts$)", "u"),
  new RegExp("(^label$|^attributes$|^removeAttributes$)", "u"),
  new RegExp("(^columns$|^rows$|^relations$)", "u"),
  new RegExp("(^cells$|^role$|^id$|^ref$|^kind$|^label$|^set$|^attributes$|^expect$|^locations$|^artifacts$)", "u"),
  new RegExp("(^label$|^kind$|^cells$|^attributes$|^removeAttributes$)", "u"),
  new RegExp("(^heading$|^depth$|^role$|^id$|^ref$)", "u"),
  new RegExp("(^from$|^to$|^kind$|^ref$|^label$|^attributes$)", "u"),
  new RegExp("(^id$|^ref$)", "u"),
  new RegExp("(^title$|^time$|^rows$|^dependencies$|^comparedTo$)", "u"),
  new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$", "u"),
  new RegExp("(^type$|^id$|^label$|^items$|^role$)", "u"),
  new RegExp("(^type$|^start$|^end$|^id$|^label$|^kind$|^previous$|^role$)", "u"),
  new RegExp("(^type$|^date$|^id$|^label$|^kind$|^previous$|^role$)", "u"),
  new RegExp("(^type$|^label$)", "u"),
  new RegExp("(^from$|^to$|^type$)", "u"),
  new RegExp("(^label$|^date$)", "u"),
] })
