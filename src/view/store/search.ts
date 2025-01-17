import { Observable, valoo } from "../valoo";
import { useStore, useObserver } from "./react-bindings";
import escapeRegex from "escape-string-regexp";
import { ID, DevNode } from "./types";

export function createRegex(s: string): RegExp {
	if (s[0] === "/") {
		s = s.slice(1);
		if (s[s.length - 1] === "/") {
			s = s.slice(0, -1);
		}
		try {
			return new RegExp(s, "i");
		} catch (err) {
			return new RegExp("");
		}
	}
	return new RegExp(`(${escapeRegex(s)})`, "i");
}

export function createSearchStore(
	items: Observable<Map<ID, DevNode>>,
	list: Observable<ID[]>,
) {
	const value = valoo("");
	const selected = valoo(0);
	const selectedIdx = valoo(-1);
	const regex = valoo<RegExp | null>(null);
	const match = valoo<number[]>([]);
	const count = valoo(0);

	const onChange = (s: string) => {
		value.$ = s;

		match.$ = [];

		if (s === "") {
			regex.$ = null;
			count.$ = 0;
			selected.$ = 0;
			return;
		}

		const reg = createRegex(s);
		regex.$ = reg;

		const ids: number[] = [];
		list.$.forEach(id => {
			const node = items.$.get(id);
			if (
				node &&
				(reg.test(node.name) || (node.hocs && node.hocs.some(h => reg.test(h))))
			) {
				ids.push(id);
			}
		});

		if (ids.length > 0) {
			selected.$ = 0;
		}
		count.$ = ids.length;
		match.$ = ids;
	};

	const reset = () => {
		selectedIdx.$ = -1;
		onChange("");
	};

	function go(n: number) {
		if (n < 0) n = match.$.length - 1;
		else if (n > match.$.length - 1) n = 0;
		selected.$ = n;
		selectedIdx.$ = list.$.findIndex(id => match.$[n] === id);
	}

	const selectNext = () => go(selected.$ + 1);
	const selectPrev = () => go(selected.$ - 1);

	return {
		selected,
		selectedIdx,
		regex,
		count,
		value,
		match,
		reset,
		onChange,
		selectNext,
		selectPrev,
	};
}

export function useSearch() {
	const { search: s } = useStore();
	const match = useObserver(() => s.match.$);
	const value = useObserver(() => s.value.$);
	const marked = useObserver(() => s.selected.$);
	const regex = useObserver(() => s.regex.$);
	const count = useObserver(() => s.count.$);
	const selected = useObserver(() => s.selected.$);
	const selectedId = useObserver(() => s.match.$[s.selected.$]);
	return {
		count,
		selected,
		selectedId,
		marked,
		regex,
		match,
		goNext: s.selectNext,
		goPrev: s.selectPrev,
		value,
	};
}
