import { Observable } from "../valoo";
import { InspectData } from "../../adapter/adapter/adapter";
import { createSearchStore } from "./search";
import { createFilterStore } from "./filter";
import { createSelectionStore } from "./selection";
import { Collapser } from "./collapser";
import { EmitFn, DevtoolEvents } from "../../adapter/hook";
import { ProfilerState } from "../components/profiler/data/commits";
import { PropData } from "../components/sidebar/inspect/parseProps";
import { ParsedStats } from "../../adapter/shared/stats";

export type ID = number;

export enum DevNodeType {
	/**
	 * Groups are virtual nodes inserted by the devtools
	 * to make certain operations easier. They are not
	 * created by Preact.
	 */
	Group,
	Element,
	ClassComponent,
	FunctionComponent,
	ForwardRef,
	Memo,
	Suspense,
	Context,
	Consumer,
	Portal,
}

export interface DevNode {
	id: ID;
	type: DevNodeType;
	name: string;
	key: string | null;
	parent: ID;
	children: ID[];
	/** Higher Order Component wrappers */
	hocs: string[] | null;

	// Display (Elements + Profiler)
	depth: number;

	// Raw absolute timing data.
	startTime: number;
	endTime: number;
}

export type Theme = "auto" | "light" | "dark";
export enum Panel {
	ELEMENTS = "ELEMENTS",
	PROFILER = "PROFILER",
	SETTINGS = "SETTINGS",
	STATISTICS = "STATISTICS",
}

export type Tree = Map<ID, DevNode>;

export interface Store {
	supports: {
		hooks: Observable<boolean>;
	};
	stats: {
		isRecording: Observable<boolean>;
		data: Observable<ParsedStats | null>;
	};
	debugMode: Observable<boolean>;
	activePanel: Observable<Panel>;
	notify: EmitFn;
	profiler: ProfilerState;
	isPicking: Observable<boolean>;
	inspectData: Observable<InspectData | null>;
	roots: Observable<ID[]>;
	nodes: Observable<Tree>;
	nodeList: Observable<ID[]>;
	theme: Observable<Theme>;
	search: ReturnType<typeof createSearchStore>;
	filter: ReturnType<typeof createFilterStore>;
	selection: ReturnType<typeof createSelectionStore>;
	collapser: Collapser<ID>;
	sidebar: {
		props: {
			uncollapsed: Observable<string[]>;
			items: Observable<PropData[]>;
		};
		state: {
			uncollapsed: Observable<string[]>;
			items: Observable<PropData[]>;
		};
		context: {
			uncollapsed: Observable<string[]>;
			items: Observable<PropData[]>;
		};
		hooks: {
			uncollapsed: Observable<string[]>;
			items: Observable<PropData[]>;
		};
	};
	clear(): void;
	emit: EmitFn;
	subscribe(fn: Listener): () => void;
}

export type Listener = <K extends keyof DevtoolEvents>(
	name: K,
	data: DevtoolEvents[K],
) => void;
