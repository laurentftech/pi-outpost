/** structured-exchange-arrangement: the vehicle page’s styles, waypoints and routes for a few wires. */
import { graphFigurePage } from "@pi-outpost/shared/structured-exchange/figure";
import { routeGraph } from "@pi-outpost/shared/structured-exchange/wiring";
import { vehicle } from "./vehicle.mts";
const page = graphFigurePage(vehicle);
const wires = routeGraph(page);
for (const cell of page.cells) if (cell.edge && ["r:2","r:3","r:1","r:12"].includes(cell.id!)) console.log(cell.id, cell.style, JSON.stringify(cell.geometry?.points), JSON.stringify(wires.get(Number(cell.id!.slice(2)))?.points));
for (const cell of page.cells) if (cell.vertex && ["n:battery","n:dcdc","n:lv"].includes(cell.id!)) console.log(cell.id, JSON.stringify(cell.geometry));
