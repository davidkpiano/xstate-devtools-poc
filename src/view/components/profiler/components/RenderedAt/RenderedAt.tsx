import { h } from "preact";
import { useStore, useObserver } from "../../../../store/react-bindings";
import { SidebarPanel, Empty } from "../../../sidebar/SidebarPanel";
import s from "./RenderedAt.module.css";
import { formatTime } from "../../util";

export function RenderedAt() {
	const store = useStore();
	const data = useObserver(() => {
		const id = store.profiler.selectedNodeId.$;

		return store.profiler.commits.$.reduce<
			Array<{ index: number; startTime: number; selfDuration: number }>
		>((acc, commit, i) => {
			if (!commit.rendered.has(id)) return acc;

			const node = commit.nodes.get(id)!;

			const selfDuration = commit.selfDurations.get(id) || 0;
			acc.push({
				index: i,
				startTime: node.startTime,
				selfDuration,
			});
			return acc;
		}, []);
	});

	const commitIdx = useObserver(() => store.profiler.activeCommitIdx.$);

	if (data.length <= 0) return null;

	return (
		<SidebarPanel title="Rendered at:">
			{data.length <= 0 ? (
				<Empty>Did not render during this profiling session</Empty>
			) : (
				<nav data-testid="rendered-at">
					{data.map(node => {
						return (
							<button
								key={node.index}
								class={s.item}
								data-active={commitIdx === node.index}
								onClick={() => (store.profiler.activeCommitIdx.$ = node.index)}
							>
								<span>
									{formatTime(node.startTime / 1000)} for{" "}
									{formatTime(node.selfDuration)}
								</span>
							</button>
						);
					})}
				</nav>
			)}
		</SidebarPanel>
	);
}
