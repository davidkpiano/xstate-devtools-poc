import { ID } from "../../view/store/types";
import { FilterState } from "../adapter/filter";
import { Commit, MsgTypes } from "../protocol/events";
import { getStringId } from "../protocol/string-table";
import {
	getOrCreateVNodeId,
	getVNodeById,
	getVNodeId,
	hasVNodeId,
	IdMappingState,
	updateVNodeId,
} from "./idMapper";
import { ProfilerState } from "../adapter/profiler";
import { getDevtoolsType, RendererConfig } from "./renderer";
import { RenderReason, RenderReasonData } from "./renderReasons";
import { createStats, DiffType, updateDiffStats } from "./stats";
import { NodeType } from "../../constants";
import { getDiffType, recordComponentStats } from "./stats";
import { measureUpdate } from "../adapter/highlightUpdates";
import { PreactBindings, SharedVNode } from "./bindings";
import { VNodeTimings } from "./timings";

function getHocName(name: string) {
	const idx = name.indexOf("(");
	if (idx === -1) return null;

	const wrapper = name.slice(0, idx);
	return wrapper ? wrapper : null;
}

function addHocs(commit: Commit, id: ID, hocs: string[]) {
	if (hocs.length > 0) {
		commit.operations.push(MsgTypes.HOC_NODES, id, hocs.length);
		for (let i = 0; i < hocs.length; i++) {
			const stringId = getStringId(commit.strings, hocs[i]);
			commit.operations.push(stringId);
		}
	}
}

function detectHocs(commit: Commit, name: string, id: ID, hocs: string[]) {
	const hocName = getHocName(name);
	if (name.startsWith("ForwardRef")) {
		const idx = name.indexOf("(");
		name = name.slice(idx + 1, -1) || "Anonymous";
		addHocs(commit, id, hocs);
		hocs = [];
	} else {
		if (hocName) {
			hocs = [...hocs, hocName];
		} else {
			addHocs(commit, id, hocs);
			hocs = [];
		}
	}
	return { name, hocs };
}

function isTextNode(dom: HTMLElement | Text | null): dom is Text {
	return dom != null && dom.nodeType === NodeType.Text;
}

function updateHighlight<T extends SharedVNode>(
	profiler: ProfilerState,
	vnode: T,
	bindings: PreactBindings<T>,
) {
	if (profiler.highlightUpdates && bindings.isComponent(vnode)) {
		const stack: Array<T | null | undefined> = [vnode];
		let item;
		let dom;
		while ((item = stack.shift()) !== undefined) {
			// Account for placholders/holes
			if (item === null) continue;

			if (!bindings.isComponent(item)) {
				dom = bindings.getDom(item);
				break;
			}

			stack.push(...bindings.getActualChildren(item));
		}

		if (dom === null || dom === undefined) return;

		if (isTextNode(dom)) {
			dom = dom.parentNode as HTMLElement;
		}
		if (dom && !profiler.pendingHighlightUpdates.has(dom)) {
			profiler.pendingHighlightUpdates.add(dom);
			measureUpdate(profiler.updateRects, dom);
		}
	}
}

export function getFilteredChildren<T extends SharedVNode>(
	vnode: T,
	filters: FilterState,
	config: RendererConfig,
	helpers: PreactBindings<T>,
): T[] {
	const children = helpers.getActualChildren(vnode);
	const stack = children.slice();

	const out: T[] = [];

	let child;
	while (stack.length) {
		child = stack.pop();
		if (child != null) {
			if (!shouldFilter(child, filters, config, helpers)) {
				out.push(child);
			} else {
				const nextChildren = helpers.getActualChildren(child);
				if (nextChildren.length > 0) {
					stack.push(...nextChildren.slice());
				}
			}
		}
	}

	return out.reverse();
}

export function shouldFilter<T extends SharedVNode>(
	vnode: T,
	filters: FilterState,
	config: RendererConfig,
	bindings: PreactBindings<T>,
): boolean {
	// Filter text nodes by default. They are too tricky to match
	// with the previous one...
	if (bindings.isTextVNode(vnode)) {
		return true;
	}

	// TODO: Add a virtual root node to be able to filter the actual
	// ones. Currently we have a workaround on the extension side
	// that filters it there, but we should really do it here to be
	// consistent with all other filters.

	if (vnode.type === config.Fragment && filters.type.has("fragment")) {
		const parent = bindings.getVNodeParent(vnode);
		// Only filter non-root nodes
		if (parent != null) return true;

		return false;
	} else if (bindings.isElement(vnode) && filters.type.has("dom")) {
		return true;
	} else if (filters.type.has("hoc")) {
		const name = bindings.getDisplayName(vnode, config);

		if (name.indexOf("(") > -1 && !name.startsWith("ForwardRef")) {
			return true;
		}
	}

	if (filters.regex.length > 0) {
		const name = bindings.getDisplayName(vnode, config);
		return filters.regex.some(r => {
			// Regexes with a global flag are stateful in JS :((
			r.lastIndex = 0;
			return r.test(name);
		});
	}

	// In Preact V11 we use a Portal component to render Suspense
	// children. Because that is only an implementation detail
	// we'll hide this component to avoid confusing users.
	const parent = bindings.getVNodeParent(vnode);
	if (
		parent !== null &&
		bindings.isSuspenseVNode(parent) &&
		bindings.isPortal(vnode)
	) {
		return true;
	}

	return false;
}

function mount<T extends SharedVNode>(
	ids: IdMappingState<T>,
	commit: Commit,
	vnode: T,
	ancestorId: ID,
	filters: FilterState,
	domCache: WeakMap<HTMLElement | Text, T>,
	config: RendererConfig,
	profiler: ProfilerState,
	hocs: string[],
	bindings: PreactBindings<T>,
	selfDurations: Map<ID, number>,
	timingsByVNode: VNodeTimings<T>,
	renderReasonPre: Map<T, RenderReasonData> | null,
): ID {
	if (commit.stats !== null) {
		commit.stats.mounts++;
	}

	const root = bindings.isRoot(vnode, config);
	if (root) {
		const rootId = getOrCreateVNodeId(ids, vnode);
		const mappedRootIdx = commit.operations.push(
			MsgTypes.ADD_ROOT,
			rootId,
			rootId,
		);

		if (filters.type.has("root")) {
			const children = bindings.getActualChildren(vnode);
			if (!children.length || children[0] == null) {
				return rootId;
			}

			const child = children[0];
			const childId = mount(
				ids,
				commit,
				child,
				ancestorId,
				filters,
				domCache,
				config,
				profiler,
				hocs,
				bindings,
				selfDurations,
				timingsByVNode,
				renderReasonPre,
			);

			commit.operations[mappedRootIdx - 1] = childId;
			return childId;
		}
	}

	const skip = shouldFilter(vnode, filters, config, bindings);
	let name = bindings.getDisplayName(vnode, config);

	if (filters.type.has("hoc")) {
		const hocName = getHocName(name);
		if (hocName) {
			hocs = [...hocs, hocName];
			if (name.startsWith("ForwardRef")) {
				const idx = name.indexOf("(");
				name = name.slice(idx + 1, -1) || "Anonymous";
			}
		}
	}

	let selfDurationIdx = -1;
	let id = -1;
	if (!skip) {
		id = getOrCreateVNodeId(ids, vnode);

		const start = timingsByVNode.start.get(vnode) || 0;
		const end = timingsByVNode.end.get(vnode) || 0;
		const duration = end - start;
		selfDurations.set(id, duration);

		selfDurationIdx = commit.operations.push(
			MsgTypes.ADD_VNODE,
			id,
			getDevtoolsType(vnode, bindings), // Type
			ancestorId,
			9999, // owner
			getStringId(commit.strings, name),
			vnode.key ? getStringId(commit.strings, vnode.key) : 0,
			// We will be able to measure the `selfDuration` once
			// children duration are processed
			-1,
		);

		// Must be done after node is sent to devtools
		if (hocs.length > 0) {
			addHocs(commit, id, hocs);
			hocs = [];
		}

		// Capture render reason (mount here)
		if (profiler.isProfiling && profiler.captureRenderReasons) {
			commit.operations.push(MsgTypes.RENDER_REASON, id, RenderReason.MOUNT, 0);
		}

		updateHighlight(profiler, vnode, bindings);

		ancestorId = id;
	}

	if (skip && !bindings.isComponent(vnode)) {
		const dom = bindings.getDom(vnode);
		if (dom) domCache.set(dom, vnode);
	}

	let diff = DiffType.UNKNOWN;
	let childCount = 0;

	const children = bindings.getActualChildren(vnode);
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child != null) {
			if (commit.stats !== null) {
				diff = getDiffType(child, diff);
				childCount++;
			}

			mount(
				ids,
				commit,
				child,
				ancestorId,
				filters,
				domCache,
				config,
				profiler,
				hocs,
				bindings,
				selfDurations,
				timingsByVNode,
				renderReasonPre,
			);
		}
	}

	if (selfDurationIdx !== -1) {
		// Multiply, because operations array only supports integers
		// and would otherwise cut off floats. Also use 0.1 as minimum
		// because due to Spectre CPU mitigations the timings are not
		// precise. Nodes with a time of 0 are impossible to select
		// in devtools.
		commit.operations[selfDurationIdx - 1] =
			(selfDurations.get(id) || 0.05) * 1000;
	}

	if (commit.stats !== null) {
		updateDiffStats(commit.stats, diff, childCount);
		recordComponentStats(config, bindings, commit.stats, vnode, children);
	}

	return id;
}

function resetChildren<T extends SharedVNode>(
	commit: Commit,
	ids: IdMappingState<T>,
	id: ID,
	vnode: T,
	filters: FilterState,
	config: RendererConfig,
	helpers: PreactBindings<T>,
) {
	const children = helpers.getActualChildren(vnode);
	if (!children.length) return;

	const next = getFilteredChildren(vnode, filters, config, helpers);

	// Suspense internals mutate child outside of the standard render cycle.
	// This leads to stale children on the devtools ends. To work around that
	// We'll always reset the children of a Suspense vnode.
	let forceReorder = false;
	if (helpers.isSuspenseVNode(vnode)) {
		forceReorder = true;
	}

	if (!forceReorder && next.length < 2) return;

	commit.operations.push(
		MsgTypes.REORDER_CHILDREN,
		id,
		next.length,
		...next.map(x => getVNodeId(ids, x)),
	);
}

function update<T extends SharedVNode>(
	ids: IdMappingState<T>,
	commit: Commit,
	vnode: T,
	ancestorId: number,
	filters: FilterState,
	domCache: WeakMap<HTMLElement | Text, T>,
	config: RendererConfig,
	profiler: ProfilerState,
	hocs: string[],
	bindings: PreactBindings<T>,
	selfDurations: Map<ID, number>,
	timingsByVNode: VNodeTimings<T>,
	renderReasonPre: Map<T, RenderReasonData> | null,
) {
	if (commit.stats !== null) {
		commit.stats.updates++;
	}

	let diff = DiffType.UNKNOWN;

	const id = getVNodeId(ids, vnode);
	const skip = shouldFilter(vnode, filters, config, bindings);
	if (skip) {
		if (filters.type.has("hoc")) {
			const name = bindings.getDisplayName(vnode, config);
			const res = detectHocs(commit, name, id, hocs);
			hocs = res.hocs;
		}

		let childCount = 0;
		const children = bindings.getActualChildren(vnode);
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			if (child != null) {
				if (commit.stats !== null) {
					diff = getDiffType(child, diff);
					childCount++;
				}

				update(
					ids,
					commit,
					child,
					ancestorId,
					filters,
					domCache,
					config,
					profiler,
					hocs,
					bindings,
					selfDurations,
					timingsByVNode,
					renderReasonPre,
				);
			}
		}

		if (commit.stats !== null) {
			updateDiffStats(commit.stats, diff, childCount);
			recordComponentStats(config, bindings, commit.stats, vnode, children);
		}
		return;
	}

	if (!hasVNodeId(ids, vnode)) {
		mount(
			ids,
			commit,
			vnode,
			ancestorId,
			filters,
			domCache,
			config,
			profiler,
			hocs,
			bindings,
			selfDurations,
			timingsByVNode,
			renderReasonPre,
		);
		return true;
	}

	const oldVNode = getVNodeById(ids, id);
	updateVNodeId(ids, id, vnode);

	let selfDurationIdx = -1;

	// TODO: Can we use this to bail out of checking?
	const didRender = timingsByVNode.end.has(vnode);
	if (didRender) {
		if (filters.type.has("hoc")) {
			const name = bindings.getDisplayName(vnode, config);
			const res = detectHocs(commit, name, id, hocs);
			hocs = res.hocs;
		}

		const start = timingsByVNode.start.get(vnode) || 0;
		const end = timingsByVNode.end.get(vnode) || 0;
		const duration = end - start;
		selfDurations.set(id, duration);

		// Remove current node timing from ancestor
		if (selfDurations.has(ancestorId)) {
			selfDurations.set(ancestorId, selfDurations.get(ancestorId)! - duration);
		}

		selfDurationIdx = commit.operations.push(
			MsgTypes.UPDATE_VNODE_TIMINGS,
			id,
			// We will be able to measure the `selfDuration` once
			// children duration are processed
			-1,
		);

		if (profiler.isProfiling && profiler.captureRenderReasons) {
			const reason =
				renderReasonPre !== null
					? renderReasonPre.get(vnode) || null
					: bindings.getRenderReasonPost(
							ids,
							bindings,
							selfDurations,
							oldVNode,
							vnode,
					  );
			if (reason !== null) {
				const count = reason.items ? reason.items.length : 0;
				commit.operations.push(MsgTypes.RENDER_REASON, id, reason.type, count);
				if (reason.items && count > 0) {
					commit.operations.push(
						...reason.items.map(str => getStringId(commit.strings, str)),
					);
				}
			}
		}

		updateHighlight(profiler, vnode, bindings);
	}

	const oldChildren = oldVNode
		? bindings
				.getActualChildren(oldVNode)
				.map((v: any) => v && getVNodeId(ids, v))
		: [];

	let shouldReorder = false;
	let childCount = 0;

	const children = bindings.getActualChildren(vnode);
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child == null) {
			const oldChildId = oldChildren[i];
			if (oldChildId != null) {
				commit.unmountIds.push(oldChildId);
			}
		} else if (
			hasVNodeId(ids, child) ||
			shouldFilter(child, filters, config, bindings)
		) {
			if (commit.stats !== null) {
				diff = getDiffType(child, diff);
				childCount++;
			}
			update(
				ids,
				commit,
				child,
				id,
				filters,
				domCache,
				config,
				profiler,
				hocs,
				bindings,
				selfDurations,
				timingsByVNode,
				renderReasonPre,
			);
			// TODO: This is only sometimes necessary
			shouldReorder = true;
		} else {
			if (commit.stats !== null) {
				diff = getDiffType(child, diff);
				childCount++;
			}
			mount(
				ids,
				commit,
				child,
				id,
				filters,
				domCache,
				config,
				profiler,
				hocs,
				bindings,
				selfDurations,
				timingsByVNode,
				renderReasonPre,
			);
			shouldReorder = true;
		}
	}

	if (selfDurationIdx !== -1) {
		// Multiply, because operations array only supports integers
		// and would otherwise cut off floats. Also use 0.1 as minimum
		// because due to Spectre CPU mitigations the timings are not
		// precise. Nodes with a time of 0 are impossible to select
		// in devtools.
		commit.operations[selfDurationIdx - 1] =
			(selfDurations.get(id) || 0.05) * 1000;
	}

	if (commit.stats !== null) {
		updateDiffStats(commit.stats, diff, childCount);
		recordComponentStats(config, bindings, commit.stats, vnode, children);
	}

	if (shouldReorder) {
		resetChildren(commit, ids, id, vnode, filters, config, bindings);
	}
}

/**
 * Crawl upwards through potentially filtered vnodes until
 * we find a non-filtered node or reach the top of the tree
 */
function findClosestNonFilteredParent<T extends SharedVNode>(
	ids: IdMappingState<T>,
	helpers: PreactBindings<T>,
	vnode: T,
) {
	let parentId = -1;
	let ancestor: T | null = helpers.getVNodeParent(vnode);
	while (ancestor !== null) {
		parentId = getVNodeId(ids, ancestor);
		if (parentId !== -1) {
			break;
		}

		ancestor = helpers.getVNodeParent(ancestor);
	}

	return parentId;
}

export function createCommit<T extends SharedVNode>(
	ids: IdMappingState<T>,
	roots: Set<T>,
	vnode: T,
	filters: FilterState,
	domCache: WeakMap<HTMLElement | Text, T>,
	config: RendererConfig,
	profiler: ProfilerState,
	helpers: PreactBindings<T>,
	timingsByVNode: VNodeTimings<T>,
	renderReasonPre: Map<T, RenderReasonData> | null,
): Commit {
	const commit = {
		operations: [],
		rootId: -1,
		strings: new Map(),
		unmountIds: [],
		renderReasons: new Map(),
		stats: profiler.recordStats ? createStats() : null,
	};

	const selfDurations = new Map<ID, number>();

	let parentId = -1;

	const isNew = !hasVNodeId(ids, vnode);

	if (helpers.isRoot(vnode, config)) {
		if (commit.stats !== null) {
			commit.stats.roots.total++;
			const children = helpers.getActualChildren(vnode);
			commit.stats.roots.children.push(children.length);
		}

		parentId = -1;
		roots.add(vnode);
	} else {
		parentId = findClosestNonFilteredParent(ids, helpers, vnode);
	}

	if (isNew) {
		mount(
			ids,
			commit,
			vnode,
			parentId,
			filters,
			domCache,
			config,
			profiler,
			[],
			helpers,
			selfDurations,
			timingsByVNode,
			renderReasonPre,
		);
	} else {
		update(
			ids,
			commit,
			vnode,
			parentId,
			filters,
			domCache,
			config,
			profiler,
			[],
			helpers,
			selfDurations,
			timingsByVNode,
			renderReasonPre,
		);
	}

	// Find actual root node

	if (roots.has(vnode)) {
		commit.rootId = getVNodeId(ids, vnode);
	} else {
		let rootVNode: T | null = vnode;
		while ((rootVNode = helpers.getVNodeParent(rootVNode)) != null) {
			if (helpers.isRoot(rootVNode, config)) {
				commit.rootId = getVNodeId(ids, rootVNode);
				break;
			}
		}
	}

	return commit;
}
