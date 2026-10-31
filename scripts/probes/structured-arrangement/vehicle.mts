/** The twelve-element vehicle architecture the arrangement probes draw. */
import type { StructuredGraphData } from "@pi-outpost/shared/structured-exchange";

export const vehicle: StructuredGraphData = {
  nodes: [
    { id: "charger", label: "Chargeur embarqué", kind: "power" },
    { id: "battery", label: "Batterie HT", kind: "power", ref: "EL-BAT" },
    { id: "bms", label: "BMS", kind: "control" },
    { id: "inverter", label: "Onduleur", kind: "power" },
    { id: "dcdc", label: "Convertisseur DC/DC", kind: "power" },
    { id: "motor", label: "Moteur de traction", kind: "power" },
    { id: "lv", label: "Batterie 12 V", kind: "power" },
    { id: "vcu", label: "Calculateur véhicule", kind: "control" },
    { id: "pedal", label: "Pédale", kind: "sensor" },
    { id: "cooling", label: "Refroidissement", kind: "thermal" },
    { id: "hmi", label: "Tableau de bord", kind: "control" },
    { id: "gearbox", label: "Réducteur", kind: "mechanical" },
  ],
  edges: [
    { from: "charger", to: "battery", kind: "power", label: "charge" },
    { from: "battery", to: "inverter", kind: "power", label: "400 V" },
    { from: "battery", to: "dcdc", kind: "power", label: "400 V" },
    { from: "dcdc", to: "lv", kind: "power", label: "12 V" },
    { from: "inverter", to: "motor", kind: "power", label: "triphasé" },
    { from: "motor", to: "gearbox", kind: "mechanical", label: "couple" },
    { from: "bms", to: "battery", kind: "control", label: "surveillance" },
    { from: "bms", to: "vcu", kind: "data", label: "état de charge" },
    { from: "pedal", to: "vcu", kind: "data", label: "consigne" },
    { from: "vcu", to: "inverter", kind: "control", label: "couple demandé" },
    { from: "vcu", to: "hmi", kind: "data", label: "affichage" },
    { from: "cooling", to: "inverter", kind: "thermal" },
    { from: "cooling", to: "battery", kind: "thermal" },
  ],
};
