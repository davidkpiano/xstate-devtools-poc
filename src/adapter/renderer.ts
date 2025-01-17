import { ID } from "../view/store/types";
import { FilterState } from "./adapter/filter";
import { InspectData, UpdateType } from "./adapter/adapter";
import { SharedVNode } from "./shared/bindings";
import { VNodeTimings } from "./shared/timings";
import { RenderReasonData } from "./shared/renderReasons";

export type ObjPath = Array<string | number>;

export interface Renderer<T extends SharedVNode = SharedVNode> {
	refresh?(): void;
	getVNodeById(id: ID): T | null;
	getDisplayName(vnode: T): string;
	findDomForVNode(id: ID): Array<HTMLElement | Text | null> | null;
	findVNodeIdForDom(node: HTMLElement | Text): number;
	applyFilters(filters: FilterState): void;
	log(id: ID, children: ID[]): void;
	inspect(id: ID): InspectData | null;
	update(id: ID, type: UpdateType, path: ObjPath, value: any): void;
	clear?(): void;
	onCommit(
		vnode: T,
		timings: VNodeTimings<T>,
		renderReasons: Map<T, RenderReasonData> | null,
	): void;
	onUnmount(vnode: T): void;

	// Hooks
	updateHook?(id: ID, index: number, value: any): void; // V3

	// Component actions
	suspend?(id: ID, active: boolean): void; // V4
}

export function getRendererByVNodeId(
	renderers: Map<number, Renderer<SharedVNode>>,
	id: ID,
) {
	for (const r of renderers.values()) {
		if (r.getVNodeById(id) !== null) return r;
	}

	return null;
}
